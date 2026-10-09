import type { MainErrorTranslations } from './mainProcessErrors';

// Keep specific runtime failures visible in every UI language, including errors
// returned inside the worker's availability envelope.
const KEYS = [
  'EmbeddingGemma: runtime cerrado.',
  'EmbeddingGemma: runtime inactivo.',
  'EmbeddingGemma: solicitud cancelada.',
  'Perfil EmbeddingGemma desconocido.',
  'EmbeddingGemma: otra biblioteca está en uso.',
  'EmbeddingGemma: títulos desalineados.',
  'EmbeddingGemma: tiempo de inferencia agotado.',
  'EmbeddingGemma tiene solicitudes en curso.',
  'El proxy de recursos exige un perfil aislado.',
  'Proxy de recursos QA inválido.',
  'Puerto de runtime QA inválido.',
  'EmbeddingGemma: cantidad o dimensión incompatible.',
  'EmbeddingGemma: vector nativo inválido.',
  'EmbeddingGemma: vector vacío.',
  'EmbeddingGemma: lote excede el presupuesto de tokens.',
  'La bóveda o la configuración de embeddings cambió durante la solicitud. No se publicará el resultado.',
  'La bóveda cambió durante la consulta. No se publicará el resultado.',
  'Los títulos de embeddings no coinciden con las entradas.',
  'Perfil EmbeddingGemma desconocido: {value}',
  'EmbeddingGemma no disponible: {value}',
  'EmbeddingGemma: worker terminó ({value}).',
  'EmbeddingGemma: entrada {value} supera el límite de 8192 tokens (incluidos prefijos y tokens especiales).',
  'Descarga y verifica «{value}» desde Ajustes → Modelos IA.',
] as const;

function table(values: readonly string[]) {
  if (values.length !== KEYS.length) throw new Error('EmbeddingGemma error translations are incomplete.');
  return values;
}

