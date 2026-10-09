#!/usr/bin/env python3
"""Reagent structures from a scheme's free-text conditions, for atom mapping.

A textbook draws the reagents over the arrow ("30% H2O2, NaOH, 40-50 °C, 4 h"), and the scan stores
that text, not structures. Without the reagents on the reactant side, RXNMapper cannot map product
atoms that come from them — the OH of a hydroboration, the Br of a bromination, the epoxide O of a
peracid oxidation — and RDChiral extracts no template, so those reactions are missing from the
retro templates altogether. This turns the text into SMILES, deterministically: a dictionary of
common reagents and abbreviations, then OPSIN / PubChem (scan.resolve_names, cached in a side
database, never in scan.sqlite). Solvents, bases and catalysts that put no atom in the product are
left out, as are generic labels (R, Ar, X).

  reagent_smiles(text, lookup) -> list of SMILES     (lookup: name -> SMILES or None)
  candidates(text) -> the tokens that need a name lookup
"""
import os
import re
import time

# Reagents whose atoms can end up in a product, by the names textbooks use. Keys are lowercase.
REAGENTS = {
    'h2o2': 'OO', 'hydrogen peroxide': 'OO', 'bh3': 'B', 'bh3·thf': 'B', 'bh3-thf': 'B', 'bh3.thf': 'B',
    'b2h6': 'BB', 'diborane': 'BB', 'borane': 'B', '9-bbn': 'C1CC2CCCC(C1)B2',
    'br2': 'BrBr', 'bromine': 'BrBr', 'cl2': 'ClCl', 'chlorine': 'ClCl', 'i2': 'II', 'iodine': 'II',
    'hbr': 'Br', 'hcl': 'Cl', 'hi': 'I', 'hf': 'F', 'h2o': 'O', 'water': 'O', 'h3o+': 'O', 'h2': '[H][H]',
    'o3': '[O-][O+]=O', 'ozone': '[O-][O+]=O', 'o2': 'O=O',
    'mcpba': 'O=C(OO)c1cccc(Cl)c1', 'm-cpba': 'O=C(OO)c1cccc(Cl)c1', 'mcpba,': 'O=C(OO)c1cccc(Cl)c1',
    'peracetic acid': 'CC(=O)OO', 'ch3co3h': 'CC(=O)OO', 'rco3h': None,
    'nbs': 'O=C1CCC(=O)N1Br', 'ncs': 'O=C1CCC(=O)N1Cl', 'nis': 'O=C1CCC(=O)N1I',
    'oso4': 'O=[Os](=O)(=O)=O', 'kmno4': '[K+].[O-][Mn](=O)(=O)=O', 'naio4': '[Na+].[O-]I(=O)(=O)=O',
    'cro3': 'O=[Cr](=O)=O', 'jones reagent': 'O=[Cr](=O)=O', 'jones': 'O=[Cr](=O)=O',
    'pcc': '[O-][Cr](=O)(=O)Cl.c1cc[nH+]cc1', 'na2cr2o7': '[Na+].[Na+].[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]',
    'k2cr2o7': '[K+].[K+].[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]', 'seo2': 'O=[Se]=O',
    'dess-martin periodinane': 'CC(=O)OI1(OC(C)=O)(OC(C)=O)OC(=O)c2ccccc12', 'dmp': 'CC(=O)OI1(OC(C)=O)(OC(C)=O)OC(=O)c2ccccc12',
    '(cocl)2': 'O=C(Cl)C(=O)Cl', 'oxalyl chloride': 'O=C(Cl)C(=O)Cl',
    'nabh4': '[Na+].[BH4-]', 'lialh4': '[Li+].[AlH4-]', 'lah': '[Li+].[AlH4-]', 'nabh3cn': '[Na+].[BH3-]C#N',
    'dibal': 'CC(C)C[AlH]CC(C)C', 'dibal-h': 'CC(C)C[AlH]CC(C)C', 'dibalh': 'CC(C)C[AlH]CC(C)C',
    'nah': '[Na+].[H-]', 'lda': 'CC(C)[N-]C(C)C.[Li+]', 'n-buli': 'CCCC[Li]', 'buli': 'CCCC[Li]', 'nbuli': 'CCCC[Li]',
    'meli': 'C[Li]', 'mgbr': None, 'kotbu': 'CC(C)(C)[O-].[K+]', 't-buok': 'CC(C)(C)[O-].[K+]', 'tbuok': 'CC(C)(C)[O-].[K+]',
    'naoet': 'CC[O-].[Na+]', 'naome': 'C[O-].[Na+]', 'naoh': '[Na+].[OH-]', 'koh': '[K+].[OH-]', 'lioh': '[Li+].[OH-]',
    'k2co3': '[K+].[K+].[O-]C([O-])=O', 'na2co3': '[Na+].[Na+].[O-]C([O-])=O', 'nahco3': '[Na+].OC([O-])=O',
    'h2so4': 'OS(=O)(=O)O', 'hno3': 'O[N+](=O)[O-]', 'h3po4': 'OP(=O)(O)O',
    'tsoh': 'Cc1ccc(cc1)S(=O)(=O)O', 'p-tsoh': 'Cc1ccc(cc1)S(=O)(=O)O', 'tscl': 'Cc1ccc(cc1)S(=O)(=O)Cl',
    'mscl': 'CS(=O)(=O)Cl', 'tf2o': 'O=S(=O)(OS(=O)(=O)C(F)(F)F)C(F)(F)F',
    'ac2o': 'CC(=O)OC(C)=O', 'acetic anhydride': 'CC(=O)OC(C)=O', 'acCl'.lower(): 'CC(Cl)=O', 'acetyl chloride': 'CC(Cl)=O',
    'acoh': 'CC(O)=O', 'hoac': 'CC(O)=O', 'acetic acid': 'CC(O)=O',
    'socl2': 'O=S(Cl)Cl', 'thionyl chloride': 'O=S(Cl)Cl', 'pbr3': 'BrP(Br)Br', 'pcl3': 'ClP(Cl)Cl', 'pcl5': 'ClP(Cl)(Cl)(Cl)Cl',
    'pocl3': 'ClP(Cl)(Cl)=O', 'nacn': '[Na+].[C-]#N', 'kcn': '[K+].[C-]#N', 'hcn': 'C#N', 'tmscn': 'C[Si](C)(C)C#N',
    'nan3': '[Na+].[N-]=[N+]=[N-]', 'nh3': 'N', 'ammonia': 'N', 'nh2oh': 'NO', 'hydroxylamine': 'NO',
    'n2h4': 'NN', 'hydrazine': 'NN', 'nh2nh2': 'NN', 'nano2': '[Na+].[O-]N=O',
    'mei': 'CI', 'ch3i': 'CI', 'etbr': 'CCBr', 'eti': 'CCI', 'mebr': 'CBr', 'bnbr': 'BrCc1ccccc1', 'bncl': 'ClCc1ccccc1',
    'meoh': 'CO', 'methanol': 'CO', 'etoh': 'CCO', 'ethanol': 'CCO',
    'ch2n2': 'C=[N+]=[N-]', 'diazomethane': 'C=[N+]=[N-]', 'ch2i2': 'ICI',
    'tmscl': 'C[Si](C)(C)Cl', 'tbscl': 'CC(C)(C)[Si](C)(C)Cl', 'tbdmscl': 'CC(C)(C)[Si](C)(C)Cl',
    'boc2o': 'CC(C)(C)OC(=O)OC(=O)OC(C)(C)C', 'dcc': 'C1CCC(CC1)N=C=NC1CCCCC1',
    'pph3': 'c1ccc(cc1)P(c1ccccc1)c1ccccc1', 'ph3p': 'c1ccc(cc1)P(c1ccccc1)c1ccccc1',
    'dead': 'CCOC(=O)N=NC(=O)OCC', 'diad': 'CC(C)OC(=O)N=NC(=O)OC(C)C',
    'hcho': 'C=O', 'ch2o': 'C=O', 'formaldehyde': 'C=O', 'paraformaldehyde': 'C=O', 'co2': 'O=C=O', 'co': '[C-]#[O+]',
    'hg(oac)2': 'CC(=O)O[Hg]OC(C)=O', 'cuo': None, 'cucn': '[Cu]C#N', 'cubr': '[Cu]Br', 'cucl': '[Cu]Cl',
    'cs2': 'S=C=S', 'lawesson\'s reagent': None, 's8': None,
    'mg': '[Mg]', 'li': '[Li]', 'na': '[Na]', 'k': '[K]', 'zn': '[Zn]',
    # Shorthand OPSIN does not read.
    'phsebr': 'Br[Se]c1ccccc1', 'phsecl': 'Cl[Se]c1ccccc1', 'phch=o': 'O=Cc1ccccc1', 'phcho': 'O=Cc1ccccc1',
    'phmgbr': 'Br[Mg]c1ccccc1', 'memgbr': 'C[Mg]Br', 'memgi': 'C[Mg]I', 'etmgbr': 'CC[Mg]Br', 'phli': '[Li]c1ccccc1',
    'me2culi': 'C[Cu-]C.[Li+]', 'bu3snh': 'CCCC[SnH](CCCC)CCCC', 'n-bu3snh': 'CCCC[SnH](CCCC)CCCC',
    'tmsotf': 'C[Si](C)(C)OS(=O)(=O)C(F)(F)F', 'me3sicl': 'C[Si](C)(C)Cl', 'ch3cocl': 'CC(Cl)=O', 'phcocl': 'O=C(Cl)c1ccccc1',
    'ch3co2h': 'CC(O)=O', 'hco2h': 'OC=O', 'formic acid': 'OC=O', 'ch3cho': 'CC=O', 'acetaldehyde': 'CC=O',
    'tfa': 'OC(=O)C(F)(F)F', 'nanh2': '[Na+].[NH2-]', 'ch3oh': 'CO', 't-buoh': 'CC(C)(C)O', 'tbuoh': 'CC(C)(C)O',
    'oh': '[OH-]', 'oh-': '[OH-]', '-oh': '[OH-]', '−oh': '[OH-]', 'hydroxide': '[OH-]', 'na+ -oet': 'CC[O-].[Na+]', 'etona': 'CC[O-].[Na+]',
    'h2o/h+': 'O', 'h3o': 'O', 'lialh4/thf': '[Li+].[AlH4-]', 'naoac': 'CC(=O)[O-].[Na+]', 'koac': 'CC(=O)[O-].[K+]',
    'nai': '[Na+].[I-]', 'kI'.lower(): '[K+].[I-]', 'nabr': '[Na+].[Br-]', 'licl': '[Li+].[Cl-]', 'libr': '[Li+].[Br-]', 'n2': 'N#N',
    'cs2co3': '[Cs+].[Cs+].[O-]C([O-])=O', 'tbaf': 'CCCC[N+](CCCC)(CCCC)CCCC.[F-]', 'lihmds': 'C[Si](C)(C)[N-][Si](C)(C)C.[Li+]',
    'nahmds': 'C[Si](C)(C)[N-][Si](C)(C)C.[Na+]', 'khmds': 'C[Si](C)(C)[N-][Si](C)(C)C.[K+]', 'ch3mgbr': 'C[Mg]Br', 'ch3mgi': 'C[Mg]I',
    'naoch3': 'C[O-].[Na+]', 'naoc2h5': 'CC[O-].[Na+]', 'ch3ona': 'C[O-].[Na+]', 'c2h5ona': 'CC[O-].[Na+]', 'ch3li': 'C[Li]',
    'h2so4 (cat)': 'OS(=O)(=O)O', 'hcl (g)': 'Cl', 'hbr (g)': 'Br', 'hno2': 'ON=O', 'zn(hg)': '[Zn]', 'sn': '[Sn]', 'fe': '[Fe]',
    'c2h5oh': 'CCO', 'me2so4': 'COS(=O)(=O)OC', 'dimethyl sulfate': 'COS(=O)(=O)OC', 'meotf': 'COS(=O)(=O)C(F)(F)F',
    'ch3nco': 'CN=C=O', 'c7h7so2cl': 'Cc1ccc(cc1)S(=O)(=O)Cl', '(ch3)2chch2li': 'CC(C)C[Li]', 'ch3ch2oh': 'CCO',
    'nh4cl': '[NH4+].[Cl-]', 'nh4oac': '[NH4+].CC(=O)[O-]', 'meonh2': 'CON', 'nh2oh·hcl': 'NO.Cl', 'nh2oh.hcl': 'NO.Cl',
}

