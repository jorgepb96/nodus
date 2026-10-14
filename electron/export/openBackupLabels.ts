// The words an open backup writes for people: Markdown headings, the README and
// the omissions listed in the manifest and the Backups view. They follow the
// interface language of whoever exports, because the package is their own copy of
// their data. File and folder names, JSON keys and CSV columns are a format and stay
// fixed in every language.
import type { AppLanguage } from '@shared/types';

export interface OpenBackupLabels {
  summary: string;
  readSummary: string;
  summaryNote: string;
  title: string;
  authors: string;
  year: string;
  type: string;
  role: string;
  confidence: string;
  themes: string;
  developmentInWork: string;
  paraphrase: string;
  evidence: string;
  source: string;
  authorsAndWorks: string;
  affiliation: string;
  authorSynthesis: string;
  ideas: string;
  relations: string;
  files: string;
  version: string;
  items: string;
  contents: string;
  omissions: string;
  none: string;
  reuseNote: string;
  fileOmitted: (id: string, reason: string) => string;
  fileContentMissing: (id: string, reference: string) => string;
  noteRestricted: (id: string) => string;
  interviewPending: (id: string) => string;
  interviewWithdrawn: (id: string) => string;
  noReadPermission: (record: string) => string;
  missingItem: (scope: string, key: string) => string;
  externalReference: (target: string) => string;
  libraryInvalid: (count: number) => string;
  globalLibraryMissing: (key: string) => string;
  librarySymlink: (id: string, name: string) => string;
  libraryFileMissing: (id: string, name: string) => string;
  libraryFilesMissing: (id: string) => string;
}

