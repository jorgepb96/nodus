import { researchConsistencyUnverified, researchCoverageIncomplete, researchEvidenceLimitation } from '@shared/researchEvidenceMessages';
import { reconcileResearchReport, researchProseSpans, researchSentenceKey, type ResearchConflict, type ResearchProseAudit, type ResearchClaimRecord } from '@shared/researchClaimAudit';
// Citation naming lives in @shared/citationLabel so the reader that re-derives a
// stored label at open time cannot drift from the writer that produced it.
import {
  authorYearLabel,
  referenceEntry as sharedReferenceEntry,
  sourceLabelFromWork,
} from '@shared/citationLabel';
import { citationWords } from '@shared/citationWords';
import type {
  DeepResearchMeta,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  PromptLanguage,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
  WritingWorkshopSnapshot,
  SupportAuditEntry,
} from '@shared/types';
import {
  normalizeDeepResearchSectionLength,
  planDeepResearchSectionLength,
  type DeepResearchSectionLengthPlan,
} from '@shared/deepResearchSectionLength';
import {
  assessDeepResearchReport,
  assessDeepResearchSection,
  qualityPasses,
  shouldAcceptEditorialRevision,
  shouldAcceptEvidenceRepair,
  shouldAcceptQualityRevision,
  type DeepResearchQualitySource,
  type DeepResearchSectionQuality,
} from '@shared/deepResearchQuality';

// ─────────────────────────────────────────────────────────────────────────────
// Pure orchestration core for Deep Research. This module has NO Electron / DB /
// AI-provider imports (only erased type imports), so the whole control flow —
// planning, coverage, citation policy and assembly — can be
// unit-tested with injected fakes. The AI/DB wiring lives in ./deepResearch.ts.
//
// Provider calls remain technically bounded, but editorial completeness is driven
// by evidence and coverage rather than a word/page target.
// ─────────────────────────────────────────────────────────────────────────────

/** Descriptive conversion used only in progress/result metadata, never planning. */
const OBSERVED_WORDS_PER_PAGE = 450;
/** Never fewer than this many sections (intro · body · synthesis at the very least). */
export const MIN_SECTIONS = 3;
/** Trim the material pool handed to the planner so the prompt stays within limits. */
export const POOL_LIMITS = { ideas: 70, themes: 20, gaps: 20, contradictions: 16, works: 40, passages: 32 } as const;
const MAX_MATRIX_ROWS = 80;
/**
 * A section can only develop so much material in one pass. Beyond this the citation
 * menu turns into a catalogue the writer skims instead of an argument it builds, so
 * surplus ideas are left for the coverage top-up rather than dumped into a section.
 */
export const MAX_SECTION_IDEAS = 18;
/** Maximum number of atomic requirements preserved from a complex research brief.
 * Ten clipped real objectives that separately named institutions, operations,
 * chronology and historiographical tests. Sixteen keeps those requirements intact
 * while still bounding every downstream prompt and retrieval loop. */
export const MAX_COVERAGE_QUESTIONS = 16;
/** How much of an idea's statement reaches the writer. */
const IDEA_NOTE_CHARS = 240;
/** Share a bounded prompt allowance across passages instead of discarding the end
 * of every retrieved chunk, even when a small corpus fits in full. */
function passageExcerpts(passages: Array<{ id: string; text: string }>): Map<string, string> {
  let remaining = 32_000;
  const ordered = [...new Map(passages.map(passage => [passage.id, passage])).values()]
    .sort((a, b) => a.text.length - b.text.length);
  const excerpts = new Map<string, string>();
  ordered.forEach((passage, index) => {
    const allowance = Math.min(6_000, Math.floor(remaining / (ordered.length - index)));
    const excerpt = allowance > 0 ? clip(passage.text, allowance) : '';
    excerpts.set(passage.id, excerpt);
    remaining -= excerpt.length;
  });
  return excerpts;
}
/** Extra material a per-section retrieval may add on top of what the planner assigned. */
export const SECTION_RETRIEVAL_LIMITS = { ideas: 6, passages: 6 } as const;
/** One focused retry is allowed when the epistemic audit cannot answer an atomic
 * requirement. It asks only for the missing questions and a wider passage window. */
const MAX_COVERAGE_RECOVERY_PASSES = 1;
export const COVERAGE_RECOVERY_RETRIEVAL_LIMITS = { ideas: 2, passages: 12 } as const;
/** How many flagged claims the audit lists. Enough to spot-check, not a second report. */
const MAX_SUPPORT_AUDIT = 40;

/** Shared prose contract for every Deep Research writer, including genealogy and
 * MCP-client mode. These are writing constraints, not a locale-specific UI copy. */
export const DEEP_RESEARCH_NARRATIVE_RULES = [
  'Prioriza una narración argumental continua, bien hilada y razonada. Cada párrafo debe avanzar desde el anterior mediante transiciones naturales.',
  'Cada párrafo debe cumplir una función inferencial nueva. No repitas la tesis central, una conclusión o la misma cautela metodológica en varias secciones con palabras distintas.',
  'Integra cada cita inmediatamente después de la cláusula concreta que sostiene. Evita racimos mecánicos de referencias al final del párrafo; si varias fuentes aportan cosas distintas, atribuye y explica cada aportación en la frase correspondiente.',
  'Distingue con precisión cuatro niveles: dato documentado, interpretación de un autor, inferencia construida por el informe y cuestión que el corpus no permite resolver. No presentes una inferencia causal o una metáfora de control como hecho probado.',
  'Antes de afirmar un mecanismo, una causalidad, un efecto o una recepción, comprueba que la evidencia sostiene esa relación específica, además del tema, actor, escala y periodo. Una intención no demuestra un efecto y una audiencia prevista no demuestra recepción.',
  'Cuando exista desacuerdo, desarrolla el debate completo: qué sostiene cada posición, en qué evidencia o escala descansa, por qué divergen y qué dato permitiría decidir entre ellas. No basta con anunciar que hay debate o contradicción.',
  'No declares consenso, convergencia, divergencia ni contradicción con evidencia de un solo lado. Identifica y cita cada posición por separado; si falta una, presenta el hueco como límite probatorio.',
  'Si el encargo pide un debate historiográfico, atribuye cada posición a los autores u obras que figuren en el menú de evidencias y contrasta sus corpus, periodizaciones o escalas. Si el material no identifica posiciones nominales suficientes, decláralo como límite en vez de inventar una escuela o un consenso.',
  'Usa pocos epígrafes amplios. Dentro de cada sección no añadas subtítulos, microsecciones, rótulos temáticos ni encabezados adicionales.',
  'No conviertas cada idea, fuente, autor, periodo o matiz en una sección independiente. Intégralos dentro de una misma línea argumental cuando formen parte del mismo movimiento del razonamiento.',
  'Evita los dos puntos, el punto y coma y el guion largo. Úsalos únicamente cuando sean estrictamente necesarios, por ejemplo dentro de una cita literal o una referencia que deba conservarse.',
  'Prefiere frases completas enlazadas con puntos, comas y conectores discursivos. Evita párrafos que comiencen con etiquetas como «Contexto:», «Evidencia:» o «Conclusión:».',
  'No uses listas salvo que la información no pueda expresarse con claridad como prosa continua.',
] as const;

/** Native versions of the shared writer contract.  These rules deliberately keep
 * the same thirteen slots as the historical Spanish contract so adding a locale
 * cannot silently drop a safety rule.  User-provided evidence, citation tokens,
 * headings and other literal data are never translated by this pack. */
