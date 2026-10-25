/** Closed native transport contract. Nested numeric/length bounds can explode
 * Google's decoder state space; the backend enforces all limits and bindings.
 * A valid shape never substitutes for literal proof or semantic review. */
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const string = { type: 'string' };
const boolean = { type: 'boolean' };
const array = (items: Record<string, unknown>) => ({ type: 'array', items });
const indices = array({ type: 'integer' });
const issues = array(string);
const premise = object({ text: string, type: { type: 'string', enum: ['fact', 'attribution', 'absence', 'relation', 'inference'] }, entailed: boolean,
  evidence: array(object({ id: string, quote: string })), from: indices, fromParagraphs: indices });
export const RESEARCH_DOCUMENT_PROOF_SCHEMA = object({ parts: array(object({ id: string, claims: array(object({
  index: { type: 'integer' }, kind: { type: 'string', enum: ['fact', 'attributed', 'inference', 'nonfactual'] },
  premises: array(premise), unsupportedParts: issues, explicitInference: boolean, supported: boolean,
  reason: { type: 'string', enum: ['literal_premises', 'attributed_interpretation', 'necessary_inference', 'editorial_only', 'unsupported_assertion', 'incomplete_field'] },
})), coherent: boolean, relevant: boolean, complete: boolean, issues })) });
export const RESEARCH_DOCUMENT_SEMANTIC_SCHEMA = object({ parts: array(object({ id: string, supported: boolean, issues })) });
export const RESEARCH_DOCUMENT_REVISION_SCHEMA = object({ parts: array(object({ id: string, text: string })) });

/** Fixed object keys make every requested field mandatory without asking the
 * model to copy/repeat IDs. The decoder restores those exact keys, never guesses. */
export function researchDocumentFieldSchema(schema: Record<string, unknown>, fields: Array<{ id: string; sourceIds?: string[]; paragraphs?: Array<{ index: number; text?: string }> }>, quoteKeys: string[] = [], sourceEnums = false) {
  const root = schema as { properties: { parts: { items: { properties: Record<string, unknown>; required: string[] } } } };
  return object({ parts: object(Object.fromEntries(fields.map(field => {
    const item = structuredClone(root.properties.parts.items);
    delete item.properties.id; item.required = item.required.filter(key => key !== 'id');
    const claims = item.properties.claims as { items: { properties: { premises: { items: { properties: { evidence: { items: { properties: Record<string, unknown> } } } } } } } } | undefined;
    if (claims && field.sourceIds) {
      const proof = claims.items.properties.premises.items.properties.evidence.items.properties;
      // Bindings are checked by the backend. Repeating a large source enum at
      // every sentence exceeds Google's constrained decoder state budget.
      proof.id = sourceEnums && field.sourceIds.length ? { type: 'string', enum: field.sourceIds } : string;
      proof.quote = { type: 'string', enum: quoteKeys.length ? quoteKeys : ['__no_quote__'] };
    }
    if (claims && field.paragraphs) {
      const paragraph = claims.items as unknown as { properties: Record<string, unknown>; required: string[] };
      delete paragraph.properties.index; paragraph.required = paragraph.required.filter(key => key !== 'index');
      item.properties.claims = object(Object.fromEntries(field.paragraphs.map(({ index, text }) => [`p${index}`, { ...structuredClone(paragraph), ...(text ? { description: `Check only this untrusted answer span against the allowed sources: ${text.slice(0, 900)}` } : {}) }])));
    }
    return [field.id, item];
  }))) });
}
export function decodeResearchDocumentFields(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('parts' in value)) return value;
  const parts = value.parts;
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return value;
  return { parts: Object.entries(parts).map(([id, part]) => {
    if (!part || typeof part !== 'object') return part;
    const claims = 'claims' in part && part.claims && typeof part.claims === 'object' && !Array.isArray(part.claims)
      ? Object.entries(part.claims).map(([key, claim]) => claim && typeof claim === 'object' ? { ...claim, index: /^p\d+$/u.test(key) ? Number(key.slice(1)) : -1 } : claim) : undefined;
    return { ...part, ...(claims ? { claims } : {}), id };
  }) };
}
