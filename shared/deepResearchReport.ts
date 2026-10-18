import { documentFigureInsertions } from './documentFigureExport';
/**
 * A Deep Research report, described for the styled document.
 *
 * The half of the export that decides *what* goes on the page — the executive summary, the
 * report itself, the recommendations, the traceability matrix, the three metrics on the cover
 * — as opposed to `professionalReport.ts`, which decides how it all looks.
 *
 * Pure, and in `shared/` for the same reason: the desktop prints this with Chromium, and the
 * Nodus Server builds the identical description so a phone can print the same document. The
 * one thing it cannot do for itself is find the cover image, which lives in a vault on the
 * desktop and in the asset store on the server — so the caller passes it in.
 */
import type { PromptLanguage, WritingWorkshopDraft, WritingWorkshopMatrixRow } from './types';
import { stripLeadingAbstract, researchDocumentProse } from './writingDocument';
import {
  PROFESSIONAL_REPORT_THEMES,
  anchoredMarkdown,
  reportLink,
  type ProfessionalReportInput,
  type ProfessionalReportSection,
} from './professionalReport';

// Re-exported so one bundle carries everything a printer needs: the description of the
// report and the design that renders it.
export { renderProfessionalReportHtml } from './professionalReport';
export type { ProfessionalReportInput } from './professionalReport';

/** The cover image, resolved by whoever holds it. */
export interface DeepResearchReportImage {
  dataUrl: string | null;
  credit: string | null;
}

export 
interface DeepReportLabels {
  kind: string;
  contents: string;
  generated: string;
  objective: string;
  summary: string;
  summaryEyebrow: string;
  outline: string;
  outlineEyebrow: string;
  report: string;
  reportEyebrow: string;
  recommendations: string;
  recommendationsEyebrow: string;
  traceability: string;
  traceabilityEyebrow: string;
  sections: string;
  sources: string;
  words: string;
  imageAi: string;
  imageCustom: string;
  claims: string;
  role: string;
  claim: string;
  source: string;
  evidence: string;
  notes: string;
}

