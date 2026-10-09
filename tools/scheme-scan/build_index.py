#!/usr/bin/env python3
"""Build a known-reactions index from verified textbook scheme records (scan.py), in the same format
as the ORD index (tools/reaction-index/build_index.py), so the Chemistry Studio worker's
known-reactions and propose-disconnections tools read it unchanged.

  build_index.py [--out DIR] [--templates templates.json]     default: <scan db dir>/index

Records used: status confirmed or repaired (a repaired record's SMILES are replaced by the structure
its name and formula agree on). Generic schemes (R groups) and flagged records are left out.
Reaction keys and DRFP fingerprints come from the ORD builder's own functions, so the same reaction
has the same key in both indexes.

Extra file: records.json — "tb-<32 hex>" id -> book, Nodus id, page, box, order on the page,
reagents, yield, status, reaction SMILES. The exact table's sample ids are these ids; the host
cites them as book and page.
"""
import argparse, hashlib, json, os, sys, time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'reaction-index'))
import scan  # noqa: E402
import build_index as ord_builder  # noqa: E402  (same key and fingerprint functions as ORD)

SAMPLE_PER_EXACT = ord_builder.SAMPLE_PER_EXACT
SAMPLE_KEYS_PER_PRODUCT = ord_builder.SAMPLE_KEYS_PER_PRODUCT


def record_id(item_id, n, source):
    return 'tb-' + hashlib.sha1(f'{item_id}:{n}:{source}'.encode()).hexdigest()[:32]


def repaired(smiles_list, checks):
    """The side's structures, each repaired where name and formula agreed on another structure, and
    canonicalized whole (so a salt written inside a structure, C([O-].[K+]), becomes top-level
    fragments before the side is split on dots). None if a structure does not parse."""
    from rdkit import Chem
    fix = {c['smiles']: c['suggested'] for c in checks if c.get('suggested')}
    out = []
    for s in smiles_list:
        if not isinstance(s, str) or not s.strip():
            continue
        s = scan.generic_to_wildcard(s)
        s = fix.get(s, s)
        mol = Chem.MolFromSmiles(s)
        if mol is None:
            return None
        out.append(Chem.MolToSmiles(mol))
    return out


