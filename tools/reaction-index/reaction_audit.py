"""Per-reaction audit of an atom-mapped reaction, shared by the textbook template builder
(scheme-scan/templates.py) and the reaction index builder (build_index.py).

Reads the bond edits from the atom maps: a new C–C or C–X bond at a carbon nothing activates, an
undeclared 1,2-shift or skeletal reorganisation, stereocentres drawn from achiral inputs, ambiguous
(duplicated) maps. Hard flags mean the map cannot yield a sound template."""
import re

# A scheme's own label or conditions that explain a skeletal shift or a bond at an unactivated carbon.
DECLARED = re.compile(r'(?i)rearrange|migrat|isomeri[sz]|wagner|meerwein|pinacol|benzilic|favorskii|wolff|cope\b|'
                      r'ring (?:expansion|contraction)|metathesis|radical|photo|h\s*ν|\bhv\b|light|norrish|NBS|AIBN|'
                      r'C[–-]H (?:activation|functionali[sz]ation|insertion|oxidation)|carbene|nitrene|insertion')
# Conditions that can create stereocentres from achiral inputs.
ASYMMETRIC = re.compile(r'(?i)asymmetric|enantio|chiral|\((?:R|S|R,R|S,S)\)|\b(?:CBS|Sharpless|AD-mix|BINAP|DIPT|DET|Evans|'
                        r'auxiliar|enzyme|lipase|proline|Corey|Noyori|Jacobsen|Shi|Ru-BINAP|Rh-DIPAMP|ee\b)')


# Species whose presence among the agents activates a bond the edits would otherwise call
# unactivated: a transition metal catalyst, or a radical initiator. Measured on the USPTO files: 22
# of 156 unactivated C–C/C–X exclusions have one of these in the reaction's own agents field, and
# the DECLARED escape hatch below can never see it because a mined record carries no prose.
ACTIVATING_METALS = frozenset({'Pd', 'Ni', 'Cu', 'Ru', 'Rh', 'Ir', 'Pt', 'Fe', 'Co', 'Mn', 'Cr',
                               'Mo', 'W', 'Ti', 'Zr', 'Au', 'Ag', 'Sm', 'Ce', 'Yb', 'Sc', 'In'})
# The symbol alone conflates a catalyst with a stoichiometric metal OXIDANT, and the oxidation state
# separates them. Measured over 5,559 USPTO reactions carrying agents: Mn appears 24 times and 17 of
# those are manganese dioxide, while Cr(VI) is chromate or dichromate. Neither activates a carbon
# towards a coupling — they take electrons away. A metal at or above the state here is therefore not
# treated as activating.
#
# Iron(III) is deliberately NOT in this table: FeCl3 is a Lewis acid and does activate. Palladate
# and cuprate anions (Pd(-4), Pd(-1), Cu(-1) all occur in the data) are catalysts and stay.
OXIDISING_ABOVE = {'Mn': 4, 'Cr': 5, 'Os': 6, 'Re': 6, 'V': 5, 'W': 6, 'Mo': 6}

# Atoms clearly more electronegative than any transition metal, so a bond to one of them raises the
# metal's oxidation state by the bond order.
_ELECTRONEGATIVE = frozenset({'O', 'N', 'F', 'Cl', 'Br', 'I', 'S', 'Se'})


def oxidation_state(atom):
    """An estimate of a metal atom's oxidation state, which is NOT its formal charge.

    Manganese dioxide is written `O=[Mn]=O` and carries formal charge ZERO; the +4 is in its bonds
    to oxygen. Reading the formal charge alone called it a catalyst. Chromate is the same story, and
    permanganate worse. So the state is the formal charge PLUS the bond orders to atoms more
    electronegative than the metal, which is the standard assignment and gets MnO2 to +4, chromate
    to +6 and permanganate to +7 while leaving PdCl2 at +2."""
    state = atom.GetFormalCharge()
    for bond in atom.GetBonds():
        other = bond.GetOtherAtom(atom)
        if other.GetSymbol() in _ELECTRONEGATIVE:
            state += int(round(bond.GetBondTypeAsDouble()))
    return state


