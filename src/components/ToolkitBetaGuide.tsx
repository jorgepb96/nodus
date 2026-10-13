import type { ReactNode } from 'react';
import type { AppLanguage } from '@shared/types';
import { TOOLKIT_TOOLS } from '../navigation';
import openAiLogo from '../assets/brands/openai.svg';
import githubCopilotLogo from '../assets/brands/github-copilot.svg';
import openCodeLogo from '../assets/brands/opencode.svg';
import claudeLogo from '../assets/brands/claude.svg';
import { Icon } from './ui';
import { MODEL_GUIDANCE_COPY } from './modelGuidanceCopy';

// This guide belongs to the 2.4.0 release, so its five-tool snapshot must not
// change when newer Toolkit entries (such as Nodus Apps) are added later.
const BETA_TOOLS = TOOLKIT_TOOLS.filter((tool) => tool.page !== 'apps');

// Shared panels retained for the essential tutorial. The old update tour is archived.
type GuideLanguage = AppLanguage | string;

const COPY = {
  es: {
    beta: 'NUEVO · BETA',
    title: 'Nuevas herramientas, mejores decisiones',
    summary: 'Nodus Toolkit incorpora cinco herramientas en beta y una guía práctica para elegir bien el modelo de extracción.',
    introTitle: 'Nodus Toolkit ya está aquí',
    introSummary: 'Cinco espacios de trabajo para preparar, proteger, traducir y presentar documentos sin salir de Nodus.',
    introBody: 'Las cinco herramientas están disponibles en beta. El procesamiento es local salvo las funciones que indiquen expresamente que usan un proveedor de IA.',
    toolSummaries: ['Documentos, PDF, imágenes y texto', 'Copias seguras y trazables', 'Traducción de texto y documentos', 'PDF como presentación', 'OCR asistido para casos difíciles'],
    originalFiles: 'Los archivos originales no se modifican. Nodus crea siempre una copia o un resultado nuevo.',
    extractionEyebrow: 'Extracción de ideas',
    extractionTitle: 'Extracción: menos razonamiento, más precisión',
    extractionSummary: 'Para extraer ideas conviene un modelo directo, disciplinado y fiable con datos estructurados.',
    extractionBody: 'Evita los modelos razonadores en esta tarea. Están pensados para desarrollar análisis extensos y suelen responder de forma más larga y lenta, además de apartarse con mayor facilidad del formato estructurado que Nodus necesita.',
    gemmaBody: 'Es el modelo local integrado que superó las pruebas internas de extracción: 20 ejecuciones correctas de 20 sobre un artículo real de unas 7.000 palabras, sin fallos de formato.',
    graniteBody: 'Más ligera y solo texto, útil para conversación, resúmenes y perfiles. No se ofrece para extracción: en las pruebas end-to-end sus decisiones de fusión no cumplieron el contrato JSON en obras grandes.',
    gemmaNote: 'Gemma 4 E2B Q4 es pequeño frente a los grandes modelos remotos, pero se eligió por su fiabilidad específica en extracción, no por una comparación general de inteligencia.',
    performanceEyebrow: 'Modelos locales',
    performanceTitle: 'La velocidad depende de tu equipo',
    performanceSummary: 'Los modelos locales usan tus recursos: CPU, memoria del sistema y, cuando está disponible, GPU y VRAM o memoria unificada.',
    performanceBody: 'Nodus organiza el trabajo, pero no puede convertir un equipo limitado en uno más rápido. En el modo estándar divide el texto en fragmentos de unas 1.800 palabras, con un pequeño solapamiento, y extrae las ideas progresivamente; no envía el artículo o capítulo completo en una sola petición.',
    performanceExample: 'Si cada fragmento tarda 30 segundos y una obra necesita diez, la extracción rondará los cinco minutos. Prueba primero una obra: si el tiempo te resulta razonable, continúa; si no, usa un proveedor remoto gratuito o de pago.',
    remoteTitle: 'Modelos remotos económicos',
    remoteSummary: 'Para extracción recomendamos modelos pequeños y rápidos, con el razonamiento desactivado.',
    remoteBody: 'Nodus solicita el razonamiento desactivado por defecto en las extracciones estructuradas. Así se reduce el tiempo, el texto innecesario y el riesgo de recibir una respuesta fuera del formato esperado.',
    remoteWarning: 'Los nombres, precios, límites y catálogos pueden cambiar. Comprueba siempre el proveedor antes de añadir saldo.',
    subscriptionsEyebrow: 'Accesos oficiales',
    subscriptionsTitle: 'También puedes aprovechar algunas suscripciones',
    subscriptionsSummary: 'Nodus admite accesos oficiales o documentados sin convertir tu suscripción en una clave de API genérica.',
    chatgpt: 'Acceso oficial mediante Codex App Server. Consume la cuota o los créditos de Codex de tu plan de ChatGPT, no el saldo de la API de OpenAI.',
    copilot: 'Acceso mediante el SDK oficial. Cada petición cuenta contra la cuota o las solicitudes premium de tu plan de GitHub.',
    opencode: 'Usa tu clave personal y los endpoints oficiales de OpenCode Go. Se aplican sus límites y el saldo se consulta en OpenCode Console.',
    claude: 'Anthropic prohíbe que terceros conecten suscripciones Free, Pro o Max de Claude.ai. Por eso Nodus solo admite Claude mediante una clave de la API oficial.',
    trademark: 'Nodus es independiente y no está afiliada ni respaldada por estos proveedores.',
    compatible: 'Compatible',
    apiOnly: 'Solo API',
    previous: 'Anterior',
    next: 'Siguiente',
    finish: 'Empezar a explorar',
    step: 'Paso',
    of: 'de',
  },
  en: {
    beta: 'NEW · BETA',
    title: 'New tools, better model choices',
    summary: 'Nodus Toolkit adds five beta tools and practical guidance for choosing an idea-extraction model.',
    introTitle: 'Nodus Toolkit is here',
    introSummary: 'Five workspaces to prepare, protect, translate and present documents without leaving Nodus.',
    introBody: 'All five tools are available in beta. Processing is local unless a feature explicitly says it uses an AI provider.',
    toolSummaries: ['Documents, PDFs, images and text', 'Safe, traceable copies', 'Translate text and documents', 'Present a PDF', 'Assisted OCR for difficult scans'],
    originalFiles: 'Original files are never modified. Nodus always creates a copy or a new output.',
    extractionEyebrow: 'Idea extraction',
    extractionTitle: 'Extraction: less reasoning, more precision',
    extractionSummary: 'Idea extraction benefits from a direct model that reliably returns structured data.',
    extractionBody: 'Avoid reasoning models for this task. They are designed to develop longer analyses, so they tend to be slower, more verbose and more likely to drift away from the structured format Nodus needs.',
    gemmaBody: 'The integrated local model that passed the internal extraction benchmark: 20 successful runs out of 20 on a real paper of about 7,000 words, with no format failures.',
    graniteBody: 'Lighter and text-only, useful for conversation, summaries and document profiles. It is not offered for extraction: in end-to-end testing its fusion decisions did not satisfy the JSON contract on large works.',
    gemmaNote: 'Gemma 4 E2B Q4 is small compared with leading remote models, but it was selected for its extraction reliability—not as a general measure of intelligence.',
    performanceEyebrow: 'Local models',
    performanceTitle: 'Speed depends on your computer',
    performanceSummary: 'Local models use your CPU and system memory, plus GPU and VRAM—or unified memory—when available.',
    performanceBody: 'Nodus orchestrates the work, but it cannot make limited hardware run like a faster machine. In standard mode it splits text into chunks of about 1,800 words with a small overlap and extracts ideas progressively; it does not send a whole paper or chapter in one request.',
    performanceExample: 'If every chunk takes 30 seconds and a work needs ten, extraction will take about five minutes. Test one work first: continue if the timing works for you, or choose a free or paid remote provider if it does not.',
    remoteTitle: 'Affordable remote models',
    remoteSummary: 'For extraction, we recommend small, fast models with reasoning disabled.',
    remoteBody: 'Nodus requests reasoning off by default for structured extraction. This reduces latency, unnecessary output and the risk of receiving a response outside the expected format.',
    remoteWarning: 'Model names, prices, limits and catalogues can change. Always check the provider before adding credit.',
    subscriptionsEyebrow: 'Official access',
    subscriptionsTitle: 'You can also use selected subscriptions',
    subscriptionsSummary: 'Nodus supports official or documented access without turning a subscription into a generic API key.',
    chatgpt: 'Official access through Codex App Server. It uses the Codex quota or credits in your ChatGPT plan, not OpenAI API credit.',
    copilot: 'Access through the official SDK. Each request counts against your GitHub plan quota or premium requests.',
    opencode: 'Uses your personal key and the official OpenCode Go endpoints. Its limits apply and your balance remains in OpenCode Console.',
    claude: 'Anthropic prohibits third parties from connecting Claude.ai Free, Pro or Max subscriptions. Nodus therefore supports Claude only through an official API key.',
    trademark: 'Nodus is independent and is not affiliated with or endorsed by these providers.',
    compatible: 'Compatible',
    apiOnly: 'API only',
    previous: 'Back',
    next: 'Next',
    finish: 'Start exploring',
    step: 'Step',
    of: 'of',
  },
} as const;