def library_titles(zotero):
    """Zotero item key -> the library's title, read from a copy (Zotero keeps its database locked)."""
    import shutil, sqlite3, tempfile
    if not zotero or not os.path.exists(zotero):
        return {}
    with tempfile.TemporaryDirectory() as tmp:
        copy = os.path.join(tmp, 'zotero.sqlite')
        shutil.copyfile(zotero, copy)
        con = sqlite3.connect(copy)
        rows = con.execute("""SELECT i.key, v.value FROM items i JOIN itemData d ON d.itemID = i.itemID
          JOIN fields f ON f.fieldID = d.fieldID AND f.fieldName = 'title' JOIN itemDataValues v ON v.valueID = d.valueID""").fetchall()
        con.close()
    return dict(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(os.path.dirname(scan.DB), 'index'))
    ap.add_argument('--templates', default=os.path.join(os.path.dirname(scan.DB), 'templates', 'templates.json'),
                    help='templates.json from templates.py extract (a side work directory builds an alternative set)')
    ap.add_argument('--audit', help='per-reaction audit verdicts ({id: {"hard": [flags]}}, e.g. templates.py audit or the '
                    'bond-edit gate): a flagged reaction is cited with its flags (a book records real rearrangements and '
                    'radical steps whose conditions need not say so)')
    ap.add_argument('--audit-exclude', action='store_true', help='leave flagged reactions out of the index instead of tagging them')
    ap.add_argument('--zotero', default=os.path.expanduser('~/Zotero/zotero.sqlite'), help='for full book titles in citations')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    con = scan.connect()
    rows = con.execute("""SELECT x.item_id, x.n, x.source, x.reactants, x.products, x.reagents, x.yield, x.status, x.checks,
        i.page, i.kind, i.x0, i.y0, i.x1, i.y1, i.ordinal, i.ref, b.title, b.nodus_id
      FROM records x JOIN items i ON i.id = x.item_id JOIN books b ON b.book_key = i.book_key
      WHERE x.status IN ('confirmed', 'repaired')""").fetchall()

    audit = json.load(open(args.audit)) if args.audit else None
    full_titles = library_titles(args.zotero)
    exact, exact_samples, reaction_meta, products, records = Counter(), defaultdict(list), {}, {}, {}
    skipped = Counter()
    unaudited, flagged = [0], [0]
    for (item_id, n, source, reactants, products_json, reagents, yld, status, checks, page, kind, x0, y0, x1, y1,
         ordinal, ref, title, nodus_id) in rows:
        checks = json.loads(checks)
        r = repaired(json.loads(reactants), checks)
        p = repaired(json.loads(products_json), checks)
        if r is None or p is None:
            skipped['unparsable structure'] += 1; continue
        if not r or not p:
            skipped['missing side'] += 1; continue
        if any('*' in s for s in r + p):
            skipped['generic structure'] += 1; continue
        if audit is not None:
            verdict = audit.get(f'{item_id}:{n}:{source}')
            if verdict is None:
                unaudited[0] += 1  # kept: neither the gate nor a confident map could read it
            elif verdict.get('hard'):
                if args.audit_exclude:
                    skipped['audit excluded'] += 1; continue
                flagged[0] += 1
        r_key, _ = ord_builder._side_key_atoms('.'.join(r))
        p_key, _ = ord_builder._side_key_atoms('.'.join(p))
        if not r_key or not p_key:
            skipped['unparsable side'] += 1; continue
        if r_key == p_key:
            skipped['no change'] += 1; continue
        key = hashlib.sha1(f'{r_key}>>{p_key}'.encode()).hexdigest()[:32]
        rid = record_id(item_id, n, source)
        exact[key] += 1
        if len(exact_samples[key]) < SAMPLE_PER_EXACT:
            exact_samples[key].append(rid)
        reaction_meta.setdefault(key, [f'{r_key}>>{p_key}', p_key])
        entry = products.setdefault(p_key, {'n': 0, 'k': []})
        entry['n'] += 1
        if key not in entry['k'] and len(entry['k']) < SAMPLE_KEYS_PER_PRODUCT:
            entry['k'].append(key)
        records[rid] = {'key': key, 'book': full_titles.get(nodus_id) or title, 'short': title, 'nodusId': nodus_id, 'page': page, 'kind': kind,
                        'box': [round(v, 1) for v in (x0, y0, x1, y1)], 'order': ordinal, 'image': ref,
                        'reagents': reagents, 'yield': yld, 'status': status, 'reading': source,
                        'reaction': f'{".".join(r)}>>{".".join(p)}'}
        if audit is not None and (audit.get(f'{item_id}:{n}:{source}') or {}).get('hard'):
            records[rid]['audit'] = audit[f'{item_id}:{n}:{source}']['hard']

    import zstandard as zstd
    cctx = zstd.ZstdCompressor(level=14)

    def write_zst(path, text):
        with open(path, 'wb') as fh:
            with cctx.stream_writer(fh) as w:
                w.write(text.encode())

    def write_zst_blocked(path, lines, block=2048):
        index = []
        with open(path, 'wb') as fh:
            for start in range(0, len(lines), block):
                chunk = lines[start:start + block]
                frame = cctx.compress(('\n'.join(chunk) + '\n').encode())
                index.append(f'{chunk[0].split(chr(9), 1)[0]}\t{fh.tell()}\t{len(frame)}')
                fh.write(frame)
        with open(path + '.blocks', 'w') as fh:
            fh.write('\n'.join(index))

    out = lambda name: os.path.join(args.out, name)
    write_zst_blocked(out('exact.tsv.zst'), [f'{k}\t{exact[k]}\t{",".join(exact_samples[k])}' for k in sorted(exact)])
    # Retro templates (templates.py): one row per template, most supported first; their book/page
    # sources go to template-sources.json for citation.
    templates_path = args.templates
    templates = json.load(open(templates_path)) if os.path.exists(templates_path) else {}
    ranked = sorted(templates.items(), key=lambda kv: (-kv[1]['count'], kv[0]))
    write_zst(out('templates.tsv.zst'), '\n'.join(f'{t["count"]}\t{t["count"]}\t0\t\t{smarts}' for smarts, t in ranked))
    write_zst(out('retro-templates.tsv.zst'), '\n'.join(f'{t["count"]}\t{t["count"]}\t{smarts}' for smarts, t in ranked))
    with open(out('template-sources.json'), 'w') as fh:
        json.dump({smarts: {'count': t['count'], 'generic': t['generic'], 'sources': t['sources']} for smarts, t in ranked}, fh)
    write_zst(out('products.tsv.zst'), '\n'.join(f'{k}\t{products[k]["n"]}\t{",".join(products[k]["k"])}' for k in sorted(products)))
    write_zst_blocked(out('reaction-smiles.tsv.zst'), [f'{k}\t{reaction_meta[k][0]}' for k in sorted(reaction_meta)])
    as_reactant, as_product, makes = Counter(), Counter(), defaultdict(list)
    for key, (smiles, _p) in reaction_meta.items():
        weight = exact[key]
        left, _, right = smiles.partition('>>')
        for m in set(filter(None, left.split('.'))):
            as_reactant[m] += weight
        for m in set(filter(None, right.split('.'))):
            as_product[m] += weight
            makes[m].append((weight, key))
    write_zst_blocked(out('molecules.tsv.zst'), [
        f'{m}\t{as_reactant.get(m, 0)}\t{as_product.get(m, 0)}\t'
        f'{",".join(k for _w, k in sorted(makes.get(m, []), key=lambda wk: (-wk[0], wk[1]))[:ord_builder.MOLECULE_SAMPLE_KEYS])}'
        for m in sorted(set(as_reactant) | set(as_product))])

    import numpy as np, faiss
    items = sorted((k, reaction_meta[k][0]) for k in reaction_meta)
    fps = dict(ord_builder.compute_reaction_fps(items))
    empty = bytes(ord_builder.DRFP_BYTES)
    keys = [k for k, _ in items if fps[k] != empty]
    index = faiss.IndexBinaryFlat(ord_builder.DRFP_BITS)
    if keys:
        index.add(np.frombuffer(b''.join(fps[k] for k in keys), dtype=np.uint8).reshape(len(keys), ord_builder.DRFP_BYTES))
    with open(out('reactions.faiss.zst'), 'wb') as fh:
        with cctx.stream_writer(fh) as w:
            w.write(faiss.serialize_index_binary(index))
    write_zst(out('reaction-keys.txt.zst'), '\n'.join(keys))
    with open(out('records.json'), 'w') as fh:
        json.dump(records, fh)

    def digest(path):
        h = hashlib.sha256()
        with open(path, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b''):
                h.update(chunk)
        return h.hexdigest()

    names = ['exact.tsv.zst', 'exact.tsv.zst.blocks', 'templates.tsv.zst', 'retro-templates.tsv.zst', 'products.tsv.zst',
             'reaction-smiles.tsv.zst', 'reaction-smiles.tsv.zst.blocks', 'molecules.tsv.zst', 'molecules.tsv.zst.blocks',
             'reactions.faiss.zst', 'reaction-keys.txt.zst', 'records.json', 'template-sources.json']
    manifest = {
        'format': 'nodus.reaction-index', 'version': 4, 'source': 'nodus.textbook-schemes',
        'licence': 'derived from the user\'s own library; not for redistribution',
        'citation': None, 'idPrefix': 'tb-',
        'fingerprint': {'kind': 'drfp', 'bits': ord_builder.DRFP_BITS, 'space': 'hamming', 'index': 'flat',
                        'vectors': len(keys), 'emptyExcluded': len(items) - len(keys)},
        'records': len(records), 'retroTemplates': len(templates), 'exactKeys': len(exact), 'products': len(products), 'skipped': dict(skipped),
        'audit': ({'applied': True, 'policy': 'exclude' if args.audit_exclude else 'tag', 'flagged': flagged[0],
                   'unaudited': unaudited[0]} if audit is not None else {'applied': False}),
        'books': sorted({r['book'] for r in records.values()}),
        'files': {n: {'bytes': os.path.getsize(out(n)), 'sha256': digest(out(n))} for n in names},
        'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    with open(out('manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print(f'{len(records)} records -> {len(exact)} distinct reactions, {len(products)} products, {len(keys)} fingerprints; skipped {dict(skipped)}')


if __name__ == '__main__':
    main()
