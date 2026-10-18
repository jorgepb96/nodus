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