const NATIVE_NARRATIVE_RULES: Record<PromptLanguage, readonly string[]> = {
  es: DEEP_RESEARCH_NARRATIVE_RULES,
  en: [
    'Prioritize a continuous, well-connected and reasoned argument. Each paragraph must advance from the previous one through natural transitions.',
    'Each paragraph must perform a new inferential function. Do not repeat the central thesis, a conclusion or the same methodological caveat in several sections with different wording.',
    'Place each citation immediately after the concrete clause it supports. Avoid mechanical clusters of references at paragraph ends; when sources contribute different things, attribute and explain each contribution in its sentence.',
    'Distinguish precisely four levels: documented fact, an author’s interpretation, an inference constructed by the report, and a question the corpus cannot resolve. Do not present causal inference or a control metaphor as proven fact.',
    'Before asserting a mechanism, causality, effect or reception, check that the evidence supports that specific relation as well as topic, actor, scale and period. Intention does not prove effect, and an intended audience does not prove reception.',
    'When disagreement exists, develop the full debate: what each position claims, which evidence or scale supports it, why they diverge and what data could decide between them. Merely announcing a debate or contradiction is insufficient.',
    'Do not declare consensus, convergence, divergence or contradiction from one-sided evidence. Identify and cite each position separately; if one is missing, present the gap as an evidentiary limit.',
    'If the brief requests a historiographical debate, attribute each position to authors or works in the evidence menu and compare their corpora, periods or scales. If there are not enough named positions, state the limit rather than inventing a school or consensus.',
    'Use a few broad headings. Within each section add no subtitles, micro-sections, thematic labels or additional headings.',
    'Do not turn every idea, source, author, period or nuance into an independent section. Integrate them into one argumentative line when they belong to the same reasoning movement.',
    'Avoid colons, semicolons and em dashes. Use them only when strictly necessary, for example inside a verbatim quotation or a reference that must be preserved.',
    'Prefer complete sentences joined with periods, commas and discourse connectors. Avoid paragraphs beginning with labels such as “Context:”, “Evidence:” or “Conclusion:”.',
    'Do not use lists unless the information cannot be expressed clearly as continuous prose.',
  ],
  fr: [
    'Privilégie une argumentation continue, bien liée et raisonnée. Chaque paragraphe doit progresser depuis le précédent par des transitions naturelles.',
    'Chaque paragraphe doit remplir une nouvelle fonction inférentielle. Ne répète pas la thèse centrale, une conclusion ou la même réserve méthodologique dans plusieurs sections sous des formulations différentes.',
    'Intègre chaque citation immédiatement après la proposition précise qu’elle étaye. Évite les grappes mécaniques de références en fin de paragraphe; si plusieurs sources apportent des éléments distincts, attribue et explique chaque apport dans la phrase correspondante.',
    'Distingue précisément quatre niveaux: fait documenté, interprétation d’un auteur, inférence construite par le rapport et question que le corpus ne permet pas de résoudre. Ne présente pas une inférence causale ou une métaphore de contrôle comme un fait établi.',
    'Avant d’affirmer un mécanisme, une causalité, un effet ou une réception, vérifie que les preuves étayent cette relation précise, ainsi que le thème, l’acteur, l’échelle et la période. Une intention ne prouve pas un effet et un public prévu ne prouve pas une réception.',
    'En cas de désaccord, développe le débat complet: ce que soutient chaque position, les preuves ou l’échelle mobilisées, la raison de la divergence et les données qui permettraient de trancher. Il ne suffit pas d’annoncer un débat ou une contradiction.',
    'Ne déclare ni consensus, ni convergence, ni divergence, ni contradiction avec des preuves d’un seul côté. Identifie et cite chaque position séparément; si l’une manque, présente la lacune comme une limite probatoire.',
    'Si la consigne demande un débat historiographique, attribue chaque position aux auteurs ou œuvres du menu de preuves et compare leurs corpus, périodes ou échelles. S’il n’y a pas assez de positions nommées, indique la limite au lieu d’inventer une école ou un consensus.',
    'Utilise quelques titres larges. Dans une section, n’ajoute ni sous-titres, ni micro-sections, ni étiquettes thématiques, ni autres en-têtes.',
    'Ne transforme pas chaque idée, source, auteur, période ou nuance en section indépendante. Intègre-les dans une même ligne argumentative lorsqu’ils relèvent du même mouvement du raisonnement.',
    'Évite les deux-points, les points-virgules et les tirets cadratins. Ne les utilise que lorsqu’ils sont strictement nécessaires, par exemple dans une citation littérale ou une référence à conserver.',
    'Préfère des phrases complètes reliées par des points, des virgules et des connecteurs. Évite les paragraphes commençant par des étiquettes comme «Contexte:», «Preuve:» ou «Conclusion:».',
    'N’utilise pas de listes lorsque l’information peut être exprimée clairement en prose continue.',
  ],
  de: [
    'Bevorzuge eine durchgehende, gut verknüpfte und begründete Argumentation. Jeder Absatz muss durch natürliche Übergänge aus dem vorherigen fortschreiten.',
    'Jeder Absatz muss eine neue inferenzielle Funktion erfüllen. Wiederhole weder die zentrale These noch ein Fazit oder dieselbe methodische Einschränkung in mehreren Abschnitten mit anderen Worten.',
    'Setze jedes Zitat unmittelbar nach die konkrete Aussage, die es stützt. Vermeide mechanische Referenzketten am Absatzende; wenn Quellen Unterschiedliches beitragen, ordne jeden Beitrag zu und erkläre ihn im passenden Satz.',
    'Unterscheide genau vier Ebenen: dokumentierte Tatsache, Interpretation eines Autors, vom Bericht gebildete Inferenz und eine Frage, die das Korpus nicht lösen kann. Stelle weder eine kausale Inferenz noch eine Kontrollmetapher als erwiesene Tatsache dar.',
    'Prüfe vor einer Aussage über Mechanismus, Kausalität, Wirkung oder Rezeption, ob die Belege diese konkrete Beziehung sowie Thema, Akteur, Maßstab und Zeitraum tragen. Absicht beweist keine Wirkung, ein vorgesehenes Publikum keine Rezeption.',
    'Entwickle bei Widerspruch die vollständige Debatte: Positionen, Belege oder Maßstab, Grund der Divergenz und Daten, die zwischen ihnen entscheiden könnten. Eine Debatte oder einen Widerspruch nur anzukündigen genügt nicht.',
    'Behaupte Konsens, Konvergenz, Divergenz oder Widerspruch nicht aufgrund einseitiger Belege. Identifiziere und zitiere jede Position getrennt; fehlt eine, stelle die Lücke als Beleggrenze dar.',
    'Wenn die Aufgabe eine historiografische Debatte verlangt, ordne jede Position den Autoren oder Werken im Belegmenü zu und vergleiche Korpora, Zeiträume oder Maßstäbe. Gibt es nicht genügend benannte Positionen, nenne die Grenze statt Schule oder Konsens zu erfinden.',
    'Verwende wenige breite Überschriften. Füge innerhalb eines Abschnitts keine Untertitel, Mikroabschnitte, thematischen Bezeichnungen oder weiteren Überschriften hinzu.',
    'Mache nicht aus jeder Idee, Quelle, jedem Autor, Zeitraum oder jeder Nuance einen eigenen Abschnitt. Integriere sie in eine argumentative Linie, wenn sie zur selben Denkbewegung gehören.',
    'Vermeide Doppelpunkte, Semikolons und Gedankenstriche. Verwende sie nur, wenn unbedingt nötig, etwa in einem wörtlichen Zitat oder einer zu bewahrenden Referenz.',
    'Bevorzuge vollständige Sätze mit Punkten, Kommas und Verknüpfungen. Beginne Absätze nicht mit Bezeichnungen wie „Kontext:“, „Beleg:“ oder „Fazit:“.',
    'Verwende keine Listen, wenn sich die Information klar als fortlaufende Prosa ausdrücken lässt.',
  ],
  pt: [
    'Privilegia uma narrativa argumentativa contínua, bem articulada e fundamentada. Cada parágrafo deve avançar a partir do anterior através de transições naturais.',
    'Cada parágrafo deve cumprir uma nova função inferencial. Não repitas a tese central, uma conclusão ou a mesma cautela metodológica em várias secções com palavras diferentes.',
    'Integra cada citação imediatamente depois da afirmação concreta que sustenta. Evita conjuntos mecânicos de referências no fim do parágrafo; quando as fontes contribuem de formas distintas, atribui e explica cada contribuição na frase correspondente.',
    'Distingue precisamente quatro níveis: facto documentado, interpretação de um autor, inferência construída pelo relatório e questão que o corpus não permite resolver. Não apresentes uma inferência causal ou uma metáfora de controlo como facto provado.',
    'Antes de afirmares um mecanismo, causalidade, efeito ou receção, verifica que a evidência sustenta essa relação específica, além do tema, interveniente, escala e período. Uma intenção não prova um efeito e um público previsto não prova receção.',
    'Quando houver desacordo, desenvolve o debate completo: o que defende cada posição, em que evidência ou escala assenta, por que divergem e que dados permitiriam decidir entre elas. Não basta anunciar um debate ou contradição.',
    'Não declares consenso, convergência, divergência ou contradição com evidência de apenas um lado. Identifica e cita cada posição separadamente; se faltar uma, apresenta a lacuna como limite probatório.',
    'Se o pedido exigir um debate historiográfico, atribui cada posição aos autores ou obras presentes no menu de evidências e compara os seus corpora, periodizações ou escalas. Se não houver posições nominais suficientes, declara a limitação em vez de inventar uma escola ou consenso.',
    'Usa poucos títulos amplos. Dentro de cada secção não acrescentes subtítulos, micro-secções, rótulos temáticos ou cabeçalhos adicionais.',
    'Não transformes cada ideia, fonte, autor, período ou nuance numa secção independente. Integra-os numa linha argumentativa quando fizerem parte do mesmo movimento do raciocínio.',
    'Evita dois-pontos, ponto e vírgula e travessão longo. Usa-os apenas quando forem estritamente necessários, por exemplo numa citação literal ou referência que tenha de ser preservada.',
    'Prefere frases completas ligadas por pontos, vírgulas e conectores discursivos. Evita parágrafos que comecem por rótulos como «Contexto:», «Evidência:» ou «Conclusão:».',
    'Não uses listas quando a informação puder ser expressa claramente em prosa contínua.',
  ],
  'pt-BR': [
    'Priorize uma narrativa argumentativa contínua, bem articulada e fundamentada. Cada parágrafo deve avançar a partir do anterior por meio de transições naturais.',
    'Cada parágrafo deve cumprir uma nova função inferencial. Não repita a tese central, uma conclusão ou a mesma cautela metodológica em várias seções com palavras diferentes.',
    'Integre cada citação imediatamente depois da afirmação concreta que ela sustenta. Evite grupos mecânicos de referências no fim do parágrafo; quando as fontes contribuírem de formas distintas, atribua e explique cada contribuição na frase correspondente.',
    'Diferencie precisamente quatro níveis: fato documentado, interpretação de um autor, inferência construída pelo relatório e questão que o corpus não permite resolver. Não apresente inferência causal ou metáfora de controle como fato comprovado.',
    'Antes de afirmar mecanismo, causalidade, efeito ou recepção, verifique se as evidências sustentam essa relação específica, além de tema, ator, escala e período. Uma intenção não prova um efeito e um público previsto não prova recepção.',
    'Quando houver discordância, desenvolva o debate completo: o que cada posição sustenta, em que evidência ou escala se apoia, por que divergem e quais dados poderiam decidir entre elas. Não basta anunciar debate ou contradição.',
    'Não declare consenso, convergência, divergência ou contradição com evidências de apenas um lado. Identifique e cite cada posição separadamente; se uma faltar, apresente a lacuna como limite probatório.',
    'Se o pedido exigir debate historiográfico, atribua cada posição aos autores ou obras do menu de evidências e compare seus corpora, períodos ou escalas. Se não houver posições nomeadas suficientes, declare a limitação em vez de inventar escola ou consenso.',
    'Use poucos títulos amplos. Dentro de cada seção não adicione subtítulos, microsseções, rótulos temáticos ou cabeçalhos adicionais.',
    'Não transforme cada ideia, fonte, autor, período ou nuance em seção independente. Integre-os na mesma linha argumentativa quando fizerem parte do mesmo movimento do raciocínio.',
    'Evite dois-pontos, ponto e vírgula e travessão. Use-os somente quando forem estritamente necessários, por exemplo em citação literal ou referência que precise ser preservada.',
    'Prefira frases completas ligadas por pontos, vírgulas e conectores. Evite parágrafos que comecem com rótulos como “Contexto:”, “Evidência:” ou “Conclusão:”.',
    'Não use listas quando a informação puder ser expressa claramente em prosa contínua.',
  ],
  it: [
    'Privilegia una narrazione argomentativa continua, ben collegata e ragionata. Ogni paragrafo deve avanzare rispetto al precedente tramite transizioni naturali.',
    'Ogni paragrafo deve svolgere una nuova funzione inferenziale. Non ripetere la tesi centrale, una conclusione o la stessa cautela metodologica in più sezioni con parole diverse.',
    'Integra ogni citazione subito dopo la clausola concreta che sostiene. Evita gruppi meccanici di riferimenti alla fine del paragrafo; quando le fonti apportano elementi diversi, attribuisci e spiega ogni contributo nella frase corrispondente.',
    'Distingui con precisione quattro livelli: fatto documentato, interpretazione di un autore, inferenza costruita dal rapporto e questione che il corpus non consente di risolvere. Non presentare un’inferenza causale o una metafora di controllo come fatto provato.',
    'Prima di affermare un meccanismo, una causalità, un effetto o una ricezione, verifica che le prove sostengano quella relazione specifica, oltre a tema, attore, scala e periodo. Un’intenzione non dimostra un effetto e un pubblico previsto non dimostra ricezione.',
    'In caso di disaccordo, sviluppa il dibattito completo: cosa sostiene ogni posizione, su quali prove o scale si fonda, perché divergono e quali dati potrebbero decidere. Non basta annunciare un dibattito o una contraddizione.',
    'Non dichiarare consenso, convergenza, divergenza o contraddizione con prove di un solo lato. Identifica e cita ogni posizione separatamente; se ne manca una, presenta la lacuna come limite probatorio.',
    'Se il compito richiede un dibattito storiografico, attribuisci ogni posizione agli autori o alle opere nel menu delle prove e confronta corpus, periodizzazioni o scale. Se mancano posizioni nominali sufficienti, dichiara il limite invece di inventare una scuola o un consenso.',
    'Usa pochi titoli ampi. All’interno di ogni sezione non aggiungere sottotitoli, microsezioni, etichette tematiche o ulteriori intestazioni.',
    'Non trasformare ogni idea, fonte, autore, periodo o sfumatura in una sezione indipendente. Integrali nella stessa linea argomentativa quando appartengono allo stesso movimento del ragionamento.',
    'Evita due punti, punto e virgola e lineette lunghe. Usali solo quando strettamente necessari, ad esempio in una citazione letterale o in un riferimento da conservare.',
    'Preferisci frasi complete unite da punti, virgole e connettivi. Evita paragrafi che iniziano con etichette come «Contesto:», «Prova:» o «Conclusione:».',
    'Non usare elenchi quando l’informazione può essere espressa chiaramente in prosa continua.',
  ],
  tr: [
    'Sürekli, iyi bağlanmış ve gerekçeli bir anlatımı önceliklendir. Her paragraf doğal geçişlerle önceki paragraftan ilerlemelidir.',
    'Her paragraf yeni bir çıkarımsal işlev yerine getirmelidir. Merkezi tezi, sonucu veya aynı yöntemsel uyarıyı farklı sözlerle birden çok bölümde tekrarlama.',
    'Her alıntıyı desteklediği somut tümceden hemen sonra yerleştir. Paragraf sonunda mekanik kaynak kümelerinden kaçın; kaynaklar farklı katkılar yapıyorsa her katkıyı ilgili tümcede belirt ve açıkla.',
    'Dört düzeyi kesin biçimde ayır: belgelenmiş olgu, yazar yorumu, raporun kurduğu çıkarım ve külliyatın çözemediği soru. Nedensel çıkarımı veya kontrol metaforunu kanıtlanmış olgu gibi sunma.',
    'Bir mekanizma, nedensellik, etki veya alımlama ileri sürmeden önce kanıtın konu, aktör, ölçek ve dönemin yanı sıra bu özel ilişkiyi de desteklediğini denetle. Niyet etkiyi, tasarlanan kitle de alımlamayı kanıtlamaz.',
    'Anlaşmazlık varsa tartışmayı bütünüyle geliştir: her konum neyi savunuyor, hangi kanıt veya ölçeğe dayanıyor, neden ayrışıyor ve hangi veriler karar vermeyi sağlayabilir. Yalnızca tartışma veya çelişki ilan etmek yetmez.',
    'Tek taraflı kanıtla uzlaşma, yakınsama, ayrışma veya çelişki ilan etme. Her konumu ayrı ayrı tanımla ve kaynaklandır; biri eksikse boşluğu kanıtsal sınır olarak sun.',
    'İstek tarih yazımı tartışması gerektiriyorsa her konumu kanıt menüsündeki yazar veya eserlere bağla ve külliyatlarını, dönemlerini veya ölçeklerini karşılaştır. Yeterli adlandırılmış konum yoksa okul ya da uzlaşma uydurmak yerine sınırı belirt.',
    'Az sayıda geniş başlık kullan. Bölüm içinde alt başlık, mikro bölüm, tematik etiket veya ek başlık ekleme.',
    'Her fikri, kaynağı, yazarı, dönemi veya nüansı bağımsız bölüme dönüştürme. Aynı akıl yürütme hareketine ait olduklarında bunları tek bir sav çizgisine entegre et.',
    'İki nokta, noktalı virgül ve uzun çizgiden kaçın. Bunları yalnızca aynen korunması gereken alıntı veya referans gibi zorunlu durumlarda kullan.',
    'Nokta, virgül ve bağlaçlarla bağlanan tam cümleleri tercih et. “Bağlam:”, “Kanıt:” veya “Sonuç:” gibi etiketlerle başlayan paragraflardan kaçın.',
    'Bilgi sürekli düzyazıyla açıkça ifade edilebiliyorsa liste kullanma.',
  ],
  'zh-Hans': [
    '优先展开连贯、衔接紧密且有理据的论述。每一段都必须通过自然的过渡从前一段推进。',
    '每一段都必须承担新的推论功能。不要用不同的措辞在多个章节中重复核心论点、某一结论或同一方法学上的保留。',
    '把每一条引注紧接在它所支持的具体分句之后。避免在段末机械地堆砌参考文献；当不同文献各有贡献时，应在相应的句子中逐一标注并说明其贡献。',
    '精确区分四个层次：有文献记载的事实、作者的解读、报告构建的推论，以及语料库无法解决的问题。不要把因果推论或控制性比喻当作已证事实来呈现。',
    '在断言某一机制、因果关系、效果或接受情况之前，要核实证据是否支持这一具体关系，以及相应的主题、行动者、尺度和时期。意图不能证明效果，预期的受众也不能证明接受情况。',
    '存在分歧时，要完整展开争论：每一方主张什么、依据哪些证据或尺度、为何产生分歧，以及哪些数据能够在它们之间作出判断。仅仅宣告存在争论或矛盾是不够的。',
    '不要凭单方面证据宣称共识、趋同、分歧或矛盾。要分别识别并引用每一方立场；若缺少某一方，应将这一空缺作为证据上的局限呈现。',
    '如果任务要求讨论史学争论，应将每一立场归到证据清单中的作者或著作，并比较其语料库、分期或尺度。如果没有足够的具名立场，应说明这一局限，而不是凭空发明某个学派或共识。',
    '使用少量宽泛的标题。在每个章节内不要添加副标题、微章节、主题标签或额外的标题。',
    '不要把每个观点、文献、作者、时期或细微差别都变成独立的章节。当它们属于同一推理脉络时，应整合进同一条论证主线。',
    '避免使用冒号、分号和长破折号。仅在绝对必要时使用，例如在逐字引文或必须保留的参考文献中。',
    '优先使用由句号、逗号和话语连接词连接的完整句子。避免以“背景：”“证据：”或“结论：”之类标签开头的段落。',
    '除非信息无法用连贯的散文清晰表达，否则不要使用列表。',
  ],
  'zh-Hant': [
    '優先展開連貫、銜接緊密且有理據的論述。每一段都必須透過自然的過渡從前一段推進。',
    '每一段都必須承擔新的推論功能。不要用不同的措辭在多個章節中重複核心論點、某一結論或同一方法學上的保留。',
    '把每一條引註緊接在它所支持的具體子句之後。避免在段末機械地堆砌參考文獻；當不同文獻各有貢獻時，應在相應的句子中逐一標註並說明其貢獻。',
    '精確區分四個層次：有文獻記載的事實、作者的解讀、報告建構的推論，以及語料庫無法解決的問題。不要把因果推論或控制性比喻當作已證實的事實來呈現。',
    '在斷言某一機制、因果關係、效果或接受情況之前，要核實證據是否支持這一具體關係，以及相應的主題、行動者、尺度和時期。意圖不能證明效果，預期的受眾也不能證明接受情況。',
    '存在分歧時，要完整展開爭論：每一方主張什麼、依據哪些證據或尺度、為何產生分歧，以及哪些數據能夠在它們之間作出判斷。僅僅宣告存在爭論或矛盾是不夠的。',
    '不要憑單方面證據宣稱共識、趨同、分歧或矛盾。要分別識別並引用每一方立場；若缺少某一方，應將這一空缺作為證據上的局限呈現。',
    '如果任務要求討論史學爭論，應將每一立場歸到證據清單中的作者或著作，並比較其語料庫、分期或尺度。如果沒有足夠的具名立場，應說明這一局限，而不是憑空發明某個學派或共識。',
    '使用少量寬泛的標題。在每個章節內不要添加副標題、微章節、主題標籤或額外的標題。',
    '不要把每個觀點、文獻、作者、時期或細微差別都變成獨立的章節。當它們屬於同一推理脈絡時，應整合進同一條論證主線。',
    '避免使用冒號、分號和長破折號。僅在絕對必要時使用，例如在逐字引文或必須保留的參考文獻中。',
    '優先使用由句號、逗號和話語連接詞連接的完整句子。避免以「背景：」「證據：」或「結論：」之類標籤開頭的段落。',
    '除非資訊無法用連貫的散文清晰表達，否則不要使用清單。',
  ],
  vi: [
    'Ưu tiên một lập luận liên tục, gắn kết chặt chẽ và có lý lẽ. Mỗi đoạn văn phải tiến triển từ đoạn trước bằng những chuyển tiếp tự nhiên.',
    'Mỗi đoạn văn phải thực hiện một chức năng suy luận mới. Không lặp lại luận điểm trung tâm, một kết luận hoặc cùng một lưu ý phương pháp luận trong nhiều mục bằng những cách diễn đạt khác nhau.',
    'Đặt mỗi trích dẫn ngay sau mệnh đề cụ thể mà nó chống đỡ. Tránh những cụm tài liệu tham khảo máy móc ở cuối đoạn; khi các nguồn đóng góp những điều khác nhau, hãy quy nguồn và giải thích từng đóng góp trong câu tương ứng.',
    'Phân biệt chính xác bốn cấp độ: dữ kiện được ghi nhận, cách giải thích của một tác giả, suy luận do báo cáo dựng lên, và câu hỏi mà ngữ liệu không thể giải quyết. Không trình bày suy luận nhân quả hay ẩn dụ kiểm soát như một sự thật đã được chứng minh.',
    'Trước khi khẳng định một cơ chế, quan hệ nhân quả, tác động hay sự tiếp nhận, hãy kiểm tra rằng bằng chứng chống đỡ mối quan hệ cụ thể đó cũng như chủ đề, chủ thể, quy mô và thời kỳ. Ý định không chứng minh tác động, và một công chúng dự kiến không chứng minh sự tiếp nhận.',
    'Khi có bất đồng, hãy triển khai đầy đủ cuộc tranh luận: mỗi quan điểm khẳng định điều gì, dựa trên bằng chứng hay quy mô nào, vì sao chúng khác biệt và dữ liệu nào có thể phân định giữa chúng. Chỉ tuyên bố có tranh luận hay mâu thuẫn là chưa đủ.',
    'Không tuyên bố đồng thuận, hội tụ, khác biệt hay mâu thuẫn từ bằng chứng một phía. Hãy nhận diện và trích dẫn từng quan điểm riêng biệt; nếu thiếu một quan điểm, hãy trình bày khoảng trống đó như một giới hạn chứng cứ.',
    'Nếu đề bài yêu cầu một cuộc tranh luận sử học, hãy quy từng quan điểm cho các tác giả hoặc tác phẩm trong danh mục bằng chứng và so sánh ngữ liệu, giai đoạn hoặc quy mô của họ. Nếu không có đủ quan điểm được nêu tên, hãy nêu rõ giới hạn thay vì bịa ra một trường phái hay đồng thuận.',
    'Dùng một vài tiêu đề khái quát. Trong mỗi mục, không thêm tiêu đề phụ, tiểu mục, nhãn chủ đề hay tiêu đề bổ sung.',
    'Không biến mỗi ý tưởng, nguồn, tác giả, thời kỳ hay sắc thái thành một mục độc lập. Hãy tích hợp chúng vào cùng một dòng lập luận khi chúng thuộc cùng một bước vận động của lý luận.',
    'Tránh dấu hai chấm, dấu chấm phẩy và gạch ngang dài. Chỉ dùng chúng khi thật sự cần thiết, chẳng hạn trong một trích dẫn nguyên văn hoặc một tài liệu tham khảo phải giữ nguyên.',
    'Ưu tiên những câu hoàn chỉnh nối với nhau bằng dấu chấm, dấu phẩy và các từ nối diễn ngôn. Tránh những đoạn văn mở đầu bằng nhãn như “Bối cảnh:”, “Bằng chứng:” hoặc “Kết luận:”.',
    'Không dùng danh sách trừ khi thông tin không thể được diễn đạt rõ ràng bằng văn xuôi liên tục.',
  ],
  ja: [
    '連続性があり、よくつながった論理的な叙述を優先してください。各段落は自然なつなぎによって前の段落から進展しなければなりません。',
    '各段落は新たな推論機能を担わなければなりません。中心命題、結論、または同じ方法論上の留保を、異なる表現で複数の節に繰り返さないでください。',
    '各引用は、それが支える具体的な節の直後に置いてください。段落末に参考文献を機械的にまとめることは避け、複数の資料が異なる貢献をする場合は、それぞれの貢献を該当する文で帰属を示して説明してください。',
    '四つの水準を正確に区別してください。文書化された事実、著者による解釈、報告書が構築した推論、そしてコーパスでは解決できない問いです。因果的推論や統制の比喩を証明済みの事実として提示しないでください。',
    '仕組み、因果関係、効果、受容を主張する前に、証拠がその特定の関係を、主題・行為者・規模・時期とともに支えているかを確認してください。意図は効果を証明せず、想定された読者層は受容を証明しません。',
    '不一致がある場合は、議論を完全に展開してください。各立場が何を主張し、どの証拠や規模に依拠し、なぜ分岐するのか、そして何がそれらを決しうるデータなのかを示します。議論や矛盾の存在を告知するだけでは不十分です。',
    '一方の側の証拠だけで合意、収束、分岐、矛盾を宣言しないでください。各立場を個別に特定して引用し、一方が欠けている場合は、その空白を証拠上の限界として提示してください。',
    '依頼が史学論争を求める場合は、各立場を証拠メニューの著者や著作に帰属させ、それらのコーパス、時期区分、規模を比較してください。名指しされた立場が十分にない場合は、学派や合意を捏造せず、限界を明示してください。',
    '広い見出しを少数使ってください。各節の中に副題、小見出し、テーマ別ラベル、その他の見出しを追加しないでください。',
    'あらゆる着想、資料、著者、時期、ニュアンスを独立した節にしないでください。同じ推論の流れに属する場合は、一つの論証の筋に統合してください。',
    'コロン、セミコロン、ダッシュを避けてください。厳密に必要な場合、たとえば逐語引用や保存すべき参考文献の中でのみ使用してください。',
    '句点、読点、談話標識でつないだ完全な文を優先してください。「背景：」「証拠：」「結論：」のようなラベルで段落を始めることは避けてください。',
    '情報を連続した散文で明確に表現できない場合を除き、箇条書きを使用しないでください。',
  ],
  ru: [
    'Отдавайте предпочтение непрерывному, хорошо связанному и аргументированному изложению. Каждый абзац должен продвигаться от предыдущего с помощью естественных переходов.',
    'Каждый абзац должен выполнять новую функцию вывода. Не повторяйте центральный тезис, вывод или одну и ту же методологическую оговорку в нескольких разделах разными словами.',
    'Ставьте каждую ссылку сразу после конкретного придаточного, которое она подкрепляет. Избегайте механических скоплений ссылок в конце абзаца; когда источники вносят разный вклад, указывайте и объясняйте каждый вклад в соответствующем предложении.',
    'Точно различайте четыре уровня: документированный факт, интерпретацию автора, вывод, построенный отчётом, и вопрос, который корпус не позволяет решить. Не представляйте причинный вывод или метафору контроля как доказанный факт.',
    'Прежде чем утверждать механизм, причинность, эффект или рецепцию, проверьте, что доказательства поддерживают именно эту связь, а также тему, действующее лицо, масштаб и период. Намерение не доказывает эффект, а предполагаемая аудитория не доказывает рецепцию.',
    'При наличии разногласий разверните полемику полностью: что утверждает каждая позиция, на каких доказательствах или масштабе она основывается, почему они расходятся и какие данные позволили бы между ними решить. Просто объявить о споре или противоречии недостаточно.',
    'Не заявляйте о консенсусе, сближении, расхождении или противоречии на основании односторонних доказательств. Определяйте и цитируйте каждую позицию отдельно; если одна отсутствует, представляйте этот пробел как доказательное ограничение.',
    'Если задание требует историографической полемики, приписывайте каждую позицию авторам или работам из меню доказательств и сравнивайте их корпусы, периодизации или масштабы. Если названных позиций недостаточно, укажите ограничение, а не изобретайте школу или консенсус.',
    'Используйте несколько широких заголовков. Внутри каждого раздела не добавляйте подзаголовки, микроразделы, тематические ярлыки или дополнительные заголовки.',
    'Не превращайте каждую идею, источник, автора, период или нюанс в отдельный раздел. Интегрируйте их в одну линию аргументации, когда они относятся к одному и тому же ходу рассуждения.',
    'Избегайте двоеточий, точек с запятой и длинных тире. Используйте их только при крайней необходимости, например внутри дословной цитаты или ссылки, которую необходимо сохранить.',
    'Предпочитайте полные предложения, соединённые точками, запятыми и дискурсивными связками. Избегайте абзацев, начинающихся с ярлыков вроде «Контекст:», «Доказательство:» или «Вывод:».',
    'Не используйте списки, если информацию невозможно ясно выразить непрерывной прозой.',
  ],
  uk: [
    'Надавайте перевагу безперервному, добре пов’язаному та аргументованому викладу. Кожен абзац має просуватися від попереднього за допомогою природних переходів.',
    'Кожен абзац має виконувати нову функцію висновування. Не повторюйте центральну тезу, висновок чи ту саму методологічну засторогу в кількох розділах різними словами.',
    'Ставте кожне посилання одразу після конкретного підрядного речення, яке воно підтверджує. Уникайте механічних скупчень посилань у кінці абзацу; коли джерела роблять різний внесок, зазначайте й пояснюйте кожен внесок у відповідному реченні.',
    'Точно розрізняйте чотири рівні: задокументований факт, інтерпретацію автора, висновок, побудований звітом, і питання, яке корпус не дає змоги розв’язати. Не подавайте причиновий висновок або метафору контролю як доведений факт.',
    'Перш ніж стверджувати механізм, причинність, ефект або рецепцію, перевірте, чи докази підтверджують саме цей зв’язок, а також тему, дійову особу, масштаб і період. Намір не доводить ефекту, а передбачувана аудиторія не доводить рецепції.',
    'Коли є розбіжність, розгорніть повну дискусію: що стверджує кожна позиція, на яких доказах чи масштабі вона ґрунтується, чому вони розходяться і які дані дали б змогу вирішити між ними. Лише оголосити про дискусію чи суперечність недостатньо.',
    'Не заявляйте про консенсус, зближення, розходження чи суперечність на підставі однобічних доказів. Визначайте й цитуйте кожну позицію окремо; якщо одна відсутня, подавайте цю прогалину як доказове обмеження.',
    'Якщо завдання вимагає історіографічної дискусії, приписуйте кожну позицію авторам або працям із меню доказів і порівнюйте їхні корпуси, періодизації чи масштаби. Якщо названих позицій недостатньо, зазначте обмеження, а не вигадуйте школу чи консенсус.',
    'Використовуйте кілька широких заголовків. Усередині кожного розділу не додавайте підзаголовків, мікророзділів, тематичних ярликів чи додаткових заголовків.',
    'Не перетворюйте кожну ідею, джерело, автора, період чи нюанс на окремий розділ. Інтегруйте їх в одну лінію аргументації, коли вони належать до одного й того самого руху міркування.',
    'Уникайте двокрапок, крапок з комою та довгих тире. Використовуйте їх лише за крайньої потреби, наприклад у дослівній цитаті або посиланні, яке потрібно зберегти.',
    'Надавайте перевагу повним реченням, з’єднаним крапками, комами та дискурсивними сполучниками. Уникайте абзаців, що починаються з ярликів на кшталт «Контекст:», «Доказ:» або «Висновок:».',
    'Не використовуйте списки, якщо інформацію можна ясно висловити безперервною прозою.',
  ],
  ko: [
    '연속적이고 잘 연결된 논리적 진술을 우선하십시오. 각 문단은 자연스러운 전환을 통해 이전 문단에서 발전해야 합니다.',
    '각 문단은 새로운 추론 기능을 수행해야 합니다. 중심 논제, 결론 또는 동일한 방법론적 유보를 여러 절에서 다른 표현으로 반복하지 마십시오.',
    '각 인용은 그것이 뒷받침하는 구체적인 절 바로 뒤에 배치하십시오. 문단 끝에 참고문헌을 기계적으로 몰아넣지 말고, 여러 출처가 서로 다른 기여를 할 때에는 해당 문장에서 각 기여를 귀속시켜 설명하십시오.',
    '네 가지 수준을 정확히 구분하십시오. 문서로 기록된 사실, 저자의 해석, 보고서가 구성한 추론, 그리고 코퍼스로는 해결할 수 없는 질문입니다. 인과적 추론이나 통제 은유를 입증된 사실로 제시하지 마십시오.',
    '메커니즘, 인과관계, 효과 또는 수용을 주장하기 전에, 증거가 주제·행위자·규모·시기뿐 아니라 그 특정 관계를 뒷받침하는지 확인하십시오. 의도는 효과를 입증하지 못하며, 예상된 독자층은 수용을 입증하지 못합니다.',
    '의견 차이가 있을 때에는 논쟁을 완전히 전개하십시오. 각 입장이 무엇을 주장하는지, 어떤 증거나 규모에 근거하는지, 왜 갈라지는지, 그리고 무엇이 그것을 판가름할 데이터인지를 밝히십시오. 논쟁이나 모순이 있다고 선언하는 것만으로는 충분하지 않습니다.',
    '한쪽 증거만으로 합의, 수렴, 분기 또는 모순을 선언하지 마십시오. 각 입장을 개별적으로 식별하고 인용하십시오. 한쪽이 빠져 있다면 그 공백을 증거상의 한계로 제시하십시오.',
    '요청이 역사서술 논쟁을 요구한다면 각 입장을 증거 목록의 저자나 저작에 귀속시키고 그들의 코퍼스, 시기 구분 또는 규모를 비교하십시오. 이름 붙은 입장이 충분하지 않다면 학파나 합의를 지어내지 말고 한계를 밝히십시오.',
    '폭넓은 제목을 몇 개만 사용하십시오. 각 절 안에 부제목, 소절, 주제 라벨 또는 추가 제목을 넣지 마십시오.',
    '모든 아이디어, 출처, 저자, 시기 또는 뉘앙스를 독립된 절로 만들지 마십시오. 같은 추론의 흐름에 속한다면 하나의 논증선으로 통합하십시오.',
    '콜론, 세미콜론, 긴 줄표를 피하십시오. 꼭 필요한 경우, 예컨대 축어적 인용이나 반드시 보존해야 하는 참고문헌 안에서만 사용하십시오.',
    '마침표, 쉼표, 담화 연결어로 이어진 완전한 문장을 선호하십시오. “배경:”, “증거:”, “결론:”과 같은 라벨로 문단을 시작하지 마십시오.',
    '정보를 연속적인 산문으로 명확히 표현할 수 없다면 목록을 사용하지 마십시오.',
  ],
};

export function deepResearchNarrativeRules(language: PromptLanguage = 'es'): readonly string[] {
  return NATIVE_NARRATIVE_RULES[language] ?? NATIVE_NARRATIVE_RULES.en;
}

export interface DeepResearchPlanSection {
  id: string;
  title: string;
  purpose: string;
  keyClaims: string[];
  ideaIds: string[];
  workIds: string[];
  gapIds: string[];
  contradictionIds: string[];
  passageIds: string[];
  /** Exact subquestions from the user's brief that this section must answer. */
  coverageQuestions?: string[];
  /** Evidence-bounded answers produced after section retrieval. Questions remain
   * the coverage contract; these propositions are what the writer may assert. */
  coverageClaims?: string[];
  /** Retrieval candidates kept separate per atomic question until the claim audit.
   * This prevents round-robin fusion from evicting a rare answer before the
   * epistemic model has inspected that question's own recall window. */
  retrievalEvidencePacks?: Array<{
    question: string;
    passageIds: string[];
    candidates?: AtomicPassageRetrieval[];
  }>;
  /** Where the section sits in the report's architecture. */
  role?: 'intro' | 'body' | 'synthesis';
  /** Ids of the sections whose ground this one presupposes. The planner states the
   * dependencies; {@link orderSections} turns them into the reading order, so a
   * coherent sequence is a property of the engine rather than luck of the draw. */
  dependsOn?: string[];
}

export interface DeepResearchPlan {
  title: string;
  abstract: string;
  sections: DeepResearchPlanSection[];
}

export interface PlanInput {
  objective: string;
  /**
   * Kept for backwards-compatible planners. In the production academic pipeline
   * this is empty while the argument is designed; coverage is audited afterwards.
   */
  coverageQuestions: string[];
  language: PromptLanguage;
  audience?: string;
  /**
   * How many sections the planner may return. In `'user'` mode this is a hard
   * MAXIMUM (the "Máx. N secciones" control); in `'auto'` mode it is the
   * evidence-derived target.
   */
  sectionCount: number;
  /** Whether the user pinned a section cap ('user') or left it to the model ('auto'). */
  sectionMode: 'auto' | 'user';
  /** Guideline words per section, so the planner sizes each section's mandate. */
  sectionLength?: DeepResearchSectionLengthPlan;
  ideas: { id: string; label: string; type: string; statement: string; works: string }[];
  themes: { id: string; label: string; summary: string }[];
  gaps: { id: string; label: string; summary: string }[];
  contradictions: { id: string; label: string; summary: string }[];
  works: { id: string; label: string; summary: string }[];
  passages: { id: string; workId: string; source: string; page: string | null; extract: string }[];
  /** Explicit graph edges among the retrieved ideas. Document profiles never
   * contribute to this list. */
  relationships?: Array<{ from: string; relation: string; to: string; confidence: number }>;
}

export interface PlanEvidencePreparationInput {
  objective: string;
  language: PromptLanguage;
  coverageQuestions: string[];
  /** A defensive copy of the already-normalized argument. Implementations may use
   * it to choose documents, but cannot mutate the plan the writer will execute. */
  plan: DeepResearchPlan;
  /** Work ids ordered by their participation in the plan's ideas, then by the
   * original graph-first ranking. */
  candidateWorkIds: string[];
}

export interface PlanEvidencePreparationResult {
  considered: number;
  requested: number;
  prepared: number;
  unavailable: number;
  failed: number;
}

export interface PlanCoverageAuditInput {
  objective: string;
  language: PromptLanguage;
  coverageQuestions: string[];
  plan: DeepResearchPlan;
  ideas: PlanInput['ideas'];
  gaps: PlanInput['gaps'];
  contradictions: PlanInput['contradictions'];
}

/**
 * One citable token the model must copy verbatim, plus the material it stands for.
 * `note` always carries the real content (the idea's statement, what the gap says,
 * what the contradiction opposes, the literal words of the passage) — never a
 * placeholder. A writer that cannot read what it is citing can only invent.
 */
export interface CitationMenuItem {
  token: string;
  note: string;
  kind: 'idea' | 'work' | 'gap' | 'contradiction' | 'passage';
  /** Author/year the token resolves to, so the writer can attribute in prose. */
  source?: string;
  /** Explains why a question-level retrieval included this candidate. Raw scores
   * from heterogeneous lanes are diagnostic only and are never added together. */
  retrieval?: Omit<AtomicPassageRetrieval, 'passageId'>;
}

export interface AtomicPassageRetrieval {
  passageId: string;
  query: string;
  rank: number;
  lanes: Array<'global' | 'lexical' | 'support' | 'document'>;
  score: number;
  reason: string;
}

export interface SectionInput {
  objective: string;
  language: PromptLanguage;
  audience?: string;
  section: DeepResearchPlanSection;
  isConclusion: boolean;
  citationMenu: CitationMenuItem[];
  /** Question-scoped view of the wide passage pool. The general menu remains the
   * complete trust boundary, while these packs prevent cross-question evidence
   * leakage during the epistemic audit. */
  atomicEvidencePacks?: Array<{ question: string; candidates: CitationMenuItem[] }>;
  priorSummary: string;
  /** Claims already developed earlier, verbatim, so the writer can build on them
   * instead of restating them. Derived from what was really cited, not from the plan. */
  alreadyDeveloped: string[];
  /** Responsibilities owned by sibling sections. The writer may refer back to
   * them, but must not develop them again in this section. */
  reservedForOtherSections?: Array<{ title: string; responsibilities: string[] }>;
  /** Optional claim-to-evidence scaffold produced before prose. It forces the
   * writer to decide what each paragraph proves, with which exact sources and
   * caveats, instead of discovering an argument while generating sentences. */
  evidencePlan?: SectionEvidencePlan;
  /** Evidence-bounded status of the plan's propositions after section-specific
   * idea/passage retrieval. Plan claims are hypotheses until this audit runs. */
  claimAudit?: SectionClaimAudit;
  /**
   * The user's guideline words-per-section, already split into bounded generation
   * passes. `targetWords === null` is auto mode: the writer behaves exactly as it
   * did before this control existed. It is guidance, never a quota — the writer
   * must stop early rather than pad, repeat, invent or overstate to reach it.
   */
  sectionLength?: DeepResearchSectionLengthPlan;
}

