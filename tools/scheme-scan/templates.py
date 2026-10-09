#!/usr/bin/env python3
"""Retro templates from textbook schemes, for the textbook index's retro-templates.tsv.zst.

  templates.py export [--reagents]  reactions to map -> <scan db dir>/templates/to-map.jsonl; --reagents adds the
                                 reagent structures the conditions text names (reagents.py), so additions
                                 whose atoms come from a reagent get templates too
  <rxnmapper python> templates.py map      atom-map them (RXNMapper; checkpointed in mapped.jsonl)
  templates.py extract           RDChiral retro templates -> templates/templates.json (read by build_index.py)

  --strict (merge, extract; or SCHEME_TEMPLATES_STRICT=1): a mapping with a mechanism flag — a bond at
  an unactivated carbon, an undeclared 1,2-shift or skeletal reorganisation, stereocentres from achiral
  inputs — gives no template either. By default those flags are advisory (reported by audit) and only
  an invalid atom map is excluded. A template is its atom map: in a large, text-mined source, a flagged
  map is more often a mapping or transcription error than an unnamed rearrangement, and the template
  it gives proposes that error as a disconnection. A scheme whose conditions name the rearrangement or
  radical step is not flagged, so it keeps its template either way.

Sources: generic records (R, Ar, X... drawn as [*]) and verified real reactions (confirmed, repaired).
A generic scheme is mapped as a model reaction with every R as CH3. After extraction, every template
atom that came from an R (found by aligning the generic structure onto the mapped one) becomes [*],
so the template does not demand a methyl where the book drew R. Each template keeps the records it
came from (book, page, reagents) for citation.

RXNMapper needs its own environment (torch, transformers): tools/.venv-rxnmapper. The other stages
run in the reaction-index environment (RDKit, RDChiral).
"""
import contextlib, hashlib, io, json, os, re, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# Appended, not inserted: this tool's own directory must win, and build_index.py exists in both.
sys.path.append(os.path.join(HERE, '..', 'reaction-index'))
DB = os.environ.get('SCHEME_SCAN_DB') or os.path.expanduser('~/Library/Application Support/Nodus/chemistry-schemes/scan.sqlite')
# A side work directory (SCHEME_TEMPLATES_WORK) builds an alternative template set without touching
# the one the index was built from.
WORK = os.environ.get('SCHEME_TEMPLATES_WORK') or os.path.join(os.path.dirname(DB), 'templates')
TO_MAP, MAPPED, OUT = (os.path.join(WORK, n) for n in ('to-map.jsonl', 'mapped.jsonl', 'templates.json'))
MAX_TOKENS = 500         # RXNMapper's encoder takes 512 tokens; a reaction over it loses reagents first
MAX_ATOMS = 220          # a backstop before tokenising
MIN_CONFIDENCE = 0.5     # atom maps below this are left out
# --strict: mechanism flags exclude a template too (see the module docstring). The flag set itself
# lives in reaction_audit, beside the checks that raise them.
STRICT = os.environ.get('SCHEME_TEMPLATES_STRICT') == '1'


