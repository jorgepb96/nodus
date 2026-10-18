# SPDX-License-Identifier: AGPL-3.0-only
"""One-shot local pyHanko adapter. JSON stdin/stdout; never logs input/secrets.
No URL fetchers, TSA, OCSP or CRL network access. Private keys live in this process.
"""
import base64
import io
import json
import sys
import logging
from datetime import datetime, timezone
logging.disable(logging.CRITICAL)

def main(req):
    from importlib.metadata import version
    if version('pyHanko') != '0.35.1': raise ValueError('SIGN_ENGINE_VERSION')
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers, validation
    from pyhanko_certvalidator import ValidationContext
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.hazmat.primitives import hashes
    from pyhanko import stamp
    from pyhanko.pdf_utils import images
    if req['op'] == 'status':
        return {'available': True, 'version': version('pyHanko')}
    def certificate():
        with open(req['certificate'], 'rb') as f:
            data = f.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024: raise ValueError('CERTIFICATE_TOO_LARGE')
        try:
            key, cert, chain = pkcs12.load_key_and_certificates(data, req.get('password', '').encode() or None)
        except Exception:
            raise ValueError('CERTIFICATE_PASSWORD_OR_FORMAT')
        if not cert or not key: raise ValueError('CERTIFICATE_PRIVATE_KEY_MISSING')
        from cryptography.hazmat.primitives.asymmetric import rsa, ec, dsa
        if isinstance(key, (rsa.RSAPrivateKey, dsa.DSAPrivateKey)) and key.key_size < 2048: raise ValueError('CERTIFICATE_WEAK_KEY')
        if isinstance(key, ec.EllipticCurvePrivateKey) and key.key_size < 224: raise ValueError('CERTIFICATE_WEAK_KEY')
        now = datetime.now(timezone.utc)
        usable = cert.not_valid_before_utc <= now <= cert.not_valid_after_utc
        try:
            from cryptography import x509
            usage = cert.extensions.get_extension_for_class(x509.KeyUsage).value
            usable = usable and (usage.digital_signature or usage.content_commitment)
        except x509.ExtensionNotFound:
            pass
        return data, {'subject': cert.subject.rfc4514_string(), 'issuer': cert.issuer.rfc4514_string(), 'serial': str(cert.serial_number), 'fingerprint': cert.fingerprint(hashes.SHA256()).hex(), 'notBefore': cert.not_valid_before_utc.isoformat(), 'notAfter': cert.not_valid_after_utc.isoformat(), 'usable': usable}
    if req['op'] == 'certificate': return certificate()[1]
    def inspect(data):
        reader = PdfFileReader(io.BytesIO(data), strict=True)
        if reader.encrypted: raise ValueError('PDF_ENCRYPTED')
        signatures = []
        restricted = bool(reader.root.get('/Perms'))
        for sig in reader.embedded_signatures:
            restricted = restricted or bool(sig.sig_object.get('/Reference'))
            status = validation.validate_pdf_signature(sig, signer_validation_context=ValidationContext(allow_fetching=False, revocation_mode='soft-fail'), skip_diff=False)
            signatures.append({'field': sig.field_name, 'intact': status.intact, 'valid': status.valid, 'trusted': status.trusted, 'coverage': status.coverage.name if status.coverage else 'UNKNOWN', 'modification': status.modification_level.name if status.modification_level else 'NONE', 'signer': sig.signer_cert.subject.human_friendly})
        return {'signatures': signatures, 'restricted': restricted, 'encrypted': False}
    data = base64.b64decode(req['pdf'], validate=True)
    before = inspect(data)
    if req['op'] == 'inspect': return before
    if req['op'] != 'sign': raise ValueError('UNKNOWN_OPERATION')
    if before['restricted']: raise ValueError('PDF_RESTRICTED')
    for sig in before['signatures']:
        if not sig['intact'] or not sig['valid'] or sig['modification'] not in ('NONE', 'FORM_FILLING') or sig['coverage'] not in ('ENTIRE_FILE', 'ENTIRE_REVISION'):
            raise ValueError('EXISTING_SIGNATURE_INVALID')
    p12, cert = certificate()
    if req.get('expectedFingerprint') and cert['fingerprint'] != req['expectedFingerprint']: raise ValueError('CERTIFICATE_CHANGED')
    if not cert['usable']: raise ValueError('CERTIFICATE_EXPIRED_OR_NOT_USABLE')
    signer = signers.SimpleSigner.load_pkcs12_data(p12, other_certs=[], passphrase=req.get('password', '').encode() or None)
    if not signer: raise ValueError('CERTIFICATE_PASSWORD_OR_FORMAT')
    # Without an appearance there is a single signature whose field has no
    # widget box, so nothing is drawn on any page.
    visible = req.get('visible', True) is not False
    widgets = req.get('widgets', [{'page': req['page'], 'box': req['box']}]) if visible else []
    if visible and (not isinstance(widgets, list) or not widgets or len(widgets) > 1000): raise ValueError('INVALID_SIGNATURE_PAGE')
    from math import isfinite
    page_count = int(PdfFileReader(io.BytesIO(data)).root['/Pages']['/Count'])
    seen = set()
    for widget in widgets:
        page = widget['page']
        if not isinstance(page, int) or isinstance(page, bool) or page < 1 or page > page_count or page in seen:
            raise ValueError('INVALID_SIGNATURE_PAGE')
        seen.add(page)
        box = widget['box']
        if len(box) != 4 or not all(isinstance(v, (float, int)) and isfinite(v) for v in box) or box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError('INVALID_SIGNATURE_BOX')
    # Each selected page gets a genuine signed widget. No unsigned visual copies
    # are added after signing; every revision preserves all previous bytes.
    png = base64.b64decode(req['appearancePng'].split(',', 1)[1], validate=True) if visible else None
    from PIL import Image
    from pyhanko.pdf_utils.layout import SimpleBoxLayoutRule, AxisAlignment, Margins, InnerScaling
    layout = SimpleBoxLayoutRule(x_align=AxisAlignment.ALIGN_MID, y_align=AxisAlignment.ALIGN_MID, margins=Margins(0, 0, 0, 0), inner_content_scaling=InnerScaling.STRETCH_FILL)
    result = data
    for widget in widgets if visible else [None]:
        writer = IncrementalPdfFileWriter(io.BytesIO(result), strict=True)
        field_name = 'NodusSign_' + __import__('uuid').uuid4().hex
        meta = signers.PdfSignatureMetadata(field_name=field_name, md_algorithm='sha256', subfilter=fields.SigSeedSubFilter.PADES, reason=req['appearance'].get('reason') or None, location=req['appearance'].get('location') or None)
        if widget is None:
            spec = fields.SigFieldSpec(sig_field_name=field_name)
            output = signers.PdfSigner(meta, signer=signer, new_field_spec=spec).sign_pdf(writer).getvalue()
        else:
            background = images.PdfImage(Image.open(io.BytesIO(png)))
            spec = fields.SigFieldSpec(sig_field_name=field_name, on_page=widget['page'] - 1, box=tuple(widget['box']))
            style = stamp.StaticStampStyle(background=background, background_layout=layout, background_opacity=1, border_width=0)
            output = signers.PdfSigner(meta, signer=signer, stamp_style=style, new_field_spec=spec).sign_pdf(writer).getvalue()
        if not output.startswith(result): raise ValueError('INCREMENTAL_UPDATE_FAILED')
        result = output
    after = inspect(result)
    if len(after['signatures']) != len(before['signatures']) + (len(widgets) if visible else 1) or not all(s['intact'] and s['valid'] and s['modification'] in ('NONE', 'FORM_FILLING') for s in after['signatures']):
        raise ValueError('SIGNATURE_POST_VALIDATION_FAILED')
    return {'pdf': base64.b64encode(result).decode(), 'inspection': after}

try:
    req = json.loads(sys.stdin.buffer.read(240 * 1024 * 1024))
    result = main(req)
    print(json.dumps({'ok': True, 'result': result}))
except Exception as exc:
    # Exception messages from crypto libraries may contain filenames; expose
    # only adapter error codes and exception class names.
    code = str(exc) if isinstance(exc, ValueError) and str(exc).isupper() and len(str(exc)) < 100 else type(exc).__name__
    print(json.dumps({'ok': False, 'error': code}))
    sys.exit(1)
