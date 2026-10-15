/**
 * The last line of defence before an imported publication's HTML (an EPUB chapter, an HTML
 * snapshot, a DOCX converted by mammoth) is inserted into the reader with innerHTML.
 *
 * The main process strips scripts with regular expressions, which a crafted file can step
 * around: `<ifr<iframe>ame srcdoc="…">` comes out as a live `<iframe srcdoc>`, and unquoted
 * `onerror=`, `style=` and `href=javascript:` pass untouched. A srcdoc frame shares this
 * window's origin and CSP, and the CSP admits `data:` scripts, so the file could reach the
 * preload bridge. Here the HTML is parsed into an inert document and rebuilt from an
 * allowlist: elements outside it are dropped with their content when they are active
 * (frames, forms, media, scripts, metadata) and unwrapped otherwise, and only plain
 * presentational attributes survive.
 */
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'option',
  'video', 'audio', 'source', 'track', 'svg', 'meta', 'link', 'base', 'template', 'noscript', 'portal', 'canvas', 'dialog', 'head', 'title', 'slot']);
const KEEP = new Set(['a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd',
  'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr']);
const ATTRIBUTES = new Set(['alt', 'title', 'id', 'lang', 'dir', 'colspan', 'rowspan', 'headers', 'scope', 'start', 'reversed', 'width', 'height', 'datetime', 'cite', 'name']);
const MATH_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
const MATH_ELEMENTS = new Set(['math', 'mi', 'mn', 'mo', 'mtext', 'ms', 'mspace', 'mrow', 'mfrac', 'msqrt', 'mroot', 'msub', 'msup', 'msubsup',
  'munder', 'mover', 'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mlabeledtr', 'mtd', 'menclose', 'mphantom', 'mpadded', 'mstyle', 'semantics', 'annotation']);
const MATH_ATTRIBUTES = new Set(['id', 'title', 'lang', 'dir', 'display', 'displaystyle', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground',
  'scriptlevel', 'stretchy', 'symmetric', 'fence', 'separator', 'accent', 'accentunder', 'largeop', 'movablelimits', 'form', 'linethickness',
  'rowalign', 'columnalign', 'rowspacing', 'columnspacing', 'columnspan', 'rowspan', 'width', 'height', 'depth', 'voffset', 'lspace', 'rspace', 'notation', 'bevelled', 'encoding']);

function copyMath(element: Element, out: Document): Element {
  const copy = out.createElementNS(MATH_NAMESPACE, element.localName.toLowerCase());
  for (const attribute of Array.from(element.attributes)) {
    if (!attribute.namespaceURI && MATH_ATTRIBUTES.has(attribute.name.toLowerCase())) copy.setAttribute(attribute.name.toLowerCase(), attribute.value);
  }
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) { copy.appendChild(out.createTextNode(child.textContent ?? '')); continue; }
    if (child.nodeType !== 1) continue;
    const nested = child as Element;
    const tag = nested.localName.toLowerCase();
    // annotation-xml admits foreign HTML and mglyph can fetch a URL. Neither is presentation
    // MathML. HTML inside a token may contribute plain text, never live foreign elements.
    if (DROP.has(tag) || tag === 'annotation-xml' || tag === 'mglyph') continue;
    if (nested.namespaceURI === MATH_NAMESPACE && MATH_ELEMENTS.has(tag)) copy.appendChild(copyMath(nested, out));
    else copy.appendChild(out.createTextNode(nested.textContent ?? ''));
  }
  return copy;
}

function safeHref(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- publication HTML is hostile input
  const compact = value.replace(/[\u0000- \u007f]+/g, '').toLowerCase();
  return compact.startsWith('#') || compact.startsWith('https://') || compact.startsWith('http://') || compact.startsWith('mailto:');
}

function safeImageSource(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|svg\+xml);base64,/i.test(value.trim());
}

function clean(node: Element, out: Document): DocumentFragment {
  const fragment = out.createDocumentFragment();
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) { fragment.appendChild(out.createTextNode(child.textContent ?? '')); continue; }
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const tag = element.localName.toLowerCase();
    if (tag === 'math' && element.namespaceURI === MATH_NAMESPACE) { fragment.appendChild(copyMath(element, out)); continue; }
    if (DROP.has(tag)) continue;
    if (!KEEP.has(tag)) { fragment.appendChild(clean(element, out)); continue; }
    const copy = out.createElement(tag);
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (ATTRIBUTES.has(name)) copy.setAttribute(name, attribute.value);
      else if (name === 'href' && tag === 'a' && safeHref(attribute.value)) copy.setAttribute('href', attribute.value);
      else if (name === 'src' && tag === 'img' && safeImageSource(attribute.value)) copy.setAttribute('src', attribute.value);
    }
    copy.appendChild(clean(element, out));
    fragment.appendChild(copy);
  }
  return fragment;
}

export function sanitizePublicationHtml(html: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const container = out.createElement('div');
  container.appendChild(clean(parsed.body, out));
  return container.innerHTML;
}