export type DeepResearchProofRole = 'fact' | 'actor_time' | 'mechanism' | 'causality' | 'comparison_side' | 'agreement' | 'contradiction' | 'effect' | 'reception' | 'limit' | 'method';

export interface SectionClaimAuditItem {
  original: string;
  status: 'supported' | 'partial' | 'unsupported';
  /** The strongest formulation the cited menu can actually sustain. Unsupported
   * propositions become an explicit open question or evidentiary limit. */
  revised: string;
  evidenceTokens: string[];
  reason: string;
  /** Small question-level evidence pack selected after the wider recovery window.
   * `direct` must entail part of the answer; `context` may delimit it but never
   * upgrades a claim by itself. Rejected candidates remain visible to metrics but
   * are removed from the writer's menu. */
  evidencePack?: Array<{
    token: string;
    role: 'direct' | 'context' | 'irrelevant';
    reason: string;
  }>;
  /** Atomic entailment checklist. A compound claim cannot be `supported` while
   * any one of its required components remains unproved. */
  requirements?: Array<{
    text: string;
    /** What this atomic unit has to prove. A thematic match can never satisfy a
     * causal, reception or bilateral-relation role by itself. */
    proofRole?: DeepResearchProofRole;
    supported: boolean;
    evidenceTokens: string[];
  }>;
}

export interface SectionClaimAudit {
  items: SectionClaimAuditItem[];
}

export interface SectionEvidencePlan {
  thesis: string;
  objectiveLinks: string[];
  exclusions: string[];
  paragraphs: Array<{
    function: string;
    proofRole?: DeepResearchProofRole;
    claim: string;
    evidenceTokens: string[];
    relationship: string;
    /** Auditable sides of a synthesis. Empty for a single-source factual unit.
     * Agreement and contradiction require both sides to be directly evidenced. */
    relationshipSides?: Array<{ label: string; claim: string; evidenceTokens: string[] }>;
    caveat: string;
    transition: string;
  }>;
}

export interface SectionRevisionInput extends SectionInput {
  draft: string;
  quality: DeepResearchSectionQuality;
  /** Sentences whose original citations were partial or unsupported. The editor
   * must narrow, remove or re-ground them before the replacement is re-verified. */
  verificationConcerns?: string[];
  /** Cross-section diagnosis from the final report editor. */
  editorialDirective?: ReportEditorialDirective;
}

export interface ReportEditorialDirective {
  sectionTitle: string;
  diagnosis: string;
  remove: string[];
  deepen: string[];
  cautions: string[];
  transition: string;
}

export interface ReportEditorialReview {
  overall: string;
  directives: ReportEditorialDirective[];
}

/**
 * One claim as it stands in the finished prose, paired with the material cited to
 * support it. This is the unit the verification pass judges: not "does this id
 * exist" (the citation policy already guarantees that) but "does what this source
 * says actually support what this sentence asserts".
 */
export interface CitationClaim {
  /** Position in the section markdown, used to apply the verdict back. */
  offset: number;
  /** Bounds of the complete sentence in the section markdown. */
  sentenceOffset: number;
  sentenceEnd: number;
  /** The full citation link as it appears, so it can be removed verbatim. */
  link: string;
  kind: 'idea' | 'passage' | 'gap' | 'contradiction';
  id: string;
  /** The sentence the citation sits in, with citation markup removed. */
  sentence: string;
  /** What the cited source actually says. */
  content: string;
}

export type CitationVerdict = 'supports' | 'partial' | 'unsupported';

/** What a per-section retrieval asks the corpus for. */
export interface SectionRetrievalInput {
  objective: string;
  sectionTitle: string;
  purpose: string;
  keyClaims: string[];
  coverageQuestions?: string[];
  /** Already on the section's desk; the retriever should return something else. */
  excludeIdeaIds: string[];
  excludePassageIds: string[];
  limits: { ideas: number; passages: number };
}

export interface SectionRetrievalResult {
  ideas?: WritingWorkshopIdeaCandidate[];
  passages?: WritingWorkshopSnapshot['passages'];
  /** Ranked independently for every atomic question, before global deduplication. */
  evidencePacks?: Array<{
    question: string;
    passageIds: string[];
    candidates?: AtomicPassageRetrieval[];
  }>;
}

export interface FinalizeInput {
  objective: string;
  language: PromptLanguage;
  planTitle: string;
  sectionTitles: string[];
  ideasCovered: number;
  ideasConsidered: number;
  uncoveredSamples: string[];
  /** Verified prose, clipped per section. The finalizer summarizes what the report
   * actually established rather than guessing from headings and idea counts. */
  sectionFindings?: Array<{ title: string; text: string }>;
  /** Remaining partial/removed support findings that the abstract and limitations
   * must not silently turn back into confident conclusions. */
  supportConcerns?: string[];
}

export interface FinalizeResult {
  title: string;
  abstract: string;
  limitations: string[];
  nextSteps: string[];
}

/**
 * Everything the orchestrator needs from the outside world. Injected so the loop
 * logic can be tested with fakes — no DB, no AI provider, no Electron.
 */
export interface DeepResearchDeps {
  strictDocumentaryGrounding?: boolean;
  /** One evidence-bounded addition before the final factual audit. */
  repairSectionCoverage?(input: SectionInput, draft: string): Promise<string>;
  /** Read-only final check against the original plan, after all removals. */
  checkSectionCoverage?(input: SectionInput, draft: string): Promise<boolean>;
  auditFactualProse?(markdown: string): Promise<ResearchProseAudit & { passages?: import('@shared/types').WritingWorkshopPassageCandidate[] }>;
  /** Pairs of final statements that cannot both hold. Throws when unavailable. */
  auditReportConsistency?(statements: string[]): Promise<ResearchConflict[]>;

  researchTraversal?(): Promise<import('@shared/researchCorpus').ResearchTraversal>;
  buildSnapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot>;
  /** Academic adapters may plan specialized probes using an already authorized
   * snapshot; every supplemental query uses the same run's scope and budget. */
  prepareScopedSnapshot?(snapshot: WritingWorkshopSnapshot, extend: (queries: string[]) => Promise<WritingWorkshopSnapshot>): Promise<WritingWorkshopSnapshot>;
  planReport(input: PlanInput): Promise<DeepResearchPlan>;
  writeSection(input: SectionInput): Promise<string>;
  finalize(input: FinalizeInput): Promise<FinalizeResult>;
  /** Final entailment guard for title/abstract. It may narrow the summary after
   * seeing verified section findings, but cannot remove recorded limitations. */
  auditFinalSummary?(input: FinalizeInput, draft: FinalizeResult): Promise<FinalizeResult>;
  /** Decomposes explicit requirements after graph retrieval but before planning.
   * They constrain scope without replacing ideas/relationships as the argument. */
  decomposeObjective?(objective: string, language: PromptLanguage): Promise<string[]>;
  /** Post-plan diagnostic. It may add graph assignments and coverage ownership;
   * the core preserves every historical proposition and the complete architecture. */
  auditPlanCoverage?(input: PlanCoverageAuditInput): Promise<DeepResearchPlan>;
  /** Builds any missing whole-document profiles only after planning. Its result is
   * observational; section retrieval is the only route by which evidence is added. */
  preparePlanEvidence?(input: PlanEvidencePreparationInput): Promise<PlanEvidencePreparationResult>;
  /**
   * Optional second retrieval pass, run once per section with that section's own
   * focus as the query. The initial snapshot is ranked against the whole objective,
   * so a section about a narrow sub-question would otherwise never get to ask the
   * corpus about it — least of all for literal passages, which the snapshot caps
   * hard. Omitted (undefined) keeps the single-shot behaviour.
   */
  retrieveForSection?(input: SectionRetrievalInput): Promise<SectionRetrievalResult>;
  /** Evidence-bounds each planned proposition after the section has retrieved its
   * literal passages. This is the trust boundary between planning and prose. */
  auditSectionClaims?(input: SectionInput): Promise<SectionClaimAudit>;
  /** Optional pre-writing claim/evidence architecture. This is deliberately a
   * separate bounded call: planning evidence before prose substantially reduces
   * decorative citations, overclaiming and paragraph-by-paragraph drift. */
  planSectionEvidence?(input: SectionInput): Promise<SectionEvidencePlan>;
  /**
   * One bounded professional-editing pass for a section that fails the shared
   * grounding/diversity/synthesis gates. The orchestrator accepts the rewrite only
   * when deterministic metrics improve and every citation remains in the menu.
   */
  reviseSection?(input: SectionRevisionInput): Promise<string>;
  /** Two-order blind comparison for an evidence-safe final line edit. The core
   * never trusts this judgement alone: deterministic grounding and coverage
   * invariants must pass first. */
  judgeSectionRevision?(input: SectionInput, original: string, revised: string): Promise<boolean>;
  /** One report-wide diagnosis before the last bounded edit. It cannot add source
   * material; it only tells each section what to remove, deepen or connect. */
  reviewReport?(input: {
    objective: string;
    language: PromptLanguage;
    sections: Array<{ title: string; purpose: string; responsibilities: string[]; markdown: string }>;
  }): Promise<ReportEditorialReview>;
  /**
   * Optional entailment check over the finished prose. The citation policy proves a
   * source exists and is really in the corpus; only this proves the source supports
   * the sentence it was attached to. Must return one verdict per claim, in order.
   * Omitted skips verification entirely.
   */
  verifyCitations?(claims: CitationClaim[], language?: PromptLanguage): Promise<CitationVerdict[]>;
  /**
   * Optional read-only check for sections that contradict each other. Deliberately
   * cannot rewrite: a pass that edits assembled prose puts every verified citation
   * at risk, so this only reports. Each finding must quote both sides verbatim so
   * the orchestrator can confirm the sentences really exist before believing it.
   */
  checkCoherence?(sections: { title: string; text: string }[], language?: PromptLanguage): Promise<CoherenceIssue[]>;
}

/** Two passages of the same report that cannot both be right. */
export interface CoherenceIssue {
  sectionA: string;
  quoteA: string;
  sectionB: string;
  quoteB: string;
  issue: string;
}

interface WorkInfo {
  metadataOnly?: boolean;
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  zotero_key: string;
  /** The only locator the local schema stores. Publisher and journal live in Zotero,
   * so a reference entry can be author-year-title-DOI and no more than that. */
  doi?: string | null;
}

export interface SnapshotMaps {
  ideaById: Map<string, WritingWorkshopIdeaCandidate>;
  workInfoById: Map<string, WorkInfo>;
  passageWorkId: Map<string, string>;
  passagePage: Map<string, string | null>;
  /** Literal passage text. A passage with no text here is never offered as citable. */
  passageText: Map<string, string>;
  /** What each gap actually says, plus the author-year it is anchored to. */
  gapById: Map<string, { label: string; summary: string; source: string }>;
  /** What each contradiction actually opposes, and who holds each side. */
  contradictionById: Map<string, { label: string; summary: string; sources: string[] }>;
  validIds: Set<string>;
  /** Language the report is written in; names the citations that have no author-year. */
  language?: PromptLanguage;
}

// ─────────────────────────────────────────────────────────────────────────────
// The orchestrator (pure control flow over injected dependencies)
// ─────────────────────────────────────────────────────────────────────────────

