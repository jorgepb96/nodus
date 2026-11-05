export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, '$1');
}

export function stripInlineMarkdown(text: string): string {
  return stripMarkdownLinks(text).replace(/[*_`]/g, '');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * All distinct `nodus://` citations in the document, in first-seen order.
 *
 * Every kind counts, not only the academic ones: a study report cites
 * `nodus://study/material/…` and a teaching unit cites its own, and a bibliography
 * that silently drops them is worse than none. The URL is kept verbatim so a
 * multi-segment link (`nodus://study/material/x`) survives the round trip.
 */
export function collectCitations(markdown: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]\((nodus:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const url = match[2];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ label: stripInlineMarkdown(match[1]), url });
  }
  return out;
}

function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, (_full, label: string, url: string) =>
      `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
    );
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  let inList = false;
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inlineHtml(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
      continue;
    }
    if (bullet) {
      flushParagraph();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineHtml(bullet[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  const refs = collectCitations(markdown);
  if (refs.length) {
    out.push('<h1>Bibliografia Nodus</h1>', '<ul>');
    for (const ref of refs) out.push(`<li>${escapeHtml(ref.label)} - ${escapeHtml(ref.url)}</li>`);
    out.push('</ul>');
  }
  return out.join('\n');
}

export function renderHtml(markdown: string, title: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font: 12pt Georgia, serif; line-height: 1.55; color: #171717; margin: 42px; }
    h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.2; }
    h1 { font-size: 24pt; margin-top: 0; }
    h2 { font-size: 17pt; margin-top: 28px; }
    h3 { font-size: 14pt; margin-top: 22px; }
    a { color: #1f4fbf; text-decoration: none; }
    blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #bbb; color: #444; }
  </style>
</head>
<body>${markdownToHtml(markdown)}</body>
</html>`;
}