const TABLES = {
  en: table([
    'EmbeddingGemma: runtime closed.', 'EmbeddingGemma: runtime idle.', 'EmbeddingGemma: request cancelled.',
    'Unknown EmbeddingGemma profile.', 'EmbeddingGemma: another library is in use.', 'EmbeddingGemma: misaligned titles.',
    'EmbeddingGemma: inference timed out.', 'EmbeddingGemma has active requests.',
    'The asset proxy requires an isolated profile.', 'Invalid QA asset proxy.', 'Invalid QA runtime port.',
    'EmbeddingGemma: incompatible count or dimension.', 'EmbeddingGemma: invalid native vector.', 'EmbeddingGemma: empty vector.',
    'EmbeddingGemma: batch exceeds the token budget.',
    'The vault or embedding configuration changed during the request. The result will not be published.',
    'The vault changed during the query. The result will not be published.', 'Embedding titles do not match the inputs.',
    'Unknown EmbeddingGemma profile: {value}', 'EmbeddingGemma unavailable: {value}', 'EmbeddingGemma: worker exited ({value}).',
    'EmbeddingGemma: input {value} exceeds the 8192-token limit (including prefixes and special tokens).',
    'Download and verify “{value}” in Settings → AI Models.',
  ]),
  fr: table([
    'EmbeddingGemma : moteur fermé.', 'EmbeddingGemma : moteur inactif.', 'EmbeddingGemma : requête annulée.',
    'Profil EmbeddingGemma inconnu.', 'EmbeddingGemma : une autre bibliothèque est utilisée.', 'EmbeddingGemma : titres mal alignés.',
    'EmbeddingGemma : délai d’inférence dépassé.', 'EmbeddingGemma a des requêtes en cours.',
    'Le proxy de ressources exige un profil isolé.', 'Proxy de ressources QA non valide.', 'Port du moteur QA non valide.',
    'EmbeddingGemma : nombre ou dimension incompatible.', 'EmbeddingGemma : vecteur natif non valide.', 'EmbeddingGemma : vecteur vide.',
    'EmbeddingGemma : le lot dépasse le budget de jetons.',
    'Le coffre ou la configuration des embeddings a changé pendant la requête. Le résultat ne sera pas publié.',
    'Le coffre a changé pendant la recherche. Le résultat ne sera pas publié.', 'Les titres des embeddings ne correspondent pas aux entrées.',
    'Profil EmbeddingGemma inconnu : {value}', 'EmbeddingGemma indisponible : {value}', 'EmbeddingGemma : processus terminé ({value}).',
    'EmbeddingGemma : l’entrée {value} dépasse la limite de 8192 jetons (préfixes et jetons spéciaux inclus).',
    'Téléchargez et vérifiez « {value} » dans Réglages → Modèles d’IA.',
  ]),
  de: table([
    'EmbeddingGemma: Laufzeit geschlossen.', 'EmbeddingGemma: Laufzeit inaktiv.', 'EmbeddingGemma: Anfrage abgebrochen.',
    'Unbekanntes EmbeddingGemma-Profil.', 'EmbeddingGemma: eine andere Bibliothek wird verwendet.', 'EmbeddingGemma: Titel nicht zugeordnet.',
    'EmbeddingGemma: Zeitlimit der Inferenz überschritten.', 'EmbeddingGemma hat laufende Anfragen.',
    'Der Ressourcenproxy benötigt ein isoliertes Profil.', 'Ungültiger QA-Ressourcenproxy.', 'Ungültiger QA-Laufzeitport.',
    'EmbeddingGemma: Anzahl oder Dimension nicht kompatibel.', 'EmbeddingGemma: ungültiger nativer Vektor.', 'EmbeddingGemma: leerer Vektor.',
    'EmbeddingGemma: der Stapel überschreitet das Tokenbudget.',
    'Der Vault oder die Embedding-Konfiguration wurde während der Anfrage geändert. Das Ergebnis wird nicht veröffentlicht.',
    'Der Vault wurde während der Suche geändert. Das Ergebnis wird nicht veröffentlicht.', 'Die Embedding-Titel passen nicht zu den Eingaben.',
    'Unbekanntes EmbeddingGemma-Profil: {value}', 'EmbeddingGemma nicht verfügbar: {value}', 'EmbeddingGemma: Worker beendet ({value}).',
    'EmbeddingGemma: Eingabe {value} überschreitet die Grenze von 8192 Tokens (einschließlich Präfixen und Spezialtokens).',
    'Laden Sie „{value}“ unter Einstellungen → KI-Modelle herunter und überprüfen Sie es.',
  ]),
  pt: table([
    'EmbeddingGemma: motor encerrado.', 'EmbeddingGemma: motor inativo.', 'EmbeddingGemma: pedido cancelado.',
    'Perfil EmbeddingGemma desconhecido.', 'EmbeddingGemma: outra biblioteca está a ser utilizada.', 'EmbeddingGemma: títulos desalinhados.',
    'EmbeddingGemma: tempo de inferência excedido.', 'EmbeddingGemma tem pedidos em curso.',
    'O proxy de recursos exige um perfil isolado.', 'Proxy QA de recursos inválido.', 'Porta do motor QA inválida.',
    'EmbeddingGemma: quantidade ou dimensão incompatível.', 'EmbeddingGemma: vetor nativo inválido.', 'EmbeddingGemma: vetor vazio.',
    'EmbeddingGemma: o lote excede o orçamento de tokens.',
    'O cofre ou a configuração de embeddings mudou durante o pedido. O resultado não será publicado.',
    'O cofre mudou durante a consulta. O resultado não será publicado.', 'Os títulos dos embeddings não correspondem às entradas.',
    'Perfil EmbeddingGemma desconhecido: {value}', 'EmbeddingGemma indisponível: {value}', 'EmbeddingGemma: processo terminado ({value}).',
    'EmbeddingGemma: a entrada {value} excede o limite de 8192 tokens (incluindo prefixos e tokens especiais).',
    'Transfira e verifique «{value}» em Definições → Modelos de IA.',
  ]),
  'pt-BR': table([
    'EmbeddingGemma: runtime encerrado.', 'EmbeddingGemma: runtime inativo.', 'EmbeddingGemma: solicitação cancelada.',
    'Perfil EmbeddingGemma desconhecido.', 'EmbeddingGemma: outra biblioteca está em uso.', 'EmbeddingGemma: títulos desalinhados.',
    'EmbeddingGemma: tempo de inferência excedido.', 'EmbeddingGemma tem solicitações em andamento.',
    'O proxy de recursos exige um perfil isolado.', 'Proxy QA para recursos inválido.', 'Porta do runtime QA inválida.',
    'EmbeddingGemma: quantidade ou dimensão incompatível.', 'EmbeddingGemma: vetor nativo inválido.', 'EmbeddingGemma: vetor vazio.',
    'EmbeddingGemma: o lote excede o orçamento de tokens.',
    'O cofre ou a configuração de embeddings mudou durante a solicitação. O resultado não será publicado.',
    'O cofre mudou durante a consulta. O resultado não será publicado.', 'Os títulos dos embeddings não correspondem às entradas.',
    'Perfil EmbeddingGemma desconhecido: {value}', 'EmbeddingGemma indisponível: {value}', 'EmbeddingGemma: processo encerrado ({value}).',
    'EmbeddingGemma: a entrada {value} excede o limite de 8192 tokens (incluindo prefixos e tokens especiais).',
    'Baixe e verifique “{value}” em Configurações → Modelos de IA.',
  ]),
  it: table([
    'EmbeddingGemma: motore chiuso.', 'EmbeddingGemma: motore inattivo.', 'EmbeddingGemma: richiesta annullata.',
    'Profilo EmbeddingGemma sconosciuto.', 'EmbeddingGemma: un’altra biblioteca è in uso.', 'EmbeddingGemma: titoli non allineati.',
    'EmbeddingGemma: tempo di inferenza scaduto.', 'EmbeddingGemma ha richieste in corso.',
    'Il proxy delle risorse richiede un profilo isolato.', 'Proxy delle risorse QA non valido.', 'Porta del motore QA non valida.',
    'EmbeddingGemma: quantità o dimensione incompatibile.', 'EmbeddingGemma: vettore nativo non valido.', 'EmbeddingGemma: vettore vuoto.',
    'EmbeddingGemma: il lotto supera il budget di token.',
    'Il vault o la configurazione degli embedding è cambiato durante la richiesta. Il risultato non verrà pubblicato.',
    'Il vault è cambiato durante la ricerca. Il risultato non verrà pubblicato.', 'I titoli degli embedding non corrispondono agli input.',
    'Profilo EmbeddingGemma sconosciuto: {value}', 'EmbeddingGemma non disponibile: {value}', 'EmbeddingGemma: processo terminato ({value}).',
    'EmbeddingGemma: l’input {value} supera il limite di 8192 token (inclusi prefissi e token speciali).',
    'Scarica e verifica «{value}» in Impostazioni → Modelli IA.',
  ]),
  tr: table([
    'EmbeddingGemma: çalışma zamanı kapatıldı.', 'EmbeddingGemma: çalışma zamanı boşta.', 'EmbeddingGemma: istek iptal edildi.',
    'Bilinmeyen EmbeddingGemma profili.', 'EmbeddingGemma: başka bir kütüphane kullanılıyor.', 'EmbeddingGemma: başlıklar eşleşmiyor.',
    'EmbeddingGemma: çıkarım zaman aşımına uğradı.', 'EmbeddingGemma için devam eden istekler var.',
    'Kaynak proxy’si izole bir profil gerektirir.', 'Geçersiz QA kaynak proxy’si.', 'Geçersiz QA çalışma zamanı portu.',
    'EmbeddingGemma: uyumsuz sayı veya boyut.', 'EmbeddingGemma: geçersiz yerel vektör.', 'EmbeddingGemma: boş vektör.',
    'EmbeddingGemma: toplu işlem token bütçesini aşıyor.',
    'İstek sırasında kasa veya embedding yapılandırması değişti. Sonuç yayımlanmayacak.',
    'Sorgu sırasında kasa değişti. Sonuç yayımlanmayacak.', 'Embedding başlıkları girdilerle eşleşmiyor.',
    'Bilinmeyen EmbeddingGemma profili: {value}', 'EmbeddingGemma kullanılamıyor: {value}', 'EmbeddingGemma: işçi sonlandı ({value}).',
    'EmbeddingGemma: {value} girdisi 8192 token sınırını aşıyor (önekler ve özel tokenlar dahil).',
    'Ayarlar → Yapay Zekâ Modelleri bölümünden “{value}” modelini indirin ve doğrulayın.',
  ]),
  'zh-CN': table([
    'EmbeddingGemma：运行时已关闭。', 'EmbeddingGemma：运行时空闲。', 'EmbeddingGemma：请求已取消。',
    '未知的 EmbeddingGemma 配置。', 'EmbeddingGemma：另一个资料库正在使用中。', 'EmbeddingGemma：标题未对齐。',
    'EmbeddingGemma：推理超时。', 'EmbeddingGemma 有正在进行的请求。',
    '资源代理要求使用隔离配置。', '无效的 QA 资源代理。', '无效的 QA 运行时端口。',
    'EmbeddingGemma：数量或维度不兼容。', 'EmbeddingGemma：原生向量无效。', 'EmbeddingGemma：向量为空。',
    'EmbeddingGemma：批次超出词元预算。',
    '请求期间，保险库或嵌入配置发生了变化。结果不会发布。',
    '查询期间，保险库发生了变化。结果不会发布。', '嵌入标题与输入不匹配。',
    '未知的 EmbeddingGemma 配置：{value}', 'EmbeddingGemma 不可用：{value}', 'EmbeddingGemma：工作线程已退出（{value}）。',
    'EmbeddingGemma：输入 {value} 超出 8192 词元限制（包括前缀和特殊词元）。',
    '请在设置 → AI 模型中下载并验证“{value}”。',
  ]),
  'zh-TW': table([
    'EmbeddingGemma：執行時已關閉。', 'EmbeddingGemma：執行時閒置。', 'EmbeddingGemma：請求已取消。',
    '未知的 EmbeddingGemma 設定。', 'EmbeddingGemma：另一個資料庫正在使用中。', 'EmbeddingGemma：標題未對齊。',
    'EmbeddingGemma：推論逾時。', 'EmbeddingGemma 有正在進行的請求。',
    '資源代理要求使用隔離設定。', '無效的 QA 資源代理。', '無效的 QA 執行時連接埠。',
    'EmbeddingGemma：數量或維度不相容。', 'EmbeddingGemma：原生向量無效。', 'EmbeddingGemma：向量為空。',
    'EmbeddingGemma：批次超出詞元預算。',
    '請求期間，保險庫或嵌入設定發生了變化。結果不會發布。',
    '查詢期間，保險庫發生了變化。結果不會發布。', '嵌入標題與輸入不符。',
    '未知的 EmbeddingGemma 設定：{value}', 'EmbeddingGemma 無法使用：{value}', 'EmbeddingGemma：工作執行緒已退出（{value}）。',
    'EmbeddingGemma：輸入 {value} 超出 8192 詞元限制（包含前綴和特殊詞元）。',
    '請在設定 → AI 模型中下載並驗證「{value}」。',
  ]),
  ja: table([
    'EmbeddingGemma: ランタイムを終了しました。', 'EmbeddingGemma: ランタイムは待機中です。', 'EmbeddingGemma: リクエストをキャンセルしました。',
    '不明な EmbeddingGemma プロファイルです。', 'EmbeddingGemma: 別のライブラリが使用中です。', 'EmbeddingGemma: タイトルが入力と対応していません。',
    'EmbeddingGemma: 推論がタイムアウトしました。', 'EmbeddingGemma に処理中のリクエストがあります。',
    'リソースプロキシには隔離されたプロファイルが必要です。', 'QA リソースプロキシが無効です。', 'QA ランタイムのポートが無効です。',
    'EmbeddingGemma: 件数または次元が一致しません。', 'EmbeddingGemma: ネイティブベクトルが無効です。', 'EmbeddingGemma: ベクトルが空です。',
    'EmbeddingGemma: バッチがトークン数の上限を超えています。',
    'リクエスト中に保管庫または埋め込み設定が変更されました。結果は公開されません。',
    'クエリ中に保管庫が変更されました。結果は公開されません。', '埋め込みのタイトルが入力と一致しません。',
    '不明な EmbeddingGemma プロファイル: {value}', 'EmbeddingGemma を利用できません: {value}', 'EmbeddingGemma: ワーカーが終了しました（{value}）。',
    'EmbeddingGemma: 入力 {value} が8192トークンの上限を超えています（プレフィックスと特殊トークンを含む）。',
    '設定 → AI モデルで「{value}」をダウンロードして検証してください。',
  ]),
  ko: table([
    'EmbeddingGemma: 런타임이 종료되었습니다.', 'EmbeddingGemma: 런타임이 유휴 상태입니다.', 'EmbeddingGemma: 요청이 취소되었습니다.',
    '알 수 없는 EmbeddingGemma 프로필입니다.', 'EmbeddingGemma: 다른 라이브러리가 사용 중입니다.', 'EmbeddingGemma: 제목이 입력과 맞지 않습니다.',
    'EmbeddingGemma: 추론 시간이 초과되었습니다.', 'EmbeddingGemma에 진행 중인 요청이 있습니다.',
    '리소스 프록시에는 격리된 프로필이 필요합니다.', '잘못된 QA 리소스 프록시입니다.', '잘못된 QA 런타임 포트입니다.',
    'EmbeddingGemma: 개수 또는 차원이 호환되지 않습니다.', 'EmbeddingGemma: 네이티브 벡터가 잘못되었습니다.', 'EmbeddingGemma: 벡터가 비어 있습니다.',
    'EmbeddingGemma: 배치가 토큰 예산을 초과합니다.',
    '요청 중에 보관함 또는 임베딩 설정이 변경되었습니다. 결과를 게시하지 않습니다.',
    '쿼리 중에 보관함이 변경되었습니다. 결과를 게시하지 않습니다.', '임베딩 제목이 입력과 일치하지 않습니다.',
    '알 수 없는 EmbeddingGemma 프로필: {value}', 'EmbeddingGemma를 사용할 수 없습니다: {value}', 'EmbeddingGemma: 워커가 종료되었습니다({value}).',
    'EmbeddingGemma: 입력 {value}이 8192 토큰 제한을 초과합니다(접두사 및 특수 토큰 포함).',
    '설정 → AI 모델에서 “{value}”을 다운로드하고 검증하세요.',
  ]),
} as const;