export async function orchestrateDeepResearch(
  request: DeepResearchRequest,
  deps: DeepResearchDeps,
  onProgress?: (p: DeepResearchProgress) => void,
  signal?: AbortSignal,
): Promise<DeepResearchReport> {
  const language = request.language ?? 'es';
  const L = labels(language);
  const emit = (p: DeepResearchProgress) => {
    signal?.throwIfAborted();
    try {
      onProgress?.(p);
    } catch {
      /* progress is best-effort; never let a UI callback abort the report */
    }
  };

  emit({ phase: 'snapshot', message: L.gathering });
  const brief: WritingWorkshopBrief = {
    kind: 'deep_research',
    deepResearchVersion: request.deepResearchVersion,
    objective: request.objective,
    audience: request.audience,
    tone: 'academic',
    language,
  };
  const snapshot = await deps.buildSnapshot(brief);
  if (deps.strictDocumentaryGrounding && !snapshot.passages.length && !snapshot.ideas.length) {
    const explanation = researchEvidenceLimitation(language);
    const traversal = await deps.researchTraversal?.();
    const words = countWords(explanation);
    return { draft: { generatedAt: new Date().toISOString(), brief, title: request.objective, abstract: explanation,
      selection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
      outline: [], draftMarkdown: explanation, matrix: [], bibliography: [], nextSteps: [], limitations: [explanation], claimLedger: [], researchTraversal: traversal,
      stats: { selectedIdeas: 0, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0, selectedWorks: 0, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: explanation.length, truncated: true } },
      meta: { deepResearchVersion: request.deepResearchVersion ?? 'v1', structure: request.sectionLimit === 'single' ? 'single' : 'sectioned', sections: 0, words, pages: pagesFromWords(words), ideasCovered: 0, ideasConsidered: 0,
        worksCited: 0, stoppedReason: explanation, verification: null, retrievalStrategy: 'scoped_documentary', researchTraversal: traversal } };
  }
  const maps = buildSnapshotMaps(snapshot);

  let coverageQuestions = (request.coverageQuestions ?? [])
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, MAX_COVERAGE_QUESTIONS);
  if (!coverageQuestions.length && deps.decomposeObjective) {
    try {
      coverageQuestions = (await deps.decomposeObjective(request.objective, language))
        .map((question) => question.trim())
        .filter(Boolean)
        .slice(0, MAX_COVERAGE_QUESTIONS);
    } catch {
      /* The original objective remains the complete coverage contract. */
    }
  }
  const sectionPlan = resolveSectionPlan(snapshot, request.sectionLimit ?? 'auto', request.objective, coverageQuestions);
  const sectionCount = sectionPlan.target;
  // Normalized once here so a legacy request, a persisted queue job and an MCP
  // payload all reach the writers — and the report metadata — as the same value.
  const requestedSectionLength = normalizeDeepResearchSectionLength(request.sectionLength);
  const sectionLengthPlan = planDeepResearchSectionLength(requestedSectionLength);

  emit({ phase: 'planning', message: L.planning(sectionCount) });
  // Ideas and their relationships still choose the thesis and progression. Atomic
  // questions enter the same planning pass only as a coverage contract: hiding them
  // until after the architecture was frozen caused plans to omit the most concrete
  // institutional mechanisms even when the objective named them explicitly.
  const effectiveRequest: DeepResearchRequest = { ...request, coverageQuestions };
  const plan = await planWithFallback(deps, effectiveRequest, language, snapshot, sectionPlan);

  // A bounded diagnostic pass can add graph assignments and one primary owner per
  // question, but the reconciliation guard preserves every historical proposition.
  assignMissingCoverageQuestions(plan.sections, coverageQuestions);
  if (coverageQuestions.length && deps.auditPlanCoverage) {
    try {
      const planningPool = buildPlanInput(effectiveRequest, language, snapshot, sectionPlan);
      const audited = await deps.auditPlanCoverage({
        objective: request.objective,
        language,
        coverageQuestions,
        plan: clonePlan(plan),
        ideas: planningPool.ideas,
        gaps: planningPool.gaps,
        contradictions: planningPool.contradictions,
      });
      reconcileCoverageAudit(plan, audited, snapshot, coverageQuestions);
    } catch {
      /* The graph-first plan remains valid without the diagnostic pass. */
    }
  }
  enforcePlanObjectiveExclusions(plan, snapshot, request.objective);
  assignMissingCoverageQuestions(plan.sections, coverageQuestions);

  let documentPreparation: PlanEvidencePreparationResult | null = null;
  if (deps.preparePlanEvidence) {
    const candidates = plannedCandidateWorkIds(plan, snapshot);
    emit({
      phase: 'document_preparation',
      message: `Preparando evidencia documental para ${Math.min(candidates.length, 8)} obras elegidas por el argumento…`,
    });
    try {
      documentPreparation = await deps.preparePlanEvidence({
        objective: request.objective,
        language,
        coverageQuestions,
        plan: clonePlan(plan),
        candidateWorkIds: candidates,
      });
      emit({
        phase: 'document_preparation',
        message: documentPreparation.requested
          ? `${documentPreparation.prepared} fichas documentales listas para reforzar lagunas concretas del plan.`
          : 'El plan ya dispone de la evidencia documental disponible; se mantiene su arquitectura argumental.',
      });
    } catch {
      documentPreparation = null;
      emit({
        phase: 'document_preparation',
        message: 'La preparación documental no estaba disponible; el informe continúa con el grafo de ideas.',
      });
    }
  }

  const written: { section: DeepResearchPlanSection; markdown: string }[] = [];
  /** Ideas the prose really cites. */
  const coveredIdeaIds = new Set<string>();
  /** Ideas a section was told to develop, cited or not — used to report honestly. */
  const assignedIdeaIds = new Set<string>();
  const citedIds = {
    ideas: new Set<string>(),
    works: new Set<string>(),
    gaps: new Set<string>(),
    contradictions: new Set<string>(),
    passages: new Set<string>(),
  };
  let totalWords = 0;
  let stoppedReason: string | null = null;
  const verification = { checked: 0, partial: 0, unsupported: 0, unverified: 0 };
  const supportAudit: SupportAuditEntry[] = [];
  let qualityRevisions = 0;
  let generationComparisons = 0;
  let plannedSectionsSelected = 0;
  let baselineSectionsSelected = 0;
  const claimAudit = { checked: 0, supported: 0, partial: 0, unsupported: 0 };
  const claimAuditRoles = Object.fromEntries([
    'fact', 'actor_time', 'mechanism', 'causality', 'comparison_side',
    'agreement', 'contradiction', 'effect', 'reception', 'limit', 'method',
  ].map((role) => [role, { checked: 0, supported: 0 }])) as Record<DeepResearchProofRole, { checked: number; supported: number }>;
  const coverageEvidence: Array<{
    question: string;
    status: 'supported' | 'partial' | 'unsupported';
    revised: string;
    evidenceTokens: string[];
  }> = [];

  const runSection = async (
    section: DeepResearchPlanSection,
    isConclusion: boolean,
    mergeIntoIndex: number | null = null
  ): Promise<void> => {
    emit({
      phase: 'section',
      message: `${L.writing}: ${section.title}`,
      sectionIndex: written.length + 1,
      // What the progress bar divides by. The finite evidence-derived plan is the
      // honest denominator; no page or word budget can stop it early.
      sectionTotal: plan.sections.length,
      sectionTitle: section.title,
      wordsSoFar: totalWords,
      pagesSoFar: pagesFromWords(totalWords),
    });

    // Ask the corpus again, this time about THIS section. Anything it returns is
    // folded into the maps first, so it is genuinely citable rather than stripped.
    const retrievedPassageIds = new Set<string>();
    if (deps.retrieveForSection) {
      try {
        const material = await deps.retrieveForSection({
          objective: effectiveRequest.objective,
          sectionTitle: section.title,
          purpose: section.purpose,
          keyClaims: [...section.keyClaims],
          coverageQuestions: [...(section.coverageQuestions ?? [])],
          excludeIdeaIds: [...new Set([...section.ideaIds, ...coveredIdeaIds])],
          excludePassageIds: [...new Set([...section.passageIds, ...citedIds.passages])],
          limits: SECTION_RETRIEVAL_LIMITS,
        });
        const merged = mergeRetrievedMaterial(maps, material ?? {});
        for (const id of merged.passageIds) retrievedPassageIds.add(id);
        mergeSectionEvidencePacks(section, material?.evidencePacks ?? []);
        const roomForIdeas = Math.max(0, MAX_SECTION_IDEAS - section.ideaIds.length);
        section.ideaIds = [...new Set([...section.ideaIds, ...merged.ideaIds.slice(0, roomForIdeas)])];
        section.passageIds = [...new Set([...section.passageIds, ...merged.passageIds])];
      } catch {
        /* retrieval is an enrichment; the section still writes from the plan */
      }
    }

    let inputForSection = sectionInput(effectiveRequest, language, section, isConclusion, maps, written, coveredIdeaIds, plan.sections);
    const coverageQuestionsForSection = section.coverageQuestions ?? [];
    const plannedClaims = [...section.keyClaims];
    const auditTargets = [...plannedClaims, ...coverageQuestionsForSection];
    if (deps.auditSectionClaims && auditTargets.length > 0) {
      try {
        let audited: SectionClaimAudit | null = null;
        for (let recoveryPass = 0; recoveryPass <= MAX_COVERAGE_RECOVERY_PASSES; recoveryPass += 1) {
          audited = normalizeSectionClaimAudit(
            await deps.auditSectionClaims(inputForSection),
            auditTargets,
            new Set(inputForSection.citationMenu.map((item) => item.token)),
          );
          const missingQuestions = audited.items
            .slice(plannedClaims.length)
            .map((item, index) => ({ item, question: coverageQuestionsForSection[index] }))
            .filter(({ item, question }) => Boolean(question) && item.status !== 'supported')
            .map(({ question }) => question);
          if (recoveryPass >= MAX_COVERAGE_RECOVERY_PASSES || !missingQuestions.length || !deps.retrieveForSection) break;
          let recovery: SectionRetrievalResult | null = null;
          try {
            recovery = await deps.retrieveForSection({
              objective: effectiveRequest.objective,
              sectionTitle: section.title,
              purpose: section.purpose,
              keyClaims: plannedClaims,
              coverageQuestions: missingQuestions,
              excludeIdeaIds: [...new Set([...section.ideaIds, ...coveredIdeaIds])],
              excludePassageIds: [...new Set([...section.passageIds, ...citedIds.passages])],
              limits: COVERAGE_RECOVERY_RETRIEVAL_LIMITS,
            });
          } catch {
            break;
          }
          const merged = mergeRetrievedMaterial(maps, recovery ?? {});
          for (const id of merged.passageIds) retrievedPassageIds.add(id);
          mergeSectionEvidencePacks(section, recovery?.evidencePacks ?? []);
          const roomForIdeas = Math.max(0, MAX_SECTION_IDEAS - section.ideaIds.length);
          section.ideaIds = [...new Set([...section.ideaIds, ...merged.ideaIds.slice(0, roomForIdeas)])];
          section.passageIds = [...new Set([...section.passageIds, ...merged.passageIds])];
          inputForSection = sectionInput(
            effectiveRequest,
            language,
            section,
            isConclusion,
            maps,
            written,
            coveredIdeaIds,
            plan.sections,
          );
        }
        if (!audited) throw new Error('empty claim audit');
        if (audited.items.length === auditTargets.length) {
          // The recovery pass deliberately maximizes recall. The epistemic audit
          // then converts that wide pool into a small evidence pack, so irrelevant
          // retry passages cannot distract the writer or inflate apparent depth.
          if (retrievedPassageIds.size > 0) {
            const selectedRecoveryPassages = new Set(
              audited.items.flatMap((item) => {
                const packed = (item.evidencePack ?? [])
                  .filter((entry) => entry.role !== 'irrelevant')
                  .map((entry) => entry.token);
                return packed.length > 0 ? packed : item.evidenceTokens;
              }).map(passageIdFromCitationToken).filter((id): id is string => Boolean(id)),
            );
            section.passageIds = section.passageIds.filter((id) =>
              !retrievedPassageIds.has(id) || selectedRecoveryPassages.has(id));
            section.retrievalEvidencePacks = (section.retrievalEvidencePacks ?? []).map((pack) => ({
              question: pack.question,
              passageIds: pack.passageIds.filter((id) => selectedRecoveryPassages.has(id)),
              candidates: (pack.candidates ?? []).filter((candidate) => selectedRecoveryPassages.has(candidate.passageId)),
            }));
          }
          claimAudit.checked += audited.items.length;
          for (const item of audited.items) {
            claimAudit[item.status] += 1;
            for (const requirement of item.requirements ?? []) {
              const role = requirement.proofRole ?? 'fact';
              claimAuditRoles[role].checked += 1;
              if (requirement.supported) claimAuditRoles[role].supported += 1;
            }
          }
          const plannedClaimCount = plannedClaims.length;
          section.keyClaims = audited.items.slice(0, plannedClaimCount).map((item) => item.revised);
          section.coverageClaims = audited.items.slice(plannedClaimCount).map((item) => item.revised);
          coverageQuestionsForSection.forEach((question, index) => {
            const item = audited.items[plannedClaimCount + index];
            if (!item) return;
            coverageEvidence.push({
              question,
              status: item.status,
              revised: item.revised,
              evidenceTokens: [...item.evidenceTokens],
            });
          });
          inputForSection = {
            ...sectionInput(effectiveRequest, language, section, isConclusion, maps, written, coveredIdeaIds, plan.sections),
            claimAudit: {
              items: audited.items.map((item) => ({
                ...item,
                evidencePack: (item.evidencePack ?? []).filter((entry) => entry.role !== 'irrelevant'),
              })),
            },
          };
        }
      } catch {
        /* The writer still treats unaudited plan propositions as hypotheses. */
      }
    }
    if (deps.planSectionEvidence) {
      try {
        const evidencePlan = await deps.planSectionEvidence(inputForSection);
        if (evidencePlan?.paragraphs?.length) inputForSection = { ...inputForSection, evidencePlan };
      } catch {
        /* the ordinary section writer remains a complete fallback */
      }
    }

    let raw = '';
    try {
      raw = await deps.writeSection(inputForSection);
    } catch {
      // One retry, then a graceful degraded section — never fail the whole report.
      try {
        raw = await deps.writeSection(inputForSection);
      } catch {
        raw = degradedSection(section, maps, L);
        if (!stoppedReason) stoppedReason = L.degraded;
      }
    }

    // The evidence-planned writer is deliberately not allowed to replace the
    // established monolithic writer on faith. Generate both from the same evidence
    // menu and keep the planned version only when a two-order blind comparison
    // selects it. A tie, order effect or judge failure preserves the baseline. This
    // is expensive, but it gives the new retrieval/writing path a per-section
    // non-regression barrier instead of trusting proxy metrics that can be gamed by
    // extra citations and headings.
    if (inputForSection.evidencePlan && deps.judgeSectionRevision) {
      try {
        const baselineInput: SectionInput = { ...inputForSection, evidencePlan: undefined };
        const baselineRaw = await deps.writeSection(baselineInput);
        generationComparisons += 1;
        const plannedWon = await deps.judgeSectionRevision(baselineInput, baselineRaw, raw);
        if (plannedWon) {
          plannedSectionsSelected += 1;
        } else {
          raw = baselineRaw;
          inputForSection = baselineInput;
          baselineSectionsSelected += 1;
        }
      } catch {
        // The planned draft is already complete. Failure of the optional baseline
        // candidate must not discard a usable section or fail the report.
      }
    }

    const normalized = recoverPlainMenuCitations(
      enforceObjectiveExclusions(normalizeNarrativeSection(raw, section.title), effectiveRequest.objective),
      inputForSection.citationMenu,
    );
    let { markdown, cited } = applyCitationPolicy(normalized, maps);
    const qualitySources = qualitySourcesFromMenu(inputForSection.citationMenu);

    // A professional-editing pass is triggered by measurable weakness, not by prose
    // length. The model gets the exact failed gates, then code rejects any rewrite
    // that loses grounding, invents a citation, pads citations or thins the section.
    if (deps.reviseSection) {
      const beforeQuality = assessDeepResearchSection({
        markdown,
        mode: 'academic',
        objective: effectiveRequest.objective,
        keyClaims: [...section.keyClaims, ...(section.coverageClaims ?? [])],
        sources: qualitySources,
      });
      const finalEditorialPass = Boolean(inputForSection.evidencePlan);
      if (finalEditorialPass || !qualityPasses(beforeQuality) || beforeQuality.score < 85 || beforeQuality.issues.length > 0) {
        try {
          const revisedRaw = await deps.reviseSection({ ...inputForSection, draft: markdown, quality: beforeQuality });
          const revised = applyCitationPolicy(recoverPlainMenuCitations(
            enforceObjectiveExclusions(normalizeNarrativeSection(revisedRaw, section.title), effectiveRequest.objective),
            inputForSection.citationMenu,
          ), maps).markdown;
          const afterQuality = assessDeepResearchSection({
            markdown: revised,
            mode: 'academic',
            objective: effectiveRequest.objective,
            keyClaims: [...section.keyClaims, ...(section.coverageClaims ?? [])],
            sources: qualitySources,
          });
          const deterministicAcceptance = finalEditorialPass
            ? shouldAcceptEditorialRevision(beforeQuality, afterQuality, citationUrlsFromMenu(inputForSection.citationMenu), revised)
            : shouldAcceptQualityRevision(beforeQuality, afterQuality, citationUrlsFromMenu(inputForSection.citationMenu), revised);
          const qualitativeAcceptance = deterministicAcceptance && finalEditorialPass && deps.judgeSectionRevision
            ? await deps.judgeSectionRevision(inputForSection, markdown, revised)
            : true;
          if (deterministicAcceptance && qualitativeAcceptance) {
            markdown = revised;
            ({ cited } = applyCitationPolicy(markdown, maps));
            qualityRevisions += 1;
          }
        } catch {
          /* the already-grounded draft remains available */
        }
      }
    }

    // Entailment pass. Everything downstream — the cited sets, the references, the
    // matrix — is derived from the VERIFIED text, so a citation the source does not
    // support cannot survive anywhere in the report, not even in the bibliography.
    let verificationConcerns: string[] = [];
    let concernCount = 0;
    let firstVerificationOutcome: VerificationOutcome | null = null;
    const supportAuditStart = supportAudit.length;
    if (deps.verifyCitations) {
      const claims = extractCitationClaims(markdown, maps);
      if (claims.length > 0) {
        try {
          const verdicts = await deps.verifyCitations(claims, language);
          if (Array.isArray(verdicts) && verdicts.length === claims.length) {
            const outcome = applyVerification(markdown, claims, verdicts);
            firstVerificationOutcome = outcome;
            concernCount = outcome.partial + outcome.unsupported;
            verificationConcerns = dedupe(outcome.audit.map((entry) => entry.claim.sentence)).slice(0, 12);
            verification.checked += outcome.checked;
            verification.partial += outcome.partial;
            verification.unsupported += outcome.unsupported;
            for (const entry of outcome.audit) {
              if (supportAudit.length >= MAX_SUPPORT_AUDIT) break;
              supportAudit.push({
                verdict: entry.verdict,
                kind: entry.claim.kind,
                section: section.title,
                sentence: entry.claim.sentence,
                source: clip(entry.claim.content, 400),
                sourceLabel: sourceLabelForClaim(entry.claim, maps),
              });
            }
            if (outcome.partial > 0 || outcome.unsupported > 0) {
              markdown = outcome.markdown;
              ({ cited } = applyCitationPolicy(markdown, maps));
            }
          }
        } catch {
          verification.unverified += claims.length;
          /* an unavailable judge must not cost the report its section */
        }
      }
    }

    // Verification can legitimately remove links from an otherwise strong draft.
    // Re-evaluate the text that will actually be published and permit one final,
    // bounded repair. The repair itself is verified again before acceptance, so
    // this closes the quality gap without widening the evidence boundary.
    if (deps.reviseSection && deps.verifyCitations) {
      const postVerificationQuality = assessDeepResearchSection({
        markdown,
        mode: 'academic',
        objective: effectiveRequest.objective,
        keyClaims: [...section.keyClaims, ...(section.coverageClaims ?? [])],
        sources: qualitySources,
      });
      const structuralRepairNeeded = !qualityPasses(postVerificationQuality)
        || postVerificationQuality.score < 85
        || postVerificationQuality.issues.length > 0;
      if (structuralRepairNeeded || concernCount > 0) {
        try {
          const repairedRaw = await deps.reviseSection({
            ...inputForSection,
            draft: markdown,
            quality: postVerificationQuality,
            verificationConcerns,
          });
          let repaired = applyCitationPolicy(recoverPlainMenuCitations(
            enforceObjectiveExclusions(normalizeNarrativeSection(repairedRaw, section.title), effectiveRequest.objective),
            inputForSection.citationMenu,
          ), maps).markdown;
          const repairedClaims = extractCitationClaims(repaired, maps);
          if (repairedClaims.length > 0) {
          const repairedVerdicts = await deps.verifyCitations(repairedClaims, language);
            if (Array.isArray(repairedVerdicts) && repairedVerdicts.length === repairedClaims.length) {
              const repairedOutcome = applyVerification(repaired, repairedClaims, repairedVerdicts);
              repaired = repairedOutcome.markdown;
              const repairedQuality = assessDeepResearchSection({
                markdown: repaired,
                mode: 'academic',
                objective: effectiveRequest.objective,
                keyClaims: [...section.keyClaims, ...(section.coverageClaims ?? [])],
                sources: qualitySources,
              });
              const concernsAfter = repairedOutcome.partial + repairedOutcome.unsupported;
              const allowedUrls = citationUrlsFromMenu(inputForSection.citationMenu);
              const accepted = concernCount > 0
                ? shouldAcceptEvidenceRepair(
                  postVerificationQuality, repairedQuality, allowedUrls, repaired,
                  concernCount, concernsAfter,
                )
                : shouldAcceptQualityRevision(
                  postVerificationQuality, repairedQuality, allowedUrls, repaired,
                );
              if (accepted) {
                markdown = repaired;
                ({ cited } = applyCitationPolicy(markdown, maps));
                if (firstVerificationOutcome) {
                  verification.checked -= firstVerificationOutcome.checked;
                  verification.partial -= firstVerificationOutcome.partial;
                  verification.unsupported -= firstVerificationOutcome.unsupported;
                  supportAudit.splice(supportAuditStart);
                }
                verification.checked += repairedOutcome.checked;
                verification.partial += repairedOutcome.partial;
                verification.unsupported += repairedOutcome.unsupported;
                for (const entry of repairedOutcome.audit) {
                  if (supportAudit.length >= MAX_SUPPORT_AUDIT) break;
                  supportAudit.push({
                    verdict: entry.verdict,
                    kind: entry.claim.kind,
                    section: section.title,
                    sentence: entry.claim.sentence,
                    source: clip(entry.claim.content, 400),
                    sourceLabel: sourceLabelForClaim(entry.claim, maps),
                  });
                }
                qualityRevisions += 1;
              }
            }
          }
        } catch {
          /* the already-verified draft remains available */
        }
      }
    }
    if (mergeIntoIndex != null && written[mergeIntoIndex]) {
      const existing = written[mergeIntoIndex];
      existing.markdown = `${existing.markdown.trim()}\n\n${stripInitialHeading(markdown)}`.trim();
      existing.section = mergePlanSections(existing.section, section);
    } else {
      written.push({ section, markdown });
    }
    // Coverage is what the prose actually cites. Counting a section's *mandate* as
    // covered made the statistic unfalsifiable (every idea is assigned to some
    // section, so it always read 100%) and silently disabled the top-up below.
    for (const id of cited.ideas) {
      citedIds.ideas.add(id);
      coveredIdeaIds.add(id);
    }
    for (const id of section.ideaIds) if (maps.ideaById.has(id)) assignedIdeaIds.add(id);
    cited.works.forEach((id) => citedIds.works.add(id));
    cited.gaps.forEach((id) => citedIds.gaps.add(id));
    cited.contradictions.forEach((id) => citedIds.contradictions.add(id));
    cited.passages.forEach((id) => {
      citedIds.passages.add(id);
      const workId = maps.passageWorkId.get(id);
      if (workId) citedIds.works.add(workId);
    });
    totalWords += countWords(markdown);
  };

  // Planned sections.
  for (let i = 0; i < plan.sections.length; i++) {
    const isConclusion = i === plan.sections.length - 1;
    await runSection(plan.sections[i], isConclusion);
  }

  // Report-wide edit. A section cannot know that a later section repeats its
  // mechanism or that a debate is developed elsewhere. The reviewer sees the full
  // argument, but every rewrite remains bounded by its original citation menu,
  // deterministic quality guards, a two-order blind comparison and entailment.
  if (deps.reviewReport && deps.reviseSection && deps.judgeSectionRevision && deps.verifyCitations && written.length > 1) {
    try {
      const review = await deps.reviewReport({
        objective: effectiveRequest.objective,
        language,
        sections: written.map((item) => ({
          title: item.section.title,
          purpose: item.section.purpose,
          responsibilities: [...item.section.keyClaims, ...(item.section.coverageQuestions ?? [])],
          markdown: item.markdown,
        })),
      });
      const staged = written.map((item) => ({ section: item.section, markdown: item.markdown }));
      let acceptedGlobalEdits = 0;
      for (let index = 0; index < staged.length; index += 1) {
        const item = staged[index];
        const directive = review.directives.find((candidate) => normalizeForMatch(candidate.sectionTitle) === normalizeForMatch(item.section.title));
        if (!directive) continue;
        const input = sectionInput(
          request,
          language,
          item.section,
          index === written.length - 1,
          maps,
          staged.slice(0, index),
          coveredIdeaIds,
          plan.sections,
        );
        const qualitySources = qualitySourcesFromMenu(input.citationMenu);
        const beforeQuality = assessDeepResearchSection({
          markdown: item.markdown,
          mode: 'academic',
          objective: effectiveRequest.objective,
          keyClaims: [...item.section.keyClaims, ...(item.section.coverageClaims ?? [])],
          sources: qualitySources,
        });
        const revisedRaw = await deps.reviseSection({
          ...input,
          draft: item.markdown,
          quality: beforeQuality,
          editorialDirective: directive,
        });
        let revised = applyCitationPolicy(recoverPlainMenuCitations(
          enforceObjectiveExclusions(normalizeNarrativeSection(revisedRaw, item.section.title), effectiveRequest.objective),
          input.citationMenu,
        ), maps).markdown;
        const revisedClaims = extractCitationClaims(revised, maps);
        let concernsAfter = 0;
        if (revisedClaims.length) {
          const verdicts = await deps.verifyCitations(revisedClaims, language);
          if (!Array.isArray(verdicts) || verdicts.length !== revisedClaims.length) continue;
          const outcome = applyVerification(revised, revisedClaims, verdicts);
          revised = outcome.markdown;
          concernsAfter = outcome.partial + outcome.unsupported;
        }
        const concernsBefore = supportAudit.filter((entry) => entry.section === item.section.title).length;
        if (concernsAfter > concernsBefore) continue;
        const afterQuality = assessDeepResearchSection({
          markdown: revised,
          mode: 'academic',
          objective: effectiveRequest.objective,
          keyClaims: [...item.section.keyClaims, ...(item.section.coverageClaims ?? [])],
          sources: qualitySources,
        });
        if (!shouldAcceptEditorialRevision(beforeQuality, afterQuality, citationUrlsFromMenu(input.citationMenu), revised)) continue;
        if (!await deps.judgeSectionRevision(input, item.markdown, revised)) continue;
        item.markdown = revised;
        acceptedGlobalEdits += 1;
      }

      // The preliminary per-section counters no longer describe edited prose.
      // Re-verify the exact final text from zero so the visible audit is honest.
      const finalVerification = { checked: 0, partial: 0, unsupported: 0, unverified: 0 };
      const finalSupportAudit: SupportAuditEntry[] = [];
      for (const item of staged) {
        const claims = extractCitationClaims(item.markdown, maps);
        if (!claims.length) continue;
        try {
          const verdicts = await deps.verifyCitations(claims, language);
          if (!Array.isArray(verdicts) || verdicts.length !== claims.length) {
            finalVerification.unverified += claims.length;
            continue;
          }
          const outcome = applyVerification(item.markdown, claims, verdicts);
          item.markdown = outcome.markdown;
          finalVerification.checked += outcome.checked;
          finalVerification.partial += outcome.partial;
          finalVerification.unsupported += outcome.unsupported;
          for (const entry of outcome.audit) {
            if (finalSupportAudit.length >= MAX_SUPPORT_AUDIT) break;
            finalSupportAudit.push({
              verdict: entry.verdict,
              kind: entry.claim.kind,
              section: item.section.title,
              sentence: entry.claim.sentence,
              source: clip(entry.claim.content, 400),
              sourceLabel: sourceLabelForClaim(entry.claim, maps),
            });
          }
        } catch {
          finalVerification.unverified += claims.length;
        }
      }

      // Commit only after the complete staged pass and final verification finish.
      staged.forEach((item, index) => { written[index].markdown = item.markdown; });
      Object.assign(verification, finalVerification);
      supportAudit.splice(0, supportAudit.length, ...finalSupportAudit);
      qualityRevisions += acceptedGlobalEdits;

      // All downstream coverage, bibliography and metrics derive from the edited,
      // re-verified prose, never from the preliminary drafts.
      coveredIdeaIds.clear();
      Object.values(citedIds).forEach((set) => set.clear());
      for (const item of staged) {
        const { cited } = applyCitationPolicy(item.markdown, maps);
        cited.ideas.forEach((id) => { citedIds.ideas.add(id); coveredIdeaIds.add(id); });
        cited.works.forEach((id) => citedIds.works.add(id));
        cited.gaps.forEach((id) => citedIds.gaps.add(id));
        cited.contradictions.forEach((id) => citedIds.contradictions.add(id));
        cited.passages.forEach((id) => {
          citedIds.passages.add(id);
          const workId = maps.passageWorkId.get(id);
          if (workId) citedIds.works.add(workId);
        });
      }
      totalWords = staged.reduce((sum, item) => sum + countWords(item.markdown), 0);
    } catch {
      /* the individually verified report remains the safe fallback */
    }
  }

  const coverageInputs = new Map(written.map((item, index) => [item, sectionInput(effectiveRequest, language, { ...item.section, keyClaims: [...item.section.keyClaims], coverageClaims: [...(item.section.coverageClaims ?? [])] }, index === written.length - 1, maps, written.slice(0, index), coveredIdeaIds, plan.sections)]));
  const claimLedger: ResearchClaimRecord[] = [];
  let consistency: NonNullable<NonNullable<DeepResearchMeta['factualAudit']>['consistency']> | null = null;
  if (deps.auditFactualProse) {
    for (const [index, item] of written.entries()) {
      if (deps.repairSectionCoverage) {
        const repaired = await deps.repairSectionCoverage(coverageInputs.get(item)!, item.markdown);
        item.markdown = applyCitationPolicy(repaired, maps).markdown;
      }
      const audit = await deps.auditFactualProse(item.markdown);
      if (audit.passages?.length) mergeRetrievedMaterial(maps, { passages: audit.passages });
      item.markdown = audit.markdown;
      claimLedger.push(...audit.claims);
      // Planned claims are research questions, not verified findings. Only the
      // audited prose may populate the published outline's factual claims.
      item.section.keyClaims = audit.claims.filter(claim => claim.status === 'supported' && claim.kind !== 'nonfactual').map(claim => claim.sentence);
      item.section.coverageClaims = [];
      item.section.title = audit.markdown.trimStart().match(/^#{1,6}\s+([^\n]+)/)?.[1] ?? `${L.threadTitle} ${index + 1}`;
    }
    for (let index = written.length - 1; index >= 0; index--) {
      if (!stripInitialHeading(written[index].markdown).trim()) written.splice(index, 1);
    }
    if (!claimLedger.some(claim => claim.status === 'supported' && claim.kind !== 'nonfactual')) written.length = 0;
    if (claimLedger.some(claim => claim.status !== 'supported') || !written.length) stoppedReason = researchEvidenceLimitation(language);
    coveredIdeaIds.clear(); Object.values(citedIds).forEach(set => set.clear());
    for (const item of written) {
      const { cited } = applyCitationPolicy(item.markdown, maps);
      for (const key of Object.keys(citedIds) as Array<keyof typeof citedIds>) cited[key].forEach(id => citedIds[key].add(id));
      cited.ideas.forEach(id => coveredIdeaIds.add(id));
      cited.passages.forEach(id => { const work = maps.passageWorkId.get(id); if (work) citedIds.works.add(work); });
    }
    totalWords = written.reduce((sum, item) => sum + countWords(item.markdown), 0);
  }

  emit({
    phase: 'assembling',
    message: L.assembling,
    wordsSoFar: totalWords,
    pagesSoFar: pagesFromWords(totalWords),
  });

  // Does the report contradict itself? Reported, never repaired: rewriting assembled
  // prose would put every verified citation at risk, and a researcher is better
  // served by being told where the tension is than by having it quietly smoothed.
  let coherenceIssues: CoherenceIssue[] = [];
  if (deps.checkCoherence && written.length > 1) {
    try {
      const sections = written.map((w) => ({ title: w.section.title, text: stripInitialHeading(w.markdown) }));
      coherenceIssues = groundCoherenceIssues(await deps.checkCoherence(sections, language), sections);
    } catch {
      /* a missing coherence check never costs the report */
    }
  }

  // Now that coverage means "cited", these samples are real: they name material the
  // report was handed and did not use, which is exactly what a limitation should say.
  const pending = pendingIdeas(snapshot, coveredIdeaIds, assignedIdeaIds);
  const uncoveredSamples = pending.slice(0, 5).map((idea) => idea.label);

  const finalizeInput: FinalizeInput = {
    objective: effectiveRequest.objective,
    language,
    planTitle: plan.title,
    sectionTitles: written.map((w) => w.section.title),
    ideasCovered: coveredIdeaIds.size,
    ideasConsidered: snapshot.ideas.length,
    uncoveredSamples,
    sectionFindings: written.map((item) => ({
      title: item.section.title,
      text: clip(stripInitialHeading(item.markdown), 2_400),
    })),
    supportConcerns: [...supportAudit.map(entry => entry.sentence), ...claimLedger.filter(claim => claim.status !== 'supported').map(claim => claim.sentence)].slice(0, 30),
  };
  let finalize = deps.strictDocumentaryGrounding && !written.length
    ? { title: request.objective, abstract: researchEvidenceLimitation(language), limitations: [researchEvidenceLimitation(language)], nextSteps: [] }
    : await finalizeWithFallback(deps, finalizeInput, L);
  if (deps.auditFinalSummary && (!deps.strictDocumentaryGrounding || written.length)) {
    try {
      const audited = await deps.auditFinalSummary(finalizeInput, finalize);
      finalize = {
        title: cleanStr(audited.title, finalize.title),
        abstract: cleanStr(audited.abstract, finalize.abstract),
        // A final audit may discover another limitation; it can never erase one
        // already established by coverage, support or the first finalizer.
        limitations: dedupe([...finalize.limitations, ...strList(audited.limitations)]),
        nextSteps: strList(audited.nextSteps).length ? strList(audited.nextSteps) : finalize.nextSteps,
      };
    } catch {
      /* the first finalizer already received verified findings and remains safe */
    }
  }

  if (deps.auditFactualProse && written.length) {
    const auditFinalText = async (markdown: string) => {
      const audit = await deps.auditFactualProse!(markdown);
      claimLedger.push(...audit.claims);
      if (audit.passages?.length) mergeRetrievedMaterial(maps, { passages: audit.passages });
      const citations = applyCitationPolicy(audit.markdown, maps).cited;
      citations.passages.forEach(id => { citedIds.passages.add(id); const work = maps.passageWorkId.get(id); if (work) citedIds.works.add(work); });
      return audit.markdown;
    };
    finalize.title = request.objective;
    finalize.abstract = await auditFinalText(finalize.abstract) || researchEvidenceLimitation(language);
    // Recommendations and limitations can also smuggle in unsupported facts.
    // Audit them before reintroducing deterministic coverage limitations below.
    finalize.limitations = (await auditFinalText([...finalize.limitations, ...coherenceIssues.map(issue => L.coherenceLimitation(issue))].join('\n'))).split('\n').filter(Boolean);
    finalize.nextSteps = (await auditFinalText(finalize.nextSteps.join('\n'))).split('\n').filter(Boolean);
    // Each part was audited on its own. Reconcile the whole report: a proposition
    // retired anywhere cannot survive in another part, and statements that cannot
    // both hold leave together instead of the report silently choosing a side.
    const reconciled = await reconcileResearchReport({ sections: written.map(item => item.markdown), abstract: finalize.abstract,
      limitations: finalize.limitations, nextSteps: finalize.nextSteps }, claimLedger, deps.auditReportConsistency?.bind(deps));
    consistency = { checked: reconciled.consistencyChecked, conflicts: reconciled.conflicts, removed: reconciled.removed, pruned: reconciled.pruned, pairs: reconciled.conflictPairs };
    written.forEach((item, index) => { item.markdown = reconciled.parts.sections[index]; });
    for (let index = written.length - 1; index >= 0; index--) {
      if (!stripInitialHeading(written[index].markdown).trim()) written.splice(index, 1);
    }
    if (!written.some(item => claimLedger.some(claim => claim.status === 'supported' && claim.kind !== 'nonfactual'
      && researchProseSentenceKeys(item.markdown).has(researchSentenceKey(claim.sentence))))) written.length = 0;
    finalize.abstract = reconciled.parts.abstract || researchEvidenceLimitation(language);
    finalize.limitations = reconciled.parts.limitations;
    finalize.nextSteps = reconciled.parts.nextSteps;
    for (const [index, item] of written.entries()) {
      const present = researchProseSentenceKeys(item.markdown);
      item.section.keyClaims = item.section.keyClaims.filter(claim => present.has(researchSentenceKey(claim)));
      const heading = item.markdown.trimStart().match(/^#{1,6}\s+([^\n]+)/)?.[1];
      item.section.title = heading ?? `${L.threadTitle} ${index + 1}`;
      // Removing an unsupported heading must not merge its verified body into
      // the preceding section. Restore only a neutral, localized navigation label.
      if (!heading) item.markdown = `## ${item.section.title}\n\n${item.markdown.trim()}`;
    }
    // Citations are recounted from what finally remains, not from removed prose.
    coveredIdeaIds.clear(); Object.values(citedIds).forEach(set => set.clear());
    for (const text of [...written.map(item => item.markdown), finalize.abstract]) {
      const { cited } = applyCitationPolicy(text, maps);
      for (const key of Object.keys(citedIds) as Array<keyof typeof citedIds>) cited[key].forEach(id => citedIds[key].add(id));
      cited.ideas.forEach(id => coveredIdeaIds.add(id));
      cited.passages.forEach(id => { const work = maps.passageWorkId.get(id); if (work) citedIds.works.add(work); });
    }
    totalWords = written.reduce((sum, item) => sum + countWords(item.markdown), 0);
    if (!written.length) finalize.abstract = researchEvidenceLimitation(language);
    if (claimLedger.some(claim => claim.status !== 'supported') || !written.length || !reconciled.consistencyChecked) {
      finalize.limitations = dedupe([...finalize.limitations, researchEvidenceLimitation(language)]);
      stoppedReason = researchEvidenceLimitation(language);
    }
    if (!reconciled.consistencyChecked) finalize.limitations = dedupe([...finalize.limitations, researchConsistencyUnverified(language)]);
  }

  if (deps.checkSectionCoverage) {
    for (const [item, input] of coverageInputs) {
      const finalText = written.includes(item) ? item.markdown : '';
      if (!await deps.checkSectionCoverage(input, finalText)) {
        const limitation = researchCoverageIncomplete(language);
        finalize.limitations = dedupe([...finalize.limitations, limitation]);
        stoppedReason ||= limitation;
      }
    }
  }

  // Works actually referenced = works cited directly + the works behind every cited idea.
  const citedWorkIds = collectCitedWorkIds(citedIds, maps);
  const references = buildReferences(citedWorkIds, maps, language);
  const singleNarrative = effectiveRequest.sectionLimit === 'single';
  const draftMarkdown = deps.strictDocumentaryGrounding && !written.length ? researchEvidenceLimitation(language)
    : assembleMarkdown(written, references, finalize, language, effectiveRequest.sectionLimit);
  const worksCited = citedWorkIds.size;

  const outline: WritingWorkshopSection[] = singleNarrative ? [] : written.map((w, index) => ({
    id: w.section.id || `s${index + 1}`,
    title: w.section.title,
    purpose: w.section.purpose,
    keyClaims: [...w.section.keyClaims, ...(w.section.coverageClaims ?? [])].slice(0, 16),
    sources: sectionSources(w.section, maps),
  }));

  const matrix = buildMatrix(coveredIdeaIds, maps, L);
  const qualityAssessment = assessDeepResearchReport({
    mode: 'academic',
    objective: effectiveRequest.objective,
    coverageQuestions: effectiveRequest.coverageQuestions,
    coverageEvidence,
    verification,
    internalContradictions: coherenceIssues.length,
    sections: written.map((item) => ({
      title: item.section.title,
      markdown: item.markdown,
      keyClaims: [...item.section.keyClaims, ...(item.section.coverageClaims ?? [])],
      sources: qualitySourcesFromMenu(buildCitationMenu(item.section, maps)),
    })),
  });

  // Automated citation existence/entailment checks never constitute acceptance.
  if (deps.auditFactualProse && qualityAssessment.grade !== 'weak') qualityAssessment.grade = 'needs_review';
  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief,
    selection: {
      ideaIds: [...coveredIdeaIds],
      themeIds: [],
      gapIds: [...citedIds.gaps],
      contradictionIds: [...citedIds.contradictions],
      workIds: [...citedWorkIds],
      passageIds: [...citedIds.passages],
      tutorRouteIds: [],
    },
    title: finalize.title || plan.title || effectiveRequest.objective,
    abstract: finalize.abstract,
    outline,
    draftMarkdown,
    matrix,
    bibliography: references,
    nextSteps: finalize.nextSteps,
    supportAudit,
    ...(deps.auditFactualProse ? { claimLedger } : {}),
    qualityAssessment,
    limitations: [...finalize.limitations, ...(!deps.auditFactualProse ? coherenceIssues.map(issue => L.coherenceLimitation(issue)) : [])],
    deepResearchStructure: singleNarrative ? 'single' : 'sectioned',
    deepResearchSectionLength: requestedSectionLength,
    stats: {
      selectedIdeas: coveredIdeaIds.size,
      selectedThemes: 0,
      selectedGaps: citedIds.gaps.size,
      selectedContradictions: citedIds.contradictions.size,
      selectedWorks: worksCited,
      selectedPassages: citedIds.passages.size,
      selectedTutorRoutes: 0,
      contextChars: draftMarkdown.length,
      truncated: stoppedReason != null,
    },
  };

  const meta: DeepResearchMeta = {
    ...(deps.auditFactualProse ? { factualAudit: { checked: claimLedger.length,
      supported: claimLedger.filter(claim => claim.status === 'supported').length,
      removed: claimLedger.filter(claim => claim.status === 'removed').length,
      unverified: claimLedger.filter(claim => claim.status === 'unverified').length,
      ...(consistency ? { consistency } : {}) } } : {}),
    deepResearchVersion: request.deepResearchVersion ?? 'v1',
    structure: singleNarrative ? 'single' : 'sectioned',
    sectionLength: requestedSectionLength,
    // Recorded per section rather than as one report total: the guidance is per
    // section, and a report where the corpus filled two sections and ran dry on
    // three is a different fact from one that simply came out short.
    sectionLengthOutcome: sectionLengthPlan.targetWords === null ? null : {
      targetWords: sectionLengthPlan.targetWords,
      sections: written.length,
      reached: written.filter((item) => countWords(item.markdown) >= Math.round(sectionLengthPlan.targetWords! * 0.92)).length,
      short: written.filter((item) => countWords(item.markdown) < Math.round(sectionLengthPlan.targetWords! * 0.92)).length,
    },
    sections: singleNarrative && written.length ? 1 : written.length,
    words: totalWords,
    pages: pagesFromWords(totalWords),
    ideasCovered: coveredIdeaIds.size,
    ideasConsidered: snapshot.ideas.length,
    worksCited,
    stoppedReason,
    verification: verification.checked > 0 || verification.unverified > 0 ? { ...verification } : null,
    qualityRevisions,
    generationSelection: generationComparisons > 0 ? {
      compared: generationComparisons,
      planned: plannedSectionsSelected,
      baseline: baselineSectionsSelected,
    } : null,
    coherenceIssues: coherenceIssues.length,
    coverage: effectiveRequest.coverageQuestions?.length
      ? { questions: [...effectiveRequest.coverageQuestions], ratio: qualityAssessment.metrics.objectiveCoverage }
      : null,
    retrievalStrategy: request.deepResearchVersion === 'v1'
      ? 'legacy'
      : 'idea_first_document_enrichment',
    documentPreparation,
    claimAudit: claimAudit.checked > 0 ? {
      ...claimAudit,
      roles: Object.fromEntries(Object.entries(claimAuditRoles).filter(([, counts]) => counts.checked > 0)),
    } : null,
  };

  const traversal = await deps.researchTraversal?.();
  if (traversal) {
    meta.researchTraversal = traversal;
    meta.retrievalStrategy = 'scoped_documentary';
    draft.researchTraversal = traversal;
    draft.stats.truncated ||= traversal.partial;
  }

  emit({
    phase: 'done',
    message: L.done(meta.sections, meta.pages),
    wordsSoFar: totalWords,
    pagesSoFar: meta.pages,
  });

  return { draft, meta };
}

