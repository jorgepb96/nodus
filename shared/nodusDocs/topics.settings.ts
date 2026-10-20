import type { NodusDocTopic } from './types';

/** Settings: the tabs, their controls and what each one changes. */
export const SETTINGS_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'settings-overview',
    area: 'settings',
    title: { es: 'Ajustes: pestañas y dónde está cada cosa', en: 'Settings: tabs and where everything lives' },
    keywords: ['ajustes', 'settings', 'configuracion', 'pestanas', 'donde se configura', 'preferencias', 'opciones', 'buscar ajuste'],
    body: {
      es: `- Ajustes es la última entrada de la barra lateral y el último icono de la cabecera. El tooltip es «Ajustes de la bóveda actual»: hay ajustes por bóveda y ajustes compartidos.
- Pestañas: Proveedores, Modelos IA, Biblioteca, Texto y OCR, Interfaz, Integraciones, Nodus Browser, Servidor, Tutoriales, Backup / copia de seguridad, Acerca de Nodus Research y Actualizaciones y novedades.
- La pestaña Biblioteca se oculta en Testimonios, Prosopografía y Worldbuilding, que no usan el flujo de Zotero, y esas bóvedas abren Proveedores en su lugar.
- Ajustes tiene un buscador interno que filtra las secciones y resalta las coincidencias.
- Las claves y los modelos se comparten entre todas las bóvedas; la bóveda activa decide qué tareas aparecen y qué ajustes propios se muestran.
- Desde Nodi, el botón «Abrir ajustes de visibilidad» lleva a Interfaz con la búsqueda «Nodi» puesta; los avisos de modelo llevan a Modelos IA.`,
      en: `- Settings is the last sidebar entry and the last header icon. Its tooltip is "Settings for the current vault": some settings are per vault and some are shared.
- Tabs: Providers, AI models, Library, Text and OCR, Interface, Integrations, Nodus Browser, Server, Tutorials, Backup, About Nodus Research and Updates and news.
- The Library tab is hidden in Testimonies, Prosopography and Worldbuilding, which do not use the Zotero flow, and those vaults open Providers instead.
- Settings has its own search box that filters sections and highlights matches.
- Keys and models are shared across every vault; the active vault decides which tasks appear and which of its own settings are shown.
- From Nodi, "Open visibility settings" goes to Interface with the search "Nodi" filled in; model warnings lead to AI models.`,
    },
    related: ['settings-models-basic', 'settings-interface'],
  },
  {
    id: 'settings-providers',
    area: 'settings',
    title: { es: 'Proveedores: claves, favoritos, locales y cuotas', en: 'Providers: keys, favourites, local and quotas' },
    keywords: ['proveedores', 'providers', 'api key', 'clave', 'claves', 'openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'deepseek', 'cerebras', 'copilot', 'codex', 'xiaomi', 'ollama', 'lm studio', 'custom', 'favoritos', 'modelos favoritos', 'recuperar claves', 'plan gratuito', 'cuota', 'suscripcion'],
    body: {
      es: `- Ajustes > Proveedores es donde se guardan las claves. Las claves se cifran en el equipo y no se muestran en la interfaz.
- Si Nodus encuentra claves cifradas que no puede leer (por ejemplo tras cambiar de equipo), avisa de que no se han borrado y ofrece «Recuperar claves»: hay que autorizar el acceso al Llavero de macOS cuando el sistema lo pida. El resultado puede ser «Claves recuperadas y protegidas de nuevo correctamente.» o «Algunas claves siguen bloqueadas…».
- Cada proveedor muestra su estado («clave guardada» o «sin clave»), un campo de contraseña para pegar la clave, «Guardar» y «Borrar», y un catálogo de modelos con «Cargar modelos» y buscador, con etiquetas de visión y razonamiento.
- «Modelos favoritos» alimenta todos los selectores de la aplicación.
- Groq y OpenRouter tienen la casilla «Uso mi plan gratuito de este proveedor», que recorta la longitud de salida y espera cuando se alcanza el límite por minuto.
- Ollama y LM Studio no necesitan clave: hay que tener el servidor en marcha y, en LM Studio, activar el servidor y cargar un modelo. La dirección es editable y admite IP:puerto en la red local; también un token si la instancia está protegida. Los modelos no se descargan solos: «ollama pull» en Ollama o cargarlos en LM Studio.
- ChatGPT · Codex se conecta con la suscripción mediante el protocolo Codex App Server; muestra límites principal y secundario, créditos y un selector de razonamiento por modelo. GitHub Copilot usa el SDK oficial (preview) con OAuth de dispositivo y muestra su cuota.
- Custom (OpenAI-compatible) acepta cualquier servidor que hable la API de OpenAI (LiteLLM, vLLM, el servidor de llama.cpp o un proxy propio): se escribe la URL completa (Nodus no añade /v1), la clave es opcional y los modelos se pueden escribir a mano. Este proveedor no genera embeddings.
- Generación de imágenes: tiene su propio proveedor y modelo (Google, OpenAI, OpenRouter, Nodus local o ChatGPT · Codex), un estilo predeterminado y una tabla de precio por imagen. Es independiente del modelo de texto.`,
      en: `- Settings > Providers is where keys are stored. Keys are encrypted on the machine and never shown in the interface.
- If Nodus finds encrypted keys it cannot read (after moving machines, for instance) it warns that they were not deleted and offers "Recover keys": macOS may ask for Keychain access. The result is either "Keys recovered and protected again." or "Some keys are still locked…".
- Each provider shows its state ("key saved" or "no key"), a password field to paste the key, "Save" and "Delete", and a model catalogue with "Load models" and a search box, tagged with vision and reasoning.
- "Favourite models" feeds every model picker in the application.
- Groq and OpenRouter have a "I use this provider's free plan" checkbox that trims output length and waits when the per-minute limit is hit.
- Ollama and LM Studio need no key: the server must be running and, in LM Studio, the server started with a model loaded. The address is editable and accepts IP:port on the local network, plus a token if the instance is protected. Models are not downloaded for you: "ollama pull" in Ollama, or load them in LM Studio.
- ChatGPT · Codex connects through the subscription over the Codex App Server protocol; it shows primary and secondary limits, credits and a per-model reasoning selector. GitHub Copilot uses the official SDK (preview) with device OAuth and shows its quota.
- Custom (OpenAI-compatible) accepts any server speaking the OpenAI API (LiteLLM, vLLM, the llama.cpp server or your own proxy): enter the full URL (Nodus does not append /v1), the key is optional and models can be typed by hand. This provider does not generate embeddings.
- Image generation has its own provider and model (Google, OpenAI, OpenRouter, local Nodus or ChatGPT · Codex), a default style and a per-image price table. It is independent from the text model.`,
    },
    related: ['troubleshooting-model-config', 'models-local-warning'],
  },
  {
    id: 'settings-models-basic',
    area: 'models',
    title: { es: 'Modelos IA: configuración básica', en: 'AI models: basic configuration' },
    keywords: ['modelo general', 'configuracion basica', 'embeddings', 'modelo de embeddings', 'modelo de texto', 'procesar materiales', 'estudio automatico', 'elegir modelo', 'configura un modelo'],
    body: {
      es: `- Ajustes > Modelos IA tiene dos conmutadores exclusivos: «Configuración básica» (por defecto) y «Configuración avanzada».
- En la básica se elige el «Modelo general de texto», que cubre todas las tareas que no tengan un modelo propio, y el «Modelo de embeddings (similitud semántica multilingüe)», que hace posible la búsqueda semántica y las relaciones.
- En bóvedas de Estudio aparece además «Procesamiento de materiales nuevos con IA» con tres opciones: «Preguntar cada vez» (por defecto), «Procesar automáticamente» y «No procesar automáticamente».
- Sin ningún modelo configurado, las funciones de IA no se ejecutan: aparece el aviso «Configura un modelo de IA» y el modal con «Ir a Ajustes y Modelos». El chat de Nodi y el asistente avisan antes de intentar nada.
- Cada función conserva su propio selector de modelo: puedes usar un modelo bueno para el análisis y otro más barato para tareas cortas.`,
      en: `- Settings > AI models has two exclusive switches: "Basic configuration" (default) and "Advanced configuration".
- Basic holds the "General text model", which covers every task without a model of its own, and the "Embedding model (multilingual semantic similarity)", which enables semantic search and relations.
- Study vaults also show "New material processing with AI" with three options: "Ask every time" (default), "Process automatically" and "Do not process automatically".
- With no model configured, AI features do not run: the "Configure an AI model" warning appears together with the modal offering "Go to Settings and Models". Nodi's chat and the assistant warn before trying anything.
- Every feature keeps its own model picker: a strong model for analysis and a cheaper one for short tasks is a supported setup.`,
    },
    related: ['settings-models-advanced', 'settings-providers'],
  },
  {
    id: 'settings-models-advanced',
    area: 'models',
    title: { es: 'Modelos IA: configuración avanzada, razonamiento y concurrencia', en: 'AI models: advanced configuration, reasoning and concurrency' },
    keywords: ['avanzada', 'modelos por tarea', 'razonamiento', 'concurrencia', 'llamadas simultaneas', 'contexto largo', 'deep scan', 'palabras por fragmento', 'unpaywall', 'politica de ia', 'fuentes privadas', 'indexar pendientes', 'reindexar', 'transcripcion', 'audio', 'imagen local', 'modelos locales integrados', 'alumnado bloqueado'],
    body: {
      es: `- En la configuración avanzada se elige modelo por tarea: extracción de temas, ideas y evidencias, visión y OCR de imágenes, resúmenes de obras, comprensión de documentos completos (solo académica), auditor de fichas documentales (solo académica), fusión y deduplicación, relaciones semánticas y Asistente Nodi.
- «Ajustes avanzados del vault» permite fijar modelos por superficie (chat con el corpus, Deep Research, inmersión, espacio de trabajo, mapa argumental, autores y biografías, diccionario, guías de estudio, tutor, laboratorio de hipótesis). En Estudio, el chat, la mejora y las preguntas admiten un modelo principal y uno alternativo.
- «Razonamiento (chat/tutor/escritura)» tiene Desactivado (más rápido), Bajo, Medio y Alto (más lento). Por defecto está desactivado; los modelos que no lo soportan lo ignoran.
- «Llamadas simultáneas» está en Automático (por defecto) o Manual entre 1 y 8; Automático se adapta por proveedor y modelo y reduce a la mitad al recibir un límite de tasa. El estado por proveedor y modelo se muestra con su motivo («espera por cuota», «reducción temporal», «capacidad ampliada», «cuota restablecida», «límite local seguro», «rol no certificado»).
- «Indexación de embeddings» ofrece «Indexar pendientes» y «Reindexar todo» (esta última no en Fuentes primarias, que usa su propio indexado de archivo) con confirmación, porque cambiar de modelo de embeddings obliga a reindexar.
- «Modo de contexto deep scan» (Estándar o Contexto largo) y «Palabras por fragmento» deciden cuánto texto conserva cada análisis profundo antes de dividirlo. El contexto largo consume más y puede no caber en modelos pequeños.
- Fuentes primarias añade su política de IA: «Confirmar cada envío externo», «Permitir IA externa con fuentes privadas» y «Permitir IA local con fuentes restringidas».
- «IA y datos del alumnado» aparece como «Bloqueado por diseño»: no es configurable.
- El panel «Modelos locales integrados» instala el motor llama.cpp, descarga modelos, mide GPU y CPU, calibra la concurrencia y muestra el diagnóstico. La transcripción de audio (Transformers.js + ONNX por defecto, whisper.cpp o la API de OpenAI), la generación de imágenes local (stable-diffusion.cpp, con calidades Borrador, Equilibrada y Alta) y la voz y narración (Ming 3.0 local, con voces clonadas) también se configuran aquí.
- «OpenRouter: priorizar velocidad» y el «Email Unpaywall» (para localizar versiones abiertas de un DOI) completan la pestaña.`,
      en: `- Advanced configuration sets a model per task: topic, idea and evidence extraction; image vision and OCR; work summaries; full document understanding (academic only); documentary record auditor (academic only); merging and deduplication; semantic relations; and Nodi Assistant.
- "Advanced vault settings" pins models per surface (corpus chat, Deep Research, immersion, workspace, argument map, authors and biographies, dictionary, study guides, tutor, hypothesis lab). In Study, chat, improvement and questions accept a primary and an alternative model.
- "Reasoning (chat/tutor/writing)" offers Off (faster), Low, Medium and High (slower). It is off by default; models that do not support it ignore it.
- "Simultaneous calls" is Automatic (default) or Manual between 1 and 8; Automatic adapts per provider and model and halves the rate on a rate-limit response. The per-provider state is shown with its reason ("waiting for quota", "temporary reduction", "expanded capacity", "quota restored", "safe local limit", "uncertified role").
- "Embedding indexing" offers "Index pending" and "Reindex everything" (the latter not in Primary sources, which has its own archive indexing) with confirmation, because changing the embedding model forces a reindex.
- "Deep scan context mode" (Standard or Long context) and "Words per chunk" decide how much text each deep analysis keeps before splitting. Long context costs more and may not fit small models.
- Primary sources adds its AI policy: "Confirm every external submission", "Allow external AI with private sources" and "Allow local AI with restricted sources".
- "AI and student data" appears as "Locked by design": it is not configurable.
- The "Built-in local models" panel installs the llama.cpp engine, downloads models, measures GPU and CPU, calibrates concurrency and shows diagnostics. Audio transcription (Transformers.js + ONNX by default, whisper.cpp or the OpenAI API), local image generation (stable-diffusion.cpp with Draft, Balanced and High quality) and voice and narration (local Ming 3.0, with cloned voices) are configured here too.
- "OpenRouter: prioritise speed" and the "Unpaywall email" (to find open versions of a DOI) complete the tab.`,
    },
    related: ['models-local-warning', 'troubleshooting-embeddings', 'troubleshooting-performance'],
  },
  {
    id: 'settings-interface',
    area: 'settings',
    title: { es: 'Interfaz: idioma, tema, accesibilidad, Nodi y barra lateral', en: 'Interface: language, theme, accessibility, Nodi and sidebar' },
    keywords: ['interfaz', 'idioma', 'tema', 'paleta', 'claro', 'oscuro', 'accesibilidad', 'tamano de interfaz', 'contraste', 'animaciones', 'fuente', 'nodi', 'mascota', 'barra lateral', 'modo de lectura', 'testimonios'],
    body: {
      es: `- Idioma: «Idioma de la interfaz» y «Idioma de los prompts (idioma de las ideas generadas)». Son ajustes distintos: la interfaz puede estar en un idioma y la IA generar en otro.
- Apariencia: «Modo de color» (Sistema, Oscuro o Claro), «Tema» con el selector de paletas (17 integradas) y «Crear tema» para definir acento, fondo, superficie y texto claros y oscuros con validación de contraste; «Usar la misma paleta en todas las bóvedas» y «Velocidad de animaciones».
- Accesibilidad y lectura: «Tamaño de la interfaz», «Fuente de alta legibilidad», «Contraste reforzado», «Reducir animaciones» y «Modo de lectura» (solo en bóvedas de Estudio). Los atajos básicos son Tab, Intro y Espacio, y Ctrl/⌘ K para la paleta.
- Mascota Nodi: «Mostrar a Nodi», «Tamaño de Nodi» (40 %–100 %), «Aspecto de Nodi» (clásico u orbe), «Color del orbe» (automático por bóveda o manual), «Modelo del chat de Nodi» (independiente; vacío usa el modelo de síntesis), «Mantener siempre visible sobre otras apps» y «Trajes de Nodi según la bóveda» (solo con el aspecto clásico).
- Testimonios (solo en esa bóveda): propósito del proyecto, idioma habitual de las entrevistas, acceso predeterminado, nombre de atribución, «El narrador revisa por norma», repositorio de destino, política de conservación, plantilla de acuerdo y «Permitir proveedores externos».
- Barra lateral: editor de orden y visibilidad por grupos, con arrastre y flechas; Inicio y Ajustes son fijos y las herramientas fijadas desde Nodus Tools se integran en Herramientas.`,
      en: `- Language: "Interface language" and "Prompt language (language of generated ideas)". They are separate settings: the interface can be in one language while the AI writes in another.
- Appearance: "Colour mode" (System, Dark or Light), "Theme" with the palette picker (17 built in) and "Create theme" to define accent, background, surface and text for light and dark with contrast validation; plus "Use the same palette in every vault" and "Animation speed".
- Accessibility and reading: "Interface size", "High-legibility font", "Reinforced contrast", "Reduce animations" and "Reading mode" (Study vaults only). The basic shortcuts are Tab, Enter and Space, and Ctrl/⌘ K for the palette.
- Nodi mascot: "Show Nodi", "Nodi size" (40%–100%), "Nodi appearance" (classic or orb), "Orb colour" (automatic per vault or manual), "Nodi chat model" (independent; empty uses the synthesis model), "Keep always visible above other apps" and "Nodi outfits per vault" (classic appearance only).
- Testimonies (that vault only): project purpose, usual interview language, default access, attribution name, "The narrator reviews as a rule", target repository, preservation policy, agreement template and "Allow external providers".
- Sidebar: order and visibility editor grouped by section, with drag and arrow keys; Home and Settings are fixed and tools pinned from Nodus Tools merge into Tools.`,
    },
    related: ['nodi-companion', 'settings-overview'],
  },
  {
    id: 'settings-text-ocr',
    area: 'settings',
    title: { es: 'Texto y OCR', en: 'Text and OCR' },
    keywords: ['texto y ocr', 'ocr', 'tesseract', 'idiomas de ocr', 'pdf escaneado', 'paginas', 'reusar texto', 'extraccion de texto'],
    body: {
      es: `- «Reusar texto indexado por Zotero» aprovecha el texto que Zotero ya extrajo. Activado por defecto.
- «OCR para PDFs escaneados» está desactivado por defecto. Al activarlo, Nodus aplica OCR a los PDF sin capa de texto.
- «Idiomas de OCR (Tesseract)» acepta la notación de Tesseract (por defecto spa+eng). La primera vez que se usa un idioma, Nodus descarga sus datos una sola vez y los guarda en el equipo: es la única conexión de red del conversor.
- «Máx. páginas a OCR por obra» limita cuántas páginas se procesan (por defecto 300).`,
      en: `- "Reuse text indexed by Zotero" uses the text Zotero already extracted. On by default.
- "OCR for scanned PDFs" is off by default. Switching it on makes Nodus run OCR on PDFs with no text layer.
- "OCR languages (Tesseract)" accepts Tesseract notation (spa+eng by default). The first time a language is used, Nodus downloads its data once and keeps it on the machine: it is the converter's only network connection.
- "Max pages to OCR per work" caps how many pages are processed (300 by default).`,
    },
    related: ['sections-library', 'troubleshooting-corpus-status'],
  },
  {
    id: 'settings-backup',
    area: 'settings',
    title: { es: 'Backup: exportar, importar, sync y copias automáticas', en: 'Backup: export, import, sync and automatic copies' },
    keywords: ['backup', 'copia de seguridad', 'exportar', 'importar', 'nodus', 'nodussync', 'sincronizar equipos', 'otro ordenador', 'otro equipo', 'migrar', 'transferir', 'pasar los datos', 'contrasena maestra', 'clave de recuperacion', 'copias automaticas', 'retencion', 'snapshot', 'reinicializar grafo', 'diagnostico'],
    body: {
      es: `- «Exportar (.nodus)» crea un archivo cifrado con todos los datos: bóvedas, documentos, preferencias, historiales, archivos generados y claves API. Al terminar muestra las «Credenciales de recuperación de la copia» con contraseña y clave de recuperación, y ofrece «Copiar credenciales». El aviso es explícito: guárdalas fuera de este dispositivo.
- «Importar (.nodus)» pide la contraseña o la clave de recuperación y después el archivo. Restaurar conserva una copia de seguridad previa por seguridad. Los ajustes de máquina (ruta de storage de Zotero, carpeta de salida del conversor) se excluyen al restaurar, y los tokens MCP nunca viajan en una copia.
- Sincronización entre equipos: «Exportar paquete de sync (.nodussync)» e «Importar paquete de sync (.nodussync)» usan una frase de sincronización propia (mínimo 8 caracteres, distinta de la contraseña maestra). Al importar, gana la versión más reciente, los borrados se propagan y lo sustituido se conserva en «Versiones sustituidas» con «Restaurar esta versión» o «Descartar». El alcance incluye notas, datos de estudio, materiales y grabaciones, borradores, búsquedas guardadas, auditorías de relaciones y bases de datos.
- «Copias de seguridad automáticas» (desactivadas por defecto): al activarlas se elige una carpeta segura, los días de la semana (ninguno marcado significa todos los días), la hora (03:00 por defecto, con recuperación al arrancar si el equipo estaba apagado) y una contraseña maestra de al menos 8 caracteres, y se ofrece «Guardar kit de recuperación» y «Hacer copia ahora».
- «Limpieza automática de copias antiguas» (desactivada): mueve las copias con más antigüedad que el umbral a una papelera privada durante 7 días. Se conservan siempre al menos las tres copias normales más recientes, las copias de otros equipos y los snapshots previos a una actualización. Solo se borran definitivamente tras verificar otra copia válida.
- Los snapshots previos a migraciones se listan con versión origen→destino, fecha, SHA-256, tamaño y quick_check, y se pueden abrir como bóveda separada.
- Zona de peligro: «Reinicializar grafo» borra ideas, temas, conexiones, autores y huecos y conserva la biblioteca y los ajustes; pide confirmación con un código de cuatro cifras.
- En bóvedas de Estudio hay además administración del vault (integridad, «Verificar y optimizar», «Reconstruir índices», «Limpiar índices vectoriales», «Vaciar papelera» y «Exportar diagnóstico»).`,
      en: `- "Export (.nodus)" writes an encrypted file with everything: vaults, documents, preferences, histories, generated files and API keys. When it finishes it shows the "Recovery credentials" with a password and a recovery key, and offers "Copy credentials". The warning is explicit: keep them off this device.
- "Import (.nodus)" asks for the password or the recovery key and then the file. Restoring keeps a safety copy of the previous state. Machine settings (Zotero storage path, converter output folder) are excluded on restore, and MCP tokens never travel in a copy.
- Cross-device sync: "Export sync package (.nodussync)" and "Import sync package (.nodussync)" use their own sync phrase (at least 8 characters, separate from the master password). On import the newest version wins, deletions propagate, and replaced items are kept under "Replaced versions" with "Restore this version" or "Discard". The scope covers notes, study data, materials and recordings, drafts, saved searches, relation audits and databases.
- "Automatic backups" (off by default): enabling them asks for a safe folder, the weekdays (none selected means every day), the hour (03:00 by default, with catch-up on start when the machine was off) and a master password of at least 8 characters, and offers "Save recovery kit" and "Back up now".
- "Automatic cleanup of old copies" (off): moves copies older than the threshold to a private trash for 7 days. At least the three most recent normal copies, other machines' copies and pre-update snapshots are always kept. They are only deleted for good after another valid copy is verified.
- Pre-migration snapshots are listed with source→target version, date, SHA-256, size and quick_check, and can be opened as a separate vault.
- Danger zone: "Reset graph" deletes ideas, topics, connections, authors and gaps while keeping the library and settings; it asks for confirmation with a four-digit code.
- Study vaults additionally have vault administration (integrity, "Verify and optimise", "Rebuild indexes", "Clear vector indexes", "Empty trash" and "Export diagnostics").`,
    },
    related: ['troubleshooting-backup-recovery', 'settings-overview'],
  },
  {
    id: 'settings-updates-about',
    area: 'settings',
    title: { es: 'Actualizaciones, avisos, Acerca de y feedback', en: 'Updates, notices, About and feedback' },
    keywords: ['actualizaciones', 'updates', 'canal beta', 'estable', 'instalar y reiniciar', 'buscar actualizacion', 'novedades', 'avisos', 'acerca de', 'roadmap', 'licencia', 'agpl', 'privacidad', 'sugerir', 'reportar error', 'github'],
    body: {
      es: `- «Actualizaciones y novedades» reúne «Últimos cambios» (modal de novedades), «Avisos de Nodus» con la casilla «Recibir avisos» (activada por defecto; se consulta un archivo público cada cuatro horas), y «Actualizaciones» con el canal («Canal estable» o «Canal Beta»), el estado, «Buscar actualización» e «Instalar y reiniciar» cuando la descarga ha terminado.
- En el canal Beta, activar las betas exige una confirmación y una copia completa previa: sin Recuperación configurada la beta no se instala («La beta no se instalará hasta que configures Recuperación con una carpeta y contraseña válidas.»).
- Las actualizaciones solo están disponibles en la aplicación empaquetada; si no se puede descargar, el mensaje pide comprobar la conexión.
- «Acerca de Nodus Research» incluye la presentación y las donaciones, las redes sociales, la política de privacidad y su archivo, la explicación de cumplimiento del RGPD, las licencias y atribuciones (AGPL-3.0 y el código fuente de la versión), el roadmap, la transparencia y seguridad (repositorio e informe de vulnerabilidades) y la versión instalada.
- El botón «Sugerir / Reportar» (y el comando «Sugerir función o reportar error») abre un formulario de dos pasos que crea una incidencia en GitHub con la versión, el sistema operativo, la arquitectura y la versión de Electron; la plantilla de error pide descripción, pasos para reproducir y comportamiento esperado.`,
      en: `- "Updates and news" gathers "Latest changes" (the what's-new modal), "Nodus notices" with the "Receive notices" checkbox (on by default; a public file is fetched every four hours), and "Updates" with the channel ("Stable channel" or "Beta channel"), the state, "Check for updates" and "Install and restart" once the download has finished.
- On the Beta channel, enabling betas requires confirmation and a full prior copy: without Recovery configured the beta does not install ("The beta will not install until you set up Recovery with a valid folder and password.").
- Updates are only available in the packaged application; when the download fails, the message asks to check the connection.
- "About Nodus Research" holds the introduction and donations, social links, the privacy policy and its archive, the GDPR compliance explanation, licences and attributions (AGPL-3.0 and the source code for this version), the roadmap, transparency and security (repository and vulnerability reporting) and the installed version.
- The "Suggest / Report" button (and the "Suggest a feature or report a bug" command) opens a two-step form that files an issue on GitHub with the version, operating system, architecture and Electron version; the bug template asks for description, steps to reproduce and expected behaviour.`,
    },
    related: ['general-notifications', 'general-roadmap'],
  },
];
