// Real PDF bytes + filesystem persistence. Crypto tests use an optional local
// pyHanko environment and self-signed disposable certificates, never user keys.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { PDFDocument, degrees, PDFName, PDFString } from "pdf-lib";
const require = createRequire(import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nodus-sign-test-"));
async function bundle(entry) {
  const out = path.join(temp, path.basename(entry) + ".cjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "cjs",
    alias: { "@shared": path.resolve("shared") },
  });
  return require(out);
}
const { signatureReview } = await bundle("src/sign/validation.ts");
const { SignStore } = await bundle("electron/toolkit/sign/library.ts");
const { resolveSignPages, applyPlacementPages } = await bundle("src/sign/pages.ts");
const { resizeSignBox, adjustSignBox } = await bundle("src/sign/geometry.ts");
const { exportVisualPdf, inspectVisualPdf } = await bundle(
  "electron/toolkit/sign/visual.ts",
);
const { SignEngine } = await bundle("electron/toolkit/sign/engine.ts");
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMCsAAAAASUVORK5CYII=";
const placement = (page = 1) => ({
  id: "p",
  page,
  x: 0.2,
  y: 0.6,
  w: 0.4,
  h: 0.12,
  angle: 0,
  png,
});
async function pdf(pages = 1, rotation = 0) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.setRotation(degrees(rotation));
    p.drawText(`Nodus Sign test - page ${i + 1}`, { x: 40, y: 780, size: 18 });
  }
  return doc.save();
}
let signedBytes;
test('rotated resize keeps the opposite corner fixed', () => {
  const box={x:.3,y:.3,w:.2,h:.1}; const width=500,height=700;
  for (const angle of [0,45,90,180,-45]) {
    const after=resizeSignBox(box,20,15,width,height,angle);
    const corner=b=>{ const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a); return [(b.x+b.w/2)*width-c*b.w*width/2+s*b.h*height/2,(b.y+b.h/2)*height-s*b.w*width/2-c*b.h*height/2]; };
    const p=corner(box),q=corner(after);assert.ok(Math.abs(p[0]-q[0])<1e-8);assert.ok(Math.abs(p[1]-q[1])<1e-8);
  }
});
test('page selection accepts current, all and strict custom ranges', () => {
  assert.deepEqual(resolveSignPages({mode:'current', range:''},2,5),[2]);
  assert.deepEqual(resolveSignPages({mode:'all', range:''},2,3),[1,2,3]);
  assert.deepEqual(resolveSignPages({mode:'custom', range:'5, 1, 3-4, 3'},1,5),[1,3,4,5]);
  for (const range of ['', '0', '6', '4-2', '1,', '1.5', '1-6', '1-2-3', 'oops'])
    assert.deepEqual(resolveSignPages({mode:'custom',range},1,5),[],range);
  assert.deepEqual(resolveSignPages({mode:'current',range:''},0,3),[]);
});
test('page replication replaces only its own group and supports reducing to one page', async () => {
  const selected=placement(1), other={...placement(2),id:'unrelated'};
  let serial=0;
  const first=applyPlacementPages([selected,other],selected,[1,2,3],()=>`copy-${++serial}`);
  assert.equal(first.length,4);
  assert.ok(first.includes(other));
  const next=applyPlacementPages(first,first.find(p=>p.id==='p'),[3],()=>`copy-${++serial}`);
  assert.equal(next.length,2);
  assert.deepEqual(next.map(p=>p.page),[2,3]);
  const bytes=await exportVisualPdf(await pdf(3),first);
  const reopened=await PDFDocument.load(bytes);
  for (const p of reopened.getPages()) assert.ok(p.node.Resources().lookup(PDFName.of('XObject')).keys().length);
});
test('numeric placement keeps boxes within the page and optionally preserves proportions', () => {
  const box={x:.7,y:.8,w:.2,h:.1};
  assert.deepEqual(adjustSignBox(box,'x',3,false),{...box,x:.8});
  assert.equal(adjustSignBox(box,'y',-2,false).y,0);
  const scaled=adjustSignBox(box,'w',.6,true);
  assert.ok(Math.abs(scaled.w/scaled.h - 2)<1e-10);
  assert.ok(scaled.x+scaled.w<=1 && scaled.y+scaled.h<=1);
  assert.equal(adjustSignBox(box,'h',.5,false).w,box.w);
  assert.deepEqual(adjustSignBox(box,'w',NaN,true),box);
});
test('an unsigned empty signature field does not lock visual signing', async () => {
  const doc=await PDFDocument.create();doc.addPage([595,842]);
  const field=doc.context.register(doc.context.obj({FT:PDFName.of('Sig'),T:PDFString.of('Unsigned')}));
  doc.catalog.set(PDFName.of('AcroForm'),doc.context.obj({Fields:[field]}));
  const bytes=await doc.save();assert.equal((await inspectVisualPdf(bytes)).signed,false);
  assert.equal((await PDFDocument.load(await exportVisualPdf(bytes,[placement()]))).getPageCount(),1);
});
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
test("global signatures and profiles survive new store instances, edits and deletion", () => {
  const store = new SignStore(path.join(temp, "store"));
  store.signature({ id: "one", name: "A", png, width: 20, height: 10 });
  store.signature({ id: "two", name: "B", png, width: 20, height: 10 });
  const profile = {
    id: "profile",
    name: "Academic",
    signer: "Test",
    reason: "Review",
    location: "Madrid",
    text: "Research",
    font: "sans",
    fontSize: 12,
    showDate: true,
    showCertificate: true,
    signatureId: "one",
  };
  store.profile(profile);
  const reopened = new SignStore(store.dir);
  assert.equal(reopened.read().signatures.length, 2);
  assert.deepEqual(reopened.read().profiles, [profile]);
  store.signature({ id: "one", name: "Renamed", png, width: 40, height: 10 });
  assert.equal(
    reopened.read().signatures.find((s) => s.id === "one").name,
    "Renamed",
  );
  store.remove("signatures", "one");
  assert.equal(reopened.read().profiles[0].signatureId, null);
  assert.throws(() => store.remove("history", "../../file"));
  assert.throws(() =>
    store.signature({
      id: "bad",
      name: "Bad",
      png: "data:image/svg+xml,<script/>",
      width: 1,
      height: 1,
    }),
  );
});
test("single and multi-page exports embed images, preserve original bytes and reopen", async () => {
  for (const count of [1, 3]) {
    const original = await pdf(count);
    const before = Buffer.from(original);
    const placements = [
      placement(1),
      { ...placement(count), id: "p2", x: 0.1, angle: 30 },
    ];
    const output = await exportVisualPdf(original, placements);
    assert.deepEqual(Buffer.from(original), before);
    const reopened = await PDFDocument.load(output);
    assert.equal(reopened.getPageCount(), count);
    for (const n of new Set([1, count]))
      assert.ok(
        reopened
          .getPage(n - 1)
          .node.Resources()
          .lookup(PDFName.of("XObject"))
          .keys().length > 0,
      );
  }
});
test("rotated/cropped pages export; invalid placements and signed or restricted PDFs are rejected", async () => {
  const original = await pdf(2, 90);
  assert.equal(
    (
      await PDFDocument.load(await exportVisualPdf(original, [placement(2)]))
    ).getPageCount(),
    2,
  );
  await assert.rejects(() =>
    exportVisualPdf(original, [{ ...placement(), x: 2 }]),
  );
  const doc = await PDFDocument.load(original);
  doc.catalog.set(
    PDFName.of("Perms"),
    doc.context.obj({
      DocMDP: doc.context.obj({
        Type: PDFName.of("Sig"),
        ByteRange: [0, 10, 20, 30],
      }),
    }),
  );
  const bytes = await doc.save();
  assert.equal((await inspectVisualPdf(bytes)).signed, true);
  await assert.rejects(
    () => exportVisualPdf(bytes, [placement()]),
    /SIGN_VISUAL_LOCKED/,
  );
});
test("history deduplicates identical bytes and only removes its own copies", async () => {
  const bytes = await pdf();
  const original = path.join(temp, "original.pdf");
  fs.writeFileSync(original, bytes);
  const store = new SignStore(path.join(temp, "history"));
  const a = store.add(bytes, "copy.pdf", "visual");
  const b = store.add(bytes, "duplicate.pdf", "visual");
  assert.equal(a.id, b.id);
  assert.deepEqual(Buffer.from(store.document(a.id).bytes), Buffer.from(bytes));
  store.remove("history", a.id);
  assert.deepEqual(fs.readFileSync(original), Buffer.from(bytes));
  assert.throws(() => store.document(a.id));
});
const python = process.env.NODUS_SIGN_PYTHON;
const cryptoOptions = {
  skip: !python ? "Set NODUS_SIGN_PYTHON to run real crypto tests" : false,
};
const engine = python
  ? new SignEngine(python, path.resolve("electron/assets/sign/engine.py"))
  : null;
