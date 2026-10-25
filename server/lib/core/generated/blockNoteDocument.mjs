// GENERATED — do not edit.
//
// Built from shared/ by scripts/build-server-shared.mjs so the server can print the same
// document the desktop does without taking on a dependency or a build step. Edit the
// TypeScript and run `npm run build:server-shared`; scripts/test-server-generated.mjs
// fails if this file and that source disagree.
// shared/pages.ts
var text = (content, key = "text") => typeof content[key] === "string" ? String(content[key]) : "";
function makeId(prefix, idFactory) {
  if (idFactory) return idFactory();
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}
function block(type, content, idFactory) {
  return { id: makeId("pblk", idFactory), type, content };
}
function assetReference(url) {
  const local = url.match(/^nodus-blob:\/\/([0-9a-f]{64})$/i);
  return local ? { url: "", blobHash: local[1].toLowerCase() } : { url };
}
var SPECIAL_START = /^(?:#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~|\$\$|---+$|\*\*\*+$|___+$|\|)/;
function markdownToPageBlocks(markdown, idFactory) {
  const source = markdown.replace(/\r\n?/g, "\n");
  if (!source.trim()) return [block("paragraph", { text: "" }, idFactory)];
  const lines = source.split("\n");
  const out = [];
  let index = 0;
  const pushParagraph = () => {
    const start = index;
    while (index < lines.length && lines[index].trim() && !SPECIAL_START.test(lines[index].trim())) index++;
    const value = lines.slice(start, index).join("\n");
    if (value) out.push(block("paragraph", { text: value }, idFactory));
  };
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index++;
      continue;
    }
    const fence = trimmed.match(/^(```|~~~)(.*)$/);
    if (fence) {
      const marker = fence[1];
      const language = fence[2].trim();
      const start = index++;
      const body = [];
      while (index < lines.length && !lines[index].trim().startsWith(marker)) body.push(lines[index++]);
      if (index >= lines.length) {
        out.push(block("markdown", { markdown: lines.slice(start).join("\n") }, idFactory));
        break;
      }
      index++;
      out.push(block("code", { text: body.join("\n"), language }, idFactory));
      continue;
    }
    if (trimmed === "$$" || trimmed.startsWith("$$")) {
      if (trimmed !== "$$" && trimmed.endsWith("$$") && trimmed.length > 4) {
        out.push(block("equation", { text: trimmed.slice(2, -2).trim() }, idFactory));
        index++;
        continue;
      }
      const start = index++;
      const body = [];
      while (index < lines.length && lines[index].trim() !== "$$") body.push(lines[index++]);
      if (index >= lines.length) {
        out.push(block("markdown", { markdown: lines.slice(start).join("\n") }, idFactory));
        break;
      }
      index++;
      out.push(block("equation", { text: body.join("\n") }, idFactory));
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      out.push(block(`heading_${heading[1].length}`, { text: heading[2] }, idFactory));
      index++;
      continue;
    }
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      out.push(block("divider", {}, idFactory));
      index++;
      continue;
    }
    const task = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      out.push(block("task", { text: task[2], checked: task[1].toLowerCase() === "x", indent: line.length - line.trimStart().length }, idFactory));
      index++;
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      out.push(block("bulleted_list", { text: bullet[1], indent: line.length - line.trimStart().length }, idFactory));
      index++;
      continue;
    }
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      out.push(block("numbered_list", { text: numbered[1], indent: line.length - line.trimStart().length }, idFactory));
      index++;
      continue;
    }
    const callout = trimmed.match(/^>\s*\[!([A-Za-z]+)\]\s*(.*)$/);
    if (callout) {
      out.push(block("callout", { text: callout[2], tone: callout[1].toLowerCase() }, idFactory));
      index++;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index++].trim().replace(/^>\s?/, ""));
      }
      out.push(block("quote", { text: quote.join("\n") }, idFactory));
      continue;
    }
    if (trimmed.startsWith("|") && index + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[index + 1])) {
      const tableLines = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) tableLines.push(lines[index++]);
      const parseRow = (value) => value.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const rows = tableLines.filter((_value, rowIndex) => rowIndex !== 1).map(parseRow);
      out.push(block("table", { rows }, idFactory));
      continue;
    }
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (image) {
      out.push(block("image", { caption: image[1], ...assetReference(image[2]), title: image[3] ?? "" }, idFactory));
      index++;
      continue;
    }
    const mention = trimmed.match(/^@\[([^\]]+)\]\(nodus:\/\/page\/([^)\s]+)\)$/);
    if (mention) {
      out.push(block("mention", { label: mention[1], pageId: decodeURIComponent(mention[2]) }, idFactory));
      index++;
      continue;
    }
    const link = trimmed.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const pageTarget = link[2].match(/^nodus:\/\/page\/(.+)$/);
      const blobTarget = link[2].match(/^nodus-blob:\/\/([0-9a-f]{64})$/i);
      out.push(block(pageTarget ? "subpage" : blobTarget ? "file" : "bookmark", pageTarget ? { title: link[1], pageId: decodeURIComponent(pageTarget[1]) } : blobTarget ? { name: link[1], ...assetReference(link[2]) } : { title: link[1], url: link[2] }, idFactory));
      index++;
      continue;
    }
    if (/^<details[\s>]/i.test(trimmed)) {
      const raw = [];
      while (index < lines.length) {
        raw.push(lines[index]);
        if (/<\/details>\s*$/i.test(lines[index])) {
          index++;
          break;
        }
        index++;
      }
      const joined = raw.join("\n");
      const summary = joined.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] ?? "";
      const bodyText = joined.replace(/[\s\S]*?<\/summary>/i, "").replace(/<\/details>\s*$/i, "").trim();
      out.push(block("toggle", { text: summary, body: bodyText }, idFactory));
      continue;
    }
    if (/^<(?:iframe|audio|video)\b/i.test(trimmed)) {
      const kind = /^<audio\b/i.test(trimmed) ? "audio" : /^<video\b/i.test(trimmed) ? "video" : "embed";
      const source2 = line.match(/\bsrc=["']([^"']+)/i)?.[1] ?? "";
      out.push(block(kind, { html: line, ...assetReference(source2) }, idFactory));
      index++;
      continue;
    }
    if (/^<!--\s*nodus:/.test(trimmed)) {
      const native = trimmed.match(/^<!--\s*nodus:(columns|synced|database-view)\s+([\s\S]*?)\s*-->$/);
      if (!native) out.push(block("markdown", { markdown: line }, idFactory));
      else if (native[1] === "columns") {
        try {
          out.push(block("columns", { columns: JSON.parse(native[2]) }, idFactory));
        } catch {
          out.push(block("markdown", { markdown: line }, idFactory));
        }
      } else if (native[1] === "synced") out.push(block("synced_block", { sourceBlockId: native[2] }, idFactory));
      else {
        try {
          const decoded = decodeURIComponent(native[2]);
          const content = JSON.parse(decoded);
          out.push(block("database_view", content && typeof content === "object" && !Array.isArray(content) ? content : { viewId: native[2] }, idFactory));
        } catch {
          out.push(block("database_view", { viewId: native[2] }, idFactory));
        }
      }
      index++;
      continue;
    }
    if (trimmed.startsWith(":::")) {
      const raw = [line];
      index++;
      while (index < lines.length) {
        raw.push(lines[index]);
        if (lines[index].trim() === ":::") {
          index++;
          break;
        }
        index++;
      }
      out.push(block("markdown", { markdown: raw.join("\n") }, idFactory));
      continue;
    }
    const before = index;
    pushParagraph();
    if (index === before) out.push(block("markdown", { markdown: lines[index++] }, idFactory));
  }
  const listStack = [];
  for (const item of out) {
    if (!["bulleted_list", "numbered_list", "task"].includes(item.type)) {
      listStack.length = 0;
      continue;
    }
    const indent = Number(item.content?.indent ?? 0);
    while (listStack.length && listStack.at(-1).indent >= indent) listStack.pop();
    if (indent > 0 && listStack.length) {
      const parent = listStack.at(-1).item;
      parent.id ??= idFactory?.() ?? globalThis.crypto.randomUUID();
      item.parentBlockId = parent.id;
    }
    listStack.push({ indent, item });
  }
  return out.length ? out : [block("paragraph", { text: source }, idFactory)];
}
function tableMarkdown(content) {
  const rows = (Array.isArray(content.rows) ? content.rows : []).map(
    (row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "").replace(/\|/g, "\\|"))
  );
  if (!rows.length) rows.push([""]);
  const width = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}
function pageBlockToMarkdown(blockValue) {
  const content = blockValue.content ?? {};
  const projection = Object.fromEntries(Object.entries(content).filter(([key]) => !key.startsWith("_blockNote")));
  if (typeof content._blockNoteMarkdown === "string" && JSON.stringify(projection) === content._blockNoteProjection) return content._blockNoteMarkdown;
  const value = text(content);
  switch (blockValue.type) {
    case "paragraph":
      return value;
    case "heading_1":
      return `# ${value}`;
    case "heading_2":
      return `## ${value}`;
    case "heading_3":
      return `### ${value}`;
    case "bulleted_list":
      return `- ${value}`;
    case "numbered_list":
      return `1. ${value}`;
    case "task":
      return `- [${content.checked ? "x" : " "}] ${value}`;
    case "toggle":
      return `<details><summary>${value}</summary>

${text(content, "body")}

</details>`;
    case "quote":
      return value.split("\n").map((line) => `> ${line}`).join("\n");
    case "callout":
      return `> [!${(text(content, "tone") || "NOTE").toUpperCase()}] ${value}`;
    case "divider":
      return "---";
    case "code":
      return `\`\`\`${text(content, "language")}
${value}
\`\`\``;
    case "equation":
      return `$$
${value}
$$`;
    case "table":
      return tableMarkdown(content);
    case "columns":
      return `<!-- nodus:columns ${JSON.stringify(Array.isArray(content.columns) ? content.columns : [])} -->`;
    case "image":
      return `![${text(content, "caption")}](${text(content, "url") || `nodus-blob://${text(content, "blobHash")}`})`;
    case "file":
      return `[${text(content, "name") || "Archivo"}](${text(content, "url") || `nodus-blob://${text(content, "blobHash")}`})`;
    case "audio":
      return `<audio controls src="${text(content, "url") || `nodus-blob://${text(content, "blobHash")}`}"></audio>`;
    case "video":
      return `<video controls src="${text(content, "url") || `nodus-blob://${text(content, "blobHash")}`}"></video>`;
    case "bookmark":
      return `[${text(content, "title") || text(content, "url")}](${text(content, "url")})`;
    case "embed":
      return text(content, "html") || text(content, "url");
    case "subpage":
      return `[${text(content, "title") || "Subp\xE1gina"}](nodus://page/${encodeURIComponent(text(content, "pageId"))})`;
    case "mention":
      return `@[${text(content, "label") || "P\xE1gina"}](nodus://page/${encodeURIComponent(text(content, "pageId"))})`;
    case "synced_block":
      return `<!-- nodus:synced ${text(content, "sourceBlockId")} -->`;
    case "database_view":
      return `<!-- nodus:database-view ${encodeURIComponent(JSON.stringify(content))} -->`;
    case "markdown":
      return text(content, "markdown");
  }
}

// shared/blockNoteDocument.ts
var BLOCKNOTE_SCHEMA_VERSION = 2;
function validateBlockNoteDocument(value) {
  if (!Array.isArray(value)) throw new Error("El documento BlockNote debe ser un array.");
  if (JSON.stringify(value).length > 4e6) throw new Error("El documento supera el l\xEDmite de 4 MB.");
  const ids = /* @__PURE__ */ new Set();
  const visit = (entries, depth) => {
    if (depth > 64) throw new Error("La jerarqu\xEDa del documento es demasiado profunda.");
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Bloque no v\xE1lido.");
      const block2 = entry;
      if (typeof block2.id !== "string" || !block2.id || ids.has(block2.id)) throw new Error("Identificador de bloque vac\xEDo o duplicado.");
      if (typeof block2.type !== "string" || !block2.type || !block2.props || typeof block2.props !== "object" || Array.isArray(block2.props)) throw new Error("Tipo o propiedades de bloque no v\xE1lidos.");
      ids.add(block2.id);
      if (ids.size > 1e4) throw new Error("El documento supera los 10.000 bloques.");
      if (block2.children !== void 0) {
        if (!Array.isArray(block2.children)) throw new Error("Hijos de bloque no v\xE1lidos.");
        visit(block2.children, depth + 1);
      }
    }
  };
  visit(value, 0);
  return JSON.parse(JSON.stringify(value));
}
function parseNativeDocument(value) {
  if (value == null || value === "") return null;
  try {
    return validateBlockNoteDocument(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}
function markdownInline(value) {
  const academic = /<!--nodus:inline:([^ ]+)-->(?:[\s\S]*?<!--\/nodus:inline-->)?/g;
  if (academic.test(value)) {
    const items = [];
    let cursor2 = 0;
    academic.lastIndex = 0;
    for (const match of value.matchAll(academic)) {
      items.push(...markdownInline(value.slice(cursor2, match.index)));
      try {
        const inline = JSON.parse(decodeURIComponent(match[1]));
        if (!["nodusCitation", "nodusFootnote", "nodusCrossReference"].includes(inline.type)) throw new Error();
        items.push(inline);
      } catch {
        items.push({ type: "text", text: match[0], styles: {} });
      }
      cursor2 = match.index + match[0].length;
    }
    items.push(...markdownInline(value.slice(cursor2)));
    return items;
  }
  const html = /<(u|span)(?: style="([^"]*)")?>([\s\S]*?)<\/\1>/g;
  if (html.test(value)) {
    const result2 = [];
    let cursor2 = 0;
    html.lastIndex = 0;
    for (const match of value.matchAll(html)) {
      result2.push(...markdownInline(value.slice(cursor2, match.index)));
      const styles = match[1] === "u" ? { underline: true } : {};
      const color = /(?:^|;)\s*color\s*:\s*(#[\da-f]{3,8})/i.exec(match[2] ?? "");
      if (color) styles.textColor = color[1];
      const apply = (items) => items.map((item) => item.type === "text" ? { ...item, styles: { ...item.styles, ...styles } } : item.content ? { ...item, content: apply(item.content) } : item);
      result2.push(...apply(markdownInline(match[3])));
      cursor2 = match.index + match[0].length;
    }
    result2.push(...markdownInline(value.slice(cursor2)));
    return result2;
  }
  const result = [];
  const token = /(!?\[((?:\\.|[^\]])*)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\*\*(?!\*)((?:[^*]|\*(?!\*))+?)\*\*(?!\*)|__(?!_)((?:[^_]|_(?!_))+?)__(?!_)|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~|\$([^$\n]+)\$|(\*\*\*[^*\n]+\*\*\*|___[^_\n]+___))/g;
  let cursor = 0;
  for (const match of value.matchAll(token)) {
    if (match.index > cursor) result.push({ type: "text", text: value.slice(cursor, match.index), styles: {} });
    if (match[13]) result.push({ type: "text", text: match[13].slice(3, -3), styles: { bold: true, italic: true } });
    else if (match[3] && !match[1].startsWith("!")) result.push({ type: "link", href: match[3], content: markdownInline(match[2].replace(/\\([[\]\\])/g, "$1")) });
    else if (match[4]) result.push({ type: "nodusWiki", props: { reference: match[4], label: match[5] || match[4] } });
    else if (match[12]) result.push({ type: "nodusFormula", props: { formula: match[12] } });
    else if (match[1].startsWith("!")) result.push({ type: "text", text: match[1], styles: {} });
    else {
      const text2 = match[6] || match[7] || match[8] || match[9] || match[10] || match[11] || "";
      const style = match[6] || match[7] ? "bold" : match[8] ? "code" : match[11] ? "strike" : "italic";
      const apply = (items) => items.map((item) => item.type === "text" ? { ...item, styles: { ...item.styles, [style]: true } } : item.content ? { ...item, content: apply(item.content) } : item);
      result.push(...style === "code" ? [{ type: "text", text: text2, styles: { code: true } }] : apply(markdownInline(text2)));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) result.push({ type: "text", text: value.slice(cursor), styles: {} });
  return result;
}
function nativeInlineMarkdown(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((entry) => {
    if (entry.type === "link") return `[${nativeInlineMarkdown(entry.content).replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&")}](${entry.href ?? ""})`;
    if (["nodusCitation", "nodusFootnote", "nodusCrossReference"].includes(entry.type)) return `<!--nodus:inline:${encodeURIComponent(JSON.stringify(entry))}-->${String(entry.props?.label ?? (entry.type === "nodusFootnote" ? "[Nota]" : "Referencia")).replace(/[<>]/g, "")}<!--/nodus:inline-->`;
    if (entry.type === "nodusWiki") return `[[${entry.props?.reference ?? ""}|${entry.props?.label ?? entry.props?.reference ?? ""}]]`;
    if (entry.type === "nodusFormula") return `$${entry.props?.formula ?? ""}$`;
    let text2 = entry.text ?? "";
    const styles = entry.styles ?? {};
    if (styles.code) text2 = `\`${text2}\``;
    if (styles.bold) text2 = `**${text2}**`;
    if (styles.italic) text2 = `*${text2}*`;
    if (styles.strike) text2 = `~~${text2}~~`;
    if (styles.underline) text2 = `<u>${text2}</u>`;
    if (typeof styles.textColor === "string" && /^#[\da-f]{3,8}$/i.test(styles.textColor)) text2 = `<span style="color:${styles.textColor}">${text2}</span>`;
    return text2;
  }).join("");
}
function nativeBlockMarkdown(block2) {
  const text2 = nativeInlineMarkdown(block2.content);
  switch (block2.type) {
    case "paragraph":
      return text2;
    case "heading":
      return `${"#".repeat(Math.max(1, Math.min(6, Number(block2.props.level) || 1)))} ${text2}`;
    case "bulletListItem":
      return `- ${text2}`;
    case "numberedListItem":
      return `${Number(block2.props.start) || 1}. ${text2}`;
    case "checkListItem":
      return `- [${block2.props.checked ? "x" : " "}] ${text2}`;
    case "quote":
      return text2.split("\n").map((line) => `> ${line}`).join("\n");
    case "codeBlock":
      return `\`\`\`${block2.props.language ?? ""}
${text2}
\`\`\``;
    case "image":
      return `![${block2.props.caption ?? ""}](${block2.props.url ?? ""})`;
    case "audio":
    case "video":
      return `<${block2.type} controls src="${block2.props.url ?? ""}"></${block2.type}>`;
    case "file":
      return `[${block2.props.name || "Archivo"}](${block2.props.url ?? ""})`;
    case "table": {
      const content = block2.content;
      const rows = (content?.rows ?? []).map((row) => row.cells.map((cell) => nativeInlineMarkdown(Array.isArray(cell) ? cell : cell?.content)));
      if (!rows.length) return "";
      return [`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n");
    }
    case "nodusMarkdown":
      return String(block2.props.markdown ?? "");
    default:
      return typeof block2.props.markdown === "string" ? block2.props.markdown : `<!-- nodus:block ${encodeURIComponent(JSON.stringify(block2))} -->`;
  }
}
function blockNoteToMarkdown(document) {
  return document.map((block2) => {
    const own = nativeBlockMarkdown(block2);
    const children = block2.children?.length ? blockNoteToMarkdown(block2.children) : "";
    return own + (children ? "\n" + children.split("\n").map((line) => "  " + line).join("\n") : "");
  }).join("\n\n").trimEnd();
}
var PAGE_TYPES = {
  paragraph: "paragraph",
  bulletListItem: "bulleted_list",
  numberedListItem: "numbered_list",
  checkListItem: "task",
  quote: "quote",
  codeBlock: "code",
  image: "image",
  audio: "audio",
  video: "video",
  file: "file",
  table: "table"
};
function blockNoteToPageBlocks(document) {
  const result = [];
  const visit = (blocks, parentBlockId) => blocks.forEach((block2, index) => {
    const markdown = nativeBlockMarkdown(block2);
    const type = block2.type === "heading" && Number(block2.props.level) <= 3 ? `heading_${block2.props.level}` : PAGE_TYPES[block2.type] ?? "markdown";
    const content = type === "markdown" ? { markdown } : { text: nativeInlineMarkdown(block2.content) };
    if (block2.type === "checkListItem") content.checked = Boolean(block2.props.checked);
    if (block2.type === "codeBlock") content.language = block2.props.language ?? "";
    if (["image", "audio", "video", "file"].includes(block2.type)) Object.assign(content, { url: block2.props.url, caption: block2.props.caption, name: block2.props.name });
    const blob = typeof block2.props.url === "string" && /^nodus-blob:\/\/([a-f0-9]{64})$/.exec(block2.props.url);
    if (["image", "audio", "video", "file"].includes(block2.type) && blob) content.blobHash = blob[1];
    if (block2.type === "table") {
      const rows = block2.content?.rows ?? [];
      content.rows = rows.map((row) => row.cells.map((cell) => nativeInlineMarkdown(Array.isArray(cell) ? cell : cell?.content)));
    }
    const native = { ...block2 };
    delete native.children;
    result.push({ id: block2.id, parentBlockId, order: (index + 1) * 1024, type, content: {
      ...content,
      _blockNote: native,
      _blockNoteMarkdown: markdown,
      _blockNoteProjection: JSON.stringify(content)
    } });
    if (block2.children?.length) visit(block2.children, block2.id);
  });
  visit(document, null);
  return result;
}
function pageBlocksToBlockNote(blocks, previous) {
  const previousProjection = new Map(blockNoteToPageBlocks(previous ?? []).map((block2) => [block2.id, block2.content]));
  const convert = (entry) => {
    const content = entry.content ?? {};
    const standard = Object.fromEntries(Object.entries(content).filter(([key]) => !key.startsWith("_blockNote")));
    const original = content._blockNote ? content : previousProjection.get(entry.id) ?? content;
    const old = original._blockNote;
    if (old && JSON.stringify(standard) === original._blockNoteProjection) return { ...JSON.parse(JSON.stringify(old)), id: entry.id || old.id, children: [] };
    const markdown = pageBlockToMarkdown(entry);
    if (old) assertAcademicProjection([old], markdown);
    const parsed = pageBlockNative(entry, markdown);
    if (old?.type === parsed.type) parsed.props = { ...old.props, ...parsed.props };
    return parsed;
  };
  const roots = [];
  const byId = /* @__PURE__ */ new Map();
  const sorted = blocks.map((entry) => ({ ...entry, id: entry.id || globalThis.crypto.randomUUID() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const entry of sorted) {
    const native = convert(entry);
    byId.set(native.id, native);
  }
  for (const entry of sorted) {
    const native = byId.get(entry.id ?? "") ?? convert(entry);
    const parent = entry.parentBlockId ? byId.get(entry.parentBlockId) : null;
    if (parent) (parent.children ??= []).push(native);
    else roots.push(native);
  }
  return roots;
}
function pageBlockNative(entry, markdown) {
  const content = entry.content ?? {};
  const id = entry.id || globalThis.crypto.randomUUID();
  const block2 = { id, type: "paragraph", props: {}, content: [], children: [] };
  const headings = /^#{1,6}\s+([^\n]+)$/.exec(markdown);
  if (headings) return { ...block2, type: "heading", props: { level: markdown.match(/^#+/)[0].length }, content: markdownInline(headings[1]) };
  const typeMap = { paragraph: "paragraph", bulleted_list: "bulletListItem", numbered_list: "numberedListItem", task: "checkListItem", quote: "quote", code: "codeBlock", image: "image", audio: "audio", video: "video", file: "file", table: "table" };
  const type = typeMap[entry.type];
  if (!type) return { ...block2, type: "nodusMarkdown", props: { markdown } };
  block2.type = type;
  block2.content = type === "codeBlock" ? [{ type: "text", text: String(content.text ?? ""), styles: {} }] : markdownInline(String(content.text ?? ""));
  if (type === "checkListItem") block2.props.checked = Boolean(content.checked);
  if (type === "codeBlock") block2.props.language = content.language || "text";
  if (["image", "audio", "video", "file"].includes(type)) {
    block2.props = { url: content.url || (content.blobHash ? `nodus-blob://${content.blobHash}` : ""), caption: content.caption || "", name: content.name || "" };
    delete block2.content;
  }
  if (type === "table") block2.content = { type: "tableContent", rows: (content.rows ?? []).map((row) => ({ cells: row.map((cell) => markdownInline(cell)) })) };
  return block2;
}
function markdownToBlockNote(markdown, previous) {
  markdown = markdown.replace(/<!--nodus:academic-projection-->[\s\S]*?<!--\/nodus:academic-projection-->/g, "").trimEnd();
  if (previous) assertAcademicProjection(previous, markdown);
  const available = /* @__PURE__ */ new Map();
  const ordered = [];
  const used = /* @__PURE__ */ new Set();
  const remember = (blocks) => blocks.forEach((block2) => {
    ordered.push(block2);
    const key = nativeBlockMarkdown(block2);
    available.set(key, [...available.get(key) ?? [], block2]);
    if (block2.children?.length) remember(block2.children);
  });
  if (previous) remember(previous);
  const pages = markdownToPageBlocks(markdown);
  const result = pages.map((entry) => {
    const source = pageBlockToMarkdown(entry);
    const old = available.get(source)?.shift();
    if (old) used.add(old.id);
    return old ? { ...JSON.parse(JSON.stringify(old)), children: [] } : pageBlockNative(entry, source);
  });
  result.forEach((block2, index) => {
    if (used.has(block2.id)) return;
    const old = ordered[index];
    if (old && !used.has(old.id) && old.type === block2.type) {
      block2.id = old.id;
      block2.props = { ...old.props, ...block2.props };
      used.add(old.id);
    }
  });
  const roots = [];
  const stack = [];
  result.forEach((block2, index) => {
    const indent = Number(pages[index].content?.indent ?? 0);
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    if (indent > 0 && stack.length && /ListItem$/.test(block2.type)) stack.at(-1).block.children.push(block2);
    else roots.push(block2);
    if (/ListItem$/.test(block2.type)) stack.push({ indent, block: block2 });
    else stack.length = 0;
  });
  return roots;
}
function findNativeBlock(document, id) {
  for (const block2 of document) {
    if (block2.id === id) return block2;
    const child = block2.children && findNativeBlock(block2.children, id);
    if (child) return child;
  }
  return null;
}
function nativePlainText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && value.type === "tableContent") {
    return (value.rows ?? []).map((row) => row.cells.map((cell) => nativePlainText(Array.isArray(cell) ? cell : cell?.content)).join("	")).join("\n");
  }
  if (!Array.isArray(value)) return "";
  return value.map((item) => item.text ?? (["nodusCitation", "nodusCrossReference"].includes(item.type) ? String(item.props?.label ?? "") : item.type === "nodusFootnote" ? "[Nota]" : item.type === "nodusWiki" ? String(item.props?.label ?? "") : item.type === "nodusFormula" ? String(item.props?.formula ?? "") : nativePlainText(item.content))).join("");
}
function nativeDocumentText(document) {
  return document.map((block2) => (nativePlainText(block2.content) || String(block2.props.markdown ?? "")) + (block2.children?.length ? "\n" + nativeDocumentText(block2.children) : "")).join("\n");
}
function cloneNativeDocument(document) {
  return document.map((block2) => ({ ...JSON.parse(JSON.stringify(block2)), id: globalThis.crypto.randomUUID(), children: cloneNativeDocument(block2.children ?? []) }));
}
function assertAcademicProjection(previous, markdown) {
  const visit = (blocks) => {
    for (const block2 of blocks) {
      const inline = (content) => {
        if (Array.isArray(content)) for (const item of content) {
          if (["nodusCitation", "nodusFootnote", "nodusCrossReference"].includes(item.type) && !markdown.includes(encodeURIComponent(JSON.stringify(item)))) throw new Error("ACADEMIC_PROJECTION_CONFLICT: Esta edici\xF3n eliminar\xEDa citas o notas estructuradas. Abre Scriptor para resolverla; el borrador se conserva.");
          if (item.content) inline(item.content);
        }
        else if (content && typeof content === "object") for (const row of content.rows ?? []) for (const cell of row.cells) inline(Array.isArray(cell) ? cell : cell.content);
      };
      inline(block2.content);
      visit(block2.children ?? []);
    }
  };
  visit(previous);
}
export {
  BLOCKNOTE_SCHEMA_VERSION,
  assertAcademicProjection,
  blockNoteToMarkdown,
  blockNoteToPageBlocks,
  cloneNativeDocument,
  findNativeBlock,
  markdownInline,
  markdownToBlockNote,
  nativeBlockMarkdown,
  nativeDocumentText,
  nativeInlineMarkdown,
  nativePlainText,
  pageBlocksToBlockNote,
  parseNativeDocument,
  validateBlockNoteDocument
};
