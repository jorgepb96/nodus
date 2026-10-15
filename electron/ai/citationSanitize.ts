// Pure citation helpers shared by the suggestion pipeline. Kept free of any
// Electron/DB imports so they can be unit-tested in isolation: parsing,
// de-duplicating and — critically — stripping any nodus:// citation that the
// model is not allowed to use, so a hallucinated passage id never reaches the
// rendered text as a broken "⚠" link.
import type { CitationRef, PromptLanguage } from '@shared/types';
import { citationWords } from '../../shared/citationWords';

/** Citation kinds a project suggestion may reference (passages are never project materials). */
export const CITATION_KINDS: CitationRef['kind'][] = ['idea', 'work', 'gap', 'contradiction'];

/** Every kind that can appear in a nodus:// URL, used only to find links in text. */
const ALL_LINK_KINDS = '(idea|work|gap|contradiction|passage)';

/** Provider output is untrusted text. A cut-off percent escape must make the
 * citation unverifiable, never abort an otherwise valid chat response. */
function safeDecodeCitationId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function citationUrl(ref: CitationRef): string {
  return `nodus://${ref.kind}/${encodeURIComponent(ref.id)}`;
}

/** The contract's instruction, in the language the answer is written in. */
const CITATION_CONTRACT_REQUIREMENT: Record<PromptLanguage, string> = {
  es: 'La respuesta es inválida si usa el corpus sin incluir citas Markdown verificables. Después de cada afirmación sustantiva, copia el destino exacto de una fuente pertinente de esta lista y escribe como texto visible «Autor, Año»; no inventes ids, no cites orientación documental y no agrupes todas las citas solo al final.',
  en: 'The answer is invalid if it uses the corpus without verifiable Markdown citations. After each substantive claim, copy the exact target of a relevant source from this list and write «Author, Year» as the visible text; do not invent ids, do not cite documentary orientation, and do not group every citation at the end.',
  fr: 'La réponse est invalide si elle utilise le corpus sans citations Markdown vérifiables. Après chaque affirmation substantielle, copiez la cible exacte d’une source pertinente de cette liste et écrivez « Auteur, Année » comme texte visible ; n’inventez pas d’identifiants, ne citez pas l’orientation documentaire et ne regroupez pas toutes les citations à la fin.',
  de: 'Die Antwort ist ungültig, wenn sie das Korpus ohne überprüfbare Markdown-Zitate verwendet. Kopieren Sie nach jeder inhaltlichen Aussage das exakte Ziel einer passenden Quelle aus dieser Liste und schreiben Sie „Autor, Jahr“ als sichtbaren Text; erfinden Sie keine IDs, zitieren Sie keine Dokumentorientierung und sammeln Sie nicht alle Zitate am Ende.',
  pt: 'A resposta é inválida se usar o corpus sem citações Markdown verificáveis. Depois de cada afirmação substantiva, copia o destino exato de uma fonte pertinente desta lista e escreve «Autor, Ano» como texto visível; não inventes ids, não cites a orientação documental e não agrupes todas as citações no final.',
  'pt-BR': 'A resposta é inválida se usar o corpus sem citações Markdown verificáveis. Depois de cada afirmação substantiva, copie o destino exato de uma fonte pertinente desta lista e escreva “Autor, Ano” como texto visível; não invente ids, não cite a orientação documental e não agrupe todas as citações no final.',
  it: 'La risposta non è valida se usa il corpus senza citazioni Markdown verificabili. Dopo ogni affermazione sostanziale, copia la destinazione esatta di una fonte pertinente da questo elenco e scrivi «Autore, Anno» come testo visibile; non inventare id, non citare l’orientamento documentale e non raggruppare tutte le citazioni alla fine.',
  tr: 'Yanıt, derlemi doğrulanabilir Markdown atıfları olmadan kullanırsa geçersizdir. Her önemli iddiadan sonra bu listeden ilgili bir kaynağın tam hedefini kopyalayın ve görünen metin olarak “Yazar, Yıl” yazın; kimlik uydurmayın, belge yönlendirmesine atıf yapmayın ve tüm atıfları sona toplamayın.',
  'zh-Hans': '如果回答使用了语料库却没有可验证的 Markdown 引用，则回答无效。每个实质性论断之后，从此列表中复制相关来源的准确目标，并以“作者, 年份”作为可见文本；不要编造 id，不要引用文献导引，也不要把所有引用都集中在结尾。',
  'zh-Hant': '如果回答使用了語料庫卻沒有可驗證的 Markdown 引用，則回答無效。每個實質性論斷之後，從此清單中複製相關來源的準確目標，並以「作者, 年份」作為可見文字；不要編造 id，不要引用文獻導引，也不要把所有引用都集中在結尾。',
  vi: 'Câu trả lời không hợp lệ nếu dùng kho ngữ liệu mà không có trích dẫn Markdown kiểm chứng được. Sau mỗi khẳng định quan trọng, hãy sao chép đúng đích của một nguồn phù hợp trong danh sách này và viết «Tác giả, Năm» làm văn bản hiển thị; không bịa id, không trích dẫn phần định hướng tài liệu và không dồn mọi trích dẫn xuống cuối.',
  ja: 'コーパスを使いながら検証可能な Markdown 引用を含まない回答は無効です。実質的な主張のたびに、このリストから該当する出典の正確なリンク先をコピーし、表示テキストには「著者, 年」と書いてください。id を作らず、文書ガイドを引用せず、引用を末尾にまとめないでください。',
  ru: 'Ответ недействителен, если он использует корпус без проверяемых ссылок Markdown. После каждого содержательного утверждения скопируйте точную цель подходящего источника из этого списка и напишите «Автор, Год» как видимый текст; не выдумывайте идентификаторы, не цитируйте документальные ориентиры и не собирайте все ссылки в конце.',
  uk: 'Відповідь недійсна, якщо вона використовує корпус без перевірюваних посилань Markdown. Після кожного змістовного твердження скопіюйте точну ціль відповідного джерела з цього списку та напишіть «Автор, Рік» як видимий текст; не вигадуйте ідентифікатори, не цитуйте документальні орієнтири й не збирайте всі посилання наприкінці.',
  ko: '코퍼스를 사용하면서 검증 가능한 Markdown 인용이 없으면 답변은 무효입니다. 실질적인 주장마다 이 목록에서 관련 출처의 정확한 대상을 복사하고 보이는 텍스트로 "저자, 연도"를 쓰세요. id를 지어내지 말고, 문헌 안내를 인용하지 말고, 모든 인용을 끝에 몰아 두지 마세요.',
};