# Put no atom in the product (or only as a counterion): solvents, bases, catalysts, drying agents.
NON_PARTICIPANTS = {
    'thf', 'et2o', 'ether', 'diethyl ether', 'ch2cl2', 'dcm', 'chcl3', 'ccl4', 'dmf', 'dmso', 'mecn', 'ch3cn',
    'acetonitrile', 'benzene', 'toluene', 'hexane', 'hexanes', 'pentane', 'acetone', 'dioxane', '1,4-dioxane',
    'xylene', 'xylenes', 'dme', 'hmpa', 'nmp', 'ethyl acetate', 'etoac', 'petroleum ether', 'heptane',
    'et3n', 'net3', 'triethylamine', 'dipea', 'i-pr2net', 'ipr2net', 'iPr2NEt'.lower(), 'tmeda', 'n,n-diisopropylethylamine', 'hunig\'s base', 'pyridine', 'py', 'dmap', '2,6-lutidine', 'dbu', 'imidazole',
    'pd/c', 'pd', 'pt', 'pto2', 'ni', 'raney ni', 'raney nickel', 'rh', 'ru', 'pd(pph3)4', 'pd(oac)2', 'lindlar',
    'lindlar catalyst', 'alcl3', 'fecl3', 'febr3', 'bf3', 'bf3·oet2', 'bf3.oet2', 'bf3-oet2', 'zncl2', 'ticl4', 'sncl4',
    'mgso4', 'na2so4', 'molecular sieves', '4 å ms', '4a ms', 'ms', 'celite', 'silica', 'sio2', 'aibn', 'hν', 'hv', 'light',
    'heat', 'δ', 'reflux', 'rt', 'r.t.', 'r.t', 'room temperature', 'ice', 'workup', 'work-up', 'aqueous workup', 'ph',
    # Placeholders and words, not reagents.
    'h+', '[h+]', 'acid', 'base', 'solvent', 'catalyst', 'steps', 'step', 'null', 'none', 'n/a', '[o]', '[h]', 'oxidation',
    'reduction', 'hydrolysis', 'sn1', 'sn2', 'e1', 'e2', 'tea', 'to', 'or', 'fast', 'slow', 'with', 'pyr', 'nadph', 'nadh',
    'pd( )', 'cu', 'cat', 'dark', 'sunlight', 'uv', 'microwave', 'mw', 'sonication', 'n2 atmosphere', 'ar', 'argon', 'cui', 'proline', 'l-proline', 'enzyme', 'pd(pph3)2cl2',
    'pd(oac)2', 'pd(pph3)4', 'pd(dba)2', 'pd2(dba)3', 'cu(oac)2', 'ni(cod)2', 'grubbs', 'grubbs ii', 'grubbs catalyst',
}

