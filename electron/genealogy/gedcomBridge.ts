// Bridge between the neutral GEDCOM form (shared/gedcom.ts) and Nodus entities +
// kinship. Import creates persons, relationships and birth/death/marriage events;
// export derives GEDCOM families from the parent/spouse relationships.

import {
  createPerson,
  listPersons,
  findOrCreatePlace,
  createEvent,
  listEvents,
} from '../db/entitiesRepo';
import { addRelationship, allRelationships } from '../db/relationshipsRepo';
import { parseGedcom, serializeGedcom, type GedcomData, type GedcomFamily } from '@shared/gedcom';
import type { HistoricalEvent, Person, PersonSex, Relationship } from '@shared/types';

export interface GedcomImportResult {
  persons: number;
  relationships: number;
  events: number;
}

function sexFromGedcom(sex: 'M' | 'F' | null): PersonSex {
  return sex === 'M' ? 'male' : sex === 'F' ? 'female' : 'unknown';
}

function sexToGedcom(sex: PersonSex): 'M' | 'F' | null {
  return sex === 'male' ? 'M' : sex === 'female' ? 'F' : null;
}

/** Import a GEDCOM document, creating persons, kinship and events. */
export function importGedcom(text: string): GedcomImportResult {
  const data = parseGedcom(text);
  const idByXref = new Map<string, string>();
  let events = 0;
  let relationships = 0;

  for (const gp of data.persons) {
    const person = createPerson({
      displayName: gp.name,
      sex: sexFromGedcom(gp.sex),
      birthDate: gp.birthDate,
      deathDate: gp.deathDate,
      names: [{ name: gp.name, kind: null }],
    });
    idByXref.set(gp.xref, person.personId);

    if (gp.birthDate || gp.birthPlace) {
      createEvent({
        type: 'birth',
        date: gp.birthDate,
        placeId: gp.birthPlace ? findOrCreatePlace(gp.birthPlace).placeId : null,
        participants: [{ personId: person.personId, role: 'principal' }],
      });
      events++;
    }
    if (gp.deathDate || gp.deathPlace) {
      createEvent({
        type: 'death',
        date: gp.deathDate,
        placeId: gp.deathPlace ? findOrCreatePlace(gp.deathPlace).placeId : null,
        participants: [{ personId: person.personId, role: 'principal' }],
      });
      events++;
    }
  }

  for (const fam of data.families) {
    const husband = fam.husband ? idByXref.get(fam.husband) : undefined;
    const wife = fam.wife ? idByXref.get(fam.wife) : undefined;
    if (husband && wife) {
      addRelationship(husband, wife, 'spouse', 'user_asserted');
      relationships++;
    }
    const adopted = new Set(fam.adoptedChildren ?? []);
    for (const childXref of fam.children) {
      const child = idByXref.get(childXref);
      if (!child) continue;
      const subtype = adopted.has(childXref) ? 'adoptive' : null;
      if (husband) {
        addRelationship(husband, child, 'parent', 'user_asserted', subtype);
        relationships++;
      }
      if (wife) {
        addRelationship(wife, child, 'parent', 'user_asserted', subtype);
        relationships++;
      }
    }
    if ((fam.marriageDate || fam.marriagePlace) && (husband || wife)) {
      createEvent({
        type: 'marriage',
        date: fam.marriageDate,
        placeId: fam.marriagePlace ? findOrCreatePlace(fam.marriagePlace).placeId : null,
        participants: [husband, wife]
          .filter((x): x is string => Boolean(x))
          .map((personId) => ({ personId, role: 'spouse' as const })),
      });
      events++;
    }
  }

  return { persons: data.persons.length, relationships, events };
}

/** Build the GEDCOM neutral form from the current vault's persons + kinship. */
export function buildGedcomData(): GedcomData {
  const persons = listPersons();
  const relationships = allRelationships();
  const events = listEvents();
  return toGedcomData(persons, relationships, events);
}

export function exportGedcom(): string {
  return serializeGedcom(buildGedcomData());
}