/**
 * Keep the citation contract close to the end of very large chat prompts. Some
 * providers follow the system rule in short contexts but omit every link once
 * tens of thousands of source tokens sit between that rule and the answer.
 * These are not new or inferred sources: every target is copied from the exact
 * context and the normal existence + in-context allow-list still runs after
 * generation.
 *
 * The placeholder label is written in the answer's language, because a model
 * that copies the target whole would otherwise show it to the reader; the
 * label repair afterwards replaces it with the source's author-year anyway.
 */
export function buildCitationOutputContract(sourceContext: string, language: PromptLanguage = 'es'): {
  requirement: string;
  exactTargets: string[];
} | null {
  const refs = extractCitationRefs(sourceContext);
  if (!refs.length) return null;
  const label = citationWords(language).source;
  return {
    requirement: CITATION_CONTRACT_REQUIREMENT[language] ?? CITATION_CONTRACT_REQUIREMENT.en,
    exactTargets: refs.slice(0, 40).map((ref) => `[${label}](${citationUrl(ref)})`),
  };
}

export function dedupeRefs(refs: CitationRef[]): CitationRef[] {
  const seen = new Set<string>();
  const out: CitationRef[] = [];
  for (const ref of refs) {
    if (!ref?.kind || !ref.id) continue;
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: ref.kind, id: ref.id });
  }
  return out;
}

/** Keep only refs of an allowed project-citation kind, de-duplicated. */
export function normalizeRefs(refs: CitationRef[]): CitationRef[] {
  return dedupeRefs((refs ?? []).filter((ref) => ref?.kind && ref.id && CITATION_KINDS.includes(ref.kind)));
}