_NUMBERING = re.compile(r'^\s*(?:\(?\d+\)|\(?[ivx]+\)|\d+\.|step \d+:?)\s*', re.I)
_DECOR = re.compile(r'\b(?:aq\.?|aqueous|cat\.?|catalytic|excess|dry|conc\.?|concentrated|dilute|dil\.?|anhydrous|'
                    r'sat\.?|saturated|solution|soln\.?|then|followed by|in|with|and|to|or)\b|\((?:aq|cat\.?|excess|s|l|g)\)', re.I)
# An amount, temperature or time: a number not part of a locant ("2,6-lutidine", "1-propanol").
_QUANTITY = re.compile(r'(?<![A-Za-z\d,.)\]])\d+(?:\.\d+)?(?!\.?\d|,\d|-[A-Za-z])\s*(?:%|equiv\.?|eq\.?|mol\s*%|mmol|mol|m|n|g|mg|ml|l|atm|psi|bar|kbar|'
                       r'°\s*c|°|k|h|hr|hrs|min|d|days?)?(?![A-Za-z])', re.I)
_CONDITION = re.compile(r'°|\b(?:rt|r\.t\.|reflux|overnight|heat|ph\s*\d|hν|hv|δ|−?\d+\s*°)\b', re.I)
# Generic groups: R / Ar / Nu / X … standing alone, and R inside a formula (LiNR2, R2BOTf, RCO3H).
_GENERIC = re.compile(r'(?<![A-Za-z])(?:Ar|Nu|X|LG|E\+?|M|Met|PG|cat)(?![a-z])|R(?:\d|′|\'|(?=[A-Z])|\b)')
_CLASS_LABEL = re.compile(r'\(\d+\.\d+\)')


