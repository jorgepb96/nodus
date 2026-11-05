import type { ModelRef, TranslationLanguage } from '@shared/types';
import {stripLeadingAbstract} from './writingDocument';

/** One projection for the reader and the phone's source revision check. */
export function researchTranslationSource(draft: {title:string;abstract?:string;draftMarkdown:string}): string {
  return `# ${draft.title}\n\n${draft.abstract ? `${draft.abstract}\n\n` : ''}${stripLeadingAbstract(draft.draftMarkdown,draft.abstract ?? '')}`;
}

// AI translation of a report/immersion assembled as Markdown. The document is
// translated in order-preserving chunks (a long report exceeds a single model
// response), each chunk instructed to keep Markdown structure and citation links
// intact so the translated copy still renders — and still cites — correctly.

// Character budget per chunk. Translation output is roughly the same length as the
// input, so this keeps each response comfortably inside the model's token limit
// while minimizing the number of round-trips.
const CHUNK_CHARS = 5000;
// Give each chunk enough room to grow (some languages are wordier than the source).
const CHUNK_MAX_TOKENS = 4000;

function translationSystemPrompt(language: TranslationLanguage): string {
  const target = `${language.name} (${language.nativeName})`;
  return `You are an expert academic and literary translator. Translate the user's Markdown document into ${target}.

STRICT RULES:
- Output ONLY the translated Markdown. No preamble, no explanations, no notes, and do NOT wrap the whole document in a code fence.
- Preserve the Markdown structure EXACTLY: heading levels (#, ##, ###), ordered/unordered lists, bold/italic, blockquotes (>), horizontal rules, and blank lines. Keep tables intact — the same number of columns, the same | pipes and the |---| separator row.
- Do NOT translate, reformat, or remove any URL or link target. Links look like [visible text](url): translate the visible text but copy the url character-for-character. This is critical for links whose url starts with "nodus://" — they are citations and MUST stay byte-identical.
- Do NOT alter numbers, dates, code, math, or reference keys.
- Translate the running prose, headings, list items, table cells, and quoted passages into ${target}. Keep quotation marks and any author/year attribution.
- Keep the meaning faithful and the register academic. Do NOT summarize, add, or omit content.
- If a span is already written in ${target}, leave it unchanged.`;
}

interface TranslationChunk { markdown: string; joiner: string; verbatim: boolean; repeatedTableHeader?: boolean }

/** Preserve block boundaries, opaque code/math and every table row. A long prose
 * paragraph may use several calls, but is reassembled as the same paragraph. */
function translationChunks(markdown: string, maxChars = CHUNK_CHARS): TranslationChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 128) throw new Error('translation_invalid_chunk_budget');
  const blocks: TranslationChunk[] = [];
  let text = '', joiner = '', fence: {mark:string;length:number} | null = null, opaque = false;
  const flush = () => { if (text) { blocks.push({markdown:text,joiner,verbatim:opaque}); text='';joiner='';opaque=false; } };
  for (const line of markdown.split('\n')) {
    if (fence) {
      text += '\n'+line;
      const close = line.trim();
      if (fence.mark === '$$' ? close === '$$' : new RegExp('^'+(fence.mark === '`' ? '`' : '~')+'{'+fence.length+',}\\s*$').test(close)) fence=null;
      continue;
    }
    const opening=/^\s*(`{3,}|~{3,})[^\n]*$/.exec(line);
    if (opening || line.trim()==='$$') {
      if (text) { flush();joiner='\n'; }
      text=line;opaque=true;fence=opening?{mark:opening[1][0],length:opening[1].length}:{mark:'$$',length:2};
    } else if (!line.trim()) {
      if (text) { flush();joiner='\n\n'; }
      else joiner += '\n';
    } else if (opaque) { flush();joiner='\n';text=line; }
    else text += (text ? '\n' : '')+line;
  }
  flush();
  const parts: TranslationChunk[]=[];
  const splitLine=(line:string):Array<{text:string;separator:string}>=>{
    const spans=[...line.matchAll(/!?\[[^\]\n]*\]\([^\n)]*\)|`[^`\n]*`|\$[^$\n]+\$|\*\*[^*\n]+\*\*|__[^_\n]+__|<[^>\n]*>/g)]
      .map(hit=>({from:hit.index!,to:hit.index!+hit[0].length}));
    const result:Array<{text:string;separator:string}>=[];
    let start=0,separator='';
    while(line.length-start>maxChars) {
      const positions=[...line.slice(start,start+maxChars+1).matchAll(/\s+/g)]
        .filter(hit=>hit.index!>0 && !spans.some(span=>start+hit.index!>=span.from && start+hit.index!<span.to));
      const boundary=positions.at(-1);
      if (!boundary) throw new Error('translation_protected_block_too_large');
      const end=start+boundary.index!;
      result.push({text:line.slice(start,end),separator});separator=boundary[0];start=end+boundary[0].length;
    }
    if(line.slice(start))result.push({text:line.slice(start),separator});
    return result;
  };
  for (const block of blocks) {
    if (block.verbatim || block.markdown.length<=maxChars) { parts.push(block);continue; }
    const lines=block.markdown.split('\n');
    const table=lines.length>=2 && /^\s*\|.*\|\s*$/.test(lines[0]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1]);
    if(table) {
      const header=lines.slice(0,2).join('\n');
      let current=header,first=true;
      for(const row of lines.slice(2)) {
        if(header.length+1+row.length>maxChars)throw new Error('translation_table_row_too_large');
        if(current.length+1+row.length>maxChars) {
          parts.push({markdown:current,joiner:first?block.joiner:'\n',verbatim:false,repeatedTableHeader:!first});first=false;current=header;
        }
        current+='\n'+row;
      }
      parts.push({markdown:current,joiner:first?block.joiner:'\n',verbatim:false,repeatedTableHeader:!first});
      continue;
    }
    let first=true;
    for(const line of lines) {
      const pieces=line.length<=maxChars?[{text:line,separator:''}]:splitLine(line);
      for(let i=0;i<pieces.length;i++) {
        parts.push({markdown:pieces[i].text,joiner:first?block.joiner:i===0?'\n':pieces[i].separator,verbatim:false});first=false;
      }
    }
  }
  // Pack ordinary blocks while retaining their original separators. Table
  // continuation headers and opaque blocks have their own assembly rules.
  const packed:TranslationChunk[]=[];
  for(const part of parts) {
    const last=packed.at(-1);
    if(last && !last.verbatim && !part.verbatim && !last.repeatedTableHeader && !part.repeatedTableHeader
      && last.markdown.length+part.joiner.length+part.markdown.length<=maxChars) last.markdown+=part.joiner+part.markdown;
    else packed.push({...part});
  }
  return packed.length?packed:[{markdown,joiner:'',verbatim:false}];
}