/** Spanish and English carry the whole guide. Every other language translates the
 * three model-guidance panels the essential tutorial reuses, layered over English. */
export function toolkitBetaGuideCopy(language: GuideLanguage) {
  if (language === 'es') return COPY.es;
  const guidance = MODEL_GUIDANCE_COPY[language];
  return guidance ? { ...COPY.en, ...guidance } : COPY.en;
}

function GuideNotice({ icon, children, warning = false }: { icon: string; children: ReactNode; warning?: boolean }) {
  return <div className={`toolkit-guide-notice ${warning ? 'toolkit-guide-notice-warning' : ''}`}><Icon name={icon} size={17} /><div>{children}</div></div>;
}

function ToolGrid({ language }: { language: GuideLanguage }) {
  const c = toolkitBetaGuideCopy(language);
  return <div className="toolkit-guide-tools">{BETA_TOOLS.map((tool) => (
    <div key={tool.page}><span><Icon name={tool.icon} size={18} /></span><div><b>{tool.name}</b><small>{c.toolSummaries[BETA_TOOLS.indexOf(tool)]}</small></div></div>
  ))}</div>;
}

export function ToolkitOverviewPanel({ language }: { language: GuideLanguage }) {
  const c = toolkitBetaGuideCopy(language);
  return <><p>{c.introBody}</p><ToolGrid language={language} /><GuideNotice icon="shield">{c.originalFiles}</GuideNotice></>;
}