export const DEEP_LABELS: Record<PromptLanguage, DeepReportLabels> = {
  es: {
    kind: 'Informe profesional · Deep Research',
    contents: 'Contenido',
    generated: 'Generado',
    objective: 'Objetivo',
    summary: 'Resumen ejecutivo',
    summaryEyebrow: 'Síntesis',
    outline: 'Esquema de investigación',
    outlineEyebrow: 'Arquitectura del informe',
    report: 'Informe',
    reportEyebrow: 'Desarrollo',
    recommendations: 'Siguientes pasos',
    recommendationsEyebrow: 'Recomendaciones',
    traceability: 'Matriz de trazabilidad',
    traceabilityEyebrow: 'Evidencia y enlaces',
    sections: 'secciones',
    sources: 'fuentes',
    words: 'palabras',
    imageAi: 'Imagen de portada generada por IA en Nodus.',
    imageCustom: 'Imagen de portada aportada por el usuario.',
    claims: 'Afirmaciones clave',
    role: 'Rol',
    claim: 'Afirmación',
    source: 'Fuente',
    evidence: 'Evidencia',
    notes: 'Notas',
  },
  en: {
    kind: 'Professional report · Deep Research',
    contents: 'Contents',
    generated: 'Generated',
    objective: 'Objective',
    summary: 'Executive summary',
    summaryEyebrow: 'Synthesis',
    outline: 'Research outline',
    outlineEyebrow: 'Report architecture',
    report: 'Report',
    reportEyebrow: 'Analysis',
    recommendations: 'Next steps',
    recommendationsEyebrow: 'Recommendations',
    traceability: 'Evidence matrix',
    traceabilityEyebrow: 'Evidence and links',
    sections: 'sections',
    sources: 'sources',
    words: 'words',
    imageAi: 'Cover image generated with AI in Nodus.',
    imageCustom: 'Cover image provided by the user.',
    claims: 'Key claims',
    role: 'Role',
    claim: 'Claim',
    source: 'Source',
    evidence: 'Evidence',
    notes: 'Notes',
  },
  fr: {
    kind: 'Rapport professionnel · Deep Research', contents: 'Sommaire', generated: 'Généré', objective: 'Objectif',
    summary: 'Résumé exécutif', summaryEyebrow: 'Synthèse', outline: 'Plan de recherche', outlineEyebrow: 'Architecture du rapport',
    report: 'Rapport', reportEyebrow: 'Analyse', recommendations: 'Prochaines étapes', recommendationsEyebrow: 'Recommandations',
    traceability: 'Matrice de traçabilité', traceabilityEyebrow: 'Preuves et liens', sections: 'sections', sources: 'sources', words: 'mots',
    imageAi: 'Image de couverture générée par IA dans Nodus.', imageCustom: 'Image de couverture fournie par l’utilisateur.',
    claims: 'Affirmations clés', role: 'Rôle', claim: 'Affirmation', source: 'Source', evidence: 'Preuve', notes: 'Notes',
  },
  tr: {
    kind: 'Profesyonel rapor · Deep Research', contents: 'İçindekiler', generated: 'Oluşturulma', objective: 'Amaç',
    summary: 'Yönetici özeti', summaryEyebrow: 'Sentez', outline: 'Araştırma planı', outlineEyebrow: 'Rapor mimarisi',
    report: 'Rapor', reportEyebrow: 'Analiz', recommendations: 'Sonraki adımlar', recommendationsEyebrow: 'Öneriler',
    traceability: 'İzlenebilirlik matrisi', traceabilityEyebrow: 'Kanıt ve bağlantılar', sections: 'bölüm', sources: 'kaynak', words: 'kelime',
    imageAi: 'Kapak görseli Nodus’ta yapay zekâ ile oluşturuldu.', imageCustom: 'Kapak görseli kullanıcı tarafından sağlandı.',
    claims: 'Temel iddialar', role: 'Rol', claim: 'İddia', source: 'Kaynak', evidence: 'Kanıt', notes: 'Notlar',
  },
  'zh-Hans': {
    kind: '专业报告 · Deep Research', contents: '目录', generated: '生成日期', objective: '目标',
    summary: '执行摘要', summaryEyebrow: '综合', outline: '研究大纲', outlineEyebrow: '报告架构',
    report: '报告', reportEyebrow: '阐述', recommendations: '后续步骤', recommendationsEyebrow: '建议',
    traceability: '溯源矩阵', traceabilityEyebrow: '证据与链接', sections: '节', sources: '来源', words: '字数',
    imageAi: '由 Nodus 中的人工智能生成的封面图片。', imageCustom: '用户提供的封面图片。',
    claims: '关键论断', role: '角色', claim: '论断', source: '来源', evidence: '证据', notes: '备注',
  },
  'zh-Hant': {
    kind: '專業報告 · Deep Research', contents: '目錄', generated: '產生日期', objective: '目標',
    summary: '執行摘要', summaryEyebrow: '綜合', outline: '研究大綱', outlineEyebrow: '報告架構',
    report: '報告', reportEyebrow: '闡述', recommendations: '後續步驟', recommendationsEyebrow: '建議',
    traceability: '追溯矩陣', traceabilityEyebrow: '證據與連結', sections: '節', sources: '來源', words: '字數',
    imageAi: '由 Nodus 中的人工智慧產生的封面圖片。', imageCustom: '使用者提供的封面圖片。',
    claims: '關鍵論斷', role: '角色', claim: '論斷', source: '來源', evidence: '證據', notes: '備註',
  },
  vi: {
    kind: 'Báo cáo chuyên nghiệp · Deep Research', contents: 'Mục lục', generated: 'Đã tạo', objective: 'Mục tiêu',
    summary: 'Tóm tắt điều hành', summaryEyebrow: 'Tổng hợp', outline: 'Đề cương nghiên cứu', outlineEyebrow: 'Kiến trúc báo cáo',
    report: 'Báo cáo', reportEyebrow: 'Phân tích', recommendations: 'Các bước tiếp theo', recommendationsEyebrow: 'Khuyến nghị',
    traceability: 'Ma trận truy vết', traceabilityEyebrow: 'Bằng chứng và liên kết', sections: 'phần', sources: 'nguồn', words: 'từ',
    imageAi: 'Ảnh bìa được tạo bằng AI trong Nodus.', imageCustom: 'Ảnh bìa do người dùng cung cấp.',
    claims: 'Khẳng định chính', role: 'Vai trò', claim: 'Khẳng định', source: 'Nguồn', evidence: 'Bằng chứng', notes: 'Ghi chú',
  },
  ja: {
    kind: 'プロフェッショナルレポート · Deep Research', contents: '目次', generated: '作成日', objective: '目的',
    summary: 'エグゼクティブサマリー', summaryEyebrow: '総合', outline: '調査の構成', outlineEyebrow: 'レポートの設計',
    report: 'レポート', reportEyebrow: '分析', recommendations: '次のステップ', recommendationsEyebrow: '提言',
    traceability: 'トレーサビリティ・マトリクス', traceabilityEyebrow: 'エビデンスとリンク', sections: 'セクション', sources: '出典', words: '語数',
    imageAi: 'Nodus で AI により生成されたカバー画像。', imageCustom: 'ユーザーが提供したカバー画像。',
    claims: '主要な主張', role: '役割', claim: '主張', source: '出典', evidence: 'エビデンス', notes: 'メモ',
  },
  ru: {
    kind: 'Профессиональный отчёт · Deep Research', contents: 'Содержание', generated: 'Создано', objective: 'Цель',
    summary: 'Резюме для руководства', summaryEyebrow: 'Синтез', outline: 'Структура исследования', outlineEyebrow: 'Архитектура отчёта',
    report: 'Отчёт', reportEyebrow: 'Анализ', recommendations: 'Следующие шаги', recommendationsEyebrow: 'Рекомендации',
    traceability: 'Матрица прослеживаемости', traceabilityEyebrow: 'Доказательства и ссылки', sections: 'разделов', sources: 'источников', words: 'слов',
    imageAi: 'Обложка сгенерирована ИИ в Nodus.', imageCustom: 'Обложка предоставлена пользователем.',
    claims: 'Ключевые утверждения', role: 'Роль', claim: 'Утверждение', source: 'Источник', evidence: 'Доказательство', notes: 'Заметки',
  },
  uk: {
    kind: 'Професійний звіт · Deep Research', contents: 'Зміст', generated: 'Створено', objective: 'Мета',
    summary: 'Резюме для керівництва', summaryEyebrow: 'Синтез', outline: 'Структура дослідження', outlineEyebrow: 'Архітектура звіту',
    report: 'Звіт', reportEyebrow: 'Аналіз', recommendations: 'Наступні кроки', recommendationsEyebrow: 'Рекомендації',
    traceability: 'Матриця простежуваності', traceabilityEyebrow: 'Докази та посилання', sections: 'розділів', sources: 'джерел', words: 'слів',
    imageAi: 'Обкладинку згенеровано ШІ в Nodus.', imageCustom: 'Обкладинку надав користувач.',
    claims: 'Ключові твердження', role: 'Роль', claim: 'Твердження', source: 'Джерело', evidence: 'Доказ', notes: 'Нотатки',
  },
  ko: {
    kind: '전문 보고서 · Deep Research', contents: '목차', generated: '생성일', objective: '목표',
    summary: '핵심 요약', summaryEyebrow: '종합', outline: '연구 개요', outlineEyebrow: '보고서 구조',
    report: '보고서', reportEyebrow: '분석', recommendations: '다음 단계', recommendationsEyebrow: '권고 사항',
    traceability: '추적성 매트릭스', traceabilityEyebrow: '증거와 링크', sections: '절', sources: '출처', words: '단어',
    imageAi: 'Nodus에서 AI로 생성한 표지 이미지입니다.', imageCustom: '사용자가 제공한 표지 이미지입니다.',
    claims: '핵심 주장', role: '역할', claim: '주장', source: '출처', evidence: '증거', notes: '메모',
  },
  de: {
    kind: 'Professioneller Bericht · Deep Research', contents: 'Inhalt', generated: 'Erstellt', objective: 'Ziel',
    summary: 'Zusammenfassung', summaryEyebrow: 'Synthese', outline: 'Forschungsstruktur', outlineEyebrow: 'Berichtsarchitektur',
    report: 'Bericht', reportEyebrow: 'Analyse', recommendations: 'Nächste Schritte', recommendationsEyebrow: 'Empfehlungen',
    traceability: 'Nachweismatrix', traceabilityEyebrow: 'Evidenz und Links', sections: 'Abschnitte', sources: 'Quellen', words: 'Wörter',
    imageAi: 'Titelbild mit KI in Nodus generiert.', imageCustom: 'Titelbild vom Benutzer bereitgestellt.',
    claims: 'Kernaussagen', role: 'Rolle', claim: 'Aussage', source: 'Quelle', evidence: 'Evidenz', notes: 'Notizen',
  },
  pt: {
    kind: 'Relatório profissional · Deep Research', contents: 'Conteúdo', generated: 'Gerado', objective: 'Objetivo',
    summary: 'Resumo executivo', summaryEyebrow: 'Síntese', outline: 'Esquema de investigação', outlineEyebrow: 'Arquitetura do relatório',
    report: 'Relatório', reportEyebrow: 'Análise', recommendations: 'Próximos passos', recommendationsEyebrow: 'Recomendações',
    traceability: 'Matriz de rastreabilidade', traceabilityEyebrow: 'Evidência e ligações', sections: 'secções', sources: 'fontes', words: 'palavras',
    imageAi: 'Imagem de capa gerada por IA no Nodus.', imageCustom: 'Imagem de capa fornecida pelo utilizador.',
    claims: 'Afirmações-chave', role: 'Papel', claim: 'Afirmação', source: 'Fonte', evidence: 'Evidência', notes: 'Notas',
  },
  'pt-BR': {
    kind: 'Relatório profissional · Deep Research', contents: 'Conteúdo', generated: 'Gerado', objective: 'Objetivo',
    summary: 'Resumo executivo', summaryEyebrow: 'Síntese', outline: 'Estrutura da pesquisa', outlineEyebrow: 'Arquitetura do relatório',
    report: 'Relatório', reportEyebrow: 'Análise', recommendations: 'Próximos passos', recommendationsEyebrow: 'Recomendações',
    traceability: 'Matriz de rastreabilidade', traceabilityEyebrow: 'Evidências e links', sections: 'seções', sources: 'fontes', words: 'palavras',
    imageAi: 'Imagem de capa gerada por IA no Nodus.', imageCustom: 'Imagem de capa fornecida pelo usuário.',
    claims: 'Afirmações-chave', role: 'Papel', claim: 'Afirmação', source: 'Fonte', evidence: 'Evidência', notes: 'Notas',
  },
  it: {
    kind: 'Relazione professionale · Deep Research', contents: 'Indice', generated: 'Generato', objective: 'Obiettivo',
    summary: 'Sintesi esecutiva', summaryEyebrow: 'Sintesi', outline: 'Schema della ricerca', outlineEyebrow: 'Architettura della relazione',
    report: 'Relazione', reportEyebrow: 'Analisi', recommendations: 'Passi successivi', recommendationsEyebrow: 'Raccomandazioni',
    traceability: 'Matrice di tracciabilità', traceabilityEyebrow: 'Evidenze e collegamenti', sections: 'sezioni', sources: 'fonti', words: 'parole',
    imageAi: 'Immagine di copertina generata con l’IA in Nodus.', imageCustom: 'Immagine di copertina fornita dall’utente.',
    claims: 'Affermazioni chiave', role: 'Ruolo', claim: 'Affermazione', source: 'Fonte', evidence: 'Evidenza', notes: 'Note',
  },
};