function sectionInput(
  request: DeepResearchRequest,
  language: PromptLanguage,
  section: DeepResearchPlanSection,
  isConclusion: boolean,
  maps: SnapshotMaps,
  written: { section: DeepResearchPlanSection; markdown: string }[],
  covered: Set<string>,
  planSections: DeepResearchPlanSection[],
): SectionInput {
  const citationMenu = buildCitationMenu(section, maps)
    .filter((item) => !matchesObjectiveExclusion(citationMenuExclusionText(item, maps), request.objective));
  const passageMenuById = new Map<string, CitationMenuItem>();
  for (const item of citationMenu) {
    const id = passageIdFromCitationToken(item.token);
    if (id) passageMenuById.set(id, item);
  }
  return {
    objective: request.objective,
    language,
    audience: request.audience,
    section,
    isConclusion,
    citationMenu,
    atomicEvidencePacks: (section.retrievalEvidencePacks ?? []).map((pack) => ({
      question: pack.question,
      candidates: pack.passageIds
        .map((id) => {
          const item = passageMenuById.get(id);
          const retrieval = pack.candidates?.find((candidate) => candidate.passageId === id);
          return item && retrieval
            ? { ...item, retrieval: {
              query: retrieval.query,
              rank: retrieval.rank,
              lanes: [...retrieval.lanes],
              score: retrieval.score,
              reason: retrieval.reason,
            } }
            : item;
        })
        .filter((item): item is CitationMenuItem => Boolean(item)),
    })),
    priorSummary: summarizePrior(written),
    alreadyDeveloped: [...covered]
      .map((id) => maps.ideaById.get(id))
      .filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea)
      .slice(0, 24)
      .map((idea) => clip(idea.statement || idea.label, 140)),
    reservedForOtherSections: isConclusion ? [] : planSections
      .filter((candidate) => candidate.id !== section.id)
      .map((candidate) => ({
        title: candidate.title,
        responsibilities: [...candidate.keyClaims, ...(candidate.coverageQuestions ?? [])].slice(0, 8),
      })),
    sectionLength: planDeepResearchSectionLength(request.sectionLength),
  };
}

export function citationMenuExclusionText(item: CitationMenuItem, maps: SnapshotMaps): string {
  const target = item.token.match(/\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)]*)\)$/u);
  const kind = target?.[1];
  let id = target?.[2] ?? '';
  try { id = decodeURIComponent(id); } catch { /* keep raw id */ }
  const titles: string[] = [];
  if (kind === 'idea') {
    for (const work of maps.ideaById.get(id)?.works ?? []) titles.push(work.title);
  } else if (kind === 'work') {
    const title = maps.workInfoById.get(id)?.title;
    if (title) titles.push(title);
  } else if (kind === 'passage') {
    const workId = maps.passageWorkId.get(id);
    const title = workId ? maps.workInfoById.get(workId)?.title : '';
    if (title) titles.push(title);
  }
  return `${item.source ?? ''} ${item.note} ${titles.join(' ')}`;
}

function passageIdFromCitationToken(token: string): string | null {
  const match = token.match(/\]\(nodus:\/\/passage\/([^)]*)\)$/u);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/**
 * Explicit negative scope is a hard contract, not a suggestion to the writer.
 * Prompts alone were measured to leak excluded axes back into long reports because
 * the retrieved menu still made them salient. These stems remove that material from
 * the menu and police the final prose in the common UI languages.
 */
