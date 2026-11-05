import type {PromptLanguage} from './types';
const VISUAL_CONTEXT_COPY: Record<PromptLanguage, { system: string; title: string; content: string }> = {
  es: { system: 'Describe una sola escena visual concreta que represente el contenido dado.\nMáximo 45 palabras. Solo la escena: sin títulos, texto visible, letras, logos ni explicaciones.', title: 'Título', content: 'Contenido' },
  en: { system: 'Describe one concrete visual scene that represents the supplied content.\nMaximum 45 words. Output only the scene: no titles, visible text, lettering, logos, or explanations.', title: 'Title', content: 'Content' },
  fr: { system: 'Décrivez une seule scène visuelle concrète qui représente le contenu fourni.\n45 mots maximum. Donnez uniquement la scène : aucun titre, texte visible, lettrage, logo ni explication.', title: 'Titre', content: 'Contenu' },
  de: { system: 'Beschreiben Sie eine einzige konkrete visuelle Szene, die den angegebenen Inhalt darstellt.\nHöchstens 45 Wörter. Nur die Szene: keine Titel, sichtbaren Texte, Schriftzüge, Logos oder Erklärungen.', title: 'Titel', content: 'Inhalt' },
  pt: { system: 'Descreve uma única cena visual concreta que represente o conteúdo fornecido.\nMáximo de 45 palavras. Apenas a cena: sem títulos, texto visível, letras, logótipos ou explicações.', title: 'Título', content: 'Conteúdo' },
  'pt-BR': { system: 'Descreva uma única cena visual concreta que represente o conteúdo fornecido.\nMáximo de 45 palavras. Somente a cena: sem títulos, texto visível, letras, logotipos ou explicações.', title: 'Título', content: 'Conteúdo' },
  it: { system: 'Descrivi un’unica scena visiva concreta che rappresenti il contenuto fornito.\nMassimo 45 parole. Solo la scena: niente titoli, testo visibile, scritte, loghi o spiegazioni.', title: 'Titolo', content: 'Contenuto' },
  tr: { system: 'Verilen içeriği temsil eden tek bir somut görsel sahne betimleyin.\nEn fazla 45 kelime. Yalnızca sahneyi verin: başlık, görünür metin, yazı, logo veya açıklama kullanmayın.', title: 'Başlık', content: 'İçerik' },
  'zh-Hans': { system: '描述一个能代表所提供内容的具体视觉场景。\n最多 45 个词。只输出场景：不要标题、可见文字、字母、标志或解释。', title: '标题', content: '内容' },
  'zh-Hant': { system: '描述一個能代表所提供內容的具體視覺場景。\n最多 45 個詞。只輸出場景：不要標題、可見文字、字母、標誌或解釋。', title: '標題', content: '內容' },
  vi: { system: 'Mô tả một cảnh thị giác cụ thể duy nhất thể hiện nội dung được cung cấp.\nTối đa 45 từ. Chỉ đưa ra cảnh: không tiêu đề, chữ hiển thị, chữ viết, logo hay giải thích.', title: 'Tiêu đề', content: 'Nội dung' },
  ja: { system: '与えられた内容を表す具体的な視覚シーンを一つだけ描写してください。\n最大45語。シーンのみを出力し、タイトル、表示テキスト、文字、ロゴ、説明は含めないでください。', title: 'タイトル', content: '内容' },
  ru: { system: 'Опишите одну конкретную визуальную сцену, представляющую предоставленное содержимое.\nНе более 45 слов. Выводите только сцену: без заголовков, видимого текста, надписей, логотипов и пояснений.', title: 'Заголовок', content: 'Содержание' },
  uk: { system: 'Опишіть одну конкретну візуальну сцену, що представляє наданий вміст.\nНе більше 45 слів. Виводьте лише сцену: без заголовків, видимого тексту, написів, логотипів чи пояснень.', title: 'Заголовок', content: 'Вміст' },
  ko: { system: '제공된 내용을 나타내는 구체적인 시각 장면 하나를 묘사하십시오.\n최대 45단어. 장면만 출력하고 제목, 표시되는 텍스트, 글자, 로고, 설명은 넣지 마십시오.', title: '제목', content: '내용' },
};

export function decorativeImageContextCall(source:{title:string;content:string},language:PromptLanguage) {
  const copy=VISUAL_CONTEXT_COPY[language];
  return {system:copy.system,user:`${copy.title}: ${source.title}\n${copy.content}: ${source.content}`,temperature:0.2,maxTokens:100,noRetry:true};
}
export function cleanDecorativeImageContext(response:string):string {
  const clean=response.replace(/\s+/g,' ').trim().slice(0,260);
  if(!clean)throw new Error('El modelo de texto no devolvió un contexto visual.');
  return clean;
}