/** All distinct nodus:// citations referenced in a piece of markdown. */
export function extractCitationRefs(text: string): CitationRef[] {
  const out: CitationRef[] = [];
  const re = new RegExp(`nodus:\\/\\/${ALL_LINK_KINDS}\\/([^\\s)"'<>]+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ kind: match[1] as CitationRef['kind'], id: safeDecodeCitationId(match[2]) });
  }
  return dedupeRefs(out);
}

/** Drop any [label](nodus://kind/id) whose `kind:id` isn't allowed, then tidy spacing/punctuation. */
export function stripDisallowedCitations(text: string, allowed: Set<string>): string {
  return (
    text
      // 1) Markdown citation links: keep allowed kind/id, drop everything else.
      .replace(new RegExp(`\\[([^\\]]*)\\]\\(nodus:\\/\\/${ALL_LINK_KINDS}\\/([^\\s)]+)\\)`, 'g'), (match, label, kind, id) => {
        const key = `${kind}:${safeDecodeCitationId(id)}`;
        return label.trim() && allowed.has(key) ? match : '';
      })
      // A repaired bare target can sit beside the auditor's canonical citation.
      // Collapse only adjacent links to the same target, never citations on
      // separate sentences or different evidence sources.
      .replace(new RegExp(`(\\[[^\\]]+\\]\\((nodus:\\/\\/(?:${ALL_LINK_KINDS.slice(1, -1)})\\/[^\\s)]+)\\))([.!?])?(?:[ \\t]+\\[[^\\]]+\\]\\(\\2\\)([.!?])?)+`, 'g'), (match, firstLink: string) => {
        const punctuation = [...match.matchAll(/\]\(nodus:\/\/[^)]+\)([.!?])?/g)].map((part) => part[1] ?? '');
        const meaningfulMarks = [...new Set(punctuation.filter(Boolean))];
        if (meaningfulMarks.length > 1) return match;
        return firstLink + (meaningfulMarks[0] ?? '');
      })
      // 2) A provider may stop mid-link or put spaces inside a malformed URL.
      // Such a link cannot be clicked or verified, so remove the whole citation
      // chip (up to the line/end) instead of leaking a broken nodus:// target.
      .replace(/\[[^\]]*\]\(nodus:\/\/[^\n)]*\s+[^\n)]*\)/g, '')
      .replace(/\[[^\]]*\]\(nodus:\/\/[^\n)]*$/gm, '')
      // 3) Any leftover bare nodus:// URL in prose — including malformed ones with
      //    no kind (e.g. `nodus://<uuid>`). The lookbehind protects the `](nodus://…)`
      //    of the allowed links kept above so we only remove stray prose URLs.
      .replace(/(?<!\]\()nodus:\/\/[^\s)\]]+/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:)])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/[([]\s*$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Keep only citations that both resolve locally and were actually present in the model's source context. */
export function supportedCitationKeys(
  refs: CitationRef[],
  verified: Record<string, boolean>,
  sourceContext: string,
): Set<string> {
  const allowed = new Set<string>();
  for (const ref of dedupeRefs(refs)) {
    const key = `${ref.kind}:${ref.id}`;
    if (verified[key] !== true) continue;
    const encoded = encodeURIComponent(ref.id);
    if (sourceContext.includes(ref.id) || sourceContext.includes(encoded)) allowed.add(key);
  }
  return allowed;
}

/** Encode citation ids canonically so passage ids containing `#` remain path data, not URL fragments. */
export function canonicalizeCitationLinks(text: string): string {
  const repairedLocators = text.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(nodus:\\/\\/${ALL_LINK_KINDS}\\/([^,\\s)]+),\\s*((?:p(?:á|a)?g?\\.?|page)\\s*\\d+)\\)`, 'gi'),
    (_match, label: string, kind: string, rawId: string, locator: string) => {
      const visible = label.toLocaleLowerCase().includes(locator.toLocaleLowerCase()) ? label : `${label}, ${locator}`;
      return `[${visible}](nodus://${kind}/${rawId})`;
    },
  );
  return repairedLocators.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(nodus:\\/\\/${ALL_LINK_KINDS}\\/([^\\s)]+)\\)`, 'g'),
    (_match, label: string, kind: string, rawId: string) => {
      let id = rawId;
      try { id = decodeURIComponent(rawId); } catch { /* retain the provider text for deterministic encoding */ }
      return `[${label}](nodus://${kind}/${encodeURIComponent(id)})`;
    },
  );
}

/**
 * A provider can copy the exact id from its source menu while putting it under
 * the wrong Nodus kind (for example, `idea/<work uuid>`). Correct that typo only
 * when the id identifies exactly one allowed source. Ambiguous or invented ids
 * are deliberately left untouched so the normal allow-list pass removes them.
 */
export function alignCitationKindsToAllowed(text: string, allowedRefs: CitationRef[]): string {
  const allowed = dedupeRefs(allowedRefs);
  const allowedKeys = new Set(allowed.map((ref) => `${ref.kind}:${ref.id}`));
  const byId = new Map<string, CitationRef[]>();
  for (const ref of allowed) byId.set(ref.id, [...(byId.get(ref.id) ?? []), ref]);

  return text.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(nodus:\\/\\/${ALL_LINK_KINDS}\\/([^\\s)]+)\\)`, 'g'),
    (whole, label: string, kind: CitationRef['kind'], rawId: string) => {
      const id = safeDecodeCitationId(rawId);
      if (allowedKeys.has(`${kind}:${id}`)) return `[${label}](${citationUrl({ kind, id })})`;
      const candidates = byId.get(id) ?? [];
      return candidates.length === 1 ? `[${label}](${citationUrl(candidates[0])})` : whole;
    },
  );
}
