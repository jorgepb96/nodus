import { markdownToPageBlocks, pageBlockToMarkdown, type PageBlockDraft } from './pages';

/** Native BlockNote JSON. Kept independent of React and of the installed editor. */
export interface NativeInline {
  type: string;
  text?: string;
  styles?: Record<string, unknown>;
  href?: string;
  content?: NativeInline[];
  props?: Record<string, unknown>;
}
export interface NativeBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children?: NativeBlock[];
}
export type BlockNoteDocument = NativeBlock[];
export const BLOCKNOTE_SCHEMA_VERSION = 2;

export function validateBlockNoteDocument(value: unknown): BlockNoteDocument {
  if (!Array.isArray(value)) throw new Error('El documento BlockNote debe ser un array.');
  if (JSON.stringify(value).length > 4_000_000) throw new Error('El documento supera el límite de 4 MB.');
  const ids = new Set<string>();
  const visit = (entries: unknown[], depth: number) => {
    if (depth > 64) throw new Error('La jerarquía del documento es demasiado profunda.');
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Bloque no válido.');
      const block = entry as NativeBlock;
      if (typeof block.id !== 'string' || !block.id || ids.has(block.id)) throw new Error('Identificador de bloque vacío o duplicado.');
      if (typeof block.type !== 'string' || !block.type || !block.props || typeof block.props !== 'object' || Array.isArray(block.props)) throw new Error('Tipo o propiedades de bloque no válidos.');
      ids.add(block.id);
      if (ids.size > 10_000) throw new Error('El documento supera los 10.000 bloques.');
      if (block.children !== undefined) {
        if (!Array.isArray(block.children)) throw new Error('Hijos de bloque no válidos.');
        visit(block.children, depth + 1);
      }
    }
  };
  visit(value, 0);
  return JSON.parse(JSON.stringify(value)) as BlockNoteDocument;
}

export function parseNativeDocument(value: unknown): BlockNoteDocument | null {
  if (value == null || value === '') return null;
  try { return validateBlockNoteDocument(typeof value === 'string' ? JSON.parse(value) : value); }
  catch { return null; }
}