const dynamic = [
  /^Perfil EmbeddingGemma desconocido: (.+)$/,
  /^EmbeddingGemma no disponible: (.+)$/s,
  /^EmbeddingGemma: worker terminó \((.+)\)\.$/,
  /^EmbeddingGemma: entrada (\d+) supera el límite de 8192 tokens \(incluidos prefijos y tokens especiales\)\.$/,
  /^Descarga y verifica «(.+)» desde Ajustes → Modelos IA\.$/,
];
const staticCount = KEYS.length - dynamic.length;
const translations = (index: number, value?: string): MainErrorTranslations => Object.fromEntries(
  Object.entries(TABLES).map(([lang, strings]) => [lang, strings[index].replace('{value}', () => value ?? '')]),
) as MainErrorTranslations;

export const EMBEDDING_GEMMA2_ERRORS = Object.fromEntries(KEYS.slice(0, staticCount).map((key, index) => [key, translations(index)]));
export const EMBEDDING_GEMMA2_ERROR_PATTERNS = dynamic.map((pattern, index) => ({
  pattern,
  translate: (value: string): MainErrorTranslations => {
    const result = translations(staticCount + index, value);
    // Availability wraps the actual worker error; preserve its translated cause.
    if (index === 1) {
      const fixed = EMBEDDING_GEMMA2_ERRORS[value];
      const nested = dynamic.findIndex(candidate => candidate !== pattern && candidate.test(value));
      const cause = fixed ?? (nested >= 0 ? translations(staticCount + nested, dynamic[nested].exec(value)![1]) : undefined);
      if (cause) for (const lang of Object.keys(TABLES) as (keyof typeof TABLES)[]) result[lang] = TABLES[lang][staticCount + index].replace('{value}', () => cause[lang] ?? cause.en);
    }
    return result;
  },
}));