def agent_activates(agents):
    """Whether the agents hold a transition metal, which activates a coupling the maps would
    otherwise read as a bond formed at an unactivated carbon.

    NOT USED BY THE BUILDER, and unproven rather than rejected: 22 of 156 unactivated C–C/C–X
    exclusions have a metal in the agents, but in a 3,546-reaction sample only 3 reactions were
    recovered by excusing them, and all 3 yielded no template at all. Too few to judge either way,
    and it rode along with a repair that failed, so it was reverted with it rather than shipped on
    its own evidence.

    Deliberately narrow: only the metals, and only for the two `unactivated` flags. It is not proof
    the bond formation is real — it is the reason the flag is not EVIDENCE that it is not."""
    from rdkit import Chem

    for part in (agents or '').split('.'):
        if not part:
            continue
        mol = Chem.MolFromSmiles(part)
        if mol is None:
            # Measured at 0 of 5,559 reactions with agents, so this is not a silent hole in
            # practice; it stays a `continue` rather than a guess at what the text meant.
            continue
        for atom in mol.GetAtoms():
            symbol = atom.GetSymbol()
            if symbol not in ACTIVATING_METALS:
                continue
            ceiling = OXIDISING_ABOVE.get(symbol)
            if ceiling is not None and oxidation_state(atom) >= ceiling:
                continue        # an oxidant in a high oxidation state, not an activator
            return True
    return False


def _duplicates(smiles):
    """(mol, {map number: [atom indices]}) for the numbers used more than once, or (None, {})."""
    from rdkit import Chem

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None, {}
    seen = {}
    for atom in mol.GetAtoms():
        if atom.GetAtomMapNum():
            seen.setdefault(atom.GetAtomMapNum(), []).append(atom.GetIdx())
    return mol, {n: idxs for n, idxs in seen.items() if len(idxs) > 1}


def _drop_repeats(smiles):
    """The side with repeated IDENTICAL components removed, and whether any were.

    Sound: two copies of one molecule carrying the same numbers say the same thing, so keeping one
    resolves the ambiguity without choosing anything."""
    from rdkit import Chem

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return smiles, False
    pieces = Chem.GetMolFrags(mol, asMols=True, sanitizeFrags=False)
    kept, bodies, dropped = [], set(), False
    for piece in pieces:
        bare = Chem.Mol(piece)
        for atom in bare.GetAtoms():
            atom.SetAtomMapNum(0)
        try:
            key = Chem.MolToSmiles(bare)
        except Exception:
            kept.append(piece)
            continue
        if key in bodies:
            dropped = True
            continue
        bodies.add(key)
        kept.append(piece)
    if not dropped:
        return smiles, False
    try:
        return '.'.join(Chem.MolToSmiles(p) for p in kept), True
    except Exception:
        return smiles, False


def _renumber_equivalent(smiles):
    """The side with each symmetry-equivalent duplicate given its own number, or None.

    Sound where it applies and nowhere else: two atoms that are interchangeable by an automorphism
    yield the same template under either assignment, so breaking the tie invents nothing. Two
    DISTINGUISHABLE atoms claiming one product atom cannot be settled by renumbering — picking one
    would invent the answer — so this returns None and the reaction stays excluded."""
    from rdkit import Chem

    mol, dupes = _duplicates(smiles)
    if mol is None:
        return None
    if not dupes:
        return smiles
    bare = Chem.Mol(mol)
    for atom in bare.GetAtoms():
        atom.SetAtomMapNum(0)
    try:
        rank = list(Chem.CanonicalRankAtoms(bare, breakTies=False))
    except Exception:
        return None
    component = {i: k for k, g in enumerate(Chem.GetMolFrags(mol)) for i in g}
    for idxs in dupes.values():
        # same symmetry class AND same component: equal ranks across two copies of a molecule mean
        # the repeat should have been dropped, not renumbered
        if len({rank[i] for i in idxs}) != 1 or len({component[i] for i in idxs}) != 1:
            return None
    nxt = max(n for n in dupes) + 1
    used = {a.GetAtomMapNum() for a in mol.GetAtoms() if a.GetAtomMapNum()}
    nxt = max(nxt, max(used) + 1)
    for idxs in dupes.values():
        for idx in idxs[1:]:
            mol.GetAtomWithIdx(idx).SetAtomMapNum(nxt)
            nxt += 1
    try:
        return Chem.MolToSmiles(mol)
    except Exception:
        return None


