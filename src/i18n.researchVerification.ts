const keys = [
  'Verificar fuentes',
  'La verificación experimental de respuestas añade llamadas y latencia, y no garantiza que sean correctas.',
];

const translations: Record<string, string[]> = {
  en: [
    'Verify sources',
    'Experimental answer verification adds calls and latency, and does not guarantee correctness.',
  ],
  fr: [
    'Vérifier les sources',
    'La vérification expérimentale des réponses ajoute des appels et de la latence, sans garantir leur exactitude.',
  ],
  de: [
    'Quellen prüfen',
    'Die experimentelle Antwortprüfung verursacht zusätzliche Aufrufe und Verzögerungen und garantiert keine Richtigkeit.',
  ],
  pt: [
    'Verificar fontes',
    'A verificação experimental das respostas acrescenta chamadas e latência, sem garantir que estejam corretas.',
  ],
  'pt-BR': [
    'Verificar fontes',
    'A verificação experimental das respostas adiciona chamadas e latência, sem garantir que estejam corretas.',
  ],
  it: [
    'Verifica le fonti',
    'La verifica sperimentale delle risposte aggiunge chiamate e latenza, ma non ne garantisce la correttezza.',
  ],
  tr: [
    'Kaynakları doğrula',
    'Deneysel yanıt doğrulaması ek çağrılar ve gecikme getirir, doğruluğu garanti etmez.',
  ],
  'zh-CN': [
    '验证来源',
    '实验性答案验证会增加调用次数和延迟，但不能保证答案正确。',
  ],
  'zh-TW': [
    '驗證來源',
    '實驗性答案驗證會增加呼叫次數與延遲，但不保證答案正確。',
  ],
  ja: [
    '出典を検証',
    '実験的な回答検証は呼び出し回数と遅延を増やしますが、正確さを保証するものではありません。',
  ],
  ko: [
    '출처 검증',
    '실험적 답변 검증은 호출과 지연을 늘리며 정확성을 보장하지 않습니다.',
  ],
};

export const RESEARCH_VERIFICATION_TRANSLATIONS = Object.fromEntries(
  Object.entries(translations).map(([language, values]) => [language, Object.fromEntries(keys.map((key, index) => [key, values[index]]))]),
);
