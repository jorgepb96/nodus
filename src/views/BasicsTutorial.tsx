import { learningText, type LearningCopyKey } from '@shared/academicLearningCopy';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppLanguage, NodiStyle } from '@shared/types';
import type { TutorialLanguage } from '@shared/tutorialPreferences';
import { ConfirmModal } from '../components/ConfirmModal';
import { type NodiState } from '../components/nodi/Nodi';
import { NodiAvatar } from '../components/nodi/NodiAvatar';
import { NodiStylePicker } from '../components/nodi/NodiStylePicker';
import { Icon } from '../components/ui';
import {
  IdeaExtractionPanel,
  LocalPerformancePanel,
  SubscriptionAccessPanel,
  toolkitBetaGuideCopy,
} from '../components/ToolkitBetaGuide';
import {
  PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION,
  platformHighlightSlides,
} from '../components/PlatformHighlightsGuide';
import { TutorialVideoFeature } from '../components/TutorialVideos';
import { TUTORIAL_INTRO_VIDEO_ID, TUTORIAL_VIDEOS, tutorialVideo, tutorialVideoCopy } from '@shared/tutorialVideos';
import { t } from '../i18n';

export const BASICS_TUTORIAL_VERSION = PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION;

type Slide = {
  eyebrow: string;
  title: string;
  summary: string;
  icon: string;
  nodi: NodiState;
  content: ReactNode;
};

type CompactSlide = { eyebrow: string; title: string; summary: string; body: string; tip?: string; icon: string };
const TUTORIAL_LANGUAGES: Array<{ code: TutorialLanguage; label: string; flag: string }> = [
  { code: 'es', label: 'Español', flag: 'linear-gradient(#aa151b 0 25%, #f1bf00 25% 75%, #aa151b 75%)' },
  { code: 'en', label: 'English', flag: 'linear-gradient(135deg, #19335f 0 45%, #f5f5f5 45% 55%, #b31942 55%)' },
  { code: 'fr', label: 'Français', flag: 'linear-gradient(90deg, #0055a4 0 33%, #fff 33% 66%, #ef4135 66%)' },
  { code: 'tr', label: 'Türkçe', flag: 'linear-gradient(#e30a17, #e30a17)' },
  { code: 'de', label: 'Deutsch', flag: 'linear-gradient(#111 0 33%, #dd0000 33% 66%, #ffce00 66%)' },
  { code: 'it', label: 'Italiano', flag: 'linear-gradient(90deg, #009246 0 33%, #fff 33% 66%, #ce2b37 66%)' },
  { code: 'pt', label: 'Português', flag: 'linear-gradient(90deg, #046a38 0 42%, #da291c 42%)' },
  { code: 'pt-BR', label: 'Português do Brasil', flag: 'radial-gradient(circle, #002776 0 18%, transparent 19%), linear-gradient(145deg, transparent 34%, #ffdf00 35% 65%, transparent 66%), linear-gradient(#009c3b, #009c3b)' },
  { code: 'zh-CN', label: '简体中文', flag: 'linear-gradient(#de2910, #de2910)' },
  { code: 'zh-TW', label: '繁體中文', flag: 'conic-gradient(from 90deg at 50% 50%, #fe0000 0 50%, #000095 50% 75%, #fe0000 75%)' },
  { code: 'ja', label: '日本語', flag: 'radial-gradient(circle, #bc002d 0 27%, transparent 28%), linear-gradient(#f4f4f4, #f4f4f4)' },
  { code: 'ko', label: '한국어', flag: 'radial-gradient(circle, transparent 0 27%, #f4f4f4 28%), linear-gradient(#cd2e3a 50%, #0047a0 50%)' },
  { code: 'ru', label: 'Русский', flag: 'linear-gradient(#fff 0 33%, #0039a6 33% 66%, #d52b1e 66%)' },
  { code: 'uk', label: 'Українська', flag: 'linear-gradient(#0057b7 0 50%, #ffd700 50%)' },
];

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <button className="tutorial-link" onClick={() => void window.nodus.openExternal(href)}>{children}<Icon name="external" size={12} /></button>;
}