def tokens(text):
    """The reagent mentions in a conditions string, cleaned of amounts, conditions and numbering."""
    if not text or _CLASS_LABEL.search(text):
        return []  # an index label ("Enolate alkylation (1.2)"), not conditions
    text = text.translate(str.maketrans('₀₁₂₃₄₅₆₇₈₉⁺⁻', '0123456789+-'))
    out = []
    # A comma before a digit is a locant ("2,6-lutidine"), not a separator.
    # "/" separates reagents ("Na/NH3", "H2/Pt", "HNO3/H2SO4") except between digits ("1/2").
    # Test whole mentions before splitting slashes or stripping decorations: a slash can
    # be stereochemistry, and a dot can separate the counterions of a literal SMILES.
    parts = []
    for mention in re.split(r',(?!\d)|[;\n]|\bthen\b|\bor\b|\s\+\s', text):
        mention = _NUMBERING.sub('', mention).strip()
        if literal_smiles(mention):
            out.append(mention)
        else:
            parts.extend(re.split(r'(?<!\d)/|/(?!\d)', mention))
    for part in parts:
        part = _NUMBERING.sub('', part)
        part = _QUANTITY.sub(' ', part)
        part = _DECOR.sub(' ', part)
        part = part.replace('⊖', '-').replace('⊕', '+').replace('−', '-')
        if re.fullmatch(r'\s*\[[A-Za-z0-9()]+\]\s*', part) and not re.search(r'[@=#]', part):
            part = part.strip().strip('[]')  # "[H2SO4]" — catalytic amount, not a SMILES atom
        part = re.sub(r'\s+', ' ', part).strip(' .:-–')
        # Trim parentheses only when unbalanced at an end ("(cat.)" leftovers), never inside a formula.
        while part.startswith('(') and part.count('(') > part.count(')'): part = part[1:].strip()
        while part.endswith(')') and part.count(')') > part.count('('): part = part[:-1].strip()
        if not part or len(part) > 60 or len(part) < 2 or not re.search(r'[A-Za-z]', part):
            continue
        if _CONDITION.fullmatch(part) or part.lower() in NON_PARTICIPANTS:
            continue
        out.append(part)
    return out


def candidates(text):
    """Tokens that need a name lookup: not in the dictionary, not non-participants, not generic."""
    return [t for t in tokens(text) if t.lower() not in REAGENTS and not _GENERIC.search(t) and not literal_smiles(t)]


def literal_smiles(token):
    """A conditions string sometimes gives a reagent as SMILES ("C=CC(=O)N"). Accepted only when it
    parses and is unmistakably a structure: three or more heavy atoms, or an explicit bond or ring."""
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog('rdApp.*')
    if ' ' in token or not re.fullmatch(r'[A-Za-z0-9@+\-\[\]()=#$/\\.%]+', token):
        return None
    mol = Chem.MolFromSmiles(token)
    if mol is None or mol.GetNumHeavyAtoms() < 2:
        return None
    return token if mol.GetNumHeavyAtoms() >= 3 or re.search(r'[=#\d]', token) else None


def reagent_report(text, lookup):
    """(SMILES of the reagents a conditions string names, the mentions that did not resolve). Generic
    mentions (R, Ar…) are neither: they name no structure to find."""
    resolved = reagent_smiles(text, lookup)
    # lookup() returns '' for a name already classified as a non-participant (a solvent, a word).
    unresolved = [t for t in tokens(text) if t.lower() not in REAGENTS and not _GENERIC.search(t) and lookup(t) is None and not literal_smiles(t)]
    return resolved, unresolved


def reagent_smiles(text, lookup):
    """SMILES of the reagents a conditions string names. `lookup(name)` returns a resolved SMILES or
    None. Unresolved and generic mentions are skipped: a partial list still maps more atoms."""
    from rdkit import Chem
    seen, out = set(), []
    for token in tokens(text):
        key = token.lower()
        smiles = REAGENTS.get(key) if key in REAGENTS else (None if _GENERIC.search(token) else literal_smiles(token) or lookup(token))
        if not smiles:
            continue
        mol = Chem.MolFromSmiles(smiles)
        if mol is None or mol.GetNumHeavyAtoms() > 40:
            continue
        canonical = Chem.MolToSmiles(mol)
        if canonical not in seen:
            seen.add(canonical)
            out.append(canonical)
    return out


def review(resolve=True):
    """One debugging round: resolve the outstanding names (cached), then write unresolved.tsv —
    every name still unresolved, with how many records it affects and an example of the text it came
    from — and print the coverage. Run, read the top of the file, fix the tokeniser or the
    dictionary, run again."""
    import collections, os, sqlite3
    import scan
    work = work_directory()
    os.makedirs(work, exist_ok=True)
    con = scan.connect()
    texts = [r[0] for r in con.execute("SELECT reagents FROM records WHERE status IN ('generic', 'confirmed', 'repaired')") if isinstance(r[0], str)]
    cache = sqlite3.connect(os.path.join(work, 'reagent-names.sqlite'))
    cache.execute('CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, smiles TEXT, source TEXT)')
    wanted = collections.Counter(t for text in texts for t in candidates(text))
    if resolve:
        scan.resolve_names(cache, sorted(wanted))
    known = {n: (smiles if smiles else ('' if (source or '').startswith(('llm', 'gemini')) else None)) for n, smiles, source in cache.execute('SELECT name, smiles, source FROM names')}
    example = {}
    for text in texts:
        for t in candidates(text):
            example.setdefault(t, text.replace('\n', ' | ')[:120])
    unresolved = [(n, c) for n, c in wanted.most_common() if known.get(n) is None]
    mentions = sum(len(tokens(t)) for t in texts)
    covered = sum(1 for text in texts for t in tokens(text) if t.lower() in REAGENTS or known.get(t) is not None or literal_smiles(t))
    with open(os.path.join(work, 'unresolved.tsv'), 'w') as fh:
        fh.write('records\tname\texample\n')
        for n, c in unresolved:
            fh.write(f'{c}\t{n}\t{example[n]}\n')
    print(f'mentions {mentions} · resolved {covered} ({100 * covered / max(1, mentions):.0f}%) · '
          f'distinct unresolved {len(unresolved)} covering {sum(c for _, c in unresolved)} mentions -> {work}/unresolved.tsv')


