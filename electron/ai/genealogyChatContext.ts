// The family-history context a genealogy-mode chat reasons over. Where the academic
// assistant assembles ideas/themes/gaps/authors, this assembles the records ontology:
// the people and their kinship, the life events, the evidence archive (retrieved by
// meaning + by name), the cited evidence, and the AI's open kinship suggestions. It is
// bounded so the payload stays well within a model window, and it is grounded — every
// document carries its text and every claim its evidence — so the model can answer
// about the family without inventing anyone.

import { listPersons, listEvents, listEvidenceFor } from '../db/entitiesRepo';
import { allRelationships } from '../db/relationshipsRepo';
import { listItems, listItemsForPerson, findArchiveItemsSimilar } from '../db/archiveRepo';
import { listOpenSuggestions } from '../db/kinshipSuggestionsRepo';
import { allSocialRelations } from '../db/socialRepo';
import { getSettings } from '../db/settingsRepo';
import { embedQuery } from './aiClient';
import { nameTokens } from '@shared/archiveDiscovery';
import { deriveTreeKinship, treeKinshipLabel, type TreeKinshipContext } from '@shared/treeKinship';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import type { PromptLanguage } from '@shared/types';

const MAX_PERSONS = 250;
const MAX_EVENTS = 220;
const MAX_DOCUMENTS = 14;
const MAX_SUGGESTIONS = 40;
const MAX_EVIDENCE = 40;
const DOC_SNIPPET = 700;

function snippet(text: string | null | undefined, max = DOC_SNIPPET): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export interface GenealogyChatContext {
  resumen: { personas: number; eventos: number; documentos: number; relaciones_sociales: number; parentescos_sugeridos: number };
  persona_central: { id: string; nombre: string } | null;
  personas: unknown[];
  eventos: unknown[];
  relaciones_sociales: unknown[];
  documentos: unknown[];
  evidencia: unknown[];
  parentescos_sugeridos: unknown[];
}