def input_hash(row):
    """A record ID is provenance, not a cache key: structures and conditions can change."""
    return hashlib.sha256(json.dumps(row, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def load_rows(path):
    # Last checkpoint wins, so remapping a record never counts it twice.
    with open(path) as fh:
        return {row['id']: row for line in fh if line.strip() for row in [json.loads(line)]}


def current_maps(path, rows):
    return {rid: m for rid, m in load_rows(path).items()
            if rid in rows and m.get('inputHash') == input_hash(rows[rid])}


def write_rows(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=os.path.dirname(path), delete=False) as fh:
        tmp = fh.name
        try:
            for row in rows:
                fh.write(json.dumps(row) + '\n')
            fh.close()
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)


def invalidate_derived():
    for path in (MERGED, MERGED_ROWS, MERGED_META, AUDIT, OUT):
        if os.path.exists(path):
            os.unlink(path)


def methylated(smiles):
    """The structure with every wildcard as carbon (a model compound), or None."""
    from rdkit import Chem
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    rw = Chem.RWMol(mol)
    for atom in rw.GetAtoms():
        if atom.GetAtomicNum() == 0:
            atom.SetAtomicNum(6); atom.SetIsotope(0); atom.SetFormalCharge(0); atom.SetNoImplicit(False); atom.SetNumExplicitHs(0)
    try:
        Chem.SanitizeMol(rw)
    except Exception:
        return None
    return Chem.MolToSmiles(rw)


# RXNMapper's SMILES tokeniser (the rxnfp pattern), plus its two special tokens.
SMILES_TOKEN = re.compile(r"(\[[^\]]+]|Br?|Cl?|N|O|S|P|F|I|b|c|n|o|s|p|\(|\)|\.|=|#|-|\+|\\|/|:|~|@|\?|>|\*|\$|%[0-9]{2}|[0-9])")


def reaction_tokens(rxn):
    return len(SMILES_TOKEN.findall(rxn)) + 2


def reagent_lookup(rows):
    """Name -> SMILES for every reagent mention the dictionary does not cover, resolved once with
    OPSIN / PubChem and cached in the work directory (never in scan.sqlite)."""
    import sqlite3
    import reagents
    import scan
    cache = sqlite3.connect(os.path.join(WORK, 'reagent-names.sqlite'))
    cache.execute('CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, smiles TEXT, source TEXT)')
    wanted = sorted({t for row in rows if isinstance(row, str) for t in reagents.candidates(row)})
    print(f'{len(wanted)} distinct reagent names to resolve (cached ones are skipped)', flush=True)
    scan.resolve_names(cache, wanted)
    # A name Gemini classified as a solvent, catalyst or word is '' (known, not a reagent); unknown is None.
    known = {n: (smiles if smiles else ('' if (source or '').startswith(('llm', 'gemini')) else None)) for n, smiles, source in cache.execute('SELECT name, smiles, source FROM names')}
    return known.get


def export(with_reagents=False):
    import scan
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog('rdApp.*')
    os.makedirs(WORK, exist_ok=True)
    con = scan.connect()
    rows = con.execute("""SELECT x.item_id, x.n, x.source, x.status, x.reactants, x.products, x.reagents, x.checks, b.title, b.nodus_id, i.page, i.kind
      FROM records x JOIN items i ON i.id = x.item_id JOIN books b ON b.book_key = i.book_key
      WHERE x.status IN ('generic', 'confirmed', 'repaired')""").fetchall()  # 'retro' records are excluded
    if with_reagents:
        import reagents as reagent_text
        lookup = reagent_lookup([row[6] for row in rows])
    seen, out = set(), []
    resolved_rows = 0
    for item_id, n, source, status, reactants, products, reagents, checks, title, nodus_id, page, kind in rows:
        fix = {c['smiles']: c['suggested'] for c in json.loads(checks) if c.get('suggested')}
        sides = []
        for side in (reactants, products):
            smiles = [fix.get(scan.generic_to_wildcard(s), scan.generic_to_wildcard(s)) for s in json.loads(side) if isinstance(s, str) and s.strip()]
            sides.append(smiles)
        r, p = sides
        if not r or not p or any(Chem.MolFromSmiles(s) is None for s in r + p):
            continue
        generic = any('*' in s for s in r + p)
        model_r = [methylated(s) for s in r] if generic else r
        model_p = [methylated(s) for s in p] if generic else p
        if None in model_r or None in model_p:
            continue
        # Reagents go on the reactant side so RXNMapper can map the product atoms they supply (the OH
        # of a hydroboration, the Br of a bromination). Over the encoder's limit, the largest go first.
        extra, unresolved = [], []
        if with_reagents and isinstance(reagents, str):
            found, unresolved = reagent_text.reagent_report(reagents, lookup)
            product_elements = {a.GetAtomicNum() for s in model_p for a in Chem.MolFromSmiles(s).GetAtoms()}
            # Species with no element in the product cannot supply a mapped atom (e.g. BH3
            # in hydroboration-oxidation). Keep their conditions, without lowering the mapper's score.
            extra = sorted((s for s in found if s not in model_r and any(
                a.GetAtomicNum() in product_elements for a in Chem.MolFromSmiles(s).GetAtoms())), key=len)
        base_rxn = f"{'.'.join(model_r)}>>{'.'.join(model_p)}"
        rxn = f"{'.'.join(model_r + extra)}>>{'.'.join(model_p)}"
        atoms = sum(Chem.MolFromSmiles(s).GetNumAtoms() for s in model_r + extra + model_p)
        while extra and (reaction_tokens(rxn) > MAX_TOKENS or atoms > MAX_ATOMS):
            atoms -= Chem.MolFromSmiles(extra[-1]).GetNumAtoms()
            extra.pop()
            rxn = f"{'.'.join(model_r + extra)}>>{'.'.join(model_p)}"
        if atoms > MAX_ATOMS or reaction_tokens(rxn) > MAX_TOKENS or rxn in seen:
            continue
        seen.add(rxn)
        resolved_rows += bool(extra)
        out.append({'id': f'{item_id}:{n}:{source}', 'rxn': rxn, 'baseReaction': base_rxn, 'generic': generic, 'genericReactants': r if generic else None,
                    'genericProducts': p if generic else None, 'book': title, 'nodusId': nodus_id, 'page': page, 'kind': kind,
                    'reagents': reagents if isinstance(reagents, str) else None, 'reagentSmiles': extra,
                    'unresolvedReagents': unresolved, 'status': status})
    if not os.path.exists(TO_MAP) or list(load_rows(TO_MAP).values()) != out:
        invalidate_derived()
        write_rows(TO_MAP, out)
    print(f'{len(out)} distinct reactions to map ({sum(r["generic"] for r in out)} generic, {resolved_rows} with reagent structures) -> {TO_MAP}')


def map_reactions(batch=32):
    """Checkpoint by input content. Legacy checkpoints are remapped once; failed maps are retried."""
    from rxnmapper import RXNMapper
    rows = load_rows(TO_MAP)
    done = {}
    if os.path.exists(MAPPED):
        done = {rid: m for rid, m in current_maps(MAPPED, rows).items() if m.get('mapped')}
    todo = [r for rid, r in rows.items() if rid not in done]
    if not todo:
        print('mapping up to date'); return
    invalidate_derived()
    mapper = RXNMapper()
    with open(MAPPED, 'a') as fh:
        for start in range(0, len(todo), batch):
            chunk = todo[start:start + batch]
            try:
                results = mapper.get_attention_guided_atom_maps([r['rxn'] for r in chunk])
            except Exception:
                results = []
                for r in chunk:  # one bad reaction should not lose the batch
                    try:
                        results.append(mapper.get_attention_guided_atom_maps([r['rxn']])[0])
                    except Exception as error:
                        results.append({'mapped_rxn': None, 'confidence': 0, 'error': str(error)[:200]})
            for r, res in zip(chunk, results):
                fh.write(json.dumps({'id': r['id'], 'inputHash': input_hash(r), 'mapped': res.get('mapped_rxn'), 'confidence': res.get('confidence', 0)}) + '\n')
            fh.flush()
            if (start // batch) % 20 == 0:
                print(f'mapped {len(done) + start + len(chunk)}/{len(done) + len(todo)}', flush=True)
    print('mapping done')


def r_map_numbers(generic_side, mapped_side):
    """Map numbers of the atoms that stand for R in a generic side, by aligning each generic structure
    (wildcards as 'any atom') onto the mapped model structures."""
    from rdkit import Chem
    params = Chem.AdjustQueryParameters(); params.makeDummiesQueries = True
    mapped = [Chem.MolFromSmiles(s) for s in mapped_side.split('.')]
    numbers, used = set(), set()
    for s in generic_side:
        query = Chem.AdjustQueryProperties(Chem.MolFromSmiles(s), params)
        for k, mol in enumerate(mapped):
            if k in used or mol is None or mol.GetNumAtoms() != query.GetNumAtoms():
                continue
            match = mol.GetSubstructMatch(query)
            if match:
                used.add(k)
                for q_idx, m_idx in enumerate(match):
                    if query.GetAtomWithIdx(q_idx).GetAtomicNum() == 0:
                        numbers.add(mol.GetAtomWithIdx(m_idx).GetAtomMapNum())
                break
    return numbers  # 0 in it: an R atom the mapper left unmapped, i.e. one that leaves


def changed_atoms(reactants, products):
    """Map numbers of atoms whose bonded partners, bond orders, charge or H count differ between the
    sides of a mapped reaction (the reaction centre), plus mapped atoms present on one side only."""
    from rdkit import Chem

    def env(side):
        out = {}
        for frag in side.split('.'):
            mol = Chem.MolFromSmiles(frag)
            if mol is None:
                continue
            for atom in mol.GetAtoms():
                n = atom.GetAtomMapNum()
                if n:
                    bonds = frozenset((b.GetOtherAtom(atom).GetAtomMapNum() or -b.GetOtherAtom(atom).GetAtomicNum(), b.GetBondTypeAsDouble())
                                      for b in atom.GetBonds())
                    out[n] = (bonds, atom.GetFormalCharge(), atom.GetTotalNumHs())
        return out

    left, right = env(reactants), env(products)
    return {n for n in set(left) | set(right) if left.get(n) != right.get(n)}


ATOM = re.compile(r'\[[^\]]*?:(\d+)\]')

AUDIT = os.path.join(WORK, 'audit.json')
# merge(): one mapping per reaction from a reagent run and a reagent-free fallback run.
MERGED, MERGED_ROWS = os.path.join(WORK, 'merged.jsonl'), os.path.join(WORK, 'merged-to-map.jsonl')
MERGED_META = os.path.join(WORK, 'merged-inputs.json')
# A map in which reagent atoms reach the product is kept down to this confidence: the extra molecules
# lower RXNMapper's score even when the map is right. Source atoms and template round trips are checked.
REAGENT_MIN_CONFIDENCE = 0.3


def mapping_inputs():
    """Use a merge only while its input and output files still match its committed manifest."""
    try:
        with open(MERGED_META) as fh:
            meta = json.load(fh)
        paths = [TO_MAP, MAPPED, MERGED, MERGED_ROWS]
        if (meta.get('version') == 1 and all(os.path.abspath(p) in meta['files'] for p in paths)
                and all(file_hash(p) == digest for p, digest in meta['files'].items())):
            return MERGED, MERGED_ROWS
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return MAPPED, TO_MAP


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def same_record(left, right):
    """Fallback geometry and citation metadata must describe the current scanned record."""
    added_fields = {'rxn', 'reagentSmiles', 'unresolvedReagents'}
    return ({k: v for k, v in left.items() if k not in added_fields}
            == {k: v for k, v in right.items() if k not in added_fields})


def reagent_atoms_used(mapped, reagent_smiles):
    """Whether any product atom maps onto a reagent molecule (one added from the conditions text)."""
    from rdkit import Chem
    reactants, _, products = mapped.partition('>>')
    reagents = set()
    for smiles in reagent_smiles or []:
        mol = Chem.MolFromSmiles(smiles)
        if mol is not None:
            for fragment in Chem.GetMolFrags(mol, asMols=True):
                for atom in fragment.GetAtoms():
                    atom.SetAtomMapNum(0)
                reagents.add(Chem.MolToSmiles(fragment))
    product_maps = {int(x) for x in re.findall(r':(\d+)\]', products)}
    for fragment in reactants.split('.'):
        mol = Chem.MolFromSmiles(fragment)
        if mol is None:
            continue
        maps = {a.GetAtomMapNum() for a in mol.GetAtoms() if a.GetAtomMapNum()}
        for a in mol.GetAtoms():
            a.SetAtomMapNum(0)
        if Chem.MolToSmiles(mol) in reagents and maps & product_maps:
            return True
    return False


def merge(fallback):
    """Choose one mapping per reaction: the reagent run's where its reagents put atoms into the product
    (kept down to REAGENT_MIN_CONFIDENCE), otherwise the reagent-free run's (`fallback` work directory)
    — a reagent that contributes nothing only lowers the mapper's confidence."""
    from collections import Counter
    from rdkit import RDLogger
    RDLogger.DisableLog('rdApp.*')
    old_rows_path, old_maps_path = (os.path.join(fallback, n) for n in ('to-map.jsonl', 'mapped.jsonl'))
    if os.path.abspath(fallback) == os.path.abspath(WORK):
        raise ValueError('fallback must be a separate reagent-free work directory')
    new_rows, old_rows = load_rows(TO_MAP), load_rows(old_rows_path)
    new_maps, old_maps = current_maps(MAPPED, new_rows), current_maps(old_maps_path, old_rows)
    tally = Counter()
    chosen_maps, chosen_rows = [], []
    for rid in sorted(new_rows):
        new, old = new_maps.get(rid), old_maps.get(rid)
        if old and not same_record(old_rows[rid], new_rows[rid]):
            old = None  # the scan changed, so this is no longer a fallback for the same reaction
        used = bool(new and new.get('mapped') and reagent_atoms_used(new['mapped'], new_rows[rid].get('reagentSmiles')))
        candidates = [(new, new_rows[rid], 'reagents used')] if used else []
        if old:
            candidates.append((old, old_rows[rid], 'reagent-free'))
        if new and not used:
            candidates.append((new, new_rows[rid], 'reagent run, reagents unused'))
        for mapping, row, how in candidates:
            smarts, reason = checked_template(mapping, row)
            if not smarts:
                tally[reason] += 1; continue
            chosen_maps.append({**mapping, 'minConfidence': confidence_floor(mapping, row)})
            chosen_rows.append(row)
            tally[how] += 1
            break
        else:
            tally['no usable mapping'] += 1
    invalidate_derived()
    write_rows(MERGED, chosen_maps)
    write_rows(MERGED_ROWS, chosen_rows)
    paths = [TO_MAP, MAPPED, old_rows_path, old_maps_path, MERGED, MERGED_ROWS]
    with open(MERGED_META, 'w') as fh:
        json.dump({'version': 1, 'files': {os.path.abspath(p): file_hash(p) for p in paths}}, fh)
    print(dict(tally), '->', MERGED)
from reaction_audit import MECHANISM_FLAGS, audit_reaction  # noqa: E402  (shared with build_index)


def audit_record(mapping, row):
    ignore = frozenset()
    if row['generic']:
        r, _, p = mapping['mapped'].partition('>>')
        ignore = frozenset(r_map_numbers(row['genericProducts'], p) | r_map_numbers(row['genericReactants'], r)) - {0}
    return audit_reaction(mapping['mapped'], row.get('reagents'), ignore)


def confidence_floor(mapping, row):
    return (REAGENT_MIN_CONFIDENCE if mapping.get('mapped')
            and reagent_atoms_used(mapping['mapped'], row.get('reagentSmiles')) else MIN_CONFIDENCE)


def checked_template(mapping, row):
    """Fresh validation shared by merge and extract; audit files are reports, never caches."""
    from rdkit import Chem
    import types
    from rdchiral import template_extractor as extractor
    from template_validation import normalize_template, round_trip
    if not mapping or not mapping.get('mapped'):
        return None, 'missing mapping'
    if mapping['confidence'] < confidence_floor(mapping, row):
        return None, 'low confidence'
    hard, soft, _ = audit_record(mapping, row)
    if hard:
        return None, 'audit excluded'
    if STRICT and MECHANISM_FLAGS.intersection(soft):
        return None, 'mechanism flag (strict)'
    reactants, _, products = mapping['mapped'].partition('>>')
    # RDChiral 1.1.0 renumbers maps during canonicalization. Preserve the source map
    # numbers until R atoms have become wildcards, using a local function namespace;
    # do not change RDChiral's module globals (other callers may extract concurrently).
    extract = extractor.extract_from_reaction
    if row['generic']:
        def keep_maps(transform):
            return '>>'.join(extractor.canonicalize_template(side) for side in transform.split('>>'))
        extract = types.FunctionType(extract.__code__, dict(extract.__globals__, canonicalize_transform=keep_maps))
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            result = extract({'_id': mapping['id'], 'reactants': reactants,
                              'products': products, 'reagents': ''})
        smarts = (result or {}).get('reaction_smarts')
    except Exception:
        smarts = None
    if not smarts:
        return None, 'no template'
    if row['generic']:
        numbers = r_map_numbers(row['genericProducts'], products) | r_map_numbers(row['genericReactants'], reactants)
        if 0 in numbers or numbers & changed_atoms(reactants, products):
            return None, 'R in reaction centre'
        smarts = ATOM.sub(lambda a: f'[*:{a.group(1)}]' if int(a.group(1)) in numbers else a.group(0), smarts)
        smarts = extractor.reassign_atom_mapping(smarts)
    try:
        smarts = normalize_template(smarts)
    except Exception:
        return None, 'no template'
    if not round_trip(smarts, mapping['mapped']):
        return None, 'round trip failed'
    return smarts, None


def audit():
    """Check every mapped reaction before it becomes a template: unresolved reagents, product atoms
    from no listed species, a bond at an unactivated carbon, an undeclared 1,2-shift or skeletal
    reorganisation, stereocentres drawn from achiral inputs. Writes audit.json and
    audit.tsv for review. Extraction always validates its current inputs afresh."""
    from collections import Counter
    from rdkit import RDLogger
    RDLogger.DisableLog('rdApp.*')
    mapped_path, rows_path = mapping_inputs()
    source = load_rows(rows_path)
    results, tally = {}, Counter()
    for m in current_maps(mapped_path, source).values():
        row = source.get(m['id'])
        if not row or not m.get('mapped') or m['confidence'] < confidence_floor(m, row):
            continue
        hard, soft, details = audit_record(m, row)
        if row.get('unresolvedReagents'):
            soft.append('unresolved reagents'); details['unresolved'] = row['unresolvedReagents']
        results[m['id']] = {'hard': hard, 'soft': soft, **details}
        tally['checked'] += 1
        tally.update(hard + soft)
        tally['clean'] += not hard and not soft
    with open(AUDIT, 'w') as fh:
        json.dump(results, fh)
    with open(os.path.join(WORK, 'audit.tsv'), 'w') as fh:
        fh.write('id\tbook\tpage\thard\tsoft\tdetails\tconditions\n')
        for rid, res in results.items():
            if res['hard'] or res['soft']:
                row = source[rid]
                extra = {k: v for k, v in res.items() if k not in ('hard', 'soft')}
                fh.write(f"{rid}\t{row.get('book') or ''}\t{row.get('page') or ''}\t{','.join(res['hard'])}\t{','.join(res['soft'])}\t"
                         f"{json.dumps(extra)}\t{(row.get('reagents') or '').replace(chr(10), ' | ')[:160]}\n")
    print(dict(tally), '->', AUDIT)


def extract():
    from rdkit import RDLogger
    RDLogger.DisableLog('rdApp.*')
    mapped_path, rows_path = mapping_inputs()
    source = load_rows(rows_path)
    templates, stats = {}, {'mapped': 0, 'low confidence': 0, 'no template': 0, 'generic': 0, 'real': 0, 'audit excluded': 0}
    for m in current_maps(mapped_path, source).values():
        row = source.get(m['id'])
        if not row or not m.get('mapped'):
            continue
        stats['mapped'] += 1
        smarts, reason = checked_template(m, row)
        if not smarts:
            stats[reason] = stats.get(reason, 0) + 1; continue
        if row['generic']:
            stats['generic'] += 1
        else:
            stats['real'] += 1
        entry = templates.setdefault(smarts, {'count': 0, 'generic': 0, 'sources': []})
        entry['count'] += 1
        entry['generic'] += row['generic']
        if len(entry['sources']) < 5:
            entry['sources'].append({k: row.get(k) for k in ('book', 'nodusId', 'page', 'kind', 'reagents', 'status')} | {'generic': row['generic']})
    with open(OUT, 'w') as fh:
        json.dump(templates, fh)
    print(f'{len(templates)} distinct templates from {stats} -> {OUT}')


if __name__ == '__main__':
    if '--strict' in sys.argv:
        STRICT = True
        sys.argv.remove('--strict')
    if sys.argv[1] == 'export':
        export(with_reagents='--reagents' in sys.argv)
    else:
        if sys.argv[1] == 'merge':
            merge(sys.argv[2])
        else:
            {'map': map_reactions, 'audit': audit, 'extract': extract}[sys.argv[1]]()
