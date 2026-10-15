/**
 * Filter menus of the report galleries (src/components/GalleryFilters.tsx): the few
 * option labels no other table already carried. Columns follow `languages` below.
 */
const catalog = [
  ['Informes', 'Reports', 'Rapports', 'Berichte', 'Relatórios', 'Relatórios', 'Report', 'Raporlar', '报告', '報告', 'レポート', '보고서'],
  ['Sin empezar', 'Not started', 'Non commencées', 'Nicht begonnen', 'Por começar', 'Não iniciadas', 'Da iniziare', 'Başlanmamış', '未开始', '未開始', '未着手', '시작 전'],
  ['Terminadas', 'Finished', 'Terminées', 'Abgeschlossen', 'Concluídas', 'Concluídas', 'Completate', 'Tamamlanan', '已完成', '已完成', '完了', '완료됨'],
] as const;

const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const;

export const GALLERY_FILTER_TRANSLATIONS = Object.fromEntries(
  languages.map((language, index) => [language, Object.fromEntries(catalog.map((row) => [row[0], row[index]]))]),
) as Record<(typeof languages)[number], Record<string, string>>;