export function chunkMarkdown(markdown: string, maxChars = CHUNK_CHARS): string[] {
  return translationChunks(markdown,maxChars).map(chunk=>chunk.markdown);
}

/** Strip a stray leading/trailing ``` fence a model may add around a whole chunk. */
function stripWrappingFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

export interface TranslateOptions {
  markdown: string;
  language: TranslationLanguage;
  model?: ModelRef | null;
  onProgress?: (done: number, total: number) => void;
}

/** Translate an assembled Markdown document. Returns the translated Markdown; the
 *  caller derives the display title from its first heading. */
export async function translateMarkdownWith(opts: TranslateOptions, complete: (prompt: {system: string; user: string; temperature: number; maxTokens: number}, model?: ModelRef | null) => Promise<string>): Promise<string> {
  const { markdown, language, model, onProgress } = opts;
  const system = translationSystemPrompt(language);
  const chunks = translationChunks(markdown);
  const out: string[] = [];
  onProgress?.(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const translated = chunk.verbatim ? chunk.markdown : await complete(
      { system, user: chunk.markdown, temperature: 0.2, maxTokens: CHUNK_MAX_TOKENS },
      model
    );
    const clean = chunk.verbatim ? translated :
      (chunk.markdown.match(/^\s*/)?.[0] ?? '') + stripWrappingFence(translated).trim() + (chunk.markdown.match(/\s*$/)?.[0] ?? '');
    assertTranslationIntegrity(chunk.markdown, clean);
    const body = chunk.repeatedTableHeader ? clean.split('\n').slice(2).join('\n') : clean;
    out.push((i ? chunk.joiner : '') + body);
    onProgress?.(i + 1, chunks.length);
  }
  const result = out.join('').trim();
  assertTranslationIntegrity(markdown, result);
  return result;
}

/** The translated document's title: the first Markdown heading, else a fallback. */
export function titleFromMarkdown(markdown: string, fallback: string): string {
  const match = /^#{1,3}\s+(.+)$/m.exec(markdown);
  return match ? match[1].trim() : fallback;
}

/** A translated copy must still lead to the same sources and retain protected spans. */
export function assertTranslationIntegrity(source: string, translated: string): void {
  if (!translated.trim()) throw new Error('translation_empty_response');
  const protectedSpans = (markdown: string) => {
    const spans = Array.from(markdown.matchAll(/!?(?:\[[^\]\n]*\])\(([^\s)]+)(?:\s+[^)]*)?\)/g), hit => hit[1]);
    spans.push(...Array.from(markdown.matchAll(/(?:https?:\/\/|nodus:\/\/)[^\s)\]"<>]+/g), hit => hit[0]));
    spans.push(...Array.from(markdown.matchAll(/```[^\n]*\n([\s\S]*?)```|`[^`\n]+`|\$\$[\s\S]*?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)/g), hit => hit[0]));
    return spans.sort();
  };
  if (JSON.stringify(protectedSpans(source)) !== JSON.stringify(protectedSpans(translated))) throw new Error('translation_changed_protected_content');
  const numbers = (markdown: string) => Array.from(markdown.matchAll(/\p{N}+(?:[.,:/-]\p{N}+)*/gu), hit => hit[0]).sort();
  if (JSON.stringify(numbers(source)) !== JSON.stringify(numbers(translated))) throw new Error('translation_changed_numbers');
  const tables = (markdown: string) => markdown.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line))
    .map(line => line.replace(/\\\|/g,'').split('|').length);
  if (JSON.stringify(tables(source)) !== JSON.stringify(tables(translated))) throw new Error('translation_changed_table_structure');
  const headings = (markdown: string) => Array.from(markdown.matchAll(/^(#{1,6})\s/gm), hit => hit[1]);
  if (JSON.stringify(headings(source)) !== JSON.stringify(headings(translated))) throw new Error('translation_changed_structure');
}
