import { RESEARCH_ANSWER_TABLE_LIMITS } from './researchAnswerStructure';

/** Native JSON Schema transport is deliberately limited to the two provider contracts
 *  the structured Research Chat path opts into. Other JSON callers retain JSON mode. */
export interface ResearchNativeResponseSchema {
  name: string;
  schema: Record<string, unknown>;
}

export function structuredResponseFormat(
  provider: string,
  schema?: ResearchNativeResponseSchema,
  jsonMode = false,
  supportsJsonObject = false,
): Record<string, unknown> | null {
  if (schema && (provider === 'openai' || provider === 'openrouter')) {
    return { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } };
  }
  if (jsonMode && supportsJsonObject) return { type: 'json_object' };
  return null;
}

/** A required native schema is part of the request contract and can never be dropped
 *  as an optional-field compatibility retry. */
export function mayRetryWithoutStructuredSchema(schema?: ResearchNativeResponseSchema): boolean {
  return schema === undefined;
}

const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });
const stringArray = (minItems: number, maxItems: number, item: Record<string, unknown>) => ({
  type: 'array', minItems, maxItems, items: item,
});

export const RESEARCH_ANSWER_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['facets', 'format', 'formatQuestionQuote'],
  properties: {
    facets: stringArray(1, 6, {
      type: 'object', additionalProperties: false, required: ['questionQuote', 'evidence'],
      properties: {
        questionQuote: string(2, 500),
        evidence: stringArray(0, 6, {
          type: 'object', additionalProperties: false, required: ['sourceId', 'quote'],
          properties: { sourceId: string(1, 512), quote: string(8, 1000) },
        }),
      },
    }),
    format: { type: 'string', enum: ['prose', 'table'] },
    formatQuestionQuote: { anyOf: [string(2, 500), { type: 'null' }] },
  },
};

export const RESEARCH_ANSWER_WRITER_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['answers', 'tables'],
  properties: {
    answers: stringArray(1, 6, {
      type: 'object', additionalProperties: false, required: ['facetId', 'text'],
      properties: {
        facetId: { type: 'string', enum: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] },
        text: string(1, 3000),
      },
    }),
    // Strict OpenAI JSON Schema requires every property to be listed as required. Null
    // preserves the runtime validator's existing optional-table semantics.
    tables: { anyOf: [
      stringArray(1, 6, {
        type: 'object', additionalProperties: false, required: ['facetIds', 'headers', 'rows'],
        properties: {
          facetIds: stringArray(1, 6, { type: 'string', enum: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] }),
          headers: stringArray(1, RESEARCH_ANSWER_TABLE_LIMITS.columns, string(1, RESEARCH_ANSWER_TABLE_LIMITS.headerChars)),
          rows: stringArray(1, RESEARCH_ANSWER_TABLE_LIMITS.rows,
            stringArray(1, RESEARCH_ANSWER_TABLE_LIMITS.columns, string(0, RESEARCH_ANSWER_TABLE_LIMITS.cellChars))),
        },
      }),
      { type: 'null' },
    ] },
  },
};

/** Native strict plan schema uses null for prose; restore the pure validator's
 *  established optional-field representation without altering any other field. */
export function normalizeResearchPlanSchemaValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const plan = value as Record<string, unknown>;
  if (plan.format !== 'prose' || plan.formatQuestionQuote !== null) return value;
  const { formatQuestionQuote: _ignored, ...normalized } = plan;
  return normalized;
}

/** A strict schema lists every top-level key; null represents the runtime's omitted
 *  optional `tables` field for prose responses. */
export function normalizeResearchWriterSchemaValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = value as Record<string, unknown>;
  if (output.tables !== null) return value;
  const { tables: _ignored, ...normalized } = output;
  return normalized;
}