function Tip({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <div className={`tutorial-tip ${warning ? 'tutorial-tip-warning' : ''}`}><Icon name={warning ? 'alert' : 'bulb'} size={16} /><div>{children}</div></div>;
}

/** Model guidance introduced with the Toolkit beta. The current Toolkit overview
 * now lives in PlatformHighlightsGuide so this deck never describes a stale
 * five-tool snapshot to new users. */
function ModelGuidanceSlides(language: TutorialLanguage): Slide[] {
  const c = toolkitBetaGuideCopy(language);
  return [
    {
      eyebrow: c.extractionEyebrow, title: c.extractionTitle, icon: 'bulb', nodi: 'thinking', summary: c.extractionSummary,
      content: <IdeaExtractionPanel language={language} />,
    },
    {
      eyebrow: c.performanceEyebrow, title: c.performanceTitle, icon: 'clock', nodi: 'thinking', summary: c.performanceSummary,
      content: <LocalPerformancePanel language={language} />,
    },
    {
      eyebrow: c.subscriptionsEyebrow, title: c.subscriptionsTitle, icon: 'key', nodi: 'connecting', summary: c.subscriptionsSummary,
      content: <SubscriptionAccessPanel language={language} />,
    },
  ];
}

function SpanishSlides(): Slide[] {
  return [
    {
      eyebrow: 'Empieza por aquí', title: 'Bienvenido a Nodus', icon: 'network', nodi: 'waving',
      summary: 'Un lugar para reunir tus materiales, entender cómo se relacionan y volver a encontrarlos cuando los necesites.',
      content: <><p>Nodus reúne documentos, notas, datos y fuentes en espacios separados. Puedes buscar en ellos, descubrir relaciones y usarlos mientras estudias, investigas o escribes. También puedes pedir ayuda a un modelo de inteligencia artificial.</p><Tip>Tus espacios de trabajo se guardan en tu equipo. El contenido solo sale de él cuando eliges una función que utiliza un servicio externo.</Tip></>,
    },
    {
      eyebrow: 'Concepto 1', title: '¿Qué es una bóveda?', icon: 'archive', nodi: 'discovering',
      summary: 'Una bóveda es un espacio de trabajo independiente que mantiene juntos los materiales de un mismo proyecto.',
      content: <><div className="tutorial-vault-grid">
        <div><b>Académica</b><span>Bibliografía, ideas, autores, relaciones, investigación y escritura.</span></div>
        <div><b>Fuentes primarias</b><span>Documentos de archivo, transcripciones y crítica de fuentes.</span></div>
        <div><b>Testimonios</b><span>Entrevistas, participantes, transcripciones e historia oral.</span></div>
        <div><b>Bases de datos</b><span>Tablas, relaciones entre datos, búsquedas y análisis.</span></div>
        <div><b>Docencia</b><span>Cursos, horarios, materiales, evaluación y clases.</span></div>
        <div><b>Estudio</b><span>Cursos, asignaturas, apuntes, materiales y repasos.</span></div>
        <div><b>Genealogía</b><span>Personas, parentescos, cronología y evidencias familiares.</span></div>
        <div><b>Prosopografía</b><span>Poblaciones históricas, observaciones, cohortes y redes.</span></div>
        <div><b>Worldbuilding</b><span>Mundos de ficción: personajes, lugares, reglas y manuscritos.</span></div>
      </div><p>Puedes crear varias bóvedas y cambiar entre ellas. Los tipos más recientes muestran su fase (beta, alfa o pre-alfa) al crearlos, para que sepas cuáles están listos para trabajo real.</p></>,
    },
    {
      eyebrow: 'Concepto 2', title: 'Tres tipos de ayuda', icon: 'layers', nodi: 'connecting',
      summary: 'Nodus utiliza herramientas distintas para escribir, encontrar contenido relacionado y trabajar con audio.',
      content: <div className="tutorial-three-columns">
        <div><Icon name="chat" /><b>Escritura y conversación</b><span>Sirve para redactar, resumir, explicar y conversar. Algunos modelos también pueden comprender imágenes.</span></div>
        <div><Icon name="network" /><b>Búsqueda por significado</b><span>Ayuda a encontrar fragmentos relacionados aunque no utilicen las mismas palabras. Esta función usa lo que se conoce como embeddings.</span></div>
        <div><Icon name="microphone" /><b>Voz</b><span>Puede convertir una grabación en texto y leer un texto en voz alta.</span></div>
      </div>,
    },
    {
      eyebrow: 'Sin servicios externos', title: 'Modelos que funcionan en tu equipo', icon: 'settings', nodi: 'thinking',
      summary: 'Nodus puede descargar modelos preparados para la aplicación y utilizarlos directamente en tu ordenador.',
      content: <><p>Estos modelos permiten conversar, resumir y analizar imágenes sin enviar el contenido a otra empresa. No pagas por cada uso. La descarga es opcional y no viene incluida con la aplicación.</p><Tip>Los modelos más grandes necesitan más memoria y suelen responder mejor. También pueden funcionar más despacio. Nodus muestra el tamaño de cada descarga para que puedas elegir una opción adecuada para tu equipo.</Tip><p>Puedes descargarlos y eliminarlos desde <b>Ajustes → Modelos IA</b>. Eliminar un modelo no borra tus documentos.</p></>,
    },
    {
      eyebrow: 'Servicios externos', title: 'Cómo conectar un proveedor', icon: 'key', nodi: 'discovering',
      summary: 'Algunos modelos funcionan a través de servicios en internet y necesitan una clave personal para conectarse.',
      content: <><p>Esta clave suele llamarse API key. Es parecida a una contraseña y permite que Nodus utilice el servicio con tu cuenta.</p><ol className="tutorial-steps"><li>Crea una cuenta en el servicio que quieras usar.</li><li>Busca el apartado donde se crean las claves personales.</li><li>Copia la clave en <b>Ajustes → Proveedores</b>.</li><li>Comprueba la conexión y elige un modelo.</li></ol><Tip warning><b>No compartas ni publiques la clave.</b> Otras personas podrían utilizar tu saldo o alcanzar tus límites. Nodus intenta guardarla en el espacio seguro de tu sistema.</Tip><div className="tutorial-links"><ExternalLink href="https://openrouter.ai/settings/keys">Claves de OpenRouter</ExternalLink><ExternalLink href="https://console.groq.com/keys">Claves de Groq</ExternalLink><ExternalLink href="https://cloud.cerebras.ai/">Claves de Cerebras</ExternalLink><ExternalLink href="https://aistudio.google.com/app/apikey">Claves de Gemini</ExternalLink><ExternalLink href="https://platform.openai.com/api-keys">Claves de OpenAI</ExternalLink></div></>,
    },
    {
      eyebrow: 'Empezar gratis', title: 'Opciones gratuitas y sus límites', icon: 'star', nodi: 'waving',
      summary: 'Puedes probar algunos servicios sin pagar, aunque todos ponen límites a la cantidad de uso.',
      content: <><ul className="tutorial-list"><li><b>OpenRouter</b> ofrece modelos gratuitos. Puedes reconocerlos por la palabra <code>free</code> en su nombre. A veces dejan de estar disponibles.</li><li><b>Groq</b> permite usar gratis algunos modelos hasta alcanzar un límite.</li><li><b>Cerebras</b> ofrece un nivel gratuito con límites de solicitudes y tokens que dependen del modelo.</li><li><b>Gemini</b> permite utilizar gratis algunos modelos. Sus condiciones pueden ser diferentes de las opciones de pago.</li></ul><Tip>Los límites y las opciones gratuitas pueden cambiar. Consulta siempre la información del servicio antes de empezar.</Tip><div className="tutorial-links"><ExternalLink href="https://openrouter.ai/docs/faq#what-free-tier-options-exist">Opciones de OpenRouter</ExternalLink><ExternalLink href="https://console.groq.com/docs/rate-limits">Límites de Groq</ExternalLink><ExternalLink href="https://inference-docs.cerebras.ai/support/rate-limits">Límites de Cerebras</ExternalLink></div></>,
    },
    {
      eyebrow: 'Coste controlado', title: 'Modelos remotos económicos', icon: 'chartBar', nodi: 'thinking',
      summary: 'Muchos servicios cobran según la cantidad de texto que reciben y generan. Las tareas cortas suelen costar muy poco.',
      content: <><p>Para extracción recomendamos <b>Gemini 2.5 Flash-Lite</b>, <b>Gemini 3.1 Flash-Lite</b>, <b>DeepSeek V4 Flash</b> y <b>MiMo 2.5</b>: modelos pequeños y económicos que encajan bien con llamadas breves y estructuradas.</p><p>Nodus solicita el razonamiento desactivado por defecto durante la extracción. Así se reduce el tiempo, el texto innecesario y el riesgo de recibir una respuesta fuera del formato esperado.</p><Tip warning>Los nombres, los precios y los catálogos cambian. Revisa la página del proveedor antes de añadir saldo y fija un presupuesto que te resulte cómodo.</Tip><div className="tutorial-links"><ExternalLink href="https://ai.google.dev/gemini-api/docs/pricing">Precios de Gemini</ExternalLink><ExternalLink href="https://api-docs.deepseek.com/quick_start/pricing">Precios de DeepSeek</ExternalLink><ExternalLink href="https://platform.xiaomimimo.com/">Plataforma MiMo</ExternalLink></div></>,
    },
    ...ModelGuidanceSlides('es'),
    {
      eyebrow: 'Concepto 3', title: 'Encontrar ideas relacionadas', icon: 'network', nodi: 'connecting',
      summary: 'Nodus puede encontrar textos con un significado parecido aunque utilicen palabras diferentes.',
      content: <><p>Para hacerlo, Nodus prepara un índice especial de tus materiales. Divide el texto en fragmentos y crea una representación numérica de cada uno. Esta representación se llama embedding.</p><p>Cuando haces una búsqueda, Nodus compara tu pregunta con ese índice y recupera los fragmentos más cercanos por significado. Así puede ayudarte a descubrir conexiones y responder con apoyo en tus propios materiales.</p><p><b>RAG</b> significa <b>generación aumentada por recuperación</b>. Combina dos pasos: recuperar información relevante y entregársela a un modelo generativo para que redacte una respuesta con ese contexto. Sirve para consultar una colección grande sin enviar todo su contenido en cada pregunta y para apoyar las respuestas en fuentes concretas.</p><p>En Nodus, los embeddings recuperan de tu bóveda los pasajes e ideas más cercanos a la pregunta. Las funciones de chat, investigación y escritura que trabajan con tus fuentes pueden añadir esa selección al contexto del modelo que hayas elegido y, cuando corresponde, conservar las referencias para que puedas comprobarlas. El RAG reduce las respuestas inventadas, pero no las elimina: revisa siempre las fuentes.</p><Tip warning><b>Elige bien antes de crear el índice.</b> Si cambias el servicio o el modelo utilizado para esta tarea, tendrás que volver a procesar tus materiales. Nodus te avisará antes de hacerlo.</Tip></>,
    },
    {
      eyebrow: 'Preparar las búsquedas', title: 'Elige una opción adecuada', icon: 'languages', nodi: 'discovering',
      summary: 'Si tus documentos están en varios idiomas, elige una opción que indique que es multilingüe.',
      content: <><p>Nodus incluye cuatro opciones que funcionan en tu equipo. Se llaman <b>Harrier OSS v1 0.6B Q8_0</b>, <b>BGE-M3 Q8_0</b>, <b>GTE Multilingual Base INT8</b> y <b>Multilingual E5 Small INT8</b>. No tienen coste por uso y no envían el texto fuera. La descarga inicial y el primer procesamiento pueden tardar.</p><p>También puedes utilizar las opciones de OpenAI llamadas <b>text-embedding-3-small</b> y <b>text-embedding-3-large</b>. Estas funcionan a través de internet y pueden tener coste.</p><Tip>Prueba primero con unos pocos documentos. Comprueba que las búsquedas funcionan bien con tus idiomas y tu tipo de material antes de procesar una biblioteca grande.</Tip><div className="tutorial-links"><ExternalLink href="https://developers.openai.com/api/docs/models/text-embedding-3-small">Opciones de OpenAI</ExternalLink><ExternalLink href="https://openrouter.ai/docs/api/reference/embeddings">Opciones en OpenRouter</ExternalLink></div></>,
    },
    {
      eyebrow: 'Imágenes con IA', title: 'Crear y comprender imágenes', icon: 'image', nodi: 'discovering',
      summary: 'Algunos modelos pueden observar una imagen y otros pueden crear una nueva a partir de una descripción.',
      content: <><div className="tutorial-three-columns"><div><Icon name="image" /><b>Comprender una imagen</b><span>Puedes añadir una fotografía, un gráfico o una página escaneada para pedir una descripción o un análisis.</span></div><div><Icon name="wand" /><b>Crear una imagen</b><span>Nodus puede generar ilustraciones y otros recursos visuales cuando conectas un servicio compatible.</span></div><div><Icon name="alert" /><b>Revisar el resultado</b><span>Una imagen generada puede incluir detalles incorrectos. Compruébala antes de usarla en un trabajo.</span></div></div><Tip>Comprender y crear imágenes son tareas diferentes. Un modelo que acepta imágenes no tiene por qué poder generar otras nuevas. La generación suele utilizar un servicio externo y puede tener coste.</Tip></>,
    },
    {
      eyebrow: 'Audio integrado', title: 'Transcribir y escuchar', icon: 'microphone', nodi: 'waving',
      summary: 'Nodus puede convertir grabaciones en texto y leer tus documentos en voz alta.',
      content: <><div className="tutorial-three-columns"><div><Icon name="microphone" /><b>Pasar audio a texto</b><span>Convierte clases, entrevistas y notas de voz en texto que puedes revisar y editar.</span></div><div><Icon name="play" /><b>Escuchar documentos</b><span>Lee apuntes y documentos en voz alta con opciones que funcionan en tu equipo.</span></div><div><Icon name="settings" /><b>Elegir y descargar</b><span>Puedes gestionar las voces y los modelos de transcripción desde Ajustes.</span></div></div><Tip>Revisa siempre el texto obtenido. El ruido, los nombres propios, los acentos y el vocabulario especializado pueden causar errores.</Tip></>,
    },
    ...platformHighlightSlides('es'),
    {
      eyebrow: 'Una forma segura de empezar', title: 'Tu primera configuración', icon: 'check', nodi: 'celebrating',
      summary: 'Empieza con pocos materiales, comprueba los resultados y amplía tu espacio cuando lo necesites.',
      content: <><ol className="tutorial-steps"><li>Crea la bóveda que mejor encaje con tu trabajo.</li><li>Importa unos pocos materiales para hacer una primera prueba.</li><li>Prueba un modelo que funcione en tu equipo o conecta un servicio externo.</li><li>Elige una opción para preparar las búsquedas antes de procesar toda tu biblioteca.</li><li>Comprueba que las respuestas se apoyan en tus materiales.</li><li>Haz copias de seguridad con frecuencia.</li></ol><p className="tutorial-thanks">Gracias por usar Nodus. Puedes volver a abrir esta guía desde <b>Ajustes → Tutoriales → Ayuda</b>.</p></>,
    },
    {
      eyebrow: 'Tu acompañante', title: 'Conoce a Nodi', icon: 'star', nodi: 'celebrating',
      summary: 'Nodi reúne el chat, las notificaciones y la ayuda en un acompañante que puedes adaptar o desactivar.',
      content: <><div className="tutorial-three-columns"><div><Icon name="chat" /><b>Pregunta y conversa</b><span>Puede responder usando la documentación, la vista actual, la bóveda activa o todas tus bóvedas como contexto.</span></div><div><Icon name="bell" /><b>Avisos útiles</b><span>Te muestra notificaciones sobre procesos y tareas relevantes sin interrumpir tu trabajo.</span></div><div><Icon name="settings" /><b>A tu manera</b><span>Puedes elegir su modelo de chat, mantenerlo sobre otras aplicaciones y activar o quitar sus accesorios según la bóveda.</span></div></div><Tip>Nodi es opcional. Desde <b>Ajustes → Interfaz → Mascota Nodi</b> puedes ocultarlo por completo y cambiar todas sus opciones.</Tip><p className="tutorial-thanks">¡Ya estás listo! Haz clic en Nodi cuando quieras conversar, consultar avisos o abrir la ayuda.</p></>,
    },
  ];
}

function EnglishSlides(): Slide[] {
  return [
    { eyebrow: 'Start here', title: 'Welcome to Nodus', icon: 'network', nodi: 'waving', summary: 'A local workspace that turns scattered material into connected, reusable knowledge.', content: <><p>Nodus brings documents, notes, data and sources into separate workspaces. It can then search, connect and use them as context for study, research, writing or AI conversations.</p><Tip>Nodus is <b>local-first</b>: your vault and indexes live on your device. Content leaves it only when you choose a remote AI feature and provider.</Tip></> },
    { eyebrow: 'Concept 1', title: 'What is a vault?', icon: 'archive', nodi: 'discovering', summary: 'A vault is an isolated workspace with its own material, organization and indexes.', content: <><div className="tutorial-vault-grid"><div><b>Academic</b><span>Literature, ideas, authors, knowledge graph, research and writing.</span></div><div><b>Primary sources</b><span>Archival documents, transcriptions and source criticism.</span></div><div><b>Testimonies</b><span>Interviews, participants, transcripts and oral history.</span></div><div><b>Databases</b><span>Structured tables, relations, queries and analysis.</span></div><div><b>Teaching</b><span>Courses, timetables, materials, assessment and classes.</span></div><div><b>Study</b><span>Courses, subjects, notes, learning material and review.</span></div><div><b>Genealogy</b><span>People, kinship, timelines and family evidence.</span></div><div><b>Prosopography</b><span>Historical populations, observations, cohorts and networks.</span></div><div><b>Worldbuilding</b><span>Fictional worlds: characters, places, rules and manuscripts.</span></div></div><p>You can create several vaults and switch between them. Newer types show their phase (beta, alpha or pre-alpha) when you create them, so you know which ones are ready for real work.</p></> },
    { eyebrow: 'Concept 2', title: 'Three model families', icon: 'layers', nodi: 'connecting', summary: 'Conversational AI, embeddings and speech models perform different jobs.', content: <div className="tutorial-three-columns"><div><Icon name="chat" /><b>Generative AI</b><span>Writes, summarizes, explains, classifies and chats. Some models also understand images.</span></div><div><Icon name="network" /><b>Embeddings</b><span>Turn text into vectors for semantic search and relations. They do not write answers.</span></div><div><Icon name="microphone" /><b>Speech</b><span>Speech-to-text transcribes audio; text-to-speech produces playable narration.</span></div></div> },
    { eyebrow: 'AI without an API', title: 'Integrated local models', icon: 'settings', nodi: 'thinking', summary: 'Nodus can download and run models prepared for the app; they are not bundled with the installer.', content: <><p>Small quantized local models let you try chat, summaries, ideas and image input without per-use fees or sending text to an AI provider. They are generally less capable and slower than leading remote models.</p><Tip>Memory needs depend on model size, quantization and context. A GPU with more <b>VRAM</b> speeds up inference, but some models can use CPU and system RAM—or unified memory on Apple Silicon—more slowly.</Tip><p>Download and manage them in <b>Settings → AI Models</b>. Downloads are optional, and removing a model does not remove your documents.</p></> },
    { eyebrow: 'Remote AI', title: 'What is an API key?', icon: 'key', nodi: 'discovering', summary: 'A secret credential that lets Nodus request work from a provider on your behalf.', content: <><ol className="tutorial-steps"><li>Create an account with the provider.</li><li>Open its API keys page and generate a key.</li><li>Paste it into <b>Settings → Providers</b>, test it and select a model.</li></ol><Tip warning><b>Never share or publish an API key.</b> Usage, limits and billing can be attached to it. Nodus uses the operating system's secure storage when available.</Tip><div className="tutorial-links"><ExternalLink href="https://openrouter.ai/settings/keys">OpenRouter keys</ExternalLink><ExternalLink href="https://console.groq.com/keys">Groq keys</ExternalLink><ExternalLink href="https://cloud.cerebras.ai/">Cerebras keys</ExternalLink><ExternalLink href="https://aistudio.google.com/app/apikey">Gemini keys</ExternalLink><ExternalLink href="https://platform.openai.com/api-keys">OpenAI keys</ExternalLink></div></> },
    { eyebrow: 'Start for free', title: 'Free options and their limits', icon: 'star', nodi: 'waving', summary: '“Free” means a limited allowance, not unlimited capacity or guaranteed availability.', content: <><ul className="tutorial-list"><li><b>OpenRouter:</b> choose a <code>:free</code> model or <code>openrouter/free</code>; limits are low and availability can change.</li><li><b>Groq:</b> its Free Plan exposes selected models with per-model request and token limits.</li><li><b>Cerebras:</b> its free tier has request and token limits that vary by model.</li><li><b>Gemini:</b> has a free tier for selected models; limits and data terms differ from paid use.</li></ul><div className="tutorial-links"><ExternalLink href="https://openrouter.ai/docs/faq#what-free-tier-options-exist">OpenRouter free tier</ExternalLink><ExternalLink href="https://console.groq.com/docs/rate-limits">Groq limits</ExternalLink><ExternalLink href="https://inference-docs.cerebras.ai/support/rate-limits">Cerebras limits</ExternalLink></div></> },
    { eyebrow: 'Controlled cost', title: 'Affordable remote models', icon: 'chartBar', nodi: 'thinking', summary: 'Small, fast models are a good fit for short, structured extraction calls.', content: <><p>For extraction we recommend <b>Gemini 2.5 Flash-Lite</b>, <b>Gemini 3.1 Flash-Lite</b>, <b>DeepSeek V4 Flash</b> and <b>MiMo 2.5</b>.</p><p>Nodus requests reasoning off by default during extraction. This reduces latency, unnecessary output and the risk of receiving a response outside the required format.</p><Tip warning>Model names, prices and catalogues change. Check the provider before adding credit and set a budget.</Tip><div className="tutorial-links"><ExternalLink href="https://ai.google.dev/gemini-api/docs/pricing">Gemini pricing</ExternalLink><ExternalLink href="https://api-docs.deepseek.com/quick_start/pricing">DeepSeek pricing</ExternalLink><ExternalLink href="https://platform.xiaomimimo.com/">MiMo platform</ExternalLink></div></> },
    ...ModelGuidanceSlides('en'),
    { eyebrow: 'Concept 3', title: 'Embeddings: the semantic index', icon: 'network', nodi: 'connecting', summary: 'An embedding is a numerical fingerprint of a text fragment’s meaning.', content: <><p>Nodus splits material into passages and converts each one to a vector. It converts a search or question too, then retrieves semantically close passages even when they use different words. This powers discovery, connections and corpus-grounded answers.</p><p><b>RAG</b> stands for <b>retrieval-augmented generation</b>. It retrieves relevant information first, then gives it to a generative model as context for its answer. This makes large collections practical to query without sending the whole corpus every time and helps ground answers in specific sources.</p><p>In Nodus, embeddings retrieve the passages and ideas in your vault that are closest to the question. Chat, research and writing features that work with your sources can add that selection to the chosen model’s context and, where appropriate, preserve references so you can verify them. RAG reduces unsupported answers, but cannot eliminate them: always check the sources.</p><Tip warning><b>An index is only comparable with itself.</b> If you change the embedding provider or model, old vectors are unusable and all material must be reindexed. Nodus warns you before the change.</Tip></> },
    { eyebrow: 'Choosing embeddings', title: 'Local, remote and multilingual', icon: 'languages', nodi: 'discovering', summary: 'For mixed-language material, choose a multilingual embedding model—the standard term.', content: <><p>Integrated <b>Harrier OSS v1 0.6B Q8_0</b>, <b>BGE-M3 Q8_0</b>, <b>GTE Multilingual Base INT8</b> and <b>Multilingual E5 Small INT8</b> have no per-use fee and keep text local; downloading and initial indexing can take time.</p><p>Through an API you can use OpenAI's <b>text-embedding-3-small</b> or <b>text-embedding-3-large</b>. Their OpenRouter slugs are <code>openai/text-embedding-3-small</code> and <code>openai/text-embedding-3-large</code>.</p><Tip>Test retrieval with your own languages, field and document types before indexing a large library.</Tip><div className="tutorial-links"><ExternalLink href="https://developers.openai.com/api/docs/models/text-embedding-3-small">OpenAI embeddings</ExternalLink><ExternalLink href="https://openrouter.ai/docs/api/reference/embeddings">OpenRouter embeddings</ExternalLink></div></> },
    { eyebrow: 'AI images', title: 'Create and understand images', icon: 'image', nodi: 'discovering', summary: 'Some models can inspect an image, while others can create a new one from a description.', content: <><div className="tutorial-three-columns"><div><Icon name="image" /><b>Understand an image</b><span>Add a photograph, chart, or scanned page and ask for a description or analysis.</span></div><div><Icon name="wand" /><b>Create an image</b><span>Nodus can generate illustrations and other visual resources when you connect a compatible service.</span></div><div><Icon name="alert" /><b>Review the result</b><span>A generated image can contain incorrect details. Check it before using it in your work.</span></div></div><Tip>Understanding and creating images are different tasks. A model that accepts images may not generate new ones. Image generation commonly uses an external service and may have a cost.</Tip></> },
    { eyebrow: 'Integrated audio', title: 'Transcribe and listen', icon: 'microphone', nodi: 'waving', summary: 'Local speech models are fully integrated: download, select and use.', content: <><div className="tutorial-three-columns"><div><Icon name="microphone" /><b>Speech-to-text</b><span>Turns lectures, interviews or voice notes into text with Transformers.js or whisper.cpp.</span></div><div><Icon name="play" /><b>Text-to-speech</b><span>Reads notes and documents aloud using local engines available in Settings.</span></div><div><Icon name="settings" /><b>Management</b><span>Download a model, select it and remove unused files from Settings.</span></div></div><Tip>Always review transcripts: proper names, noise, accents and specialist vocabulary can cause errors.</Tip></> },
    ...platformHighlightSlides('en'),
    { eyebrow: 'A safe first setup', title: 'Your first configuration', icon: 'check', nodi: 'celebrating', summary: 'Start small, verify results, and expand only when you need to.', content: <><ol className="tutorial-steps"><li>Create the right vault and import a few materials.</li><li>Try a local model or a free key for generative AI.</li><li>Choose one embedding model before indexing at scale.</li><li>Check that answers cite or rely on your material.</li><li>Back up your data and review every remote provider's data policy.</li></ol><p className="tutorial-thanks">Thank you for using Nodus. Nodi and this guide remain available under <b>Settings → Tutorials → Help</b>.</p></> },
    { eyebrow: 'Your companion', title: 'Meet Nodi', icon: 'star', nodi: 'celebrating', summary: 'Nodi brings chat, notifications and help together in a companion you can customize or disable.', content: <><div className="tutorial-three-columns"><div><Icon name="chat" /><b>Ask and chat</b><span>It can answer using the documentation, current view, active vault or all your vaults as context.</span></div><div><Icon name="bell" /><b>Useful updates</b><span>It shows notifications about relevant processes and tasks without interrupting your work.</span></div><div><Icon name="settings" /><b>Make it yours</b><span>Choose its chat model, keep it above other apps, and enable or remove vault-specific accessories.</span></div></div><Tip>Nodi is optional. Open <b>Settings → Interface → Nodi mascot</b> to hide it completely or change any of its options.</Tip><p className="tutorial-thanks">You are ready. Click Nodi whenever you want to chat, check notifications or open help.</p></> },
  ];
}

const COMPACT_SLIDES: Record<Exclude<TutorialLanguage, 'es' | 'en'>, CompactSlide[]> = {
  fr: [
    { eyebrow: 'Commencez ici', title: 'Bienvenue dans Nodus', summary: 'Un espace local pour réunir et relier vos contenus.', body: 'Nodus rassemble documents, notes, données et sources dans des espaces séparés. Vous pouvez les rechercher, découvrir des liens et les utiliser pour étudier, faire de la recherche ou écrire.', tip: 'Vos espaces restent sur votre appareil. Le contenu ne le quitte que lorsque vous choisissez un service externe.', icon: 'network' },
    { eyebrow: 'Concept 1', title: 'Qu’est-ce qu’un coffre ?', summary: 'Un coffre est un espace indépendant consacré à un projet.', body: 'Nodus propose neuf types de coffre : académique, sources primaires, témoignages, bases de données, enseignement, étude, généalogie, prosopographie et worldbuilding. Chaque coffre conserve ses propres contenus, son organisation et ses index. Les types les plus récents affichent leur phase (bêta, alpha ou pré-alpha) lors de la création.', icon: 'archive' },
    { eyebrow: 'Concept 2', title: 'Trois formes d’aide', summary: 'L’écriture, la recherche par sens et la voix utilisent des outils différents.', body: 'Les modèles de conversation rédigent et expliquent. Les embeddings trouvent des passages de sens proche. Les modèles vocaux transcrivent un enregistrement ou lisent un texte à voix haute.', icon: 'layers' },
    { eyebrow: 'Sans service externe', title: 'Des modèles sur votre appareil', summary: 'Nodus peut télécharger des modèles préparés pour fonctionner localement.', body: 'Ils permettent de discuter, résumer et comprendre des images sans envoyer vos contenus à une autre entreprise. Le téléchargement reste facultatif et les modèles plus grands demandent davantage de mémoire.', icon: 'settings' },
    { eyebrow: 'Services externes', title: 'Connecter un fournisseur', summary: 'Les services en ligne utilisent une clé personnelle.', body: 'Créez une clé dans le service choisi, copiez-la dans Réglages puis vérifiez la connexion. Une clé API ressemble à un mot de passe.', tip: 'Ne partagez jamais cette clé. Son utilisation peut consommer votre solde ou vos limites.', icon: 'key' },
    { eyebrow: 'Essayer gratuitement', title: 'Les offres gratuites ont des limites', summary: 'Gratuit ne signifie pas illimité.', body: 'OpenRouter, Groq, Cerebras et Gemini proposent certaines possibilités gratuites. Les modèles disponibles, les limites et les conditions peuvent changer.', icon: 'star' },
    { eyebrow: 'Coût maîtrisé', title: 'Comprendre le prix', summary: 'Le coût dépend surtout du texte envoyé et produit.', body: 'Les demandes courtes coûtent généralement peu. Les documents longs, les réponses longues, le raisonnement et les fonctions supplémentaires augmentent le prix.', tip: 'Consultez toujours le tarif actuel du fournisseur et fixez un budget.', icon: 'chartBar' },
    { eyebrow: 'Concept 3', title: 'Trouver des idées proches', summary: 'Nodus retrouve des textes proches par leur sens.', body: 'Le texte est divisé en passages puis transformé en représentations numériques appelées embeddings. Le RAG (génération augmentée par récupération) retrouve d’abord les informations pertinentes, puis les fournit comme contexte à un modèle génératif. Dans Nodus, les embeddings sélectionnent les passages et idées de votre coffre les plus proches de la question ; les fonctions de chat, de recherche et d’écriture peuvent les utiliser pour répondre à partir de vos sources sans envoyer tout le corpus. Vérifiez toujours les références.', tip: 'Si vous changez de modèle d’embeddings, vous devrez traiter à nouveau vos contenus.', icon: 'network' },
    { eyebrow: 'Préparer la recherche', title: 'Choisir une option multilingue', summary: 'Le modèle doit correspondre aux langues de vos documents.', body: 'Nodus propose Harrier, BGE-M3, GTE Multilingual et Multilingual E5 en local. Vous pouvez aussi utiliser les modèles text-embedding-3 d’OpenAI par internet.', icon: 'languages' },
    { eyebrow: 'Images avec l’IA', title: 'Créer et comprendre des images', summary: 'Analyser une image et en créer une sont deux tâches différentes.', body: 'Vous pouvez demander une description d’une photo ou d’un graphique. Avec un service compatible, Nodus peut aussi produire une nouvelle illustration à partir de votre description.', tip: 'Vérifiez toujours le résultat. La génération peut contenir des erreurs et avoir un coût.', icon: 'image' },
    { eyebrow: 'Audio intégré', title: 'Transcrire et écouter', summary: 'Transformez la parole en texte et le texte en voix.', body: 'Nodus peut transcrire des cours, entretiens et notes vocales. Il peut aussi lire vos documents à voix haute. Relisez toujours les transcriptions.', icon: 'microphone' },
    { eyebrow: 'Bien commencer', title: 'Votre première configuration', summary: 'Commencez avec peu de contenus puis élargissez progressivement.', body: 'Créez un coffre, importez quelques contenus, choisissez vos modèles et vérifiez les résultats. Assurez-vous que les réponses reposent sur vos sources et faites des sauvegardes.', icon: 'check' },
    { eyebrow: 'Votre compagnon', title: 'Découvrez Nodi', summary: 'Nodi réunit le chat, les notifications et l’aide, et reste entièrement facultatif.', body: 'Nodi peut répondre avec la documentation, la vue actuelle, le coffre actif ou tous vos coffres comme contexte. Dans Réglages → Interface → Mascotte Nodi, vous pouvez le désactiver, choisir son modèle de chat, le garder au-dessus des autres applications et gérer ses accessoires selon le coffre.', icon: 'star' },
  ],
  tr: [
    { eyebrow: 'Buradan başlayın', title: 'Nodus’a hoş geldiniz', summary: 'İçeriklerinizi bir araya getiren ve ilişkilendiren yerel bir çalışma alanı.', body: 'Nodus belgeleri, notları, verileri ve kaynakları ayrı alanlarda toplar. Bunlarda arama yapabilir, bağlantılar keşfedebilir ve çalışma, araştırma ya da yazma sırasında kullanabilirsiniz.', tip: 'Çalışma alanlarınız cihazınızda kalır. İçerik yalnızca harici bir hizmet seçtiğinizde dışarı çıkar.', icon: 'network' },
    { eyebrow: 'Kavram 1', title: 'Kasa nedir?', summary: 'Kasa, tek bir proje için bağımsız bir çalışma alanıdır.', body: 'Nodus dokuz kasa türü sunar: akademik, birincil kaynaklar, tanıklıklar, veritabanları, öğretim, ders çalışma, soy araştırması, prosopografi ve dünya kurgusu (worldbuilding). Her kasa kendi içeriğini, düzenini ve dizinlerini korur. Yeni türler oluşturulurken aşamalarını (beta, alfa veya ön alfa) gösterir.', icon: 'archive' },
    { eyebrow: 'Kavram 2', title: 'Üç farklı yardım türü', summary: 'Yazma, anlam araması ve ses için farklı araçlar kullanılır.', body: 'Konuşma modelleri yazar ve açıklar. Embedding modelleri anlamca yakın parçaları bulur. Ses modelleri kayıtları yazıya çevirir veya metni seslendirir.', icon: 'layers' },
    { eyebrow: 'Harici hizmet olmadan', title: 'Cihazınızda çalışan modeller', summary: 'Nodus yerel kullanım için hazırlanmış modelleri indirebilir.', body: 'Bu modeller içerikleri başka bir şirkete göndermeden sohbet, özet ve görüntü anlama işlerini yapabilir. İndirme isteğe bağlıdır ve büyük modeller daha fazla bellek ister.', icon: 'settings' },
    { eyebrow: 'Harici hizmetler', title: 'Bir sağlayıcı bağlayın', summary: 'İnternet hizmetleri kişisel bir erişim anahtarı kullanır.', body: 'Seçtiğiniz hizmette bir anahtar oluşturun, Ayarlar bölümüne yapıştırın ve bağlantıyı sınayın. API anahtarı bir parola gibidir.', tip: 'Anahtarınızı paylaşmayın. Başkaları bakiyenizi veya kullanım sınırlarınızı tüketebilir.', icon: 'key' },
    { eyebrow: 'Ücretsiz başlayın', title: 'Ücretsiz seçeneklerin sınırları vardır', summary: 'Ücretsiz kullanım sınırsız değildir.', body: 'OpenRouter, Groq, Cerebras ve Gemini bazı ücretsiz seçenekler sunar. Kullanılabilir modeller, sınırlar ve koşullar değişebilir.', icon: 'star' },
    { eyebrow: 'Kontrollü maliyet', title: 'Fiyatı anlayın', summary: 'Maliyet çoğunlukla gönderilen ve üretilen metne bağlıdır.', body: 'Kısa istekler genellikle ucuzdur. Uzun belgeler, uzun yanıtlar, akıl yürütme ve ek özellikler maliyeti artırır.', tip: 'Güncel fiyatı sağlayıcıdan kontrol edin ve bir bütçe belirleyin.', icon: 'chartBar' },
    { eyebrow: 'Kavram 3', title: 'İlgili fikirleri bulun', summary: 'Nodus farklı kelimeler kullanan benzer anlamlı metinleri bulabilir.', body: 'Metin parçalara ayrılır ve embedding adı verilen sayısal gösterimlere dönüştürülür. RAG (erişim destekli üretim) önce ilgili bilgileri bulur, sonra bunları üretken modele bağlam olarak verir. Nodus’ta embeddingler soruya en yakın kasa parçalarını ve fikirlerini seçer; sohbet, araştırma ve yazma özellikleri tüm külliyatı göndermeden kaynaklarınıza dayalı yanıtlar üretmek için bu seçimi kullanabilir. Kaynakları her zaman kontrol edin.', tip: 'Embedding modelini değiştirirseniz içeriklerinizi yeniden işlemeniz gerekir.', icon: 'network' },
    { eyebrow: 'Aramayı hazırlayın', title: 'Çok dilli bir seçenek seçin', summary: 'Model belgelerinizin dillerine uygun olmalıdır.', body: 'Nodus yerel olarak Harrier, BGE-M3, GTE Multilingual ve Multilingual E5 sunar. OpenAI text-embedding-3 modellerini internet üzerinden de kullanabilirsiniz.', icon: 'languages' },
    { eyebrow: 'Yapay zekâ görselleri', title: 'Görselleri oluşturun ve anlayın', summary: 'Bir görseli incelemek ve yeni bir görsel üretmek farklı işlerdir.', body: 'Bir fotoğrafın veya grafiğin açıklamasını isteyebilirsiniz. Uyumlu bir hizmetle Nodus açıklamanızdan yeni bir görsel de oluşturabilir.', tip: 'Sonucu kontrol edin. Üretilen görseller hatalar içerebilir ve ücretli olabilir.', icon: 'image' },
    { eyebrow: 'Yerleşik ses', title: 'Yazıya çevirin ve dinleyin', summary: 'Konuşmayı metne, metni sese dönüştürün.', body: 'Nodus dersleri, görüşmeleri ve sesli notları yazıya çevirebilir. Belgelerinizi sesli olarak da okuyabilir. Çıktıyı her zaman gözden geçirin.', icon: 'microphone' },
    { eyebrow: 'Güvenli başlangıç', title: 'İlk kurulumunuz', summary: 'Az içerikle başlayın ve sonuçları doğruladıktan sonra büyütün.', body: 'Bir kasa oluşturun, birkaç içerik ekleyin, modellerinizi seçin ve sonuçları kontrol edin. Yanıtların kaynaklarınıza dayandığından emin olun ve yedek alın.', icon: 'check' },
    { eyebrow: 'Yardımcınız', title: 'Nodi ile tanışın', summary: 'Nodi sohbeti, bildirimleri ve yardımı bir araya getirir; kullanımı tamamen isteğe bağlıdır.', body: 'Nodi belgeleri, geçerli görünümü, etkin kasayı veya tüm kasalarınızı bağlam olarak kullanabilir. Ayarlar → Arayüz → Nodi maskotu bölümünde Nodi’yi kapatabilir, sohbet modelini seçebilir, diğer uygulamaların üstünde tutabilir ve kasaya göre aksesuarlarını yönetebilirsiniz.', icon: 'star' },
  ],
  de: [
    { eyebrow: 'Hier beginnen', title: 'Willkommen bei Nodus', summary: 'Ein lokaler Arbeitsbereich, der Ihre Inhalte sammelt und verbindet.', body: 'Nodus organisiert Dokumente, Notizen, Daten und Quellen in getrennten Bereichen. Sie können darin suchen, Zusammenhänge entdecken und sie beim Lernen, Forschen oder Schreiben verwenden.', tip: 'Ihre Arbeitsbereiche bleiben auf Ihrem Gerät. Inhalte verlassen es nur, wenn Sie einen externen Dienst wählen.', icon: 'network' },
    { eyebrow: 'Begriff 1', title: 'Was ist ein Vault?', summary: 'Ein Vault ist ein unabhängiger Arbeitsbereich für ein Projekt.', body: 'Nodus bietet neun Vault-Typen: akademisch, Primärquellen, Zeugnisse, Datenbanken, Lehre, Lernen, Genealogie, Prosopografie und Worldbuilding. Jeder Vault besitzt eigene Inhalte, Ordnung und Suchindizes. Neuere Typen zeigen beim Anlegen ihre Phase an (Beta, Alpha oder Pre-Alpha).', icon: 'archive' },
    { eyebrow: 'Begriff 2', title: 'Drei Arten von Unterstützung', summary: 'Schreiben, Bedeutungssuche und Sprache nutzen unterschiedliche Werkzeuge.', body: 'Dialogmodelle schreiben und erklären. Embeddings finden inhaltlich ähnliche Textstellen. Sprachmodelle wandeln Aufnahmen in Text um oder lesen Texte vor.', icon: 'layers' },
    { eyebrow: 'Ohne externen Dienst', title: 'Modelle auf Ihrem Gerät', summary: 'Nodus kann Modelle für die lokale Nutzung herunterladen.', body: 'Damit können Sie chatten, zusammenfassen und Bilder verstehen, ohne Inhalte an ein anderes Unternehmen zu senden. Der Download ist freiwillig. Größere Modelle benötigen mehr Speicher.', icon: 'settings' },
    { eyebrow: 'Externe Dienste', title: 'Einen Anbieter verbinden', summary: 'Onlinedienste benötigen einen persönlichen Zugangsschlüssel.', body: 'Erstellen Sie beim gewählten Dienst einen Schlüssel, tragen Sie ihn unter Einstellungen ein und testen Sie die Verbindung. Ein API-Schlüssel ist wie ein Passwort.', tip: 'Teilen Sie den Schlüssel niemals. Andere könnten Ihr Guthaben oder Ihre Limits verwenden.', icon: 'key' },
    { eyebrow: 'Kostenlos starten', title: 'Kostenlose Angebote haben Grenzen', summary: 'Kostenlos bedeutet nicht unbegrenzt.', body: 'OpenRouter, Groq, Cerebras und Gemini bieten einige kostenlose Möglichkeiten. Modelle, Limits und Bedingungen können sich ändern.', icon: 'star' },
    { eyebrow: 'Kosten kontrollieren', title: 'Preise verstehen', summary: 'Die Kosten hängen vor allem von gesendetem und erzeugtem Text ab.', body: 'Kurze Anfragen sind meist günstig. Lange Dokumente, lange Antworten, Schlussfolgerungen und Zusatzfunktionen erhöhen den Preis.', tip: 'Prüfen Sie den aktuellen Preis beim Anbieter und legen Sie ein Budget fest.', icon: 'chartBar' },
    { eyebrow: 'Begriff 3', title: 'Verwandte Ideen finden', summary: 'Nodus findet Texte mit ähnlicher Bedeutung trotz anderer Wörter.', body: 'Text wird in Abschnitte geteilt und in numerische Darstellungen umgewandelt, die Embeddings heißen. RAG (Retrieval-Augmented Generation) ruft zuerst relevante Informationen ab und gibt sie dann einem generativen Modell als Kontext. In Nodus wählen Embeddings die zur Frage passendsten Passagen und Ideen aus Ihrem Vault aus; Chat-, Forschungs- und Schreibfunktionen können damit quellenbasierte Antworten erzeugen, ohne jedes Mal den gesamten Korpus zu senden. Prüfen Sie stets die Quellen.', tip: 'Nach einem Wechsel des Embedding-Modells müssen die Inhalte neu verarbeitet werden.', icon: 'network' },
    { eyebrow: 'Suche vorbereiten', title: 'Eine mehrsprachige Option wählen', summary: 'Das Modell sollte zu den Sprachen Ihrer Dokumente passen.', body: 'Nodus bietet lokal Harrier, BGE-M3, GTE Multilingual und Multilingual E5. Über das Internet können Sie auch OpenAI text-embedding-3 verwenden.', icon: 'languages' },
    { eyebrow: 'KI-Bilder', title: 'Bilder erstellen und verstehen', summary: 'Ein Bild untersuchen und ein neues Bild erzeugen sind verschiedene Aufgaben.', body: 'Sie können ein Foto oder Diagramm beschreiben lassen. Mit einem kompatiblen Dienst kann Nodus aus Ihrer Beschreibung auch eine neue Illustration erzeugen.', tip: 'Prüfen Sie das Ergebnis. Erzeugte Bilder können Fehler enthalten und Kosten verursachen.', icon: 'image' },
    { eyebrow: 'Integriertes Audio', title: 'Transkribieren und anhören', summary: 'Sprache wird zu Text und Text zu Sprache.', body: 'Nodus kann Vorlesungen, Interviews und Sprachnotizen transkribieren. Es kann Dokumente auch vorlesen. Prüfen Sie Transkriptionen immer nach.', icon: 'microphone' },
    { eyebrow: 'Sicher anfangen', title: 'Ihre erste Einrichtung', summary: 'Beginnen Sie klein und erweitern Sie erst nach der Prüfung.', body: 'Erstellen Sie einen Vault, importieren Sie wenige Inhalte, wählen Sie Modelle und prüfen Sie die Ergebnisse. Antworten sollten auf Ihren Quellen beruhen. Erstellen Sie Sicherungen.', icon: 'check' },
    { eyebrow: 'Ihr Begleiter', title: 'Lernen Sie Nodi kennen', summary: 'Nodi vereint Chat, Benachrichtigungen und Hilfe und ist vollständig optional.', body: 'Nodi kann Dokumentation, aktuelle Ansicht, aktiven Vault oder alle Vaults als Kontext verwenden. Unter Einstellungen → Oberfläche → Nodi-Maskottchen können Sie Nodi deaktivieren, sein Chatmodell wählen, es über anderen Apps anzeigen und die Vault-Accessoires verwalten.', icon: 'star' },
  ],
  it: [
    { eyebrow: 'Inizia qui', title: 'Benvenuto in Nodus', summary: 'Uno spazio locale che riunisce e collega i tuoi contenuti.', body: 'Nodus organizza documenti, note, dati e fonti in spazi separati. Puoi cercare, scoprire collegamenti e usare i contenuti per studiare, fare ricerca o scrivere.', tip: 'Gli spazi restano sul tuo dispositivo. Il contenuto esce solo quando scegli un servizio esterno.', icon: 'network' },
    { eyebrow: 'Concetto 1', title: 'Che cos’è un vault?', summary: 'Un vault è uno spazio indipendente dedicato a un progetto.', body: 'Nodus offre nove tipi di vault: accademico, fonti primarie, testimonianze, database, insegnamento, studio, genealogia, prosopografia e worldbuilding. Ogni vault conserva contenuti, organizzazione e indici propri. I tipi più recenti indicano la loro fase (beta, alfa o pre-alfa) al momento della creazione.', icon: 'archive' },
    { eyebrow: 'Concetto 2', title: 'Tre tipi di aiuto', summary: 'Scrittura, ricerca per significato e voce usano strumenti diversi.', body: 'I modelli conversazionali scrivono e spiegano. Gli embedding trovano brani con significato simile. I modelli vocali trascrivono registrazioni o leggono testi ad alta voce.', icon: 'layers' },
    { eyebrow: 'Senza servizi esterni', title: 'Modelli sul tuo dispositivo', summary: 'Nodus può scaricare modelli preparati per l’uso locale.', body: 'Permettono di conversare, riassumere e comprendere immagini senza inviare contenuti a un’altra azienda. Il download è facoltativo e i modelli grandi richiedono più memoria.', icon: 'settings' },
    { eyebrow: 'Servizi esterni', title: 'Collega un fornitore', summary: 'I servizi online usano una chiave di accesso personale.', body: 'Crea una chiave nel servizio scelto, inseriscila nelle Impostazioni e verifica la connessione. Una chiave API è simile a una password.', tip: 'Non condividerla. Altre persone potrebbero consumare il tuo credito o i tuoi limiti.', icon: 'key' },
    { eyebrow: 'Inizia gratis', title: 'Le opzioni gratuite hanno limiti', summary: 'Gratuito non significa illimitato.', body: 'OpenRouter, Groq, Cerebras e Gemini offrono alcune possibilità gratuite. Modelli, limiti e condizioni possono cambiare.', icon: 'star' },
    { eyebrow: 'Costo controllato', title: 'Comprendi i prezzi', summary: 'Il costo dipende soprattutto dal testo inviato e generato.', body: 'Le richieste brevi costano poco. Documenti lunghi, risposte estese, ragionamento e funzioni aggiuntive aumentano il prezzo.', tip: 'Controlla sempre il prezzo attuale e imposta un budget.', icon: 'chartBar' },
    { eyebrow: 'Concetto 3', title: 'Trova idee correlate', summary: 'Nodus trova testi dal significato simile anche con parole diverse.', body: 'Il testo viene diviso in brani e trasformato in rappresentazioni numeriche chiamate embedding. Il RAG (generazione aumentata dal recupero) recupera prima le informazioni pertinenti e poi le fornisce come contesto a un modello generativo. In Nodus, gli embedding selezionano i brani e le idee del vault più vicini alla domanda; le funzioni di chat, ricerca e scrittura possono usarli per rispondere sulla base delle fonti senza inviare ogni volta l’intero corpus. Verifica sempre i riferimenti.', tip: 'Se cambi modello di embedding dovrai elaborare nuovamente i contenuti.', icon: 'network' },
    { eyebrow: 'Prepara la ricerca', title: 'Scegli un’opzione multilingue', summary: 'Il modello deve essere adatto alle lingue dei documenti.', body: 'Nodus offre localmente Harrier, BGE-M3, GTE Multilingual e Multilingual E5. Puoi anche usare OpenAI text-embedding-3 tramite internet.', icon: 'languages' },
    { eyebrow: 'Immagini con IA', title: 'Crea e comprendi immagini', summary: 'Analizzare un’immagine e crearne una nuova sono attività diverse.', body: 'Puoi chiedere la descrizione di una fotografia o di un grafico. Con un servizio compatibile Nodus può anche creare una nuova illustrazione dalla tua descrizione.', tip: 'Controlla il risultato. Le immagini generate possono contenere errori e avere un costo.', icon: 'image' },
    { eyebrow: 'Audio integrato', title: 'Trascrivi e ascolta', summary: 'Trasforma la voce in testo e il testo in voce.', body: 'Nodus può trascrivere lezioni, interviste e note vocali. Può anche leggere i documenti ad alta voce. Rivedi sempre le trascrizioni.', icon: 'microphone' },
    { eyebrow: 'Inizia in sicurezza', title: 'La prima configurazione', summary: 'Inizia con pochi contenuti e amplia dopo aver verificato i risultati.', body: 'Crea un vault, importa alcuni contenuti, scegli i modelli e controlla i risultati. Verifica che le risposte usino le tue fonti e crea copie di sicurezza.', icon: 'check' },
    { eyebrow: 'Il tuo assistente', title: 'Conosci Nodi', summary: 'Nodi riunisce chat, notifiche e aiuto ed è completamente facoltativo.', body: 'Nodi può usare come contesto la documentazione, la vista corrente, il vault attivo o tutti i vault. In Impostazioni → Interfaccia → Mascotte Nodi puoi disattivarlo, scegliere il modello di chat, tenerlo sopra le altre app e gestire gli accessori legati al vault.', icon: 'star' },
  ],
  pt: [
    { eyebrow: 'Comece aqui', title: 'Bem-vindo ao Nodus', summary: 'Um espaço local que reúne e relaciona os seus conteúdos.', body: 'O Nodus organiza documentos, notas, dados e fontes em espaços separados. Pode pesquisar, descobrir relações e usar os conteúdos para estudar, investigar ou escrever.', tip: 'Os espaços ficam no seu dispositivo. O conteúdo só sai quando escolhe um serviço externo.', icon: 'network' },
    { eyebrow: 'Conceito 1', title: 'O que é um cofre?', summary: 'Um cofre é um espaço independente dedicado a um projeto.', body: 'O Nodus oferece nove tipos de cofre: académico, fontes primárias, testemunhos, bases de dados, ensino, estudo, genealogia, prosopografia e worldbuilding. Cada cofre mantém os seus próprios conteúdos, organização e índices. Os tipos mais recentes indicam a sua fase (beta, alfa ou pré-alfa) quando são criados.', icon: 'archive' },
    { eyebrow: 'Conceito 2', title: 'Três tipos de ajuda', summary: 'Escrita, pesquisa por significado e voz usam ferramentas diferentes.', body: 'Os modelos de conversa escrevem e explicam. Os embeddings encontram trechos com significado semelhante. Os modelos de voz transcrevem gravações ou leem textos em voz alta.', icon: 'layers' },
    { eyebrow: 'Sem serviços externos', title: 'Modelos no seu dispositivo', summary: 'O Nodus pode descarregar modelos preparados para utilização local.', body: 'Permitem conversar, resumir e compreender imagens sem enviar conteúdos para outra empresa. O download é opcional e os modelos maiores precisam de mais memória.', icon: 'settings' },
    { eyebrow: 'Serviços externos', title: 'Ligue um fornecedor', summary: 'Os serviços online usam uma chave de acesso pessoal.', body: 'Crie uma chave no serviço escolhido, coloque-a nas Definições e teste a ligação. Uma chave API é semelhante a uma palavra-passe.', tip: 'Nunca partilhe a chave. Outras pessoas podem consumir o seu saldo ou limites.', icon: 'key' },
    { eyebrow: 'Comece grátis', title: 'As opções gratuitas têm limites', summary: 'Grátis não significa ilimitado.', body: 'OpenRouter, Groq, Cerebras e Gemini oferecem algumas possibilidades gratuitas. Os modelos, limites e condições podem mudar.', icon: 'star' },
    { eyebrow: 'Custo controlado', title: 'Compreenda os preços', summary: 'O custo depende sobretudo do texto enviado e gerado.', body: 'Os pedidos curtos costumam ser baratos. Documentos longos, respostas extensas, raciocínio e funções adicionais aumentam o preço.', tip: 'Consulte sempre o preço atual e defina um orçamento.', icon: 'chartBar' },
    { eyebrow: 'Conceito 3', title: 'Encontre ideias relacionadas', summary: 'O Nodus encontra textos de significado semelhante mesmo com palavras diferentes.', body: 'O texto é dividido em trechos e transformado em representações numéricas chamadas embeddings. O RAG (geração aumentada por recuperação) recupera primeiro a informação relevante e fornece-a depois como contexto a um modelo generativo. No Nodus, os embeddings selecionam os trechos e ideias do cofre mais próximos da pergunta; as funções de chat, investigação e escrita podem usá-los para responder com base nas suas fontes sem enviar todo o corpus. Verifique sempre as referências.', tip: 'Se mudar o modelo de embeddings terá de processar novamente os conteúdos.', icon: 'network' },
    { eyebrow: 'Prepare a pesquisa', title: 'Escolha uma opção multilingue', summary: 'O modelo deve ser adequado às línguas dos documentos.', body: 'O Nodus oferece localmente Harrier, BGE-M3, GTE Multilingual e Multilingual E5. Também pode usar OpenAI text-embedding-3 através da internet.', icon: 'languages' },
    { eyebrow: 'Imagens com IA', title: 'Crie e compreenda imagens', summary: 'Analisar uma imagem e criar uma nova são tarefas diferentes.', body: 'Pode pedir a descrição de uma fotografia ou gráfico. Com um serviço compatível, o Nodus também pode criar uma ilustração a partir da sua descrição.', tip: 'Verifique o resultado. As imagens geradas podem conter erros e ter custos.', icon: 'image' },
    { eyebrow: 'Áudio integrado', title: 'Transcreva e ouça', summary: 'Transforme voz em texto e texto em voz.', body: 'O Nodus pode transcrever aulas, entrevistas e notas de voz. Também pode ler documentos em voz alta. Reveja sempre as transcrições.', icon: 'microphone' },
    { eyebrow: 'Comece em segurança', title: 'A sua primeira configuração', summary: 'Comece com poucos conteúdos e amplie depois de verificar os resultados.', body: 'Crie um cofre, importe alguns conteúdos, escolha os modelos e confirme os resultados. Verifique se as respostas usam as suas fontes e faça cópias de segurança.', icon: 'check' },
    { eyebrow: 'O seu acompanhante', title: 'Conheça o Nodi', summary: 'O Nodi reúne chat, notificações e ajuda e é totalmente opcional.', body: 'O Nodi pode usar a documentação, a vista atual, o cofre ativo ou todos os cofres como contexto. Em Definições → Interface → Mascote Nodi pode desativá-lo, escolher o modelo de chat, mantê-lo sobre outras aplicações e gerir os acessórios de cada cofre.', icon: 'star' },
  ],
  'pt-BR': [
    { eyebrow: 'Comece aqui', title: 'Boas-vindas ao Nodus', summary: 'Um espaço local para reunir e conectar seus conteúdos.', body: 'O Nodus organiza documentos, notas, dados e fontes em espaços separados. Você pode pesquisar, descobrir relações e usar tudo isso para estudar, pesquisar ou escrever.', tip: 'Seus espaços ficam no seu dispositivo. O conteúdo só sai quando você escolhe um serviço externo.', icon: 'network' },
    { eyebrow: 'Conceito 1', title: 'O que é um cofre?', summary: 'Um cofre é um espaço independente dedicado a um projeto.', body: 'O Nodus oferece nove tipos de cofre: acadêmico, fontes primárias, depoimentos, bancos de dados, ensino, estudo, genealogia, prosopografia e worldbuilding. Cada cofre mantém conteúdos, organização e índices próprios. Os tipos mais recentes mostram sua fase (beta, alfa ou pré-alfa) quando são criados.', icon: 'archive' },
    { eyebrow: 'Conceito 2', title: 'Três tipos de ajuda', summary: 'Escrita, busca por significado e voz usam ferramentas diferentes.', body: 'Os modelos de conversa escrevem e explicam. Os embeddings encontram trechos com sentido parecido. Os modelos de voz transcrevem gravações ou leem textos em voz alta.', icon: 'layers' },
    { eyebrow: 'Sem serviços externos', title: 'Modelos no seu dispositivo', summary: 'O Nodus pode baixar modelos preparados para uso local.', body: 'Eles permitem conversar, resumir e compreender imagens sem enviar conteúdo para outra empresa. O download é opcional e modelos maiores exigem mais memória.', icon: 'settings' },
    { eyebrow: 'Serviços externos', title: 'Conecte um provedor', summary: 'Serviços online usam uma chave pessoal de acesso.', body: 'Crie uma chave no serviço escolhido, cole em Configurações e teste a conexão. Uma chave de API funciona como uma senha.', tip: 'Nunca compartilhe a chave. Outras pessoas podem consumir seu saldo ou seus limites.', icon: 'key' },
    { eyebrow: 'Comece grátis', title: 'As opções gratuitas têm limites', summary: 'Grátis não significa ilimitado.', body: 'OpenRouter, Groq, Cerebras e Gemini oferecem algumas opções gratuitas. Os modelos, limites e condições podem mudar.', icon: 'star' },
    { eyebrow: 'Custo controlado', title: 'Entenda os preços', summary: 'O custo depende principalmente do texto enviado e gerado.', body: 'Pedidos curtos costumam custar pouco. Documentos longos, respostas extensas, raciocínio e funções adicionais aumentam o preço.', tip: 'Confira sempre o preço atual e defina um orçamento.', icon: 'chartBar' },
    { eyebrow: 'Conceito 3', title: 'Encontre ideias relacionadas', summary: 'O Nodus encontra textos com significado parecido mesmo usando palavras diferentes.', body: 'O texto é dividido em trechos e convertido em representações numéricas chamadas embeddings. RAG (geração aumentada por recuperação) primeiro recupera informações relevantes e depois as fornece como contexto a um modelo generativo. No Nodus, os embeddings selecionam os trechos e ideias do cofre mais próximos da pergunta; os recursos de chat, pesquisa e escrita podem usá-los para responder com base nas suas fontes sem enviar todo o corpus. Sempre confira as referências.', tip: 'Ao trocar o modelo de embeddings, será necessário processar os conteúdos novamente.', icon: 'network' },
    { eyebrow: 'Prepare a busca', title: 'Escolha uma opção multilíngue', summary: 'O modelo deve combinar com os idiomas dos seus documentos.', body: 'O Nodus oferece Harrier, BGE-M3, GTE Multilingual e Multilingual E5 localmente. Também é possível usar OpenAI text-embedding-3 pela internet.', icon: 'languages' },
    { eyebrow: 'Imagens com IA', title: 'Crie e compreenda imagens', summary: 'Analisar uma imagem e criar outra são tarefas diferentes.', body: 'Você pode pedir a descrição de uma foto ou gráfico. Com um serviço compatível, o Nodus também pode criar uma ilustração a partir da sua descrição.', tip: 'Revise o resultado. Imagens geradas podem conter erros e ter custos.', icon: 'image' },
    { eyebrow: 'Áudio integrado', title: 'Transcreva e escute', summary: 'Transforme voz em texto e texto em voz.', body: 'O Nodus pode transcrever aulas, entrevistas e notas de voz. Também pode ler documentos em voz alta. Sempre revise as transcrições.', icon: 'microphone' },
    { eyebrow: 'Comece com segurança', title: 'Sua primeira configuração', summary: 'Comece com poucos conteúdos e aumente depois de verificar os resultados.', body: 'Crie um cofre, importe alguns conteúdos, escolha os modelos e confira os resultados. Garanta que as respostas usem suas fontes e faça backups.', icon: 'check' },
    { eyebrow: 'Seu companheiro', title: 'Conheça o Nodi', summary: 'O Nodi reúne chat, notificações e ajuda e é totalmente opcional.', body: 'O Nodi pode usar a documentação, a tela atual, o cofre ativo ou todos os cofres como contexto. Em Configurações → Interface → Mascote Nodi, você pode desativá-lo, escolher o modelo de chat, mantê-lo sobre outros aplicativos e gerenciar os acessórios de cada cofre.', icon: 'star' },
  ],
  zh: [
    { eyebrow: '从这里开始', title: '欢迎使用 Nodus', summary: '一个在本机整理并连接资料的工作空间。', body: 'Nodus 将文档、笔记、数据和来源保存在不同空间中。你可以搜索内容、发现联系，并在学习、研究或写作时使用它们。', tip: '工作空间保存在你的设备上。只有主动选择外部服务时，内容才会离开设备。', icon: 'network' },
    { eyebrow: '概念一', title: '什么是资料库？', summary: '资料库是为一个项目建立的独立工作空间。', body: '资料库共有九种类型：学术研究、原始资料、口述证词、数据库、教学、学习、家谱、群体传记（prosopography）和世界观构建（worldbuilding）。每个资料库都有自己的内容、结构和索引。较新的类型在创建时会标明所处阶段（Beta、Alpha 或 Pre-Alpha）。', icon: 'archive' },
    { eyebrow: '概念二', title: '三种不同的帮助', summary: '写作、语义搜索和语音使用不同工具。', body: '对话模型负责写作和解释。嵌入模型寻找含义相近的段落。语音模型把录音转成文字，也可以朗读文字。', icon: 'layers' },
    { eyebrow: '无需外部服务', title: '在设备上运行的模型', summary: 'Nodus 可以下载为本地运行准备的模型。', body: '这些模型可以聊天、总结和理解图片，无需把内容发送给其他公司。下载是可选的，较大的模型需要更多内存。', icon: 'settings' },
    { eyebrow: '外部服务', title: '连接服务提供商', summary: '在线服务需要个人访问密钥。', body: '在所选服务中创建密钥，将它填入设置并测试连接。API 密钥类似密码。', tip: '不要分享密钥，其他人可能消耗你的余额或使用额度。', icon: 'key' },
    { eyebrow: '免费开始', title: '免费选项也有限制', summary: '免费并不代表无限使用。', body: 'OpenRouter、Groq、Cerebras 和 Gemini 提供部分免费选项。可用模型、限制和条件可能变化。', icon: 'star' },
    { eyebrow: '控制成本', title: '了解价格', summary: '费用主要取决于发送和生成的文字量。', body: '短请求通常费用很低。长文档、长回答、推理和附加功能会增加费用。', tip: '请查看服务商的最新价格并设置预算。', icon: 'chartBar' },
    { eyebrow: '概念三', title: '寻找相关想法', summary: '即使措辞不同，Nodus 也能找到含义相近的文字。', body: '文本会被分成片段并转换为称作嵌入的数字表示。RAG（检索增强生成）先检索相关信息，再把它作为上下文交给生成模型。在 Nodus 中，嵌入会选出资料库里与问题最接近的段落和想法；聊天、研究与写作功能可利用这些内容，依据你的来源生成回答，而不必每次发送整个资料库。请始终核对引用来源。', tip: '更换嵌入模型后，需要重新处理资料。', icon: 'network' },
    { eyebrow: '准备搜索', title: '选择多语言模型', summary: '模型应当适合文档所使用的语言。', body: 'Nodus 本地提供 Harrier、BGE-M3、GTE Multilingual 和 Multilingual E5，也可以通过网络使用 OpenAI text-embedding-3。', icon: 'languages' },
    { eyebrow: 'AI 图片', title: '创建和理解图片', summary: '分析图片和生成新图片是两项不同任务。', body: '你可以让模型描述照片或图表。连接兼容服务后，Nodus 也能根据文字描述生成新的插图。', tip: '请检查结果。生成图片可能包含错误，也可能产生费用。', icon: 'image' },
    { eyebrow: '内置音频', title: '转写与朗读', summary: '把语音转成文字，也把文字转成语音。', body: 'Nodus 可以转写课程、访谈和语音笔记，也能朗读文档。请始终检查转写结果。', icon: 'microphone' },
    { eyebrow: '安全开始', title: '第一次设置', summary: '先用少量资料测试，确认结果后再扩展。', body: '创建资料库，导入少量内容，选择模型并检查结果。确认回答依据你的来源，同时定期备份。', icon: 'check' },
    { eyebrow: '你的助手', title: '认识 Nodi', summary: 'Nodi 集成了聊天、通知和帮助，并且完全可以关闭。', body: 'Nodi 可以把文档、当前页面、当前资料库或全部资料库作为上下文。在“设置 → 界面 → Nodi 吉祥物”中，你可以关闭 Nodi、选择聊天模型、让它始终显示在其他应用上方，并管理不同资料库的配饰。', icon: 'star' },
  ],
  'zh-CN': [
    { eyebrow: '从这里开始', title: '欢迎使用 Nodus', summary: '一个在本机整理并连接资料的工作空间。', body: 'Nodus 将文档、笔记、数据和来源保存在不同空间中。你可以搜索内容、发现联系，并在学习、研究或写作时使用它们。', tip: '工作空间保存在你的设备上。只有主动选择外部服务时，内容才会离开设备。', icon: 'network' },
    { eyebrow: '概念一', title: '什么是资料库？', summary: '资料库是为一个项目建立的独立工作空间。', body: '资料库共有九种类型：学术研究、原始资料、口述证词、数据库、教学、学习、家谱、群体传记（prosopography）和世界观构建（worldbuilding）。每个资料库都有自己的内容、结构和索引。较新的类型在创建时会标明所处阶段（Beta、Alpha 或 Pre-Alpha）。', icon: 'archive' },
    { eyebrow: '概念二', title: '三种不同的帮助', summary: '写作、语义搜索和语音使用不同工具。', body: '对话模型负责写作和解释。嵌入模型寻找含义相近的段落。语音模型把录音转成文字，也可以朗读文字。', icon: 'layers' },
    { eyebrow: '无需外部服务', title: '在设备上运行的模型', summary: 'Nodus 可以下载为本地运行准备的模型。', body: '这些模型可以聊天、总结和理解图片，无需把内容发送给其他公司。下载是可选的，较大的模型需要更多内存。', icon: 'settings' },
    { eyebrow: '外部服务', title: '连接服务提供商', summary: '在线服务需要个人访问密钥。', body: '在所选服务中创建密钥，将它填入设置并测试连接。API 密钥类似密码。', tip: '不要分享密钥，其他人可能消耗你的余额或使用额度。', icon: 'key' },
    { eyebrow: '免费开始', title: '免费选项也有限制', summary: '免费并不代表无限使用。', body: 'OpenRouter、Groq、Cerebras 和 Gemini 提供部分免费选项。可用模型、限制和条件可能变化。', icon: 'star' },
    { eyebrow: '控制成本', title: '了解价格', summary: '费用主要取决于发送和生成的文字量。', body: '短请求通常费用很低。长文档、长回答、推理和附加功能会增加费用。', tip: '请查看服务商的最新价格并设置预算。', icon: 'chartBar' },
    { eyebrow: '概念三', title: '寻找相关想法', summary: '即使措辞不同，Nodus 也能找到含义相近的文字。', body: '文本会被分成片段并转换为称作嵌入的数字表示。RAG（检索增强生成）先检索相关信息，再把它作为上下文交给生成模型。在 Nodus 中，嵌入会选出资料库里与问题最接近的段落和想法；聊天、研究与写作功能可利用这些内容，依据你的来源生成回答，而不必每次发送整个资料库。请始终核对引用来源。', tip: '更换嵌入模型后，需要重新处理资料。', icon: 'network' },
    { eyebrow: '准备搜索', title: '选择多语言模型', summary: '模型应当适合文档所使用的语言。', body: 'Nodus 本地提供 Harrier、BGE-M3、GTE Multilingual 和 Multilingual E5，也可以通过网络使用 OpenAI text-embedding-3。', icon: 'languages' },
    { eyebrow: 'AI 图片', title: '创建和理解图片', summary: '分析图片和生成新图片是两项不同任务。', body: '你可以让模型描述照片或图表。连接兼容服务后，Nodus 也能根据文字描述生成新的插图。', tip: '请检查结果。生成图片可能包含错误，也可能产生费用。', icon: 'image' },
    { eyebrow: '内置音频', title: '转写与朗读', summary: '把语音转成文字，也把文字转成语音。', body: 'Nodus 可以转写课程、访谈和语音笔记，也能朗读文档。请始终检查转写结果。', icon: 'microphone' },
    { eyebrow: '安全开始', title: '第一次设置', summary: '先用少量资料测试，确认结果后再扩展。', body: '创建资料库，导入少量内容，选择模型并检查结果。确认回答依据你的来源，同时定期备份。', icon: 'check' },
    { eyebrow: '你的助手', title: '认识 Nodi', summary: 'Nodi 集成了聊天、通知和帮助，并且完全可以关闭。', body: 'Nodi 可以把文档、当前页面、当前资料库或全部资料库作为上下文。在“设置 → 界面 → Nodi 吉祥物”中，你可以关闭 Nodi、选择聊天模型、让它始终显示在其他应用上方，并管理不同资料库的配饰。', icon: 'star' },
  ],
  'zh-TW': [
    { eyebrow: '從這裡開始', title: '歡迎使用 Nodus', summary: '一個在本機整理並連結資料的工作空間。', body: 'Nodus 將文件、筆記、數據和來源分別放在不同的空間中。你可以搜尋內容、發現關聯，並在學習、研究或寫作時運用它們。', tip: '工作空間儲存在你的裝置上。只有在你主動選擇外部服務時，內容才會離開裝置。', icon: 'network' },
    { eyebrow: '概念一', title: '什麼是知識庫？', summary: '知識庫是為一個專案建立的獨立工作空間。', body: '知識庫共有九種類型：學術研究、原始史料、口述證詞、資料庫、教學、學習、家譜、群體傳記（prosopography）和世界觀建構（worldbuilding）。每個知識庫都有自己的內容、結構和索引。較新的類型在建立時會標示所處階段（Beta、Alpha 或 Pre-Alpha）。', icon: 'archive' },
    { eyebrow: '概念二', title: '三種不同的協助', summary: '寫作、語意搜尋和語音使用不同的工具。', body: '對話模型負責撰寫和解釋。嵌入模型尋找意思相近的段落。語音模型把錄音轉成文字，也能朗讀文字。', icon: 'layers' },
    { eyebrow: '不需外部服務', title: '在你的裝置上執行的模型', summary: 'Nodus 可以下載專為本機執行準備的模型。', body: '這些模型可以聊天、摘要和理解圖片，不必把內容傳送給其他公司。下載為選用項目，較大的模型需要更多記憶體。', icon: 'settings' },
    { eyebrow: '外部服務', title: '連接服務供應商', summary: '線上服務需要個人存取金鑰。', body: '在所選服務中建立金鑰，貼到設定中並測試連線。API 金鑰就像密碼一樣。', tip: '請勿分享金鑰，其他人可能會用掉你的餘額或使用額度。', icon: 'key' },
    { eyebrow: '免費開始', title: '免費方案也有限制', summary: '免費不代表無限使用。', body: 'OpenRouter、Groq、Cerebras 和 Gemini 提供部分免費選項。可用模型、限制和條款都可能變動。', icon: 'star' },
    { eyebrow: '控制成本', title: '了解價格', summary: '費用主要取決於傳送和產生的文字量。', body: '簡短的請求通常費用很低。長文件、長回答、推理和額外功能會提高費用。', tip: '請查看供應商的最新價格並設定預算。', icon: 'chartBar' },
    { eyebrow: '概念三', title: '尋找相關想法', summary: '即使用詞不同，Nodus 也能找到意思相近的文字。', body: '文字會被切分成片段，並轉換成稱為嵌入（embedding）的數值表示。RAG（檢索增強生成）會先檢索相關資訊，再把它作為上下文交給生成模型。在 Nodus 中，嵌入會從知識庫中選出與問題最接近的段落和想法；聊天、研究與寫作功能可以利用這些內容，根據你的來源產生回答，而不必每次都傳送整個語料。請務必核對引用來源。', tip: '更換嵌入模型後，需要重新處理你的資料。', icon: 'network' },
    { eyebrow: '準備搜尋', title: '選擇多語言模型', summary: '模型應該適合文件所使用的語言。', body: 'Nodus 在本機提供 Harrier、BGE-M3、GTE Multilingual 和 Multilingual E5，也可以透過網路使用 OpenAI text-embedding-3。', icon: 'languages' },
    { eyebrow: 'AI 圖片', title: '建立與理解圖片', summary: '分析圖片和產生新圖片是兩種不同的任務。', body: '你可以請模型描述照片或圖表。連接相容的服務後，Nodus 也能根據你的文字描述產生新的插圖。', tip: '請檢查結果。產生的圖片可能有錯誤，也可能需要付費。', icon: 'image' },
    { eyebrow: '內建音訊', title: '轉錄與朗讀', summary: '把語音轉成文字，也把文字轉成語音。', body: 'Nodus 可以轉錄課程、訪談和語音筆記，也能朗讀文件。請務必檢查轉錄結果。', icon: 'microphone' },
    { eyebrow: '安全起步', title: '第一次設定', summary: '先用少量資料測試，確認結果後再擴大範圍。', body: '建立知識庫、匯入少量內容、選擇模型並檢查結果。確認回答以你的來源為依據，並定期備份。', icon: 'check' },
    { eyebrow: '你的夥伴', title: '認識 Nodi', summary: 'Nodi 整合了聊天、通知和說明，而且可以完全關閉。', body: 'Nodi 可以把說明文件、目前畫面、目前的知識庫或所有知識庫當作上下文。在「設定 → 介面 → Nodi 吉祥物」中，你可以關閉 Nodi、選擇它的聊天模型、讓它顯示在其他應用程式上方，並管理各知識庫的配件。', icon: 'star' },
  ],
  ja: [
    { eyebrow: 'ここから開始', title: 'Nodusへようこそ', summary: '資料を集めて関連付けるローカルな作業空間です。', body: 'Nodusは文書、ノート、データ、資料を別々の空間に整理します。検索や関連の発見を行い、学習、研究、執筆に利用できます。', tip: '作業空間は端末に保存されます。外部サービスを選んだ場合だけ内容が端末の外へ送られます。', icon: 'network' },
    { eyebrow: '概念1', title: 'Vaultとは？', summary: 'Vaultは一つのプロジェクトのための独立した作業空間です。', body: 'Vaultには9つの種類があります：学術、一次資料、証言、データベース、教育、学習、系譜、プロソポグラフィー、世界構築。各Vaultは独自の資料、整理方法、索引を持ちます。新しい種類は作成時に開発段階（ベータ、アルファ、プレアルファ）を表示します。', icon: 'archive' },
    { eyebrow: '概念2', title: '三つの支援方法', summary: '文章、意味検索、音声には異なる道具を使います。', body: '会話モデルは文章を書き説明します。Embeddingは意味の近い箇所を探します。音声モデルは録音を文字にし、文章を読み上げます。', icon: 'layers' },
    { eyebrow: '外部サービスなし', title: '端末で動くモデル', summary: 'Nodusはローカル実行用のモデルをダウンロードできます。', body: '内容を他社へ送らずに会話、要約、画像理解を行えます。ダウンロードは任意で、大きいモデルほど多くのメモリが必要です。', icon: 'settings' },
    { eyebrow: '外部サービス', title: 'プロバイダーを接続', summary: 'オンラインサービスには個人用のアクセスキーが必要です。', body: '利用するサービスでキーを作成し、設定に貼り付けて接続を確認します。APIキーはパスワードに似ています。', tip: 'キーを共有しないでください。残高や利用上限を他人に使われる可能性があります。', icon: 'key' },
    { eyebrow: '無料で開始', title: '無料プランにも制限があります', summary: '無料は無制限という意味ではありません。', body: 'OpenRouter、Groq、Cerebras、Geminiには一部無料の選択肢があります。モデルや制限、条件は変わることがあります。', icon: 'star' },
    { eyebrow: '費用を管理', title: '料金を理解する', summary: '費用は主に送受信する文章量で決まります。', body: '短い依頼は通常安価です。長い文書や回答、推論、追加機能は費用を増やします。', tip: '最新の料金を確認し、予算を設定してください。', icon: 'chartBar' },
    { eyebrow: '概念3', title: '関連する考えを探す', summary: '言葉が違っても意味の近い文章を見つけられます。', body: '文章を小さな箇所に分け、Embeddingと呼ばれる数値表現に変換します。RAG（検索拡張生成）は、まず関連情報を検索し、それを生成モデルの文脈として渡します。Nodusでは、Embeddingが質問に最も近いVault内の箇所や考えを選び、チャット・研究・執筆機能が資料全体を毎回送らずに、出典に基づく回答へ利用できます。参照元は必ず確認してください。', tip: 'Embeddingモデルを変更すると資料の再処理が必要です。', icon: 'network' },
    { eyebrow: '検索の準備', title: '多言語モデルを選ぶ', summary: '文書の言語に合うモデルを選びます。', body: 'NodusはHarrier、BGE-M3、GTE Multilingual、Multilingual E5をローカルで提供します。OpenAI text-embedding-3も利用できます。', icon: 'languages' },
    { eyebrow: 'AI画像', title: '画像を作成して理解する', summary: '画像の分析と新しい画像の生成は別の作業です。', body: '写真やグラフの説明を依頼できます。対応サービスを接続すると、説明文から新しいイラストも生成できます。', tip: '結果を確認してください。生成画像には誤りが含まれ、費用がかかる場合があります。', icon: 'image' },
    { eyebrow: '音声機能', title: '文字起こしと読み上げ', summary: '音声を文字にし、文字を音声にします。', body: '授業、インタビュー、音声メモを文字起こしし、文書を読み上げられます。文字起こしは必ず確認してください。', icon: 'microphone' },
    { eyebrow: '安全に開始', title: '最初の設定', summary: '少量の資料から始め、結果を確認してから広げます。', body: 'Vaultを作成し、少量の資料を取り込み、モデルを選んで結果を確認します。回答が資料に基づくことを確かめ、バックアップを作成してください。', icon: 'check' },
    { eyebrow: 'あなたの相棒', title: 'Nodiを紹介します', summary: 'Nodiはチャット、通知、ヘルプをまとめた機能で、いつでも無効にできます。', body: 'Nodiはドキュメント、現在の画面、使用中のVault、またはすべてのVaultを文脈として利用できます。「設定 → インターフェース → Nodiマスコット」で無効化、チャットモデル、常に手前に表示する設定、Vaultごとのアクセサリーを変更できます。', icon: 'star' },
  ],
  ko: [
    { eyebrow: '여기서 시작하세요', title: 'Nodus에 오신 것을 환영합니다', summary: '자료를 모으고 서로 연결해 주는 로컬 작업 공간입니다.', body: 'Nodus는 문서, 노트, 데이터, 출처를 서로 분리된 공간에 정리합니다. 그 안에서 검색하고, 연관성을 발견하고, 공부나 연구, 글쓰기에 활용할 수 있습니다.', tip: '작업 공간은 사용자의 기기에 저장됩니다. 외부 서비스를 직접 선택할 때만 내용이 기기 밖으로 전송됩니다.', icon: 'network' },
    { eyebrow: '개념 1', title: 'Vault란?', summary: 'Vault는 하나의 프로젝트를 위한 독립된 작업 공간입니다.', body: 'Vault에는 아홉 가지 유형이 있습니다. 학술, 1차 사료, 증언, 데이터베이스, 교육, 학습, 계보, 프로소포그래피(인물 집단 연구), 세계관 구축(worldbuilding)입니다. 각 Vault는 고유한 자료, 구성, 색인을 갖습니다. 새로 추가된 유형은 만들 때 개발 단계(베타, 알파, 프리알파)를 표시합니다.', icon: 'archive' },
    { eyebrow: '개념 2', title: '세 가지 도움', summary: '글쓰기, 의미 검색, 음성에는 서로 다른 도구가 쓰입니다.', body: '대화 모델은 글을 쓰고 설명합니다. 임베딩 모델은 의미가 비슷한 구절을 찾습니다. 음성 모델은 녹음을 텍스트로 바꾸거나 텍스트를 소리 내어 읽어 줍니다.', icon: 'layers' },
    { eyebrow: '외부 서비스 없이', title: '내 기기에서 실행되는 모델', summary: 'Nodus는 로컬 실행용으로 준비된 모델을 내려받을 수 있습니다.', body: '이 모델로 내용을 다른 회사에 보내지 않고도 대화, 요약, 이미지 이해를 할 수 있습니다. 다운로드는 선택 사항이며, 큰 모델일수록 더 많은 메모리가 필요합니다.', icon: 'settings' },
    { eyebrow: '외부 서비스', title: '공급자 연결하기', summary: '온라인 서비스는 개인 접근 키를 사용합니다.', body: '사용할 서비스에서 키를 만들고 설정에 붙여 넣은 뒤 연결을 확인하세요. API 키는 비밀번호와 같습니다.', tip: '키를 절대 공유하지 마세요. 다른 사람이 잔액이나 사용 한도를 소진할 수 있습니다.', icon: 'key' },
    { eyebrow: '무료로 시작하기', title: '무료 옵션에도 한도가 있습니다', summary: '무료라고 해서 무제한은 아닙니다.', body: 'OpenRouter, Groq, Cerebras, Gemini는 일부 무료 옵션을 제공합니다. 사용 가능한 모델, 한도, 조건은 바뀔 수 있습니다.', icon: 'star' },
    { eyebrow: '비용 관리', title: '요금 이해하기', summary: '비용은 주로 주고받는 텍스트의 양에 따라 달라집니다.', body: '짧은 요청은 보통 저렴합니다. 긴 문서, 긴 답변, 추론, 추가 기능은 비용을 높입니다.', tip: '공급자의 최신 요금을 확인하고 예산을 정해 두세요.', icon: 'chartBar' },
    { eyebrow: '개념 3', title: '관련 아이디어 찾기', summary: '단어가 달라도 의미가 비슷한 텍스트를 찾을 수 있습니다.', body: '텍스트를 구절로 나눈 뒤 임베딩이라는 수치 표현으로 바꿉니다. RAG(검색 증강 생성)는 먼저 관련 정보를 찾고, 그 정보를 생성 모델에 맥락으로 제공합니다. Nodus에서는 임베딩이 질문과 가장 가까운 Vault의 구절과 아이디어를 고르고, 채팅·연구·글쓰기 기능은 매번 전체 자료를 보내지 않고도 이를 활용해 출처에 근거한 답변을 만듭니다. 항상 출처를 확인하세요.', tip: '임베딩 모델을 바꾸면 자료를 다시 처리해야 합니다.', icon: 'network' },
    { eyebrow: '검색 준비', title: '다국어 모델 선택하기', summary: '문서에 쓰인 언어에 맞는 모델을 고르세요.', body: 'Nodus는 Harrier, BGE-M3, GTE Multilingual, Multilingual E5를 로컬로 제공합니다. 인터넷을 통해 OpenAI text-embedding-3 모델도 사용할 수 있습니다.', icon: 'languages' },
    { eyebrow: 'AI 이미지', title: '이미지 만들기와 이해하기', summary: '이미지를 분석하는 일과 새 이미지를 만드는 일은 서로 다른 작업입니다.', body: '사진이나 그래프의 설명을 요청할 수 있습니다. 호환되는 서비스를 연결하면 Nodus가 설명을 바탕으로 새 그림을 만들 수도 있습니다.', tip: '결과를 꼭 확인하세요. 생성된 이미지에는 오류가 있을 수 있고 비용이 들 수 있습니다.', icon: 'image' },
    { eyebrow: '내장 오디오', title: '받아쓰기와 듣기', summary: '음성을 텍스트로, 텍스트를 음성으로 바꿉니다.', body: 'Nodus는 강의, 인터뷰, 음성 메모를 텍스트로 받아 적고 문서를 소리 내어 읽어 줄 수 있습니다. 받아 적은 내용은 항상 검토하세요.', icon: 'microphone' },
    { eyebrow: '안전한 시작', title: '첫 설정', summary: '적은 자료로 시작하고 결과를 확인한 뒤 넓혀 가세요.', body: 'Vault를 만들고, 자료를 조금 가져오고, 모델을 고른 다음 결과를 확인하세요. 답변이 내 출처에 근거하는지 확인하고 백업을 만들어 두세요.', icon: 'check' },
    { eyebrow: '당신의 동반자', title: 'Nodi를 소개합니다', summary: 'Nodi는 채팅, 알림, 도움말을 한곳에 모은 동반자이며 언제든 끌 수 있습니다.', body: 'Nodi는 문서, 현재 화면, 활성 Vault 또는 모든 Vault를 맥락으로 사용할 수 있습니다. 설정 → 인터페이스 → Nodi 마스코트에서 Nodi를 끄거나, 채팅 모델을 고르거나, 다른 앱 위에 항상 표시하거나, Vault별 액세서리를 관리할 수 있습니다.', icon: 'star' },
  ],
  ru: [
    { eyebrow: 'Начните здесь', title: 'Добро пожаловать в Nodus', summary: 'Локальное пространство для сбора и связывания материалов.', body: 'Nodus хранит документы, заметки, данные и источники в отдельных пространствах. Вы можете искать, находить связи и использовать материалы для учёбы, исследований и письма.', tip: 'Пространства остаются на вашем устройстве. Данные покидают его только при выборе внешнего сервиса.', icon: 'network' },
    { eyebrow: 'Понятие 1', title: 'Что такое хранилище?', summary: 'Хранилище — независимое пространство для одного проекта.', body: 'В Nodus девять типов хранилищ: академическое, первичные источники, свидетельства, базы данных, преподавание, учёба, генеалогия, просопография и worldbuilding. У каждого хранилища свои материалы, структура и индексы. Новые типы при создании показывают свою стадию (бета, альфа или пре-альфа).', icon: 'archive' },
    { eyebrow: 'Понятие 2', title: 'Три вида помощи', summary: 'Для текста, смыслового поиска и речи используются разные инструменты.', body: 'Диалоговые модели пишут и объясняют. Эмбеддинги находят близкие по смыслу фрагменты. Речевые модели расшифровывают записи и озвучивают текст.', icon: 'layers' },
    { eyebrow: 'Без внешних сервисов', title: 'Модели на вашем устройстве', summary: 'Nodus может загружать модели для локальной работы.', body: 'Они позволяют общаться, делать сводки и понимать изображения без отправки материалов другой компании. Загрузка необязательна, крупным моделям нужно больше памяти.', icon: 'settings' },
    { eyebrow: 'Внешние сервисы', title: 'Подключение провайдера', summary: 'Онлайн-сервисы используют личный ключ доступа.', body: 'Создайте ключ у выбранного сервиса, вставьте его в настройках и проверьте соединение. Ключ API похож на пароль.', tip: 'Не передавайте ключ другим людям. Они могут потратить ваш баланс или лимиты.', icon: 'key' },
    { eyebrow: 'Бесплатный старт', title: 'У бесплатных вариантов есть ограничения', summary: 'Бесплатно не означает без ограничений.', body: 'OpenRouter, Groq, Cerebras и Gemini предлагают некоторые бесплатные возможности. Модели, лимиты и условия могут меняться.', icon: 'star' },
    { eyebrow: 'Контроль стоимости', title: 'Как устроена цена', summary: 'Цена зависит прежде всего от объёма отправленного и созданного текста.', body: 'Короткие запросы обычно недороги. Длинные документы, ответы, рассуждения и дополнительные функции повышают стоимость.', tip: 'Проверяйте актуальные цены и задайте бюджет.', icon: 'chartBar' },
    { eyebrow: 'Понятие 3', title: 'Поиск связанных идей', summary: 'Nodus находит тексты с близким смыслом даже при разных словах.', body: 'Текст делится на фрагменты и превращается в числовые представления, называемые эмбеддингами. RAG (генерация с дополнением извлечёнными данными) сначала находит нужную информацию, а затем передаёт её генеративной модели как контекст. В Nodus эмбеддинги выбирают наиболее близкие к вопросу фрагменты и идеи хранилища; функции чата, исследования и письма могут использовать их для ответа по вашим источникам без отправки всего корпуса. Всегда проверяйте ссылки на источники.', tip: 'После смены модели эмбеддингов материалы нужно обработать заново.', icon: 'network' },
    { eyebrow: 'Подготовка поиска', title: 'Выберите многоязычную модель', summary: 'Модель должна соответствовать языкам документов.', body: 'Локально доступны Harrier, BGE-M3, GTE Multilingual и Multilingual E5. Через интернет можно использовать OpenAI text-embedding-3.', icon: 'languages' },
    { eyebrow: 'Изображения ИИ', title: 'Создание и понимание изображений', summary: 'Анализ изображения и создание нового — разные задачи.', body: 'Можно попросить описать фотографию или диаграмму. Совместимый сервис позволит Nodus создать новую иллюстрацию по описанию.', tip: 'Проверяйте результат. В изображениях возможны ошибки, а генерация может быть платной.', icon: 'image' },
    { eyebrow: 'Встроенное аудио', title: 'Расшифровка и озвучивание', summary: 'Преобразуйте речь в текст, а текст в речь.', body: 'Nodus расшифровывает лекции, интервью и голосовые заметки, а также читает документы вслух. Всегда проверяйте расшифровку.', icon: 'microphone' },
    { eyebrow: 'Безопасное начало', title: 'Первая настройка', summary: 'Начните с небольшого объёма и расширяйтесь после проверки.', body: 'Создайте хранилище, импортируйте несколько материалов, выберите модели и проверьте результат. Ответы должны опираться на источники. Делайте резервные копии.', icon: 'check' },
    { eyebrow: 'Ваш помощник', title: 'Познакомьтесь с Nodi', summary: 'Nodi объединяет чат, уведомления и справку; его можно полностью отключить.', body: 'Nodi может использовать документацию, текущий экран, активное хранилище или все хранилища как контекст. В Настройки → Интерфейс → Маскот Nodi можно отключить его, выбрать модель чата, оставить поверх других приложений и настроить аксессуары для разных хранилищ.', icon: 'star' },
  ],
  uk: [
    { eyebrow: 'Почніть тут', title: 'Ласкаво просимо до Nodus', summary: 'Локальний простір для збирання та поєднання матеріалів.', body: 'Nodus зберігає документи, нотатки, дані й джерела в окремих просторах. Ви можете шукати, знаходити зв’язки та використовувати матеріали для навчання, досліджень і письма.', tip: 'Простори залишаються на вашому пристрої. Дані залишають його лише після вибору зовнішнього сервісу.', icon: 'network' },
    { eyebrow: 'Поняття 1', title: 'Що таке сховище?', summary: 'Сховище — незалежний робочий простір для одного проєкту.', body: 'У Nodus дев’ять типів сховищ: академічне, першоджерела, свідчення, бази даних, викладання, навчання, генеалогія, просопографія та worldbuilding. Кожне сховище має власні матеріали, структуру й індекси. Новіші типи під час створення показують свою стадію (бета, альфа або пре-альфа).', icon: 'archive' },
    { eyebrow: 'Поняття 2', title: 'Три види допомоги', summary: 'Для тексту, пошуку за змістом і мовлення застосовуються різні інструменти.', body: 'Діалогові моделі пишуть і пояснюють. Ембеддинги знаходять близькі за змістом уривки. Мовні моделі розшифровують записи й озвучують текст.', icon: 'layers' },
    { eyebrow: 'Без зовнішніх сервісів', title: 'Моделі на вашому пристрої', summary: 'Nodus може завантажувати моделі для локальної роботи.', body: 'Вони дають змогу спілкуватися, створювати підсумки й розуміти зображення без надсилання матеріалів іншій компанії. Завантаження необов’язкове.', icon: 'settings' },
    { eyebrow: 'Зовнішні сервіси', title: 'Підключення постачальника', summary: 'Онлайн-сервіси використовують особистий ключ доступу.', body: 'Створіть ключ у вибраному сервісі, вставте його в налаштуваннях і перевірте з’єднання. Ключ API схожий на пароль.', tip: 'Не передавайте ключ іншим. Вони можуть витратити ваш баланс або ліміти.', icon: 'key' },
    { eyebrow: 'Безкоштовний початок', title: 'Безкоштовні варіанти мають обмеження', summary: 'Безкоштовно не означає без обмежень.', body: 'OpenRouter, Groq, Cerebras і Gemini пропонують певні безкоштовні можливості. Моделі, ліміти й умови можуть змінюватися.', icon: 'star' },
    { eyebrow: 'Контроль вартості', title: 'Як працює ціна', summary: 'Вартість залежить передусім від обсягу надісланого й створеного тексту.', body: 'Короткі запити зазвичай недорогі. Довгі документи, відповіді, міркування й додаткові функції збільшують ціну.', tip: 'Перевіряйте актуальну ціну та встановіть бюджет.', icon: 'chartBar' },
    { eyebrow: 'Поняття 3', title: 'Пошук пов’язаних ідей', summary: 'Nodus знаходить тексти зі схожим змістом навіть за різних слів.', body: 'Текст ділиться на уривки й перетворюється на числові представлення, які називають ембеддингами. RAG (генерація, доповнена пошуком) спочатку знаходить доречну інформацію, а потім передає її генеративній моделі як контекст. У Nodus ембеддинги вибирають найближчі до запитання уривки та ідеї зі сховища; функції чату, дослідження й письма можуть використати їх для відповіді на основі ваших джерел без надсилання всього корпусу. Завжди перевіряйте посилання на джерела.', tip: 'Після зміни моделі ембеддингів матеріали потрібно опрацювати знову.', icon: 'network' },
    { eyebrow: 'Підготовка пошуку', title: 'Виберіть багатомовну модель', summary: 'Модель має відповідати мовам документів.', body: 'Локально доступні Harrier, BGE-M3, GTE Multilingual і Multilingual E5. Через інтернет можна використовувати OpenAI text-embedding-3.', icon: 'languages' },
    { eyebrow: 'Зображення ШІ', title: 'Створення й розуміння зображень', summary: 'Аналіз зображення і створення нового — різні завдання.', body: 'Можна попросити описати фотографію чи діаграму. Сумісний сервіс дасть Nodus змогу створити нову ілюстрацію за описом.', tip: 'Перевіряйте результат. Зображення можуть містити помилки, а створення може бути платним.', icon: 'image' },
    { eyebrow: 'Вбудоване аудіо', title: 'Розшифрування й озвучення', summary: 'Перетворюйте мовлення на текст, а текст на мовлення.', body: 'Nodus розшифровує лекції, інтерв’ю та голосові нотатки, а також читає документи вголос. Завжди перевіряйте розшифрування.', icon: 'microphone' },
    { eyebrow: 'Безпечний початок', title: 'Перше налаштування', summary: 'Почніть із малого й розширюйтеся після перевірки.', body: 'Створіть сховище, імпортуйте кілька матеріалів, виберіть моделі та перевірте результат. Відповіді мають спиратися на джерела. Робіть резервні копії.', icon: 'check' },
    { eyebrow: 'Ваш помічник', title: 'Познайомтеся з Nodi', summary: 'Nodi поєднує чат, сповіщення й довідку та є повністю необов’язковим.', body: 'Nodi може використовувати документацію, поточний екран, активне сховище або всі сховища як контекст. У Налаштування → Інтерфейс → Маскот Nodi його можна вимкнути, вибрати модель чату, залишити поверх інших програм і налаштувати аксесуари для різних сховищ.', icon: 'star' },
  ],
};

function CompactSlides(language: Exclude<TutorialLanguage, 'es' | 'en'>): Slide[] {
  const states: NodiState[] = ['waving', 'discovering', 'connecting', 'thinking', 'idle', 'loading', 'sleeping', 'connecting', 'discovering', 'thinking', 'waving', 'idle', 'celebrating'];
  const base = COMPACT_SLIDES[language].map((slide, index) => ({ ...slide, nodi: states[index], content: <><p>{slide.body}</p>{slide.tip && <Tip warning={index === 4 || index === 6 || index === 7 || index === 9}>{slide.tip}</Tip>}</> }));
  return [
    ...base.slice(0, 7),
    ...ModelGuidanceSlides(language),
    ...base.slice(7, -2),
    ...platformHighlightSlides(language),
    ...base.slice(-2),
  ];
}

function LearningPrimer(language: TutorialLanguage): Slide {
 const copy = (key:LearningCopyKey) => language === 'ru' || language === 'uk' ? '' : learningText(key,language==='zh'?'zh-CN':language);
 const extra = language==='ru' ? {title:'Учитесь на практике',body:'Начните с одного документа: подготовьте его, задайте вопрос и откройте цитату. В простом режиме нужны модель диалога и эмбеддинги. Для извлечения идей рекомендуем облако: один документ может требовать много вызовов. Локальная модель, отвечающая на вопрос, не обязательно выдержит весь процесс. Профили, тема, языки и Nodi доступны в меню интерфейса.'} : {title:'Навчайтеся на практиці',body:'Почніть з одного документа: підготуйте його, поставте запитання та відкрийте цитату. У простому режимі потрібні модель діалогу й ембеддинги. Для вилучення ідей радимо хмару: один документ може потребувати багато викликів. Локальна модель, що відповідає на запитання, не обов’язково витримає весь процес. Профілі, тема, мови та Nodi доступні в меню інтерфейсу.'};
 return {eyebrow:language==='ru'||language==='uk'?extra.title:copy('learn'),title:language==='ru'||language==='uk'?extra.title:copy('firstAnswer'),icon:'graduation',nodi:'discovering',summary:language==='ru'||language==='uk'?extra.body:copy('intro'),content:<>{language==='ru'||language==='uk'?<p>{extra.body}</p>:<><p>{copy('twoRoles')}</p><p>{copy('cloud')}</p><p>{copy('interfaceBody')}</p></>}</>};
}

export function BasicsTutorial({ language, onLanguageChosen, onNodiStyleChosen, onComplete, quickLanguageOnly = false, initialTutorialLanguage }: { initialTutorialLanguage?: TutorialLanguage; quickLanguageOnly?: boolean; language: AppLanguage; onLanguageChosen: (language: TutorialLanguage) => void | Promise<void>; onNodiStyleChosen: (style: NodiStyle) => void | Promise<void>; onComplete: () => void | Promise<void> }) {
  const [tutorialLanguage, setTutorialLanguage] = useState<TutorialLanguage | null>(initialTutorialLanguage ?? null);
  // Which Nodi guides the rest of the tutorial is the user's first real choice, so the
  // deck that follows is already staged by the companion they picked.
  const [styleChosen, setStyleChosen] = useState(false);
  // Third and last gate: watch the tutorials or read the deck. Not persisted — either
  // path completes the guide, and both stay reachable from Settings → Tutorials.
  const [learnMode, setLearnMode] = useState<'video' | 'text' | null>(null);
  const activeLanguage = tutorialLanguage ?? language;
  const slides = useMemo(() => [LearningPrimer(activeLanguage), ...(activeLanguage === 'es' ? SpanishSlides() : activeLanguage === 'en' ? EnglishSlides() : CompactSlides(activeLanguage))], [activeLanguage]);
  const [index, setIndex] = useState(0);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const slide = slides[index];
  const last = index === slides.length - 1;
  const ui = {
    es: { guide: 'GUÍA ESENCIAL', skip: 'Saltar tutorial', back: 'Anterior', next: 'Siguiente', finish: 'Empezar a usar Nodus', pace: 'Usa las flechas para avanzar a tu ritmo', hello: '¡Hola! Soy Nodi.', done: 'Ya tienes lo esencial.', nodiTitle: '¿Con qué Nodi te quedas?', nodiLede: 'Nodi te acompañará por la app y te guiará en este tutorial. Podrás cambiarlo cuando quieras en Ajustes.', nodiClassic: 'Nodi clásico', nodiClassicBody: 'El personaje, con sus gestos y sus trajes según la bóveda.', nodiOrb: 'Nodi orbe', nodiOrbBody: 'Una esfera de cristal, más sobria, con el color de tu bóveda.' },
    en: { guide: 'ESSENTIAL GUIDE', skip: 'Skip tutorial', back: 'Back', next: 'Next', finish: 'Start using Nodus', pace: 'Use the arrows to move at your own pace', hello: "Hi! I'm Nodi.", done: 'You have the essentials.', nodiTitle: 'Which Nodi do you want?', nodiLede: 'Nodi will keep you company across the app and guide this tutorial. You can change this anytime in Settings.', nodiClassic: 'Classic Nodi', nodiClassicBody: 'The character, with its gestures and its per-vault outfits.', nodiOrb: 'Orb Nodi', nodiOrbBody: 'A soberer glass sphere, tinted with your vault’s colour.' },
    fr: { guide: 'GUIDE ESSENTIEL', skip: 'Passer le guide', back: 'Précédent', next: 'Suivant', finish: 'Commencer avec Nodus', pace: 'Avancez à votre rythme avec les flèches', hello: 'Bonjour ! Je suis Nodi.', done: 'Vous avez les bases.', nodiTitle: 'Quel Nodi préférez-vous ?', nodiLede: 'Nodi vous accompagnera dans l’app et guidera ce guide. Vous pourrez en changer dans les réglages.', nodiClassic: 'Nodi classique', nodiClassicBody: 'Le personnage, avec ses gestes et ses tenues selon le coffre.', nodiOrb: 'Nodi orbe', nodiOrbBody: 'Une sphère de verre, plus sobre, aux couleurs de votre coffre.' },
    tr: { guide: 'TEMEL REHBER', skip: 'Rehberi atla', back: 'Geri', next: 'İleri', finish: 'Nodus’u kullanmaya başla', pace: 'Oklarla kendi hızınızda ilerleyin', hello: 'Merhaba! Ben Nodi.', done: 'Artık temel bilgilere sahipsiniz.', nodiTitle: 'Hangi Nodi olsun?', nodiLede: 'Nodi uygulamada size eşlik edecek ve bu rehberde yol gösterecek. Daha sonra Ayarlar’dan değiştirebilirsiniz.', nodiClassic: 'Klasik Nodi', nodiClassicBody: 'Hareketleri ve kasaya göre kıyafetleriyle karakter.', nodiOrb: 'Küre Nodi', nodiOrbBody: 'Kasanızın rengini alan, daha sade bir cam küre.' },
    de: { guide: 'GRUNDLAGEN', skip: 'Anleitung überspringen', back: 'Zurück', next: 'Weiter', finish: 'Nodus verwenden', pace: 'Mit den Pfeilen in Ihrem Tempo fortfahren', hello: 'Hallo! Ich bin Nodi.', done: 'Jetzt kennen Sie die Grundlagen.', nodiTitle: 'Welcher Nodi soll es sein?', nodiLede: 'Nodi begleitet Sie durch die App und durch diese Anleitung. Sie können das jederzeit in den Einstellungen ändern.', nodiClassic: 'Klassischer Nodi', nodiClassicBody: 'Die Figur, mit Gesten und Outfits je nach Vault.', nodiOrb: 'Nodi-Orb', nodiOrbBody: 'Eine schlichtere Glaskugel in der Farbe Ihres Vaults.' },
    it: { guide: 'GUIDA ESSENZIALE', skip: 'Salta la guida', back: 'Indietro', next: 'Avanti', finish: 'Inizia a usare Nodus', pace: 'Usa le frecce e procedi al tuo ritmo', hello: 'Ciao! Sono Nodi.', done: 'Ora conosci le basi.', nodiTitle: 'Quale Nodi preferisci?', nodiLede: 'Nodi ti accompagnerà nell’app e in questa guida. Potrai cambiarlo quando vuoi nelle impostazioni.', nodiClassic: 'Nodi classico', nodiClassicBody: 'Il personaggio, con i suoi gesti e i costumi in base al vault.', nodiOrb: 'Nodi orbe', nodiOrbBody: 'Una sfera di vetro, più sobria, con il colore del tuo vault.' },
    pt: { guide: 'GUIA ESSENCIAL', skip: 'Saltar o guia', back: 'Anterior', next: 'Seguinte', finish: 'Começar a usar o Nodus', pace: 'Use as setas para avançar ao seu ritmo', hello: 'Olá! Sou o Nodi.', done: 'Já conhece o essencial.', nodiTitle: 'Com que Nodi fica?', nodiLede: 'O Nodi vai acompanhá-lo pela app e guiar este guia. Pode mudar quando quiser nas definições.', nodiClassic: 'Nodi clássico', nodiClassicBody: 'A personagem, com os seus gestos e trajes conforme o cofre.', nodiOrb: 'Nodi orbe', nodiOrbBody: 'Uma esfera de vidro, mais sóbria, com a cor do seu cofre.' },
    'pt-BR': { guide: 'GUIA ESSENCIAL', skip: 'Pular tutorial', back: 'Anterior', next: 'Próximo', finish: 'Começar a usar o Nodus', pace: 'Use as setas para avançar no seu ritmo', hello: 'Olá! Eu sou o Nodi.', done: 'Agora você já conhece o essencial.', nodiTitle: 'Com qual Nodi você fica?', nodiLede: 'O Nodi vai te acompanhar pelo app e guiar este tutorial. Você pode mudar quando quiser nas configurações.', nodiClassic: 'Nodi clássico', nodiClassicBody: 'O personagem, com seus gestos e trajes conforme o cofre.', nodiOrb: 'Nodi orbe', nodiOrbBody: 'Uma esfera de vidro, mais sóbria, com a cor do seu cofre.' },
    zh: { guide: '基础指南', skip: '跳过教程', back: '上一步', next: '下一步', finish: '开始使用 Nodus', pace: '使用箭头按自己的节奏浏览', hello: '你好！我是 Nodi。', done: '你已经掌握基础知识了。', nodiTitle: '你想要哪个 Nodi？', nodiLede: 'Nodi 会在应用中陪伴你，并引导这份教程。之后可以随时在设置中更改。', nodiClassic: '经典 Nodi', nodiClassicBody: '原本的角色，有动作，也会随资料库换装。', nodiOrb: '光球 Nodi', nodiOrbBody: '更沉稳的玻璃球，会染上你资料库的颜色。' },
    'zh-CN': { guide: '基础指南', skip: '跳过教程', back: '上一步', next: '下一步', finish: '开始使用 Nodus', pace: '使用箭头按自己的节奏浏览', hello: '你好！我是 Nodi。', done: '你已经掌握基础知识了。', nodiTitle: '你想要哪个 Nodi？', nodiLede: 'Nodi 会在应用中陪伴你，并引导这份教程。之后可以随时在设置中更改。', nodiClassic: '经典 Nodi', nodiClassicBody: '原本的角色，有动作，也会随资料库换装。', nodiOrb: '光球 Nodi', nodiOrbBody: '更沉稳的玻璃球，会染上你资料库的颜色。' },
    'zh-TW': { guide: '基礎指南', skip: '跳過教學', back: '上一步', next: '下一步', finish: '開始使用 Nodus', pace: '使用方向鍵，依自己的步調瀏覽', hello: '你好！我是 Nodi。', done: '你已經掌握基礎了。', nodiTitle: '你想要哪一個 Nodi？', nodiLede: 'Nodi 會在應用程式中陪伴你，並帶你看完這份教學。之後隨時可以在設定中更改。', nodiClassic: '經典 Nodi', nodiClassicBody: '原本的角色，有各種動作，也會隨知識庫換裝。', nodiOrb: '光球 Nodi', nodiOrbBody: '更沉穩的玻璃球，會染上你知識庫的顏色。' },
    ja: { guide: '基本ガイド', skip: 'チュートリアルをスキップ', back: '戻る', next: '次へ', finish: 'Nodusを使い始める', pace: '矢印で自分のペースで進めます', hello: 'こんにちは！Nodiです。', done: '基本はこれで完了です。', nodiTitle: 'どちらのNodiにしますか？', nodiLede: 'Nodiがアプリの中で寄り添い、このガイドを案内します。設定でいつでも変更できます。', nodiClassic: 'クラシックNodi', nodiClassicBody: 'おなじみのキャラクター。しぐさとVaultごとの衣装つき。', nodiOrb: 'オーブNodi', nodiOrbBody: '落ち着いたガラスの球体。Vaultの色に染まります。' },
    ko: { guide: '필수 가이드', skip: '튜토리얼 건너뛰기', back: '이전', next: '다음', finish: 'Nodus 시작하기', pace: '화살표로 원하는 속도에 맞춰 넘겨 보세요', hello: '안녕하세요! 저는 Nodi예요.', done: '이제 기본은 모두 익혔어요.', nodiTitle: '어떤 Nodi와 함께할까요?', nodiLede: 'Nodi가 앱 곳곳에서 함께하며 이 튜토리얼을 안내합니다. 설정에서 언제든 바꿀 수 있습니다.', nodiClassic: '클래식 Nodi', nodiClassicBody: '몸짓과 Vault별 의상을 갖춘 캐릭터입니다.', nodiOrb: '오브 Nodi', nodiOrbBody: 'Vault 색으로 물드는 차분한 유리 구체입니다.' },
    ru: { guide: 'ОСНОВНОЕ РУКОВОДСТВО', skip: 'Пропустить обучение', back: 'Назад', next: 'Далее', finish: 'Начать работу с Nodus', pace: 'Используйте стрелки и двигайтесь в своём темпе', hello: 'Привет! Я Ноди.', done: 'Теперь вы знаете основы.', nodiTitle: 'Какой Ноди вам ближе?', nodiLede: 'Ноди будет сопровождать вас в приложении и в этом руководстве. Это можно изменить в настройках.', nodiClassic: 'Классический Ноди', nodiClassicBody: 'Персонаж с жестами и нарядами по типу хранилища.', nodiOrb: 'Ноди-сфера', nodiOrbBody: 'Более строгая стеклянная сфера цвета вашего хранилища.' },
    uk: { guide: 'ОСНОВНИЙ ПОСІБНИК', skip: 'Пропустити навчання', back: 'Назад', next: 'Далі', finish: 'Почати роботу з Nodus', pace: 'Використовуйте стрілки та рухайтеся у своєму темпі', hello: 'Привіт! Я Ноді.', done: 'Тепер ви знаєте основи.', nodiTitle: 'Який Ноді вам ближчий?', nodiLede: 'Ноді супроводжуватиме вас у застосунку та в цьому посібнику. Це можна змінити в налаштуваннях.', nodiClassic: 'Класичний Ноді', nodiClassicBody: 'Персонаж із жестами та вбранням за типом сховища.', nodiOrb: 'Ноді-сфера', nodiOrbBody: 'Стриманіша скляна сфера у кольорі вашого сховища.' },
  }[activeLanguage];

  // The tutorial has its own staged Nodi. Suspend the real companion as long as
  // this screen is mounted, including the standalone always-on-top window.
  useEffect(() => {
    void window.nodus.setNodiTutorialVisible(true);
    return () => { void window.nodus.setNodiTutorialVisible(false); };
  }, []);

  useEffect(() => {
    if (!tutorialLanguage || !styleChosen || learnMode !== 'text') return;
    const onKey = (event: KeyboardEvent) => {
      if (confirmSkip) return;
      if (event.key === 'ArrowRight' || event.key === 'Enter') setIndex((value) => Math.min(slides.length - 1, value + 1));
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
      if (event.key === 'Escape') setConfirmSkip(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmSkip, learnMode, slides.length, styleChosen, tutorialLanguage]);

  const videoCopy = tutorialVideoCopy(activeLanguage);
  // Compiled in rather than fetched: the one video a fresh install is shown must be on
  // screen even if the published catalogue is unreachable. The fallback is defensive —
  // `TUTORIAL_INTRO_VIDEO_ID` names a built-in — but a crash here would be the first
  // thing a new user ever saw.
  const introVideo = tutorialVideo(TUTORIAL_INTRO_VIDEO_ID) ?? TUTORIAL_VIDEOS[0];
  // Skipping is offered from every screen that follows the two mandatory choices, so
  // the dialog is built once and rendered by each of them.
  const skipDialog = confirmSkip && <ConfirmModal zIndex={220} title={t('¿Saltar la guía esencial?')} message={t('Esta guía explica los espacios de trabajo, los modelos que funcionan en tu equipo, los servicios externos y las búsquedas por significado.')} cancelLabel={t('Continuar tutorial')} confirmLabel={t('Saltar de todos modos')} danger onCancel={() => setConfirmSkip(false)} onConfirm={() => void onComplete()} />;

  if (!tutorialLanguage) return <div className="tutorial-cinema tutorial-language-screen" data-testid="basics-tutorial-language" role="dialog" aria-modal="true" aria-labelledby="tutorial-language-title"><div className="tutorial-aurora" aria-hidden="true" /><main className="tutorial-language-card"><NodiAvatar state="waving" height={190} /><p className="tutorial-eyebrow tutorial-language-brand"><Icon name="languages" size={15} /> NODUS</p><h1 id="tutorial-language-title">Choose the language for the tutorial</h1><div className="tutorial-language-grid">{TUTORIAL_LANGUAGES.map(({ code, label, flag }) => <button key={code} data-testid={`tutorial-language-${code}`} className="tutorial-language-option" style={{ '--tutorial-flag': flag } as React.CSSProperties} onClick={() => { setTutorialLanguage(code); setIndex(0); void Promise.resolve(onLanguageChosen(code)).then(() => { if (quickLanguageOnly) return onComplete(); }); }}>{label}</button>)}</div></main></div>;

  if (quickLanguageOnly) return <div className="h-full grid place-items-center">Nodus…</div>;

  // Second screen, in the language just chosen: pick the companion. It gates the deck
  // the same way the language does, which also keeps it clear of the slide indexes.
  if (!styleChosen) return <div className="tutorial-cinema tutorial-language-screen" data-testid="basics-tutorial-nodi-style" role="dialog" aria-modal="true" aria-labelledby="tutorial-nodi-style-title">
    <div className="tutorial-aurora" aria-hidden="true" />
    <main className="tutorial-language-card">
      <p className="tutorial-eyebrow tutorial-language-brand"><Icon name="sparkles" size={15} /> NODUS</p>
      <h1 id="tutorial-nodi-style-title">{ui.nodiTitle}</h1>
      <p>{ui.nodiLede}</p>
      <NodiStylePicker
        labels={{ classicTitle: ui.nodiClassic, classicBody: ui.nodiClassicBody, orbTitle: ui.nodiOrb, orbBody: ui.nodiOrbBody }}
        onPick={(style) => { setStyleChosen(true); setIndex(0); void onNodiStyleChosen(style); }}
      />
    </main>
  </div>;

  // Third screen: watch the tutorials or read the deck. The video path is recommended
  // because it is the same ground covered faster; the deck stays the offline path and
  // one click away from here.
  if (!learnMode) return <div className="tutorial-cinema tutorial-language-screen" data-testid="basics-tutorial-mode" role="dialog" aria-modal="true" aria-labelledby="tutorial-mode-title">
    <div className="tutorial-aurora" aria-hidden="true" />
    <main className="tutorial-language-card">
      <p className="tutorial-eyebrow tutorial-language-brand"><Icon name="graduation" size={15} /> NODUS</p>
      <h1 id="tutorial-mode-title">{videoCopy.chooseTitle}</h1>
      <p>{videoCopy.chooseLede}</p>
      <div className="tutorial-mode-grid">
        <button type="button" className="tutorial-mode-option recommended" data-testid="tutorial-mode-video" onClick={() => setLearnMode('video')}>
          <span className="tutorial-mode-badge">{videoCopy.videoOption.badge}</span>
          <span className="tutorial-mode-icon"><Icon name="play" size={22} /></span>
          <b>{videoCopy.videoOption.title}</b>
          <span className="tutorial-mode-body">{videoCopy.videoOption.body}</span>
        </button>
        <button type="button" className="tutorial-mode-option" data-testid="tutorial-mode-text" onClick={() => setLearnMode('text')}>
          <span className="tutorial-mode-icon"><Icon name="book" size={22} /></span>
          <b>{videoCopy.textOption.title}</b>
          <span className="tutorial-mode-body">{videoCopy.textOption.body}</span>
        </button>
      </div>
      <p className="tutorial-videos-more"><Icon name="sparkles" size={13} />{videoCopy.more}</p>
    </main>
    {skipDialog}
  </div>;

  // The video path: the same cinema chrome, with the INTRODUCTION alone on the stage.
  // The rest of the catalogue is deliberately not shown here — see TutorialVideoFeature.
  if (learnMode === 'video') return <div className="tutorial-cinema" data-testid="basics-tutorial-videos" role="dialog" aria-modal="true" aria-label={videoCopy.startHere}>
    <div className="tutorial-aurora" aria-hidden="true" />
    <header className="tutorial-topbar"><span>NODUS · {ui.guide}</span><button onClick={() => setConfirmSkip(true)}>{ui.skip}</button></header>
    <TutorialVideoFeature video={introVideo} language={activeLanguage} />
    <footer className="tutorial-footer">
      {/* No `ui.pace` hint here: the arrow keys belong to the deck, not to the grid. */}
      <button className="btn btn-ghost" data-testid="tutorial-mode-switch-text" onClick={() => { setIndex(0); setLearnMode('text'); }}>
        <Icon name="book" />{videoCopy.textOption.title}
      </button>
      <button className="btn btn-primary" data-testid="basics-tutorial-complete" onClick={() => void onComplete()}>{ui.finish}<Icon name="check" /></button>
    </footer>
    {skipDialog}
  </div>;

  const motionProfiles = [
    { y: [0, -7, 0], rotate: [0, 1, 0] }, { x: [0, 5, 0], rotate: [0, -2, 0] }, { scale: [1, 1.025, 1], y: [0, -3, 0] },
    { rotate: [0, 3, 0], x: [0, -3, 0] }, { y: [0, -10, 0], scale: [1, .98, 1] }, { x: [0, 4, -2, 0], y: [0, -2, 0, 0] },
    { rotate: [0, -3, 2, 0], scale: [1, 1.02, 1] }, { y: [0, -5, 1, 0], x: [0, -3, 0, 0] }, { scale: [1, .97, 1.02, 1] },
    { x: [0, 6, 0], y: [0, -6, 0] }, { rotate: [0, 2, -2, 0], y: [0, -4, 0] }, { y: [0, -20, 0], scale: [1, 1.06, 1] },
    { y: [0, -20, 0], scale: [1, 1.06, 1] },
  ];
  const stagedNodiState: NodiState = last ? 'celebrating' : index === 2 ? 'thinking' : index >= 3 ? 'idle' : slide.nodi;
  const stagedNodiMotion = index === 2 ? motionProfiles[3] : index >= 3 && !last ? {} : motionProfiles[index];
  return <div className="tutorial-cinema" data-testid="basics-tutorial" role="dialog" aria-modal="true" aria-labelledby="basics-tutorial-title">
    <div className="tutorial-aurora" aria-hidden="true" />
    <header className="tutorial-topbar"><span>NODUS · {ui.guide}</span><button onClick={() => setConfirmSkip(true)}>{ui.skip}</button></header>
    <div className="tutorial-progress" aria-label={`${index + 1}/${slides.length}`}>{slides.map((_, itemIndex) => <button key={itemIndex} className={itemIndex <= index ? 'active' : ''} onClick={() => setIndex(itemIndex)} aria-label={`${itemIndex + 1}`} />)}</div>
    <main className="tutorial-stage">
      <motion.aside key={`nodi-${index}`} className="tutorial-nodi" animate={stagedNodiMotion} transition={{ duration: last ? .8 : 2.8 + index * .12, repeat: index >= 3 && !last ? 0 : Infinity, ease: 'easeInOut' }}><NodiAvatar state={stagedNodiState} height={250} raiseArm={index === 0} /><div className="tutorial-speech">{index === 0 ? ui.hello : last ? ui.done : `${index + 1} / ${slides.length}`}</div></motion.aside>
      <AnimatePresence mode="wait">
        <motion.article key={index} initial={{ opacity: 0, x: 60, filter: 'blur(8px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: -50, filter: 'blur(8px)' }} transition={{ duration: .38 }} className="tutorial-card">
          <div className="tutorial-eyebrow"><Icon name={slide.icon} size={15} />{slide.eyebrow}</div>
          <h1 id="basics-tutorial-title">{slide.title}</h1><p className="tutorial-summary">{slide.summary}</p><div className="tutorial-content">{slide.content}</div>
        </motion.article>
      </AnimatePresence>
    </main>
    <footer className="tutorial-footer"><button className="btn btn-ghost" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}><Icon name="arrowLeft" />{ui.back}</button><span>{ui.pace}</span>{last ? <button data-testid="basics-tutorial-complete" className="btn btn-primary" onClick={() => void onComplete()}>{ui.finish}<Icon name="check" /></button> : <button className="btn btn-primary" onClick={() => setIndex((value) => value + 1)}>{ui.next}<Icon name="chevronRight" /></button>}</footer>
    {skipDialog}
  </div>;
}