export function markdownInline(value: string): NativeInline[] {
  const academic = /<!--nodus:inline:([^ ]+)-->(?:[\s\S]*?<!--\/nodus:inline-->)?/g;
  if (academic.test(value)) {
    const items: NativeInline[] = []; let cursor = 0; academic.lastIndex = 0;
    for (const match of value.matchAll(academic)) {
      items.push(...markdownInline(value.slice(cursor,match.index)));
      try { const inline = JSON.parse(decodeURIComponent(match[1])); if (!['nodusCitation','nodusFootnote','nodusCrossReference'].includes(inline.type)) throw new Error(); items.push(inline); }
      catch { items.push({type:'text',text:match[0],styles:{}}); }
      cursor=match.index!+match[0].length;
    }
    items.push(...markdownInline(value.slice(cursor))); return items;
  }

  const html = /<(u|span)(?: style="([^"]*)")?>([\s\S]*?)<\/\1>/g;
  if (html.test(value)) {
    const result: NativeInline[] = []; let cursor = 0;
    html.lastIndex = 0;
    for (const match of value.matchAll(html)) {
      result.push(...markdownInline(value.slice(cursor,match.index)));
      const styles: Record<string,unknown> = match[1] === 'u' ? {underline:true} : {};
      const color = /(?:^|;)\s*color\s*:\s*(#[\da-f]{3,8})/i.exec(match[2] ?? '');
      if (color) styles.textColor = color[1];
      const apply = (items: NativeInline[]): NativeInline[] => items.map(item => item.type === 'text' ? {...item,styles:{...item.styles,...styles}} : item.content ? {...item,content:apply(item.content)} : item);
      result.push(...apply(markdownInline(match[3]))); cursor=match.index!+match[0].length;
    }
    result.push(...markdownInline(value.slice(cursor))); return result;
  }
  const result: NativeInline[] = [];
  // Extensions stay explicit instead of being flattened by a lossy CommonMark export.
  const token = /(!?\[((?:\\.|[^\]])*)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\*\*(?!\*)((?:[^*]|\*(?!\*))+?)\*\*(?!\*)|__(?!_)((?:[^_]|_(?!_))+?)__(?!_)|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~|\$([^$\n]+)\$|(\*\*\*[^*\n]+\*\*\*|___[^_\n]+___))/g;
  let cursor = 0;
  for (const match of value.matchAll(token)) {
    if (match.index! > cursor) result.push({ type: 'text', text: value.slice(cursor, match.index), styles: {} });
    if (match[13]) result.push({type:'text',text:match[13].slice(3,-3),styles:{bold:true,italic:true}});
    else if (match[3] && !match[1].startsWith('!')) result.push({ type: 'link', href: match[3], content: markdownInline(match[2].replace(/\\([[\]\\])/g, '$1')) });
    else if (match[4]) result.push({ type: 'nodusWiki', props: { reference: match[4], label: match[5] || match[4] } });
    else if (match[12]) result.push({ type: 'nodusFormula', props: { formula: match[12] } });
    else if (match[1].startsWith('!')) result.push({ type: 'text', text: match[1], styles: {} });
    else {
      const text = match[6] || match[7] || match[8] || match[9] || match[10] || match[11] || '';
      const style = match[6] || match[7] ? 'bold' : match[8] ? 'code' : match[11] ? 'strike' : 'italic';
      const apply = (items: NativeInline[]): NativeInline[] => items.map(item => item.type === 'text' ? {...item,styles:{...item.styles,[style]:true}} : item.content ? {...item,content:apply(item.content)} : item);
      result.push(...(style === 'code' ? [{type:'text',text,styles:{code:true}}] : apply(markdownInline(text))));
    }
    cursor = match.index! + match[0].length;
  }
  if (cursor < value.length) result.push({ type: 'text', text: value.slice(cursor), styles: {} });
  return result;
}

export function nativeInlineMarkdown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((entry: NativeInline) => {
    if (entry.type === 'link') return `[${nativeInlineMarkdown(entry.content).replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&')}](${entry.href ?? ''})`;
    if (['nodusCitation','nodusFootnote','nodusCrossReference'].includes(entry.type)) return `<!--nodus:inline:${encodeURIComponent(JSON.stringify(entry))}-->${String(entry.props?.label ?? (entry.type==='nodusFootnote'?'[Nota]':'Referencia')).replace(/[<>]/g,'')}<!--/nodus:inline-->`;
    if (entry.type === 'nodusWiki') return `[[${entry.props?.reference ?? ''}|${entry.props?.label ?? entry.props?.reference ?? ''}]]`;
    if (entry.type === 'nodusFormula') return `$${entry.props?.formula ?? ''}$`;
    let text = entry.text ?? '';
    const styles = entry.styles ?? {};
    if (styles.code) text = `\`${text}\``;
    if (styles.bold) text = `**${text}**`;
    if (styles.italic) text = `*${text}*`;
    if (styles.strike) text = `~~${text}~~`;
    if (styles.underline) text = `<u>${text}</u>`;
    // The native JSON retains colors even in consumers without HTML support.
    if (typeof styles.textColor === 'string' && /^#[\da-f]{3,8}$/i.test(styles.textColor)) text = `<span style="color:${styles.textColor}">${text}</span>`;
    return text;
  }).join('');
}

