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
  premises: array(premise), unsupportedParts: issues, explicitInference: boolean, supported: boolean, reason: string,
})), coherent: boolean, relevant: boolean, complete: boolean, issues })) });
export const RESEARCH_DOCUMENT_SEMANTIC_SCHEMA = object({ parts: array(object({ id: string, supported: boolean, issues })) });
export const RESEARCH_DOCUMENT_REVISION_SCHEMA = object({ parts: array(object({ id: string, text: string })) });

/** Fixed object keys make every requested field mandatory without asking the
 * model to copy/repeat IDs. The decoder restores those exact keys, never guesses. */
export function researchDocumentFieldSchema(schema: Record<string, unknown>, fields: Array<{ id: string; sourceIds?: string[] }>, quoteKeys: string[] = []) {
  const root = schema as { properties: { parts: { items: { properties: Record<string, unknown>; required: string[] } } } };
  return object({ parts: object(Object.fromEntries(fields.map(field => {
    const item = structuredClone(root.properties.parts.items);
    delete item.properties.id; item.required = item.required.filter(key => key !== 'id');
    const claims = item.properties.claims as { items: { properties: { premises: { items: { properties: { evidence: { items: { properties: Record<string, unknown> } } } } } } } } | undefined;
    if (claims && field.sourceIds) {
      const proof = claims.items.properties.premises.items.properties.evidence.items.properties;
      proof.id = { type: 'string', enum: field.sourceIds.length ? field.sourceIds : ['__no_authorized_source__'] };
      proof.quote = { type: 'string', enum: quoteKeys.length ? quoteKeys : ['__no_quote__'] };
    }
    return [field.id, item];
  }))) });
}
export function decodeResearchDocumentFields(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('parts' in value)) return value;
  const parts = value.parts;
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return value;
  return { parts: Object.entries(parts).map(([id, part]) => part && typeof part === 'object' ? { ...part, id } : part) };
}
