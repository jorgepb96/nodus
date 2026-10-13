import type { NodusDocTopic } from './types';

/** The protocol sheet, the whole-application map and the vault catalogue. */
export const CORE_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'protocol-answer-rules',
    area: 'protocol',
    title: { es: 'Protocolo: cómo responder sobre Nodus', en: 'Protocol: how to answer about Nodus' },
    keywords: ['protocolo', 'reglas', 'como responder', 'base', 'citar', 'no inventar', 'verificado', 'no verificado', 'fuentes', 'protocol', 'grounding', 'cite'],
    body: {
      es: `- Responde solo con lo que dicen las fichas de documentación de este turno y la vista o bóveda seleccionada. Usa los nombres exactos de la interfaz tal como aparecen aquí.
- Termina siempre con una línea «Base:» con los ids de las fichas que hayas usado (por ejemplo «Base: sections-library, troubleshooting-index»).
- Distingue con claridad cuatro estados: disponible ahora, condicional (depende de un ajuste, un proveedor, un tipo de bóveda o una conexión), futuro o planificado (roadmap) y no verificado. No presentes nunca algo planificado como disponible.
- Si la respuesta no está en las fichas, di «No puedo verificarlo con las fuentes seleccionadas», indica qué contexto lo aclararía (por ejemplo, activar Vista actual, o Bóveda actual) y no propongas rutas, botones ni atajos inventados.
- No deduzcas funciones por analogía con otras aplicaciones. No inventes nombres de menús, versiones, fechas ni estados del roadmap: el roadmap no tiene fechas cerradas.
- Cuando pidan una ubicación o un procedimiento, da pasos numerados breves, con la ruta completa (por ejemplo «Ajustes > Servidor»), y menciona los requisitos previos y qué ocurre si faltan.
- Indica la fase (PRE-ALPHA, ALPHA, BETA) siempre que la bóveda o la función la tenga, y no recomiendes para trabajo real una bóveda PRE-ALPHA o ALPHA.
- Respeta la privacidad: di qué se envía a un proveedor externo y qué se queda en el equipo cuando la pregunta toque datos, modelos o publicación.
- Si el problema del usuario es un error concreto, ordena la respuesta así: qué significa, por qué ocurre, cómo se resuelve paso a paso, y cómo comprobar que quedó resuelto.
- Sé breve y directo: pasos numerados, rutas completas y la explicación justa. No repitas el índice, ni el material recibido, ni la pregunta. Una respuesta corta y completa vale más que un listado exhaustivo de todo lo que sabes del tema.`,
      en: `- Answer only from the documentation sheets served this turn plus the selected view or vault. Use the exact interface names as written here.
- Always end with a "Base:" line naming the sheets you used (for example "Base: sections-library, troubleshooting-index").
- Distinguish four states: available now, conditional (depends on a setting, a provider, a vault type or a connection), future or planned (roadmap), and unverified. Never present a planned item as available.
- If the answer is not in the sheets, say so plainly, name the context that would settle it (for example enabling Current view or the active vault), and never propose an invented route, button or shortcut.
- Do not infer features by analogy with other applications. Never invent menu names, versions, dates or roadmap states: the roadmap has no committed dates.
- For a location or a procedure, give short numbered steps with the full route (for example "Settings > Server") plus the prerequisites and what happens when they are missing.
- State the phase (PRE-ALPHA, ALPHA, BETA) whenever the vault or feature carries one, and never recommend a PRE-ALPHA or ALPHA vault for real work.
- Respect privacy: when the question touches data, models or publishing, say what leaves the machine and what does not.
- Be brief and direct: numbered steps, full routes and just enough explanation. Do not restate the index, the material you received or the question. A short, complete answer beats an exhaustive dump of everything you know about the topic.`,
    },
    related: ['general-what-is-nodus'],
  },
  {
    id: 'general-what-is-nodus',
    area: 'general',
    title: { es: 'Qué es Nodus y cómo está organizado', en: 'What Nodus is and how it is organised' },
    keywords: ['nodus', 'que es', 'aplicacion', 'local', 'local-first', 'sin cuenta', 'boveda', 'vault', 'organizacion', 'cuenta', 'offline', 'privacidad', 'overview', 'estructura'],
    body: {
      es: `- Nodus es una aplicación de escritorio (Electron) local-first: no requiere cuenta, no incluye publicidad ni telemetría y guarda los datos en el equipo del usuario.
- El espacio de trabajo se organiza en bóvedas («vault»). Cada bóveda es un proyecto con su propia base de datos, sus secciones, su paleta y sus ajustes. La bóveda activa se cambia desde la insignia centrada de la cabecera o con el comando «Bóvedas» de la paleta.
- Hay nueve tipos de bóveda: Académico, Fuentes primarias, Testimonios, Bases de datos, Docencia, Estudio, Genealogía, Prosopografía y Worldbuilding. Cada tipo decide qué secciones aparecen, marca los prompts y ajusta la interfaz.
- La barra lateral agrupa las secciones en Explorar, Analizar, Escribir y Herramientas. Inicio y Ajustes están fijos, primero y último. Las secciones se pueden ocultar, mostrar y reordenar.
- La IA es opcional y se configura en Ajustes > Proveedores y Ajustes > Modelos IA. Sin modelo configurado, las funciones que lo necesitan avisan en lugar de fallar en silencio.
- La mascota Nodi es el asistente de la aplicación: está en la esquina inferior derecha o en su propia ventana flotante, y responde sobre el funcionamiento de Nodus y sobre el contenido de las bóvedas según los contextos que se activen.
- La documentación de producto de Nodi no cubre el contenido del usuario: para eso están los contextos Vista actual, Bóveda actual y Todos los vaults.`,
      en: `- Nodus is a local-first desktop application (Electron): it needs no account, contains no advertising and no telemetry, and keeps its data on the user's machine.
- Work is organised in vaults. Each vault is a project with its own database, sections, palette and settings. The active vault is switched from the centred header badge or the "Vaults" command in the palette.
- There are nine vault types: Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography and Worldbuilding. The type decides which sections appear, shapes the prompts and adjusts the interface.
- The sidebar groups sections into Explore, Analyse, Write and Tools. Home and Settings are fixed, first and last. Sections can be hidden, shown and reordered.
- AI is optional and is configured in Settings > Providers and Settings > AI models. Without a model, features that need one warn instead of failing silently.
- Nodi is the application's companion: it lives in the bottom-right corner or in its own floating window, and answers about how Nodus works and about vault content according to the contexts that are enabled.
- Nodi's product documentation does not cover the user's own content: the Current view, Active vault and All vaults contexts do.`,
    },
    related: ['general-header', 'vaults-overview', 'general-roadmap'],
  },
  {
    id: 'general-header',
    area: 'general',
    title: { es: 'Cabecera: cada control y dónde está', en: 'Header: every control and where it sits' },
    keywords: ['cabecera', 'header', 'iconos', 'barra superior', 'orden', 'insignia', 'boveda activa', 'tema', 'idioma', 'campana', 'notificaciones', 'cola', 'titulo', 'header actions', 'toolbar'],
    body: {
      es: `- A la izquierda está el logotipo de Nodus Research; al pulsarlo se pliega o despliega el menú lateral («Mostrar el menú lateral» / «Ocultar el menú lateral»).
- En el centro, la insignia de la bóveda activa abre el selector de bóvedas («Bóveda activa»). Si no cabe por el ancho de la ventana, la insignia se oculta y el mismo panel se abre con el comando «Bóvedas» de la paleta.
- El rail derecho, en este orden: Comandos, Asistente (chat de investigación), Herramientas, Skills, Bandeja (solo si ha llegado algo), Medios (solo si Nodus Browser está reproduciendo), Sugerir / Reportar, Actualizar (sincronizar Zotero, solo en bóvedas con Zotero), selector de tema claro/oscuro, Actualización lista (solo si hay una descarga terminada), Cola y tareas, Notificaciones y Ajustes.
- «Configura un modelo de IA» aparece junto a la insignia cuando no hay modelo general, y el botón del Asistente cambia su tooltip a ese aviso: al pulsarlo se abre el modal «Configura un modelo de IA» en lugar del chat.
- La barra lateral se redimensiona arrastrando su borde (64–360 px); doble clic restablece el ancho (176 px) y con el foco en el asa funcionan Inicio, Fin y las flechas.
- «Cola y tareas» muestra el trabajo en curso (análisis, indexado, generación) y avisa con un contador rojo cuando algo requiere atención; los registros de procesamiento se abren desde ahí.
- «Notificaciones» está justo antes de Ajustes y abre el panel de avisos y actividad. Ajustes es el último icono y también la última entrada de la barra lateral.`,
      en: `- On the left sits the Nodus Research logo; clicking it collapses or expands the sidebar ("Show sidebar" / "Hide sidebar").
- In the centre, the active vault badge opens the vault picker ("Active vault"). If the badge does not fit the window width it is hidden, and the same panel opens through the "Vaults" palette command.
- The right rail, in order: Commands, Research chat, Tools, Skills, Inbox (only when something arrived), Media (only while Nodus Browser is playing), Suggest / Report, Refresh (Zotero sync, only in vaults with Zotero), light/dark theme switch, Update ready (only when a download finished), Queue and tasks, Notifications and Settings.
- "Configure an AI model" appears next to the badge when no general model is set, and the Research chat button switches its tooltip to that warning: clicking it opens the "Configure an AI model" modal instead of the chat.
- The sidebar is resized by dragging its edge (64–360 px); double-click restores the width (176 px) and Home, End and the arrow keys work while the handle has focus.
- "Queue and tasks" shows running work (analysis, indexing, generation) and raises a red counter when something needs attention; processing logs open from there.
- "Notifications" sits immediately before Settings and opens the notices and activity panel. Settings is the last icon and also the last sidebar entry.`,
    },
    related: ['general-command-palette', 'general-notifications', 'general-sidebar'],
  },
  {
    id: 'general-command-palette',
    area: 'general',
    title: { es: 'Paleta de comandos', en: 'Command palette' },
    keywords: ['paleta', 'comandos', 'atajo', 'ctrl k', 'cmd k', '⌘k', 'buscar seccion', 'command palette', 'shortcut', 'acciones', 'roadmap', 'tema'],
    body: {
      es: `- Se abre con el botón «Comandos» de la cabecera o con ⌘K en macOS (Ctrl K en Windows y Linux) desde cualquier punto de la aplicación.
- Placeholder «Ir a una sección o ejecutar una acción…». La búsqueda es por subcadena sin acentos; ↑ y ↓ mueven la selección, Intro ejecuta, Escape cierra.
- Contiene una entrada de navegación por cada sección permitida por el tipo de bóveda, agrupadas como la barra lateral (Explorar, Analizar, Escribir, Herramientas) o en General para Inicio y Ajustes.
- Acciones: «Bóvedas», «Research chat», «Mis skills», «Marketplace», «Nodus Presenter», «Sugerir función o reportar error», «Roadmap», «Usar tema claro»/«Usar tema oscuro», «Reducir animaciones»/«Activar animaciones» y «Cambiar paleta de tema» (rota a la siguiente paleta, incluidas las personalizadas).
- En una bóveda de Estudio aparece además «Entrar en modo lectura»/«Salir del modo lectura». En bóvedas académicas aparecen «Actualizar (sincronizar Zotero)» y «Colecciones de Zotero».
- Si no hay coincidencias muestra «Sin resultados.».`,
      en: `- Opened from the header "Commands" button or with ⌘K on macOS (Ctrl K on Windows and Linux) from anywhere in the application.
- Placeholder "Go to a section or run an action…". Search is accent-insensitive substring matching; ↑ and ↓ move the selection, Enter runs it, Escape closes.
- It lists one navigation entry per section allowed by the vault type, grouped like the sidebar (Explore, Analyse, Write, Tools) or General for Home and Settings.
- Actions: "Vaults", "Research chat", "My skills", "Marketplace", "Nodus Presenter", "Suggest a feature or report a bug", "Roadmap", "Use light theme"/"Use dark theme", "Reduce animations"/"Enable animations" and "Change theme palette" (cycles to the next palette, custom ones included).
- In a Study vault it also offers "Enter reading mode"/"Leave reading mode". In academic vaults it offers "Refresh (sync Zotero)" and "Zotero collections".
- With no matches it shows "No results.".`,
    },
    related: ['general-header', 'general-sidebar'],
  },
  {
    id: 'general-sidebar',
    area: 'general',
    title: { es: 'Barra lateral: grupos, ocultar y reordenar', en: 'Sidebar: groups, hiding and reordering' },
    keywords: ['barra lateral', 'sidebar', 'menu', 'secciones', 'ocultar', 'mostrar', 'reordenar', 'orden', 'personalizar', 'grupos', 'navegacion', 'menu lateral'],
    body: {
      es: `- Las secciones se agrupan en Explorar, Analizar, Escribir y Herramientas; Inicio y Ajustes quedan fijos como primera y última entrada y no se mueven.
- Se personalizan en Ajustes > Interfaz > Barra lateral: se arrastran con el ratón o se mueven con las flechas, y el ojo de cada fila la muestra u oculta.
- Algunas secciones vienen ocultas de fábrica según el tipo de bóveda (por ejemplo Hipótesis y Ruta de lectura en Académico): siguen existiendo y se pueden activar ahí.
- Los tipos con barra propia (Fuentes primarias, Testimonios, Prosopografía, Worldbuilding, Estudio, Docencia, Bases de datos) usan sus propios grupos, y el editor de Ajustes respeta esos grupos.
- Las herramientas fijadas desde el catálogo Nodus Tools se integran en el grupo Herramientas.`,
      en: `- Sections are grouped into Explore, Analyse, Write and Tools; Home and Settings stay fixed as the first and last entry and cannot be moved.
- They are customised in Settings > Interface > Sidebar: drag with the mouse or move with the arrow keys, and each row's eye shows or hides it.
- Some sections ship hidden for a given vault type (Hypotheses and Reading path in Academic, for instance): they still exist and can be enabled there.
- Vault types with their own sidebar (Primary sources, Testimonies, Prosopography, Worldbuilding, Study, Teaching, Databases) use their own groups, and the settings editor respects them.
- Tools pinned from the Nodus Tools catalogue are merged into the Tools group.`,
    },
    related: ['general-header', 'vaults-overview'],
  },
  {
    id: 'general-notifications',
    area: 'general',
    title: { es: 'Notificaciones y actividad', en: 'Notifications and activity' },
    keywords: ['notificaciones', 'campana', 'avisos', 'actividad', 'leido', 'marcar como leido', 'limpiar', 'anuncios', 'notifications', 'bell', 'announcements'],
    body: {
      es: `- El icono de campana está justo antes de Ajustes y abre un panel con dos listas: «Avisos de Nodus» (avisos publicados entre versiones, se marcan leídos uno a uno) y «Actividad» (lo que ha hecho la aplicación, se marca leída en bloque al abrir el panel).
- El contador de la campana suma los avisos no leídos y la actividad no leída.
- Los avisos pueden traer un enlace externo («Abrir enlace», que además lo marca como leído) y una acción hacia Nodus Radar.
- «Limpiar» pide confirmación («Se eliminarán todos los avisos de Nodus y la actividad reciente. Esta acción no se puede deshacer.») y vacía el historial de actividad.
- Los avisos se publican en un archivo público de Nodus y se consultan cada cuatro horas; se pueden desactivar en Ajustes > Actualizaciones y novedades con la casilla «Recibir avisos» (al desactivarla, Nodus no hace esa petición).
- Nodi muestra las mismas notificaciones en su propio panel, también con la mascota desactivada.`,
      en: `- The bell icon sits just before Settings and opens a panel with two lists: "Nodus notices" (published between versions, marked read one by one) and "Activity" (what the application has done, marked read in one go when the panel opens).
- The bell counter adds unread notices and unread activity.
- Notices may carry an external link ("Open link", which also marks them read) and an action into Nodus Radar.
- "Clear" asks for confirmation ("All Nodus notices and recent activity will be deleted. This cannot be undone.") and empties the activity history.
- Notices are published in a public Nodus file and fetched every four hours; they can be switched off in Settings > Updates and news with the "Receive notices" checkbox (switching it off stops that request).
- Nodi shows the same notifications in its own panel, and works even with the mascot disabled.`,
    },
    related: ['general-header', 'troubleshooting-index'],
  },
  {
    id: 'general-inbox',
    area: 'general',
    title: { es: 'Bandeja: lo que llega de otros dispositivos', en: 'Inbox: what arrives from other devices' },
    keywords: ['bandeja', 'inbox', 'servidor', 'otro dispositivo', 'llega', 'pendiente', 'aplicado', 'rechazado', 'kept local', 'no aparece el icono'],
    body: {
      es: `- El icono «Bandeja» solo aparece cuando ha llegado algo desde otro dispositivo: en una instalación local sin Nodus Server no existe.
- Es propia de cada bóveda conectada a Nodus Server y agrupa las entradas por elemento padre, con contador de no leídas y expansión por fila.
- Cada entrada muestra el resultado: «Aplicado», «Eliminado», «Se conservó tu versión» o «Rechazado», con el motivo cuando lo hay, además del dispositivo de origen y el tiempo relativo.
- Abrir una entrada marca solo esa como leída. «Marcar todo como leído» y «Vaciar la bandeja» están en el panel. Abrir el panel no marca nada por sí solo.
- Si la entrada es un informe de Deep Research aplicado, al abrirla se abre ese informe en Deep Research.
- Requiere que el vault esté conectado en Ajustes > Servidor y que el servidor haya recibido cambios de otros dispositivos.`,
      en: `- The "Inbox" icon only appears when something has arrived from another device: a local installation without Nodus Server has no inbox.
- It belongs to each vault connected to Nodus Server and groups entries by parent element, with an unread counter and per-row expansion.
- Each entry shows the outcome: "Applied", "Deleted", "Your version was kept" or "Refused", with the reason when there is one, plus the source device and the relative time.
- Opening an entry marks only that one as read. "Mark all as read" and "Empty the inbox" live in the panel. Opening the panel marks nothing by itself.
- When the entry is an applied Deep Research report, opening it loads that report in Deep Research.
- It requires the vault to be connected in Settings > Server and the server to have received changes from other devices.`,
    },
    related: ['server-overview'],
  },
  {
    id: 'general-vaults-manage',
    area: 'general',
    title: { es: 'Crear, cambiar, renombrar, duplicar, reinicializar y eliminar bóvedas', en: 'Create, switch, rename, duplicate, reset and delete vaults' },
    keywords: ['crear boveda', 'nueva boveda', 'cambiar boveda', 'renombrar', 'duplicar', 'reinicializar', 'restablecer', 'eliminar boveda', 'borrar boveda', 'anadir boveda', 'demo', 'datos de demostracion', 'primera boveda', 'vault'],
    body: {
      es: `- El panel se abre desde la insignia «Bóveda activa» de la cabecera (o con el comando «Bóvedas» si la insignia no cabe). Tiene buscador, filtro por tipo y orden por último uso, fecha de creación o nombre.
- Cada fila ofrece «Cargar» (cambiar a esa bóveda), «Renombrar», «Duplicar» y «Eliminar».
- «Añadir bóveda» ofrece dos orígenes: «Bóveda local» (vive solo en este equipo, es lo habitual) y «Bóveda conectada» (réplica de un espacio de Nodus Server, con inicio de sesión y elección de espacio; indica si el acceso es de solo lectura, escritura o propietario).
- Al crear una bóveda local se elige nombre, tipo (rejilla de nueve tipos) y paleta. Después se eligen modelos de IA y embeddings. Un nombre vacío avisa «Escribe un nombre para la bóveda.».
- Los tipos PRE-ALPHA (Fuentes primarias, Testimonios, Prosopografía) piden una confirmación extra («¿Crear un vault PRE-ALPHA?» → «Sí, crear solo para pruebas») porque no están pensados para trabajo real.
- «Duplicar» crea una copia con todos los datos. «Reinicializar bóveda» borra los datos de esa bóveda en tres pasos (aviso, código de cuatro cifras que no se puede pegar, confirmación final). «Eliminar» usa el mismo flujo destructivo y está deshabilitado para la bóveda activa («La bóveda activa no se puede eliminar. Carga otra bóveda antes.») y para la bóveda principal («La bóveda principal no se puede eliminar; puedes reinicializarla.»).
- Las bóvedas nuevas pueden empezar con datos de demostración: la oferta aparece en Inicio cuando la bóveda está vacía («Cargar demo académica», «Cargar demo de genealogía», «Cargar demo de bases de datos», «Cargar demo de docencia», «Cargar demo de worldbuilding», «Cargar demo de testimonios», «Cargar demo de fuentes primarias»). Con la demo activa hay un aviso ámbar en toda la aplicación con «Salir del modo demo».
- En la primera instalación aparecen, en este orden: la guía esencial, la pantalla de primera bóveda (nombre y tipo), la configuración de Recuperación y el asistente de bienvenida. Los tutoriales por tipo de bóveda se pueden repetir desde Ajustes > Tutoriales.`,
      en: `- The panel opens from the "Active vault" badge in the header (or the "Vaults" command when the badge does not fit). It offers search, a type filter and ordering by last use, creation date or name.
- Each row offers "Load" (switch to that vault), "Rename", "Duplicate" and "Delete".
- "Add vault" offers two origins: "Local vault" (lives only on this machine, the usual choice) and "Connected vault" (a replica of a Nodus Server space, with sign-in and space selection; it states whether access is read-only, write or owner).
- Creating a local vault asks for a name, a type (a grid of nine) and a palette. AI and embedding models are chosen next. An empty name warns "Type a name for the vault.".
- PRE-ALPHA types (Primary sources, Testimonies, Prosopography) ask for an extra confirmation ("Create a PRE-ALPHA vault?" → "Yes, create for testing only") because they are not meant for real work.
- "Duplicate" creates a copy with all its data. "Reset vault" deletes that vault's data in three steps (warning, a four-digit code that cannot be pasted, final confirmation). "Delete" uses the same destructive flow and is disabled for the active vault ("The active vault cannot be deleted. Load another vault first.") and for the main vault ("The main vault cannot be deleted; you can reset it.").
- New vaults can start from demo data: the offer appears on Home while the vault is empty ("Load academic demo", "Load genealogy demo", and so on per type). While the demo is active an amber banner with "Leave demo mode" runs across the application.
- On a first installation the order is: the essentials guide, the first-vault screen (name and type), Recovery setup and the welcome assistant. Per-type tours can be replayed from Settings > Tutorials.`,
    },
    related: ['vaults-overview', 'settings-interface', 'settings-backup'],
  },
  {
    id: 'general-roadmap',
    area: 'general',
    title: { es: 'Roadmap: qué está implementado y qué no', en: 'Roadmap: what exists and what does not' },
    keywords: ['roadmap', 'planificado', 'en desarrollo', 'implementado', 'futuro', 'proximamente', 'estado', 'versiones', 'fechas', 'ios', 'ipad', 'colaboracion', 'servidor'],
    body: {
      es: `- El roadmap se abre desde Ajustes > Acerca de Nodus Research > «Ver roadmap de Nodus» y desde la paleta de comandos.
- Estado actual: «Pulido y estabilidad» figura como En desarrollo. Como Planificado figuran «Servidor», «Compartir vaults y trabajo colaborativo» y «Apps para iOS y iPadOS». Como Implementado figuran Docencia, Fuentes primarias, Testimonios, los vaults sugeridos por usuarios (Prosopografía y Worldbuilding), Nodus Toolkit, Nodus Translate, Nodus Presenter y OCR Workspace.
- No hay fechas cerradas para ninguna iniciativa: no atribuyas fechas ni versiones de llegada.
- «Implementado» significa que la función existe y se puede abrir; no implica que sea estable. Cada tipo de bóveda indica además su fase (PRE-ALPHA, ALPHA o BETA).
- El trabajo colaborativo y compartir vaults no están disponibles: no los presentes como funciones actuales. Nodus Server sí existe como infraestructura de publicación y réplica, y se configura en Ajustes > Servidor.`,
      en: `- The roadmap opens from Settings > About Nodus Research > "View roadmap" and from the command palette.
- Current state: "Polish and stability" is In progress. Planned are "Server", "Vault sharing and collaboration" and "iOS and iPadOS apps". Implemented are Teaching, Primary sources, Testimonies, the user-suggested vaults (Prosopography and Worldbuilding), Nodus Toolkit, Nodus Translate, Nodus Presenter and OCR Workspace.
- No initiative has a committed date: never attach dates or release versions to one.
- "Implemented" means the feature exists and can be opened; it does not imply stability. Every vault type also states its phase (PRE-ALPHA, ALPHA or BETA).
- Collaboration and vault sharing are not available: never present them as current features. Nodus Server does exist as publishing and replication infrastructure, configured in Settings > Server.`,
    },
    related: ['vaults-overview', 'server-overview'],
  },
  {
    id: 'vaults-overview',
    area: 'vaults',
    title: { es: 'Los nueve tipos de bóveda y su fase', en: 'The nine vault types and their phase' },
    keywords: ['tipos de boveda', 'que boveda elijo', 'elegir boveda', 'fases', 'pre-alpha', 'alpha', 'beta', 'academico', 'genealogia', 'fuentes primarias', 'testimonios', 'bases de datos', 'docencia', 'estudio', 'prosopografia', 'worldbuilding', 'vault types'],
    body: {
      es: `- Académico: investigación, análisis y escritura. Sin insignia de fase.
- Estudio: aprendizaje y materiales de estudio. BETA.
- Docencia: cursos, evaluación y materiales. BETA.
- Genealogía: historia familiar y archivos. BETA.
- Bases de datos: tablas, datos y análisis. BETA.
- Worldbuilding: mundos, personajes y narrativas. ALPHA (solo testers).
- Fuentes primarias: archivos y fuentes históricas. PRE-ALPHA.
- Testimonios: entrevistas, historia oral y periodismo. PRE-ALPHA.
- Prosopografía: personas, relaciones, identidades y evidencias biográficas. PRE-ALPHA.
- Las bóvedas PRE-ALPHA y ALPHA no deben recomendarse para trabajo real: su finalidad es probar funciones incompletas y reportar errores. Las bóvedas BETA son funcionales pero siguen necesitando correcciones.
- El tipo se elige al crear la bóveda. Cambiarlo después no está documentado como una acción disponible: si alguien lo necesita, indícalo como no verificado en lugar de inventar una ruta.`,
      en: `- Academic: research, analysis and writing. No phase badge.
- Study: learning and study materials. BETA.
- Teaching: courses, assessment and materials. BETA.
- Genealogy: family history and archives. BETA.
- Databases: tables, data and analysis. BETA.
- Worldbuilding: worlds, characters and narratives. ALPHA (testers only).
- Primary sources: archives and historical sources. PRE-ALPHA.
- Testimonies: interviews, oral history and journalism. PRE-ALPHA.
- Prosopography: people, relations, identities and biographical evidence. PRE-ALPHA.
- PRE-ALPHA and ALPHA vaults must never be recommended for real work: they exist to try incomplete features and report bugs. BETA vaults are functional but still need fixes.
- The type is chosen when the vault is created. Changing it afterwards is not documented as an available action: treat that as unverified instead of inventing a route.`,
    },
    related: ['general-vaults-manage', 'general-what-is-nodus'],
  },
  {
    id: 'general-tutorials-onboarding',
    area: 'general',
    title: { es: 'Tutoriales, guía esencial y asistente de bienvenida', en: 'Tutorials, essentials guide and welcome assistant' },
    keywords: ['tutorial', 'tutoriales', 'guia', 'onboarding', 'bienvenida', 'primeros pasos', 'volver a ver', 'empezar', 'tour', 'recorrido', 'aprendizaje'],
    body: {
      es: `- Ajustes > Tutoriales reúne los vídeos y recorridos: «Guía esencial de Nodus e IA» (botón «Empezar»), «Tutorial de uso» («Ver de nuevo»), «Tutorial avanzado de investigación» y los recorridos por tipo de bóveda (genealogía, fuentes primarias, bases de datos, testimonios, estudio, docencia), todos con «Ver de nuevo».
- Los recorridos también aparecen solos la primera vez: el recorrido básico, el avanzado y el del tipo de bóveda correspondiente, en ese orden.
- La guía esencial aparece en la primera instalación y también al pulsar «Empezar» en Ajustes > Tutoriales; al completarla se marcan como vistos los vídeos de esa guía.
- Crear una bóveda o cargar datos de demostración no abre los tutoriales: aparecen al crear un vault nuevo de verdad o cuando se piden desde Ajustes.
- El asistente de bienvenida se puede descartar («Salir y descartar»); si la bóveda se acababa de crear, al descartarlo se vuelve a la bóveda anterior.`,
      en: `- Settings > Tutorials gathers the videos and tours: "Nodus and AI essentials guide" ("Start"), "Usage tutorial" ("Watch again"), "Advanced research tutorial" and the per-vault-type tours (genealogy, primary sources, databases, testimonies, study, teaching), all with "Watch again".
- Tours also run by themselves the first time: the basic tour, the advanced one and the one for the current vault type, in that order.
- The essentials guide appears on a first installation and when "Start" is pressed in Settings > Tutorials; completing it marks that guide's videos as seen.
- Creating a vault or loading demo data does not open the tutorials: they appear when a real new vault is created or when requested from Settings.
- The welcome assistant can be dismissed ("Exit and discard"); if the vault had just been created, dismissing it returns to the previous vault.`,
    },
    related: ['general-vaults-manage', 'settings-interface'],
  },
];
