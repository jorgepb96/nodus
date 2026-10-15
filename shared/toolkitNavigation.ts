/** Stable Toolkit destinations that may be pinned into the main sidebar. */
export const TOOLKIT_TOOL_PAGES = ['backups', 'apps', 'convert', 'drift', 'protect', 'translate', 'presenter', 'sign', 'ocr'] as const;

export type ToolkitToolPage = (typeof TOOLKIT_TOOL_PAGES)[number];

const TOOLKIT_TOOL_PAGE_SET = new Set<string>(TOOLKIT_TOOL_PAGES);

/** Settings are user-editable JSON, so keep only known, unique destinations. */
export function normalizeToolkitToolPages(value: unknown): ToolkitToolPage[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (page): page is ToolkitToolPage => typeof page === 'string' && TOOLKIT_TOOL_PAGE_SET.has(page),
  ))];
}
