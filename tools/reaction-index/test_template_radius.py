#!/usr/bin/env python3
"""Tests for template_radius: the number a query uses to window a molecule losslessly.

  python3 test_template_radius.py        (from tools/reaction-index, with the build venv)

Getting this wrong is silent: too small a radius and a template stops firing where it should, which
reads as "no disconnection found" rather than as an error. Hence tests on hand-written templates
whose answers are known by inspection, plus the properties the query relies on.
"""
import os
import sys

import build_index as B

FAILED = []


def check(name, got, want):
    ok = got == want
    print(f"  {'ok  ' if ok else 'FAIL'} {name}: got {got!r}" + ("" if ok else f", want {want!r}"))
    if not ok:
        FAILED.append(name)


def radius(smarts):
    return B.template_radius(smarts)[0]


def reason(smarts):
    return B.template_radius(smarts)[1]


print("centre only (every atom changes)")
# an isolated bond broken: both atoms change, nothing else in the pattern
check("two-atom bond break", radius("[C:1]-[O:2]>>[C:1].[O:2]"), 0)

print("\none shell beyond the centre")
# the carbonyl carbon changes; its neighbours are 1 bond away
check("ester to acid, 1 shell", radius("[C:1]-[O;H0:2]-[CH3:3]>>[C:1]-[OH:2].[CH3:3]-[OH]"), 1)

print("\nspectator atoms push the radius out")
# the amide N-C bond breaks; the propyl tail is 3 bonds from the nearest changed atom
check("amide break with a 3-atom tail",
      radius("[CH3:9]-[CH2:8]-[CH2:7]-[C:1](=[O:2])-[N:3]>>[CH3:9]-[CH2:8]-[CH2:7]-[C:1](=[O:2])-[OH].[N:3]"), 3)

print("\nrejections — these must NOT be stored")
check("changes nothing at all", radius("[*:1]>>[*:1]"), None)
check("  reason", reason("[*:1]>>[*:1]"), "no-centre")
check("identity with detail", radius("[*:1]-[c:2]>>[*:1]-[c:2]"), None)
# a second component with no changed atom cannot be reached from the centre
check("disconnected spectator component",
      radius("[C:1]-[O:2].[*:5]>>[C:1].[O:2].[*:5]"), None)
check("  reason", reason("[C:1]-[O:2].[*:5]>>[C:1].[O:2].[*:5]"), "unreachable-component")
check("unparsable", radius("not a smarts >> either"), None)

print("\nproperties the query depends on")
# a bond ORDER change counts as a change, even with both atoms otherwise identical
check("bond order change is a centre", radius("[C:1]=[C:2]>>[C:1]-[C:2]"), 0)
# an unmapped neighbour REPLACED by a different one counts as a change, though the count is equal
# on both sides. Radius 1, not 0: the leaving group is part of the pattern, one bond from the centre,
# so a window must contain it for the template to match.
check("unmapped neighbour replaced (Cl -> OH)", radius("[C:1]-[Cl]>>[C:1]-[OH]"), 1)
check("  and the same atom count both sides is not 'no change'",
      reason("[C:1]-[Cl]>>[C:1]-[OH]"), "ok")
# an H-count change on an otherwise identical atom counts
check("H count change is a centre", radius("[CH2:1]-[C:2]>>[CH3:1].[C:2]"), 0)
# radius is measured in the TEMPLATE's graph, and is symmetric in which side is given first
fwd = "[C:1]-[O;H0:2]-[CH3:3]>>[C:1]-[OH:2].[CH3:3]-[OH]"
rev = "[C:1]-[OH:2].[CH3:3]-[OH]>>[C:1]-[O;H0:2]-[CH3:3]"
check("both directions get a radius", (radius(fwd) is not None, radius(rev) is not None), (True, True))

print("\nreal templates from the shipped index (if present)")
# Both locations come from the environment: the index is local data and never ships with this
# repository, and the worker lives in the chemistry plugin's own repository.
#   NODUS_REACTION_INDEX_DIR   a built index directory (the one the app reads)
#   CHEMISTRY_WORKER_DIR       the plugin's python/ directory, holding reactions_worker.py
index_dir = os.environ.get("NODUS_REACTION_INDEX_DIR")
worker_dir = os.environ.get("CHEMISTRY_WORKER_DIR")
try:
    if not index_dir or not worker_dir:
        raise RuntimeError("set NODUS_REACTION_INDEX_DIR and CHEMISTRY_WORKER_DIR to run this part")
    sys.path.insert(0, worker_dir)
    import reactions_worker as W
    rows = W._retro_templates(index_dir)[:2000]
    vals = [B.template_radius(r[2])[0] for r in rows]
    have = [v for v in vals if v is not None]
    check("every sampled template gets a radius", len(have) == len(vals), True)
    check("none is absurdly large (<= 12)", max(have) <= 12, True)
    print(f"       (sampled {len(vals)}: median {sorted(have)[len(have)//2]}, max {max(have)})")
except Exception as exc:
    print(f"  skipped: {type(exc).__name__}: {exc}")

print(f"\n{'FAILURES: ' + ', '.join(FAILED) if FAILED else 'all passed'}")
sys.exit(1 if FAILED else 0)