LLM_PROMPT = '''Each line below is a reagent mention from the conditions written over a reaction arrow in an
organic chemistry textbook, followed by the conditions text it came from. For each, decide what it is and, for a
specific chemical, give its structure as SMILES (expand abbreviations and condensed formulas, e.g.
"(CH3)2CHCH2Li" -> "CC(C)C[Li]", "C7H7SO2Cl" -> "Cc1ccc(cc1)S(=O)(=O)Cl").
role: "reagent" (a chemical that can put atoms into the product), "solvent", "catalyst" (incl. bases used
catalytically and metal complexes), "generic" (R, Ar, a class such as "base" or "oxidant"), or "other" (a word,
condition, step label, enzyme name, or something you cannot identify).
Give smiles only for role "reagent"; never guess — if unsure, use role "other".
Return a JSON object: {"items": [{"name": <exactly as given>, "role": ..., "smiles": <string or null>}]}.

'''


_FORMULA = re.compile(r'(?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+')


# Group abbreviations as formulas, so "EtF", "BuBr", "Pb(OAc)4" or "PhSeBr" get an exact formula check.
ABBREVIATIONS = {'Me': 'CH3', 'Et': 'C2H5', 'Pr': 'C3H7', 'Bu': 'C4H9', 'Ph': 'C6H5', 'Ac': 'C2H3O', 'Bn': 'C7H7',
                 'Bz': 'C7H5O', 'Ts': 'C7H7SO2', 'Ms': 'CH3SO2', 'Tf': 'CF3SO2', 'Boc': 'C5H9O2', 'Cp': 'C5H5', 'Cy': 'C6H11',
                 'TMS': 'C3H9Si', 'TBS': 'C6H15Si', 'TBDMS': 'C6H15Si', 'TIPS': 'C9H21Si', 'TBDPS': 'C16H19Si', 'Py': 'C5H5N',
                 'BOC': 'C5H9O2', 'Cbz': 'C8H7O2', 'CBZ': 'C8H7O2', 'Fmoc': 'C15H11O2', 'FMOC': 'C15H11O2', 'MOM': 'C2H5O',
                 'THP': 'C5H9O', 'PMB': 'C8H9O', 'SEM': 'C6H15OSi', 'Tr': 'C19H15', 'Trt': 'C19H15'}
_ABBREV = re.compile(r'(?:TBDMS|TBDPS|TIPS|TBS|TMS|FMOC|Fmoc|BOC|Boc|CBZ|Cbz|MOM|THP|PMB|SEM|Trt|Tr|Me|Et|Pr|Bu|Ph|Ac|Bn|Bz|Ts|Ms|Tf|Cp|Cy|Py)(?![a-z])')


def formula_counts(name):
    """Element counts of a condensed formula ("(CH3)2CHCH2Li", "C7H7SO2Cl", "EtF", "Pb(OAc)4"), or None
    when the name is not one. A structure for such a name must match it exactly."""
    from rdkit.Chem import GetPeriodicTable
    if literal_smiles((name or '').strip()):
        return None  # "C1CO1" is a structure, not a formula (a formula would carry its hydrogens)
    text = re.sub(r'^(?:n|i|s|t|sec|tert|iso)-', '', (name or '').strip())
    text = text.replace('·', '').replace(' ', '')
    expanded = _ABBREV.sub(lambda m: f'({ABBREVIATIONS[m.group()]})', text)
    if not _FORMULA.fullmatch(expanded) or len(text) < 2:
        return None
    if expanded == text and not re.search(r'\d', text):
        return None  # no digit and no group abbreviation: an acronym, not a formula
    table = GetPeriodicTable()
    symbols = set(re.findall(r'[A-Z][a-z]?', expanded))
    for symbol in symbols:
        if symbol in ('D', 'T'):
            return None
        try:
            table.GetAtomicNumber(symbol)
        except Exception:
            return None
    def parse(text, i=0):
        counts = {}
        while i < len(text):
            if text[i] == '(':
                inner, i = parse(text, i + 1)
                m = re.match(r'\d*', text[i:]); k = int(m.group() or 1); i += len(m.group())
                for e, n in inner.items(): counts[e] = counts.get(e, 0) + n * k
            elif text[i] == ')':
                return counts, i + 1
            else:
                m = re.match(r'([A-Z][a-z]?)(\d*)', text[i:])
                counts[m.group(1)] = counts.get(m.group(1), 0) + int(m.group(2) or 1); i += len(m.group())
        return counts, i
    return parse(expanded)[0]


def smiles_counts(smiles):
    from rdkit import Chem
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    counts = {}
    for a in mol.GetAtoms(): counts[a.GetSymbol()] = counts.get(a.GetSymbol(), 0) + 1
    return counts


PROVIDERS = {
    # model, price per million tokens (input, output), endpoint style
    'deepseek': ('deepseek-v4-flash', (0.14, 0.28), 'openai', 'https://api.deepseek.com/chat/completions'),
    'anthropic': ('claude-haiku-4-5-20251001', (1.0, 5.0), 'anthropic', 'https://api.anthropic.com/v1/messages'),
    # The tie-break, for names the first two disagree on.
    'sonnet': ('claude-sonnet-5-5', (3.0, 15.0), 'anthropic', 'https://api.anthropic.com/v1/messages'),
    # The last word on what the tie-break still leaves open; counted only when it agrees with another
    # source (decide). Price is rough, for the running spend line only.
    'opus': ('claude-opus-5-5', (5.0, 25.0), 'anthropic', 'https://api.anthropic.com/v1/messages'),
}