function fixtureCertificates() {
  execFileSync(python, [
    "-c",
    `
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from datetime import datetime, timedelta, timezone
import pathlib,sys
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Nodus TEST ONLY')])
now=datetime.now(timezone.utc)
for file, end in [('test.p12',now+timedelta(days=7)),('expired.p12',now-timedelta(days=1))]:
 cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=10)).not_valid_after(end).add_extension(x509.KeyUsage(True,True,False,False,False,False,False,False,False),True).sign(key,hashes.SHA256())
 pathlib.Path(sys.argv[1],file).write_bytes(pkcs12.serialize_key_and_certificates(b'test',key,cert,None,serialization.BestAvailableEncryption(b'test-only')))
`,
    temp,
  ]);
}
const appearance = {
  name: "Test",
  signer: "Nodus TEST ONLY",
  reason: "Verification",
  location: "Local",
  text: "Test only",
  font: "sans",
  fontSize: 12,
};
test(
  "real PKCS#12 inspection handles wrong, missing and expired certificates",
  cryptoOptions,
  async () => {
    fixtureCertificates();
    const cert = await engine.run({
      op: "certificate",
      certificate: path.join(temp, "test.p12"),
      password: "test-only",
    });
    assert.equal(cert.usable, true);
    assert.match(cert.subject, /TEST ONLY/);
    await assert.rejects(
      () =>
        engine.run({
          op: "certificate",
          certificate: path.join(temp, "test.p12"),
          password: "wrong",
        }),
      /CERTIFICATE_PASSWORD_OR_FORMAT/,
    );
    assert.equal(
      (
        await engine.run({
          op: "certificate",
          certificate: path.join(temp, "expired.p12"),
          password: "test-only",
        })
      ).usable,
      false,
    );
    await assert.rejects(() =>
      engine.run({
        op: "certificate",
        certificate: path.join(temp, "missing.p12"),
        password: "",
      }),
    );
  },
);
test(
  "real PAdES B-B signs incrementally, validates and preserves a previous signature",
  cryptoOptions,
  async () => {
    const original = await pdf(3);
    let bytes = Buffer.from(original);
    for (let i = 0; i < 2; i++) {
      const result = await engine.run({
        op: "sign",
        pdf: bytes.toString("base64"),
        certificate: path.join(temp, "test.p12"),
        password: "test-only",
        appearance,
        appearancePng: png,
        page: i + 1,
        box: [50, 70, 400, 170],
      });
      const next = Buffer.from(result.pdf, "base64");
      assert.deepEqual(next.subarray(0, bytes.length), bytes);
      assert.equal(result.inspection.signatures.length, i + 1);
      for (const sig of result.inspection.signatures) {
        assert.equal(sig.intact, true);
        assert.equal(sig.valid, true);
        assert.equal(sig.trusted, false);
      }
      bytes = next;
    }
    signedBytes = bytes;
    assert.match(bytes.toString("latin1"), /ETSI.CAdES.detached/);
    await assert.rejects(
      () => exportVisualPdf(bytes, [placement()]),
      /SIGN_VISUAL_LOCKED/,
    );
  },
);
test('multi-page real signatures preserve an earlier signature and reject invalid page selections', cryptoOptions, async () => {
  const original=Buffer.from(signedBytes);
  const req={op:'sign',pdf:original.toString('base64'),certificate:path.join(temp,'test.p12'),password:'test-only',appearance,appearancePng:png,page:1,box:[50,70,400,170]};
  const result=await engine.run({...req,widgets:[{page:1,box:[20,20,180,70]},{page:3,box:[80,100,420,200]}]});
  const bytes=Buffer.from(result.pdf,'base64');
  assert.deepEqual(bytes.subarray(0,original.length),original);
  assert.equal(result.inspection.signatures.length,4);
  assert.ok(result.inspection.signatures.every(s=>s.valid && s.intact));
  for(const widgets of [[],[{page:4,box:req.box}],[{page:1,box:req.box},{page:1,box:req.box}]])
    await assert.rejects(()=>engine.run({...req,widgets}),/INVALID_SIGNATURE_PAGE/);
  await assert.rejects(()=>engine.run({...req,widgets:[{page:1,box:[20,20,10,10]}]}),/INVALID_SIGNATURE_BOX/);
});
test(
  "tampering and expired signing are rejected, no output presented as valid",
  cryptoOptions,
  async () => {
    const tampered = Buffer.from(signedBytes);
    const at = tampered.indexOf(Buffer.from("NodusSign_"));
    tampered[at + 10] = 90;
    const checked = await engine.run({
      op: "inspect",
      pdf: tampered.toString("base64"),
    });
    assert.ok(checked.signatures.some((s) => !s.intact || !s.valid));
    await assert.rejects(
      () =>
        engine.run({
          op: "sign",
          pdf: tampered.toString("base64"),
          certificate: path.join(temp, "test.p12"),
          password: "test-only",
          appearance,
          appearancePng: png,
          page: 1,
          box: [50, 70, 400, 170],
        }),
      /EXISTING_SIGNATURE_INVALID/,
    );
    await assert.rejects(
      async () =>
        engine.run({
          op: "sign",
          pdf: Buffer.from(await pdf()).toString("base64"),
          certificate: path.join(temp, "expired.p12"),
          password: "test-only",
          appearance,
          appearancePng: png,
          page: 1,
          box: [50, 70, 400, 170],
        }),
      /CERTIFICATE_EXPIRED_OR_NOT_USABLE/,
    );
  },
);
test(
  "engine cancellation interrupts the subprocess",
  cryptoOptions,
  async () => {
    const script = path.join(temp, "slow.py");
    fs.writeFileSync(script, "import time\ntime.sleep(60)");
    const slow = new SignEngine(python, script);
    const pending = slow.run({ op: "status" });
    slow.cancel();
    await assert.rejects(() => pending, /SIGN_CANCELLED/);
  },
);

test('signature review distinguishes intact bytes from partial coverage and later incompatible changes', () => {
  const valid = { intact: true, valid: true, trusted: false, coverage: 'ENTIRE_FILE', modification: 'NONE' };
  assert.equal(signatureReview(valid).warning, false);
  assert.equal(signatureReview({...valid, coverage:'ENTIRE_REVISION', modification:'FORM_FILLING'}).warning, false);
  for (const patch of [{coverage:'CONTIGUOUS_BLOCK_FROM_START'}, {modification:'OTHER'}, {modification:'ANNOTATIONS'}, {intact:false}, {valid:false}]) assert.equal(signatureReview({...valid,...patch}).warning,true);
  assert.notEqual(signatureReview(valid).coverage,signatureReview({...valid,coverage:'ENTIRE_REVISION'}).coverage);
});