export function nativeBlockMarkdown(block: NativeBlock): string {
  const text = nativeInlineMarkdown(block.content);
  switch (block.type) {
    case 'paragraph': return text;
    case 'heading': return `${'#'.repeat(Math.max(1, Math.min(6, Number(block.props.level) || 1)))} ${text}`;
    case 'bulletListItem': return `- ${text}`;
    case 'numberedListItem': return `${Number(block.props.start) || 1}. ${text}`;
    case 'checkListItem': return `- [${block.props.checked ? 'x' : ' '}] ${text}`;
    case 'quote': return text.split('\n').map(line => `> ${line}`).join('\n');
    case 'codeBlock': return `\`\`\`${block.props.language ?? ''}\n${text}\n\`\`\``;
    case 'image': return `![${block.props.caption ?? ''}](${block.props.url ?? ''})`;
    case 'audio': case 'video': return `<${block.type} controls src="${block.props.url ?? ''}"></${block.type}>`;
    case 'file': return `[${block.props.name || 'Archivo'}](${block.props.url ?? ''})`;
    case 'table': {
      const content = block.content as { rows?: Array<{ cells: Array<unknown> }> } | undefined;
      const rows = (content?.rows ?? []).map(row => row.cells.map(cell => nativeInlineMarkdown(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content)));
      if (!rows.length) return '';
      return [`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map(row => `| ${row.join(' | ')} |`)].join('\n');
    }
    case 'nodusMarkdown': return String(block.props.markdown ?? '');
    default: return typeof block.props.markdown === 'string' ? block.props.markdown : `<!-- nodus:block ${encodeURIComponent(JSON.stringify(block))} -->`;
  }
}

export function blockNoteToMarkdown(document: BlockNoteDocument): string {
  return document.map(block => {
    const own = nativeBlockMarkdown(block);
    const children = block.children?.length ? blockNoteToMarkdown(block.children) : '';
    return own + (children ? '\n' + children.split('\n').map(line => '  ' + line).join('\n') : '');
  }).join('\n\n').trimEnd();
}

const PAGE_TYPES: Record<string, PageBlockDraft['type']> = {
  paragraph: 'paragraph', bulletListItem: 'bulleted_list', numberedListItem: 'numbered_list',
  checkListItem: 'task', quote: 'quote', codeBlock: 'code', image: 'image', audio: 'audio', video: 'video', file: 'file', table: 'table',
};

export function blockNoteToPageBlocks(document: BlockNoteDocument): PageBlockDraft[] {
  const result: PageBlockDraft[] = [];
  const visit = (blocks: NativeBlock[], parentBlockId: string | null) => blocks.forEach((block, index) => {
    const markdown = nativeBlockMarkdown(block);
    const type = block.type === 'heading' && Number(block.props.level) <= 3 ? `heading_${block.props.level}` as PageBlockDraft['type'] : PAGE_TYPES[block.type] ?? 'markdown';
    const content: Record<string, unknown> = type === 'markdown' ? { markdown } : { text: nativeInlineMarkdown(block.content) };
    if (block.type === 'checkListItem') content.checked = Boolean(block.props.checked);
    if (block.type === 'codeBlock') content.language = block.props.language ?? '';
    if (['image', 'audio', 'video', 'file'].includes(block.type)) Object.assign(content, { url: block.props.url, caption: block.props.caption, name: block.props.name });
    const blob = typeof block.props.url === 'string' && /^nodus-blob:\/\/([a-f0-9]{64})$/.exec(block.props.url);
    if (['image', 'audio', 'video', 'file'].includes(block.type) && blob) content.blobHash = blob[1];
    if (block.type === 'table') {
      const rows = (block.content as { rows?: Array<{ cells: unknown[] }> })?.rows ?? [];
      content.rows = rows.map(row => row.cells.map(cell => nativeInlineMarkdown(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content)));
    }
    const native = { ...block }; delete native.children;
    result.push({ id: block.id, parentBlockId, order: (index + 1) * 1024, type, content: {
      ...content, _blockNote: native, _blockNoteMarkdown: markdown, _blockNoteProjection: JSON.stringify(content),
    } });
    if (block.children?.length) visit(block.children, block.id);
  });
  visit(document, null);
  return result;
}

export function pageBlocksToBlockNote(blocks: PageBlockDraft[], previous?: BlockNoteDocument | null): BlockNoteDocument {
  const previousProjection = new Map(blockNoteToPageBlocks(previous ?? []).map(block => [block.id, block.content]));
  const convert = (entry: PageBlockDraft): NativeBlock => {
    const content = entry.content ?? {};
    const standard = Object.fromEntries(Object.entries(content).filter(([key]) => !key.startsWith('_blockNote')));
    const original = content._blockNote ? content : previousProjection.get(entry.id) ?? content;
    const old = original._blockNote as NativeBlock | undefined;
    if (old && JSON.stringify(standard) === original._blockNoteProjection) return { ...JSON.parse(JSON.stringify(old)), id: entry.id || old.id, children: [] };
    const markdown = pageBlockToMarkdown(entry);
    if(old)assertAcademicProjection([old],markdown);
    const parsed = pageBlockNative(entry, markdown);
    if (old?.type === parsed.type) parsed.props = { ...old.props, ...parsed.props };
    return parsed;
  };
  const roots: NativeBlock[] = [];
  const byId = new Map<string, NativeBlock>();
  const sorted = blocks.map(entry => ({ ...entry, id: entry.id || globalThis.crypto.randomUUID() })).sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
  for (const entry of sorted) {
    const native = convert(entry);
    byId.set(native.id, native);
  }
  for (const entry of sorted) {
    const native = byId.get(entry.id ?? '') ?? convert(entry);
    const parent = entry.parentBlockId ? byId.get(entry.parentBlockId) : null;
    if (parent) (parent.children ??= []).push(native); else roots.push(native);
  }
  return roots;
}

function pageBlockNative(entry: PageBlockDraft, markdown: string): NativeBlock {
  const content = entry.content ?? {};
  const id = entry.id || globalThis.crypto.randomUUID();
  const block: NativeBlock = { id, type: 'paragraph', props: {}, content: [], children: [] };
  const headings = /^#{1,6}\s+([^\n]+)$/.exec(markdown);
  if (headings) return { ...block, type: 'heading', props: { level: markdown.match(/^#+/)![0].length }, content: markdownInline(headings[1]) };
  const typeMap: Record<string, string> = { paragraph:'paragraph', bulleted_list:'bulletListItem', numbered_list:'numberedListItem', task:'checkListItem', quote:'quote', code:'codeBlock', image:'image', audio:'audio', video:'video', file:'file', table:'table' };
  const type = typeMap[entry.type];
  if (!type) return { ...block, type: 'nodusMarkdown', props: { markdown } };
  block.type = type;
  block.content = type === 'codeBlock' ? [{ type: 'text', text: String(content.text ?? ''), styles: {} }] : markdownInline(String(content.text ?? ''));
  if (type === 'checkListItem') block.props.checked = Boolean(content.checked);
  if (type === 'codeBlock') block.props.language = content.language || 'text';
  if (['image','audio','video','file'].includes(type)) {
    block.props = { url: content.url || (content.blobHash ? `nodus-blob://${content.blobHash}` : ''), caption: content.caption || '', name: content.name || '' };
    delete block.content;
  }
  if (type === 'table') block.content = { type: 'tableContent', rows: (content.rows as string[][] ?? []).map(row => ({ cells: row.map(cell => markdownInline(cell)) })) };
  return block;
}

export function markdownToBlockNote(markdown: string, previous?: BlockNoteDocument | null): BlockNoteDocument {
  markdown=markdown.replace(/<!--nodus:academic-projection-->[\s\S]*?<!--\/nodus:academic-projection-->/g,'').trimEnd();
  if(previous) assertAcademicProjection(previous,markdown);

  // Reuse unchanged native blocks by their exact Markdown, preserving rich properties.
  const available = new Map<string, NativeBlock[]>();
  const ordered: NativeBlock[] = [];
  const used = new Set<string>();
  const remember = (blocks: NativeBlock[]) => blocks.forEach(block => {
    ordered.push(block);
    const key = nativeBlockMarkdown(block);
    available.set(key, [...(available.get(key) ?? []), block]);
    if (block.children?.length) remember(block.children);
  });
  if (previous) remember(previous);
  const pages = markdownToPageBlocks(markdown);
  const result = pages.map(entry => {
    const source = pageBlockToMarkdown(entry);
    const old = available.get(source)?.shift();
    if (old) used.add(old.id);
    return old ? { ...JSON.parse(JSON.stringify(old)), children: [] } : pageBlockNative(entry, source);
  });
  // A text edit in place keeps its block anchor and properties. Exact matches
  // have priority, so moved or inserted blocks cannot steal another block's ID.
  result.forEach((block,index) => {
    if (used.has(block.id)) return;
    const old=ordered[index];
    if (old && !used.has(old.id) && old.type === block.type) { block.id=old.id; block.props={...old.props,...block.props}; used.add(old.id); }
  });
  // The conservative page importer records list indentation without changing old data.
  const roots: NativeBlock[] = [];
  const stack: Array<{ indent: number; block: NativeBlock }> = [];
  result.forEach((block, index) => {
    const indent = Number(pages[index].content?.indent ?? 0);
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    if (indent > 0 && stack.length && /ListItem$/.test(block.type)) stack.at(-1)!.block.children!.push(block);
    else roots.push(block);
    if (/ListItem$/.test(block.type)) stack.push({ indent, block }); else stack.length = 0;
  });
  return roots;
}

export function findNativeBlock(document: BlockNoteDocument, id: string): NativeBlock | null {
  for (const block of document) {
    if (block.id === id) return block;
    const child = block.children && findNativeBlock(block.children, id);
    if (child) return child;
  }
  return null;
}

export function nativePlainText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as {type?:string}).type === 'tableContent') {
    return ((value as {rows?:Array<{cells:unknown[]}>}).rows ?? []).map(row=>row.cells.map(cell=>nativePlainText(Array.isArray(cell)?cell:(cell as {content?:unknown})?.content)).join('\t')).join('\n');
  }
  if (!Array.isArray(value)) return '';
  return value.map((item: NativeInline) => item.text ?? (['nodusCitation','nodusCrossReference'].includes(item.type) ? String(item.props?.label ?? '') : item.type === 'nodusFootnote' ? '[Nota]' : item.type === 'nodusWiki' ? String(item.props?.label ?? '') : item.type === 'nodusFormula' ? String(item.props?.formula ?? '') : nativePlainText(item.content))).join('');
}