function localizedDate(iso: string, language: PromptLanguage): string {
  try {
    return new Intl.DateTimeFormat(language, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function matrixHtml(rows: WritingWorkshopMatrixRow[], labels: DeepReportLabels): string {
  if (!rows.length) return '';
  const head = `<colgroup><col style="width:20mm" /><col /><col style="width:26mm" /><col /><col style="width:26mm" /></colgroup>
    <thead><tr>
      <th>${escapeCellHtml(labels.role)}</th>
      <th>${escapeCellHtml(labels.claim)}</th>
      <th>${escapeCellHtml(labels.source)}</th>
      <th>${escapeCellHtml(labels.evidence)}</th>
      <th>${escapeCellHtml(labels.notes)}</th>
    </tr></thead>`;
  const body = rows.map((row) => {
    const source = row.citation
      ? reportLink(row.citation, row.sourceLabel || labels.source)
      : escapeCellHtml(row.sourceLabel || labels.source);
    return `<tr>
      <td><span class="role-tag">${escapeCellHtml(row.role)}</span></td>
      <td class="claim">${escapeCellHtml(row.claim)}</td>
      <td>${source}</td>
      <td>${escapeCellHtml(row.evidence)}</td>
      <td>${row.notes ? escapeCellHtml(row.notes) : '—'}</td>
    </tr>`;
  }).join('');
  return `<table class="evidence-table">${head}<tbody>${body}</tbody></table>`;
}

function escapeCellHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function deepResearchReportInput(
  draft: WritingWorkshopDraft,
  image: DeepResearchReportImage = { dataUrl: null, credit: null },
  visuals?: import('./documentSkills').DocumentVisualManifest | null,
): ProfessionalReportInput {
  const language = draft.brief.language ?? 'es';
  const labels = DEEP_LABELS[language];
  const body = researchDocumentProse(stripLeadingAbstract(draft.draftMarkdown, draft.abstract), Boolean(draft.limitations?.length));
  const report = anchoredMarkdown(body, 'report', documentFigureInsertions(body, 'body', visuals));
  const abstract = anchoredMarkdown(draft.abstract || draft.brief.objective, 'summary');
  const sections: ProfessionalReportSection[] = [
    {
      id: 'executive-summary',
      number: '01',
      title: labels.summary,
      eyebrow: labels.summaryEyebrow,
      html: `<div class="abstract-box prose">${abstract.html}</div>`,
      className: 'exec-summary',
    },
  ];
  sections.push({
    id: 'research-report',
    number: String(sections.length + 1).padStart(2, '0'),
    title: labels.report,
    eyebrow: labels.reportEyebrow,
    html: `<div class="prose">${report.html}</div>`,
    tocChildren: report.headings,
    pageBreakBefore: true,
  });
  if (draft.nextSteps.length) {
    sections.push({
      id: 'next-steps',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.recommendations,
      eyebrow: labels.recommendationsEyebrow,
      html: `<div class="prose no-indent"><ol>${draft.nextSteps.map((item) => `<li>${escapeCellHtml(item)}</li>`).join('')}</ol></div>`,
    });
  }
  if (draft.matrix.length) {
    sections.push({
      id: 'traceability',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.traceability,
      eyebrow: labels.traceabilityEyebrow,
      html: matrixHtml(draft.matrix, labels),
      pageBreakBefore: true,
    });
  }
  const words = draft.draftMarkdown.split(/\s+/).filter(Boolean).length;
  return {
    title: draft.title || labels.report,
    subtitle: draft.brief.objective,
    kindLabel: labels.kind,
    language,
    generatedLabel: labels.generated,
    generatedAt: localizedDate(draft.generatedAt, language),
    objectiveLabel: labels.objective,
    objective: draft.brief.objective,
    imageDataUrl: image.dataUrl,
    imageCredit: image.credit,
    contentsLabel: labels.contents,
    metrics: [
      { value: String(draft.deepResearchStructure === 'single' ? 1 : draft.outline.length), label: labels.sections },
      { value: String(draft.stats.selectedWorks || draft.bibliography.length), label: labels.sources },
      { value: words.toLocaleString(language), label: labels.words },
    ],
    sections,
    theme: PROFESSIONAL_REPORT_THEMES.deepResearch,
  };
}