def repair_duplicate_maps(reactants, products):
    """(reactants, products, what was done) for a map flagged `duplicate atom maps`, or None.

    MEASURED AND REJECTED (2026-10-10). NOT USED BY THE BUILDER. Kept because the measurement is
    worth more than the code, and because the idea is an obvious one to have again.

    It does what it says: of 355 duplicate-flagged USPTO reactions, 13.8% pass the audit after a
    repeated component is dropped and a further 29.0% after symmetry-equivalent duplicates are
    renumbered. Passing the audit turned out to be the wrong test. Extracting the template from the
    repaired map and running it back on its own product:

      reactions clean all along     94.4% of their templates propose a real reactant
      dropped a repeated component  54.5%
      renumbered equivalents         0.0%  — every one of 19 failed inside rdchiral

    Renumbering gives a reactant atom a number the product side does not carry. The audit does not
    object, because it only checks that PRODUCT atoms are mapped, but the extractor needs the
    correspondence and the template it produces is malformed. So this satisfies the check without
    satisfying the extractor, which is the failure it was written to avoid.

    Dropping a repeat is better but still half as sound as an untouched map. If it is ever revived
    it needs the template itself validated — extract, run it on its own product, keep it only if it
    proposes a real reactant — rather than the map trusted because a check went quiet.

    Refuses outright when BOTH sides carry duplicates: renumbering each side independently pairs new
    numbers that need not correspond. 8 of the 355 are in that case."""
    _, r_dupes = _duplicates(reactants)
    _, p_dupes = _duplicates(products)
    if r_dupes and p_dupes:
        return None
    r, dropped_r = _drop_repeats(reactants)
    p, dropped_p = _drop_repeats(products)
    _, r_left = _duplicates(r)
    _, p_left = _duplicates(p)
    if not r_left and not p_left:
        return (r, p, 'dropped a repeated component') if (dropped_r or dropped_p) else None
    r2 = _renumber_equivalent(r) if r_left else r
    p2 = _renumber_equivalent(p) if p_left else p
    if r2 is None or p2 is None:
        return None
    what = 'renumbered symmetry-equivalent duplicates'
    if dropped_r or dropped_p:
        what = 'dropped a repeated component, ' + what
    return r2, p2, what


# Suspicions about the chemistry rather than the mapping. A caller that wants them to exclude a
# reaction intersects them with the soft flags; scheme-scan does so under --strict, and the
# reaction-index builder always does (see _map_audit).
MECHANISM_FLAGS = frozenset({'unactivated C–C', 'unactivated C–X', '1,2-shift',
                             'reorganised skeleton', 'stereo from achiral inputs'})