export function nativeDocumentText(document: BlockNoteDocument): string {
  return document.map(block => (nativePlainText(block.content) || String(block.props.markdown ?? '')) + (block.children?.length ? '\n' + nativeDocumentText(block.children) : '')).join('\n');
}

/** A duplicate gets new globally unique block IDs and keeps every native attribute. */
export function cloneNativeDocument(document: BlockNoteDocument): BlockNoteDocument {
  return document.map(block => ({ ...JSON.parse(JSON.stringify(block)), id: globalThis.crypto.randomUUID(), children: cloneNativeDocument(block.children ?? []) }));
}

/** Old projection writers may edit prose but cannot silently erase structured academic references. */
export function assertAcademicProjection(previous:BlockNoteDocument,markdown:string):void {
 const visit=(blocks:BlockNoteDocument)=>{for(const block of blocks){const inline=(content:unknown)=>{if(Array.isArray(content))for(const item of content as NativeInline[]){if(['nodusCitation','nodusFootnote','nodusCrossReference'].includes(item.type)&&!markdown.includes(encodeURIComponent(JSON.stringify(item))))throw new Error('ACADEMIC_PROJECTION_CONFLICT: Esta edición eliminaría citas o notas estructuradas. Abre Scriptor para resolverla; el borrador se conserva.');if(item.content)inline(item.content);}else if(content&&typeof content==='object')for(const row of (content as {rows?:Array<{cells:unknown[]}>}).rows??[])for(const cell of row.cells)inline(Array.isArray(cell)?cell:(cell as {content?:unknown}).content);};inline(block.content);visit(block.children??[]);}};
 visit(previous);
}