/** Pure mapping (exported for testing) from Nodus records to the GEDCOM neutral form. */
export function toGedcomData(persons: Person[], relationships: Relationship[], events: HistoricalEvent[]): GedcomData {
  const xrefByPerson = new Map<string, string>();
  persons.forEach((p, i) => xrefByPerson.set(p.personId, `@I${i + 1}@`));

  const firstEvent = (type: string, personId: string): HistoricalEvent | undefined =>
    events.find((e) => e.type === type && e.participants.some((pt) => pt.personId === personId));

  const gedPersons = persons.map((p) => {
    const nameParts = splitName(p.displayName);
    const birth = firstEvent('birth', p.personId);
    const death = firstEvent('death', p.personId);
    return {
      xref: xrefByPerson.get(p.personId)!,
      name: p.displayName,
      given: nameParts.given,
      surname: nameParts.surname,
      sex: sexToGedcom(p.sex),
      birthDate: p.birthDate ?? birth?.date ?? null,
      birthPlace: birth?.placeName ?? null,
      deathDate: p.deathDate ?? death?.date ?? null,
      deathPlace: death?.placeName ?? null,
    };
  });

  // Parent edges → group children by their parent set; spouse pairs → couples.
  const parentsOf = new Map<string, string[]>();
  const spousePairs = new Set<string>();
  // A child whose link to a parent is adoptive; carried to GEDCOM as FAMC/PEDI so an
  // adoption isn't silently exported as a birth.
  const adoptedChildren = new Set<string>();
  for (const r of relationships) {
    if (r.type === 'parent') {
      const list = parentsOf.get(r.toPerson) ?? [];
      list.push(r.fromPerson);
      parentsOf.set(r.toPerson, list);
      if (r.subtype === 'adoptive') adoptedChildren.add(r.toPerson);
    } else if (r.type === 'spouse') {
      spousePairs.add(pairKey(r.fromPerson, r.toPerson));
    }
  }

  const families: GedcomFamily[] = [];
  const representedPairs = new Set<string>();
  const byParentSet = new Map<string, { parents: string[]; children: string[] }>();
  for (const [child, parents] of parentsOf) {
    const key = [...parents].sort().join('|');
    const group = byParentSet.get(key) ?? { parents: [...parents].sort(), children: [] };
    group.children.push(child);
    byParentSet.set(key, group);
  }

  let famIndex = 1;
  const marriageBetween = (a?: string, b?: string): HistoricalEvent | undefined =>
    a && b
      ? events.find(
          (e) =>
            e.type === 'marriage' &&
            e.participants.some((p) => p.personId === a) &&
            e.participants.some((p) => p.personId === b)
        )
      : undefined;

  for (const group of byParentSet.values()) {
    const [husband, wife] = assignCouple(group.parents, persons);
    if (husband && wife) representedPairs.add(pairKey(husband, wife));
    const marr = marriageBetween(husband, wife);
    families.push({
      xref: `@F${famIndex++}@`,
      husband: husband ? xrefByPerson.get(husband)! : null,
      wife: wife ? xrefByPerson.get(wife)! : null,
      children: group.children.map((c) => xrefByPerson.get(c)!).filter(Boolean),
      adoptedChildren: group.children.filter((c) => adoptedChildren.has(c)).map((c) => xrefByPerson.get(c)!).filter(Boolean),
      marriageDate: marr?.date ?? null,
      marriagePlace: marr?.placeName ?? null,
    });
  }

  // Childless couples still form a family so the marriage isn't lost.
  for (const pair of spousePairs) {
    if (representedPairs.has(pair)) continue;
    const [a, b] = pair.split('|');
    const [husband, wife] = assignCouple([a, b], persons);
    const marr = marriageBetween(husband, wife);
    families.push({
      xref: `@F${famIndex++}@`,
      husband: husband ? xrefByPerson.get(husband)! : null,
      wife: wife ? xrefByPerson.get(wife)! : null,
      children: [],
      marriageDate: marr?.date ?? null,
      marriagePlace: marr?.placeName ?? null,
    });
  }

  return { persons: gedPersons, families };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Order a (≤2) parent set into [husband, wife] by sex, male first. */
function assignCouple(parents: string[], persons: Person[]): [string | undefined, string | undefined] {
  const sexOf = (id: string) => persons.find((p) => p.personId === id)?.sex ?? 'unknown';
  const male = parents.find((p) => sexOf(p) === 'male');
  const female = parents.find((p) => sexOf(p) === 'female');
  if (male) return [male, female ?? parents.find((p) => p !== male)];
  // No male parent: the female takes WIFE and the other parent (female or of unknown sex)
  // still takes HUSB. Leaving HUSB empty dropped that parent from the export entirely.
  if (female) return [parents.find((p) => p !== female), female];
  return [parents[0], parents[1]];
}

function splitName(name: string): { given: string | null; surname: string | null } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { given: name.trim() || null, surname: null };
  return { given: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}