def audit_reaction(mapped, conditions, ignore=frozenset()):
    """Flags for one atom-mapped reaction, read from its maps (so a scheme that leaves out its
    by-products is still checked). Hard flags identify an invalid atom map, which makes every edit
    read from it meaningless. Mechanism and stereochemical suspicions are soft: whether they also
    exclude a reaction is the caller's policy (MECHANISM_FLAGS), because it depends on the source —
    a text-mined record is more often mis-mapped than genuinely unusual, while a named scheme is
    not. Returns (hard, soft, details)."""
    from rdkit import Chem
    reactants, _, products = mapped.partition('>>')
    rm, pm = Chem.MolFromSmiles(reactants), Chem.MolFromSmiles(products)
    if rm is None or pm is None:
        return ['unparsed'], [], {}
    r_maps = [a.GetAtomMapNum() for a in rm.GetAtoms() if a.GetAtomMapNum()]
    p_maps = [a.GetAtomMapNum() for a in pm.GetAtoms() if a.GetAtomMapNum()]
    if len(set(r_maps)) < len(r_maps) or len(set(p_maps)) < len(p_maps):
        return ['duplicate atom maps'], [], {}  # one number on two atoms: the mapping is ambiguous
    r_atom = {a.GetAtomMapNum(): a for a in rm.GetAtoms() if a.GetAtomMapNum()}
    p_atom = {a.GetAtomMapNum(): a for a in pm.GetAtoms() if a.GetAtomMapNum()}
    # A map number joining two different elements, or a product heavy atom with no reactant atom
    # behind it, means the mapping itself is wrong; nothing read from its edits can be trusted.
    if any(r_atom[n].GetAtomicNum() != a.GetAtomicNum() or r_atom[n].GetIsotope() != a.GetIsotope()
           for n, a in p_atom.items() if n in r_atom):
        return ['element mismatch'], [], {}
    unmapped = sum(1 for a in pm.GetAtoms() if a.GetAtomicNum() > 1
                   and (not a.GetAtomMapNum() or a.GetAtomMapNum() not in r_atom))
    if unmapped:
        return ['unmapped product atoms'], [], {'unmapped': unmapped}
    def edges(mol):
        return {frozenset((b.GetBeginAtom().GetAtomMapNum(), b.GetEndAtom().GetAtomMapNum())) for b in mol.GetBonds()
                if b.GetBeginAtom().GetAtomMapNum() and b.GetEndAtom().GetAtomMapNum()}
    rb, pb = edges(rm), edges(pm)
    # Atoms that stood for R or X in a generic scheme (`ignore`) are model methyls: an edit at one says
    # nothing about the chemistry, and extract already drops an R in the reaction centre.
    formed = [tuple(e) for e in pb - rb if all(m in r_atom for m in e) and not (set(e) & ignore)]
    broken = [tuple(e) for e in rb - pb if all(m in p_atom for m in e) and not (set(e) & ignore)]
    pi = lambda a: a.GetIsAromatic() or any(b.GetBondType() != Chem.BondType.SINGLE for b in a.GetBonds())
    def activated(m):
        a = r_atom[m]
        return (a.GetFormalCharge() != 0 or a.GetNumRadicalElectrons() > 0 or pi(a)
                or any(n.GetAtomicNum() not in (1, 6) for n in a.GetNeighbors())
                or any(n.GetAtomicNum() == 6 and pi(n) for n in a.GetNeighbors()))
    carbon = lambda m: r_atom[m].GetAtomicNum() == 6
    declared = bool(DECLARED.search(conditions or ''))
    hard, soft, details = [], [], {}
    cc_formed = [e for e in formed if carbon(e[0]) and carbon(e[1])]
    cx_formed = [e for e in formed if carbon(e[0]) != carbon(e[1])]
    cc_broken = [e for e in broken if carbon(e[0]) and carbon(e[1])]
    if any(not (activated(a) and activated(b)) for a, b in cc_formed) and not declared:
        soft.append('unactivated C–C')
    if any(not activated(a if carbon(a) else b) for a, b in cx_formed) and not declared:
        soft.append('unactivated C–X')
    r_bonded = lambda a, b: r_atom[a].GetOwningMol().GetBondBetweenAtoms(r_atom[a].GetIdx(), r_atom[b].GetIdx()) is not None
    migration = any(m in f and m in c and r_bonded(next(x for x in f if x != m), next(x for x in c if x != m))
                    for f in cc_formed for c in cc_broken for m in set(f) & set(c))
    if migration and not declared:
        soft.append('1,2-shift')
    if not migration and cc_formed and not declared:
        for a, b in cc_broken:
            path = Chem.GetShortestPath(pm, p_atom[a].GetIdx(), p_atom[b].GetIdx())
            if path:
                soft.append('reorganised skeleton'); break
    centres = lambda mol: [c for c in Chem.FindMolChiralCenters(mol, useLegacyImplementation=False) if c[1] in ('R', 'S')]
    DEFINED_GEOMETRY = (Chem.BondStereo.STEREOE, Chem.BondStereo.STEREOZ,
                        Chem.BondStereo.STEREOCIS, Chem.BondStereo.STEREOTRANS)

    def born_from_geometry(maps):
        """Whether a new stereocentre could have been set by a defined double bond, i.e. one at or
        next to the atom it appears on: a stereospecific addition (epoxidation, dihydroxylation)
        carries the alkene's geometry into the product's configuration.

        Asking only whether the reaction has a defined double bond ANYWHERE excuses a centre that
        has nothing to do with it — a ketone reduction on a substrate that happens to carry an
        unrelated E-alkene — and a large share of mined substrates carry one, so the check would
        almost never fire. STEREOANY is explicitly unknown geometry and sets nothing."""
        for number in maps:
            atom = r_atom.get(number)
            if atom is None:
                continue
            near = [atom, *atom.GetNeighbors()]
            if any(b.GetStereo() in DEFINED_GEOMETRY for a in near for b in a.GetBonds()):
                return True
        return False

    p_centres = centres(pm)
    centre_maps = {pm.GetAtomWithIdx(index).GetAtomMapNum() for index, _ in p_centres}
    was_centre = {rm.GetAtomWithIdx(index).GetAtomMapNum() for index, _ in centres(rm)}
    new_centres = {number for number in centre_maps if number and number not in was_centre}
    if p_centres and not centres(rm) and new_centres and not born_from_geometry(new_centres) \
            and not ASYMMETRIC.search(conditions or ''):
        soft.append('stereo from achiral inputs'); details['stereocentres'] = len(p_centres)
    return hard, soft, details