/** Assemble the bounded family context relevant to a chat question. */
export async function buildGenealogyContext(question: string, language: PromptLanguage = getSettings().promptLanguage ?? 'es'): Promise<GenealogyChatContext> {
  const persons = listPersons();
  const nameById = new Map(persons.map((p) => [p.personId, p.displayName]));
  const relationships = allRelationships();
  const savedFocusId = getSettings().treeFocusPersonId;
  const focusPerson = persons.find((person) => person.personId === savedFocusId) ?? persons[0] ?? null;
  const kinship: Map<string, TreeKinshipContext> = focusPerson ? deriveTreeKinship({
    focusId: focusPerson.personId,
    persons: persons.map((person) => ({ id: person.personId, sex: person.sex })),
    parentEdges: relationships.filter((relationship) => relationship.type === 'parent').map((relationship) => ({ parent: relationship.fromPerson, child: relationship.toPerson })),
    spouseEdges: relationships.filter((relationship) => relationship.type === 'spouse').map((relationship) => ({ a: relationship.fromPerson, b: relationship.toPerson })),
    siblingEdges: relationships.filter((relationship) => relationship.type === 'sibling').map((relationship) => ({ a: relationship.fromPerson, b: relationship.toPerson })),
  }) : new Map<string, TreeKinshipContext>();

  // Kin maps from a single relationships pass (avoids a kinOf query per person).
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string | undefined) => {
    if (!v) return;
    (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  };
  for (const r of relationships) {
    if (r.type === 'parent') {
      push(children, r.fromPerson, nameById.get(r.toPerson));
      push(parents, r.toPerson, nameById.get(r.fromPerson));
    } else if (r.type === 'spouse') {
      push(spouses, r.fromPerson, nameById.get(r.toPerson));
      push(spouses, r.toPerson, nameById.get(r.fromPerson));
    }
  }

  // Persons whose name is mentioned in the question — these get their evidence too.
  const qTokens = new Set(nameTokens(question));
  const relevant = persons.filter((p) => {
    const variants = [p.displayName, ...p.names.map((n) => n.name)];
    return variants.some((v) => nameTokens(v).some((t) => qTokens.has(t)));
  });
  const relevantIds = new Set(relevant.map((p) => p.personId));

  const personas = persons.slice(0, MAX_PERSONS).map((p) => {
    const relative = kinship.get(p.personId);
    return {
      id: p.personId,
      nombre: p.displayName,
      sexo: p.sex,
      nacimiento: p.birthDate,
      defuncion: p.deathDate,
      variantes: p.names.map((n) => n.name).filter((n) => n !== p.displayName),
      padres: parents.get(p.personId) ?? [],
      conyuges: spouses.get(p.personId) ?? [],
      hijos: children.get(p.personId) ?? [],
      parentesco_tag: relative?.role,
      parentesco_con_persona_central: relative ? treeKinshipLabel(relative, normalizeUiLanguage(language)) : undefined,
      rama_de_la_persona_central: relative?.branch,
      relevante_para_la_consulta: relevantIds.has(p.personId) || undefined,
    };
  });

  const eventos = listEvents()
    .slice(0, MAX_EVENTS)
    .map((e) => ({
      tipo: e.type,
      fecha: e.date,
      lugar: e.placeName,
      etiqueta: e.label,
      participantes: e.participants.map((pt) => ({ nombre: pt.displayName ?? nameById.get(pt.personId), rol: pt.role })),
    }));

  // Evidence for the persons the question is about (verbatim quotes + source kind).
  const evidencia: unknown[] = [];
  for (const p of relevant) {
    for (const ev of listEvidenceFor('person', p.personId)) {
      if (!ev.quote) continue;
      evidencia.push({ persona: p.displayName, cita: ev.quote, localizacion: ev.location, fuente: ev.sourceKind });
      if (evidencia.length >= MAX_EVIDENCE) break;
    }
    if (evidencia.length >= MAX_EVIDENCE) break;
  }

  // Documents: the ones about the mentioned people, plus semantically-nearest ones.
  const docIds = new Set<string>();
  const documentos: unknown[] = [];
  const addDoc = (item: { itemId: string; title: string; docType: string | null; extractedText: string | null; description: string | null; linkedPersons: { displayName: string }[] }) => {
    if (docIds.has(item.itemId) || documentos.length >= MAX_DOCUMENTS) return;
    docIds.add(item.itemId);
    documentos.push({
      titulo: item.title,
      tipo: item.docType,
      personas: item.linkedPersons.map((lp) => lp.displayName),
      texto: snippet(item.extractedText ?? item.description),
    });
  };
  for (const p of relevant) for (const item of listItemsForPerson(p.personId)) addDoc(item);
  const qVec = question.trim() ? await embedQuery(question.trim()) : null;
  if (qVec) for (const item of await findArchiveItemsSimilar(qVec, { limit: MAX_DOCUMENTS, minSimilarity: 0.25 })) addDoc(item);
  // Backfill with recent documents so an empty question still has material.
  if (documentos.length < 6) for (const item of listItems({}).slice(0, MAX_DOCUMENTS)) addDoc(item);

  const parentescos_sugeridos = listOpenSuggestions()
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => ({
      tipo: s.type,
      de: s.fromName,
      a: s.toName,
      fuerza: s.strength,
      evidencia: s.evidence.filter((ev) => ev.quote).map((ev) => ({ cita: ev.quote, localizacion: ev.location, señal: ev.signal })),
    }));

  const relaciones_sociales = allSocialRelations().slice(0, 200).map((relation) => ({
    persona: relation.personName,
    contacto: relation.targetName,
    tipo_contacto: relation.targetKind,
    relacion: relation.role,
    notas: snippet(relation.notes, 400),
  }));

  return {
    resumen: {
      personas: persons.length,
      eventos: eventos.length,
      documentos: documentos.length,
      relaciones_sociales: relaciones_sociales.length,
      parentescos_sugeridos: parentescos_sugeridos.length,
    },
    persona_central: focusPerson ? { id: focusPerson.personId, nombre: focusPerson.displayName } : null,
    personas,
    eventos,
    relaciones_sociales,
    documentos,
    evidencia,
    parentescos_sugeridos,
  };
}
