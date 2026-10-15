/** Copy for the Chrome connector settings and the desktop pairing modal. */
const ES_KEYS = [
  'Nodus Research Connector',
  'Activar Nodus Research Connector',
  'Conectar Nodus Research Connector',
  '¿Quieres permitir que esta extensión envíe páginas a Nodus?',
  'Origen',
  'Extensión oficial de Nodus Research desde Chrome Web Store.',
  'Extensión de desarrollo (descomprimida) u otra instalación local.',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== ES_KEYS.length) {
    throw new Error(`Browser Connector i18n: expected ${ES_KEYS.length} values, received ${values.length}`);
  }
  return Object.fromEntries(ES_KEYS.map((key, index) => [key, values[index]]));
}

export const BROWSER_CONNECTOR_TRANSLATIONS = {
  en: table([
    'Nodus Research Connector',
    'Enable Nodus Research Connector',
    'Connect Nodus Research Connector',
    'Do you want to allow this extension to send pages to Nodus?',
    'Origin',
    'Official Nodus Research extension from the Chrome Web Store.',
    'Unpacked development extension or another local installation.',
  ]),
  fr: table([
    'Nodus Research Connector',
    'Activer Nodus Research Connector',
    'Connecter Nodus Research Connector',
    'Voulez-vous autoriser cette extension à envoyer des pages à Nodus ?',
    'Origine',
    'Extension officielle de Nodus Research provenant du Chrome Web Store.',
    'Extension de développement (non empaquetée) ou autre installation locale.',
  ]),
  de: table([
    'Nodus Research Connector',
    'Nodus Research Connector aktivieren',
    'Nodus Research Connector verbinden',
    'Möchtest du dieser Erweiterung erlauben, Seiten an Nodus zu senden?',
    'Ursprung',
    'Offizielle Nodus-Research-Erweiterung aus dem Chrome Web Store.',
    'Entwicklererweiterung (entpackt) oder eine andere lokale Installation.',
  ]),
  pt: table([
    'Nodus Research Connector',
    'Ativar o Nodus Research Connector',
    'Ligar o Nodus Research Connector',
    'Pretende permitir que esta extensão envie páginas para o Nodus?',
    'Origem',
    'Extensão oficial do Nodus Research proveniente da Chrome Web Store.',
    'Extensão de desenvolvimento (descompactada) ou outra instalação local.',
  ]),
  'pt-BR': table([
    'Nodus Research Connector',
    'Ativar o Nodus Research Connector',
    'Conectar o Nodus Research Connector',
    'Quer permitir que esta extensão envie páginas para o Nodus?',
    'Origem',
    'Extensão oficial do Nodus Research proveniente da Chrome Web Store.',
    'Extensão de desenvolvimento (descompactada) ou outra instalação local.',
  ]),
  it: table([
    'Nodus Research Connector',
    'Attiva Nodus Research Connector',
    'Connetti Nodus Research Connector',
    'Vuoi consentire a questa estensione di inviare pagine a Nodus?',
    'Origine',
    'Estensione ufficiale di Nodus Research dal Chrome Web Store.',
    'Estensione di sviluppo (non pacchettizzata) o un\'altra installazione locale.',
  ]),
  tr: table([
    'Nodus Research Connector',
    'Nodus Research Connector’ı etkinleştir',
    'Nodus Research Connector’ı bağla',
    'Bu uzantının Nodus’a sayfa göndermesine izin vermek istiyor musunuz?',
    'Kaynak',
    'Chrome Web Mağazası’ndaki resmî Nodus Research uzantısı.',
    'Paketlenmemiş geliştirme uzantısı veya başka bir yerel kurulum.',
  ]),
  'zh-CN': table([
    'Nodus Research Connector',
    '启用Nodus Research Connector',
    '连接Nodus Research Connector',
    '是否允许此扩展程序向Nodus发送页面？',
    '来源',
    '来自Chrome Web Store的Nodus Research官方扩展程序。',
    '开发扩展程序（未打包）或其他本地安装。',
  ]),
  'zh-TW': table([
    'Nodus Research Connector',
    '啟用Nodus Research Connector',
    '連線Nodus Research Connector',
    '是否允許此擴充套件程式向Nodus傳送頁面？',
    '來源',
    '來自Chrome Web Store的Nodus Research官方擴充套件程式。',
    '開發擴充套件程式（未打包）或其他本地安裝。',
  ]),
  ko: table([
    "Nodus 연구 커넥터",
    "Nodus Research 커넥터 활성화",
    "Nodus Research 커넥터 연결",
    "이 확장 프로그램이 Nodus에 페이지를 보낼 수 있도록 허용하시겠습니까?",
    "기원",
    "Chrome 웹 스토어의 공식 Nodus Research 확장 프로그램입니다.",
    "압축을 푼 개발 확장 또는 다른 로컬 설치.",
  ]),
  ja: table([
    "Nodusリサーチコネクター",
    "Nodus Research コネクタを有効にする",
    "Nodus Research コネクターに接続する",
    "この拡張機能が Nodus にページを送信することを許可しますか?",
    "起源",
    "Chrome ウェブストアの公式 Nodus Research 拡張機能。",
    "解凍された開発拡張機能または別のローカルインストール。",
  ]),
} as const;