export function objectiveExclusionStems(objective: string): string[] {
  const patterns = [
    /\b(?:excluir|excluye|excluindo|excluir\s+o|exclure|escludere|exclude|excluding|ausschlie(?:ß|ss)en|hariç\s+tut(?:mak|un|ulan))\b\s+([^.!?;]+)/giu,
    /\b(?:sin\s+abordar|no\s+abordar|without\s+addressing|do\s+not\s+cover|sans\s+aborder|senza\s+trattare|sem\s+abordar|ohne\s+zu\s+behandeln)\b\s+([^.!?;]+)/giu,
  ];
  const stop = new Set([
    'este', 'esta', 'estos', 'estas', 'that', 'this', 'the', 'eje', 'axis', 'tema', 'theme', 'aspecto', 'aspect',
    'ya', 'tratado', 'tratada', 'otro', 'otra', 'informe', 'report', 'and', 'with', 'from', 'dans', 'avec', 'dans',
    'sujet', 'asse', 'tema', 'bereits', 'behandelt', 'rapporto', 'relatorio', 'relatório', 'outro', 'autre', 'einen',
  ]);
  const roots = new Set<string>();
  for (const pattern of patterns) {
    for (const match of objective.matchAll(pattern)) {
      const scope = String(match[1] ?? '').split(/[,(—]/u)[0];
      for (const token of normalizeForMatch(scope).match(/[\p{L}\p{N}]+/gu) ?? []) {
        if (token.length < 5 || stop.has(token)) continue;
        let root = token;
        for (const suffix of ['idad', 'idade', 'ity', 'ité', 'ita', 'ità']) {
          if (root.endsWith(suffix) && root.length - suffix.length >= 5) root = root.slice(0, -suffix.length);
        }
        roots.add(root);
      }
    }
  }
  const expanded = new Set(roots);
  for (const root of roots) {
    if (root.startsWith('colon')) ['colon', 'sahara', 'imperi', 'oriental'].forEach((item) => expanded.add(item));
    if (root.startsWith('gener') || root === 'gender') ['gener', 'gender', 'mujer', 'women', 'feminin', 'masculin', 'sex'].forEach((item) => expanded.add(item));
  }
  return [...expanded].slice(0, 20);
}

export function matchesObjectiveExclusion(text: string, objective: string): boolean {
  const haystack = normalizeForMatch(text);
  return objectiveExclusionStems(objective).some((stem) => haystack.includes(stem));
}

/** Remove only the sentences that violate an explicit exclusion; headings and all
 * unrelated prose remain byte-for-byte intact. */
export function enforceObjectiveExclusions(markdown: string, objective: string): string {
  const stems = objectiveExclusionStems(objective);
  if (!stems.length) return markdown;
  return markdown
    .split(/(\n{2,})/u)
    .map((block) => {
      if (/^\n{2,}$/u.test(block) || /^\s*#{1,6}\s/u.test(block)) return block;
      return block
        .split(/(?<=[.!?])\s+(?=[¿¡"\u00ab(A-ZÁÉÍÓÚÑ])/u)
        .filter((sentence) => {
          const normalized = normalizeForMatch(sentence);
          return !stems.some((stem) => normalized.includes(stem));
        })
        .join(' ')
        .trim();
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n');
}

/** Spanish and English function words that start a subtitle and read better lowercased. */
const SUBTITLE_LEAD_WORDS = new Set(
  ('del de la el los las un una unos unas hacia entre desde sobre para por con sin tras ante entre cuando donde como '
    + 'cómo qué quién cuál hasta the a an of from to towards between within during through under over and or').split(' ')
);

/**
 * Fold a `Título: subtítulo` heading into one continuous phrase.
 *
 * The prose contract asks the planner to avoid split titles and it complies most of
 * the time, but not always — measured at 3 of 15 headings, and the rate grew as the
 * report gained sections. Asking a fourth time was not going to work, so the shape
 * is enforced here instead of requested. The subtitle is kept, not truncated: the
 * information in it is usually the half that says what the section actually argues.
 */
export function normalizeSectionTitle(title: string): string {
  const clean = (title ?? '').replace(/\s+/g, ' ').trim();
  const at = clean.search(/\s*[:;—]\s+/u);
  if (at < 0) return clean;
  const head = clean.slice(0, at).trim().replace(/[.,;:—]+$/u, '');
  const tail = clean.slice(at).replace(/^\s*[:;—]\s+/u, '').trim();
  if (!head) return tail;
  if (!tail) return head;
  const [firstWord, ...rest] = tail.split(' ');
  const lowered = SUBTITLE_LEAD_WORDS.has(firstWord.toLocaleLowerCase('es-ES'))
    ? [firstWord.toLocaleLowerCase('es-ES'), ...rest].join(' ')
    : tail;
  return `${head}, ${lowered}`;
}

/** Ideas the report has not cited, unfinished section mandates first. */
function pendingIdeas(
  snapshot: WritingWorkshopSnapshot,
  covered: Set<string>,
  assigned: Set<string>
): WritingWorkshopIdeaCandidate[] {
  const rest = snapshot.ideas.filter((idea) => !covered.has(idea.id));
  return [...rest.filter((idea) => assigned.has(idea.id)), ...rest.filter((idea) => !assigned.has(idea.id))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

/** Evidence-derived report architecture. It organizes the argument; it is not a
 * proxy for pages or words and never stops prose that still adds supported value. */
export interface SectionPlan {
  target: number;
  mode: 'auto' | 'user';
}

/**
 * The planner may use one extra broad movement only when an explicit coverage
 * contract exists AND the architecture is auto-sized. This is an architectural
 * safety bound, not a content cutoff: normalizePlan folds every discarded
 * assignment into a retained section.
 *
 * The `mode === 'auto'` condition is load-bearing. The control says "Máx. N
 * secciones", so a coverage question must never buy an N+1st section behind the
 * user's back; in auto mode nobody named a number, so the grace slot is free.
 */
export function sectionPlanMaximum(sectionPlan: SectionPlan, coverageQuestions: string[]): number {
  return sectionPlan.target + (sectionPlan.mode === 'auto' && coverageQuestions.length > 0 ? 1 : 0);
}

/**
 * Decide how many broad argumentative movements the retrieved evidence warrants.
 *
 * A numeric preference is a CEILING, matching the "Máx. N secciones" control: the
 * report publishes at most that many sections, and an over-sized provider plan is
 * compacted to fit — deterministically reassigning every dropped idea, work, gap,
 * contradiction and coverage question to a retained section, so capping the
 * architecture never discards evidence. The evidence heuristic still decides when
 * it asks for FEWER sections than the requested maximum; `MIN_SECTIONS` remains the
 * floor because an argument still needs a framing, a body and a synthesis.
 */
export function resolveSectionPlan(
  snapshot: Pick<WritingWorkshopSnapshot, 'ideas' | 'gaps' | 'contradictions' | 'works'>,
  sectionLimit: NonNullable<DeepResearchRequest['sectionLimit']>,
  objective = '',
  coverageQuestions: string[] = [],
): SectionPlan {
  const explicitMechanisms = (objective.match(/;/gu) ?? []).length + 1;
  const evidenceClusters = Math.max(
    MIN_SECTIONS,
    Math.ceil(snapshot.ideas.length / 10)
      + Math.ceil((snapshot.gaps.length + snapshot.contradictions.length) / 4)
      + Math.ceil(snapshot.works.length / 18),
    Math.ceil(Math.max(coverageQuestions.length, explicitMechanisms) / 2) + 2,
  );
  if (typeof sectionLimit === 'number' && Number.isFinite(sectionLimit) && sectionLimit > 0) {
    const ceiling = Math.max(MIN_SECTIONS, Math.round(sectionLimit));
    return { target: Math.min(ceiling, evidenceClusters), mode: 'user' };
  }
  return { target: evidenceClusters, mode: 'auto' };
}

export function buildPlanInput(
  request: DeepResearchRequest,
  language: PromptLanguage,
  snapshot: WritingWorkshopSnapshot,
  sectionPlan: SectionPlan,
): PlanInput {
  const passages = snapshot.passages.filter(passage => passage.summary.trim().length > 0).slice(0, POOL_LIMITS.passages);
  const excerpts = passageExcerpts(passages.map(passage => ({ id: passage.id, text: passage.summary })));
  return {
    objective: request.objective,
    coverageQuestions: (request.coverageQuestions ?? [])
      .filter((question) => question.trim().length > 0)
      .slice(0, MAX_COVERAGE_QUESTIONS),
    language,
    audience: request.audience,
    sectionCount: sectionPlan.target,
    sectionMode: sectionPlan.mode,
    sectionLength: planDeepResearchSectionLength(request.sectionLength),
    ideas: snapshot.ideas.slice(0, POOL_LIMITS.ideas).map((i) => ({
      id: i.id,
      label: i.label,
      type: i.type,
      statement: clip(i.statement, 220),
      works: i.works.map((w) => `${w.authors[0] ?? citationWords(language).author}${w.year ? ` (${w.year})` : ''}`).join('; '),
    })),
    themes: snapshot.themes.slice(0, POOL_LIMITS.themes).map((t) => ({ id: t.id, label: t.label, summary: clip(t.summary, 160) })),
    gaps: snapshot.gaps.slice(0, POOL_LIMITS.gaps).map((g) => ({ id: g.id, label: g.label, summary: clip(g.summary, 160) })),
    contradictions: snapshot.contradictions
      .slice(0, POOL_LIMITS.contradictions)
      .map((c) => ({ id: c.id, label: c.label, summary: clip(c.summary, 160) })),
    works: snapshot.works.slice(0, POOL_LIMITS.works).map((w) => ({ id: w.id, label: w.label, summary: clip(w.summary, 140) })),
    passages: passages.map((passage) => ({
        id: passage.id,
        workId: passage.nodus_id,
        source: `${passage.authors[0] ?? citationWords(language).author}${passage.year ? ` (${passage.year})` : ''}`,
        page: passage.pageLabel,
        extract: excerpts.get(passage.id)!,
      })),
  };
}

async function planWithFallback(
  deps: DeepResearchDeps,
  request: DeepResearchRequest,
  language: PromptLanguage,
  snapshot: WritingWorkshopSnapshot,
  sectionPlan: SectionPlan,
): Promise<DeepResearchPlan> {
  const input = buildPlanInput(request, language, snapshot, sectionPlan);
  let plan: DeepResearchPlan | null = null;
  try {
    // The grace slot is reserved for a genuine coverage expansion. A planner
    // cannot spend it merely by returning one more short heading.
    plan = normalizePlan(
      await deps.planReport(input),
      snapshot,
      sectionPlanMaximum(sectionPlan, input.coverageQuestions),
      input.coverageQuestions,
    );
    enforcePlanObjectiveExclusions(plan, snapshot, request.objective);
  } catch {
    plan = null;
  }
  if (!plan || plan.sections.length === 0) {
    const fallback = fallbackPlan(request, snapshot, sectionPlan.target, labels(language));
    assignMissingCoverageQuestions(fallback.sections, input.coverageQuestions);
    return fallback;
  }
  return plan;
}

/** Clone the plan at the trust boundary so an I/O dependency cannot rewrite the
 * argument while preparing document profiles. */
function clonePlan(plan: DeepResearchPlan): DeepResearchPlan {
  return {
    title: plan.title,
    abstract: plan.abstract,
    sections: plan.sections.map((section) => ({
      ...section,
      keyClaims: [...section.keyClaims],
      ideaIds: [...section.ideaIds],
      workIds: [...section.workIds],
      gapIds: [...section.gapIds],
      contradictionIds: [...section.contradictionIds],
      passageIds: [...section.passageIds],
      coverageQuestions: [...(section.coverageQuestions ?? [])],
      coverageClaims: [...(section.coverageClaims ?? [])],
      retrievalEvidencePacks: (section.retrievalEvidencePacks ?? []).map((pack) => ({
        question: pack.question,
        passageIds: [...pack.passageIds],
        candidates: (pack.candidates ?? []).map((candidate) => ({ ...candidate, lanes: [...candidate.lanes] })),
      })),
      dependsOn: [...(section.dependsOn ?? [])],
    })),
  };
}

/** Apply a post-plan coverage audit without surrendering the argument to it. */
export function reconcileCoverageAudit(
  base: DeepResearchPlan,
  audited: DeepResearchPlan,
  snapshot: WritingWorkshopSnapshot,
  coverageQuestions: string[],
): void {
  const normalized = normalizePlan(audited, snapshot, base.sections.length, coverageQuestions);
  const byId = new Map(normalized.sections.map((section) => [section.id, section]));
  for (const section of base.sections) {
    const revision = byId.get(section.id);
    if (!revision) continue;
    // Coverage is diagnostic, never a source of historical propositions. Earlier
    // versions let this pass replace titles/purposes/keyClaims and it hardened user
    // hypotheses into facts before documentary evidence was available. Preserve the
    // graph-first argument verbatim; only assignments and coverage ownership enter.
    section.ideaIds = [...new Set([...section.ideaIds, ...revision.ideaIds])].slice(0, MAX_SECTION_IDEAS);
    section.workIds = [...new Set([...section.workIds, ...revision.workIds])];
    section.gapIds = [...new Set([...section.gapIds, ...revision.gapIds])];
    section.contradictionIds = [...new Set([...section.contradictionIds, ...revision.contradictionIds])];
    section.passageIds = [];
    section.coverageQuestions = [...new Set([
      ...(section.coverageQuestions ?? []),
      ...(revision.coverageQuestions ?? []),
    ])].filter((question) => coverageQuestions.includes(question));
  }
}

export function normalizeSectionClaimAudit(
  audit: SectionClaimAudit,
  originals: string[],
  allowedTokens: Set<string>,
): SectionClaimAudit {
  const input = Array.isArray(audit?.items) ? audit.items : [];
  return {
    items: originals.map((original, index) => {
      const candidate = input[index];
      const proposedStatus = candidate?.status === 'supported' || candidate?.status === 'partial' || candidate?.status === 'unsupported'
        ? candidate.status
        : 'unsupported';
      const rawEvidenceTokens = Array.isArray(candidate?.evidenceTokens)
        ? candidate.evidenceTokens.filter((token) => typeof token === 'string' && allowedTokens.has(token)).slice(0, 6)
        : [];
      const evidencePack = Array.isArray(candidate?.evidencePack)
        ? candidate.evidencePack
          .filter((entry) => entry && typeof entry.token === 'string' && allowedTokens.has(entry.token))
          .map((entry) => ({
            token: entry.token,
            // A work token only names a book and cannot entail a factual clause.
            // Ideas, passages, gaps and contradictions carry actual audited notes.
            role: entry.role === 'direct' && !entry.token.includes('(nodus://work/')
              ? 'direct' as const
              : entry.role === 'direct' || entry.role === 'context'
                ? 'context' as const
                : 'irrelevant' as const,
            reason: String(entry.reason ?? '').trim(),
          }))
          .filter((entry, at, all) => all.findIndex((other) => other.token === entry.token) === at)
        : [];
      const direct = evidencePack.filter((entry) => entry.role === 'direct').slice(0, 3);
      const context = evidencePack.filter((entry) => entry.role === 'context').slice(0, 2);
      const irrelevant = evidencePack.filter((entry) => entry.role === 'irrelevant').slice(0, 12);
      const boundedEvidencePack = [...direct, ...context, ...irrelevant];
      const packedSupportTokens = [...direct, ...context].map((entry) => entry.token);
      const evidenceTokens = [...new Set(packedSupportTokens.length > 0 ? packedSupportTokens : rawEvidenceTokens)].slice(0, 5);
      const directTokens = new Set(direct.map((entry) => entry.token));
      const requirements = Array.isArray(candidate?.requirements)
        ? candidate.requirements.slice(0, 12).map((requirement) => {
          const requirementEvidence = Array.isArray(requirement?.evidenceTokens)
            ? requirement.evidenceTokens
              .filter((token) => typeof token === 'string' && allowedTokens.has(token))
              .slice(0, 3)
            : [];
          return {
            text: String(requirement?.text ?? '').trim(),
            proofRole: normalizeProofRole(requirement?.proofRole),
            // The model proposes the checklist, but cannot self-certify it. Only
            // overlap with evidence it separately classified as direct counts.
            supported: requirementEvidence.some((token) => directTokens.has(token)),
            evidenceTokens: requirementEvidence.filter((token) => directTokens.has(token)),
          };
        }).filter((requirement) => requirement.text.length > 0)
        : [];
      const supportedRequirements = requirements.filter((requirement) => requirement.supported).length;
      const status = requirements.length > 0
        ? supportedRequirements === requirements.length && direct.length > 0
          ? 'supported'
          : supportedRequirements > 0
            ? 'partial'
            : 'unsupported'
        : evidencePack.length > 0 && direct.length === 0
          ? 'unsupported'
          : proposedStatus;
      const proposed = String(candidate?.revised ?? '').trim();
      const revised = proposed || epistemicFallback(original, status);
      return {
        original,
        status,
        revised: status === 'unsupported' && !isExplicitlyUnresolved(revised)
          ? epistemicFallback(original, status)
          : status === 'partial' && !isExplicitlyQualified(revised)
            ? epistemicFallback(original, status)
            : revised,
        evidenceTokens,
        reason: String(candidate?.reason ?? '').trim(),
        evidencePack: boundedEvidencePack,
        requirements,
      };
    }),
  };
}

function normalizeProofRole(value: unknown): DeepResearchProofRole {
  const normalized = String(value ?? '').trim().toLocaleLowerCase();
  const roles = new Set([
    'fact', 'actor_time', 'mechanism', 'causality', 'comparison_side',
    'agreement', 'contradiction', 'effect', 'reception', 'limit', 'method',
  ]);
  return roles.has(normalized)
    ? normalized as DeepResearchProofRole
    : 'fact';
}

function epistemicFallback(claim: string, status: SectionClaimAuditItem['status']): string {
  if (status === 'supported') return claim;
  if (status === 'partial') {
    const original = claim.trim().replace(/[.!?]+$/u, '');
    const replacements: Array<[RegExp, string]> = [
      [/\bfuncion[oó]\b/iu, 'pudo funcionar'],
      [/\boper[oó]\b/iu, 'pudo operar'],
      [/\bcontribuy[oó]\b/iu, 'pudo contribuir'],
      [/\bfacilit[oó]\b/iu, 'pudo facilitar'],
      [/\bpermiti[oó]\b/iu, 'pudo permitir'],
      [/\btransform[oó]\b/iu, 'pudo transformar'],
      [/\bcontrol[oó]\b/iu, 'pudo condicionar'],
      [/\bdetermin[oó]\b/iu, 'pudo influir en'],
    ];
    let bounded = original;
    for (const [pattern, replacement] of replacements) {
      if (!pattern.test(bounded)) continue;
      bounded = bounded.replace(pattern, replacement);
      break;
    }
    if (bounded === original) {
      const decapitalized = original.length > 1
        ? `${original[0].toLocaleLowerCase()}${original.slice(1)}`
        : original.toLocaleLowerCase();
      bounded = `Cabe plantear como hipótesis que ${decapitalized}`;
    }
    return `${bounded}, aunque su alcance efectivo y su grado de generalización permanecen por determinar.`;
  }
  return `El corpus disponible no permite establecer como hecho esta proposición y debe tratarse como una pregunta abierta: ${claim}`;
}

function isExplicitlyUnresolved(value: string): boolean {
  return /\b(?:no permite|no demuestra|no establece|pregunta abierta|hip[oó]tesis|queda por determinar|evidencia insuficiente|cannot establish|open question|hypothesis|insufficient evidence)\b/iu.test(value);
}

function isExplicitlyQualified(value: string): boolean {
  return /\b(?:parcial|provisional|sugiere|apunta|parece|podr[ií]a|pudo|cabe|permite sostener|en parte|aunque|sin que|no implica|no demuestra|no permite|seg[uú]n|para .+ autor|se ha interpretado|hip[oó]tesis|partial|provisional|suggests|may|might|could|although|does not imply|according to)\b/iu.test(value);
}

/**
 * Document preparation follows the graph's decisions. Planned works come first,
 * then works behind the assigned ideas, then the remaining graph-ranked works.
 * This order is the inverse of document-led planning by construction.
 */
export function plannedCandidateWorkIds(
  plan: DeepResearchPlan,
  snapshot: WritingWorkshopSnapshot,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  const ideas = new Map(snapshot.ideas.map((idea) => [idea.id, idea]));
  for (const section of plan.sections) {
    section.workIds.forEach(add);
    for (const ideaId of section.ideaIds) {
      for (const work of ideas.get(ideaId)?.works ?? []) add(work.nodus_id);
    }
  }
  snapshot.works.forEach((work) => add(work.id));
  return result;
}

export function normalizePlan(
  plan: DeepResearchPlan,
  snapshot: WritingWorkshopSnapshot,
  maxSections: number = Number.MAX_SAFE_INTEGER,
  coverageQuestions: string[] = [],
): DeepResearchPlan {
  const ideaIds = new Set(snapshot.ideas.map((i) => i.id));
  const workIds = new Set(snapshot.works.map((w) => w.id));
  const gapIds = new Set(snapshot.gaps.map((g) => g.id));
  const contradictionIds = new Set(snapshot.contradictions.map((c) => c.id));
  const passageIds = new Set(snapshot.passages.map((p) => p.id));

  const validCoverageQuestions = new Set(coverageQuestions);
  const sections = (plan.sections ?? []).map((s, index) => ({
    id: cleanStr(s.id, `s${index + 1}`),
    title: normalizeSectionTitle(cleanStr(s.title, `Sección ${index + 1}`)),
    purpose: cleanStr(s.purpose, ''),
    keyClaims: strList(s.keyClaims).slice(0, 8),
    ideaIds: strList(s.ideaIds).filter((id) => ideaIds.has(id)),
    workIds: strList(s.workIds).filter((id) => workIds.has(id)),
    gapIds: strList(s.gapIds).filter((id) => gapIds.has(id)),
    contradictionIds: strList(s.contradictionIds).filter((id) => contradictionIds.has(id)),
    passageIds: strList(s.passageIds).filter((id) => passageIds.has(id)),
    coverageQuestions: strList(s.coverageQuestions).filter((question) => validCoverageQuestions.has(question)),
    coverageClaims: [],
    retrievalEvidencePacks: [],
    role: (s.role === 'intro' || s.role === 'synthesis' ? s.role : 'body') as DeepResearchPlanSection['role'],
    dependsOn: strList(s.dependsOn),
  }));

  assignMissingCoverageQuestions(sections, coverageQuestions);
  const compacted = compactPlanSections(orderSections(sections), maxSections, snapshot);
  // Compaction preserves explicit assignments, then this deterministic pass gives
  // every coverage question exactly one surviving primary home.
  assignMissingCoverageQuestions(compacted, coverageQuestions);
  return {
    title: cleanStr(plan.title, ''),
    abstract: cleanStr(plan.abstract, ''),
    sections: ensureIdeaAssignment(compacted, snapshot),
  };
}

/** Bound a hallucinated/fragmented plan without dropping its evidence mandate.
 * Introduction and closing synthesis survive; surplus movements are merged into
 * the most relevant retained body section and dependencies are remapped. */
function compactPlanSections(
  ordered: DeepResearchPlanSection[],
  maxSections: number,
  snapshot: WritingWorkshopSnapshot,
): DeepResearchPlanSection[] {
  const cap = Number.isFinite(maxSections)
    ? Math.max(1, Math.trunc(maxSections))
    : Number.MAX_SAFE_INTEGER;
  if (ordered.length <= cap) return ordered;

  const synthesis = [...ordered].reverse().find((section) => section.role === 'synthesis') ?? ordered.at(-1)!;
  const beforeSynthesis = ordered.filter((section) => section !== synthesis);
  const retained = cap === 1 ? [synthesis] : [...beforeSynthesis.slice(0, cap - 1), synthesis];
  const retainedIds = new Set(retained.map((section) => section.id));
  const dropped = ordered.filter((section) => !retainedIds.has(section.id));
  const replacement = new Map<string, string>();

  for (const section of dropped) {
    const candidates = retained.filter((candidate) => candidate.role === 'body');
    const targets = candidates.length > 0 ? candidates : retained.filter((candidate) => candidate !== synthesis);
    const pool = targets.length > 0 ? targets : retained;
    const text = [section.title, section.purpose, ...section.keyClaims].join(' ');
    let target = pool[0];
    let bestScore = -Infinity;
    for (const candidate of pool) {
      const score = relevanceScore(sectionProfile(candidate, snapshot), text)
        - candidate.keyClaims.length * 0.01
        - candidate.ideaIds.length * 0.001;
      if (score > bestScore) {
        target = candidate;
        bestScore = score;
      }
    }
    const at = retained.indexOf(target);
    retained[at] = mergePlanSections(target, section);
    replacement.set(section.id, target.id);
  }

  const finalIds = new Set(retained.map((section) => section.id));
  return orderSections(retained.map((section) => ({
    ...section,
    dependsOn: [...new Set((section.dependsOn ?? [])
      .map((id) => replacement.get(id) ?? id)
      .filter((id) => id !== section.id && finalIds.has(id)))],
  })));
}

/** Remove excluded axes at the plan boundary, before their ids can drive document
 * preparation or section retrieval. Prompt instructions alone proved insufficient. */
export function enforcePlanObjectiveExclusions(
  plan: DeepResearchPlan,
  snapshot: WritingWorkshopSnapshot,
  objective: string,
): void {
  if (objectiveExclusionStems(objective).length === 0) return;
  const ideaById = new Map(snapshot.ideas.map((item) => [item.id, item]));
  const gapById = new Map(snapshot.gaps.map((item) => [item.id, item]));
  const contradictionById = new Map(snapshot.contradictions.map((item) => [item.id, item]));
  plan.abstract = plan.abstract
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !matchesObjectiveExclusion(sentence, objective))
    .join(' ')
    .trim();
  for (const section of plan.sections) {
    section.keyClaims = section.keyClaims.filter((claim) => !matchesObjectiveExclusion(claim, objective));
    section.coverageClaims = (section.coverageClaims ?? []).filter((claim) => !matchesObjectiveExclusion(claim, objective));
    section.ideaIds = section.ideaIds.filter((id) => {
      const item = ideaById.get(id);
      return !item || !matchesObjectiveExclusion(`${item.label} ${item.statement} ${item.summary}`, objective);
    });
    section.gapIds = section.gapIds.filter((id) => {
      const item = gapById.get(id);
      return !item || !matchesObjectiveExclusion(`${item.label} ${item.summary}`, objective);
    });
    section.contradictionIds = section.contradictionIds.filter((id) => {
      const item = contradictionById.get(id);
      return !item || !matchesObjectiveExclusion(`${item.label} ${item.summary}`, objective);
    });
  }
}

/**
 * A planner may silently omit the hardest part of a compound brief. Keep its own
 * assignments when valid, then deterministically place every missing question in
 * the section whose stated purpose overlaps it most. Ties prefer body sections.
 */
export function assignMissingCoverageQuestions(sections: DeepResearchPlanSection[], questions: string[]): void {
  if (!sections.length || !questions.length) return;
  const valid = new Set(questions);
  const assigned = new Set<string>();
  // One primary home per requirement. Duplicates are diagnostic noise and made
  // multiple sections repeat the same answer even though coverage entered late.
  for (const section of sections) {
    section.coverageQuestions = (section.coverageQuestions ?? []).filter((question) => {
      if (!valid.has(question) || assigned.has(question)) return false;
      assigned.add(question);
      return true;
    });
  }
  for (const question of questions) {
    if (assigned.has(question)) continue;
    let best = sections[0];
    let bestScore = -Infinity;
    for (const section of sections) {
      const text = `${section.title} ${section.purpose} ${section.keyClaims.join(' ')}`;
      const score = relevanceScore(tokenSet(question), text)
        + (section.role === 'body' ? 0.08 : 0)
        - (section.coverageQuestions?.length ?? 0) * 0.015;
      if (score > bestScore) {
        best = section;
        bestScore = score;
      }
    }
    best.coverageQuestions = [...(best.coverageQuestions ?? []), question];
    assigned.add(question);
  }
}

/**
 * Put the sections in reading order: the framing first, the closing synthesis last,
 * and each body section after whatever it presupposes.
 *
 * Without this the report's sequence was whatever order the planner happened to emit
 * — two runs of the same objective produced a genealogy and a flat thematic list. A
 * stable topological sort makes the good ordering reproducible. Cycles and dangling
 * references are ignored rather than fatal: a half-stated dependency should degrade
 * to the planner's own order, never drop a section.
 */
export function orderSections(sections: DeepResearchPlanSection[]): DeepResearchPlanSection[] {
  if (sections.length <= 1) return sections;
  const rank = (s: DeepResearchPlanSection) => (s.role === 'intro' ? 0 : s.role === 'synthesis' ? 2 : 1);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const position = new Map(sections.map((s, i) => [s.id, i]));
  const emitted = new Set<string>();
  const out: DeepResearchPlanSection[] = [];

  // Stable order: architectural role first, then the planner's own sequence.
  const queue = [...sections].sort((a, b) => rank(a) - rank(b) || position.get(a.id)! - position.get(b.id)!);

  const visit = (section: DeepResearchPlanSection, guard: Set<string>): void => {
    if (emitted.has(section.id) || guard.has(section.id)) return;
    guard.add(section.id);
    for (const dependency of section.dependsOn ?? []) {
      const target = byId.get(dependency);
      // A body section never waits on the closing synthesis, or nothing could open.
      if (target && target.id !== section.id && rank(target) <= rank(section)) visit(target, guard);
    }
    guard.delete(section.id);
    if (!emitted.has(section.id)) {
      emitted.add(section.id);
      out.push(section);
    }
  };

  for (const section of queue) visit(section, new Set());
  return out;
}

/**
 * Give every section a mandate without wrecking its coherence.
 *
 * The planner only ever sees the top slice of the idea pool (POOL_LIMITS.ideas),
 * so the rest arrives here unassigned. Round-robining those by index dropped
 * thematically unrelated ideas into each section and then asked the writer for a
 * continuous argument. Instead each leftover goes to the section it actually fits,
 * and a section only takes as much as it can develop — the surplus is left for the
 * coverage top-up and, failing that, reported as a limitation.
 */
function ensureIdeaAssignment(sections: DeepResearchPlanSection[], snapshot: WritingWorkshopSnapshot): DeepResearchPlanSection[] {
  if (sections.length === 0) return sections;
  const assigned = new Set<string>();
  for (const s of sections) for (const id of s.ideaIds) assigned.add(id);

  // Body sections only: a lone closing section synthesises, it does not absorb.
  const bodyCount = Math.max(1, sections.length - 1);
  const body = sections.slice(0, bodyCount);
  const profiles = body.map((s) => sectionProfile(s, snapshot));

  const byId = new Map(snapshot.ideas.map((i) => [i.id, i]));
  // How many ideas each section already draws from each work, so a section is not
  // handed a pile of material that all traces back to the same book.
  const workLoad = body.map((section) => {
    const load = new Map<string, number>();
    for (const id of section.ideaIds) {
      for (const w of byId.get(id)?.works ?? []) load.set(w.nodus_id, (load.get(w.nodus_id) ?? 0) + 1);
    }
    return load;
  });

  for (const idea of snapshot.ideas) {
    if (assigned.has(idea.id)) continue;
    const text = ideaText(idea);
    let bestAt = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < body.length; i++) {
      if (body[i].ideaIds.length >= MAX_SECTION_IDEAS) continue;
      // Affinity first, minus a penalty for piling more of the same work onto a
      // section; the emptier section breaks remaining ties so nothing starves.
      const repeats = Math.max(0, ...(idea.works ?? []).map((w) => workLoad[i].get(w.nodus_id) ?? 0));
      const score = relevanceScore(profiles[i], text) - repeats * 0.03 - body[i].ideaIds.length * 1e-4;
      if (score > bestScore) {
        bestScore = score;
        bestAt = i;
      }
    }
    // Every body section is full: the remaining ideas stay pending on purpose.
    if (bestAt < 0) break;
    body[bestAt].ideaIds.push(idea.id);
    for (const w of idea.works ?? []) workLoad[bestAt].set(w.nodus_id, (workLoad[bestAt].get(w.nodus_id) ?? 0) + 1);
    assigned.add(idea.id);
  }

  // Any section that is still empty borrows the top ideas so it has a mandate.
  for (const s of sections) {
    if (s.ideaIds.length === 0 && snapshot.ideas.length > 0) {
      s.ideaIds = snapshot.ideas.slice(0, 3).map((i) => i.id);
    }
  }
  return sections;
}

/** The words that characterise what a section is about, planner text plus its seed ideas. */
function sectionProfile(section: DeepResearchPlanSection, snapshot: WritingWorkshopSnapshot): Set<string> {
  const byId = new Map(snapshot.ideas.map((i) => [i.id, i]));
  const parts = [section.title, section.purpose, ...section.keyClaims];
  for (const id of section.ideaIds) {
    const idea = byId.get(id);
    if (idea) parts.push(ideaText(idea));
  }
  return tokenSet(parts.join(' '));
}

function ideaText(idea: WritingWorkshopIdeaCandidate): string {
  return [idea.label, idea.statement, (idea.themes ?? []).join(' ')].join(' ');
}

/** Share of the candidate's meaningful words that the section already talks about. */
function relevanceScore(profile: Set<string>, text: string): number {
  const tokens = tokenSet(text);
  if (tokens.size === 0 || profile.size === 0) return 0;
  let hits = 0;
  for (const token of tokens) if (profile.has(token)) hits += 1;
  return hits / tokens.size;
}

/** Accent-insensitive content words. Deliberately dependency-free so the core stays pure. */
function tokenSet(text: string): Set<string> {
  const normalized = (text ?? '')
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "");
  const out = new Set<string>();
  for (const word of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length > 3 && !STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

/** Frequent function words in the languages Deep Research writes in. */
const STOPWORDS = new Set(
  ('para como este esta estos estas desde entre sobre cuando donde porque pero mas menos muy todo toda todos todas '
    + 'otro otra otros otras cada tanto tanta cual cuales quien quienes ante bajo cabe contra hacia hasta segun sino '
    + 'that this these those with from into about which their there where when while have has been were was will '
    + 'their them they than then such also would could should some more most other than dans pour avec sont leur '
    + 'sich eine einer eines nicht auch aber oder para como mais quando onde porque').split(/\s+/)
);

export function fallbackPlan(
  request: DeepResearchRequest,
  snapshot: WritingWorkshopSnapshot,
  sectionCount: number,
  L: Labels = labels(request.language ?? 'es')
): DeepResearchPlan {
  const ideas = snapshot.ideas;
  if (!ideas.length && snapshot.passages.length) return { title: request.objective, abstract: '', sections: [{
    id: 's1', title: request.objective, purpose: L.threadPurpose, keyClaims: [], ideaIds: [],
    workIds: [...new Set(snapshot.passages.map(passage => passage.nodus_id))], gapIds: [], contradictionIds: [],
    passageIds: snapshot.passages.map(passage => passage.id),
  }] };
  const bodyCount = Math.max(1, sectionCount - 2);
  const perSection = Math.max(1, Math.ceil(ideas.length / bodyCount));
  const sections: DeepResearchPlanSection[] = [];
  sections.push({
    id: 's1',
    title: L.introTitle,
    purpose: L.introPurpose,
    keyClaims: ideas.slice(0, 3).map((i) => i.label),
    ideaIds: ideas.slice(0, Math.min(3, ideas.length)).map((i) => i.id),
    workIds: [],
    gapIds: [],
    contradictionIds: [],
    passageIds: [],
  });
  for (let b = 0; b < bodyCount; b++) {
    const chunk = ideas.slice(b * perSection, (b + 1) * perSection);
    if (chunk.length === 0) continue;
    sections.push({
      id: `s${sections.length + 1}`,
      title: `${L.threadTitle} ${b + 1}`,
      purpose: L.threadPurpose,
      keyClaims: chunk.slice(0, 4).map((i) => i.label),
      ideaIds: chunk.map((i) => i.id),
      workIds: [],
      gapIds: snapshot.gaps.slice(b * 2, b * 2 + 2).map((g) => g.id),
      contradictionIds: snapshot.contradictions.slice(b, b + 1).map((c) => c.id),
      passageIds: [],
    });
  }
  sections.push({
    id: `s${sections.length + 1}`,
    title: L.synthesisTitle,
    purpose: L.synthesisPurpose,
    keyClaims: snapshot.gaps.slice(0, 3).map((g) => g.label),
    ideaIds: [],
    workIds: [],
    gapIds: snapshot.gaps.slice(0, 4).map((g) => g.id),
    contradictionIds: snapshot.contradictions.slice(0, 3).map((c) => c.id),
    passageIds: [],
  });
  return {
    title: `${L.reportTitlePrefix} ${request.objective}`.slice(0, 140),
    abstract: '',
    sections: ensureIdeaAssignment(sections, snapshot),
  };
}

async function finalizeWithFallback(deps: DeepResearchDeps, input: FinalizeInput, L: Labels): Promise<FinalizeResult> {
  const uncoveredNote = () =>
    input.uncoveredSamples.length > 0 ? [L.uncoveredLimitation(input.uncoveredSamples)] : [];
  try {
    const result = await deps.finalize(input);
    const limitations = strList(result.limitations);
    // The model is told how much was left out, but it is not the guarantor of that
    // disclosure. If it omits it, the report states it anyway.
    const mentionsCoverage = limitations.some((line) =>
      input.uncoveredSamples.some((sample) => line.toLowerCase().includes(sample.toLowerCase().slice(0, 24)))
    );
    return {
      title: cleanStr(result.title, input.planTitle || input.objective),
      abstract: cleanStr(result.abstract, ''),
      limitations: mentionsCoverage ? limitations : [...limitations, ...uncoveredNote()],
      nextSteps: strList(result.nextSteps),
    };
  } catch {
    return {
      title: input.planTitle || input.objective,
      abstract: '',
      limitations: uncoveredNote(),
      nextSteps: [L.reviewStep],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage / degraded fallbacks
// ─────────────────────────────────────────────────────────────────────────────

function mergePlanSections(a: DeepResearchPlanSection, b: DeepResearchPlanSection): DeepResearchPlanSection {
  const unique = (values: string[]) => [...new Set(values)];
  return {
    ...a,
    purpose: [a.purpose, b.purpose].filter(Boolean).join(' '),
    keyClaims: unique([...a.keyClaims, ...b.keyClaims]).slice(0, 8),
    ideaIds: unique([...a.ideaIds, ...b.ideaIds]).slice(0, MAX_SECTION_IDEAS),
    workIds: unique([...a.workIds, ...b.workIds]),
    gapIds: unique([...a.gapIds, ...b.gapIds]),
    contradictionIds: unique([...a.contradictionIds, ...b.contradictionIds]),
    passageIds: unique([...a.passageIds, ...b.passageIds]),
    coverageQuestions: unique([...(a.coverageQuestions ?? []), ...(b.coverageQuestions ?? [])]),
    coverageClaims: unique([...(a.coverageClaims ?? []), ...(b.coverageClaims ?? [])]),
    retrievalEvidencePacks: [...(a.retrievalEvidencePacks ?? []), ...(b.retrievalEvidencePacks ?? [])],
    dependsOn: unique([...(a.dependsOn ?? []), ...(b.dependsOn ?? [])]),
  };
}

/** Enforce one visible epigraph per generated section. Models occasionally add
 * several `###` headings despite the prompt, producing artificial fragmentation.
 * Their labels become ordinary prose leads while citations and paragraphs remain. */
export function normalizeNarrativeSection(markdown: string, title: string): string {
  const trimmed = (markdown ?? '').trim();
  const withoutFirstHeading = trimmed.replace(/^#{1,6}\s+[^\n]+\n*/u, '');
  const body = withoutFirstHeading
    .replace(/\n{1,2}#{1,6}\s+([^\n]+)\n*/gu, (_match, label: string) => `\n\n${sentenceLead(label)} `)
    .replace(/^\s*#{1,6}\s+([^\n]+)\n*/gmu, (_match, label: string) => `${sentenceLead(label)} `)
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `## ${title}\n\n${body}`.trim();
}

function researchProseSentenceKeys(markdown: string): Set<string> {
  return new Set(researchProseSpans(markdown).map(span => researchSentenceKey(span.text)));
}
function stripInitialHeading(markdown: string): string {
  return markdown.replace(/^#{1,6}\s+[^\n]+\n*/u, '').trim();
}

function sentenceLead(label: string): string {
  const clean = label.trim().replace(/[.:;—-]+$/u, '');
  return clean ? `${clean}.` : '';
}

/** Deterministic, source-anchored prose used when the model fails twice on a section. */
function degradedSection(section: DeepResearchPlanSection, maps: SnapshotMaps, L: Labels): string {
  const lines = [`## ${section.title}`, ''];
  if (section.purpose) lines.push(section.purpose, '');
  const bullets = section.ideaIds
    .map((id) => maps.ideaById.get(id))
    .filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea)
    .slice(0, 8)
    .map((idea) => {
      const token = ideaCitation(idea, maps.language);
      return `- ${clip(idea.statement || idea.label, 260)} ${token}`;
    });
  if (bullets.length > 0) lines.push(...bullets);
  else lines.push(`_${L.degradedEmpty}_`);
  return lines.join('\n');
}

/**
 * Gemini occasionally copies an allowed citation as `[Author, year]` but drops the
 * Markdown target. It looks scholarly while being unverifiable. Recover only labels
 * that identify an entry already present in this section's menu; the normal citation
 * policy and entailment verifier still run afterwards, so this cannot widen the
 * evidence boundary or make an unsupported attribution survive.
 */
export function recoverPlainMenuCitations(markdown: string, menu: CitationMenuItem[]): string {
  const allowed = menu.flatMap((item) => {
    const match = item.token.match(/^\[([^\]\n]+)\]\((nodus:\/\/[^)\s]+)\)$/u);
    return match ? [{ label: item.source || match[1], anchor: match[1], url: match[2] }] : [];
  });
  if (!allowed.length) return markdown;
  return markdown.replace(/\[([^\]\n]{3,220})\](?!\()/gu, (whole, contents: string) => {
    const parts = contents.split(/\s*;\s*/u);
    let recovered = 0;
    const rendered = parts.map((part) => {
      const item = bestPlainCitationMatch(part, allowed);
      if (!item) return `[${part}]`;
      recovered += 1;
      return `[${part}](${item.url})`;
    });
    return recovered > 0 ? rendered.join('; ') : whole;
  });
}

function bestPlainCitationMatch(
  visible: string,
  allowed: { label: string; anchor: string; url: string }[],
): { label: string; anchor: string; url: string } | null {
  const normalizedVisible = normalizeCitationIdentity(visible);
  const exact = allowed.find((item) => {
    const label = normalizeCitationIdentity(item.label);
    const anchor = normalizeCitationIdentity(item.anchor);
    return normalizedVisible === label || normalizedVisible === anchor
      || normalizedVisible.startsWith(`${label} `) || normalizedVisible.startsWith(`${anchor} `);
  });
  if (exact) return exact;
  const visibleYear = normalizedVisible.match(/\b(?:1[5-9]|20)\d{2}\b/u)?.[0];
  if (!visibleYear) return null;
  return allowed.find((item) => {
    const identity = normalizeCitationIdentity(item.label || item.anchor);
    if (!identity.includes(visibleYear)) return false;
    const authorTerms = identity
      .split(/\s+/u)
      .filter((term) => term.length > 2 && !/^\d{4}$/u.test(term) && term !== 'ed')
      .slice(0, 2);
    return authorTerms.length > 0 && authorTerms.every((term) => normalizedVisible.includes(term));
  }) ?? null;
}

function normalizeCitationIdentity(value: string): string {
  return value.toLocaleLowerCase('es-ES').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot maps + citation policy (pure)
// ─────────────────────────────────────────────────────────────────────────────

export function buildSnapshotMaps(snapshot: WritingWorkshopSnapshot): SnapshotMaps {
  const language = snapshot.brief?.language ?? 'es';
  const ideaById = new Map<string, WritingWorkshopIdeaCandidate>();
  const workInfoById = new Map<string, WorkInfo>();
  const passageWorkId = new Map<string, string>();
  const passagePage = new Map<string, string | null>();
  const passageText = new Map<string, string>();
  const gapById = new Map<string, { label: string; summary: string; source: string }>();
  const contradictionById = new Map<string, { label: string; summary: string; sources: string[] }>();

  for (const idea of snapshot.ideas) {
    ideaById.set(idea.id, idea);
    for (const w of idea.works) {
      if (!workInfoById.has(w.nodus_id)) {
        workInfoById.set(w.nodus_id, { nodus_id: w.nodus_id, title: w.title, authors: w.authors, year: w.year, zotero_key: w.zotero_key, doi: w.doi ?? null });
      }
    }
  }
  for (const w of snapshot.works) {
    if (!workInfoById.has(w.id)) {
      workInfoById.set(w.id, { nodus_id: w.id, title: w.title, authors: w.authors, year: w.year, zotero_key: w.zotero_key, doi: w.doi ?? null });
    }
    if (w.reason === 'authorized-source') workInfoById.get(w.id)!.metadataOnly = true;
  }
  for (const g of snapshot.gaps) {
    if (g.work?.nodus_id && !workInfoById.has(g.work.nodus_id)) {
      workInfoById.set(g.work.nodus_id, {
        nodus_id: g.work.nodus_id,
        title: g.work.title,
        authors: g.work.authors,
        year: g.work.year,
        zotero_key: g.work.zotero_key,
      });
    }
  }
  for (const g of snapshot.gaps)
    gapById.set(g.id, { label: g.label, summary: g.summary ?? '', source: sourceLabelFromWork(g.work, language) });
  for (const c of snapshot.contradictions)
    contradictionById.set(c.id, { label: c.label, summary: c.summary ?? '', sources: c.sources ?? [] });
  for (const p of snapshot.passages) {
    passageWorkId.set(p.id, p.nodus_id);
    passagePage.set(p.id, p.pageLabel);
    // `summary` is the clipped literal text of the passage as stored by the retriever.
    if (p.summary?.trim()) passageText.set(p.id, p.summary.trim());
    if (!workInfoById.has(p.nodus_id)) {
      workInfoById.set(p.nodus_id, {
        nodus_id: p.nodus_id,
        title: p.label.split(' · ')[0] ?? p.label,
        authors: p.authors,
        year: p.year,
        zotero_key: p.zotero_key,
      });
    }
  }

  const validIds = new Set<string>();
  for (const id of ideaById.keys()) validIds.add(`idea:${id}`);
  for (const id of workInfoById.keys()) validIds.add(`work:${id}`);
  for (const id of gapById.keys()) validIds.add(`gap:${id}`);
  for (const id of contradictionById.keys()) validIds.add(`contradiction:${id}`);
  for (const id of passageWorkId.keys()) validIds.add(`passage:${id}`);

  return { ideaById, workInfoById, passageWorkId, passagePage, passageText, gapById, contradictionById, validIds, language };
}

/**
 * Fold material retrieved *during* writing into the maps so it becomes citable.
 * Without this a per-section retrieval would hand the writer tokens that the
 * citation policy then strips as hallucinated.
 */
export function mergeRetrievedMaterial(
  maps: SnapshotMaps,
  material: { ideas?: WritingWorkshopIdeaCandidate[]; passages?: WritingWorkshopSnapshot['passages'] }
): { ideaIds: string[]; passageIds: string[] } {
  const ideaIds: string[] = [];
  const passageIds: string[] = [];
  for (const idea of material.ideas ?? []) {
    if (!idea?.id) continue;
    if (!maps.ideaById.has(idea.id)) {
      maps.ideaById.set(idea.id, idea);
      maps.validIds.add(`idea:${idea.id}`);
    }
    for (const w of idea.works ?? []) {
      if (!maps.workInfoById.has(w.nodus_id)) {
        maps.workInfoById.set(w.nodus_id, {
          nodus_id: w.nodus_id,
          title: w.title,
          authors: w.authors,
          year: w.year,
          zotero_key: w.zotero_key,
          doi: w.doi ?? null,
        });
        maps.validIds.add(`work:${w.nodus_id}`);
      }
    }
    ideaIds.push(idea.id);
  }
  for (const p of material.passages ?? []) {
    if (!p?.id || !p.summary?.trim()) continue;
    if (!maps.passageWorkId.has(p.id)) {
      maps.passageWorkId.set(p.id, p.nodus_id);
      maps.passagePage.set(p.id, p.pageLabel);
      maps.passageText.set(p.id, p.summary.trim());
      maps.validIds.add(`passage:${p.id}`);
      if (!maps.workInfoById.has(p.nodus_id)) {
        maps.workInfoById.set(p.nodus_id, {
          nodus_id: p.nodus_id,
          title: p.label.split(' · ')[0] ?? p.label,
          authors: p.authors,
          year: p.year,
          zotero_key: p.zotero_key,
        });
        maps.validIds.add(`work:${p.nodus_id}`);
      }
    }
    passageIds.push(p.id);
  }
  return { ideaIds, passageIds };
}

function mergeSectionEvidencePacks(
  section: DeepResearchPlanSection,
  incoming: NonNullable<SectionRetrievalResult['evidencePacks']>,
): void {
  const packs = section.retrievalEvidencePacks ?? [];
  for (const pack of incoming) {
    const question = String(pack?.question ?? '').trim();
    if (!question) continue;
    const passageIds = (pack.passageIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
    const existing = packs.find((candidate) => candidate.question === question);
    const candidates = (pack.candidates ?? []).filter((candidate) => passageIds.includes(candidate.passageId));
    if (existing) {
      existing.passageIds = [...new Set([...existing.passageIds, ...passageIds])];
      existing.candidates = [...(existing.candidates ?? []), ...candidates]
        .filter((candidate, index, all) => all.findIndex((item) => item.passageId === candidate.passageId) === index);
    } else {
      packs.push({ question, passageIds: [...new Set(passageIds)], candidates: [...candidates] });
    }
  }
  section.retrievalEvidencePacks = packs;
}

const CITATION_RE = /\[([^\]]*)\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)]+)\)/g;
const NODUS_KIND = '(?:idea|work|passage|gap|contradiction)';
/** `[label (nodus://…)]` — brackets and parentheses swapped round. */
const WRAPPED_RE = new RegExp(`\\[([^\\]]*?)\\s*\\((nodus://${NODUS_KIND}/[^)\\s]+)\\)\\s*\\]`, 'g');
/** `[label](nodus://…]` — right link, wrong closing bracket. */
const WRONG_CLOSER_RE = new RegExp(`\\]\\((nodus://${NODUS_KIND}/[^)\\]\\s]+)\\]`, 'g');
/** `[nodus://…, nodus://…]` — a bare bracketed list instead of links. */
const BARE_GROUP_RE = new RegExp(`\\[\\s*(nodus://${NODUS_KIND}/[^\\s,\\]]+(?:\\s*,\\s*nodus://${NODUS_KIND}/[^\\s,\\]]+)*)\\s*\\]`, 'g');
/** `Autor (2005)](nodus://…)` — the closing half of a link whose `[` never arrived. */
/** The closing half of a link, used by {@link repairMissingOpeners}. */
const CLOSING_HALF_RE = new RegExp(`\\]\\(nodus://${NODUS_KIND}/[^)\\s]+\\)`, 'g');
/** How far back a synthesised citation label may reach. */
const MAX_SYNTHESISED_LABEL = 90;

/**
 * Repair `Autor (2005)](nodus://…)` — a link whose opening bracket never arrived,
 * which happens when a model chains two citations inside one parenthesis.
 *
 * This cannot be a regex: commas and semicolons occur *inside* the labels of
 * perfectly good links, so any prefix pattern loose enough to catch the broken case
 * also mangles the correct one. Instead each closing half is checked for whether an
 * unmatched `[` really precedes it on the same line.
 */
function repairMissingOpeners(markdown: string): string {
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(CLOSING_HALF_RE)) {
    const closeAt = match.index ?? 0;
    const lineStart = markdown.lastIndexOf('\n', closeAt) + 1;
    const segment = markdown.slice(lineStart, closeAt);
    // An opener exists when the last `[` on the line comes after the last `]`.
    if (segment.lastIndexOf('[') > segment.lastIndexOf(']')) continue;
    // Where the label begins. A `(` only counts when it is still OPEN at this point
    // — the parenthesis of a year like "Romero, L. (2005)" closes before the link
    // and belongs inside the label, not before it. A comma is never a boundary for
    // the same reason: "Romero, L." carries one.
    const floor = Math.max(lineStart, closeAt - MAX_SYNTHESISED_LABEL);
    let start = -1;
    let depth = 0;
    for (let at = closeAt - 1; at >= floor; at--) {
      const char = markdown[at];
      if (char === ')') depth += 1;
      else if (char === '(') {
        if (depth === 0) {
          start = at + 1;
          break;
        }
        depth -= 1;
      } else if (char === ';') {
        start = at + 1;
        break;
      }
    }
    // No delimiter means no way to tell where the label starts. Guessing would pull
    // real prose into a label that the citation policy then overwrites, deleting the
    // author's sentence. Leave it: the final sweep drops the bare url and the words
    // the model wrote stay on the page.
    if (start < 0) continue;
    while (start < closeAt && /\s/.test(markdown[start])) start += 1;
    if (start >= closeAt) continue;
    out += markdown.slice(cursor, start) + '[';
    cursor = start;
  }
  return out + markdown.slice(cursor);
}

/**
 * Delete a closing half whose opener could not be reconstructed. The words the model
 * wrote stay on the page; only the dangling `](nodus://…)` goes, so the reader never
 * sees a raw identifier and the accounting never counts a citation nobody can click.
 */
function dropOrphanCitations(markdown: string): string {
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(CLOSING_HALF_RE)) {
    const closeAt = match.index ?? 0;
    const lineStart = markdown.lastIndexOf('\n', closeAt) + 1;
    const segment = markdown.slice(lineStart, closeAt);
    if (segment.lastIndexOf('[') > segment.lastIndexOf(']')) continue;
    out += markdown.slice(cursor, closeAt);
    cursor = closeAt + match[0].length;
  }
  return out + markdown.slice(cursor);
}
/**
 * A reference with no link syntax around it. The only thing that makes a reference
 * well-formed is the `](` immediately before it — a bare `(` does not, which is how
 * `[label (nodus://…)]` slipped through unrepaired and put raw ids on the page.
 */
const BARE_REF_RE = new RegExp(`(?<!\\]\\()(nodus://${NODUS_KIND}/[^\\s\\]),;]+)`, 'g');
/** Belt and braces: any reference still not sitting inside a proper link at the end. */
const SURVIVING_RAW_RE = new RegExp(`(?<!\\]\\()nodus://\\S*`, 'g');
/** Any markdown link whose target is a nodus reference, valid or not. */
const ANY_NODUS_LINK_RE = /\[([^\]\n]*)\]\((nodus:\/\/[^)\s]*)\)/g;
/** The only shape the app can actually resolve. */
const VALID_TARGET_RE = new RegExp(`^nodus://${NODUS_KIND}/.+$`);

/**
 * Models occasionally emit a nodus reference that is not a well-formed Markdown link.
 * Left alone those leak raw ids into the prose AND slip past the citation accounting,
 * because the policy below only recognises proper links. Normalising them first means
 * every reference is either canonicalised or dropped — none survives half-written.
 * The empty label is deliberate: the policy fills in the canonical one, or, for an
 * id that does not exist, collapses the whole thing to nothing.
 */
export function repairLooseCitations(markdown: string): string {
  return repairMissingOpeners((markdown ?? '').replace(WRAPPED_RE, '[$1]($2)').replace(WRONG_CLOSER_RE, ']($1)'))
    .replace(BARE_GROUP_RE, (_full, group: string) =>
      group
        .split(',')
        .map((ref) => `[](${ref.trim()})`)
        .join(', ')
    )
    .replace(BARE_REF_RE, (_full, ref: string) => `[](${ref})`);
}

/**
 * Enforce the citation contract on one section's markdown:
 * - valid nodus targets get their label rewritten to the canonical corpus label;
 * - unknown (hallucinated) targets are stripped to plain text so they can never
 *   become a fake reference.
 * Returns the cleaned markdown and the set of ids actually cited.
 */
export function applyCitationPolicy(
  markdown: string,
  maps: SnapshotMaps
): {
  markdown: string;
  cited: { ideas: Set<string>; works: Set<string>; gaps: Set<string>; contradictions: Set<string>; passages: Set<string> };
} {
  const cited = {
    ideas: new Set<string>(),
    works: new Set<string>(),
    gaps: new Set<string>(),
    contradictions: new Set<string>(),
    passages: new Set<string>(),
  };
  const language = maps.language ?? 'es';
  const words = citationWords(language);
  const out = repairLooseCitations(markdown).replace(CITATION_RE, (_full, label: string, type: string, rawId: string) => {
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      /* keep raw */
    }
    if (!maps.validIds.has(`${type}:${id}`)) {
      // Hallucinated target: drop the link, keep only neutral bracket-free text.
      return label || '';
    }
    switch (type) {
      case 'idea': {
        cited.ideas.add(id);
        const idea = maps.ideaById.get(id);
        const canonical = idea ? sourceLabelFromWork(idea.works[0], language) : label;
        return `[${canonical || label}](nodus://idea/${encodeURIComponent(id)})`;
      }
      case 'work': {
        cited.works.add(id);
        const canonical = sourceLabelFromWork(maps.workInfoById.get(id), language) || label;
        return `[${canonical}](nodus://work/${encodeURIComponent(id)})`;
      }
      case 'passage': {
        cited.passages.add(id);
        const workId = maps.passageWorkId.get(id);
        const base = sourceLabelFromWork(workId ? maps.workInfoById.get(workId) : undefined, language) || label;
        const page = maps.passagePage.get(id);
        const withPage = page ? `${base}, ${page}` : base;
        return `[${withPage}](nodus://passage/${encodeURIComponent(id)})`;
      }
      // Gap and contradiction labels are whole sentences in a real corpus, so they
      // make a terrible anchor: the reader gets a paragraph-long parenthesis. The
      // content belongs in the writer's menu (where it now is) and behind the link,
      // not in the visible citation.
      case 'gap':
        cited.gaps.add(id);
        return `[${maps.gapById.get(id)?.source || words.gap}](nodus://gap/${encodeURIComponent(id)})`;
      case 'contradiction':
        cited.contradictions.add(id);
        return `[${maps.contradictionById.get(id)?.sources[0] || words.contradiction}](nodus://contradiction/${encodeURIComponent(id)})`;
      default:
        return label || '';
    }
  });
  // Whatever shape a model invents next, a raw `nodus://` must never reach the page.
  // Repairs above try to keep the citation; anything still loose here is dropped.
  const swept = dropOrphanCitations(out)
    // A link whose target Nodus cannot resolve is a link to nowhere. Models invent
    // these — `nodus://contradicción/…` with the Spanish word as the type, or a bare
    // `nodus://<uuid>` with no type at all — and because they never matched the
    // citation pattern they slipped past validation and printed as dead links.
    // The visible author-year survives as plain text; only the link dies.
    .replace(ANY_NODUS_LINK_RE, (full, label: string, target: string) =>
      VALID_TARGET_RE.test(target) ? full : label || ''
    )
    .replace(SURVIVING_RAW_RE, '')
    .replace(/\(\s*[;,]?\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;)])/g, '$1');
  return { markdown: swept, cited };
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation verification (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Sentence boundaries, kept simple: citations sit inside ordinary prose. */
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[¿¡"«(A-ZÁÉÍÓÚÑ])/u;

/**
 * Pair every citation in a section with the sentence it supports and with what the
 * cited source actually says. Bare `work` citations are skipped: a work token only
 * asserts that the work is relevant, which is not an entailment claim.
 */
export function extractCitationClaims(markdown: string, maps: SnapshotMaps): CitationClaim[] {
  const claims: CitationClaim[] = [];
  const body = stripInitialHeading(markdown);
  const bodyStart = Math.max(0, markdown.indexOf(body));
  // Mask every citation to a same-length run of a neutral character before looking
  // for sentence boundaries. An author initial inside a label ("Autor, N. (2000)")
  // otherwise reads as the end of a sentence and cuts the citation in half, which
  // silently left the whole report unverified.
  const masked = body.replace(CITATION_RE, (link) => '\u0001'.repeat(link.length));
  for (const span of sentenceSpans(masked)) {
    const text = body.slice(span.start, span.end);
    const plain = stripMarkdown(text);
    for (const match of text.matchAll(CITATION_RE)) {
      const type = match[2] as CitationClaim['kind'] | 'work';
      if (type === 'work') continue;
      let id = match[3];
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep raw */
      }
      const content = citedContent(type, id, maps);
      // Nothing to check against means nothing to verify; leave it alone rather
      // than let a contentless judgement delete a citation.
      if (!content) continue;
      claims.push({
        offset: bodyStart + span.start + (match.index ?? 0),
        sentenceOffset: bodyStart + span.start,
        sentenceEnd: bodyStart + span.end,
        link: match[0],
        kind: type,
        id,
        sentence: plain,
        content,
      });
    }
  }
  return claims;
}

/** Sentence and paragraph spans over text whose citations have been masked. */
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const separator = new RegExp(`${SENTENCE_SPLIT.source}|\\n{2,}`, 'gu');
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const at = match.index ?? 0;
    if (at > start) spans.push({ start, end: at });
    start = at + match[0].length;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

function citedContent(type: string, id: string, maps: SnapshotMaps): string {
  switch (type) {
    case 'idea':
      return maps.ideaById.get(id)?.statement?.trim() || maps.ideaById.get(id)?.label?.trim() || '';
    case 'passage':
      return maps.passageText.get(id)?.trim() || '';
    case 'gap': {
      const gap = maps.gapById.get(id);
      return [gap?.label, gap?.summary].filter(Boolean).join('. ').trim();
    }
    case 'contradiction': {
      const c = maps.contradictionById.get(id);
      return [c?.label, c?.summary].filter(Boolean).join('. ').trim();
    }
    default:
      return '';
  }
}


/**
 * Keep only the conflicts whose two quotes really appear in the sections they are
 * attributed to. A model asked to find contradictions will invent them; requiring it
 * to quote both sides verbatim turns the claim into something checkable, and this
 * throws away anything that fails the check.
 */
export function groundCoherenceIssues(
  issues: CoherenceIssue[],
  sections: { title: string; text: string }[]
): CoherenceIssue[] {
  const byTitle = new Map(sections.map((s) => [s.title.trim().toLowerCase(), normalizeForMatch(s.text)]));
  const appearsIn = (title: string, quote: string) => {
    const needle = normalizeForMatch(quote);
    if (needle.length < 24) return false;
    const haystack = byTitle.get((title ?? '').trim().toLowerCase());
    // Fall back to the whole report: a model often mislabels which section a
    // sentence came from while quoting it correctly.
    if (haystack?.includes(needle)) return true;
    return [...byTitle.values()].some((text) => text.includes(needle));
  };
  return (issues ?? []).filter(
    (issue) =>
      issue &&
      typeof issue.quoteA === 'string' &&
      typeof issue.quoteB === 'string' &&
      issue.quoteA.trim() !== issue.quoteB.trim() &&
      appearsIn(issue.sectionA, issue.quoteA) &&
      appearsIn(issue.sectionB, issue.quoteB)
  );
}

function normalizeForMatch(text: string): string {
  return stripMarkdown(text ?? '')
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface VerificationOutcome {
  markdown: string;
  checked: number;
  partial: number;
  unsupported: number;
  /** Sentences that lost their only support, for honest reporting. */
  strippedSentences: string[];
  /** The claims worth a second look, paired with the source to check them against. */
  audit: { verdict: 'partial' | 'removed'; claim: CitationClaim }[];
}

/**
 * Apply the verdicts. A citation the source does not support is a false attribution.
 * Remove the complete sentence whenever any attached source is partial or
 * unsupported. Merely deleting the weak link can leave an unsupported conjunct
 * alive beside a different, valid citation. The bounded evidence-repair pass may
 * restore a narrower sentence, and that replacement must itself be re-verified.
 */
export function applyVerification(markdown: string, claims: CitationClaim[], verdicts: CitationVerdict[]): VerificationOutcome {
  const judged = claims.map((claim, index) => ({ claim, verdict: verdicts[index] }));
  const unsupportedEntries = judged.filter((entry) => entry.verdict === 'unsupported');
  const partial = verdicts.filter((v) => v === 'partial').length;

  // A partial verdict is a known mismatch between sentence and source, not an
  // acceptable final citation. Fail the whole sentence closed even when another
  // citation passed: otherwise “A y B (source A; source B)” can retain B after its
  // only support was rejected. The repair pass can split and restore proven parts.
  const bySentence = new Map<string, typeof judged>();
  for (const entry of judged) {
    const key = `${entry.claim.sentenceOffset}:${entry.claim.sentenceEnd}`;
    const group = bySentence.get(key) ?? [];
    group.push(entry);
    bySentence.set(key, group);
  }
  const removedSentenceKeys = new Set(
    [...bySentence.entries()]
      .filter(([, entries]) => entries.some((entry) => entry.verdict !== 'supports'))
      .map(([key]) => key),
  );
  const operations: Array<{ start: number; end: number; sentence: string }> = [];
  for (const [key, entries] of bySentence) {
    if (removedSentenceKeys.has(key)) {
      const claim = entries[0].claim;
      operations.push({ start: claim.sentenceOffset, end: claim.sentenceEnd, sentence: claim.sentence });
      continue;
    }
    for (const { claim, verdict } of entries) {
      if (verdict !== 'supports') operations.push({ start: claim.offset, end: claim.offset + claim.link.length, sentence: claim.sentence });
    }
  }

  // Remove from the end so earlier offsets stay valid.
  let out = markdown;
  const strippedSentences: string[] = [];
  for (const operation of operations.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, operation.start) + out.slice(operation.end);
    strippedSentences.push(operation.sentence);
  }
  out = out
    .replace(/\(\s*[;,]?\s*\)/g, '')
    .replace(/\s+([.,;)])/g, '$1')
    .replace(/[,;:]\s*([.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const audit = claims
    .map((claim, index) => ({ verdict: verdicts[index], claim }))
    .filter((entry) => entry.verdict === 'partial' || entry.verdict === 'unsupported')
    .map((entry) => ({ verdict: entry.verdict === 'partial' ? ('partial' as const) : ('removed' as const), claim: entry.claim }));
  return { markdown: out, checked: claims.length, partial, unsupported: unsupportedEntries.length, strippedSentences, audit };
}

// ─────────────────────────────────────────────────────────────────────────────
// References / matrix / assembly
// ─────────────────────────────────────────────────────────────────────────────

/** Every work referenced by the report: cited directly, or backing a cited idea. */
export function collectCitedWorkIds(citedIds: { ideas: Set<string>; works: Set<string> }, maps: SnapshotMaps): Set<string> {
  const workIds = new Set<string>(citedIds.works);
  for (const ideaId of citedIds.ideas) {
    const idea = maps.ideaById.get(ideaId);
    for (const w of idea?.works ?? []) workIds.add(w.nodus_id);
  }
  return workIds;
}

export function buildReferences(workIds: Set<string>, maps: SnapshotMaps, language: PromptLanguage = 'es'): string[] {
  const L = labels(language);
  const entries = [...workIds]
    .map((id) => maps.workInfoById.get(id))
    .filter((w): w is WorkInfo => !!w)
    .map((work) => referenceEntry(work, L));
  return dedupe(entries).sort((a, b) => a.localeCompare(b, language === 'pt-BR' ? 'pt' : language));
}

function referenceEntry(work: WorkInfo, L: Labels): string {
  return sharedReferenceEntry(work, L);
}

function buildMatrix(coveredIdeaIds: Set<string>, maps: SnapshotMaps, L: Labels): WritingWorkshopMatrixRow[] {
  const rows: WritingWorkshopMatrixRow[] = [];
  for (const id of coveredIdeaIds) {
    if (rows.length >= MAX_MATRIX_ROWS) break;
    const idea = maps.ideaById.get(id);
    if (!idea) continue;
    rows.push({
      claim: clip(idea.statement || idea.label, 240),
      role: matrixRole(idea.type),
      sourceLabel: sourceLabelFromWork(idea.works[0], maps.language) || L.corpusSource,
      citation: `nodus://idea/${encodeURIComponent(id)}`,
      evidence: idea.evidenceCount > 0 ? L.anchoredEvidence(idea.evidenceCount) : L.derivedIdea,
      notes: idea.workCount > 1 ? L.supportedBy(idea.workCount) : L.singleSupport,
    });
  }
  return rows;
}

function matrixRole(type: string): WritingWorkshopMatrixRow['role'] {
  switch (type) {
    case 'method':
      return 'method';
    case 'definition':
      return 'definition';
    case 'context':
      return 'context';
    default:
      return 'support';
  }
}

export function assembleMarkdown(
  written: { section: DeepResearchPlanSection; markdown: string }[],
  references: string[],
  finalize: FinalizeResult,
  language: PromptLanguage,
  structure: DeepResearchRequest['sectionLimit'] = 'auto',
): string {
  const L = labels(language);
  if (structure === 'single') {
    return assembleContinuousNarrative(
      written.map((item) => item.markdown),
      references,
      finalize.limitations,
      L.references,
      L.limitations,
      L.noReferences,
      finalize.abstract,
    );
  }
  const parts: string[] = [];
  if (finalize.abstract) {
    parts.push(`## ${L.abstract}`, '', finalize.abstract, '');
  }
  for (const w of written) {
    parts.push(w.markdown.trim(), '');
  }
  if (finalize.limitations.length > 0) {
    parts.push(`## ${L.limitations}`, '', ...finalize.limitations.map((x) => `- ${x}`), '');
  }
  parts.push(`## ${L.references}`, '');
  if (references.length > 0) parts.push(...references.map((r) => `- ${r}`));
  else parts.push(`- ${L.noReferences}`);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Publish a continuous report without weakening retrieval. Writers may still work
 * over several evidence-sized argumentative movements; this deterministic final
 * pass removes their presentation headings and joins the verified prose. Keeping
 * the technical references/limitations as bold labels makes them navigable without
 * turning them into report sections.
 */
export function assembleContinuousNarrative(
  narrativeParts: string[],
  references: string[],
  limitations: string[],
  referencesLabel: string,
  limitationsLabel: string,
  noReferencesLabel: string,
  abstract = '',
): string {
  const prose = narrativeParts
    .map((part) => part
      .replace(/^#{1,6}\s+[^\n]+\n*/gmu, '')
      .replace(/\n{3,}/gu, '\n\n')
      .trim())
    .filter(Boolean)
    .join('\n\n');
  const parts = [abstract.trim(), prose];
  if (limitations.length) {
    parts.push(`**${limitationsLabel}.** ${limitations.map((item) => item.trim().replace(/[.]+$/u, '')).filter(Boolean).join('. ')}.`);
  }
  parts.push(`**${referencesLabel}**\n\n${references.length ? references.map((reference) => `- ${reference}`).join('\n') : `- ${noReferencesLabel}`}`);
  return parts.filter(Boolean).join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function sectionSources(section: DeepResearchPlanSection, maps: SnapshotMaps): string[] {
  return section.ideaIds
    .map((id) => maps.ideaById.get(id))
    .filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea)
    .slice(0, 8)
    .map((idea) => ideaCitation(idea, maps.language));
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation menu / helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildCitationMenu(section: DeepResearchPlanSection, maps: SnapshotMaps): CitationMenuItem[] {
  const items: CitationMenuItem[] = [];
  const language = maps.language ?? 'es';
  const words = citationWords(language);
  const excerpts = passageExcerpts(section.passageIds.flatMap(id => {
    const text = maps.passageText.get(id);
    return text?.trim() && maps.passageWorkId.has(id) ? [{ id, text }] : [];
  }));
  // Passages are offered last, on purpose. Leading with them was measured and made
  // the report worse: verbatim quoting more than tripled, the argument leaned on a
  // third fewer distinct works because each passage belongs to a single one, and
  // unsupported citations doubled as claims overreached a narrow snippet.
  for (const id of sourceBalancedIdeaIds(section.ideaIds, maps)) {
    const idea = maps.ideaById.get(id);
    if (!idea) continue;
    items.push({
      token: ideaCitation(idea, language),
      kind: 'idea',
      note: clip(idea.statement || idea.label, IDEA_NOTE_CHARS),
      source: ideaSupportLabel(idea, language),
    });
  }
  for (const id of section.workIds) {
    const work = maps.workInfoById.get(id);
    // A catalog title authorizes discovery and bibliography, not a substantive
    // claim. Scoped documentary runs must cite their actual passages or Ideas.
    if (!work || work.metadataOnly) continue;
    items.push({
      token: `[${sourceLabelFromWork(work, language)}](nodus://work/${encodeURIComponent(id)})`,
      kind: 'work',
      note: clip(work.title, 200),
      source: sourceLabelFromWork(work, language),
    });
  }
  for (const id of section.gapIds) {
    const gap = maps.gapById.get(id);
    if (!gap) continue;
    items.push({
      token: `[${gap.source || words.gap}](nodus://gap/${encodeURIComponent(id)})`,
      kind: 'gap',
      note: clip(gap.summary || gap.label, IDEA_NOTE_CHARS),
    });
  }
  for (const id of section.contradictionIds) {
    const contradiction = maps.contradictionById.get(id);
    if (!contradiction) continue;
    const sides = contradiction.label ? `Posturas enfrentadas: ${contradiction.label}. ` : '';
    const who = contradiction.sources.length ? ` Lo sostienen ${contradiction.sources.join('; ')}.` : '';
    items.push({
      token: `[${contradiction.sources[0] || words.contradiction}](nodus://contradiction/${encodeURIComponent(id)})`,
      kind: 'contradiction',
      note: `${sides}${clip(contradiction.summary, IDEA_NOTE_CHARS)}${who}`.trim(),
      source: contradiction.sources.join('; ') || undefined,
    });
  }
  for (const id of section.passageIds) {
    const workId = maps.passageWorkId.get(id);
    const text = maps.passageText.get(id);
    // A passage with no readable text is NOT offered: citing it would be a page
    // number attached to words the writer never saw.
    if (!workId || !text) continue;
    const page = maps.passagePage.get(id);
    const label = `${sourceLabelFromWork(maps.workInfoById.get(workId), language)}${page ? `, ${page}` : ''}`;
    items.push({
      token: `[${label}](nodus://passage/${encodeURIComponent(id)})`,
      kind: 'passage',
      note: `«${excerpts.get(id) ?? ''}»`,
      source: label,
    });
  }
  return items;
}

/**
 * Preserve the planner's relevance order while interleaving works. Models privilege
 * early menu items; grouping ten ideas from one book before the alternatives made a
 * diverse menu behave like a single-source menu in practice.
 */
function sourceBalancedIdeaIds(ids: string[], maps: SnapshotMaps): string[] {
  const buckets = new Map<string, string[]>();
  const order: string[] = [];
  for (const id of ids) {
    const idea = maps.ideaById.get(id);
    if (!idea) continue;
    const source = idea.works[0]?.nodus_id ?? `idea:${id}`;
    if (!buckets.has(source)) {
      buckets.set(source, []);
      order.push(source);
    }
    buckets.get(source)!.push(id);
  }
  const out: string[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const source of order) {
      const next = buckets.get(source)?.shift();
      if (!next) continue;
      out.push(next);
      remaining = true;
    }
  }
  return out;
}

function citationUrlFromToken(token: string): string | null {
  return token.match(/\]\((nodus:\/\/[^)\s]+)\)/u)?.[1] ?? null;
}

function normalizedQualitySource(item: CitationMenuItem): string {
  const source = item.source?.trim();
  if (source) return source.replace(/,\s*(?:p\.?\s*)?\d+(?:[-–]\d+)?$/iu, '').toLocaleLowerCase();
  return citationUrlFromToken(item.token) ?? item.token;
}

export function qualitySourcesFromMenu(menu: CitationMenuItem[]): DeepResearchQualitySource[] {
  return menu.flatMap((item) => {
    const citation = citationUrlFromToken(item.token);
    if (!citation) return [];
    return [{
      citation,
      sourceId: normalizedQualitySource(item),
      evidence: item.kind === 'passage' ? 'literal' as const : 'synthesis' as const,
    }];
  });
}

function citationUrlsFromMenu(menu: CitationMenuItem[]): Set<string> {
  return new Set(menu.map((item) => citationUrlFromToken(item.token)).filter((url): url is string => Boolean(url)));
}

/** Author-year behind a flagged claim, so the reader knows which source to open. */
function sourceLabelForClaim(claim: CitationClaim, maps: SnapshotMaps): string {
  switch (claim.kind) {
    case 'idea':
      return sourceLabelFromWork(maps.ideaById.get(claim.id)?.works[0], maps.language) || '';
    case 'passage': {
      const workId = maps.passageWorkId.get(claim.id);
      const page = maps.passagePage.get(claim.id);
      const base = sourceLabelFromWork(workId ? maps.workInfoById.get(workId) : undefined, maps.language);
      return page ? `${base}, ${page}` : base;
    }
    case 'gap':
      return maps.gapById.get(claim.id)?.source || '';
    case 'contradiction':
      return maps.contradictionById.get(claim.id)?.sources[0] || '';
    default:
      return '';
  }
}

/** Which works back an idea, so the writer can name them in prose. */
function ideaSupportLabel(idea: WritingWorkshopIdeaCandidate, language?: PromptLanguage): string {
  return idea.works
    .slice(0, 3)
    .map((w) => sourceLabelFromWork(w, language))
    .filter(Boolean)
    .join('; ');
}

function ideaCitation(idea: WritingWorkshopIdeaCandidate, language?: PromptLanguage): string {
  const label = sourceLabelFromWork(idea.works[0], language) || idea.label;
  return `[${label}](nodus://idea/${encodeURIComponent(idea.id)})`;
}

/**
 * One citable pool, ready to hand to an *external* writer (an MCP client's model)
 * so it can articulate and draft the report itself. Every `token` is a verbatim
 * `nodus://` citation the writer must copy unchanged; anything not in this catalog
 * is stripped by {@link applyCitationPolicy} at assembly time. Themes carry no
 * citable token (they are structural context only). Mirrors the trimming the
 * in-app planner uses so the two writers see the same material.
 */
export interface CitationCatalog {
  ideas: { token: string; note: string; type: string; works: string }[];
  works: { token: string; note: string }[];
  gaps: { token: string; note: string }[];
  contradictions: { token: string; note: string }[];
  /** Literal text from the sources, with the page it sits on. The strongest evidence
   * the corpus can offer, and the only kind the writer can quote. */
  passages: { token: string; note: string; source: string }[];
  themes: { id: string; label: string; summary: string }[];
}

export function buildCitationCatalog(snapshot: WritingWorkshopSnapshot): CitationCatalog {
  const language = snapshot.brief?.language ?? 'es';
  const words = citationWords(language);
  const passages = snapshot.passages.filter(passage => passage.summary?.trim()).slice(0, POOL_LIMITS.passages);
  const excerpts = passageExcerpts(passages.map(passage => ({ id: passage.id, text: passage.summary })));
  return {
    ideas: snapshot.ideas.slice(0, POOL_LIMITS.ideas).map((i) => ({
      token: ideaCitation(i, language),
      note: clip(i.statement || i.label, 200),
      type: i.type,
      works: i.works.map((w) => `${w.authors[0] ?? citationWords(language).author}${w.year ? ` (${w.year})` : ''}`).join('; '),
    })),
    works: snapshot.works.slice(0, POOL_LIMITS.works).map((w) => ({
      token: `[${sourceLabelFromWork(w, language) || w.label}](nodus://work/${encodeURIComponent(w.id)})`,
      note: clip(w.title || w.label, 160),
    })),
    gaps: snapshot.gaps.slice(0, POOL_LIMITS.gaps).map((g) => ({
      token: `[${sourceLabelFromWork(g.work, language) || words.gap}](nodus://gap/${encodeURIComponent(g.id)})`,
      note: clip(g.summary || g.label, 160),
    })),
    contradictions: snapshot.contradictions.slice(0, POOL_LIMITS.contradictions).map((c) => ({
      token: `[${c.sources?.[0] || words.contradiction}](nodus://contradiction/${encodeURIComponent(c.id)})`,
      note: `Posturas enfrentadas: ${c.label}. ${clip(c.summary, 200)}${c.sources?.length ? ` Lo sostienen ${c.sources.join('; ')}.` : ''}`.trim(),
    })),
    // Only passages whose text is actually present; a page number the writer cannot
    // read is an invitation to invent what the source says.
    passages: passages.map((p) => {
        const label = `${authorYearLabel(p.authors[0], p.year, undefined, language)}${p.pageLabel ? `, ${p.pageLabel}` : ''}`;
        return {
          token: `[${label}](nodus://passage/${encodeURIComponent(p.id)})`,
          note: `«${excerpts.get(p.id)!}»`,
          source: label,
        };
      }),
    themes: snapshot.themes.slice(0, POOL_LIMITS.themes).map((t) => ({ id: t.id, label: t.label, summary: clip(t.summary, 160) })),
  };
}


/**
 * A running synopsis of the report so far. The opening sentence of a section says
 * almost nothing about where its argument ended up, so each entry carries where the
 * section *closed* — that is what the next one has to pick up from without repeating.
 */
function summarizePrior(written: { section: DeepResearchPlanSection; markdown: string }[]): string {
  if (written.length === 0) return '';
  return written
    .map((w, i) => {
      const prose = stripMarkdown(stripInitialHeading(w.markdown));
      const opening = clip(firstSentence(prose), 200);
      const closing = clip(closingSentences(prose, 2), 320);
      return `${i + 1}. ${w.section.title}\n   ${opening}\n   … ${closing}`;
    })
    .join('\n');
}

/** The last `count` sentences of a passage of prose. */
function closingSentences(text: string, count: number): string {
  const sentences = (text ?? '').split(/(?<=[.!?])\s+/u).filter(Boolean);
  if (sentences.length === 0) return text ?? '';
  return sentences.slice(-count).join(' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Small pure utilities
// ─────────────────────────────────────────────────────────────────────────────

function pagesFromWords(words: number): number {
  return Math.max(1, Math.round(words / OBSERVED_WORDS_PER_PAGE));
}
export function countWords(text: string): number {
  return stripMarkdown(text).split(/\s+/).filter(Boolean).length;
}
function stripMarkdown(text: string): string {
  return (text ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}
function clip(text: string, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}
function cleanStr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
    : [];
}
function dedupe(items: string[]): string[] {
  return [...new Set(items.map((i) => i.trim()).filter(Boolean))];
}

export interface Labels {
  abstract: string;
  limitations: string;
  references: string;
  noReferences: string;
  gathering: string;
  planning: (sections: number) => string;
  writing: string;
  coverage: (pending: number) => string;
  assembling: string;
  done: (sections: number, pages: number) => string;
  degraded: string;
  degradedEmpty: string;
  coverageTitle: string;
  coveragePurpose: string;
  introTitle: string;
  introPurpose: string;
  threadTitle: string;
  threadPurpose: string;
  synthesisTitle: string;
  synthesisPurpose: string;
  reportTitlePrefix: string;
  uncoveredLimitation: (samples: string[]) => string;
  coherenceLimitation: (issue: CoherenceIssue) => string;
  reviewStep: string;
  corpusSource: string;
  anchoredEvidence: (count: number) => string;
  derivedIdea: string;
  supportedBy: (count: number) => string;
  singleSupport: string;
  unknownAuthor: string;
  noDate: string;
}

const ES: Labels = {
  abstract: 'Resumen',
  limitations: 'Limitaciones',
  references: 'Referencias',
  noReferences: 'Sin fuentes citadas.',
  gathering: 'Reuniendo materiales del corpus…',
  planning: (s) => `Planificando ${s} movimientos argumentales según la evidencia…`,
  writing: 'Redactando',
  coverage: (n) => `Ampliando cobertura (${n} ideas pendientes)…`,
  assembling: 'Ensamblando informe y referencias…',
  done: (s, p) => `Informe listo: ${s} secciones · ~${p} páginas`,
  degraded: 'Una o más secciones no pudieron generarse con el modelo y se resolvieron de forma degradada.',
  degradedEmpty: 'No se pudo desarrollar esta sección con el modelo; revisar los materiales asignados.',
  coverageTitle: 'Desarrollo complementario',
  coveragePurpose: 'Desarrollar ideas del corpus todavía no tratadas en profundidad.',
  introTitle: 'Introducción y planteamiento',
  introPurpose: 'Delimitar el problema y anticipar las líneas del argumento.',
  threadTitle: 'Línea argumental',
  threadPurpose: 'Desarrollar y relacionar un grupo de ideas del corpus.',
  synthesisTitle: 'Síntesis, huecos y contribución',
  synthesisPurpose: 'Integrar las líneas, señalar huecos y perfilar la contribución.',
  reportTitlePrefix: 'Informe:',
  uncoveredLimitation: (s) => `Quedaron ideas del corpus sin desarrollar en profundidad (p. ej.: ${s.join('; ')}).`,
  coherenceLimitation: (i) =>
    i.sectionA.trim() === i.sectionB.trim()
      ? `Tensión interna dentro de «${i.sectionA}». ${i.issue}`
      : `Tensión interna entre «${i.sectionA}» y «${i.sectionB}». ${i.issue}`,
  reviewStep: 'Revisar cada cita y contrastar el informe con las fuentes originales.',
  corpusSource: 'Fuente del corpus',
  anchoredEvidence: (n) => `${n} evidencia(s) ancladas en el corpus.`,
  derivedIdea: 'Idea derivada del corpus.',
  supportedBy: (n) => `Sostenida por ${n} obras.`,
  singleSupport: 'Una obra de respaldo.',
  unknownAuthor: 'Autor desconocido',
  noDate: 's.f.',
};

const EN: Labels = {
  abstract: 'Abstract',
  limitations: 'Limitations',
  references: 'References',
  noReferences: 'No sources cited.',
  gathering: 'Gathering corpus material…',
  planning: (s) => `Planning ${s} evidence-derived argumentative movements…`,
  writing: 'Writing',
  coverage: (n) => `Widening coverage (${n} ideas still untouched)…`,
  assembling: 'Assembling report and references…',
  done: (s, p) => `Report ready: ${s} sections · ~${p} pages`,
  degraded: 'One or more sections could not be generated by the model and were resolved in a degraded form.',
  degradedEmpty: 'The model could not develop this section; review the assigned material.',
  coverageTitle: 'Further development',
  coveragePurpose: 'Develop corpus ideas not yet treated in depth.',
  introTitle: 'Introduction and framing',
  introPurpose: 'Delimit the problem and anticipate the lines of argument.',
  threadTitle: 'Line of argument',
  threadPurpose: 'Develop and relate a group of ideas from the corpus.',
  synthesisTitle: 'Synthesis, gaps and contribution',
  synthesisPurpose: 'Integrate the lines, name the gaps and outline the contribution.',
  reportTitlePrefix: 'Report:',
  uncoveredLimitation: (s) => `Some corpus ideas were left undeveloped (for example: ${s.join('; ')}).`,
  coherenceLimitation: (i) =>
    i.sectionA.trim() === i.sectionB.trim()
      ? `Internal tension within "${i.sectionA}". ${i.issue}`
      : `Internal tension between "${i.sectionA}" and "${i.sectionB}". ${i.issue}`,
  reviewStep: 'Check every citation against the original sources.',
  corpusSource: 'Corpus source',
  anchoredEvidence: (n) => `${n} piece(s) of evidence anchored in the corpus.`,
  derivedIdea: 'Idea derived from the corpus.',
  supportedBy: (n) => `Supported by ${n} works.`,
  singleSupport: 'One supporting work.',
  unknownAuthor: 'Unknown author',
  noDate: 'n.d.',
};

/** Headings the report itself carries, per language. Progress copy and fallback
 * prose fall back to English rather than leaking Spanish into a foreign report. */
const HEADINGS: Partial<Record<PromptLanguage, Pick<Labels, 'abstract' | 'limitations' | 'references' | 'noReferences'>>> = {
  es: { abstract: 'Resumen', limitations: 'Limitaciones', references: 'Referencias', noReferences: 'Sin fuentes citadas.' },
  en: { abstract: 'Abstract', limitations: 'Limitations', references: 'References', noReferences: 'No sources cited.' },
  fr: { abstract: 'Résumé', limitations: 'Limites', references: 'Références', noReferences: 'Aucune source citée.' },
  tr: { abstract: 'Özet', limitations: 'Sınırlılıklar', references: 'Kaynakça', noReferences: 'Kaynak belirtilmedi.' },
  de: {
    abstract: 'Zusammenfassung',
    limitations: 'Einschränkungen',
    references: 'Literaturverzeichnis',
    noReferences: 'Keine Quellen angegeben.',
  },
  pt: { abstract: 'Resumo', limitations: 'Limitações', references: 'Bibliografia', noReferences: 'Nenhuma fonte citada.' },
  'pt-BR': { abstract: 'Resumo', limitations: 'Limitações', references: 'Referências', noReferences: 'Nenhuma fonte citada.' },
  it: { abstract: 'Riassunto', limitations: 'Limitazioni', references: 'Riferimenti bibliografici', noReferences: 'Nessuna fonte citata.' },
  'zh-Hans': { abstract: '摘要', limitations: '局限性', references: '参考文献', noReferences: '未引用任何来源。' },
  'zh-Hant': { abstract: '摘要', limitations: '限制', references: '參考文獻', noReferences: '未引用任何來源。' },
  vi: { abstract: 'Tóm tắt', limitations: 'Hạn chế', references: 'Tài liệu tham khảo', noReferences: 'Không có nguồn nào được trích dẫn.' },
  ja: { abstract: '要旨', limitations: '限界', references: '参考文献', noReferences: '引用された出典はありません。' },
  ru: { abstract: 'Аннотация', limitations: 'Ограничения', references: 'Список литературы', noReferences: 'Источники не цитировались.' },
  uk: { abstract: 'Анотація', limitations: 'Обмеження', references: 'Список літератури', noReferences: 'Джерела не цитовано.' },
  ko: { abstract: '초록', limitations: '한계', references: '참고문헌', noReferences: '인용된 출처가 없습니다.' },
};

export function labels(language: PromptLanguage): Labels {
  if (language === 'es') return ES;
  if (language === 'en') return EN;
  const headings = HEADINGS[language];
  return headings ? { ...EN, ...headings } : ES;
}
