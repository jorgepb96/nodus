import {htmlToPdfBytes} from './htmlToPdf';
import {renderHtml} from '@shared/markdownRender';
export {stripMarkdownLinks,stripInlineMarkdown,escapeHtml,collectCitations,markdownToHtml} from '@shared/markdownRender';

/**
 * Goes through the shared helper rather than driving its own BrowserWindow: that is
 * where the deferred-destroy fix lives (destroying the window synchronously breaks the
 * NEXT export in the session with `ERR_FAILED`), and it loads from a temp file instead
 * of a `data:` URL, so an embedded image can no longer overflow the URL length limit.
 *
 * This stylesheet sets its page margin in `body`, not in an `@page` rule, so zero
 * printer margins are correct here.
 */
export async function markdownToPdf(markdown: string, title: string): Promise<Buffer> {
  return htmlToPdfBytes(renderHtml(markdown, title));
}
