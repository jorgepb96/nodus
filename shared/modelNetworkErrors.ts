import type { AppLanguage } from './types';

// Shared by IPC diagnostics so provider setup and model downloads keep their useful cause.
const TEXT: Record<AppLanguage, readonly [string, string, string]> = {
  "es": [
    "No se pudo conectar con {host}. Comprueba la conexión y el proxy del sistema. ({code})",
    "No se pudo instalar un runtime de llama.cpp utilizable. {details}",
    "Descarga HTTP {status}: {host}"
  ],
  "en": [
    "Could not connect to {host}. Check the connection and system proxy. ({code})",
    "No usable llama.cpp runtime could be installed. {details}",
    "Download from {host} failed (HTTP {status})."
  ],
  "fr": [
    "Impossible de se connecter à {host}. Vérifiez la connexion et le proxy système. ({code})",
    "Aucun moteur llama.cpp utilisable n’a pu être installé. {details}",
    "Le téléchargement depuis {host} a échoué (HTTP {status})."
  ],
  "de": [
    "Verbindung zu {host} fehlgeschlagen. Prüfe die Verbindung und den Systemproxy. ({code})",
    "Es konnte keine verwendbare llama.cpp-Laufzeit installiert werden. {details}",
    "Download von {host} fehlgeschlagen (HTTP {status})."
  ],
  "pt": [
    "Não foi possível ligar a {host}. Verifica a ligação e o proxy do sistema. ({code})",
    "Não foi possível instalar um motor llama.cpp utilizável. {details}",
    "A transferência de {host} falhou (HTTP {status})."
  ],
  "pt-BR": [
    "Não foi possível conectar a {host}. Verifique a conexão e o proxy do sistema. ({code})",
    "Não foi possível instalar um motor llama.cpp utilizável. {details}",
    "O download de {host} falhou (HTTP {status})."
  ],
  "it": [
    "Impossibile connettersi a {host}. Controlla la connessione e il proxy di sistema. ({code})",
    "Impossibile installare un runtime llama.cpp utilizzabile. {details}",
    "Il download da {host} non è riuscito (HTTP {status})."
  ],
  "tr": [
    "{host} ile bağlantı kurulamadı. Bağlantıyı ve sistem proxy ayarlarını kontrol edin. ({code})",
    "Kullanılabilir bir llama.cpp çalışma zamanı yüklenemedi. {details}",
    "{host} üzerinden indirme başarısız oldu (HTTP {status})."
  ],
  "zh-CN": [
    "无法连接到 {host}。请检查网络连接和系统代理。({code})",
    "无法安装可用的 llama.cpp 运行环境。{details}",
    "从 {host} 下载失败（HTTP {status}）。"
  ],
  "zh-TW": [
    "無法連線至 {host}。請檢查網路連線和系統代理。({code})",
    "無法安裝可用的 llama.cpp 執行環境。{details}",
    "從 {host} 下載失敗（HTTP {status}）。"
  ],
  "ja": [
    "{host} に接続できませんでした。ネットワーク接続とシステムプロキシを確認してください。({code})",
    "利用可能な llama.cpp ランタイムをインストールできませんでした。{details}",
    "{host} からのダウンロードに失敗しました（HTTP {status}）。"
  ],
  "ko": [
    "{host}에 연결할 수 없습니다. 네트워크 연결과 시스템 프록시를 확인하세요. ({code})",
    "사용 가능한 llama.cpp 런타임을 설치할 수 없습니다. {details}",
    "{host}에서 다운로드하지 못했습니다 (HTTP {status})."
  ]
};

const connection = /No se pudo conectar con ([^\s]+)\. Comprueba la conexión y el proxy del sistema\. \(([A-Z0-9_]+)\)/g;
const interpolate = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
const translations = (index: 0 | 1 | 2, values: Record<string, string>) => Object.fromEntries(
  Object.entries(TEXT).map(([language, templates]) => [language, interpolate(templates[index], values)]),
) as Record<AppLanguage, string>;

export const MODEL_NETWORK_ERROR_PATTERNS = [
  { pattern: /^No se pudo conectar con ([^\s]+)\. Comprueba la conexión y el proxy del sistema\. \(([A-Z0-9_]+)\)$/, translate: (host: string, code: string) => translations(0, { host, code }) },
  { pattern: /^Descarga HTTP (\d+): ([^\s]+)$/, translate: (status: string, host: string) => translations(2, { host, status }) },
  { pattern: /^No se pudo instalar un runtime de llama\.cpp utilizable\. (.+)$/, translate: (details: string) => Object.fromEntries(
    Object.entries(TEXT).map(([language, templates]) => [language, interpolate(templates[1], { details: details.replace(connection, (_match, host: string, code: string) => interpolate(templates[0], { host, code })) })]),
  ) as Record<AppLanguage, string> },
];