export function IdeaExtractionPanel({ language }: { language: GuideLanguage }) {
  const c = toolkitBetaGuideCopy(language);
  return <><p>{c.extractionBody}</p><div className="toolkit-guide-models"><div className="recommended"><span>1</span><div><b>Gemma 4 E2B Q4</b><small>{c.gemmaBody}</small></div></div><div><span>2</span><div><b>IBM Granite 4.0 Micro Q4</b><small>{c.graniteBody}</small></div></div></div><GuideNotice icon="bulb">{c.gemmaNote}</GuideNotice></>;
}

export function LocalPerformancePanel({ language }: { language: GuideLanguage }) {
  const c = toolkitBetaGuideCopy(language);
  return <><p>{c.performanceBody}</p><div className="toolkit-guide-hardware"><span><Icon name="settings" size={17} /><b>CPU</b></span><span><Icon name="layers" size={17} /><b>RAM</b></span><span><Icon name="sparkles" size={17} /><b>GPU · VRAM</b></span></div><GuideNotice icon="clock" warning>{c.performanceExample}</GuideNotice></>;
}

export function RemoteModelsPanel({ language }: { language: GuideLanguage }) {
  const c = toolkitBetaGuideCopy(language);
  const models = ['Gemini 2.5 Flash-Lite', 'Gemini 3.1 Flash-Lite', 'DeepSeek V4 Flash', 'MiMo 2.5'];
  return <><p>{c.remoteBody}</p><div className="toolkit-guide-remote-models">{models.map((model) => <span key={model}><Icon name="check" size={14} />{model}</span>)}</div><GuideNotice icon="alert" warning>{c.remoteWarning}</GuideNotice></>;
}

function SubscriptionCard({ logo, name, children, badge, unavailable = false }: { logo: string; name: string; children: ReactNode; badge: string; unavailable?: boolean }) {
  return <div className={`toolkit-guide-subscription ${unavailable ? 'unavailable' : ''}`}><span className="toolkit-guide-brand"><img src={logo} alt="" /></span><div><span className="toolkit-guide-subscription-heading"><b>{name}</b><em>{badge}</em></span><small>{children}</small></div></div>;
}

export function SubscriptionAccessPanel({ language }: { language: GuideLanguage }) {
  const c = toolkitBetaGuideCopy(language);
  return <><div className="toolkit-guide-subscriptions"><SubscriptionCard logo={openAiLogo} name="ChatGPT · Codex" badge={c.compatible}>{c.chatgpt}</SubscriptionCard><SubscriptionCard logo={githubCopilotLogo} name="GitHub Copilot" badge={c.compatible}>{c.copilot}</SubscriptionCard><SubscriptionCard logo={openCodeLogo} name="OpenCode Go" badge={c.compatible}>{c.opencode}</SubscriptionCard><SubscriptionCard logo={claudeLogo} name="Claude" badge={c.apiOnly} unavailable>{c.claude}</SubscriptionCard></div><p className="toolkit-guide-trademark">{c.trademark}</p></>;
}
