import type { PromptLanguage } from './types';

export type StudyImproveLevel = 'minimal' | 'moderate' | 'deep';
export type StudyImproveLength = 'similar' | 'shorter' | 'develop';
export type StudyImproveMode = 'preserve' | 'free';
export type StudyImproveScope = 'selection' | 'paragraph' | 'section' | 'document';

export type StudyImprovePresetId =
  | 'academic'
  | 'formal'
  | 'clear'
  | 'concise'
  | 'developed'
  | 'outline'
  | 'proofread'
  | 'cohesion'
  | 'neutral'
  | 'popular'
  | 'adapt-level'
  | 'summary'
  | 'notes';

export type StudyStyleCategory = 'academic' | 'clarity' | 'structure' | 'audience' | 'custom';

export interface StudyStyleConfig {
  name: string;
  icon: string;
  color: string;
  description: string;
  prompt: string;
  systemPrompt: string;
  category: StudyStyleCategory;
  language: string;
  level: StudyImproveLevel;
  length: StudyImproveLength;
  modelProvider: string | null;
  modelName: string | null;
  temperature: number;
  maxOutputTokens: number;
  creativity: number;
  locked: boolean;
}

export interface StudyStyle extends StudyStyleConfig {
  id: string;
  shortId: string;
  builtIn: boolean;
  favorite: boolean;
  active: boolean;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyStyleInput extends Partial<StudyStyleConfig> {
  name: string;
  prompt: string;
  favorite?: boolean;
  active?: boolean;
  position?: number;
}

export interface StudyStyleVersion {
  id: string;
  shortId: string;
  styleId: string;
  versionNo: number;
  config: StudyStyleConfig;
  reason: 'create' | 'update' | 'restore' | 'import';
  createdAt: string;
}

export type StudyStyleAssociationKind = 'global' | 'subject' | 'document_kind';

export interface StudyStyleAssociation {
  id: string;
  styleId: string;
  kind: StudyStyleAssociationKind;
  targetId: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudyImproveVariables {
  subject?: string;
  topic?: string;
  academicLevel?: string;
  language?: string;
  documentType?: string;
  targetLength?: string;
  selectedText?: string;
}

/** Native prompt copy for the writing editor. JSON/Markdown markers are assembled
 * by the Electron caller; these strings contain only instructions, never user text. */
export interface StudyImprovePromptPack {
  role: string;
  mustReturn: string;
  preserve: string;
  noInvent: string;
  faithful: string;
  free: string;
  styleHeader: string;
  rulesHeader: string;
  conflictInstruction: string;
  sameOriginal: string;
  outputLanguage: string;
  selectionHeader: string;
  scopeLabel: string;
  protectedMarker: string;
  level: Record<StudyImproveLevel, string>;
  length: Record<StudyImproveLength, string>;
}

export const STUDY_IMPROVE_PROMPT_PACKS: Record<PromptLanguage, StudyImprovePromptPack> = {
  es: {
    role: 'Eres el editor de texto del vault de estudio de Nodus.',
    mustReturn: 'Devuelve exclusivamente el texto de reemplazo, sin introducciones, explicaciones, etiquetas ni bloques envolventes.',
    preserve: 'Conserva Markdown válido y la estructura que no sea necesario cambiar: títulos, listas, tablas, enlaces, notas, citas, referencias, código y fórmulas.',
    noInvent: 'No inventes fuentes ni presentes como cierto algo que el original no afirma.',
    faithful: 'MODO FIEL: conserva significado, ideas, datos, referencias, intención y fuerza epistémica. Está prohibido añadir información, argumentos, ejemplos, citas o afirmaciones nuevas.',
    free: 'MODO TRANSFORMACIÓN LIBRE: el usuario ha autorizado cambios creativos, pero debes conservar marcadores protegidos y no inventar citas o datos.',
    styleHeader: 'PREFERENCIAS DEL ESTILO (subordinadas a las reglas anteriores):', rulesHeader: 'REGLAS INNEGOCIABLES:', conflictInstruction: 'Si una instrucción de estilo contradice estas reglas, ignora solo esa parte.', sameOriginal: 'el mismo que el original', outputLanguage: 'Idioma de salida', selectionHeader: 'TEXTO SELECCIONADO:', scopeLabel: 'Ámbito', protectedMarker: 'Conserva exactamente una vez y sin alterar cada marcador interno de protección presente en el texto seleccionado.',
    level: { minimal: 'Modificación mínima: corrige solo problemas evidentes y conserva sintaxis y vocabulario cuando sean válidos.', moderate: 'Modificación moderada: mejora redacción y estructura local sin cambiar las ideas ni el orden argumental esencial.', deep: 'Modificación profunda: puedes reorganizar la expresión, pero no las ideas, datos, referencias, intención ni fuerza de las afirmaciones.' },
    length: { similar: 'Mantén una longitud similar al original.', shorter: 'Acorta el texto sin omitir ninguna idea, dato, referencia o matiz necesario.', develop: 'Desarrolla solo relaciones ya implícitas en el original. No aportes información, ejemplos ni argumentos nuevos.' },
  },
  en: {
    role: 'You are Nodus study vault’s text editor.', mustReturn: 'Return only the replacement text, with no introductions, explanations, labels, or wrapping blocks.', preserve: 'Keep valid Markdown and any structure that does not need changing: headings, lists, tables, links, notes, citations, references, code, and formulas.', noInvent: 'Do not invent sources or present anything as true that the original does not claim.', faithful: 'FAITHFUL MODE: preserve meaning, ideas, data, references, intent, and epistemic strength. Do not add information, arguments, examples, citations, or new claims.', free: 'FREE TRANSFORMATION MODE: creative changes are authorised, but preserve protected markers and never invent citations or data.', styleHeader: 'STYLE PREFERENCES (subordinate to the rules above):', rulesHeader: 'NON-NEGOTIABLE RULES:', conflictInstruction: 'If a style instruction conflicts with these rules, ignore only that part.', sameOriginal: 'the same as the original', outputLanguage: 'Output language', selectionHeader: 'SELECTED TEXT:', scopeLabel: 'Scope', protectedMarker: 'Preserve every internal protection marker in the selected text exactly once and without altering it.',
    level: { minimal: 'Minimal editing: fix only clear problems and keep valid syntax and vocabulary.', moderate: 'Moderate editing: improve wording and local structure without changing ideas or the essential argument order.', deep: 'Deep editing: you may reorganise expression, but not ideas, data, references, intent, or claim strength.' },
    length: { similar: 'Keep a similar length to the original.', shorter: 'Shorten the text without omitting any necessary idea, data, reference, or nuance.', develop: 'Develop only relationships already implicit in the original. Add no information, examples, or arguments.' },
  },
  fr: {
    role: 'Tu es l’éditeur de texte du coffre d’étude de Nodus.', mustReturn: 'Renvoie uniquement le texte de remplacement, sans introduction, explication, étiquette ni bloc englobant.', preserve: 'Conserve le Markdown valide et toute structure qui ne doit pas changer : titres, listes, tableaux, liens, notes, citations, références, code et formules.', noInvent: 'N’invente pas de sources et ne présente pas comme vrai ce que l’original n’affirme pas.', faithful: 'MODE FIDÈLE : conserve le sens, les idées, les données, les références, l’intention et la force épistémique. N’ajoute aucune information, aucun argument, exemple, citation ou énoncé.', free: 'MODE TRANSFORMATION LIBRE : les changements créatifs sont autorisés, mais conserve les marqueurs protégés et n’invente ni citations ni données.', styleHeader: 'PRÉFÉRENCES DE STYLE (subordonnées aux règles ci-dessus) :', rulesHeader: 'RÈGLES IMPÉRATIVES :', conflictInstruction: 'Si une instruction de style contredit ces règles, ignorez uniquement cette partie.', sameOriginal: 'la même que l’original', outputLanguage: 'Langue de sortie', selectionHeader: 'TEXTE SÉLECTIONNÉ :', scopeLabel: 'Portée', protectedMarker: 'Conserve chaque marqueur interne de protection du texte sélectionné exactement une fois, sans le modifier.',
    level: { minimal: 'Modification minimale : corrige uniquement les problèmes évidents et conserve la syntaxe et le vocabulaire valides.', moderate: 'Modification modérée : améliore la formulation et la structure locale sans changer les idées ni l’ordre argumentatif essentiel.', deep: 'Modification approfondie : tu peux réorganiser l’expression, mais pas les idées, données, références, intention ni force des affirmations.' },
    length: { similar: 'Garde une longueur similaire à l’original.', shorter: 'Raccourcis le texte sans omettre d’idée, donnée, référence ou nuance nécessaire.', develop: 'Développe seulement les relations déjà implicites dans l’original. N’ajoute ni information, ni exemple, ni argument.' },
  },
  de: {
    role: 'Du bist der Texteditor des Nodus-Lernarchivs.', mustReturn: 'Gib ausschließlich den Ersatztext zurück, ohne Einleitung, Erklärung, Labels oder umschließende Blöcke.', preserve: 'Bewahre gültiges Markdown und jede Struktur, die nicht geändert werden muss: Überschriften, Listen, Tabellen, Links, Notizen, Zitate, Verweise, Code und Formeln.', noInvent: 'Erfinde keine Quellen und stelle nichts als wahr dar, was das Original nicht behauptet.', faithful: 'TREUER MODUS: Bewahre Bedeutung, Ideen, Daten, Verweise, Absicht und epistemische Stärke. Füge keine Informationen, Argumente, Beispiele, Zitate oder Behauptungen hinzu.', free: 'FREIER TRANSFORMATIONSMODUS: Kreative Änderungen sind erlaubt, aber geschützte Marker bleiben erhalten; erfinde nie Zitate oder Daten.', styleHeader: 'STILVORGABEN (den obigen Regeln untergeordnet):', rulesHeader: 'UNVERHANDELBARE REGELN:', conflictInstruction: 'Wenn eine Stilvorgabe diesen Regeln widerspricht, ignoriere nur diesen Teil.', sameOriginal: 'dieselbe wie das Original', outputLanguage: 'Ausgabesprache', selectionHeader: 'AUSGEWÄHLTER TEXT:', scopeLabel: 'Bereich', protectedMarker: 'Bewahre jeden internen Schutzmarker im ausgewählten Text genau einmal und unverändert.',
    level: { minimal: 'Minimale Änderung: Behebe nur eindeutige Probleme und erhalte gültige Syntax und Wortwahl.', moderate: 'Mäßige Änderung: Verbessere Formulierung und lokale Struktur, ohne Ideen oder die wesentliche Argumentreihenfolge zu ändern.', deep: 'Gründliche Änderung: Du darfst die Formulierung neu ordnen, aber nicht Ideen, Daten, Verweise, Absicht oder Aussagekraft.' },
    length: { similar: 'Behalte eine ähnliche Länge wie das Original.', shorter: 'Kürze den Text, ohne notwendige Ideen, Daten, Verweise oder Nuancen auszulassen.', develop: 'Entwickle nur Beziehungen, die im Original bereits implizit sind. Füge keine Informationen, Beispiele oder Argumente hinzu.' },
  },
  pt: {
    role: 'És o editor de texto do arquivo de estudo do Nodus.', mustReturn: 'Devolve exclusivamente o texto de substituição, sem introduções, explicações, etiquetas ou blocos envolventes.', preserve: 'Conserva Markdown válido e a estrutura que não seja necessário alterar: títulos, listas, tabelas, ligações, notas, citações, referências, código e fórmulas.', noInvent: 'Não inventes fontes nem apresentes como verdadeiro algo que o original não afirma.', faithful: 'MODO FIEL: conserva significado, ideias, dados, referências, intenção e força epistémica. É proibido acrescentar informação, argumentos, exemplos, citações ou afirmações.', free: 'MODO DE TRANSFORMAÇÃO LIVRE: o utilizador autorizou mudanças criativas, mas conserva os marcadores protegidos e não inventes citações ou dados.', styleHeader: 'PREFERÊNCIAS DE ESTILO (subordinadas às regras anteriores):', rulesHeader: 'REGRAS INEGOCIÁVEIS:', conflictInstruction: 'Se uma instrução de estilo contrariar estas regras, ignora apenas essa parte.', sameOriginal: 'o mesmo que o original', outputLanguage: 'Idioma de saída', selectionHeader: 'TEXTO SELECIONADO:', scopeLabel: 'Âmbito', protectedMarker: 'Conserva cada marcador interno de proteção do texto selecionado exatamente uma vez e sem o alterar.',
    level: { minimal: 'Alteração mínima: corrige apenas problemas evidentes e conserva sintaxe e vocabulário válidos.', moderate: 'Alteração moderada: melhora a redação e a estrutura local sem mudar as ideias nem a ordem argumental essencial.', deep: 'Alteração profunda: podes reorganizar a expressão, mas não as ideias, dados, referências, intenção ou força das afirmações.' },
    length: { similar: 'Mantém uma extensão semelhante à original.', shorter: 'Encurta o texto sem omitir nenhuma ideia, dado, referência ou nuance necessária.', develop: 'Desenvolve apenas relações já implícitas no original. Não acrescentes informação, exemplos ou argumentos.' },
  },
  'pt-BR': {
    role: 'Você é o editor de texto do vault de estudos do Nodus.', mustReturn: 'Retorne exclusivamente o texto de substituição, sem introduções, explicações, rótulos ou blocos envolventes.', preserve: 'Preserve Markdown válido e a estrutura que não precise mudar: títulos, listas, tabelas, links, notas, citações, referências, código e fórmulas.', noInvent: 'Não invente fontes nem apresente como verdadeiro algo que o original não afirma.', faithful: 'MODO FIEL: preserve significado, ideias, dados, referências, intenção e força epistêmica. É proibido acrescentar informações, argumentos, exemplos, citações ou afirmações novas.', free: 'MODO DE TRANSFORMAÇÃO LIVRE: o usuário autorizou mudanças criativas, mas preserve marcadores protegidos e não invente citações ou dados.', styleHeader: 'PREFERÊNCIAS DE ESTILO (subordinadas às regras anteriores):', rulesHeader: 'REGRAS INEGOCIÁVEIS:', conflictInstruction: 'Se uma instrução de estilo entrar em conflito com estas regras, ignore apenas essa parte.', sameOriginal: 'o mesmo que o original', outputLanguage: 'Idioma de saída', selectionHeader: 'TEXTO SELECIONADO:', scopeLabel: 'Escopo', protectedMarker: 'Preserve cada marcador interno de proteção do texto selecionado exatamente uma vez e sem alterá-lo.',
    level: { minimal: 'Alteração mínima: corrija apenas problemas evidentes e preserve sintaxe e vocabulário válidos.', moderate: 'Alteração moderada: melhore a redação e a estrutura local sem mudar as ideias nem a ordem argumentativa essencial.', deep: 'Alteração profunda: você pode reorganizar a expressão, mas não as ideias, dados, referências, intenção ou força das afirmações.' },
    length: { similar: 'Mantenha um comprimento semelhante ao original.', shorter: 'Encurte o texto sem omitir nenhuma ideia, dado, referência ou nuance necessária.', develop: 'Desenvolva apenas relações já implícitas no original. Não acrescente informações, exemplos ou argumentos.' },
  },
  it: {
    role: 'Sei l’editor di testo del vault di studio di Nodus.', mustReturn: 'Restituisci esclusivamente il testo sostitutivo, senza introduzioni, spiegazioni, etichette o blocchi contenitore.', preserve: 'Conserva il Markdown valido e la struttura che non deve cambiare: titoli, elenchi, tabelle, link, note, citazioni, riferimenti, codice e formule.', noInvent: 'Non inventare fonti né presentare come vero ciò che l’originale non afferma.', faithful: 'MODALITÀ FEDELE: conserva significato, idee, dati, riferimenti, intenzione e forza epistemica. È vietato aggiungere informazioni, argomenti, esempi, citazioni o nuove affermazioni.', free: 'MODALITÀ DI TRASFORMAZIONE LIBERA: sono autorizzati cambi creativi, ma conserva i marcatori protetti e non inventare citazioni o dati.', styleHeader: 'PREFERENZE DI STILE (subordinate alle regole precedenti):', rulesHeader: 'REGOLE INDEROGABILI:', conflictInstruction: 'Se un’istruzione di stile contrasta con queste regole, ignora solo quella parte.', sameOriginal: 'uguale all’originale', outputLanguage: 'Lingua di output', selectionHeader: 'TESTO SELEZIONATO:', scopeLabel: 'Ambito', protectedMarker: 'Conserva ogni marcatore interno di protezione nel testo selezionato esattamente una volta e senza modificarlo.',
    level: { minimal: 'Modifica minima: correggi solo problemi evidenti e conserva sintassi e vocabolario validi.', moderate: 'Modifica moderata: migliora formulazione e struttura locale senza cambiare idee o ordine argomentativo essenziale.', deep: 'Modifica approfondita: puoi riorganizzare l’espressione, ma non idee, dati, riferimenti, intenzione o forza delle affermazioni.' },
    length: { similar: 'Mantieni una lunghezza simile all’originale.', shorter: 'Accorcia il testo senza omettere idee, dati, riferimenti o sfumature necessarie.', develop: 'Sviluppa solo relazioni già implicite nell’originale. Non aggiungere informazioni, esempi o argomenti.' },
  },
  tr: {
    role: 'Nodus çalışma kasasının metin editörüsün.', mustReturn: 'Yalnızca değiştirilecek metni döndür; giriş, açıklama, etiket veya çevreleyen blok ekleme.', preserve: 'Geçerli Markdown’ı ve değişmesi gerekmeyen yapıyı koru: başlıklar, listeler, tablolar, bağlantılar, notlar, alıntılar, kaynaklar, kod ve formüller.', noInvent: 'Kaynak uydurma ve özgün metnin ileri sürmediği bir şeyi doğruymuş gibi sunma.', faithful: 'SADIK MOD: anlamı, fikirleri, verileri, kaynakları, amacı ve epistemik gücü koru. Bilgi, argüman, örnek, alıntı veya yeni iddia eklemek yasaktır.', free: 'SERBEST DÖNÜŞÜM MODU: yaratıcı değişikliklere izin verildi; ancak korumalı işaretleri sakla ve alıntı ya da veri uydurma.', styleHeader: 'ÜSLUP TERCİHLERİ (yukarıdaki kurallara tabidir):', rulesHeader: 'PAZARLIK EDİLEMEZ KURALLAR:', conflictInstruction: 'Bir üslup talimatı bu kurallarla çelişirse yalnızca o kısmı yok say.', sameOriginal: 'özgün metinle aynı', outputLanguage: 'Çıktı dili', selectionHeader: 'SEÇİLEN METİN:', scopeLabel: 'Kapsam', protectedMarker: 'Seçilen metindeki her koruma işaretini tam olarak bir kez ve değiştirmeden koru.',
    level: { minimal: 'Asgari düzenleme: yalnızca açık sorunları düzelt ve geçerli sözdizimi ile kelime seçimini koru.', moderate: 'Orta düzey düzenleme: fikirleri ve temel argüman sırasını değiştirmeden anlatımı ve yerel yapıyı geliştir.', deep: 'Derin düzenleme: ifadeyi yeniden düzenleyebilirsin; ancak fikirleri, verileri, kaynakları, amacı veya iddiaların gücünü değiştirme.' },
    length: { similar: 'Özgün metne benzer bir uzunluk koru.', shorter: 'Gerekli hiçbir fikri, veriyi, kaynağı veya nüansı çıkarmadan metni kısalt.', develop: 'Yalnızca özgün metinde örtük olan ilişkileri geliştir. Bilgi, örnek veya argüman ekleme.' },
  },
  'zh-Hans': {
    role: '你是 Nodus 学习库的文本编辑器。', mustReturn: '只返回替换文本，不要添加任何引言、说明、标签或包裹块。', preserve: '保留有效的 Markdown 以及无需改动的结构：标题、列表、表格、链接、笔记、引文、参考文献、代码和公式。', noInvent: '不要杜撰来源，也不要把原文未主张的内容当作事实呈现。', faithful: '忠实模式：保留含义、观点、数据、参考文献、意图和认识论强度。禁止添加信息、论点、例子、引文或新主张。', free: '自由转换模式：用户已授权进行创造性改动，但必须保留受保护标记，且不得杜撰引文或数据。', styleHeader: '风格偏好（从属于上述规则）：', rulesHeader: '不可协商的规则：', conflictInstruction: '如果某条风格指令与这些规则冲突，只忽略该部分。', sameOriginal: '与原文相同', outputLanguage: '输出语言', selectionHeader: '选中的文本：', scopeLabel: '范围', protectedMarker: '将选中文本中的每个内部保护标记原样保留且仅保留一次，不得改动。',
    level: { minimal: '最小改动：只修正明显的问题，保留有效的语法和词汇。', moderate: '适度改动：改进措辞和局部结构，不改变观点或基本论证顺序。', deep: '深度改动：可以重新组织表达，但不得改变观点、数据、参考文献、意图或主张强度。' },
    length: { similar: '保持与原文相近的篇幅。', shorter: '在不遗漏任何必要观点、数据、参考文献或细微差别的前提下缩短文本。', develop: '仅扩展原文中已经隐含的关系。不要添加信息、例子或论点。' },
  },
  'zh-Hant': {
    role: '你是 Nodus 學習庫的文字編輯器。', mustReturn: '只回傳替換文字，不要加入任何前言、說明、標籤或包裹區塊。', preserve: '保留有效的 Markdown 以及無須更動的結構：標題、清單、表格、連結、筆記、引文、參考文獻、程式碼與公式。', noInvent: '不要杜撰來源，也不要將原文未主張的內容視為事實呈現。', faithful: '忠實模式：保留意義、觀點、資料、參考文獻、意圖與認識論強度。禁止新增資訊、論點、範例、引文或新主張。', free: '自由轉換模式：使用者已授權進行創意改寫，但必須保留受保護標記，且不得杜撰引文或資料。', styleHeader: '風格偏好（從屬於上述規則）：', rulesHeader: '不可協商的規則：', conflictInstruction: '若某條風格指令與這些規則衝突，只忽略該部分。', sameOriginal: '與原文相同', outputLanguage: '輸出語言', selectionHeader: '選取的文字：', scopeLabel: '範圍', protectedMarker: '將選取文字中的每個內部保護標記原樣保留且僅保留一次，不得更動。',
    level: { minimal: '最小幅度修改：只修正明顯問題，保留有效的語法與詞彙。', moderate: '適度修改：改善措辭與局部結構，不改變觀點或基本論證順序。', deep: '深度修改：可以重新組織表達方式，但不得改變觀點、資料、參考文獻、意圖或主張強度。' },
    length: { similar: '維持與原文相近的篇幅。', shorter: '在不遺漏任何必要觀點、資料、參考文獻或細微差異的前提下縮短文字。', develop: '僅延伸原文中已隱含的關係。不要新增資訊、範例或論點。' },
  },
  vi: {
    role: 'Bạn là trình biên tập văn bản của kho học tập Nodus.', mustReturn: 'Chỉ trả về văn bản thay thế, không kèm lời mở đầu, giải thích, nhãn hay khối bao quanh.', preserve: 'Giữ nguyên Markdown hợp lệ và mọi cấu trúc không cần thay đổi: tiêu đề, danh sách, bảng, liên kết, ghi chú, trích dẫn, tài liệu tham khảo, mã và công thức.', noInvent: 'Không bịa nguồn hoặc trình bày điều gì là đúng khi nguyên bản không khẳng định như vậy.', faithful: 'CHẾ ĐỘ TRUNG THÀNH: giữ nguyên ý nghĩa, ý tưởng, dữ liệu, tài liệu tham khảo, ý định và độ mạnh nhận thức luận. Không được thêm thông tin, lập luận, ví dụ, trích dẫn hay khẳng định mới.', free: 'CHẾ ĐỘ CHUYỂN ĐỔI TỰ DO: người dùng đã cho phép thay đổi sáng tạo, nhưng phải giữ các dấu bảo vệ và không được bịa trích dẫn hoặc dữ liệu.', styleHeader: 'TÙY CHỌN PHONG CÁCH (phụ thuộc các quy tắc trên):', rulesHeader: 'QUY TẮC BẤT KHẢ XÂM PHẠM:', conflictInstruction: 'Nếu một chỉ dẫn phong cách xung đột với các quy tắc này, chỉ bỏ qua phần đó.', sameOriginal: 'giống như nguyên bản', outputLanguage: 'Ngôn ngữ đầu ra', selectionHeader: 'VĂN BẢN ĐƯỢC CHỌN:', scopeLabel: 'Phạm vi', protectedMarker: 'Giữ nguyên vẹn và đúng một lần mọi dấu bảo vệ nội bộ trong văn bản được chọn, không được thay đổi.',
    level: { minimal: 'Chỉnh sửa tối thiểu: chỉ sửa các lỗi rõ ràng và giữ nguyên cú pháp, từ ngữ hợp lệ.', moderate: 'Chỉnh sửa vừa phải: cải thiện cách diễn đạt và cấu trúc cục bộ mà không thay đổi ý tưởng hay trình tự lập luận thiết yếu.', deep: 'Chỉnh sửa sâu: được phép tổ chức lại cách diễn đạt, nhưng không được thay đổi ý tưởng, dữ liệu, tài liệu tham khảo, ý định hay độ mạnh của khẳng định.' },
    length: { similar: 'Giữ độ dài tương đương nguyên bản.', shorter: 'Rút gọn văn bản mà không bỏ sót bất kỳ ý tưởng, dữ liệu, tài liệu tham khảo hay sắc thái cần thiết nào.', develop: 'Chỉ triển khai những mối liên hệ vốn đã hàm ý trong nguyên bản. Không thêm thông tin, ví dụ hay lập luận.' },
  },
  ja: {
    role: 'あなたは Nodus 学習Vaultのテキストエディターです。', mustReturn: '置換後のテキストのみを返してください。前置き、説明、ラベル、囲みブロックは付けないでください。', preserve: '有効な Markdown と、変更が不要な構造をすべて保持してください。見出し、リスト、表、リンク、ノート、引用、参考文献、コード、数式が含まれます。', noInvent: '出典を捏造したり、原文が主張していないことを事実として提示したりしないでください。', faithful: '忠実モード：意味、アイデア、データ、参考文献、意図、認識論的な強さを保持してください。情報、論証、例、引用、新しい主張を追加してはいけません。', free: '自由変換モード：創造的な変更は許可されていますが、保護マーカーは保持し、引用やデータを捏造しないでください。', styleHeader: 'スタイル設定（上記のルールに従属します）：', rulesHeader: '譲歩できないルール：', conflictInstruction: 'スタイル指示がこれらのルールと矛盾する場合は、その部分だけを無視してください。', sameOriginal: '原文と同じ', outputLanguage: '出力言語', selectionHeader: '選択したテキスト：', scopeLabel: '範囲', protectedMarker: '選択したテキスト内の各内部保護マーカーを、変更せずに正確に一度だけ保持してください。',
    level: { minimal: '最小限の編集：明白な問題だけを修正し、有効な構文と語彙を保持してください。', moderate: '中程度の編集：アイデアや本質的な論証の順序を変えずに、表現と局所的な構造を改善してください。', deep: '深い編集：表現は再構成してかまいませんが、アイデア、データ、参考文献、意図、主張の強さは変えないでください。' },
    length: { similar: '原文と同程度の長さを保ってください。', shorter: '必要なアイデア、データ、参考文献、ニュアンスを省略せずにテキストを短くしてください。', develop: '原文にすでに暗黙的に含まれる関係だけを展開してください。情報、例、論証を追加しないでください。' },
  },
  ru: {
    role: 'Вы — редактор текста учебного хранилища Nodus.', mustReturn: 'Возвращайте только текст замены, без вступлений, пояснений, меток и обрамляющих блоков.', preserve: 'Сохраняйте корректный Markdown и структуру, которую не нужно менять: заголовки, списки, таблицы, ссылки, заметки, цитаты, библиографию, код и формулы.', noInvent: 'Не выдумывайте источники и не выдавайте за истину то, чего нет в оригинале.', faithful: 'РЕЖИМ ТОЧНОГО СООТВЕТСТВИЯ: сохраняйте смысл, идеи, данные, ссылки, замысел и эпистемическую силу. Запрещено добавлять информацию, аргументы, примеры, цитаты или новые утверждения.', free: 'РЕЖИМ СВОБОДНОГО ПРЕОБРАЗОВАНИЯ: творческие изменения разрешены, но сохраняйте защищённые маркеры и никогда не выдумывайте цитаты или данные.', styleHeader: 'СТИЛЕВЫЕ ПРЕДПОЧТЕНИЯ (подчинены правилам выше):', rulesHeader: 'НЕПРЕЛОЖНЫЕ ПРАВИЛА:', conflictInstruction: 'Если стилевая инструкция противоречит этим правилам, игнорируйте только эту часть.', sameOriginal: 'такой же, как в оригинале', outputLanguage: 'Язык вывода', selectionHeader: 'ВЫДЕЛЕННЫЙ ТЕКСТ:', scopeLabel: 'Область', protectedMarker: 'Сохраняйте каждый внутренний защитный маркер в выделенном тексте ровно один раз и без изменений.',
    level: { minimal: 'Минимальное редактирование: исправляйте только очевидные проблемы и сохраняйте корректный синтаксис и лексику.', moderate: 'Умеренное редактирование: улучшайте формулировки и локальную структуру, не меняя идеи и основной порядок аргументации.', deep: 'Глубокое редактирование: можно перестраивать изложение, но не идеи, данные, ссылки, замысел или силу утверждений.' },
    length: { similar: 'Сохраняйте длину, близкую к оригиналу.', shorter: 'Сокращайте текст, не опуская ни одной необходимой идеи, данных, ссылки или оттенка смысла.', develop: 'Развивайте только те связи, которые уже подразумеваются в оригинале. Не добавляйте информацию, примеры или аргументы.' },
  },
  uk: {
    role: 'Ви — редактор тексту навчального сховища Nodus.', mustReturn: 'Повертайте лише текст заміни, без вступів, пояснень, міток і обрамлювальних блоків.', preserve: 'Зберігайте коректний Markdown і структуру, яку не потрібно змінювати: заголовки, списки, таблиці, посилання, нотатки, цитати, бібліографію, код і формули.', noInvent: 'Не вигадуйте джерела й не подавайте як істину те, чого немає в оригіналі.', faithful: 'РЕЖИМ ТОЧНОЇ ВІДПОВІДНОСТІ: зберігайте зміст, ідеї, дані, посилання, задум і епістемічну силу. Заборонено додавати інформацію, аргументи, приклади, цитати чи нові твердження.', free: 'РЕЖИМ ВІЛЬНОГО ПЕРЕТВОРЕННЯ: творчі зміни дозволено, але зберігайте захищені маркери й ніколи не вигадуйте цитати чи дані.', styleHeader: 'СТИЛЬОВІ ПРЕФЕРЕНЦІЇ (підпорядковані наведеним вище правилам):', rulesHeader: 'НЕПОРУШНІ ПРАВИЛА:', conflictInstruction: 'Якщо стильова інструкція суперечить цим правилам, ігноруйте лише цю частину.', sameOriginal: 'такий самий, як в оригіналі', outputLanguage: 'Мова виводу', selectionHeader: 'ВИДІЛЕНИЙ ТЕКСТ:', scopeLabel: 'Обсяг', protectedMarker: 'Зберігайте кожен внутрішній захисний маркер у виділеному тексті рівно один раз і без змін.',
    level: { minimal: 'Мінімальне редагування: виправляйте лише очевидні проблеми та зберігайте коректний синтаксис і лексику.', moderate: 'Помірне редагування: покращуйте формулювання й локальну структуру, не змінюючи ідеї та основний порядок аргументації.', deep: 'Глибоке редагування: можна перебудовувати виклад, але не ідеї, дані, посилання, задум чи силу тверджень.' },
    length: { similar: 'Зберігайте довжину, близьку до оригіналу.', shorter: 'Скорочуйте текст, не пропускаючи жодної необхідної ідеї, даних, посилання чи відтінку змісту.', develop: 'Розвивайте лише ті зв’язки, які вже маються на увазі в оригіналі. Не додавайте інформацію, приклади чи аргументи.' },
  },
  ko: {
    role: '당신은 Nodus 학습 보관소의 텍스트 편집자입니다.', mustReturn: '교체 텍스트만 반환하고 서론, 설명, 레이블, 감싸는 블록은 넣지 마십시오.', preserve: '유효한 Markdown과 변경할 필요가 없는 구조를 유지하십시오. 제목, 목록, 표, 링크, 노트, 인용, 참고문헌, 코드, 수식이 포함됩니다.', noInvent: '출처를 지어내거나 원문이 주장하지 않은 내용을 사실로 제시하지 마십시오.', faithful: '충실 모드: 의미, 아이디어, 데이터, 참고문헌, 의도, 인식론적 강도를 보존하십시오. 정보, 논증, 예시, 인용 또는 새로운 주장을 추가해서는 안 됩니다.', free: '자유 변환 모드: 창의적 변경이 허용되었으나 보호 표시를 유지하고 인용이나 데이터를 지어내지 마십시오.', styleHeader: '스타일 기본 설정(위 규칙에 종속됨):', rulesHeader: '양보할 수 없는 규칙:', conflictInstruction: '스타일 지침이 이 규칙과 충돌하면 해당 부분만 무시하십시오.', sameOriginal: '원문과 동일', outputLanguage: '출력 언어', selectionHeader: '선택한 텍스트:', scopeLabel: '범위', protectedMarker: '선택한 텍스트의 모든 내부 보호 표시를 변경하지 않고 정확히 한 번씩 유지하십시오.',
    level: { minimal: '최소 편집: 명확한 문제만 수정하고 유효한 구문과 어휘를 유지하십시오.', moderate: '보통 편집: 아이디어나 핵심 논증 순서를 바꾸지 않고 표현과 국부적 구조를 개선하십시오.', deep: '심화 편집: 표현은 재구성할 수 있으나 아이디어, 데이터, 참고문헌, 의도, 주장의 강도는 바꾸지 마십시오.' },
    length: { similar: '원문과 비슷한 길이를 유지하십시오.', shorter: '필요한 아이디어, 데이터, 참고문헌, 뉘앙스를 빠뜨리지 않고 텍스트를 줄이십시오.', develop: '원문에 이미 암시된 관계만 발전시키십시오. 정보, 예시 또는 논증을 추가하지 마십시오.' },
  },
};

export function studyImprovePromptPack(language: PromptLanguage = 'es'): StudyImprovePromptPack {
  return STUDY_IMPROVE_PROMPT_PACKS[language] ?? STUDY_IMPROVE_PROMPT_PACKS.en;
}

/** Localises built-in style instructions while leaving user-authored custom styles untouched. */
const BUILTIN_STYLE_INSTRUCTIONS: Record<PromptLanguage, Partial<Record<StudyImprovePresetId, string>>> = {
  es: {},
  en: { academic: 'Rewrite the selected text in an academic register with conceptual precision and explicit transitions.', formal: 'Raise the register and formal correctness of the selected text.', clear: 'Make the selected text clearer and easier to follow without simplifying its ideas.', concise: 'Condense the selected text and remove redundancies without losing any idea or data.', developed: 'Develop implicit connections in the selected text using only information it already contains.', outline: 'Organise the selected text as a hierarchical Markdown outline, preserving every idea and datum.', proofread: 'Correct only spelling, grammar, and punctuation in the selected text.', cohesion: 'Improve cohesion and internal transitions in the selected text.', neutral: 'Neutralise evaluative language in the selected text without changing claims or epistemic strength.', popular: 'Adapt the selected text for a general audience without losing precision or adding examples.', 'adapt-level': 'Adapt the selected text to level {{academicLevel}} while retaining all ideas, data, and nuances.', summary: 'Summarise the selected text while retaining its theses, concepts, and essential data.', notes: 'Turn the selected text into clear, hierarchical Markdown study notes without omitting ideas or adding content.' },
  fr: { academic: 'Réécris le texte sélectionné dans un registre académique, avec précision conceptuelle et transitions explicites.', formal: 'Élève le registre et la correction formelle du texte sélectionné.', clear: 'Rends le texte sélectionné plus clair et plus facile à suivre sans simplifier ses idées.', concise: 'Condense le texte sélectionné et supprime les redondances sans perdre d’idée ni de donnée.', developed: 'Développe les liens implicites en utilisant uniquement les informations déjà présentes.', outline: 'Organise le texte en plan Markdown hiérarchique en conservant toutes les idées et données.', proofread: 'Corrige uniquement l’orthographe, la grammaire et la ponctuation du texte sélectionné.', cohesion: 'Améliore la cohésion et les transitions internes du texte sélectionné.', neutral: 'Neutralise le langage évaluatif sans modifier les affirmations ni leur force épistémique.', popular: 'Adapte le texte à un public général sans perdre en précision ni ajouter d’exemples.', 'adapt-level': 'Adapte le texte au niveau {{academicLevel}} en conservant idées, données et nuances.', summary: 'Résume le texte en conservant ses thèses, concepts et données essentielles.', notes: 'Transforme le texte en notes Markdown claires et hiérarchisées sans omettre ni ajouter de contenu.' },
  de: { academic: 'Schreibe den ausgewählten Text mit akademischem Register, begrifflicher Präzision und expliziten Übergängen um.', formal: 'Hebe Register und formale Korrektheit des ausgewählten Textes an.', clear: 'Mache den ausgewählten Text klarer und leichter nachvollziehbar, ohne seine Ideen zu vereinfachen.', concise: 'Verdichte den ausgewählten Text und entferne Wiederholungen, ohne Ideen oder Daten zu verlieren.', developed: 'Entwickle implizite Verbindungen ausschließlich mit bereits enthaltenen Informationen.', outline: 'Ordne den Text als hierarchische Markdown-Gliederung und bewahre alle Ideen und Daten.', proofread: 'Korrigiere ausschließlich Rechtschreibung, Grammatik und Zeichensetzung.', cohesion: 'Verbessere Kohärenz und interne Übergänge des ausgewählten Textes.', neutral: 'Neutralisiere wertende Sprache, ohne Aussagen oder epistemische Stärke zu ändern.', popular: 'Passe den Text für ein allgemeines Publikum an, ohne Präzision zu verlieren oder Beispiele hinzuzufügen.', 'adapt-level': 'Passe den Text an die Stufe {{academicLevel}} an und bewahre alle Ideen, Daten und Nuancen.', summary: 'Fasse den Text zusammen und bewahre Thesen, Begriffe und wesentliche Daten.', notes: 'Wandle den Text in klare, hierarchische Markdown-Lernnotizen um, ohne Inhalte auszulassen oder hinzuzufügen.' },
  pt: { academic: 'Reescreve o texto selecionado num registo académico, com precisão conceptual e transições explícitas.', formal: 'Eleva o registo e a correção formal do texto selecionado.', clear: 'Torna o texto selecionado mais claro e fácil de seguir sem simplificar as ideias.', concise: 'Condensa o texto selecionado e elimina redundâncias sem perder ideias ou dados.', developed: 'Desenvolve ligações implícitas usando apenas informação já presente.', outline: 'Organiza o texto como esquema Markdown hierárquico, preservando todas as ideias e dados.', proofread: 'Corrige apenas ortografia, gramática e pontuação.', cohesion: 'Melhora a coesão e as transições internas do texto.', neutral: 'Neutraliza linguagem avaliativa sem alterar afirmações ou força epistémica.', popular: 'Adapta o texto a um público geral sem perder precisão nem acrescentar exemplos.', 'adapt-level': 'Adapta o texto ao nível {{academicLevel}}, mantendo ideias, dados e nuances.', summary: 'Resume o texto mantendo teses, conceitos e dados essenciais.', notes: 'Converte o texto em apontamentos Markdown claros e hierárquicos sem omitir nem acrescentar conteúdo.' },
  'pt-BR': { academic: 'Reescreva o texto selecionado em registro acadêmico, com precisão conceitual e transições explícitas.', formal: 'Eleve o registro e a correção formal do texto selecionado.', clear: 'Deixe o texto selecionado mais claro e fácil de acompanhar sem simplificar as ideias.', concise: 'Condense o texto e elimine redundâncias sem perder ideias ou dados.', developed: 'Desenvolva conexões implícitas usando apenas informações já presentes.', outline: 'Organize o texto como esquema Markdown hierárquico, preservando todas as ideias e dados.', proofread: 'Corrija somente ortografia, gramática e pontuação.', cohesion: 'Melhore a coesão e as transições internas do texto.', neutral: 'Neutralize linguagem avaliativa sem alterar afirmações ou força epistêmica.', popular: 'Adapte o texto ao público geral sem perder precisão nem acrescentar exemplos.', 'adapt-level': 'Adapte o texto ao nível {{academicLevel}}, mantendo ideias, dados e nuances.', summary: 'Resuma o texto mantendo teses, conceitos e dados essenciais.', notes: 'Converta o texto em anotações Markdown claras e hierárquicas sem omitir nem acrescentar conteúdo.' },
  it: { academic: 'Riscrivi il testo selezionato con registro accademico, precisione concettuale e transizioni esplicite.', formal: 'Eleva il registro e la correttezza formale del testo selezionato.', clear: 'Rendi il testo più chiaro e facile da seguire senza semplificarne le idee.', concise: 'Condensa il testo ed elimina ridondanze senza perdere idee o dati.', developed: 'Sviluppa i collegamenti impliciti usando solo informazioni già presenti.', outline: 'Organizza il testo in una scaletta Markdown gerarchica preservando idee e dati.', proofread: 'Correggi solo ortografia, grammatica e punteggiatura.', cohesion: 'Migliora coesione e transizioni interne del testo.', neutral: 'Neutralizza il linguaggio valutativo senza modificare affermazioni o forza epistemica.', popular: 'Adatta il testo a un pubblico generale senza perdere precisione né aggiungere esempi.', 'adapt-level': 'Adatta il testo al livello {{academicLevel}} mantenendo idee, dati e sfumature.', summary: 'Riassumi il testo conservando tesi, concetti e dati essenziali.', notes: 'Trasforma il testo in appunti Markdown chiari e gerarchici senza omettere o aggiungere contenuti.' },
  tr: { academic: 'Seçilen metni kavramsal kesinlik ve açık geçişlerle akademik üslupla yeniden yaz.', formal: 'Seçilen metnin üslup düzeyini ve biçimsel doğruluğunu yükselt.', clear: 'Fikirleri basitleştirmeden seçilen metni daha açık ve kolay izlenir hâle getir.', concise: 'Hiçbir fikri veya veriyi kaybetmeden metni yoğunlaştır ve tekrarları kaldır.', developed: 'Örtük bağlantıları yalnızca metinde zaten bulunan bilgilerle geliştir.', outline: 'Metni tüm fikir ve verileri koruyarak hiyerarşik Markdown taslağına dönüştür.', proofread: 'Yalnızca yazım, dil bilgisi ve noktalama hatalarını düzelt.', cohesion: 'Metnin bütünlüğünü ve iç geçişlerini geliştir.', neutral: 'İddiaları veya epistemik gücü değiştirmeden değerlendirici dili nötrleştir.', popular: 'Metni kesinliği kaybetmeden ve yeni örnek eklemeden genel kitleye uyarla.', 'adapt-level': 'Tüm fikir, veri ve nüansları koruyarak metni {{academicLevel}} düzeyine uyarla.', summary: 'Tezleri, kavramları ve temel verileri koruyarak metni özetle.', notes: 'Metni fikirleri atlamadan veya içerik eklemeden açık, hiyerarşik Markdown çalışma notlarına dönüştür.' },
  'zh-Hans': { academic: '以学术语体重写选中文本，做到概念精确、过渡明确。', formal: '提升选中文本的语体正式程度和形式正确性。', clear: '让选中文本更清晰易懂，但不简化其中的观点。', concise: '精简选中文本并删除冗余，不丢失任何观点或数据。', developed: '仅使用选中文本已有的信息，展开其中的隐含联系。', outline: '将选中文本整理为层级式 Markdown 大纲，保留每一个观点和数据。', proofread: '只修正选中文本中的拼写、语法和标点。', cohesion: '改善选中文本的连贯性和内部过渡。', neutral: '在不改变主张或认识论强度的前提下，消除选中文本中的评价性语言。', popular: '将选中文本改编为面向大众的表达，不损失精确性，也不添加例子。', 'adapt-level': '将选中文本调整到 {{academicLevel}} 水平，同时保留所有观点、数据和细微差别。', summary: '概括选中文本，保留其论点、概念和关键数据。', notes: '将选中文本转化为清晰、层级分明的 Markdown 学习笔记，不遗漏观点，也不添加内容。' },
  'zh-Hant': { academic: '以學術語體改寫選取的文字，做到概念精確、過渡明確。', formal: '提升選取文字的語體正式程度與形式正確性。', clear: '讓選取的文字更清晰易懂，但不簡化其中的觀點。', concise: '精簡選取的文字並刪除冗餘，不遺漏任何觀點或資料。', developed: '僅使用選取文字既有的資訊，開展其中的隱含關聯。', outline: '將選取的文字整理為階層式 Markdown 大綱，保留每一個觀點與資料。', proofread: '只修正選取文字中的拼字、文法與標點。', cohesion: '改善選取文字的連貫性與內部過渡。', neutral: '在不改變主張或認識論強度的前提下，消除選取文字中的評價性語言。', popular: '將選取的文字改寫為面向大眾的表達，不損失精確性，也不添加範例。', 'adapt-level': '將選取的文字調整至 {{academicLevel}} 程度，同時保留所有觀點、資料與細微差異。', summary: '概述選取的文字，保留其論點、概念與關鍵資料。', notes: '將選取的文字轉化為清晰、階層分明的 Markdown 學習筆記，不遺漏觀點，也不添加內容。' },
  vi: { academic: 'Viết lại văn bản được chọn theo văn phong học thuật, với độ chính xác khái niệm và chuyển ý rõ ràng.', formal: 'Nâng cao mức trang trọng và độ chuẩn mực hình thức của văn bản được chọn.', clear: 'Làm cho văn bản được chọn rõ ràng và dễ theo dõi hơn mà không đơn giản hóa các ý tưởng.', concise: 'Cô đọng văn bản được chọn và loại bỏ phần dư thừa mà không làm mất bất kỳ ý tưởng hay dữ liệu nào.', developed: 'Triển khai các mối liên hệ hàm ẩn trong văn bản được chọn, chỉ dùng thông tin văn bản đã có.', outline: 'Sắp xếp văn bản được chọn thành dàn ý Markdown phân cấp, giữ nguyên mọi ý tưởng và dữ liệu.', proofread: 'Chỉ sửa lỗi chính tả, ngữ pháp và dấu câu trong văn bản được chọn.', cohesion: 'Cải thiện tính liên kết và chuyển ý nội bộ trong văn bản được chọn.', neutral: 'Trung hòa ngôn ngữ đánh giá trong văn bản được chọn mà không thay đổi khẳng định hay độ mạnh nhận thức luận.', popular: 'Chuyển văn bản được chọn sang cách diễn đạt cho độc giả phổ thông mà không mất độ chính xác hay thêm ví dụ.', 'adapt-level': 'Điều chỉnh văn bản được chọn theo trình độ {{academicLevel}} đồng thời giữ lại mọi ý tưởng, dữ liệu và sắc thái.', summary: 'Tóm tắt văn bản được chọn, giữ lại luận điểm, khái niệm và dữ liệu thiết yếu.', notes: 'Chuyển văn bản được chọn thành ghi chú học tập Markdown rõ ràng, phân cấp, không bỏ sót ý tưởng hay thêm nội dung.' },
  ja: { academic: '選択したテキストを、概念的な正確さと明示的なつながりを備えた学術的な文体で書き直してください。', formal: '選択したテキストの文体の格と形式上の正確さを高めてください。', clear: 'アイデアを単純化せずに、選択したテキストをより明確で追いやすくしてください。', concise: 'アイデアやデータを失うことなく、選択したテキストを凝縮し冗長さを取り除いてください。', developed: '選択したテキストにもともと含まれている情報だけを使い、暗黙のつながりを展開してください。', outline: '選択したテキストを階層的な Markdown アウトラインとして整理し、すべてのアイデアとデータを保持してください。', proofread: '選択したテキストの綴り、文法、句読点だけを修正してください。', cohesion: '選択したテキストの結束性と内部のつながりを改善してください。', neutral: '主張や認識論的な強さを変えずに、選択したテキストの評価的な表現を中立化してください。', popular: '正確さを損なわず、例を追加することなく、選択したテキストを一般読者向けに適応させてください。', 'adapt-level': 'すべてのアイデア、データ、ニュアンスを保ちながら、選択したテキストを {{academicLevel}} レベルに適応させてください。', summary: '選択したテキストの主張、概念、本質的なデータを保持して要約してください。', notes: 'アイデアを省略したり内容を追加したりせずに、選択したテキストを明確で階層的な Markdown 学習ノートに変換してください。' },
  ru: { academic: 'Перепишите выделенный текст в академическом стиле с концептуальной точностью и явными переходами.', formal: 'Повысьте стилистический уровень и формальную корректность выделенного текста.', clear: 'Сделайте выделенный текст яснее и легче для восприятия, не упрощая его идеи.', concise: 'Сожмите выделенный текст и уберите повторы, не теряя ни одной идеи или данных.', developed: 'Развивайте неявные связи, используя только уже содержащуюся в тексте информацию.', outline: 'Оформите выделенный текст как иерархический план в Markdown, сохранив каждую идею и данные.', proofread: 'Исправляйте только орфографию, грамматику и пунктуацию в выделенном тексте.', cohesion: 'Улучшите связность и внутренние переходы выделенного текста.', neutral: 'Нейтрализуйте оценочную лексику, не меняя утверждения и их эпистемическую силу.', popular: 'Адаптируйте выделенный текст для широкой аудитории, не теряя точности и не добавляя примеров.', 'adapt-level': 'Адаптируйте выделенный текст к уровню {{academicLevel}}, сохранив все идеи, данные и нюансы.', summary: 'Обобщите выделенный текст, сохранив его тезисы, понятия и ключевые данные.', notes: 'Превратите выделенный текст в ясные иерархические учебные заметки в Markdown, не опуская идеи и не добавляя нового содержания.' },
  uk: { academic: 'Перепишіть виділений текст в академічному стилі з концептуальною точністю та явними переходами.', formal: 'Підвищте стилістичний рівень і формальну правильність виділеного тексту.', clear: 'Зробіть виділений текст зрозумілішим і летшим для сприйняття, не спрощуючи його ідеї.', concise: 'Ущільніть виділений текст і приберіть повторення, не втрачаючи жодної ідеї чи даних.', developed: 'Розвивайте неявні зв’язки, використовуючи лише ту інформацію, яка вже є в тексті.', outline: 'Оформіть виділений текст як ієрархічний план у Markdown, зберігши кожну ідею та дані.', proofread: 'Виправляйте лише правопис, граматику й пунктуацію у виділеному тексті.', cohesion: 'Покращте зв’язність і внутрішні переходи виділеного тексту.', neutral: 'Нейтралізуйте оцінну лексику, не змінюючи твердження та їхню епістемічну силу.', popular: 'Адаптуйте виділений текст для широкої аудиторії, не втрачаючи точності й не додаючи прикладів.', 'adapt-level': 'Адаптуйте виділений текст до рівня {{academicLevel}}, зберігши всі ідеї, дані та нюанси.', summary: 'Узагальніть виділений текст, зберігши його тези, поняття та ключові дані.', notes: 'Перетворіть виділений текст на чіткі ієрархічні навчальні нотатки в Markdown, не пропускаючи ідеї та не додаючи нового змісту.' },
  ko: { academic: '선택한 텍스트를 개념적 정확성과 명시적 전환을 갖춘 학술적 문체로 다시 쓰십시오.', formal: '선택한 텍스트의 문체 수준과 형식적 정확성을 높이십시오.', clear: '아이디어를 단순화하지 않으면서 선택한 텍스트를 더 명확하고 따라가기 쉽게 만드십시오.', concise: '어떤 아이디어나 데이터도 잃지 않고 선택한 텍스트를 압축하고 중복을 제거하십시오.', developed: '선택한 텍스트에 이미 담긴 정보만 사용하여 암시된 연결을 발전시키십시오.', outline: '모든 아이디어와 데이터를 보존하면서 선택한 텍스트를 계층적 Markdown 개요로 구성하십시오.', proofread: '선택한 텍스트의 맞춤법, 문법, 문장 부호만 수정하십시오.', cohesion: '선택한 텍스트의 응집성과 내부 전환을 개선하십시오.', neutral: '주장이나 인식론적 강도를 바꾸지 않고 선택한 텍스트의 평가적 언어를 중립화하십시오.', popular: '정확성을 잃거나 예시를 추가하지 않으면서 선택한 텍스트를 일반 독자에 맞게 조정하십시오.', 'adapt-level': '모든 아이디어, 데이터, 뉘앙스를 유지하면서 선택한 텍스트를 {{academicLevel}} 수준에 맞게 조정하십시오.', summary: '논지, 개념, 핵심 데이터를 유지하면서 선택한 텍스트를 요약하십시오.', notes: '아이디어를 빠뜨리거나 내용을 추가하지 않고 선택한 텍스트를 명확하고 계층적인 Markdown 학습 노트로 바꾸십시오.' },
};

export function localizedStudyStyleInstruction(style: StudyStyle, language: PromptLanguage): string {
  if (style.builtIn) return BUILTIN_STYLE_INSTRUCTIONS[language]?.[style.id.replace('builtin:', '') as StudyImprovePresetId] ?? style.prompt;
  return style.prompt;
}

export type StudyProtectedSpanKind =
  | 'code'
  | 'formula'
  | 'link'
  | 'citation'
  | 'quote'
  | 'number'
  | 'term';

export interface StudyProtectedSpan {
  placeholder: string;
  value: string;
  kind: StudyProtectedSpanKind;
  from: number;
  to: number;
}

export interface StudyProtectedText {
  text: string;
  spans: StudyProtectedSpan[];
}

export interface StudyImproveRequest {
  /**
   * Qué se está mejorando. El editor es el mismo en Estudio, Docencia y el Workspace,
   * así que la mejora puede recaer sobre un documento de estudio o sobre una nota; el
   * registro guarda una procedencia u otra, nunca las dos ni ninguna.
   */
  documentId?: string | null;
  noteId?: string | null;
  subjectId?: string | null;
  text: string;
  styleId: string;
  /** Extra instructions for this proposal; never updates the saved style. */
  additionalInstructions?: string;
  scope: StudyImproveScope;
  level: StudyImproveLevel;
  length: StudyImproveLength;
  mode: StudyImproveMode;
  /** Language used for the AI instruction pack; user text is never translated. */
  promptLanguage?: PromptLanguage;
  variables?: StudyImproveVariables;
  protectedTerms?: string[];
  model?: { provider: string; model: string } | null;
}

export interface StudyImproveResult {
  logId: string;
  text: string;
  warnings: string[];
  styleId: string;
  modelProvider: string;
  modelName: string;
  originalHash: string;
  resultHash: string;
  protectedSpanCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface StudyImproveStreamHandlers {
  onDelta: (delta: string) => void;
}

export interface StudyImprovementLog {
  id: string;
  documentId: string | null;
  noteId: string | null;
  styleId: string;
  scope: StudyImproveScope;
  mode: StudyImproveMode;
  level: StudyImproveLevel;
  length: StudyImproveLength;
  modelProvider: string;
  modelName: string;
  originalHash: string;
  resultHash: string;
  originalChars: number;
  resultChars: number;
  warnings: string[];
  action: 'replace' | 'insert_below' | 'rejected' | 'generated';
  createdAt: string;
}

export interface StudyStyleExport {
  format: 'nodus-study-styles';
  version: 1;
  exportedAt: string;
  styles: StudyStyleInput[];
}

const presets: Array<StudyStyleConfig & { id: StudyImprovePresetId }> = [
  { id: 'academic', name: 'Académico', icon: 'graduation', color: '#0f766e', category: 'academic', description: 'Registro académico preciso y argumentación ordenada.', prompt: 'Reescribe el texto seleccionado con registro académico, precisión conceptual y transiciones explícitas.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.25, maxOutputTokens: 2400, creativity: 0.15, locked: true },
  { id: 'formal', name: 'Formal', icon: 'edit', color: '#334155', category: 'academic', description: 'Tono formal sin volver el texto artificial.', prompt: 'Eleva el registro y la corrección formal del texto seleccionado.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2200, creativity: 0.1, locked: true },
  { id: 'clear', name: 'Claro', icon: 'bulb', color: '#0284c7', category: 'clarity', description: 'Aclara frases densas y ambigüedades.', prompt: 'Haz el texto seleccionado más claro y fácil de seguir sin simplificar sus ideas.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2200, creativity: 0.1, locked: true },
  { id: 'concise', name: 'Conciso', icon: 'scissors', color: '#7c3aed', category: 'clarity', description: 'Elimina redundancias conservando contenido.', prompt: 'Condensa el texto seleccionado y elimina redundancias sin perder ninguna idea o dato.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'shorter', modelProvider: null, modelName: null, temperature: 0.15, maxOutputTokens: 1800, creativity: 0.05, locked: true },
  { id: 'developed', name: 'Desarrollado', icon: 'network', color: '#15803d', category: 'academic', description: 'Explicita conexiones ya presentes, sin aportar información nueva.', prompt: 'Desarrolla las conexiones implícitas del texto seleccionado usando exclusivamente la información que ya contiene.', systemPrompt: '', language: 'auto', level: 'deep', length: 'develop', modelProvider: null, modelName: null, temperature: 0.25, maxOutputTokens: 3200, creativity: 0.15, locked: true },
  { id: 'outline', name: 'Esquemático', icon: 'list', color: '#475569', category: 'structure', description: 'Convierte el contenido en una estructura jerárquica.', prompt: 'Organiza el texto seleccionado como esquema Markdown jerárquico, preservando todas sus ideas y datos.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.1, maxOutputTokens: 2400, creativity: 0.05, locked: true },
  { id: 'proofread', name: 'Ortografía', icon: 'check', color: '#059669', category: 'clarity', description: 'Corrige ortografía, gramática y puntuación.', prompt: 'Corrige únicamente ortografía, gramática y puntuación del texto seleccionado.', systemPrompt: '', language: 'auto', level: 'minimal', length: 'similar', modelProvider: null, modelName: null, temperature: 0, maxOutputTokens: 2200, creativity: 0, locked: true },
  { id: 'cohesion', name: 'Cohesión', icon: 'link', color: '#0369a1', category: 'structure', description: 'Mejora continuidad y transiciones.', prompt: 'Mejora la cohesión y las transiciones internas del texto seleccionado.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2200, creativity: 0.1, locked: true },
  { id: 'neutral', name: 'Neutralizar', icon: 'scale', color: '#64748b', category: 'academic', description: 'Reduce lenguaje valorativo no sustentado.', prompt: 'Neutraliza el tono valorativo del texto seleccionado sin alterar las afirmaciones ni su fuerza epistémica.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.15, maxOutputTokens: 2200, creativity: 0.05, locked: true },
  { id: 'popular', name: 'Divulgativo', icon: 'globe', color: '#ea580c', category: 'audience', description: 'Hace accesible el texto a público general.', prompt: 'Adapta el texto seleccionado para público general sin perder precisión ni añadir ejemplos nuevos.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.25, maxOutputTokens: 2400, creativity: 0.15, locked: true },
  { id: 'adapt-level', name: 'Adaptar nivel', icon: 'graduation', color: '#9333ea', category: 'audience', description: 'Ajusta el texto al nivel académico indicado.', prompt: 'Adapta el texto seleccionado al nivel {{academicLevel}} manteniendo todas las ideas, datos y matices.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2400, creativity: 0.1, locked: true },
  { id: 'summary', name: 'Resumen', icon: 'layers', color: '#be123c', category: 'structure', description: 'Resume sin introducir afirmaciones.', prompt: 'Resume el texto seleccionado conservando sus tesis, conceptos y datos esenciales.', systemPrompt: '', language: 'auto', level: 'deep', length: 'shorter', modelProvider: null, modelName: null, temperature: 0.1, maxOutputTokens: 1600, creativity: 0.05, locked: true },
  { id: 'notes', name: 'Apuntes', icon: 'notebook', color: '#0f766e', category: 'structure', description: 'Convierte prosa en apuntes de estudio.', prompt: 'Convierte el texto seleccionado en apuntes Markdown claros y jerárquicos sin omitir ideas ni añadir contenido.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.1, maxOutputTokens: 2400, creativity: 0.05, locked: true },
];

/**
 * Maps legacy preset emoji to the renderer-owned icon catalogue. Custom styles
 * created by older builds may still carry any Unicode glyph; callers must use
 * the returned name only when it exists in their icon catalogue and otherwise
 * fall back to `sparkles`. No editor toolbar renders the raw glyph.
 */
const LEGACY_STUDY_STYLE_ICONS: Readonly<Record<string, string>> = {
  '🎓': 'graduation', '✒️': 'edit', '💡': 'bulb', '✂️': 'scissors', '🌿': 'network',
  '☷': 'list', '✓': 'check', '🔗': 'link', '⚖️': 'scale', '📣': 'globe',
  '🪜': 'graduation', '🗜️': 'layers', '📝': 'notebook',
};

export function studyStyleIcon(value: string | null | undefined): string {
  const normalized = value?.trim() ?? '';
  return (LEGACY_STUDY_STYLE_ICONS[normalized] ?? normalized) || 'sparkles';
}

export const STUDY_IMPROVE_PRESETS: readonly StudyStyle[] = presets.map((preset, position) => ({
  ...preset,
  id: `builtin:${preset.id}`,
  shortId: `STYLE-${preset.id.toUpperCase()}`,
  builtIn: true,
  favorite: preset.id === 'academic' || preset.id === 'clear',
  active: true,
  position,
  archivedAt: null,
  createdAt: 'builtin',
  updatedAt: 'builtin',
}));

export const STUDY_STYLE_VARIABLES = [
  'subject', 'topic', 'academicLevel', 'language', 'documentType', 'targetLength', 'selectedText',
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function protectStudyText(source: string, terms: string[] = []): StudyProtectedText {
  const matches: Array<{ from: number; to: number; kind: StudyProtectedSpanKind }> = [];
  const add = (regex: RegExp, kind: StudyProtectedSpanKind) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source))) {
      if (match[0]) matches.push({ from: match.index, to: match.index + match[0].length, kind });
      if (!regex.global) break;
    }
  };

  add(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, 'code');
  add(/`[^`\n]+`/g, 'code');
  add(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+\$/g, 'formula');
  add(/\]\((?:[^()\\]|\\.|\([^)]*\))+\)/g, 'link');
  add(/\[(?:\d+[a-z]?|[^\]\n]+,\s*\d{4}[a-z]?(?:,\s*p{1,2}\.\s*\d+(?:[-–]\d+)?)?)\]/gi, 'citation');
  add(/\([^()\n]*\b\d{4}[a-z]?\b[^()\n]*\)/gi, 'citation');
  add(/[“”][^“”\n]+[“”]|«[^»\n]+»|"[^"\n]+"/g, 'quote');
  add(/\b(?:\d{1,4}(?:[./:-]\d{1,4})+|\d+(?:[.,]\d+)?%?|[IVXLCDM]+)\b/g, 'number');
  for (const term of terms.map((value) => value.trim()).filter(Boolean).sort((a, b) => b.length - a.length)) {
    add(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'giu'), 'term');
  }

  const priority: StudyProtectedSpanKind[] = ['code', 'formula', 'link', 'citation', 'quote', 'term', 'number'];
  const accepted: typeof matches = [];
  for (const candidate of matches.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind) || a.from - b.from || b.to - a.to)) {
    if (!accepted.some((span) => candidate.from < span.to && candidate.to > span.from)) accepted.push(candidate);
  }
  accepted.sort((a, b) => a.from - b.from);

  const spans: StudyProtectedSpan[] = accepted.map((span, index) => ({
    ...span,
    value: source.slice(span.from, span.to),
    placeholder: `⟦NODUS_PROTECTED_${String(index + 1).padStart(4, '0')}⟧`,
  }));
  let text = source;
  for (const span of [...spans].reverse()) text = `${text.slice(0, span.from)}${span.placeholder}${text.slice(span.to)}`;
  return { text, spans };
}

export function missingProtectedSpans(text: string, spans: StudyProtectedSpan[]): StudyProtectedSpan[] {
  const tolerantIndexes = new Set<number>();
  for (const match of text.matchAll(PROTECTED_PLACEHOLDER_RE)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index > 0) tolerantIndexes.add(index);
  }
  return spans.filter((span, index) => !text.includes(span.placeholder) && !tolerantIndexes.has(index + 1));
}

/**
 * Matches placeholders minted by `protectStudyText` plus the harmless formatting
 * variants that some models return (ASCII brackets, spaces, hyphens or changed
 * casing). The optional index also catches a generic `[NODUS PROTECTED]` ghost
 * so an internal implementation marker can never become document content.
 */
const PROTECTED_PLACEHOLDER_RE = /(?:⟦|\[)\s*NODUS[\s_-]+PROTECTED(?:[\s_-]*(\d+))?\s*(?:⟧|\])/giu;

/**
 * Placeholder→value lookups, cached per span list.
 *
 * Streaming calls this once per chunk with the same `spans` array, so building
 * the map inside the function would rebuild thousands of entries on every
 * token — which is quadratic again, just with a smaller constant.
 */
const lookupCache = new WeakMap<StudyProtectedSpan[], Map<string, string>>();

function placeholderLookup(spans: StudyProtectedSpan[]): Map<string, string> {
  const cached = lookupCache.get(spans);
  if (cached) return cached;
  const built = new Map(spans.map((span) => [span.placeholder, span.value]));
  lookupCache.set(spans, built);
  return built;
}

export function restoreProtectedSpans(text: string, spans: StudyProtectedSpan[]): string {
  // One pass over the text, not one pass per span.
  //
  // The previous `spans.reduce((acc, span) => acc.split(...).join(...))` walked
  // the whole string once for every protected span, so a document with 600
  // spans was scanned 600 times. During streaming that ran on the growing
  // prefix for every token, which measured 84s of blocked main process on a
  // 109k-character document.
  //
  // Replacing in a single pass also removes a subtle hazard: with the reduce,
  // a restored value containing something that looked like a later
  // placeholder would have been substituted again. Here each match is
  // replaced exactly once and the result is never re-scanned.
  const byPlaceholder = placeholderLookup(spans);
  return text.replace(PROTECTED_PLACEHOLDER_RE, (match, rawIndex: string | undefined) => {
    const exact = byPlaceholder.get(match);
    if (exact) return exact;
    const index = Number(rawIndex);
    if (Number.isInteger(index) && index > 0) return spans[index - 1]?.value ?? '';
    // A marker without an index cannot be mapped safely. It is always an
    // internal model artefact, never user-facing replacement text.
    return '';
  });
}

export function renderStudyStylePrompt(template: string, variables: StudyImproveVariables): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (token, key: keyof StudyImproveVariables) => {
    const value = variables[key];
    return value == null || value === '' ? token : String(value);
  });
}

interface StudyImproveRuntimeCopy {
  promptTooShort: string;
  promptTooLong: string;
  replacesSafetyRules: string;
  mayInventContent: string;
  unknownVariables: (variables: string[]) => string;
  emptyResult: string;
  missingNumbers: string;
  addedNumbers: string;
  alteredProtectedText: string;
  excessiveGrowth: string;
  freeTransformation: string;
}

const STUDY_IMPROVE_RUNTIME_COPY: Record<PromptLanguage, StudyImproveRuntimeCopy> = {
  es: {
    promptTooShort: 'El prompt es demasiado breve para controlar la transformación.', promptTooLong: 'El prompt supera 5.000 caracteres.', replacesSafetyRules: 'El prompt intenta sustituir las reglas de seguridad.', mayInventContent: 'El prompt puede generar información, citas o argumentos nuevos.', unknownVariables: (variables) => `Variables desconocidas: ${variables.join(', ')}.`, emptyResult: 'El modelo devolvió un resultado vacío.', missingNumbers: 'Faltan cifras presentes en el original.', addedNumbers: 'Aparecen cifras que no estaban en el original.', alteredProtectedText: 'Algún fragmento protegido fue alterado o eliminado.', excessiveGrowth: 'El resultado creció mucho; revisa posibles afirmaciones nuevas.', freeTransformation: 'Transformación libre: revisa los cambios de significado antes de aceptar.',
  },
  en: {
    promptTooShort: 'The prompt is too short to control the transformation.', promptTooLong: 'The prompt exceeds 5,000 characters.', replacesSafetyRules: 'The prompt attempts to replace the safety rules.', mayInventContent: 'The prompt may generate new information, citations, or arguments.', unknownVariables: (variables) => `Unknown variables: ${variables.join(', ')}.`, emptyResult: 'The model returned an empty result.', missingNumbers: 'Numbers present in the original are missing.', addedNumbers: 'Numbers not present in the original have appeared.', alteredProtectedText: 'Protected text was changed or removed.', excessiveGrowth: 'The result grew substantially; review it for possible new claims.', freeTransformation: 'Free transformation: review changes in meaning before accepting.',
  },
  fr: {
    promptTooShort: 'L’invite est trop courte pour contrôler la transformation.', promptTooLong: 'L’invite dépasse 5 000 caractères.', replacesSafetyRules: 'L’invite tente de remplacer les règles de sécurité.', mayInventContent: 'L’invite peut produire de nouvelles informations, citations ou argumentations.', unknownVariables: (variables) => `Variables inconnues : ${variables.join(', ')}.`, emptyResult: 'Le modèle a renvoyé un résultat vide.', missingNumbers: 'Des nombres présents dans l’original manquent.', addedNumbers: 'Des nombres absents de l’original sont apparus.', alteredProtectedText: 'Un fragment protégé a été modifié ou supprimé.', excessiveGrowth: 'Le résultat s’est beaucoup allongé ; vérifiez s’il contient de nouvelles affirmations.', freeTransformation: 'Transformation libre : vérifiez les changements de sens avant d’accepter.',
  },
  de: {
    promptTooShort: 'Der Prompt ist zu kurz, um die Umformung zu steuern.', promptTooLong: 'Der Prompt überschreitet 5.000 Zeichen.', replacesSafetyRules: 'Der Prompt versucht, die Sicherheitsregeln zu ersetzen.', mayInventContent: 'Der Prompt könnte neue Informationen, Zitate oder Argumente erzeugen.', unknownVariables: (variables) => `Unbekannte Variablen: ${variables.join(', ')}.`, emptyResult: 'Das Modell hat ein leeres Ergebnis zurückgegeben.', missingNumbers: 'Im Original enthaltene Zahlen fehlen.', addedNumbers: 'Es sind Zahlen hinzugekommen, die nicht im Original standen.', alteredProtectedText: 'Ein geschützter Textabschnitt wurde geändert oder entfernt.', excessiveGrowth: 'Das Ergebnis ist stark angewachsen; prüfen Sie es auf mögliche neue Behauptungen.', freeTransformation: 'Freie Umformung: Prüfen Sie Bedeutungsänderungen vor dem Übernehmen.',
  },
  pt: {
    promptTooShort: 'O prompt é demasiado curto para controlar a transformação.', promptTooLong: 'O prompt excede 5 000 caracteres.', replacesSafetyRules: 'O prompt tenta substituir as regras de segurança.', mayInventContent: 'O prompt pode gerar novas informações, citações ou argumentos.', unknownVariables: (variables) => `Variáveis desconhecidas: ${variables.join(', ')}.`, emptyResult: 'O modelo devolveu um resultado vazio.', missingNumbers: 'Faltam números presentes no original.', addedNumbers: 'Apareceram números que não constavam do original.', alteredProtectedText: 'Um fragmento protegido foi alterado ou eliminado.', excessiveGrowth: 'O resultado cresceu muito; reveja possíveis afirmações novas.', freeTransformation: 'Transformação livre: reveja as alterações de significado antes de aceitar.',
  },
  'pt-BR': {
    promptTooShort: 'O prompt é curto demais para controlar a transformação.', promptTooLong: 'O prompt excede 5.000 caracteres.', replacesSafetyRules: 'O prompt tenta substituir as regras de segurança.', mayInventContent: 'O prompt pode gerar novas informações, citações ou argumentos.', unknownVariables: (variables) => `Variáveis desconhecidas: ${variables.join(', ')}.`, emptyResult: 'O modelo retornou um resultado vazio.', missingNumbers: 'Faltam números presentes no original.', addedNumbers: 'Apareceram números que não estavam no original.', alteredProtectedText: 'Um trecho protegido foi alterado ou removido.', excessiveGrowth: 'O resultado cresceu muito; revise possíveis afirmações novas.', freeTransformation: 'Transformação livre: revise as mudanças de significado antes de aceitar.',
  },
  it: {
    promptTooShort: 'Il prompt è troppo breve per controllare la trasformazione.', promptTooLong: 'Il prompt supera i 5.000 caratteri.', replacesSafetyRules: 'Il prompt tenta di sostituire le regole di sicurezza.', mayInventContent: 'Il prompt può generare nuove informazioni, citazioni o argomentazioni.', unknownVariables: (variables) => `Variabili sconosciute: ${variables.join(', ')}.`, emptyResult: 'Il modello ha restituito un risultato vuoto.', missingNumbers: 'Mancano numeri presenti nell’originale.', addedNumbers: 'Sono comparsi numeri che non erano presenti nell’originale.', alteredProtectedText: 'Un frammento protetto è stato modificato o eliminato.', excessiveGrowth: 'Il risultato è cresciuto molto; verifica la presenza di possibili nuove affermazioni.', freeTransformation: 'Trasformazione libera: verifica i cambiamenti di significato prima di accettare.',
  },
  tr: {
    promptTooShort: 'İstem, dönüşümü denetlemek için çok kısa.', promptTooLong: 'İstem 5.000 karakteri aşıyor.', replacesSafetyRules: 'İstem güvenlik kurallarının yerini almaya çalışıyor.', mayInventContent: 'İstem yeni bilgi, alıntı veya argüman üretebilir.', unknownVariables: (variables) => `Bilinmeyen değişkenler: ${variables.join(', ')}.`, emptyResult: 'Model boş bir sonuç döndürdü.', missingNumbers: 'Özgün metinde bulunan bazı sayılar eksik.', addedNumbers: 'Özgün metinde bulunmayan sayılar ortaya çıktı.', alteredProtectedText: 'Korunan bir metin parçası değiştirildi veya silindi.', excessiveGrowth: 'Sonuç önemli ölçüde uzadı; olası yeni iddiaları gözden geçirin.', freeTransformation: 'Serbest dönüşüm: kabul etmeden önce anlam değişikliklerini gözden geçirin.',
  },
  'zh-Hans': {
    promptTooShort: '提示词过短，无法控制改写。', promptTooLong: '提示词超过 5,000 个字符。', replacesSafetyRules: '提示词试图替换安全规则。', mayInventContent: '提示词可能生成新的信息、引文或论点。', unknownVariables: (variables) => `未知变量：${variables.join(', ')}。`, emptyResult: '模型返回了空结果。', missingNumbers: '原文中的部分数字缺失。', addedNumbers: '出现了原文中没有的数字。', alteredProtectedText: '受保护的文本被更改或删除。', excessiveGrowth: '结果大幅增长；请检查是否出现了新的主张。', freeTransformation: '自由转换：接受前请检查语义变化。',
  },
  'zh-Hant': {
    promptTooShort: '提示詞過短，無法控制改寫。', promptTooLong: '提示詞超過 5,000 個字元。', replacesSafetyRules: '提示詞試圖取代安全規則。', mayInventContent: '提示詞可能產生新的資訊、引文或論點。', unknownVariables: (variables) => `未知變數：${variables.join(', ')}。`, emptyResult: '模型回傳了空結果。', missingNumbers: '原文中的部分數字缺失。', addedNumbers: '出現了原文中沒有的數字。', alteredProtectedText: '受保護的文字遭到變更或刪除。', excessiveGrowth: '結果大幅增加；請檢查是否出現新的主張。', freeTransformation: '自由轉換：接受前請檢查語意變化。',
  },
  vi: {
    promptTooShort: 'Câu lệnh quá ngắn để kiểm soát quá trình chuyển đổi.', promptTooLong: 'Câu lệnh vượt quá 5.000 ký tự.', replacesSafetyRules: 'Câu lệnh cố thay thế các quy tắc an toàn.', mayInventContent: 'Câu lệnh có thể tạo ra thông tin, trích dẫn hoặc lập luận mới.', unknownVariables: (variables) => `Biến không xác định: ${variables.join(', ')}.`, emptyResult: 'Mô hình trả về kết quả rỗng.', missingNumbers: 'Thiếu một số con số có trong nguyên bản.', addedNumbers: 'Xuất hiện những con số không có trong nguyên bản.', alteredProtectedText: 'Một đoạn được bảo vệ đã bị thay đổi hoặc xóa.', excessiveGrowth: 'Kết quả tăng trưởng đáng kể; hãy kiểm tra các khẳng định mới có thể có.', freeTransformation: 'Chuyển đổi tự do: hãy kiểm tra thay đổi về ý nghĩa trước khi chấp nhận.',
  },
  ja: {
    promptTooShort: 'プロンプトが短すぎて変換を制御できません。', promptTooLong: 'プロンプトが 5,000 文字を超えています。', replacesSafetyRules: 'プロンプトが安全ルールを置き換えようとしています。', mayInventContent: 'プロンプトが新しい情報、引用、論証を生成する可能性があります。', unknownVariables: (variables) => `不明な変数: ${variables.join(', ')}。`, emptyResult: 'モデルが空の結果を返しました。', missingNumbers: '原文に含まれる数値が一部欠けています。', addedNumbers: '原文にない数値が現れています。', alteredProtectedText: '保護されたテキストが変更または削除されました。', excessiveGrowth: '結果が大幅に増えました。新しい主張が含まれていないか確認してください。', freeTransformation: '自由変換: 受け入れる前に意味の変化を確認してください。',
  },
  ru: {
    promptTooShort: 'Запрос слишком короткий, чтобы контролировать преобразование.', promptTooLong: 'Запрос превышает 5 000 символов.', replacesSafetyRules: 'Запрос пытается заменить правила безопасности.', mayInventContent: 'Запрос может породить новую информацию, цитаты или аргументы.', unknownVariables: (variables) => `Неизвестные переменные: ${variables.join(', ')}.`, emptyResult: 'Модель вернула пустой результат.', missingNumbers: 'Отсутствуют числа, присутствовавшие в оригинале.', addedNumbers: 'Появились числа, которых не было в оригинале.', alteredProtectedText: 'Защищённый фрагмент был изменён или удалён.', excessiveGrowth: 'Результат значительно вырос; проверьте его на возможные новые утверждения.', freeTransformation: 'Свободное преобразование: проверьте изменения смысла перед принятием.',
  },
  uk: {
    promptTooShort: 'Запит закороткий, щоб контролювати перетворення.', promptTooLong: 'Запит перевищує 5 000 символів.', replacesSafetyRules: 'Запит намагається замінити правила безпеки.', mayInventContent: 'Запит може породжувати нову інформацію, цитати чи аргументи.', unknownVariables: (variables) => `Невідомі змінні: ${variables.join(', ')}.`, emptyResult: 'Модель повернула порожній результат.', missingNumbers: 'Відсутні числа, наявні в оригіналі.', addedNumbers: 'З’явилися числа, яких не було в оригіналі.', alteredProtectedText: 'Захищений фрагмент було змінено або видалено.', excessiveGrowth: 'Результат суттєво зріс; перевірте його на можливі нові твердження.', freeTransformation: 'Вільне перетворення: перевірте зміни значення перед прийняттям.',
  },
  ko: {
    promptTooShort: '프롬프트가 너무 짧아 변환을 제어할 수 없습니다.', promptTooLong: '프롬프트가 5,000자를 초과합니다.', replacesSafetyRules: '프롬프트가 안전 규칙을 대체하려고 합니다.', mayInventContent: '프롬프트가 새로운 정보, 인용 또는 논증을 생성할 수 있습니다.', unknownVariables: (variables) => `알 수 없는 변수: ${variables.join(', ')}.`, emptyResult: '모델이 빈 결과를 반환했습니다.', missingNumbers: '원문에 있던 일부 숫자가 누락되었습니다.', addedNumbers: '원문에 없던 숫자가 나타났습니다.', alteredProtectedText: '보호된 텍스트가 변경되거나 삭제되었습니다.', excessiveGrowth: '결과가 크게 늘어났습니다. 새로운 주장이 있는지 검토하십시오.', freeTransformation: '자유 변환: 수용하기 전에 의미 변화를 검토하십시오.',
  },
};

function studyImproveRuntimeCopy(language: PromptLanguage): StudyImproveRuntimeCopy {
  return STUDY_IMPROVE_RUNTIME_COPY[language] ?? STUDY_IMPROVE_RUNTIME_COPY.en;
}

export function validateStudyStylePrompt(prompt: string, language: PromptLanguage = 'es'): string[] {
  const copy = studyImproveRuntimeCopy(language);
  const warnings: string[] = [];
  const trimmed = prompt.trim();
  if (trimmed.length < 20) warnings.push(copy.promptTooShort);
  if (trimmed.length > 5000) warnings.push(copy.promptTooLong);
  if (/ignora\s+(?:las\s+)?instrucciones|ignore\s+(?:all\s+)?instructions/i.test(trimmed)) warnings.push(copy.replacesSafetyRules);
  if (/añad[ea]|invent[ea]|nuev[oa]s?\s+(?:datos|fuentes|citas|argumentos|ejemplos)|make up|new (?:claims|citations|facts)/i.test(trimmed)) warnings.push(copy.mayInventContent);
  const unknown = [...trimmed.matchAll(/\{\{\s*([^}]+)\s*\}\}/g)]
    .map((match) => match[1].trim())
    .filter((value) => !(STUDY_STYLE_VARIABLES as readonly string[]).includes(value));
  if (unknown.length) warnings.push(copy.unknownVariables([...new Set(unknown)]));
  return warnings;
}

export function studyImprovementWarnings(original: string, result: string, protectedSpans: StudyProtectedSpan[], mode: StudyImproveMode, language: PromptLanguage = 'es'): string[] {
  const copy = studyImproveRuntimeCopy(language);
  const warnings: string[] = [];
  if (!result.trim()) warnings.push(copy.emptyResult);
  const originalNumbers: string[] = [...(original.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [])];
  const resultNumbers: string[] = [...(result.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [])];
  if (originalNumbers.some((value) => !resultNumbers.includes(value))) warnings.push(copy.missingNumbers);
  if (mode === 'preserve' && resultNumbers.some((value) => !originalNumbers.includes(value))) warnings.push(copy.addedNumbers);
  if (protectedSpans.some((span) => !result.includes(span.value))) warnings.push(copy.alteredProtectedText);
  if (mode === 'preserve' && result.length > Math.max(240, original.length * 1.85)) warnings.push(copy.excessiveGrowth);
  return warnings;
}

export function studyFreeTransformationWarning(language: PromptLanguage = 'es'): string {
  return studyImproveRuntimeCopy(language).freeTransformation;
}

export function estimateStudyTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
