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