def work_directory():
    import scan
    return os.environ.get('SCHEME_TEMPLATES_WORK') or os.path.join(os.path.dirname(scan.DB), 'templates')

METALS_ALL = {'Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Al', 'Ga', 'In', 'Tl', 'Sn', 'Pb', 'Bi', 'Zn',
              'Cd', 'Hg', 'Cu', 'Ag', 'Au', 'Ni', 'Pd', 'Pt', 'Co', 'Rh', 'Ir', 'Fe', 'Ru', 'Os', 'Mn', 'Cr', 'Mo', 'W',
              'V', 'Ti', 'Zr', 'Hf', 'Sc', 'Y', 'La', 'Ce', 'Sm', 'Nd', 'Eu', 'Yb'}
METALS = {'Li', 'Na', 'K', 'Cs', 'Mg', 'Ca', 'Ba', 'Zn', 'Cu', 'Ag', 'Hg', 'Sn', 'Al', 'Pd', 'Ni', 'Fe', 'Co', 'Mn',
          'Cr', 'Ti', 'Ce', 'Sm', 'In', 'Pb', 'Os', 'Ru', 'Rh', 'Pt', 'Au', 'Se', 'Te', 'Bi', 'Sb', 'Tl', 'Zr', 'V', 'Mo', 'W'}
# Words in a name that require an element in its structure ("sodium …", "…bromide").
NAME_ELEMENTS = {'sodium': 'Na', 'potassium': 'K', 'lithium': 'Li', 'magnesium': 'Mg', 'zinc': 'Zn', 'copper': 'Cu',
                 'cupr': 'Cu', 'silver': 'Ag', 'mercur': 'Hg', 'tin': 'Sn', 'stann': 'Sn', 'alumin': 'Al', 'palladium': 'Pd',
                 'bor': 'B', 'brom': 'Br', 'chlor': 'Cl', 'iod': 'I', 'fluor': 'F', 'phosph': 'P', 'silyl': 'Si', 'silan': 'Si',
                 'selen': 'Se', 'cesium': 'Cs', 'caesium': 'Cs', 'titan': 'Ti', 'osm': 'Os', 'chrom': 'Cr', 'mangan': 'Mn'}


def element_counts_loose(name):
    """A formula without digits that names a salt or metal reagent ("NaI", "KCN", "LiCl", "CuCN"): its
    element set, or None. Only when a metal is present, so acronyms (TBS, DMF, NBS) are never read as formulas."""
    if not re.fullmatch(r'(?:[A-Z][a-z]?)+', name or ''):
        return None
    parts = re.findall(r'[A-Z][a-z]?', name)
    from rdkit.Chem import GetPeriodicTable
    table = GetPeriodicTable()
    try:
        if any(p in ('D', 'T') for p in parts) or any(table.GetAtomicNumber(p) <= 0 for p in parts):
            return None
    except Exception:
        return None
    return set(parts) if len(parts) >= 2 and set(parts) & METALS else None


def _proportional(a, b):
    """Whether two element counts differ only by a whole factor (Cu2Cl2 and CuCl)."""
    a, b = {e: n for e, n in a.items() if n}, {e: n for e, n in b.items() if n}
    if not a or not b or set(a) != set(b):
        return False
    big, small = (a, b) if sum(a.values()) >= sum(b.values()) else (b, a)
    factors = {big[e] / small[e] for e in big}
    return len(factors) == 1 and next(iter(factors)).is_integer()


def consistent(name, smiles):
    """Whether a structure can be what the name says: exact element counts for a condensed formula,
    the element set for a metal salt written as symbols, and the element any word in the name demands."""
    have = smiles_counts(smiles)
    exact = formula_counts(name)
    if exact is not None:
        # A name may give a dimer's formula for the monomer drawn (Cu2Cl2 for CuCl): same ratio.
        return exact == have or _proportional(exact, have)
    loose = element_counts_loose(name)
    if loose is not None and loose != {e for e in have if e != 'H'} - set():
        return loose <= set(have) and set(have) - {'H'} <= loose | {'H'}
    lowered = (name or '').lower()
    return all(element in have for word, element in NAME_ELEMENTS.items() if word in lowered)


def connectivity(smiles):
    """A key for "the same compound however it is drawn": bonds to metals cut, charges and bond orders
    ignored, each fragment's heavy-atom graph (element per atom) canonicalised. An ionic and a covalent
    Grignard, a charge-separated and a neutral salt, or two tautomers compare equal; two different
    compounds practically never do."""
    from rdkit import Chem
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    rw = Chem.RWMol(mol)
    for bond in list(rw.GetBonds()):
        if bond.GetBeginAtom().GetSymbol() in METALS_ALL or bond.GetEndAtom().GetSymbol() in METALS_ALL:
            rw.RemoveBond(bond.GetBeginAtomIdx(), bond.GetEndAtomIdx())
    for bond in rw.GetBonds():
        bond.SetBondType(Chem.BondType.SINGLE); bond.SetIsAromatic(False)
    for atom in rw.GetAtoms():
        atom.SetFormalCharge(0); atom.SetNumRadicalElectrons(0); atom.SetIsAromatic(False)
        atom.SetNoImplicit(True); atom.SetNumExplicitHs(0); atom.SetChiralTag(Chem.ChiralType.CHI_UNSPECIFIED)
    graph = rw.GetMol()
    graph.UpdatePropertyCache(False)
    return '.'.join(sorted(Chem.MolToSmiles(graph).split('.')))