const LABELS: Record<AppLanguage, OpenBackupLabels> = {
  es: {
    title: 'Título', authors: 'Autores', year: 'Año',
    summary: 'Resumen', readSummary: 'Leer resumen', summaryNote: 'Resumen generado para orientación; consultar la fuente para citar.',
    type: 'Tipo', role: 'Rol', confidence: 'Confianza', themes: 'Temas', developmentInWork: 'Desarrollo en esta obra',
    paraphrase: 'Paráfrasis', evidence: 'Evidencia', source: 'Fuente', authorsAndWorks: 'Autores y obras', affiliation: 'Afiliación',
    authorSynthesis: 'Síntesis del autor', ideas: 'Ideas', relations: 'Relaciones', files: 'Archivos', version: 'Versión', items: 'Elementos',
    contents: 'Contenido', omissions: 'Omisiones', none: 'Ninguna.',
    reuseNote: 'Markdown, CSV y JSON permiten reutilizar el contenido. Para restaurar Nodus utiliza una copia .nodus.',
    fileOmitted: (id, reason) => `Archivo ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `Archivo ${id}: contenido ausente; referencia ${reference}`,
    noteRestricted: (id) => `Nota ${id}: restricciones de exportación`,
    interviewPending: (id) => `Entrevista ${id}: confirmación de preservación pendiente`,
    interviewWithdrawn: (id) => `Entrevista ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: sin permiso de lectura`,
    missingItem: (scope, key) => `${scope}: elemento ausente ${key}`,
    externalReference: (target) => `Referencia externa a la selección: ${target}`,
    libraryInvalid: (count) => `Biblioteca: ${count} registros no válidos`,
    globalLibraryMissing: (key) => `Biblioteca global: elemento ausente ${key}`,
    librarySymlink: (id, name) => `Biblioteca ${id}: enlace simbólico omitido ${name}`,
    libraryFileMissing: (id, name) => `Biblioteca ${id}: archivo ausente ${name}`,
    libraryFilesMissing: (id) => `Biblioteca ${id}: archivos ausentes`,
  },
  en: {
    title: 'Title', authors: 'Authors', year: 'Year',
    summary: 'Summary', readSummary: 'Read summary', summaryNote: 'Summary generated for orientation; check the source before citing.',
    type: 'Type', role: 'Role', confidence: 'Confidence', themes: 'Themes', developmentInWork: 'Development in this work',
    paraphrase: 'Paraphrase', evidence: 'Evidence', source: 'Source', authorsAndWorks: 'Authors and works', affiliation: 'Affiliation',
    authorSynthesis: 'Author synthesis', ideas: 'Ideas', relations: 'Relations', files: 'Files', version: 'Version', items: 'Items',
    contents: 'Contents', omissions: 'Omissions', none: 'None.',
    reuseNote: 'Markdown, CSV and JSON let you reuse the content. To restore Nodus, use a .nodus backup.',
    fileOmitted: (id, reason) => `File ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `File ${id}: content missing; reference ${reference}`,
    noteRestricted: (id) => `Note ${id}: export restrictions`,
    interviewPending: (id) => `Interview ${id}: preservation confirmation pending`,
    interviewWithdrawn: (id) => `Interview ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: no read permission`,
    missingItem: (scope, key) => `${scope}: missing item ${key}`,
    externalReference: (target) => `Reference outside the selection: ${target}`,
    libraryInvalid: (count) => `Library: ${count} invalid records`,
    globalLibraryMissing: (key) => `Global library: missing item ${key}`,
    librarySymlink: (id, name) => `Library ${id}: symbolic link skipped ${name}`,
    libraryFileMissing: (id, name) => `Library ${id}: missing file ${name}`,
    libraryFilesMissing: (id) => `Library ${id}: missing files`,
  },
  fr: {
    title: 'Titre', authors: 'Auteurs', year: 'Année',
    summary: 'Résumé', readSummary: 'Lire le résumé', summaryNote: 'Résumé généré pour l’orientation ; consulter la source avant de citer.',
    type: 'Type', role: 'Rôle', confidence: 'Confiance', themes: 'Thèmes', developmentInWork: 'Développement dans cette œuvre',
    paraphrase: 'Paraphrase', evidence: 'Preuve', source: 'Source', authorsAndWorks: 'Auteurs et œuvres', affiliation: 'Affiliation',
    authorSynthesis: 'Synthèse de l’auteur', ideas: 'Idées', relations: 'Relations', files: 'Fichiers', version: 'Version', items: 'Éléments',
    contents: 'Contenu', omissions: 'Omissions', none: 'Aucune.',
    reuseNote: 'Markdown, CSV et JSON permettent de réutiliser le contenu. Pour restaurer Nodus, utilisez une sauvegarde .nodus.',
    fileOmitted: (id, reason) => `Fichier ${id} : ${reason}`,
    fileContentMissing: (id, reference) => `Fichier ${id} : contenu absent ; référence ${reference}`,
    noteRestricted: (id) => `Note ${id} : restrictions d’exportation`,
    interviewPending: (id) => `Entretien ${id} : confirmation de conservation en attente`,
    interviewWithdrawn: (id) => `Entretien ${id} : agreement_withdrawn`,
    noReadPermission: (record) => `${record} : pas d’autorisation de lecture`,
    missingItem: (scope, key) => `${scope} : élément absent ${key}`,
    externalReference: (target) => `Référence extérieure à la sélection : ${target}`,
    libraryInvalid: (count) => `Bibliothèque : ${count} enregistrements non valides`,
    globalLibraryMissing: (key) => `Bibliothèque globale : élément absent ${key}`,
    librarySymlink: (id, name) => `Bibliothèque ${id} : lien symbolique ignoré ${name}`,
    libraryFileMissing: (id, name) => `Bibliothèque ${id} : fichier absent ${name}`,
    libraryFilesMissing: (id) => `Bibliothèque ${id} : fichiers absents`,
  },
  de: {
    title: 'Titel', authors: 'Autoren', year: 'Jahr',
    summary: 'Zusammenfassung', readSummary: 'Zusammenfassung lesen', summaryNote: 'Zur Orientierung erstellte Zusammenfassung; vor dem Zitieren die Quelle prüfen.',
    type: 'Typ', role: 'Rolle', confidence: 'Konfidenz', themes: 'Themen', developmentInWork: 'Entwicklung in diesem Werk',
    paraphrase: 'Paraphrase', evidence: 'Beleg', source: 'Quelle', authorsAndWorks: 'Autoren und Werke', affiliation: 'Zugehörigkeit',
    authorSynthesis: 'Synthese zum Autor', ideas: 'Ideen', relations: 'Beziehungen', files: 'Dateien', version: 'Version', items: 'Elemente',
    contents: 'Inhalt', omissions: 'Auslassungen', none: 'Keine.',
    reuseNote: 'Mit Markdown, CSV und JSON lässt sich der Inhalt weiterverwenden. Zum Wiederherstellen von Nodus eine .nodus-Sicherung verwenden.',
    fileOmitted: (id, reason) => `Datei ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `Datei ${id}: Inhalt fehlt; Verweis ${reference}`,
    noteRestricted: (id) => `Notiz ${id}: Exportbeschränkungen`,
    interviewPending: (id) => `Interview ${id}: Bestätigung der Archivierung ausstehend`,
    interviewWithdrawn: (id) => `Interview ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: keine Leseberechtigung`,
    missingItem: (scope, key) => `${scope}: fehlendes Element ${key}`,
    externalReference: (target) => `Verweis außerhalb der Auswahl: ${target}`,
    libraryInvalid: (count) => `Bibliothek: ${count} ungültige Einträge`,
    globalLibraryMissing: (key) => `Globale Bibliothek: fehlendes Element ${key}`,
    librarySymlink: (id, name) => `Bibliothek ${id}: symbolischer Link übersprungen ${name}`,
    libraryFileMissing: (id, name) => `Bibliothek ${id}: fehlende Datei ${name}`,
    libraryFilesMissing: (id) => `Bibliothek ${id}: fehlende Dateien`,
  },
  pt: {
    title: 'Título', authors: 'Autores', year: 'Ano',
    summary: 'Resumo', readSummary: 'Ler resumo', summaryNote: 'Resumo gerado para orientação; consultar a fonte antes de citar.',
    type: 'Tipo', role: 'Papel', confidence: 'Confiança', themes: 'Temas', developmentInWork: 'Desenvolvimento nesta obra',
    paraphrase: 'Paráfrase', evidence: 'Evidência', source: 'Fonte', authorsAndWorks: 'Autores e obras', affiliation: 'Afiliação',
    authorSynthesis: 'Síntese do autor', ideas: 'Ideias', relations: 'Relações', files: 'Ficheiros', version: 'Versão', items: 'Elementos',
    contents: 'Conteúdo', omissions: 'Omissões', none: 'Nenhuma.',
    reuseNote: 'Markdown, CSV e JSON permitem reutilizar o conteúdo. Para restaurar o Nodus, usa uma cópia .nodus.',
    fileOmitted: (id, reason) => `Ficheiro ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `Ficheiro ${id}: conteúdo em falta; referência ${reference}`,
    noteRestricted: (id) => `Nota ${id}: restrições de exportação`,
    interviewPending: (id) => `Entrevista ${id}: confirmação de preservação pendente`,
    interviewWithdrawn: (id) => `Entrevista ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: sem permissão de leitura`,
    missingItem: (scope, key) => `${scope}: elemento em falta ${key}`,
    externalReference: (target) => `Referência fora da seleção: ${target}`,
    libraryInvalid: (count) => `Biblioteca: ${count} registos inválidos`,
    globalLibraryMissing: (key) => `Biblioteca global: elemento em falta ${key}`,
    librarySymlink: (id, name) => `Biblioteca ${id}: ligação simbólica omitida ${name}`,
    libraryFileMissing: (id, name) => `Biblioteca ${id}: ficheiro em falta ${name}`,
    libraryFilesMissing: (id) => `Biblioteca ${id}: ficheiros em falta`,
  },
  'pt-BR': {
    title: 'Título', authors: 'Autores', year: 'Ano',
    summary: 'Resumo', readSummary: 'Ler resumo', summaryNote: 'Resumo gerado para orientação; consulte a fonte antes de citar.',
    type: 'Tipo', role: 'Papel', confidence: 'Confiança', themes: 'Temas', developmentInWork: 'Desenvolvimento nesta obra',
    paraphrase: 'Paráfrase', evidence: 'Evidência', source: 'Fonte', authorsAndWorks: 'Autores e obras', affiliation: 'Afiliação',
    authorSynthesis: 'Síntese do autor', ideas: 'Ideias', relations: 'Relações', files: 'Arquivos', version: 'Versão', items: 'Itens',
    contents: 'Conteúdo', omissions: 'Omissões', none: 'Nenhuma.',
    reuseNote: 'Markdown, CSV e JSON permitem reutilizar o conteúdo. Para restaurar o Nodus, use um backup .nodus.',
    fileOmitted: (id, reason) => `Arquivo ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `Arquivo ${id}: conteúdo ausente; referência ${reference}`,
    noteRestricted: (id) => `Nota ${id}: restrições de exportação`,
    interviewPending: (id) => `Entrevista ${id}: confirmação de preservação pendente`,
    interviewWithdrawn: (id) => `Entrevista ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: sem permissão de leitura`,
    missingItem: (scope, key) => `${scope}: item ausente ${key}`,
    externalReference: (target) => `Referência fora da seleção: ${target}`,
    libraryInvalid: (count) => `Biblioteca: ${count} registros inválidos`,
    globalLibraryMissing: (key) => `Biblioteca global: item ausente ${key}`,
    librarySymlink: (id, name) => `Biblioteca ${id}: link simbólico ignorado ${name}`,
    libraryFileMissing: (id, name) => `Biblioteca ${id}: arquivo ausente ${name}`,
    libraryFilesMissing: (id) => `Biblioteca ${id}: arquivos ausentes`,
  },
  it: {
    title: 'Titolo', authors: 'Autori', year: 'Anno',
    summary: 'Riassunto', readSummary: 'Leggi il riassunto', summaryNote: 'Riassunto generato a scopo orientativo; consultare la fonte prima di citare.',
    type: 'Tipo', role: 'Ruolo', confidence: 'Affidabilità', themes: 'Temi', developmentInWork: 'Sviluppo in quest’opera',
    paraphrase: 'Parafrasi', evidence: 'Prova', source: 'Fonte', authorsAndWorks: 'Autori e opere', affiliation: 'Affiliazione',
    authorSynthesis: 'Sintesi dell’autore', ideas: 'Idee', relations: 'Relazioni', files: 'File', version: 'Versione', items: 'Elementi',
    contents: 'Contenuto', omissions: 'Omissioni', none: 'Nessuna.',
    reuseNote: 'Markdown, CSV e JSON consentono di riutilizzare il contenuto. Per ripristinare Nodus usa una copia .nodus.',
    fileOmitted: (id, reason) => `File ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `File ${id}: contenuto assente; riferimento ${reference}`,
    noteRestricted: (id) => `Nota ${id}: restrizioni di esportazione`,
    interviewPending: (id) => `Intervista ${id}: conferma di conservazione in sospeso`,
    interviewWithdrawn: (id) => `Intervista ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: nessun permesso di lettura`,
    missingItem: (scope, key) => `${scope}: elemento assente ${key}`,
    externalReference: (target) => `Riferimento esterno alla selezione: ${target}`,
    libraryInvalid: (count) => `Biblioteca: ${count} record non validi`,
    globalLibraryMissing: (key) => `Biblioteca globale: elemento assente ${key}`,
    librarySymlink: (id, name) => `Biblioteca ${id}: collegamento simbolico omesso ${name}`,
    libraryFileMissing: (id, name) => `Biblioteca ${id}: file assente ${name}`,
    libraryFilesMissing: (id) => `Biblioteca ${id}: file assenti`,
  },
  tr: {
    title: 'Başlık', authors: 'Yazarlar', year: 'Yıl',
    summary: 'Özet', readSummary: 'Özeti oku', summaryNote: 'Yönlendirme amacıyla oluşturulmuş özet; atıf yapmadan önce kaynağa bakın.',
    type: 'Tür', role: 'Rol', confidence: 'Güven', themes: 'Temalar', developmentInWork: 'Bu eserdeki gelişimi',
    paraphrase: 'Açımlama', evidence: 'Kanıt', source: 'Kaynak', authorsAndWorks: 'Yazarlar ve eserler', affiliation: 'Kurum',
    authorSynthesis: 'Yazar sentezi', ideas: 'Fikirler', relations: 'İlişkiler', files: 'Dosyalar', version: 'Sürüm', items: 'Öğeler',
    contents: 'İçerik', omissions: 'Eksikler', none: 'Yok.',
    reuseNote: 'Markdown, CSV ve JSON içeriği yeniden kullanmanızı sağlar. Nodus’u geri yüklemek için bir .nodus yedeği kullanın.',
    fileOmitted: (id, reason) => `Dosya ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `Dosya ${id}: içerik yok; başvuru ${reference}`,
    noteRestricted: (id) => `Not ${id}: dışa aktarma kısıtlamaları`,
    interviewPending: (id) => `Görüşme ${id}: koruma onayı bekleniyor`,
    interviewWithdrawn: (id) => `Görüşme ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: okuma izni yok`,
    missingItem: (scope, key) => `${scope}: eksik öğe ${key}`,
    externalReference: (target) => `Seçimin dışındaki başvuru: ${target}`,
    libraryInvalid: (count) => `Kitaplık: ${count} geçersiz kayıt`,
    globalLibraryMissing: (key) => `Genel kitaplık: eksik öğe ${key}`,
    librarySymlink: (id, name) => `Kitaplık ${id}: sembolik bağlantı atlandı ${name}`,
    libraryFileMissing: (id, name) => `Kitaplık ${id}: eksik dosya ${name}`,
    libraryFilesMissing: (id) => `Kitaplık ${id}: eksik dosyalar`,
  },
  'zh-CN': {
    title: '标题', authors: '作者', year: '年份',
    summary: '摘要', readSummary: '阅读摘要', summaryNote: '为便于了解而生成的摘要；引用前请查阅原始来源。',
    type: '类型', role: '角色', confidence: '置信度', themes: '主题', developmentInWork: '在本作品中的展开',
    paraphrase: '转述', evidence: '证据', source: '来源', authorsAndWorks: '作者与作品', affiliation: '所属机构',
    authorSynthesis: '作者综述', ideas: '观点', relations: '关系', files: '文件', version: '版本', items: '条目',
    contents: '内容', omissions: '遗漏', none: '无。',
    reuseNote: 'Markdown、CSV 和 JSON 便于重复使用内容。要恢复 Nodus，请使用 .nodus 备份。',
    fileOmitted: (id, reason) => `文件 ${id}：${reason}`,
    fileContentMissing: (id, reference) => `文件 ${id}：内容缺失；引用 ${reference}`,
    noteRestricted: (id) => `笔记 ${id}：导出受限`,
    interviewPending: (id) => `访谈 ${id}：保存确认待处理`,
    interviewWithdrawn: (id) => `访谈 ${id}：agreement_withdrawn`,
    noReadPermission: (record) => `${record}：无读取权限`,
    missingItem: (scope, key) => `${scope}：缺失条目 ${key}`,
    externalReference: (target) => `所选范围之外的引用：${target}`,
    libraryInvalid: (count) => `资料库：${count} 条无效记录`,
    globalLibraryMissing: (key) => `全局资料库：缺失条目 ${key}`,
    librarySymlink: (id, name) => `资料库 ${id}：已跳过符号链接 ${name}`,
    libraryFileMissing: (id, name) => `资料库 ${id}：缺失文件 ${name}`,
    libraryFilesMissing: (id) => `资料库 ${id}：文件缺失`,
  },
  'zh-TW': {
    title: '標題', authors: '作者', year: '年份',
    summary: '摘要', readSummary: '閱讀摘要', summaryNote: '為便於了解而產生的摘要；引用前請查閱原始來源。',
    type: '類型', role: '角色', confidence: '信賴度', themes: '主題', developmentInWork: '在本作品中的展開',
    paraphrase: '轉述', evidence: '證據', source: '來源', authorsAndWorks: '作者與作品', affiliation: '所屬機構',
    authorSynthesis: '作者綜述', ideas: '觀點', relations: '關係', files: '檔案', version: '版本', items: '項目',
    contents: '內容', omissions: '遺漏', none: '無。',
    reuseNote: 'Markdown、CSV 和 JSON 便於重複使用內容。要還原 Nodus，請使用 .nodus 備份。',
    fileOmitted: (id, reason) => `檔案 ${id}：${reason}`,
    fileContentMissing: (id, reference) => `檔案 ${id}：內容遺失；參照 ${reference}`,
    noteRestricted: (id) => `筆記 ${id}：匯出受限`,
    interviewPending: (id) => `訪談 ${id}：保存確認待處理`,
    interviewWithdrawn: (id) => `訪談 ${id}：agreement_withdrawn`,
    noReadPermission: (record) => `${record}：沒有讀取權限`,
    missingItem: (scope, key) => `${scope}：遺失項目 ${key}`,
    externalReference: (target) => `所選範圍之外的參照：${target}`,
    libraryInvalid: (count) => `資料庫：${count} 筆無效紀錄`,
    globalLibraryMissing: (key) => `全域資料庫：遺失項目 ${key}`,
    librarySymlink: (id, name) => `資料庫 ${id}：已略過符號連結 ${name}`,
    libraryFileMissing: (id, name) => `資料庫 ${id}：遺失檔案 ${name}`,
    libraryFilesMissing: (id) => `資料庫 ${id}：檔案遺失`,
  },
  ja: {
    title: 'タイトル', authors: '著者', year: '年',
    summary: '要約', readSummary: '要約を読む', summaryNote: '概要把握のために生成された要約です。引用する前に出典を確認してください。',
    type: '種類', role: '役割', confidence: '確信度', themes: 'テーマ', developmentInWork: 'この著作での展開',
    paraphrase: '言い換え', evidence: '根拠', source: '出典', authorsAndWorks: '著者と著作', affiliation: '所属',
    authorSynthesis: '著者の総括', ideas: 'アイデア', relations: '関係', files: 'ファイル', version: 'バージョン', items: '項目数',
    contents: '内容', omissions: '除外項目', none: 'なし。',
    reuseNote: 'Markdown、CSV、JSON で内容を再利用できます。Nodus を復元するには .nodus バックアップを使用してください。',
    fileOmitted: (id, reason) => `ファイル ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `ファイル ${id}: 内容がありません。参照 ${reference}`,
    noteRestricted: (id) => `ノート ${id}: エクスポート制限`,
    interviewPending: (id) => `インタビュー ${id}: 保存の確認待ち`,
    interviewWithdrawn: (id) => `インタビュー ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: 読み取り権限がありません`,
    missingItem: (scope, key) => `${scope}: 見つからない項目 ${key}`,
    externalReference: (target) => `選択範囲外への参照: ${target}`,
    libraryInvalid: (count) => `ライブラリ: 無効なレコード ${count} 件`,
    globalLibraryMissing: (key) => `グローバルライブラリ: 見つからない項目 ${key}`,
    librarySymlink: (id, name) => `ライブラリ ${id}: シンボリックリンクを除外 ${name}`,
    libraryFileMissing: (id, name) => `ライブラリ ${id}: 見つからないファイル ${name}`,
    libraryFilesMissing: (id) => `ライブラリ ${id}: ファイルがありません`,
  },
  ko: {
    title: '제목', authors: '저자', year: '연도',
    summary: '요약', readSummary: '요약 읽기', summaryNote: '방향을 잡기 위해 생성된 요약입니다. 인용하기 전에 출처를 확인하세요.',
    type: '유형', role: '역할', confidence: '신뢰도', themes: '주제', developmentInWork: '이 저작에서의 전개',
    paraphrase: '바꿔 쓰기', evidence: '근거', source: '출처', authorsAndWorks: '저자와 저작', affiliation: '소속',
    authorSynthesis: '저자 종합', ideas: '아이디어', relations: '관계', files: '파일', version: '버전', items: '항목',
    contents: '내용', omissions: '누락', none: '없음.',
    reuseNote: 'Markdown, CSV, JSON으로 내용을 다시 사용할 수 있습니다. Nodus를 복원하려면 .nodus 백업을 사용하세요.',
    fileOmitted: (id, reason) => `파일 ${id}: ${reason}`,
    fileContentMissing: (id, reference) => `파일 ${id}: 내용 없음, 참조 ${reference}`,
    noteRestricted: (id) => `노트 ${id}: 내보내기 제한`,
    interviewPending: (id) => `인터뷰 ${id}: 보존 확인 대기 중`,
    interviewWithdrawn: (id) => `인터뷰 ${id}: agreement_withdrawn`,
    noReadPermission: (record) => `${record}: 읽기 권한 없음`,
    missingItem: (scope, key) => `${scope}: 누락된 항목 ${key}`,
    externalReference: (target) => `선택 범위 밖의 참조: ${target}`,
    libraryInvalid: (count) => `라이브러리: 잘못된 레코드 ${count}개`,
    globalLibraryMissing: (key) => `전체 라이브러리: 누락된 항목 ${key}`,
    librarySymlink: (id, name) => `라이브러리 ${id}: 심볼릭 링크 건너뜀 ${name}`,
    libraryFileMissing: (id, name) => `라이브러리 ${id}: 누락된 파일 ${name}`,
    libraryFilesMissing: (id) => `라이브러리 ${id}: 파일 없음`,
  },
};

export function openBackupLabels(language: AppLanguage | undefined): OpenBackupLabels {
  return (language && LABELS[language]) || LABELS.es;
}
