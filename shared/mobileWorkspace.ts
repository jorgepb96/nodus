/** Complete structured documents include an attachment in both native JSON and
 * Markdown. This is a bounded transport envelope, not the editor's document or
 * per-file limit, which remain enforced by the shared editor contract. */
export const MOBILE_WORKSPACE_EDIT_MAX_BYTES = 32 * 1024 * 1024;