def _ask(provider, prompt, keys):
    """One request; returns (reply text, (input tokens, output tokens)) or None after retries."""
    import json, requests
    model, _, style, url = PROVIDERS[provider]
    if style == 'openai':
        body = {'model': model, 'temperature': 0, 'response_format': {'type': 'json_object'}, 'messages': [{'role': 'user', 'content': prompt}]}
        headers = {'Authorization': f'Bearer {keys[provider]}'}
    else:
        body = {'model': model, 'max_tokens': 16000, 'messages': [{'role': 'user', 'content': prompt}]}
        if provider not in ('sonnet', 'opus'):
            body['temperature'] = 0  # the 5.5 models reject temperature ("deprecated for this model")
        headers = {'x-api-key': keys['anthropic'], 'anthropic-version': '2023-06-01'}  # Haiku and Sonnet share the key
    for attempt in range(5):
        try:
            r = requests.post(url, json=body, headers=headers, timeout=600)
        except requests.RequestException:
            time.sleep(10 * (attempt + 1)); continue
        if r.status_code in (429, 500, 502, 503, 504, 529):
            time.sleep(min(120, 15 * 2 ** attempt)); continue
        r.raise_for_status()
        out = r.json()
        if style == 'openai':
            u = out.get('usage', {})
            return out['choices'][0]['message']['content'], (u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
        u = out.get('usage', {})
        return ''.join(b.get('text', '') for b in out.get('content', []) if b.get('type') == 'text'), (u.get('input_tokens', 0), u.get('output_tokens', 0))
    return None


def collect(provider, names, example, cache, batch=80, workers=6, lock=None, cap=None):
    """Ask one provider about every name it has not answered yet, `workers` batches at a time; raw
    answers go to the answers table (one commit per batch, so a stopped run resumes)."""
    import json, threading
    from concurrent.futures import ThreadPoolExecutor, as_completed
    _, price, _, _ = PROVIDERS[provider]
    lock = lock or threading.Lock()
    with lock:
        done = {n for (n,) in cache.execute('SELECT name FROM answers WHERE provider=?', (provider,))}
    todo = [n for n in names if n not in done]
    if not todo or cap is not None and cap <= 0:
        return
    keys_path = os.environ.get('REAGENT_KEYS_FILE') or os.path.expanduser('~/.config/nodus-harness/keys.json')
    with open(keys_path) as fh:
        keys = json.load(fh)
    chunks = [todo[i:i + batch] for i in range(0, len(todo), batch)]
    spent, finished = 0.0, 0

    def ask(chunk):
        return chunk, _ask(provider, LLM_PROMPT + '\n'.join(f'{n}\t{example.get(n, "")}' for n in chunk), keys)

    # A capped run sends one batch at a time, stopping before another batch once its
    # recorded spend reaches the cap. The final batch can exceed the remaining budget.
    workers = 1 if cap is not None else workers
    with ThreadPoolExecutor(workers) as pool:
        for start in range(0, len(chunks), workers):
            if cap is not None and spent >= cap:
                break
            futures = [pool.submit(ask, c) for c in chunks[start:start + workers]]
            for future in as_completed(futures):
                chunk, reply = future.result()
                spent, finished = save_reply(chunk, reply, cache, lock, provider, price, spent, finished, len(chunks))
    print(f'{provider}: {finished}/{len(chunks)} batches, ${spent:.2f}', flush=True)


def save_reply(chunk, reply, cache, lock, provider, price, spent, finished, total):
    import json
    if reply is None:
        return spent, finished
    text, (tin, tout) = reply
    spent += tin / 1e6 * price[0] + tout / 1e6 * price[1]
    text = re.sub(r'^```(?:json)?\s*|\s*```\s*$', '', text.strip())
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = {}
    entries = parsed.get('items', []) if isinstance(parsed, dict) else parsed if isinstance(parsed, list) else []
    answered = {}
    if not isinstance(entries, list):
        entries = []
    for entry in entries:
        name = entry.get('name') if isinstance(entry, dict) else None
        role = entry.get('role') if isinstance(entry, dict) else None
        if name in chunk and name not in answered and role in ('reagent', 'solvent', 'catalyst', 'generic', 'other'):
            smiles = entry.get('smiles')
            answered[name] = (role, smiles if role == 'reagent' and isinstance(smiles, str) else None)
    with lock:
        for name, (role, smiles) in answered.items():
            cache.execute('INSERT OR REPLACE INTO answers VALUES(?,?,?,?)', (name, provider, role, smiles))
        cache.commit()  # incomplete or malformed replies remain eligible for retry
    finished += 1
    if finished % 10 == 0 or finished == total:
        print(f'  {provider}: {finished}/{total} batches · ${spent:.2f}', flush=True)
    return spent, finished


def decide(cache):
    """The final structure for each name, from every source's answer. Accepted: OPSIN (a systematic name,
    parsed), two sources whose structures share a skeleton, or a single source that passes the formula
    check. A candidate that contradicts its own name (an element it must or must not contain) never
    counts. Two models agreeing it is not a reagent makes it a non-participant. The rest goes to review."""
    import collections
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog('rdApp.*')
    by_name = collections.defaultdict(list)
    for name, provider, role, smiles in cache.execute('SELECT name, provider, role, smiles FROM answers'):
        by_name[name].append((provider, role, smiles))
    tally, review = collections.Counter(), []
    for name, answers in by_name.items():
        ok = []
        for provider, role, smiles in answers:
            mol = Chem.MolFromSmiles(smiles) if smiles else None
            if mol is not None and consistent(name, Chem.MolToSmiles(mol)):
                ok.append((provider, Chem.MolToSmiles(mol)))
        opsin = [s for p, s in ok if p == 'opsin']
        groups = collections.defaultdict(list)
        for provider, smiles in ok:
            groups[connectivity(smiles)].append((provider, smiles))
        agreed = max((g for k, g in groups.items() if k and len({p for p, _ in g}) >= 2), key=len, default=None)
        roles = [role for p, role, _ in answers if p in ('deepseek', 'anthropic', 'sonnet', 'opus')]
        not_reagent = [r for r in roles if r in ('solvent', 'catalyst', 'generic', 'other')]
        if opsin:
            final, how = opsin[0], 'opsin'
        elif agreed:
            # Prefer a model's drawing (covalent organometallics, neutral salts) over PubChem's ionic one.
            final, how = next((s for p, s in agreed if p != 'pubchem'), agreed[0][1]), 'agree:' + '+'.join(sorted({p for p, _ in agreed}))
        elif len(ok) == 1 and formula_counts(name) is not None:
            final, how = ok[0][1], f'formula:{ok[0][0]}'
        elif len(not_reagent) >= 2:
            final, how = None, 'llm:' + collections.Counter(not_reagent).most_common(1)[0][0]
        else:
            final, how = None, 'review'
            review.append((name, answers))
        tally[how.split(':')[0] if not how.startswith('llm') else how] += 1
        cache.execute('INSERT OR REPLACE INTO names VALUES(?,?,?)', (name, final, how))
    cache.commit()
    return tally, review


def crosscheck(provider=None, cap=None):
    """Settle every name OPSIN did not: PubChem's answers and the unresolved ones, asked of DeepSeek and
    Claude Haiku, then decided by agreement (decide). Writes review.tsv for what is left."""
    import collections, sqlite3
    import scan
    work = work_directory()
    os.makedirs(work, exist_ok=True)
    cache = sqlite3.connect(os.path.join(work, 'reagent-names.sqlite'), check_same_thread=False)
    cache.execute('CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, smiles TEXT, source TEXT)')
    cache.execute('CREATE TABLE IF NOT EXISTS answers (name TEXT, provider TEXT, role TEXT, smiles TEXT, PRIMARY KEY (name, provider))')
    for name, smiles, source in cache.execute("SELECT name, smiles, source FROM names WHERE source IN ('opsin', 'pubchem')").fetchall():
        cache.execute('INSERT OR IGNORE INTO answers VALUES(?,?,?,?)', (name, source, 'reagent', smiles))
    texts = [r[0] for r in scan.connect().execute("SELECT reagents FROM records WHERE status IN ('generic', 'confirmed', 'repaired')") if isinstance(r[0], str)]
    count, example = collections.Counter(), {}
    for text in texts:
        for t in candidates(text):
            count[t] += 1
            example.setdefault(t, text.replace('\n', ' | ')[:140])
    opsin = {n for (n,) in cache.execute("SELECT name FROM answers WHERE provider='opsin'")}
    names = [n for n, _ in count.most_common() if n not in opsin]
    print(f'{len(names)} names to cross-check ({len(opsin)} settled by OPSIN)', flush=True)
    import threading
    lock = threading.Lock()
    # DeepSeek answers slowly at peak (minutes per request) but takes many at once.
    workers = {'deepseek': 16, 'anthropic': 6}
    if provider:
        collect(provider, names, example, cache, lock=lock, cap=cap)
    else:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(collect, p, names, example, cache, lock=lock, workers=w) for p, w in workers.items()]
            for future in futures:
                future.result()  # propagate provider failures instead of silently deciding from one reply
    tally, review = decide(cache)
    # Tie-break: what the first two could not settle goes to a stronger model, then is decided again.
    if review and not provider:
        print(f'{len(review)} names unsettled; asking sonnet as the tie-break', flush=True)
        collect('sonnet', [name for name, _ in review], example, cache, lock=lock, workers=4)
        tally, review = decide(cache)
    # What still has no two agreeing sources goes to Opus, counted only where it agrees with one.
    if review:
        print(f'{len(review)} names still unsettled; asking opus', flush=True)
        collect('opus', [name for name, _ in review], example, cache, lock=lock, workers=4)
        tally, review = decide(cache)
    with open(os.path.join(work, 'review.tsv'), 'w') as fh:
        fh.write('records\tname\tanswers\texample\n')
        for name, answers in sorted(review, key=lambda r: -count.get(r[0], 0)):
            fh.write(f"{count.get(name, 0)}\t{name}\t{'; '.join(f'{p}={r}:{s}' for p, r, s in answers)}\t{example.get(name, '')}\n")
    print(f'decided: {dict(tally)} · review list: {len(review)} names -> {work}/review.tsv', flush=True)


def llm_resolve(provider, cap):
    if cap <= 0:
        print('LLM budget is zero; no requests sent'); return
    crosscheck(provider=provider, cap=cap)


if __name__ == '__main__':
    import argparse, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    review_cmd = commands.add_parser('review', help='resolve names with OPSIN/PubChem and report gaps')
    review_cmd.add_argument('--no-resolve', action='store_true')
    commands.add_parser('crosscheck', help='optional paid two-model check, with a tie-break')
    llm_cmd = commands.add_parser('llm', help='optional paid single-provider pass')
    llm_cmd.add_argument('--provider', choices=sorted(PROVIDERS), default='deepseek')
    llm_cmd.add_argument('--cap', type=float, default=2.0,
                         help='stop scheduling batches at this recorded USD spend; the last batch can exceed it')
    args = parser.parse_args()
    if args.command == 'review':
        review(resolve=not args.no_resolve)
    elif args.command == 'crosscheck':
        crosscheck()
    elif args.command == 'llm':
        llm_resolve(args.provider, args.cap)