// Capture queue copy is kept aligned with the Chrome catalogs.
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["en"], {
  "Guardados y descargas": "Saves and downloads",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} references · {files} files",
  "{count} archivo(s) pendientes": "{count} file(s) pending",
  "Descargando…": "Downloading…",
  "Necesita autorización": "Authorization needed",
  "Requiere atención": "Needs attention",
  "Completado": "Complete",
  "Guardado en cola": "Save queued",
  "El guardado continúa aunque cierres esta ventana.": "Saving continues after you close this window.",
  "Autorizar y descargar": "Authorize and download",
  "Reintentar": "Retry"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["fr"], {
  "Guardados y descargas": "Enregistrements et téléchargements",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} références · {files} fichiers",
  "{count} archivo(s) pendientes": "{count} fichier(s) en attente",
  "Descargando…": "Téléchargement…",
  "Necesita autorización": "Autorisation nécessaire",
  "Requiere atención": "Intervention nécessaire",
  "Completado": "Terminé",
  "Guardado en cola": "Enregistrement en attente",
  "El guardado continúa aunque cierres esta ventana.": "L’enregistrement continue après la fermeture de cette fenêtre.",
  "Autorizar y descargar": "Autoriser et télécharger",
  "Reintentar": "Réessayer"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["de"], {
  "Guardados y descargas": "Speicherungen und Downloads",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} Referenzen · {files} Dateien",
  "{count} archivo(s) pendientes": "{count} Datei(en) ausstehend",
  "Descargando…": "Wird heruntergeladen…",
  "Necesita autorización": "Zugriff erforderlich",
  "Requiere atención": "Aktion erforderlich",
  "Completado": "Abgeschlossen",
  "Guardado en cola": "Speicherung vorgemerkt",
  "El guardado continúa aunque cierres esta ventana.": "Die Speicherung läuft weiter, wenn du dieses Fenster schließt.",
  "Autorizar y descargar": "Erlauben und herunterladen",
  "Reintentar": "Erneut versuchen"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["pt"], {
  "Guardados y descargas": "Gravações e transferências",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} referências · {files} ficheiros",
  "{count} archivo(s) pendientes": "{count} ficheiro(s) pendentes",
  "Descargando…": "A transferir…",
  "Necesita autorización": "Requer autorização",
  "Requiere atención": "Requer atenção",
  "Completado": "Concluído",
  "Guardado en cola": "Gravação em fila",
  "El guardado continúa aunque cierres esta ventana.": "A gravação continua depois de fechar esta janela.",
  "Autorizar y descargar": "Autorizar e transferir",
  "Reintentar": "Tentar novamente"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["pt-BR"], {
  "Guardados y descargas": "Salvamentos e downloads",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} referências · {files} arquivos",
  "{count} archivo(s) pendientes": "{count} arquivo(s) pendentes",
  "Descargando…": "Baixando…",
  "Necesita autorización": "Requer autorização",
  "Requiere atención": "Requer atenção",
  "Completado": "Concluído",
  "Guardado en cola": "Salvamento na fila",
  "El guardado continúa aunque cierres esta ventana.": "O salvamento continua depois de fechar esta janela.",
  "Autorizar y descargar": "Autorizar e baixar",
  "Reintentar": "Tentar novamente"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["it"], {
  "Guardados y descargas": "Salvataggi e download",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} riferimenti · {files} file",
  "{count} archivo(s) pendientes": "{count} file in attesa",
  "Descargando…": "Download in corso…",
  "Necesita autorización": "Autorizzazione necessaria",
  "Requiere atención": "Richiede attenzione",
  "Completado": "Completato",
  "Guardado en cola": "Salvataggio in coda",
  "El guardado continúa aunque cierres esta ventana.": "Il salvataggio continua dopo la chiusura di questa finestra.",
  "Autorizar y descargar": "Autorizza e scarica",
  "Reintentar": "Riprova"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["tr"], {
  "Guardados y descargas": "Kayıtlar ve indirmeler",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} kaynak · {files} dosya",
  "{count} archivo(s) pendientes": "{count} dosya bekliyor",
  "Descargando…": "İndiriliyor…",
  "Necesita autorización": "İzin gerekiyor",
  "Requiere atención": "İşlem gerekiyor",
  "Completado": "Tamamlandı",
  "Guardado en cola": "Kayıt sıraya alındı",
  "El guardado continúa aunque cierres esta ventana.": "Bu pencereyi kapatsanız da kayıt devam eder.",
  "Autorizar y descargar": "İzin ver ve indir",
  "Reintentar": "Yeniden dene"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["zh-CN"], {
  "Guardados y descargas": "保存与下载",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} 条文献 · {files} 个文件",
  "{count} archivo(s) pendientes": "{count} 个文件待处理",
  "Descargando…": "正在下载…",
  "Necesita autorización": "需要授权",
  "Requiere atención": "需要处理",
  "Completado": "已完成",
  "Guardado en cola": "已加入保存队列",
  "El guardado continúa aunque cierres esta ventana.": "关闭此窗口后仍会继续保存。",
  "Autorizar y descargar": "授权并下载",
  "Reintentar": "重试"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["zh-TW"], {
  "Guardados y descargas": "儲存與下載",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} 筆文獻 · {files} 個檔案",
  "{count} archivo(s) pendientes": "{count} 個檔案待處理",
  "Descargando…": "正在下載…",
  "Necesita autorización": "需要授權",
  "Requiere atención": "需要處理",
  "Completado": "已完成",
  "Guardado en cola": "已加入儲存佇列",
  "El guardado continúa aunque cierres esta ventana.": "關閉此視窗後仍會繼續儲存。",
  "Autorizar y descargar": "授權並下載",
  "Reintentar": "重試"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["ja"], {
  "Guardados y descargas": "保存とダウンロード",
  "{saved}/{total} referencias · {files} archivos": "{saved}/{total} 件の文献 · {files} 個のファイル",
  "{count} archivo(s) pendientes": "{count} 個のファイルが保留中",
  "Descargando…": "ダウンロード中…",
  "Necesita autorización": "許可が必要",
  "Requiere atención": "確認が必要",
  "Completado": "完了",
  "Guardado en cola": "保存を予約しました",
  "El guardado continúa aunque cierres esta ventana.": "このウィンドウを閉じても保存は続きます。",
  "Autorizar y descargar": "許可してダウンロード",
  "Reintentar": "再試行"
});
Object.assign(BROWSER_CONNECTOR_TRANSLATIONS["ko"], {
  "Guardados y descargas": "저장 및 다운로드",
  "{saved}/{total} referencias · {files} archivos": "문헌 {saved}/{total}개 · 파일 {files}개",
  "{count} archivo(s) pendientes": "파일 {count}개 대기 중",
  "Descargando…": "다운로드 중…",
  "Necesita autorización": "권한 필요",
  "Requiere atención": "확인 필요",
  "Completado": "완료",
  "Guardado en cola": "저장 대기 중",
  "El guardado continúa aunque cierres esta ventana.": "이 창을 닫아도 저장이 계속됩니다.",
  "Autorizar y descargar": "허용하고 다운로드",
  "Reintentar": "다시 시도"
});
