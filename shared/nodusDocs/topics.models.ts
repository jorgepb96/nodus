import type { NodusDocTopic } from './types';

/** Local models: the warning the app shows, the bundled runtime and the connections. */
export const MODEL_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'models-local-warning',
    area: 'models',
    title: { es: 'El aviso rojo de los modelos locales', en: 'The red local-model notice' },
    keywords: ['aviso rojo', 'modelo local', 'triangulo rojo', 'que significa el aviso', 'ia local', 'local model', 'ollama', 'lm studio', 'gemma', 'rendimiento', 'hardware', 'privacidad local'],
    body: {
      es: `- Cuando el modelo elegido (general o de una tarea) es local, junto al selector aparece un botón circular rojo con un triángulo y el nombre accesible «Aviso sobre los modelos locales». Se abre al pasar el ratón o al pulsarlo, y se cierra con Escape o con un clic fuera.
- El texto del aviso, en español, es: «Los modelos locales pueden tardar bastante en procesar, sobre todo en equipos poco potentes. Nodus analiza los documentos por fragmentos en vez de enviarlos todos de golpe, y eso exige recursos incluso a los modelos pequeños.»
- «Todavía estamos optimizando los modelos locales incluidos. Gemma es ahora mismo la opción recomendada, aunque pueden quedar problemas menores. Ollama y LM Studio también son compatibles; los proveedores en la nube están mucho más probados y siguen siendo la opción más fiable para Nodus.»
- «Si encuentras cualquier problema, avísanos: los comentarios y las contribuciones que ayuden a mejorar el soporte de modelos locales son siempre bienvenidos.»
- Se considera local a los proveedores «Nodus local», Ollama y LM Studio. El proveedor Custom (OpenAI-compatible) no cuenta como local a propósito, porque su dirección puede apuntar a un servidor remoto.
- Son locales: nada de lo que se procesa sale del equipo, y por eso no hay coste por token ni límite de proveedor. A cambio compiten por la CPU, la GPU y la memoria con el resto de la aplicación.
- Los selectores nunca preseleccionan un modelo local: elegirlo es una decisión informada del usuario.`,
      en: `- When the selected model (general or per task) is local, a round red button with a triangle and the accessible name "About local models" appears beside the picker. It opens on hover or click and closes with Escape or a click outside.
- The notice reads: "Local models may require significant processing time, especially on less powerful hardware. Nodus analyzes documents in multiple chunks rather than sending them all at once, which can be demanding even for smaller models."
- "We're still optimizing the bundled local models. Gemma is currently the recommended option, although minor issues may remain. Ollama and LM Studio are also supported, while cloud providers have been more extensively tested and currently remain the most reliable option for Nodus."
- "If you encounter any problems, please report them — feedback and contributions that help improve local model support are always welcome."
- "Nodus local", Ollama and LM Studio count as local. The Custom (OpenAI-compatible) provider deliberately does not, because its address may point at a remote server.
- Because they are local, nothing leaves the machine and there is no per-token cost or provider limit. In exchange they compete for CPU, GPU and memory with the rest of the application.
- The pickers never preselect a local model: choosing one is an informed decision by the user.`,
    },
    related: ['models-local-runtime', 'troubleshooting-local-ai'],
  },
  {
    id: 'models-local-runtime',
    area: 'models',
    title: { es: 'Motor local integrado: instalación, modelos y calibración', en: 'Bundled local engine: install, models and calibration' },
    keywords: ['motor local', 'llama.cpp', 'instalar motor', 'descargar modelo', 'gemma', 'qwen', 'granite', 'embeddings locales', 'harrier', 'bge-m3', 'e5', 'sha-256', 'calibracion', 'ranuras', 'slots', 'gpu', 'diagnostico', 'runtime'],
    body: {
      es: `- El motor (llama.cpp) no viene incluido: se instala desde Ajustes > Modelos IA > «Modelos locales integrados» con «Instalar motor local». Los modelos se descargan bajo demanda y se verifica su SHA-256.
- Modelos integrados de conversación y visión: gemma-4-e2b (el recomendado, capacidades completas), qwen3.5-0.8b (solo chat y visión), granite-4.0-micro (solo texto) y lfm2.5-vl-1.6b. Los más pequeños tienen bloqueadas por fiabilidad la extracción de ideas, la fusión, los perfiles y los resúmenes: Nodus lo dice en el propio selector y no deja usarlos para eso.
- Modelos de embeddings: harrier-oss-v1-0.6b (la mayor calidad multilingüe; añade por sí solo la instrucción de búsqueda a las consultas y reserva unos 6,5 GB de memoria de GPU), bge-m3, gte-multilingual-base y multilingual-e5-small (la opción ligera para equipos con menos memoria). BGE-M3 y GTE tienen un perfil «CLS», el recomendado, y otro «mean» que solo se conserva para los índices preparados con él; comparten la descarga.
- Todos los modelos integrados trabajan con 32K de contexto. La concurrencia arranca en 1 ranura segura; «Calibrar» mide cuántas peticiones simultáneas admite el equipo y no se ejecuta solo. Si la calibración falla, se mantiene una ranura.
- El panel de diagnóstico muestra si corre en CPU o con GPU, el dispositivo, las capas descargadas a la GPU (ajustadas a la memoria libre), si se detectó una GPU NVIDIA y su controlador, la concurrencia medida con su motivo y la ruta del registro del motor.
- Si el motor no arranca, la app sugiere excluir su carpeta en el antivirus y muestra la causa (bloqueo de seguridad del sistema, memoria insuficiente para el modelo y las capas, biblioteca del sistema ausente, dispositivo no utilizable o arranque agotado).
- Errores frecuentes y qué hacer: «Instala primero el motor local de Nodus desde Ajustes → Modelos IA.» (falta el motor); «Descarga primero «{modelo}»…» (falta el modelo); «La verificación SHA-256 de «{modelo}» ha fallado. Bórralo y vuelve a descargarlo.» (descarga corrupta); «Espera a que termine la descarga antes de eliminar el modelo.» y «El modelo tiene solicitudes en curso…» (está ocupado).`,
      en: `- The engine (llama.cpp) is not bundled: install it from Settings > AI models > "Built-in local models" with "Install local engine". Models are downloaded on demand and their SHA-256 is verified.
- Built-in chat and vision models: gemma-4-e2b (the recommended one, full capabilities), qwen3.5-0.8b (chat and vision only), granite-4.0-micro (text only) and lfm2.5-vl-1.6b. The smaller ones have idea extraction, merging, profiles and summaries blocked for reliability: Nodus says so in the picker and will not use them for that.
- Embedding models: harrier-oss-v1-0.6b (the highest multilingual quality; it adds its search instruction to queries on its own and reserves about 6.5 GB of GPU memory), bge-m3, gte-multilingual-base and multilingual-e5-small (the light option for machines with less memory). BGE-M3 and GTE have a "CLS" profile, the recommended one, and a "mean" profile kept only for indexes prepared with it; both share the download.
- Every built-in model works with a 32K context. Concurrency starts at 1 safe slot; "Calibrate" measures how many simultaneous requests the machine sustains and never runs on its own. If calibration fails, one slot is kept.
- The diagnostics panel shows whether it runs on CPU or GPU, the device, the layers offloaded to the GPU (fitted to free memory), whether an NVIDIA GPU and driver were detected, the measured concurrency with its reason and the engine log path.
- If the engine will not start, the app suggests excluding its folder in the antivirus and shows the cause (system security block, not enough memory for the model and layers, missing system library, no usable device, or startup timed out).
- Common errors and what to do: "Install the local Nodus engine first from Settings → AI models." (engine missing); "Download «{model}» first…" (model missing); "The SHA-256 check for «{model}» failed. Delete it and download it again." (corrupt download); "Wait for the download to finish before deleting the model." and "The model has requests in flight…" (busy).`,
    },
    related: ['models-local-warning', 'troubleshooting-local-ai', 'settings-models-advanced'],
  },
  {
    id: 'models-local-servers',
    area: 'models',
    title: { es: 'Ollama, LM Studio y servidores compatibles', en: 'Ollama, LM Studio and compatible servers' },
    keywords: ['ollama', 'lm studio', 'lmstudio', 'servidor local', 'puerto', 'num_ctx', 'context length', 'ventana de contexto', 'vllm', 'litellm', 'llama.cpp server', 'custom', 'openai compatible', 'token'],
    body: {
      es: `- Ollama y LM Studio son proveedores locales sin clave: Ollama debe estar en marcha con los modelos descargados («ollama pull») y LM Studio con el servidor iniciado (Developer → Start Server) y al menos un modelo cargado.
- La dirección se puede editar (por defecto http://localhost:11434 para Ollama y http://localhost:1234 para LM Studio) y admite IP:puerto de otro equipo de la red local. Si la instancia está protegida con token, se pega en el mismo panel.
- «Ventana de contexto» ofrece Auto (recomendado, hasta 32K) y valores de 4K a 128K. El propio aviso advierte de que 32K–128K aumenta mucho el uso de RAM/VRAM y la latencia y no mejora por sí sola la longitud de salida.
- «Probar conexión» comprueba el servidor y hay un diagnóstico de la última petición local.
- Un servidor propio (LiteLLM, vLLM, llama.cpp o un proxy) se conecta con el proveedor Custom (OpenAI-compatible): URL completa, clave opcional y modelos escritos a mano si el servidor no publica catálogo.
- Si el modelo local se queda corto de contexto, el error exacto es: «El modelo local «{modelo}» no tiene suficiente contexto para esta tarea: necesita ~N tokens (ventana actual: M tokens). Aumenta el contexto del modelo en {proveedor} (num_ctx si es Ollama, Context Length si no), elige un modelo con más contexto, reduce el tamaño de la tarea (menos texto por lote) o usa un proveedor en la nube para tareas grandes.»
- Si la respuesta se corta por el límite de salida, el aviso lo dice y recuerda que un modelo con razonamiento puede gastar ese presupuesto pensando antes de escribir.`,
      en: `- Ollama and LM Studio are local providers with no key: Ollama must be running with models pulled ("ollama pull"), and LM Studio with its server started (Developer → Start Server) and at least one model loaded.
- The address is editable (http://localhost:11434 for Ollama and http://localhost:1234 for LM Studio by default) and accepts IP:port of another machine on the local network. If the instance is protected with a token, it is pasted in the same panel.
- "Context window" offers Auto (recommended, up to 32K) and values from 4K to 128K. The notice itself warns that 32K–128K greatly increases RAM/VRAM use and latency and does not by itself lengthen the output.
- "Test connection" checks the server, and the last local request has its own diagnostic.
- Your own server (LiteLLM, vLLM, llama.cpp or a proxy) connects through the Custom (OpenAI-compatible) provider: full URL, optional key and hand-typed models when the server publishes no catalogue.
- When a local model runs out of context the exact error is: "The local model «{model}» does not have enough context for this task: it needs ~N tokens (current window: M tokens). Raise the model's context in {provider} (num_ctx for Ollama, Context Length otherwise), choose a model with more context, reduce the task size (less text per batch) or use a cloud provider for large tasks."
- When the answer is cut off by the output limit, the notice says so and reminds you that a reasoning model may spend that budget thinking before writing.`,
    },
    related: ['troubleshooting-context-overflow', 'settings-providers'],
  },
  {
    id: 'models-embeddings',
    area: 'models',
    title: { es: 'Embeddings: para qué sirven y cuándo reindexar', en: 'Embeddings: what they are for and when to reindex' },
    keywords: ['embeddings', 'vectores', 'semantica', 'similitud', 'reindexar', 'indexar pendientes', 'modelo de embeddings', 'cambiar embeddings', 'busqueda semantica', 'indice'],
    body: {
      es: `- Los embeddings son lo que hace posible la búsqueda semántica, las relaciones entre ideas y la recuperación de pasajes: sin un modelo de embeddings configurado, esas funciones no pueden indexar ni comparar.
- El modelo se elige en Ajustes > Modelos IA («Modelo de embeddings (similitud semántica multilingüe)»), y puede ser local (harrier-oss-v1-0.6b, bge-m3, gte-multilingual-base o multilingual-e5-small) o de un proveedor en la nube. El proveedor Custom no genera embeddings.
- Si se cambia de modelo de embeddings, los vectores anteriores no sirven con el nuevo: Nodus avisa («Los embeddings creados con el modelo anterior no son compatibles con el nuevo…») y hay que reindexar.
- «Indexar pendientes» procesa lo que falta; «Reindexar todo» vuelve a construir el índice completo. La indexación nunca publica un índice incompleto: si fallan embeddings, el trabajo avisa en lugar de dejar un índice a medias.
- En Fuentes primarias el indexado es específico del archivo («Indexar archivo») y no aparece «Reindexar todo».`,
      en: `- Embeddings are what makes semantic search, relations between ideas and passage retrieval possible: without an embedding model those features cannot index or compare anything.
- The model is chosen in Settings > AI models ("Embedding model (multilingual semantic similarity)") and may be local (harrier-oss-v1-0.6b, bge-m3, gte-multilingual-base or multilingual-e5-small) or from a cloud provider. The Custom provider does not generate embeddings.
- Changing the embedding model makes previous vectors useless: Nodus warns about it and a reindex is required.
- "Index pending" processes what is missing; "Reindex everything" rebuilds the whole index. Indexing never publishes a partial index: when embeddings fail, the job reports it instead of leaving a half-built index.
- In Primary sources indexing is archive-specific ("Index archive") and "Reindex everything" is not offered.`,
    },
    related: ['troubleshooting-embeddings', 'settings-models-basic'],
  },
  {
    id: 'models-optional-engines',
    area: 'models',
    title: { es: 'Transcripción, imagen local y voz', en: 'Transcription, local image and voice' },
    keywords: ['transcripcion', 'stt', 'whisper', 'transformers.js', 'onnx', 'diarizacion', 'imagen local', 'stable-diffusion', 'flux', 'voz', 'piper', 'kokoro', 'hume', 'audio'],
    body: {
      es: `- Transcripción de audio (Ajustes > Modelos IA): motor local Transformers.js + ONNX (por defecto, con modelos descargables), whisper.cpp o la API de OpenAI. Con la API de OpenAI hay que tener en cuenta que no ofrece diarización.
- Generación de imágenes local: motor stable-diffusion.cpp con FLUX.2 Klein 4B Q4 y tres calidades (Borrador 640×384, Equilibrada 896×512 y Alta 1152×640). El panel avisa de la licencia y de la memoria necesaria.
- Audio y voz: motores locales Piper y Kokoro y Hume en la nube con clave propia; velocidad ajustable de 0.7 a 1.3 y descarga de voces con filtros por idioma.
- Estas funciones requieren descargar sus modelos o instalar su motor, y consumen CPU, GPU y memoria del equipo mientras trabajan.`,
      en: `- Audio transcription (Settings > AI models): local Transformers.js + ONNX engine (default, with downloadable models), whisper.cpp or the OpenAI API. Note that the OpenAI API does not offer diarisation.
- Local image generation: stable-diffusion.cpp engine with FLUX.2 Klein 4B Q4 and three qualities (Draft 640×384, Balanced 896×512 and High 1152×640). The panel warns about the licence and the memory required.
- Audio and voice: local Piper and Kokoro engines and cloud Hume with your own key; speed adjustable from 0.7 to 1.3 and voice downloads filtered by language.
- These features require downloading their models or installing their engine, and they use the machine's CPU, GPU and memory while running.`,
    },
    related: ['settings-models-advanced', 'sections-study-materials-recordings'],
  },
];
