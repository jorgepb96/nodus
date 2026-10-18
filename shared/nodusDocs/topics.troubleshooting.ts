import type { NodusDocTopic } from './types';

/** Troubleshooting: what each failure means, why it happens and how it is fixed. */
export const TROUBLESHOOTING_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'troubleshooting-index',
    area: 'troubleshooting',
    title: { es: 'Cómo diagnosticar un problema en Nodus', en: 'How to diagnose a problem in Nodus' },
    keywords: ['problema', 'error', 'no funciona', 'falla', 'diagnostico', 'logs', 'registros', 'cola', 'queue', 'informe', 'soporte', 'ayuda', 'no se que pasa', 'va mal'],
    body: {
      es: `- Orden de diagnóstico recomendado: mirar la cola de tareas («Cola y tareas» en la cabecera) para ver qué está fallando y desde dónde se abren los registros; revisar el estado de la obra en la Biblioteca; y, si el fallo es de un ajuste o de un modelo, comprobar Ajustes > Modelos IA y Ajustes > Proveedores.
- Registros de procesamiento: un único archivo local, excluido de copias y sincronización, con la categoría del fallo (modelo, JSON, embeddings, proveedor, conexión, extracción, OCR, indexado, cola, almacenamiento o sistema), el detalle crudo del proveedor, los reintentos y el estado HTTP. Se abren desde la cola («Logs» / «Registros de procesamiento») y se pueden exportar.
- Los errores de una sección no tumban la aplicación: aparece «Algo ha fallado en esta sección» con «Reintentar» o «Recargar Nodus», y el resto sigue funcionando.
- Para informar de un problema: «Sugerir / Reportar» crea una incidencia en GitHub con la versión, el sistema operativo, la arquitectura y la versión de Electron. La plantilla de error pide descripción, pasos para reproducir y comportamiento esperado.
- Existe diagnóstico específico en varios puntos: el motor local (GPU, capas, calibración y registro), la administración del vault de Estudio («Exportar diagnóstico»), la auditoría de la biblioteca global y la salud de las copias de seguridad.
- Nodus no envía telemetría: ningún informe sale del equipo salvo que el usuario lo envíe.`,
      en: `- Recommended order: look at the task queue ("Queue and tasks" in the header) to see what is failing and to open the logs; check the work status in the Library; and, when the failure is a setting or a model, check Settings > AI models and Settings > Providers.
- Processing logs: one local file, excluded from backups and sync, recording the failure category (model, JSON, embeddings, provider, connection, extraction, OCR, indexing, queue, storage or system), the raw provider detail, retries and the HTTP status. They open from the queue ("Logs" / "Processing logs") and can be exported.
- A section error never takes the application down: "Something failed in this section" appears with "Retry" or "Reload Nodus", and the rest keeps working.
- To report a problem: "Suggest / Report" files an issue on GitHub with the version, operating system, architecture and Electron version. The bug template asks for description, steps to reproduce and expected behaviour.
- Specific diagnostics exist in several places: the local engine (GPU, layers, calibration and log), Study vault administration ("Export diagnostics"), the global library audit and backup health.
- Nodus sends no telemetry: no report leaves the machine unless the user sends it.`,
    },
    related: ['troubleshooting-app-errors', 'troubleshooting-corpus-status'],
  },
  {
    id: 'troubleshooting-model-config',
    area: 'troubleshooting',
    title: { es: 'Errores de modelo y de proveedor', en: 'Model and provider errors' },
    keywords: ['sin modelo', 'no hay modelo', 'falta la clave', 'clave invalida', '401', '403', '400', '429', 'limite de tasa', 'rate limit', 'cuota', 'error del proveedor', 'error de conexion', 'respuesta vacia', 'timeout', 'configura un modelo', 'no se pudo conectar', 'no hay modelos'],
    body: {
      es: `- «No hay un modelo de IA configurado. Elige uno en Ajustes.» y el modal «Configura un modelo de IA» («Configura un modelo en Ajustes → Modelos IA antes de volver a intentarlo…» con «Ahora no» e «Ir a Ajustes y Modelos»): no hay modelo general ni de esa tarea. Se resuelve eligiendo un modelo en Ajustes > Modelos IA (básica o avanzada).
- «Falta la clave de IA para {proveedor}. Configúrala en Ajustes.» o «Falta la clave de IA para embeddings ({proveedor})…»: la clave no está guardada. Se pega en Ajustes > Proveedores. En la lista de proveedores se ve «○ sin clave» o «● clave guardada».
- «Clave de IA inválida. Revísala en Ajustes.» (401/403): la clave existe pero el proveedor la rechaza; hay que revisarla o regenerarla en el panel del proveedor.
- «El proveedor rechazó la solicitud (400) sin explicar el motivo. Suele ser la clave de IA (revísala en Ajustes) o, con mucho contexto, una petición que supera el límite del modelo.» Cuando el proveedor sí explica, el mensaje es «El proveedor rechazó la solicitud (400). Detalle: {detalle}».
- «Límite de tasa del proveedor de IA» (429/529): Nodus reduce la concurrencia a la mitad y reintenta; con el plan gratuito de Groq u OpenRouter conviene activar «Uso mi plan gratuito de este proveedor», que recorta la salida y espera al alcanzar el límite por minuto.
- «Error del proveedor ({estado})» (5xx) y «Error de conexión con el proveedor de IA.»: suelen ser incidencias temporales o de red; el trabajo se puede reintentar.
- «Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.»
- «Respuesta vacía del proveedor de IA…» o «El backend de IA terminó la solicitud sin producir respuesta.»: el modelo no devolvió contenido; reintentar suele bastar, y si se repite conviene cambiar de modelo.
- Proveedores locales: «No se pudo conectar con {proveedor} en {dirección}» significa que el servidor no está en marcha o la dirección/puerto no es correcta. Con Custom, «Falta la dirección del servidor compatible con OpenAI. Configúrala en Ajustes → Proveedores.».
- Catálogos: «Ni el servidor publica modelos ni has escrito ninguno todavía.», «El servidor no reporta modelos. Descarga o carga uno primero.» y «No se pudo consultar el catálogo completo: solo está disponible el modelo actual.».
- Si un modelo de suscripción se queda sin cuota, el propio selector avisa de que consume la cuota del plan (no crédito de API) y que un análisis completo puede agotar el límite semanal o mensual.`,
      en: `- "No AI model is configured. Choose one in Settings." together with the "Configure an AI model" modal ("Configure a model in Settings → AI models before trying again…" with "Not now" and "Go to Settings and Models"): there is no general model or no model for that task. Fix it by choosing one in Settings > AI models (basic or advanced).
- "Missing AI key for {provider}. Set it in Settings." or "Missing AI key for embeddings ({provider})…": the key is not stored. Paste it in Settings > Providers. The provider list shows "○ no key" or "● key saved".
- "Invalid AI key. Check it in Settings." (401/403): the key exists but the provider rejects it; check or regenerate it in the provider's own panel.
- "The provider rejected the request (400) without explaining why. It is usually the AI key (check it in Settings) or, with a lot of context, a request beyond the model's limit." When the provider does explain, the message is "The provider rejected the request (400). Detail: {detail}".
- "AI provider rate limit" (429/529): Nodus halves concurrency and retries; on Groq's or OpenRouter's free plan, enable "I use this provider's free plan", which trims output and waits when the per-minute limit is reached.
- "Provider error ({status})" (5xx) and "Connection error with the AI provider.": usually temporary or network-related; the job can be retried.
- "Timed out waiting for the AI provider. Try a faster model or a smaller chunk."
- "Empty response from the AI provider…" or "The AI backend ended the request without producing an answer.": the model returned no content; retrying usually works, and repeating it means changing the model.
- Local providers: "Could not connect to {provider} at {address}" means the server is not running or the address/port is wrong. With Custom, "The OpenAI-compatible server address is missing. Set it in Settings → Providers.".
- Catalogues: "Neither the server publishes models nor have you typed any yet.", "The server reports no models. Download or load one first." and "The full catalogue could not be queried: only the current model is available.".
- When a subscription model runs out of quota, the picker itself warns that it consumes plan quota (not API credit) and that a full analysis can exhaust the weekly or monthly limit.`,
    },
    related: ['settings-providers', 'troubleshooting-local-ai'],
  },
  {
    id: 'troubleshooting-local-ai',
    area: 'troubleshooting',
    title: { es: 'Problemas con la IA local', en: 'Problems with local AI' },
    keywords: ['ia local problemas', 'modelo local lento', 'no arranca el motor', 'aviso rojo', 'antivirus', 'memoria insuficiente', 'gemma', 'modelos integrados', 'descarga fallida', 'sha-256', 'calibracion', 'concurrencia local', 'sin contexto'],
    body: {
      es: `- El aviso rojo junto al selector recuerda el contrato de la IA local: tarda más en procesar, sobre todo en equipos poco potentes, porque los documentos se analizan por fragmentos y eso exige recursos incluso a modelos pequeños. Gemma es la opción recomendada entre los modelos incluidos; Ollama y LM Studio también son compatibles; los proveedores en la nube siguen siendo la opción más fiable.
- Es normal que un modelo local tarde: la primera carga del modelo en memoria puede sumar decenas de segundos y cada fragmento se procesa en serie. Con un modelo local la concurrencia se fija en 1 ranura salvo que se calibre el equipo.
- Si el motor local no arranca, la app nombra la causa: bloqueo del sistema de seguridad (hay que excluir la carpeta del motor en el antivirus), memoria insuficiente para el modelo y las capas, biblioteca del sistema ausente, dispositivo no utilizable o arranque agotado. El diagnóstico del motor muestra CPU/GPU, capas descargadas, concurrencia medida y la ruta de su registro.
- Descargas: «La verificación SHA-256 de «{modelo}» ha fallado. Bórralo y vuelve a descargarlo.» indica una descarga corrupta; «Descarga incompleta: se esperaban N bytes y se recibieron M.» y «Descarga HTTP {estado}: {url}» son fallos de red que se resuelven reintentando.
- «Espera a que termine la descarga antes de eliminar el modelo.» y «El modelo tiene solicitudes en curso…» significan que el modelo está ocupado.
- Roles bloqueados: los modelos locales pequeños tienen bloqueadas por fiabilidad la extracción de ideas, la fusión, los perfiles y los resúmenes. El selector lo explica («Estos pesos son los mismos que Nodus descarta entre sus modelos integrados…») y no permite usarlos ahí; para esas tareas hay que elegir Gemma u otro modelo mayor.
- Contexto: si el modelo necesita más ventana, el mensaje exacto dice cuántos tokens necesita y cuántos tiene, y propone subir la ventana (num_ctx en Ollama, Context Length en otros), elegir un modelo con más contexto, reducir la tarea o usar la nube para tareas grandes.
- Cambiar de modelo local a uno en la nube (o a Ollama o LM Studio) es la solución habitual cuando el equipo no da abasto: la cola y los análisis se reanudan con el nuevo modelo.`,
      en: `- The red notice beside the picker states local AI's bargain: it takes longer to process, especially on modest hardware, because documents are analysed in chunks and that demands resources even from small models. Gemma is the recommended choice among the bundled models; Ollama and LM Studio are supported too; cloud providers remain the most reliable option.
- A local model being slow is expected: the first load into memory can add tens of seconds and each chunk is processed in series. With a local model concurrency is pinned to 1 slot unless the machine is calibrated.
- When the local engine will not start, the app names the cause: a system security block (exclude the engine folder in your antivirus), not enough memory for the model and layers, a missing system library, no usable device, or startup timed out. The engine diagnostics show CPU/GPU, offloaded layers, measured concurrency and its log path.
- Downloads: "The SHA-256 check for «{model}» failed. Delete it and download it again." means a corrupt download; "Incomplete download: expected N bytes and received M." and "Download HTTP {status}: {url}" are network failures fixed by retrying.
- "Wait for the download to finish before deleting the model." and "The model has requests in flight…" mean the model is busy.
- Blocked roles: small local models have idea extraction, merging, profiles and summaries blocked for reliability. The picker explains it and refuses to use them there; those tasks need Gemma or another larger model.
- Context: when the model needs a bigger window, the exact message states how many tokens it needs and how many it has, and suggests raising the window (num_ctx in Ollama, Context Length elsewhere), choosing a model with more context, reducing the task, or using the cloud for large tasks.
- Switching from a local model to a cloud one (or to Ollama or LM Studio) is the usual fix when the machine cannot keep up: the queue and the analyses resume with the new model.`,
    },
    related: ['models-local-warning', 'models-local-runtime', 'troubleshooting-context-overflow'],
  },
  {
    id: 'troubleshooting-context-overflow',
    area: 'troubleshooting',
    title: { es: 'Contexto excedido o respuesta cortada', en: 'Context overflow or truncated answer' },
    keywords: ['contexto excedido', 'context overflow', 'no cabe', 'tokens', 'ventana', 'num_ctx', 'respuesta cortada', 'limite de salida', 'json incompleto', 'fragmento', 'chunk', 'contexto largo'],
    body: {
      es: `- Mensaje del modelo local: «El modelo local «{modelo}» no tiene suficiente contexto para esta tarea: necesita ~N tokens (ventana actual: M tokens). Aumenta el contexto del modelo en {proveedor} (num_ctx si es Ollama, Context Length si no), elige un modelo con más contexto, reduce el tamaño de la tarea (menos texto por lote) o usa un proveedor en la nube para tareas grandes.»
- Respuesta cortada: «La respuesta de «{modelo}» ({proveedor}) se cortó al alcanzar el límite de N tokens de salida y el JSON quedó incompleto…». Un modelo con razonamiento puede gastar ese presupuesto pensando antes de escribir.
- Qué hacer, en orden: subir la ventana de contexto del modelo local; bajar «Modo de contexto deep scan» de Contexto largo a Estándar; reducir «Palabras por fragmento»; procesar menos documentos a la vez; o cambiar esa tarea a un modelo con más contexto (los de nube suelen tener mucho más).
- En la configuración avanzada, «Modo de contexto deep scan» y «Palabras por fragmento» son los dos ajustes que deciden cuánto texto conserva cada análisis profundo antes de dividirlo.
- El escaneo profundo responde a un contexto excedido o a un tiempo agotado partiendo el lote en trozos más pequeños automáticamente.`,
      en: `- Local model message: "The local model «{model}» does not have enough context for this task: it needs ~N tokens (current window: M tokens). Raise the model's context in {provider} (num_ctx for Ollama, Context Length otherwise), choose a model with more context, reduce the task size (less text per batch) or use a cloud provider for large tasks."
- Truncated answer: "The response from «{model}» ({provider}) was cut off at the N output token limit and the JSON was left incomplete…". A reasoning model may spend that budget thinking before writing.
- What to do, in order: raise the local model's context window; drop "Deep scan context mode" from Long context to Standard; lower "Words per chunk"; process fewer documents at once; or move that task to a model with more context (cloud models usually have far more).
- In advanced configuration, "Deep scan context mode" and "Words per chunk" are the two settings that decide how much text each deep analysis keeps before splitting.
- Deep scan answers a context overflow or a timeout by splitting the batch into smaller pieces automatically.`,
    },
    related: ['troubleshooting-local-ai', 'settings-models-advanced'],
  },
  {
    id: 'troubleshooting-zotero',
    area: 'troubleshooting',
    title: { es: 'Zotero no conecta o no sincroniza', en: 'Zotero will not connect or sync' },
    keywords: ['zotero', 'no conecta', 'zotero cerrado', 'api local', 'credenciales caducadas', 'limite', 'sincronizar', 'no aparece la biblioteca', 'sincronizacion interrumpida', 'solo lectura'],
    body: {
      es: `- Requisito: Nodus usa la API local de Zotero en modo solo lectura y necesita Zotero 7 o posterior.
- «Zotero no está disponible. Ábrelo y vuelve a analizar.» es el aviso típico cuando Zotero no está abierto. Además hay que activar en Zotero la opción «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero» (ajustes avanzados de Zotero).
- Errores del cliente de Zotero y su significado: «Las credenciales de Zotero han caducado.» (401), «Zotero rechazó el acceso a esta biblioteca.» (403), «Zotero mantiene temporalmente limitado el acceso.» (429), «Zotero respondió HTTP {estado}.» y «No se pudo conectar con Zotero: {detalle}».
- La pista que muestra la app es: comprobar que Zotero esté abierto y que la opción de comunicación esté activada en los ajustes avanzados de Zotero.
- Una sincronización puede quedar «Sincronización interrumpida» o «Sincronización requiere revisión»: los datos locales se conservan y el aviso pide revisar antes de continuar.
- Zotero se configura en Ajustes > Biblioteca (modo Manual o Tiempo real, tag de lectura, ruta de storage y automatizaciones de análisis). En Testimonios, Prosopografía y Worldbuilding esa pestaña no existe porque no usan Zotero.`,
      en: `- Requirement: Nodus uses Zotero's local API read-only and needs Zotero 7 or later.
- "Zotero is not available. Open it and analyse again." is the typical notice when Zotero is not running. Zotero's "Allow other applications on this computer to communicate with Zotero" option (in its advanced settings) must also be enabled.
- Zotero client errors and their meaning: credentials expired (401), Zotero refused access to this library (403), Zotero is temporarily rate-limiting access (429), Zotero answered HTTP {status}, and could not connect to Zotero: {detail}.
- The hint the app shows is: check that Zotero is open and that the communication option is enabled in Zotero's advanced settings.
- A sync can end as "Sync interrupted" or "Sync needs review": local data is kept and the notice asks for a review before continuing.
- Zotero is configured in Settings > Library (Manual or Real time mode, reading tag, storage path and analysis automations). Testimonies, Prosopography and Worldbuilding have no such tab because they do not use Zotero.`,
    },
    related: ['sections-library', 'settings-text-ocr'],
  },
  {
    id: 'troubleshooting-corpus-status',
    area: 'troubleshooting',
    title: { es: 'Una obra no se analiza: estados y motivos', en: 'A work will not analyse: states and reasons' },
    keywords: ['estado del analisis', 'no se analiza', 'failed', 'pendiente', 'abstract', 'sin texto', 'ocr', 'adjunto', 'pasajes parciales', 'reindexar fragmentos', 'salud del corpus', 'reintentar', 'incompleto'],
    body: {
      es: `- El estado de una obra resume cinco pasos (temas, ideas, resumen, semántica y citable) y distingue entre en curso, pendiente, fallido, sin empezar, solo abstract, sin texto, listo e incompleto. Los pasos «partial», «missing» y «failed» son reintentables.
- El modal «Estado del análisis» traduce cada fallo. Los mensajes más frecuentes y su causa:
  - «El paso falló sin dejar un motivo. Reintenta; si vuelve a fallar, revisa el modelo en Ajustes → Modelos de IA.»
  - «Las ideas pertenecen a la versión anterior del texto. Vuelve a analizarlas para usar el texto actual.»
  - «El análisis solo pudo usar el abstract.» → falta el texto completo: hay que añadir el PDF o EPUB en Zotero y volver a analizar. En la Biblioteca el aviso lo dice con más detalle: la obra no tendrá texto citable.
  - «El PDF está escaneado y no tiene capa de texto. Activa OCR y vuelve a analizar.»
  - «El adjunto no produjo texto utilizable. Revisa el archivo o activa OCR.»
  - «El adjunto existe en Zotero, pero el archivo ya no está en su ubicación original.»
  - «El formato del adjunto no es compatible con la extracción de texto.»
  - «Zotero no está disponible. Ábrelo y volver a analizar.»
- Pasajes parciales: «El texto cambió; vuelve a indexar sus fragmentos.», «Los fragmentos se indexaron con otro modelo de embeddings.», «El texto y el modelo de embeddings cambiaron.» y «Algunos fragmentos no tienen un embedding válido.».
- Si el texto cambió, la app conserva el análisis anterior hasta completar un reescaneo («El texto disponible ha cambiado. Se conserva el análisis anterior hasta completar un reescaneo.»).
- «Salud del corpus» en Inicio agrupa lo pendiente en buckets (sin texto, solo análisis ligero, prioritarias por analizar y recuperar texto) y ofrece las acciones de indexado.`,
      en: `- A work's status summarises five steps (topics, ideas, summary, semantics and citable) and distinguishes running, pending, failed, unstarted, abstract only, no text, ready and incomplete. Steps marked partial, missing and failed can be retried.
- The "Analysis status" modal translates each failure. The most frequent messages and their cause:
  - "The step failed without leaving a reason. Retry; if it fails again, check the model in Settings → AI models."
  - "The ideas belong to the previous version of the text. Re-analyse them to use the current text."
  - "The analysis could only use the abstract." → the full text is missing: add the PDF or EPUB in Zotero and analyse again. The Library notice explains that the work will have no citable text.
  - "The PDF is scanned and has no text layer. Enable OCR and analyse again."
  - "The attachment produced no usable text. Check the file or enable OCR."
  - "The attachment exists in Zotero, but the file is no longer in its original location."
  - "The attachment format is not supported for text extraction."
  - "Zotero is not available. Open it and analyse again."
- Partial passages: "The text changed; reindex its passages.", "The passages were indexed with another embedding model.", "Both the text and the embedding model changed." and "Some passages have no valid embedding.".
- When the text changed, the app keeps the previous analysis until a rescan completes.
- "Corpus health" on Home groups what is pending into buckets (no text, light analysis only, priority to analyse and recover text) and offers the indexing actions.`,
    },
    related: ['sections-library', 'settings-text-ocr', 'troubleshooting-embeddings'],
  },
  {
    id: 'troubleshooting-embeddings',
    area: 'troubleshooting',
    title: { es: 'Embeddings e indexado', en: 'Embeddings and indexing' },
    keywords: ['embeddings', 'indice', 'reindexar', 'no encuentra pasajes', 'busqueda semantica vacia', 'modelo de embeddings incompatible', 'indexar pendientes', 'indice incompleto', 'vectores'],
    body: {
      es: `- Si la búsqueda semántica no encuentra nada o las relaciones no aparecen, lo primero es comprobar que hay un modelo de embeddings configurado y que el índice está al día: Ajustes > Modelos IA ofrece «Indexar pendientes» y «Reindexar todo».
- Cambiar de modelo de embeddings invalida los vectores anteriores: Nodus avisa con una confirmación («Los embeddings creados con el modelo anterior no son compatibles con el nuevo. Nodus conservará los datos, pero tendrás que reindexar…») y después hay que reindexar.
- «La indexación produjo {n} embeddings para {m} entradas; no se publicará un índice incompleto.» significa que la indexación falló a mitad y no se publicó nada: hay que reintentar (habitualmente por un fallo de proveedor o de cuota).
- El proveedor Custom (OpenAI-compatible) no genera embeddings: para similitud semántica hay que usar otro proveedor o un modelo local.
- En Fuentes primarias el indexado es del archivo («Indexar archivo») y no tiene «Reindexar todo».`,
      en: `- If semantic search finds nothing or relations do not appear, first check that an embedding model is configured and the index is current: Settings > AI models offers "Index pending" and "Reindex everything".
- Changing the embedding model invalidates previous vectors: Nodus warns with a confirmation and a reindex is required afterwards.
- "Indexing produced {n} embeddings for {m} entries; an incomplete index will not be published." means indexing failed midway and nothing was published: retry (usually a provider or quota failure).
- The Custom (OpenAI-compatible) provider does not generate embeddings: use another provider or a local model for semantic similarity.
- In Primary sources indexing is archive-level ("Index archive") and there is no "Reindex everything".`,
    },
    related: ['models-embeddings', 'settings-models-advanced'],
  },
  {
    id: 'troubleshooting-library-recovery',
    area: 'troubleshooting',
    title: { es: 'Biblioteca global: auditar, reconstruir y papelera', en: 'Global library: audit, rebuild and trash' },
    keywords: ['biblioteca global', 'auditar', 'auditoria', 'reconstruir catalogo', 'conflictos', 'registros invalidos', 'archivos ausentes', 'adjuntos danados', 'carpetas huerfanas', 'papelera', 'necesita revision', 'integrity'],
    body: {
      es: `- El diálogo «Revisión y recuperación» audita manifiestos, enlaces y archivos sin modificar los vaults, y muestra métricas: elementos y adjuntos revisados, conflictos, registros inválidos, archivos ausentes, adjuntos dañados y carpetas huérfanas. Si no hay problemas, «No se detectaron incidencias de integridad.».
- «Auditar de nuevo» repite la comprobación; «Reconstruir catálogo» rehace catálogo, alias, búsquedas y enlaces desde nodus-library («El catálogo, aliases, búsquedas y enlaces se reconstruyeron desde nodus-library.»).
- Si la vista avisa «La Biblioteca necesita revisión…», los originales no se han modificado y los conflictos y registros inválidos quedan conservados o excluidos hasta que se resuelvan.
- Papelera: «Impacto de la papelera» explica qué se pierde; «No se puede vaciar todavía» aparece cuando hay enlaces activos con vaults («Hay enlaces activos con vaults. Desvincúlalos explícitamente antes de retirar estas fichas del catálogo.»). Vaciar la papelera saca los elementos del catálogo activo, conserva una copia de recuperación local y nunca borra análisis de los vaults.
- Cualquier operación de la biblioteca global falla con «Configura primero la carpeta de copias de seguridad de Nodus.» si no hay servicio de recuperación configurado.`,
      en: `- The "Review and recovery" dialogue audits manifests, links and files without modifying vaults, and reports metrics: items and attachments reviewed, conflicts, invalid records, missing files, damaged attachments and orphan folders. With no problems it says "No integrity issues were detected.".
- "Audit again" repeats the check; "Rebuild catalogue" remakes the catalogue, aliases, searches and links from nodus-library.
- When the view warns "The Library needs review…", originals have not been modified and conflicts and invalid records stay kept or excluded until resolved.
- Trash: "Trash impact" explains what is lost; "Cannot empty yet" appears while links to vaults are active ("There are active links to vaults. Unlink them explicitly before removing these records from the catalogue."). Emptying the trash removes items from the active catalogue, keeps a local recovery copy and never deletes vault analyses.
- Any global library operation fails with "Set up the Nodus backup folder first." when no recovery service is configured.`,
    },
    related: ['sections-library', 'troubleshooting-backup-recovery'],
  },
  {
    id: 'troubleshooting-backup-recovery',
    area: 'troubleshooting',
    title: { es: 'Copias de seguridad, recuperación y beta', en: 'Backups, recovery and beta' },
    keywords: ['copia de seguridad falla', 'recuperacion', 'recuperar datos', 'salud de la copia', 'nunca se ha hecho', 'hace demasiado tiempo', 'carpeta inalcanzable', 'contrasena maestra', 'clave de recuperacion', 'restaurar', 'beta no se instala', 'snapshot previo'],
    body: {
      es: `- La salud de las copias se resume en un titular con consejo: «Las copias de seguridad automáticas están desactivadas.» → actívalas; «No se puede acceder a la carpeta de copias de seguridad.» → conecta la unidad o vuelve a elegir la carpeta; «La última copia de seguridad falló.» → revisa el detalle y vuelve a introducir la contraseña maestra si es necesario; «Todavía no se ha completado ninguna copia de seguridad.» → haz una copia ahora para comprobar que todo funciona; «Hace demasiado tiempo que no se completa una copia de seguridad.» → comprueba que el equipo está encendido a la hora programada; «Tus datos están protegidos.» cuando todo va bien. La edad se muestra como «Última copia: hoy / ayer / hace N días».
- El asistente de recuperación («RECUPERACIÓN ACTIVADA») elige o crea la carpeta segura, valida la carpeta («La carpeta debe estar vacía o contener una recuperación de Nodus válida…»), pide una contraseña maestra de al menos 8 caracteres y guarda un kit de recuperación. La base de datos activa nunca se abre directamente desde Google Drive o Dropbox: así se evitan conflictos y corrupción.
- Restaurar pide contraseña o clave de recuperación; si algo falla, Nodus intenta preservar el estado anterior. Mensajes típicos: «La copia seleccionada no pertenece a esta carpeta de recuperación.», «Datos recuperados y copia de seguridad previa conservada por seguridad.» y «Datos recuperados con la clave de recuperación. Puedes establecer una contraseña nueva en Ajustes.».
- Si una copia no se puede descifrar o no es de esta versión, el mensaje lo indica (por ejemplo, formato no soportado, hashes de integridad que no coinciden o copia de una versión más reciente).
- En el canal Beta, una actualización no se instala sin Recuperación configurada: «La beta no se instalará hasta que configures Recuperación con una carpeta y contraseña válidas.» y, si la copia previa falla, «La beta no se instaló porque no pudo crearse y verificarse la copia de seguridad previa. Tus datos no se han modificado.».
- Los snapshots previos a migraciones permiten abrir una versión anterior como bóveda separada si algo saliera mal.`,
      en: `- Backup health is one headline with advice: automatic backups are off → turn them on; the backup folder is unreachable → connect the drive or choose the folder again; the last backup failed → check the detail and re-enter the master password if needed; no backup has ever completed → make one now to prove it works; it has been too long → check the machine is on at the scheduled hour; and "Your data is protected." when all is well. Age shows as "Last backup: today / yesterday / N days ago".
- The recovery wizard ("RECOVERY ENABLED") picks or creates the safe folder, validates it ("The folder must be empty or hold a valid Nodus recovery…"), asks for a master password of at least 8 characters and saves a recovery kit. The active database is never opened directly from Google Drive or Dropbox, which prevents conflicts and corruption.
- Restoring asks for the password or the recovery key; if something fails, Nodus tries to preserve the previous state. Typical messages: "The selected copy does not belong to this recovery folder.", "Data recovered and a previous backup kept for safety." and "Data recovered with the recovery key. You can set a new password in Settings.".
- If a copy cannot be decrypted or is from another version, the message says so (unsupported format, integrity hashes that do not match, or a copy from a newer version).
- On the Beta channel an update will not install without Recovery configured: "The beta will not install until you set up Recovery with a valid folder and password." and, if the prior copy fails, "The beta was not installed because the previous backup could not be created and verified. Your data has not been modified.".
- Pre-migration snapshots let you open an earlier version as a separate vault if something went wrong.`,
    },
    related: ['settings-backup', 'troubleshooting-index'],
  },
  {
    id: 'troubleshooting-server-mcp',
    area: 'troubleshooting',
    title: { es: 'Servidor, MCP y red: errores frecuentes', en: 'Server, MCP and network: frequent errors' },
    keywords: ['servidor no accesible', 'https', 'credenciales', 'espacio', 'tailscale', 'red local', 'certificado', 'mcp error', 'puerto ocupado', 'no confirma', 'cloudflare error', 'publicar falla'],
    body: {
      es: `- Servidor: «Introduce una URL válida del servidor.», «Nodus Server necesita HTTPS fuera de localhost.», «Usa solo la dirección base del servidor, sin credenciales, parámetros ni fragmentos.», «El correo o la contraseña no son correctos.», «Ese servidor es anterior a los vaults conectados. Pide que lo actualicen.», «El servidor respondió con HTTP {estado}.», «El servidor rechazó la conexión (HTTP {estado}).» y «El servidor no confirmó la recepción (HTTP {estado}).».
- Publicación en Cloudflare: «Nodus Cloud respondió con HTTP {estado}.», «Nodus Cloud rechazó un archivo (HTTP {estado}).» y «El índice {tipo} ({bytes} bytes) supera el límite seguro de búsqueda exacta…» (hay que reducir lo publicado).
- Red local y Tailscale: «Este ordenador no está conectado a ninguna red local ahora mismo.», «Tailscale está instalado pero este ordenador no ha iniciado sesión en ninguna red…» y «Falta activar los certificados HTTPS de tu red de Tailscale.». Con certificado propio aparece un aviso de seguridad la primera vez; hay que comparar la huella y no continuar si no coincide.
- MCP: «Error del servidor MCP: {error}» o estado «Apagado»; el puerto debe estar entre 1024 y 65535 y libre. «Token MCP regenerado. Reconecta los clientes con el nuevo token.» recuerda que los clientes deben reconectar.
- Túnel de ChatGPT: ver la ficha del túnel; la causa más común es una clave de ejecución sin permisos Tunnels Read + Use o un ID mal copiado.
- Recuerda que servidor y MCP son independientes: no comparten puerto, listener ni token, y arreglar uno no arregla el otro.`,
      en: `- Server: "Enter a valid server URL.", "Nodus Server needs HTTPS outside localhost.", "Use only the server's base address, without credentials, parameters or fragments.", "The email or password is not correct.", "That server predates connected vaults. Ask for an update.", "The server answered HTTP {status}.", "The server refused the connection (HTTP {status})." and "The server did not confirm receipt (HTTP {status}).".
- Cloudflare publishing: "Nodus Cloud answered HTTP {status}.", "Nodus Cloud rejected a file (HTTP {status})." and "The {kind} index ({bytes} bytes) exceeds the safe exact-search limit…" (publish less).
- Local network and Tailscale: "This computer is not connected to any local network right now.", "Tailscale is installed but this computer has not signed in to any network…" and "HTTPS certificates for your Tailscale network still need enabling.". With a self-signed certificate a security warning appears the first time; compare the fingerprint and stop if it does not match.
- MCP: "MCP server error: {error}" or state "Off"; the port must be between 1024 and 65535 and free. "MCP token regenerated. Reconnect clients with the new token." reminds you that clients must reconnect.
- ChatGPT tunnel: see the tunnel sheet; the most common cause is a runtime key without Tunnels Read + Use permissions or a mistyped ID.
- Remember that server and MCP are independent: they share no port, listener or token, and fixing one does not fix the other.`,
    },
    related: ['server-overview', 'server-mcp'],
  },
  {
    id: 'troubleshooting-performance',
    area: 'troubleshooting',
    title: { es: 'Rendimiento: qué limita y qué ajustar', en: 'Performance: what limits it and what to tune' },
    keywords: ['lento', 'rendimiento', 'tarda mucho', 'concurrencia', 'llamadas simultaneas', 'trabajadores documentales', 'vault grande', 'memoria', 'gpu', 'logs', 'cola', 'limite'],
    body: {
      es: `- La IA tiene dos controles de ritmo: «Llamadas simultáneas» (Automático o Manual 1-8) y, en la Biblioteca, la «Concurrencia documental» (Automático usa dos trabajadores; reduce el valor si el proveedor limita las solicitudes).
- Automático ya reduce a la mitad la concurrencia cuando el proveedor responde con un límite de tasa, y muestra el motivo por proveedor y modelo en Ajustes > Modelos IA.
- Con modelos locales, el límite real es el equipo: una ranura salvo calibración, y el uso de CPU, GPU y memoria lo comparten la aplicación y el modelo.
- Un contexto de 32K-128K aumenta mucho el uso de memoria y la latencia y no mejora por sí solo la longitud de la salida. En análisis profundos, «Modo de contexto deep scan» y «Palabras por fragmento» tienen el mismo efecto.
- Los registros de procesamiento se agrupan cuando se repiten («Se agruparon {count} repeticiones idénticas») y se descartan por ráfaga («Se descartaron {count} entradas por límite de ráfaga»), con retención limitada en días y número de entradas.
- Importar bases de datos con muchos archivos puede tardar horas y la propia interfaz lo avisa; en documentos muy largos, el lector de la Biblioteca está en beta y puede tardar y no acertar con la estructura.`,
      en: `- AI has two pacing controls: "Simultaneous calls" (Automatic or Manual 1-8) and, in the Library, "Document concurrency" (Automatic uses two workers; lower it when the provider limits requests).
- Automatic already halves concurrency when the provider answers with a rate limit, and shows the per-provider reason in Settings > AI models.
- With local models the real limit is the machine: one slot unless calibrated, and the application and the model share CPU, GPU and memory.
- A 32K-128K context greatly increases memory use and latency and does not by itself lengthen the output. In deep analyses, "Deep scan context mode" and "Words per chunk" have the same effect.
- Processing logs are grouped when repeated ("{count} identical repetitions were grouped") and dropped under bursts ("{count} entries were dropped by the burst limit"), with retention capped by days and entry count.
- Importing databases with many files can take hours and the interface says so; for very long documents the Library reader is in beta and may take a while and misread the structure.`,
    },
    related: ['settings-models-advanced', 'troubleshooting-index'],
  },
  {
    id: 'troubleshooting-app-errors',
    area: 'troubleshooting',
    title: { es: 'Fallos de la aplicación y arranque', en: 'Application failures and startup' },
    keywords: ['algo ha fallado', 'error inesperado', 'recargar nodus', 'no arranca', 'no inicia', 'pantalla en blanco', 'se cierra', 'error de arranque', 'reintentar'],
    body: {
      es: `- Si una sección falla, aparece «Algo ha fallado en esta sección» con el mensaje «Se produjo un error inesperado al mostrar esta vista. El resto de la app sigue funcionando: reinténtalo o cambia de sección.» y los botones «Reintentar» o «Recargar Nodus». El error técnico se muestra en monoespaciada y el fallo de la vista no afecta al resto.
- Un fallo fatal de arranque muestra un diálogo nativo con «Nodus no pudo iniciarse» y el detalle de lo ocurrido, además de la sugerencia de restaurar una copia de seguridad o abrir otra bóveda.
- Antes de eso, la aplicación pasa por pantallas propias: «Cargando Nodus…» mientras lee los ajustes y un estado de error de preload con «Reintentar».
- Los errores no controlados del proceso se registran en el log de procesamiento y en la consola, sin cerrar la aplicación.
- Para informar de un fallo, usa «Sugerir / Reportar»: adjunta versión, sistema operativo, arquitectura y versión de Electron, y pide los pasos para reproducirlo.`,
      en: `- When a section fails, "Something failed in this section" appears with "An unexpected error occurred while showing this view. The rest of the app keeps working: retry or switch section." and the buttons "Retry" or "Reload Nodus". The technical error is shown in monospace and the failure does not affect the rest.
- A fatal startup failure shows a native dialogue with "Nodus could not start" and the detail, plus the suggestion to restore a backup or open another vault.
- Before that, the application goes through its own screens: "Loading Nodus…" while it reads settings, and a preload error state with "Retry".
- Unhandled process errors are recorded in the processing log and the console without closing the application.
- To report a failure use "Suggest / Report": it attaches version, operating system, architecture and Electron version, and asks for the steps to reproduce it.`,
    },
    related: ['troubleshooting-index', 'settings-updates-about'],
  },
  {
    id: 'troubleshooting-data-locations',
    area: 'privacy',
    title: { es: 'Dónde guarda Nodus cada cosa', en: 'Where Nodus keeps everything' },
    keywords: ['donde se guardan los datos', 'ubicacion', 'userdata', 'carpeta', 'sqlite', 'base de datos', 'claves', 'secretos', 'logs', 'tessdata', 'modelos locales', 'copia', 'library', 'nodus-library'],
    body: {
      es: `- Todo vive dentro de la carpeta de datos de la aplicación del sistema operativo (userData): «vaults/<id>/nodus.sqlite» es el registro y la base de datos de cada bóveda, y «library» (o la carpeta «nodus-library» elegida para las copias) guarda la biblioteca global con originales, Markdown limpio e imágenes.
- Las claves de API se guardan cifradas en «secrets» con el almacén seguro del sistema; nunca están en claro en el disco y no cruzan a la interfaz.
- El registro de procesamiento está en «nodus-logs.json» (permisos 0600) y queda excluido de las copias y de la sincronización.
- El motor y los modelos locales viven en «local-ai» (modelos, runtime, calibración y «runtime.log»); Tesseract guarda sus datos de idioma en «tessdata»; el túnel MCP en «mcp-tunnel»; las skills y los plugins en «skills» y «plugins».
- El chat de Nodi, las notas y las notificaciones se guardan en archivos propios del perfil (historial de chat, notas y notificaciones).
- Las copias de seguridad viven en la carpeta que elija el usuario, con un manifiesto «nodus-recovery.json» y una carpeta de snapshots.`,
      en: `- Everything lives inside the operating system's application data folder (userData): "vaults/<id>/nodus.sqlite" is each vault's registry and database, and "library" (or the "nodus-library" folder chosen for backups) holds the global library with originals, clean Markdown and images.
- API keys are stored encrypted in "secrets" using the system's secure store; they are never plaintext on disk and never cross into the interface.
- The processing log lives in "nodus-logs.json" (0600 permissions) and is excluded from backups and sync.
- The local engine and models live in "local-ai" (models, runtime, calibration and "runtime.log"); Tesseract keeps its language data in "tessdata"; the MCP tunnel in "mcp-tunnel"; skills and plugins in "skills" and "plugins".
- Nodi's chat, notes and notifications are stored in the profile's own files (chat history, notes and notifications).
- Backups live in the folder the user chooses, with a "nodus-recovery.json" manifest and a snapshots folder.`,
    },
    related: ['privacy-what-is-sent', 'settings-backup'],
  },
];
