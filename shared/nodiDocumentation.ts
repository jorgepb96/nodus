import type { PromptLanguage } from './types';

/**
 * Verified product facts used by both the UI and Nodi. Keeping the roadmap here
 * prevents the assistant and the visible modal from drifting apart.
 */
export type RoadmapStatus = 'planned' | 'inProgress' | 'implemented';

export interface RoadmapItem {
  title: string;
  detail: string;
  status: RoadmapStatus;
  children?: readonly RoadmapItem[];
}

export const NODUS_ROADMAP = [
  { title: 'Pulido y estabilidad', detail: 'Corregir errores, mejorar el rendimiento y pulir la experiencia general con feedback de usuarios.', status: 'inProgress' },
  { title: 'Servidor', detail: 'Infraestructura opcional para nuevas capacidades conectadas.', status: 'planned' },
  { title: 'Compartir vaults y trabajo colaborativo', detail: 'Compartir espacios y colaborar con control sobre los datos.', status: 'planned' },
  { title: 'Apps para iOS y iPadOS', detail: 'Llevar Nodus a iPhone y iPad con aplicaciones nativas adaptadas a cada dispositivo.', status: 'planned' },
  { title: 'Vault de docencia', detail: 'Preparar clases, cursos y materiales docentes, protegiendo los datos del alumnado.', status: 'implemented' },
  { title: 'Vault de fuentes primarias', detail: 'Organizar documentos históricos y trabajar con evidencia documental.', status: 'implemented' },
  { title: 'Vault de testimonios (historia oral)', detail: 'Entrevistas, transcripciones y fuentes orales para historia y periodismo.', status: 'implemented' },
  {
    title: 'Vaults sugeridos por usuarios',
    detail: 'Nuevos ámbitos con especialistas, colaboración activa y testers.',
    status: 'implemented',
    children: [
      { title: 'Vault de prosopografía', detail: 'Personas, relaciones, identidades y evidencias biográficas para investigación histórica.', status: 'implemented' },
      { title: 'Vault de worldbuilding', detail: 'Personajes, lugares, cronologías y reglas de mundos narrativos.', status: 'implemented' },
    ],
  },
  { title: 'Nodus Toolkit', detail: 'Herramientas prácticas y local-first para convertir archivos y procesar documentos, integradas en Nodus.', status: 'implemented' },
  { title: 'Nodus Translate', detail: 'Traducir texto, documentos y adjuntos de Zotero con el modelo elegido, conservando la estructura de DOCX y EPUB y la apariencia de los PDF mediante un modo facsímil.', status: 'implemented' },
  { title: 'Nodus Presenter', detail: 'Presentar archivos PDF y presentaciones externas con vista del presentador, control remoto desde el móvil, notas del orador y herramientas de anotación en directo.', status: 'implemented' },
  { title: 'Nodus OCR Workspace', detail: 'OCR asistido por IA para PDF escaneados e imágenes, con revisión página a página, limpieza de texto, reprocesamiento e integración directa con las bóvedas de Nodus.', status: 'implemented' },
] satisfies readonly RoadmapItem[];

const ROADMAP_STATUS_GUIDE: Record<RoadmapStatus, string> = {
  planned: 'Planificado',
  inProgress: 'En desarrollo',
  implemented: 'Implementado',
};

const ROADMAP_GUIDE = NODUS_ROADMAP.map((item, index) => {
  const children = item.children?.map((child) => `   - ${child.title} [${ROADMAP_STATUS_GUIDE[child.status]}]: ${child.detail}`).join('\n');
  return `${index + 1}. ${item.title} [${ROADMAP_STATUS_GUIDE[item.status]}]: ${item.detail}${children ? `\n${children}` : ''}`;
}).join('\n');

/**
 * Compact product guide grounded only in routes and capabilities present in the
 * current source tree. Roadmap entries carry their explicit product state and
 * must not be described with a different one.
 */
export const NODUS_DOCUMENTATION = `# Guía interna verificable de Nodus

## Reglas de lectura de esta guía
- Esta guía documenta la interfaz actual y el roadmap oficial visible de la aplicación.
- El roadmap distingue entre elementos planificados, en desarrollo e implementados. No atribuyas fechas ni versiones si no aparecen aquí.
- «Implementado» significa que el vault o la función existe y se puede abrir; no significa que haya alcanzado una versión estable.
- Nodus es local-first: cada bóveda guarda sus datos en el equipo del usuario.
- Las claves de proveedores se configuran en Ajustes > Proveedores. Los modelos favoritos se eligen allí y cada función conserva su propio selector.

## Vaults disponibles y nivel de madurez
- Todos los tipos que aparecen a continuación se pueden crear desde Bóvedas > Añadir bóveda: Académico, Fuentes primarias, Testimonios, Bases de datos, Docencia, Estudio, Genealogía, Prosopografía y Worldbuilding.
- Fuentes primarias, Testimonios y Prosopografía están en PRE-ALPHA: no son utilizables para trabajo real. Solo están disponibles para personas que quieran probar funciones incompletas y reportar errores o propuestas de mejora. Antes de crearlos aparece una confirmación específica.
- Worldbuilding está en ALPHA: sus funciones principales siguen en prueba y se recomienda únicamente a testers.
- Bases de datos, Docencia, Estudio y Genealogía están en BETA: son funcionales, pero todavía necesitan feedback y correcciones.
- Académico no muestra una etiqueta de fase en el selector.
- Crear o cargar datos de demostración no abre el tutorial. El tutorial aparece al crear un vault o cuando el usuario lo abre expresamente desde Ajustes > Tutoriales.

## Cabecera y controles globales
- En el extremo derecho de la cabecera están, en este orden general: Comandos, Asistente, Herramientas, controles condicionales del vault, Sugerir / Reportar, selector de tema claro/oscuro, Notificaciones y Ajustes.
- Herramientas abre el hub Nodus Toolkit; está justo después del botón Asistente.
- Notificaciones está inmediatamente antes de Ajustes y es el último icono antes de él. Abre un panel con dos listas: «Avisos de Nodus» (avisos publicados entre versiones, que se marcan como leídos uno a uno) y «Actividad» (lo que ha hecho la aplicación, que se marca como leído al abrir el panel). Muestra las mismas notificaciones que Nodi, y funciona aunque la mascota esté desactivada.
- El selector de tema claro/oscuro está justo antes de Notificaciones.
- La bóveda activa se abre desde la insignia centrada en la cabecera, no desde un icono del extremo derecho: esa insignia abre el selector para cambiar, crear, renombrar, duplicar, restablecer o eliminar bóvedas según la acción disponible. En la paleta de comandos también existe la acción «Bóvedas».
- Colecciones ya no tiene icono propio en la cabecera; se abre desde la paleta de comandos, en bóvedas académicas.
- Bandeja solo aparece cuando ha llegado algo desde otro dispositivo; es propia de cada bóveda conectada a Nodus Server.
- Comandos abre la paleta global; su atajo visible es ⌘K en macOS.
- El botón Asistente de la cabecera abre el asistente de investigación. Nodi es la mascota independiente situada en la zona inferior derecha cuando está habilitada.

## Roadmap oficial visible
El roadmap se abre desde Ajustes > Acerca de Nodus Research > Ver roadmap de Nodus Research, y también desde la paleta de comandos. El orden vigente es:
${ROADMAP_GUIDE}

## Ajustes
- Ajustes es el último elemento de la barra lateral y también tiene un icono en el extremo derecho de la cabecera.
- Sus pestañas reales son: Proveedores, Modelos IA, Biblioteca, Texto y OCR, Interfaz, Integraciones, Servidor, Tutoriales, Backup / copia de seguridad, Acerca de Nodus Research y Actualizaciones y novedades.
- Proveedores: claves API, proveedores locales y modelos favoritos.
- Modelos IA: modelo general y modelos específicos de las distintas tareas.
- Biblioteca: integración y sincronización con Zotero. Testimonios, Prosopografía y Worldbuilding no usan Zotero y no muestran ese recorrido.
- Interfaz: idioma, tema, accesibilidad, barra lateral y Mascota Nodi.
- Integraciones: servidor MCP local y copilotos de escritura para Word y LibreOffice.
- Servidor: conexión de cada vault con Nodus Server y publicación de su copia filtrada.
- Tutoriales: ayuda y recorridos de la aplicación.
- Backup / copia de seguridad: copias, importación, exportación y mantenimiento.
- La visibilidad, ventana flotante y trajes de Nodi están en Ajustes > Interfaz > Mascota Nodi.

## Vault académico
- Se orienta a investigación y escritura académica.
- Puede incluir Inicio, Buscar, Biblioteca, Grafo, Mapa de argumentos, Ideas, Autores, Inmersión, Huecos, Debates, Cobertura, Hipótesis, Ruta de lectura, Deep Research, Escritura, Proyectos, Notas y Ajustes.
- Las secciones pueden ocultarse o reordenarse desde Ajustes > Interfaz > Barra lateral.
- Deep Research recupera evidencia del corpus, genera un informe y permite exportarlo como documento o PDF con la identidad visual del vault.

## Vault de genealogía
- Está disponible y se orienta a historia familiar respaldada por documentos.
- Incluye Personas, Línea temporal, Árbol genealógico, Relaciones sociales, Mapa y Archivo.
- Las afirmaciones sobre identidades y parentescos deben apoyarse en registros o evidencias. Compartir apellido, domicilio o aparecer en el mismo documento no prueba parentesco.

## Vault de bases de datos
- Está disponible y gestiona tablas estructuradas con columnas tipadas, filas, vistas, búsqueda, análisis y Chat de datos.
- Las bases creadas por el usuario aparecen en la barra lateral. Las secciones fijas incluyen Buscar, Análisis y Chat de datos.

## Vault de estudio
- Está disponible. Su jerarquía es Curso > Asignatura; dentro de una asignatura puede haber carpetas, temas, subtemas, apuntes y materiales.
- Incluye Cursos y asignaturas, Horarios, Calendario, Buscar, Materiales, Grabaciones, Chat de estudio, Ideas, Grafo, Banco de preguntas y Revisión.
- Horarios usa un icono de reloj; Calendario usa un icono de calendario.
- En Horarios, al pulsar una celda se abre un desplegable para añadir una asignatura existente o una actividad independiente.
- El Calendario ofrece vistas mensual, semanal y anual, eventos con avisos y exportación a iCloud o Google Calendar.
- El Banco de preguntas contiene preguntas, tests, exámenes y flashcards; una flashcard se abre en su modal específico.

## Vault de docencia
- Está implementado y disponible en BETA. Reutiliza la organización de Curso > Asignatura y añade un espacio de trabajo docente.
- Sus secciones implementadas incluyen Cursos, asignaturas y grupos, Grupos, Horarios, Calendario, Materiales, Grabaciones, Chat, Ideas, Grafo, Banco de preguntas, Rúbricas, Exámenes, Calificaciones y Diseño de unidades.
- Guía docente / Programación, Situaciones de aprendizaje, Adaptaciones, Notas y Proyectos de innovación aparecen como elementos «En diseño»: abren su hilo de feedback y no deben describirse como funciones terminadas.
- Para empezar: crea cursos y asignaturas, crea los grupos, añade materiales y después usa las superficies de evaluación que necesites. Los datos del alumnado se gestionan dentro de Grupos y Calificaciones.

## Vault de fuentes primarias
- Está implementado y disponible en PRE-ALPHA exclusivamente para colaboración y pruebas, no para trabajo real.
- Sus secciones son Buscar, Archivo, Personas, Línea temporal, Mapa, Relaciones sociales, Notas, Toolkit y Ajustes.
- Archivo organiza documentos por ubicación archivística o colecciones de trabajo. El panel lateral del árbol se puede ocultar y volver a mostrar con su control de panel.
- Para añadir documentos: abre Archivo y usa Añadir fuente. La tabla muestra los metadatos catalográficos y una miniatura cuando existe una imagen.
- Al pulsar una fila se abre el modal del documento. Desde ese modal se consultan y editan los datos catalográficos, descripción, texto, evidencias, análisis, notas, historial, archivos y representaciones; las acciones compactas usan iconos con etiquetas accesibles.
- El usuario puede escoger el icono o tipo documental; Nodus sugiere uno según el tipo de fuente, pero la decisión sigue siendo editable.
- En Mapa se representa la procedencia asignada a cada fuente, no todas las ciudades mencionadas en su texto. La procedencia se elige en el documento mediante un desplegable conectado a los lugares disponibles en el mapa.
- Todo resultado automático es una propuesta pendiente de revisión. Distingue transcripción, observación e inferencia y conserva procedencia, localizadores, contradicciones e incertidumbre.

## Vault de testimonios
- Está implementado y disponible en PRE-ALPHA exclusivamente para colaboración y pruebas, no para trabajo real.
- Sus secciones son Buscar, Entrevistas, Participantes, Contrastes, Notas, Toolkit y Ajustes.
- El trabajo específico sucede dentro del dossier de cada entrevista: sesiones, medios, transcripciones, fragmentos, códigos, anotaciones, acuerdos y restricciones. Las vistas del menú reúnen lo que atraviesa varias entrevistas.
- Para empezar: crea una entrevista, registra participantes y acuerdos, añade una sesión o medio y prepara o importa la transcripción. Los códigos y anotaciones se aplican sobre fragmentos; Contrastes compara fragmentos documentados.
- Al editar un participante se usa un modal dentro de la vista actual.
- Nodi respeta acceso, anonimización, embargo y atribución. No debe exponer material que el acuerdo no autorice ni inferir atributos sensibles, emociones, sinceridad o credibilidad.

## Vault de prosopografía
- Está implementado y disponible en PRE-ALPHA exclusivamente para colaboración y pruebas, no para trabajo real.
- Sus secciones son Buscar, Población, Personas, Fuentes, Análisis, Redes, Notas, Toolkit y Ajustes.
- Flujo recomendado: define y versiona la metodología de población; diseña el cuestionario y vocabularios; registra fuentes y segmentos; captura factoids y statements atómicos; resuelve identidades; decide la pertenencia; y solo después ejecuta análisis o redes.
- Buscar recorre personas, menciones, fuentes y statements. Análisis declara población, denominador, ausencias y huella de entrada. Redes separa visualmente relaciones explícitas, derivadas e hipótesis.
- No confundas persona, mención, fuente, factoid y statement. No fusiones identidades ni conviertas una observación documental en hecho sin revisión.

## Vault de worldbuilding
- Está implementado y disponible en ALPHA, recomendado solo para testers.
- Explorar incluye Enciclopedia, Personajes, Lugares, Facciones, Culturas, Cronología, Mapa, Relaciones, Familias y Dinastías.
- Analizar incluye Chat del mundo, Reglas del mundo, Conflictos, Arcos narrativos, Continuidad y Preguntas abiertas. Crear incluye Notas, Escenas y Manuscrito.
- Para empezar: registra las fichas canónicas del mundo; relaciona personajes, lugares, grupos y escenas; define reglas y líneas narrativas; usa Continuidad para detectar tensiones documentadas; y redacta en Manuscrito.
- El autor es la fuente de verdad. Nodi no inventa canon: debe distinguir claramente entre información establecida y propuesta.

## Herramientas (Nodus Toolkit)
- Herramientas es una sección de la barra lateral, en su propio grupo, y también tiene un icono en la cabecera. Aparece en todos los tipos de vault.
- Su página principal es un hub con cinco tarjetas: Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter y OCR Workspace.
- Nodus Convert ya funciona: convierte y procesa archivos en local, de uno en uno o en lote, en cinco categorías —Documentos (PDF, DOCX, EPUB, Markdown, HTML, texto), utilidades PDF (unir, dividir, rotar, reordenar, extraer imágenes, metadatos, imágenes→PDF), OCR ligero (imagen o PDF escaneado a texto, y PDF buscable), Imágenes (convertir formato incluido HEIC, redimensionar, comprimir) y Texto (limpiar texto pegado de PDF, mayúsculas/minúsculas, subtítulos a texto, checksums).
- Nodus Protect ya funciona: admite PDF e imágenes del disco o de la bóveda activa, concatena documentos, permite ocultar o desenfocar datos, recortar, rotar, enderezar, convertir a escala de grises, añadir siete patrones de marca de agua y un pie legal, y exportar copias rasterizadas como PNG, ZIP o PDF.
- Protect puede guardar una copia en disco, compartirla o incorporarla a la biblioteca «Copias protegidas» de la bóveda. También crea y verifica marcas trazables IDPS v1 compatibles con IDprotector; la marca autentica una copia, pero no la cifra y puede perderse por JPEG, capturas, reescalado o recompresión.
- Nodus Translate ya funciona: traduce texto pegado, archivos TXT, Markdown, HTML, DOCX, EPUB y PDF, así como adjuntos importados de Zotero. Permite elegir idioma de destino, modelo, carpeta y formato de salida, además de añadir idioma de origen y glosario opcionales.
- En DOCX y EPUB, Translate conserva directamente estilos, jerarquía, cabeceras, pies, notas, enlaces e imágenes del archivo original. En PDF ofrece un modo de lectura redistribuida y un modo facsímil rasterizado que mantiene páginas, geometría, fondos e imágenes y sustituye visiblemente el texto en su posición; puede usar visión para escaneados y texto dentro de imágenes. Si una traducción no cabe, reduce el tamaño y avisa de las páginas afectadas.
- La traducción requiere el proveedor de IA seleccionado y puede enviarle el texto o las páginas que deban reconocerse. El archivo original nunca se modifica: el resultado se guarda como una copia nueva.
- Nodus Presenter ya se puede abrir: importa archivos PDF o presentaciones creadas en PowerPoint, LibreOffice o Keynote a una biblioteca global de Herramientas (con etiquetas, búsqueda, orden y miniaturas). Las presentaciones externas se convierten localmente a PDF, tras avisar de que las animaciones y transiciones no se conservan; las notas de los PowerPoint modernos se importan automáticamente. También permite escribir notas por diapositiva, exportarlas e importarlas juntas en TXT, añadir vídeos de YouTube por diapositiva y descargar el PDF de la presentación desde la biblioteca. Al presentar abre la diapositiva a pantalla completa (en la pantalla externa si hay dos) y una vista del presentador con la diapositiva actual, la siguiente, las notas, un temporizador y el reloj; incluye herramientas de anotación en directo (linterna, dibujo, puntero y lupa), pantalla en negro, y control remoto desde el móvil escaneando un código QR protegido por PIN. El único elemento que necesita conexión son los vídeos de YouTube; el resto funciona sin internet.
- OCR Workspace ya se puede abrir y ofrece un flujo asistido por IA para importar escaneados, revisar y corregir cada página y exportar el resultado.
- Nodus Convert es determinista y 100 % offline (no hay IA), nunca modifica el archivo original y no sube nada a ningún servicio; la única llamada de red opcional es la descarga de idiomas de OCR de Tesseract, que el usuario decide.
- El procesamiento documental de Nodus Protect es local y no envía documentos a IA, proveedores ni servicios externos. Esta afirmación se refiere a Protect, no a todas las funciones opcionales de red de Nodus.
- Dentro de una herramienta, un botón a la izquierda de su título vuelve al hub de Herramientas.

## MCP local y Nodus Server
- El servidor MCP local se configura en Ajustes > Integraciones > Servidor MCP. Se puede activar, consultar su estado, abrir la ayuda de conexión y regenerar su token.
- MCP expone herramientas adecuadas al tipo de vault activo, además de herramientas generales. Cambiar de vault cambia el contexto que esas herramientas consultan.
- Nodus Server es independiente del MCP local. Se configura en Ajustes > Servidor y cada vault se conecta por separado mediante la URL HTTPS del servidor y un código de un solo uso.
- Nodus publica por HTTPS saliente una copia lógica y filtrada: no abre un puerto entrante en el ordenador y no comparte listener, puerto ni token con el MCP local.
- Mientras Nodus está abierto mantiene actualizada la copia; el servidor Docker puede servir la última copia publicada a clientes autorizados aunque el ordenador esté apagado.
- La interfaz permite publicar ahora, pausar, administrar o desconectar cada vault conectado. El acceso remoto usa OAuth y permisos de lectura sobre los espacios asignados.
- En el roadmap, la iniciativa Servidor figura como «Planificado», igual que compartir vaults y trabajo colaborativo. No presentes el trabajo colaborativo como disponible.

## Estado resumido del roadmap
- En desarrollo: Pulido y estabilidad.
- Planificado: Servidor; Compartir vaults y trabajo colaborativo; Apps para iOS y iPadOS.
- Implementado: Docencia, Fuentes primarias, Testimonios, Vaults sugeridos por usuarios —Prosopografía y Worldbuilding—, Nodus Toolkit, Nodus Translate, Nodus Presenter y OCR Workspace.
- No hay fechas cerradas para las iniciativas del roadmap.

## Protocolo para responder sobre la interfaz
- Usa los nombres exactos de esta guía y, si está seleccionada, la Vista actual.
- No completes lagunas con patrones habituales de otras aplicaciones. No inventes botones, menús, rutas, atajos, versiones, fechas ni estados.
- No conviertas la disponibilidad de un vault PRE-ALPHA o ALPHA en una recomendación de uso real. Indica siempre su fase cuando sea relevante.
- Si una respuesta no está cubierta, di «No puedo verificarlo con las fuentes seleccionadas» e indica qué contexto ayudaría, sin proponer una ruta inventada.
- Distingue siempre entre disponible, condicional, futuro y no verificado.
- Cuando la pregunta pida una ubicación o instrucciones, ofrece pasos numerados breves y termina con una línea «Base: …» indicando las fuentes usadas.`;

/** Localized roadmap copy. Status values remain the stable RoadmapStatus ids. */
const LOCALIZED_ROADMAP: Record<PromptLanguage, readonly RoadmapItem[]> = {
  es: NODUS_ROADMAP,
  en: [
    { title: 'Polishing and stability', detail: 'Fix errors, improve performance, and polish the overall experience with user feedback.', status: 'inProgress' },
    { title: 'Server', detail: 'Optional infrastructure for new connected capabilities.', status: 'planned' },
    { title: 'Vault sharing and collaborative work', detail: 'Share spaces and collaborate with control over the data.', status: 'planned' },
    { title: 'iOS and iPadOS apps', detail: 'Bring Nodus to iPhone and iPad with native apps adapted to each device.', status: 'planned' },
    { title: 'Teaching vault', detail: 'Prepare classes, courses, and teaching materials while protecting student data.', status: 'implemented' },
    { title: 'Primary sources vault', detail: 'Organize historical documents and work with documentary evidence.', status: 'implemented' },
    { title: 'Testimonies vault (oral history)', detail: 'Interviews, transcriptions, and oral sources for history and journalism.', status: 'implemented' },
    { title: 'User-suggested vaults', detail: 'New fields with specialists, active collaboration, and testers.', status: 'implemented', children: [
      { title: 'Prosopography vault', detail: 'People, relationships, identities, and biographical evidence for historical research.', status: 'implemented' },
      { title: 'Worldbuilding vault', detail: 'Characters, places, chronologies, and rules for narrative worlds.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Practical local-first tools for converting files and processing documents, integrated into Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Translate text, documents, and Zotero attachments with the selected model, preserving DOCX and EPUB structure and PDF appearance through a facsimile mode.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Present PDF files and external presentations with presenter view, mobile remote control, speaker notes, and live annotation tools.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'AI-assisted OCR for scanned PDFs and images, with page-by-page review, text cleanup, reprocessing, and direct integration with Nodus vaults.', status: 'implemented' },
  ],
  fr: [
    { title: 'Polissage et stabilité', detail: "Corriger les erreurs, améliorer les performances et perfectionner l'expérience générale grâce aux retours des utilisateurs.", status: 'inProgress' },
    { title: 'Serveur', detail: 'Infrastructure facultative pour de nouvelles fonctionnalités connectées.', status: 'planned' },
    { title: 'Partage des vaults et travail collaboratif', detail: 'Partager des espaces et collaborer en gardant le contrôle des données.', status: 'planned' },
    { title: 'Applications iOS et iPadOS', detail: 'Porter Nodus sur iPhone et iPad avec des applications natives adaptées à chaque appareil.', status: 'planned' },
    { title: "Vault d'enseignement", detail: "Préparer les cours et les supports pédagogiques en protégeant les données des élèves.", status: 'implemented' },
    { title: 'Vault de sources primaires', detail: 'Organiser des documents historiques et travailler avec des preuves documentaires.', status: 'implemented' },
    { title: 'Vault de témoignages (histoire orale)', detail: 'Entretiens, transcriptions et sources orales pour l’histoire et le journalisme.', status: 'implemented' },
    { title: 'Vaults suggérés par les utilisateurs', detail: 'De nouveaux domaines avec des spécialistes, une collaboration active et des testeurs.', status: 'implemented', children: [
      { title: 'Vault de prosopographie', detail: 'Personnes, relations, identités et preuves biographiques pour la recherche historique.', status: 'implemented' },
      { title: 'Vault de worldbuilding', detail: 'Personnages, lieux, chronologies et règles de mondes narratifs.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Outils pratiques et local-first pour convertir des fichiers et traiter des documents, intégrés à Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: "Traduire du texte, des documents et des pièces jointes Zotero avec le modèle choisi, en conservant la structure DOCX et EPUB et l'apparence des PDF grâce au mode fac-similé.", status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Présenter des PDF et des présentations externes avec vue présentateur, contrôle à distance depuis le mobile, notes et outils d’annotation en direct.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assisté par IA pour les PDF numérisés et les images, avec révision page par page, nettoyage, retraitement et intégration directe aux vaults Nodus.', status: 'implemented' },
  ],
  de: [
    { title: 'Feinschliff und Stabilität', detail: 'Fehler beheben, Leistung verbessern und die allgemeine Erfahrung mit Nutzerfeedback verfeinern.', status: 'inProgress' },
    { title: 'Server', detail: 'Optionale Infrastruktur für neue verbundene Funktionen.', status: 'planned' },
    { title: 'Vaults teilen und kollaboratives Arbeiten', detail: 'Bereiche teilen und mit Kontrolle über die Daten zusammenarbeiten.', status: 'planned' },
    { title: 'Apps für iOS und iPadOS', detail: 'Nodus mit nativen, an jedes Gerät angepassten Apps auf iPhone und iPad bringen.', status: 'planned' },
    { title: 'Lehr-Vault', detail: 'Unterricht, Kurse und Lehrmaterial vorbereiten und dabei Schülerdaten schützen.', status: 'implemented' },
    { title: 'Vault für Primärquellen', detail: 'Historische Dokumente organisieren und mit dokumentarischen Belegen arbeiten.', status: 'implemented' },
    { title: 'Zeugnis-Vault (mündliche Geschichte)', detail: 'Interviews, Transkriptionen und mündliche Quellen für Geschichte und Journalismus.', status: 'implemented' },
    { title: 'Von Nutzern vorgeschlagene Vaults', detail: 'Neue Bereiche mit Fachleuten, aktiver Zusammenarbeit und Testern.', status: 'implemented', children: [
      { title: 'Prosopographie-Vault', detail: 'Personen, Beziehungen, Identitäten und biografische Belege für historische Forschung.', status: 'implemented' },
      { title: 'Worldbuilding-Vault', detail: 'Figuren, Orte, Chronologien und Regeln erzählerischer Welten.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Praktische local-first-Werkzeuge zum Konvertieren von Dateien und Verarbeiten von Dokumenten, in Nodus integriert.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Text, Dokumente und Zotero-Anhänge mit dem gewählten Modell übersetzen, wobei DOCX- und EPUB-Struktur sowie das PDF-Erscheinungsbild durch einen Faksimilemodus erhalten bleiben.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'PDF-Dateien und externe Präsentationen mit Referentenansicht, mobiler Fernsteuerung, Sprechernotizen und Live-Anmerkungswerkzeugen präsentieren.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'KI-gestützte OCR für gescannte PDFs und Bilder mit seitenweiser Prüfung, Textbereinigung, erneuter Verarbeitung und direkter Integration in Nodus-Vaults.', status: 'implemented' },
  ],
  pt: [
    { title: 'Polimento e estabilidade', detail: 'Corrigir erros, melhorar o desempenho e aperfeiçoar a experiência geral com feedback dos utilizadores.', status: 'inProgress' },
    { title: 'Servidor', detail: 'Infraestrutura opcional para novas capacidades ligadas.', status: 'planned' },
    { title: 'Partilha de cofres e trabalho colaborativo', detail: 'Partilhar espaços e colaborar mantendo o controlo dos dados.', status: 'planned' },
    { title: 'Aplicações para iOS e iPadOS', detail: 'Levar o Nodus ao iPhone e ao iPad com aplicações nativas adaptadas a cada dispositivo.', status: 'planned' },
    { title: 'Cofre de docência', detail: 'Preparar aulas, cursos e materiais letivos, protegendo os dados dos alunos.', status: 'implemented' },
    { title: 'Cofre de fontes primárias', detail: 'Organizar documentos históricos e trabalhar com evidência documental.', status: 'implemented' },
    { title: 'Cofre de testemunhos (história oral)', detail: 'Entrevistas, transcrições e fontes orais para história e jornalismo.', status: 'implemented' },
    { title: 'Cofres sugeridos pelos utilizadores', detail: 'Novas áreas com especialistas, colaboração ativa e testers.', status: 'implemented', children: [
      { title: 'Cofre de prosopografia', detail: 'Pessoas, relações, identidades e evidências biográficas para investigação histórica.', status: 'implemented' },
      { title: 'Cofre de worldbuilding', detail: 'Personagens, lugares, cronologias e regras de mundos narrativos.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Ferramentas práticas e local-first para converter ficheiros e processar documentos, integradas no Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Traduzir texto, documentos e anexos do Zotero com o modelo escolhido, conservando a estrutura de DOCX e EPUB e o aspeto dos PDF através de um modo fac-símile.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Apresentar ficheiros PDF e apresentações externas com vista do apresentador, controlo remoto a partir do telemóvel, notas do orador e ferramentas de anotação em direto.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assistido por IA para PDF digitalizados e imagens, com revisão página a página, limpeza de texto, reprocessamento e integração direta com os cofres do Nodus.', status: 'implemented' },
  ],
  'pt-BR': [
    { title: 'Polimento e estabilidade', detail: 'Corrigir erros, melhorar o desempenho e aperfeiçoar a experiência geral com feedback dos usuários.', status: 'inProgress' },
    { title: 'Servidor', detail: 'Infraestrutura opcional para novos recursos conectados.', status: 'planned' },
    { title: 'Compartilhamento de vaults e trabalho colaborativo', detail: 'Compartilhar espaços e colaborar mantendo o controle dos dados.', status: 'planned' },
    { title: 'Aplicativos para iOS e iPadOS', detail: 'Levar o Nodus ao iPhone e ao iPad com aplicativos nativos adaptados a cada dispositivo.', status: 'planned' },
    { title: 'Vault de ensino', detail: 'Preparar aulas, cursos e materiais didáticos, protegendo os dados dos alunos.', status: 'implemented' },
    { title: 'Vault de fontes primárias', detail: 'Organizar documentos históricos e trabalhar com evidências documentais.', status: 'implemented' },
    { title: 'Vault de depoimentos (história oral)', detail: 'Entrevistas, transcrições e fontes orais para história e jornalismo.', status: 'implemented' },
    { title: 'Vaults sugeridos pelos usuários', detail: 'Novas áreas com especialistas, colaboração ativa e testers.', status: 'implemented', children: [
      { title: 'Vault de prosopografia', detail: 'Pessoas, relações, identidades e evidências biográficas para pesquisa histórica.', status: 'implemented' },
      { title: 'Vault de worldbuilding', detail: 'Personagens, lugares, cronologias e regras de mundos narrativos.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Ferramentas práticas e local-first para converter arquivos e processar documentos, integradas ao Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Traduzir texto, documentos e anexos do Zotero com o modelo escolhido, preservando a estrutura de DOCX e EPUB e a aparência dos PDFs por meio de um modo fac-símile.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Apresentar arquivos PDF e apresentações externas com visão do apresentador, controle remoto pelo celular, notas do orador e ferramentas de anotação ao vivo.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assistido por IA para PDFs digitalizados e imagens, com revisão página a página, limpeza de texto, reprocessamento e integração direta com os vaults do Nodus.', status: 'implemented' },
  ],
  it: [
    { title: 'Rifinitura e stabilità', detail: 'Correggere gli errori, migliorare le prestazioni e perfezionare l’esperienza generale con il feedback degli utenti.', status: 'inProgress' },
    { title: 'Server', detail: 'Infrastruttura opzionale per nuove capacità connesse.', status: 'planned' },
    { title: 'Condivisione dei vault e lavoro collaborativo', detail: 'Condividere spazi e collaborare mantenendo il controllo dei dati.', status: 'planned' },
    { title: 'App per iOS e iPadOS', detail: 'Portare Nodus su iPhone e iPad con app native adattate a ogni dispositivo.', status: 'planned' },
    { title: 'Vault didattico', detail: 'Preparare lezioni, corsi e materiali didattici proteggendo i dati degli studenti.', status: 'implemented' },
    { title: 'Vault delle fonti primarie', detail: 'Organizzare documenti storici e lavorare con prove documentarie.', status: 'implemented' },
    { title: 'Vault delle testimonianze (storia orale)', detail: 'Interviste, trascrizioni e fonti orali per storia e giornalismo.', status: 'implemented' },
    { title: 'Vault suggeriti dagli utenti', detail: 'Nuovi ambiti con specialisti, collaborazione attiva e tester.', status: 'implemented', children: [
      { title: 'Vault di prosopografia', detail: 'Persone, relazioni, identità e prove biografiche per la ricerca storica.', status: 'implemented' },
      { title: 'Vault di worldbuilding', detail: 'Personaggi, luoghi, cronologie e regole di mondi narrativi.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Strumenti pratici e local-first per convertire file ed elaborare documenti, integrati in Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Tradurre testo, documenti e allegati Zotero con il modello scelto, conservando la struttura DOCX ed EPUB e l’aspetto dei PDF tramite una modalità facsimile.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Presentare file PDF e presentazioni esterne con vista del relatore, controllo remoto da mobile, note del relatore e strumenti di annotazione dal vivo.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assistito dall’IA per PDF scansionati e immagini, con revisione pagina per pagina, pulizia del testo, rielaborazione e integrazione diretta con i vault Nodus.', status: 'implemented' },
  ],
  tr: [
    { title: 'İyileştirme ve kararlılık', detail: 'Hataları düzeltmek, performansı artırmak ve kullanıcı geri bildirimleriyle genel deneyimi geliştirmek.', status: 'inProgress' },
    { title: 'Sunucu', detail: 'Yeni bağlantılı yetenekler için isteğe bağlı altyapı.', status: 'planned' },
    { title: 'Kasa paylaşımı ve ortak çalışma', detail: 'Veriler üzerindeki kontrolü koruyarak alanları paylaşmak ve iş birliği yapmak.', status: 'planned' },
    { title: 'iOS ve iPadOS uygulamaları', detail: 'Nodus’u her cihaza uyarlanmış yerel uygulamalarla iPhone ve iPad’e taşımak.', status: 'planned' },
    { title: 'Öğretim kasası', detail: 'Öğrenci verilerini koruyarak dersleri, kursları ve öğretim materyallerini hazırlamak.', status: 'implemented' },
    { title: 'Birincil kaynaklar kasası', detail: 'Tarihî belgeleri düzenlemek ve belgesel kanıtlarla çalışmak.', status: 'implemented' },
    { title: 'Tanıklıklar kasası (sözlü tarih)', detail: 'Tarih ve gazetecilik için röportajlar, transkripsiyonlar ve sözlü kaynaklar.', status: 'implemented' },
    { title: 'Kullanıcıların önerdiği kasalar', detail: 'Uzmanlar, etkin iş birliği ve test kullanıcılarıyla yeni alanlar.', status: 'implemented', children: [
      { title: 'Prosopografi kasası', detail: 'Tarih araştırması için kişiler, ilişkiler, kimlikler ve biyografik kanıtlar.', status: 'implemented' },
      { title: 'Worldbuilding kasası', detail: 'Anlatı dünyalarının karakterleri, yerleri, kronolojileri ve kuralları.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Nodus’a entegre, dosyaları dönüştürmek ve belgeleri işlemek için pratik local-first araçlar.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Seçilen modelle metinleri, belgeleri ve Zotero eklerini çevirir; DOCX ve EPUB yapısını, PDF görünümünü ise faksimile moduyla korur.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'PDF dosyalarını ve harici sunumları sunucu görünümü, mobilden uzaktan kontrol, konuşmacı notları ve canlı açıklama araçlarıyla sunmak.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'Taranmış PDF ve görseller için sayfa sayfa inceleme, metin temizleme, yeniden işleme ve Nodus kasalarıyla doğrudan bütünleşme sunan yapay zekâ destekli OCR.', status: 'implemented' },
  ],
  'zh-Hans': [
    { title: '打磨与稳定性', detail: '修复错误、提升性能，并根据用户反馈打磨整体体验。', status: 'inProgress' },
    { title: '服务器', detail: '为新的连接能力提供的可选基础设施。', status: 'planned' },
    { title: 'Vault 共享与协作', detail: '共享空间并在掌控数据的前提下开展协作。', status: 'planned' },
    { title: 'iOS 与 iPadOS 应用', detail: '通过适配各设备的原生应用，将 Nodus 带到 iPhone 和 iPad。', status: 'planned' },
    { title: '教学 vault', detail: '在保护学生数据的前提下，准备课程、课堂与教学材料。', status: 'implemented' },
    { title: '原始资料 vault', detail: '整理历史文献，并基于文献证据开展工作。', status: 'implemented' },
    { title: '口述证词 vault（口述史）', detail: '面向历史学与新闻学的访谈、转录和口述资料。', status: 'implemented' },
    { title: '用户建议的 vault', detail: '与专家、积极协作者和测试者共同拓展的新领域。', status: 'implemented', children: [
      { title: '群体传记 vault', detail: '面向历史研究的人物、关系、身份和传记证据。', status: 'implemented' },
      { title: '世界构建 vault', detail: '叙事世界中的人物、地点、时间线和规则。', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: '集成在 Nodus 中的实用 local-first 工具，用于转换文件和处理文档。', status: 'implemented' },
    { title: 'Nodus Translate', detail: '使用所选模型翻译文本、文档和 Zotero 附件，通过摹真模式保留 DOCX 与 EPUB 的结构以及 PDF 的外观。', status: 'implemented' },
    { title: 'Nodus Presenter', detail: '演示 PDF 文件和外部演示文稿，提供演讲者视图、手机遥控、演讲者备注和实时批注工具。', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: '面向扫描版 PDF 和图像的 AI 辅助 OCR，支持逐页审阅、文本清理、重新处理，并与 Nodus vault 直接集成。', status: 'implemented' },
  ],
  'zh-Hant': [
    { title: '打磨與穩定性', detail: '修正錯誤、提升效能，並依據使用者回饋打磨整體體驗。', status: 'inProgress' },
    { title: '伺服器', detail: '為全新連線能力提供的選用基礎架構。', status: 'planned' },
    { title: 'Vault 共享與協作', detail: '共享空間，並在掌控資料的前提下協作。', status: 'planned' },
    { title: 'iOS 與 iPadOS 應用程式', detail: '透過適配各裝置的原生應用程式，將 Nodus 帶到 iPhone 與 iPad。', status: 'planned' },
    { title: '教學 vault', detail: '在保護學生資料的前提下，準備課程、課堂與教材。', status: 'implemented' },
    { title: '原始史料 vault', detail: '整理歷史文件，並以文獻證據進行研究。', status: 'implemented' },
    { title: '口述見證 vault（口述歷史）', detail: '面向歷史與新聞的訪談、轉錄與口述資料。', status: 'implemented' },
    { title: '使用者建議的 vault', detail: '與專家、積極協作者與測試者共同拓展的新領域。', status: 'implemented', children: [
      { title: '群體傳記 vault', detail: '面向歷史研究的人物、關係、身分與傳記證據。', status: 'implemented' },
      { title: '世界觀建構 vault', detail: '敘事世界的人物、地點、時間軸與規則。', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: '整合於 Nodus 的實用 local-first 工具，用於轉換檔案與處理文件。', status: 'implemented' },
    { title: 'Nodus Translate', detail: '以所選模型翻譯文字、文件與 Zotero 附件，透過摹真模式保留 DOCX 與 EPUB 的結構及 PDF 的外觀。', status: 'implemented' },
    { title: 'Nodus Presenter', detail: '簡報 PDF 檔案與外部簡報，提供簡報者檢視、手機遠端控制、講者備註與即時註記工具。', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: '針對掃描 PDF 與影像的 AI 輔助 OCR，支援逐頁檢閱、文字清理、重新處理，並與 Nodus vault 直接整合。', status: 'implemented' },
  ],
  vi: [
    { title: 'Hoàn thiện và ổn định', detail: 'Sửa lỗi, cải thiện hiệu năng và hoàn thiện trải nghiệm tổng thể dựa trên phản hồi của người dùng.', status: 'inProgress' },
    { title: 'Máy chủ', detail: 'Hạ tầng tùy chọn cho các khả năng kết nối mới.', status: 'planned' },
    { title: 'Chia sẻ vault và làm việc cộng tác', detail: 'Chia sẻ không gian và cộng tác trong khi vẫn kiểm soát dữ liệu.', status: 'planned' },
    { title: 'Ứng dụng iOS và iPadOS', detail: 'Đưa Nodus lên iPhone và iPad bằng các ứng dụng gốc được điều chỉnh cho từng thiết bị.', status: 'planned' },
    { title: 'Vault giảng dạy', detail: 'Chuẩn bị bài giảng, khóa học và học liệu trong khi bảo vệ dữ liệu học sinh.', status: 'implemented' },
    { title: 'Vault nguồn sơ cấp', detail: 'Tổ chức tài liệu lịch sử và làm việc với bằng chứng tư liệu.', status: 'implemented' },
    { title: 'Vault lời chứng (lịch sử truyền khẩu)', detail: 'Phỏng vấn, bản chép lời và nguồn truyền khẩu cho lịch sử và báo chí.', status: 'implemented' },
    { title: 'Vault do người dùng đề xuất', detail: 'Những lĩnh vực mới với chuyên gia, cộng tác tích cực và tester.', status: 'implemented', children: [
      { title: 'Vault văn liệu nhân vật', detail: 'Con người, quan hệ, danh tính và bằng chứng tiểu sử cho nghiên cứu lịch sử.', status: 'implemented' },
      { title: 'Vault worldbuilding', detail: 'Nhân vật, địa điểm, dòng thời gian và quy tắc của thế giới tự sự.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Các công cụ local-first thiết thực để chuyển đổi tệp và xử lý tài liệu, được tích hợp trong Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Dịch văn bản, tài liệu và tệp đính kèm Zotero bằng mô hình đã chọn, giữ nguyên cấu trúc DOCX và EPUB cùng diện mạo PDF nhờ chế độ facsimile.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Trình bày tệp PDF và bài thuyết trình bên ngoài với chế độ xem người trình bày, điều khiển từ xa bằng điện thoại, ghi chú diễn giả và công cụ chú thích trực tiếp.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR hỗ trợ AI cho PDF quét và hình ảnh, với duyệt từng trang, làm sạch văn bản, xử lý lại và tích hợp trực tiếp với các vault của Nodus.', status: 'implemented' },
  ],
  ja: [
    { title: '磨き込みと安定性', detail: 'エラーの修正、パフォーマンスの向上、ユーザーフィードバックに基づく全体的な体験の磨き込みを行います。', status: 'inProgress' },
    { title: 'サーバー', detail: '新しい接続機能のためのオプションの基盤です。', status: 'planned' },
    { title: 'Vault の共有と共同作業', detail: 'データの管理を保ったまま空間を共有し、共同作業を行えます。', status: 'planned' },
    { title: 'iOS および iPadOS アプリ', detail: '各デバイスに合わせたネイティブアプリで、Nodus を iPhone と iPad に提供します。', status: 'planned' },
    { title: '教育用 vault', detail: '生徒のデータを保護しながら、授業、コース、教材を準備します。', status: 'implemented' },
    { title: '一次資料 vault', detail: '歴史文書を整理し、文書証拠に基づいて作業します。', status: 'implemented' },
    { title: '証言 vault（オーラルヒストリー）', detail: '歴史学とジャーナリズムのためのインタビュー、文字起こし、口述資料です。', status: 'implemented' },
    { title: 'ユーザー提案の vault', detail: '専門家、活発な協力者、テスターとともに進める新しい領域です。', status: 'implemented', children: [
      { title: 'プロソポグラフィー vault', detail: '歴史研究のための人物、関係、アイデンティティ、伝記的証拠です。', status: 'implemented' },
      { title: 'ワールドビルディング vault', detail: '物語世界の人物、場所、年表、ルールです。', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'ファイル変換と文書処理のための実用的な local-first ツールで、Nodus に統合されています。', status: 'implemented' },
    { title: 'Nodus Translate', detail: '選択したモデルでテキスト、文書、Zotero 添付ファイルを翻訳し、ファクシミリモードで DOCX と EPUB の構造および PDF の見た目を保ちます。', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'PDF ファイルや外部プレゼンテーションを、発表者ビュー、スマートフォンからのリモート操作、発表者ノート、ライブ注釈ツールとともに提示します。', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'スキャンした PDF と画像に対する AI 支援 OCR で、ページごとの確認、テキスト整理、再処理、Nodus vault との直接統合を提供します。', status: 'implemented' },
  ],
  ru: [
    { title: 'Оттачивание и стабильность', detail: 'Исправление ошибок, повышение производительности и оттачивание общего опыта с учётом отзывов пользователей.', status: 'inProgress' },
    { title: 'Сервер', detail: 'Опциональная инфраструктура для новых подключаемых возможностей.', status: 'planned' },
    { title: 'Совместное использование vault и командная работа', detail: 'Делитесь пространствами и работайте вместе, сохраняя контроль над данными.', status: 'planned' },
    { title: 'Приложения для iOS и iPadOS', detail: 'Перенесите Nodus на iPhone и iPad с помощью нативных приложений, адаптированных к каждому устройству.', status: 'planned' },
    { title: 'Vault для преподавания', detail: 'Готовьте занятия, курсы и учебные материалы, защищая данные учащихся.', status: 'implemented' },
    { title: 'Vault первоисточников', detail: 'Организуйте исторические документы и работайте с документальными доказательствами.', status: 'implemented' },
    { title: 'Vault свидетельств (устная история)', detail: 'Интервью, расшифровки и устные источники для истории и журналистики.', status: 'implemented' },
    { title: 'Vault, предложенные пользователями', detail: 'Новые области со специалистами, активным сотрудничеством и тестировщиками.', status: 'implemented', children: [
      { title: 'Vault просопографии', detail: 'Люди, связи, идентичности и биографические доказательства для исторических исследований.', status: 'implemented' },
      { title: 'Vault миростроения', detail: 'Персонажи, места, хронологии и правила повествовательных миров.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Практичные local-first инструменты для преобразования файлов и обработки документов, интегрированные в Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Переводите текст, документы и вложения Zotero выбранной моделью, сохраняя структуру DOCX и EPUB и внешний вид PDF с помощью факсимильного режима.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Показывайте PDF-файлы и внешние презентации с режимом докладчика, удалённым управлением с телефона, заметками докладчика и инструментами аннотирования в реальном времени.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR с поддержкой ИИ для отсканированных PDF и изображений: постраничная проверка, очистка текста, повторная обработка и прямая интеграция с vault Nodus.', status: 'implemented' },
  ],
  uk: [
    { title: 'Доопрацювання та стабільність', detail: 'Виправляйте помилки, підвищуйте продуктивність і доопрацьовуйте загальний досвід з урахуванням відгуків користувачів.', status: 'inProgress' },
    { title: 'Сервер', detail: 'Опційна інфраструктура для нових підключених можливостей.', status: 'planned' },
    { title: 'Спільне використання vault і командна робота', detail: 'Діліться просторами та працюйте разом, зберігаючи контроль над даними.', status: 'planned' },
    { title: 'Застосунки для iOS та iPadOS', detail: 'Перенесіть Nodus на iPhone та iPad за допомогою нативних застосунків, адаптованих до кожного пристрою.', status: 'planned' },
    { title: 'Vault для викладання', detail: 'Готуйте заняття, курси та навчальні матеріали, захищаючи дані учнів.', status: 'implemented' },
    { title: 'Vault першоджерел', detail: 'Упорядковуйте історичні документи та працюйте з документальними доказами.', status: 'implemented' },
    { title: 'Vault свідчень (усна історія)', detail: 'Інтерв’ю, розшифровки та усні джерела для історії та журналістики.', status: 'implemented' },
    { title: 'Vault, запропоновані користувачами', detail: 'Нові галузі зі спеціалістами, активною співпрацею та тестувальниками.', status: 'implemented', children: [
      { title: 'Vault просопографії', detail: 'Люди, зв’язки, ідентичності та біографічні докази для історичних досліджень.', status: 'implemented' },
      { title: 'Vault світобудови', detail: 'Персонажі, місця, хронології та правила наративних світів.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Практичні local-first інструменти для перетворення файлів і обробки документів, інтегровані в Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Перекладайте текст, документи та вкладення Zotero вибраною моделлю, зберігаючи структуру DOCX і EPUB та вигляд PDF завдяки факсимільному режиму.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'Показуйте PDF-файли та зовнішні презентації з режимом доповідача, віддаленим керуванням із телефона, нотатками доповідача та інструментами анотування в реальному часі.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR із підтримкою ШІ для сканованих PDF і зображень: посторінковий перегляд, очищення тексту, повторна обробка та пряма інтеграція з vault Nodus.', status: 'implemented' },
  ],
  ko: [
    { title: '다듬기와 안정성', detail: '오류를 수정하고 성능을 개선하며 사용자 피드백을 바탕으로 전반적인 경험을 다듬습니다.', status: 'inProgress' },
    { title: '서버', detail: '새로운 연결 기능을 위한 선택적 인프라입니다.', status: 'planned' },
    { title: 'Vault 공유 및 협업', detail: '데이터에 대한 통제를 유지하면서 공간을 공유하고 협업합니다.', status: 'planned' },
    { title: 'iOS 및 iPadOS 앱', detail: '각 기기에 맞춘 네이티브 앱으로 Nodus를 iPhone과 iPad에 제공합니다.', status: 'planned' },
    { title: '교육용 vault', detail: '학생 데이터를 보호하면서 수업, 코스 및 교육 자료를 준비합니다.', status: 'implemented' },
    { title: '1차 사료 vault', detail: '역사 문서를 정리하고 문서 증거를 바탕으로 작업합니다.', status: 'implemented' },
    { title: '증언 vault(구술 역사)', detail: '역사와 저널리즘을 위한 인터뷰, 전사 및 구술 자료입니다.', status: 'implemented' },
    { title: '사용자 제안 vault', detail: '전문가, 적극적인 협업자 및 테스터와 함께하는 새로운 분야입니다.', status: 'implemented', children: [
      { title: '프로소포그래피 vault', detail: '역사 연구를 위한 인물, 관계, 정체성 및 전기적 증거입니다.', status: 'implemented' },
      { title: '월드빌딩 vault', detail: '서사 세계의 인물, 장소, 연표 및 규칙입니다.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: '파일 변환과 문서 처리를 위한 실용적인 local-first 도구로, Nodus에 통합되어 있습니다.', status: 'implemented' },
    { title: 'Nodus Translate', detail: '선택한 모델로 텍스트, 문서 및 Zotero 첨부 파일을 번역하며, 팩시밀리 모드로 DOCX와 EPUB 구조 및 PDF 모양을 유지합니다.', status: 'implemented' },
    { title: 'Nodus Presenter', detail: 'PDF 파일과 외부 프레젠테이션을 발표자 보기, 휴대폰 원격 제어, 발표자 노트 및 실시간 주석 도구와 함께 발표합니다.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: '스캔한 PDF와 이미지를 위한 AI 지원 OCR로, 페이지별 검토, 텍스트 정리, 재처리 및 Nodus vault와의 직접 통합을 제공합니다.', status: 'implemented' },
  ],
};

const ROADMAP_STATUS_LABELS: Record<PromptLanguage, Record<RoadmapStatus, string>> = {
  es: { planned: 'Planificado', inProgress: 'En desarrollo', implemented: 'Implementado' },
  en: { planned: 'Planned', inProgress: 'In development', implemented: 'Implemented' },
  fr: { planned: 'Planifié', inProgress: 'En développement', implemented: 'Mis en œuvre' },
  de: { planned: 'Geplant', inProgress: 'In Entwicklung', implemented: 'Implementiert' },
  pt: { planned: 'Planeado', inProgress: 'Em desenvolvimento', implemented: 'Implementado' },
  'pt-BR': { planned: 'Planejado', inProgress: 'Em desenvolvimento', implemented: 'Implementado' },
  it: { planned: 'Pianificato', inProgress: 'In sviluppo', implemented: 'Implementato' },
  tr: { planned: 'Planlandı', inProgress: 'Geliştiriliyor', implemented: 'Uygulandı' },
  'zh-Hans': { planned: '已计划', inProgress: '开发中', implemented: '已实现' },
  'zh-Hant': { planned: '已規劃', inProgress: '開發中', implemented: '已實作' },
  vi: { planned: 'Đã lên kế hoạch', inProgress: 'Đang phát triển', implemented: 'Đã triển khai' },
  ja: { planned: '計画済み', inProgress: '開発中', implemented: '実装済み' },
  ru: { planned: 'Запланировано', inProgress: 'В разработке', implemented: 'Реализовано' },
  uk: { planned: 'Заплановано', inProgress: 'У розробці', implemented: 'Реалізовано' },
  ko: { planned: '계획됨', inProgress: '개발 중', implemented: '구현됨' },
};

function roadmapGuide(language: PromptLanguage): string {
  const labels = ROADMAP_STATUS_LABELS[language];
  return LOCALIZED_ROADMAP[language].map((item, index) => {
    const children = item.children?.map((child) => `   - ${child.title} [${labels[child.status]}]: ${child.detail}`).join('\n');
    return `${index + 1}. ${item.title} [${labels[item.status]}]: ${item.detail}${children ? `\n${children}` : ''}`;
  }).join('\n');
}

export function getNodusRoadmap(language: PromptLanguage = 'es'): readonly RoadmapItem[] {
  return LOCALIZED_ROADMAP[language] ?? LOCALIZED_ROADMAP.es;
}

export function getNodusRoadmapStatusLabel(status: RoadmapStatus, language: PromptLanguage = 'es'): string {
  return ROADMAP_STATUS_LABELS[language]?.[status] ?? ROADMAP_STATUS_LABELS.es[status];
}

/**
 * English is the complete secondary canonical copy. The localized headings and
 * roadmap are kept separate so all seven prompt languages receive the same
 * verified facts, limits, routes, product names, and technical identifiers.
 */
const ENGLISH_DOCUMENTATION = `# Nodus Verifiable Internal Guide

## Rules for reading this guide
- This guide documents the current interface and the application's official visible roadmap.
- The roadmap distinguishes planned, in-development, and implemented items. Do not attribute dates or versions that do not appear here.
- “Implemented” means that the vault or feature exists and can be opened; it does not mean that it has reached a stable version.
- Nodus is local-first: each vault stores its data on the user's computer.
- Provider keys are configured in Settings > Providers. Favorite models are selected there, and each feature keeps its own selector.

## Available vaults and maturity level
- All types below can be created from Vaults > Add vault: Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography, and Worldbuilding.
- Primary sources, Testimonies, and Prosopography are PRE-ALPHA: they are not usable for real work. They are available only to people who want to test incomplete features and report errors or improvement proposals. A specific confirmation appears before creating them.
- Worldbuilding is ALPHA: its main features are still being tested and it is recommended only for testers.
- Databases, Teaching, Study, and Genealogy are BETA: functional, but still needing feedback and fixes.
- Academic shows no phase label in the selector.
- Creating or loading demo data does not open the tutorial. The tutorial appears when creating a vault or when the user explicitly opens it from Settings > Tutorials.

## Header and global controls
- At the far right of the header, in general order, are: Commands, Assistant, Tools, conditional vault controls, Suggest / Report, light/dark theme selector, Notifications, and Settings.
- Tools opens the Nodus Toolkit hub and is immediately after the Assistant button.
- Notifications is immediately before Settings and is the last icon before it. It opens a panel with two lists: “Nodus notices” (notices published between versions, marked read one by one) and “Activity” (what the application has done, marked read when the panel opens). It shows the same notifications as Nodi and works even when the mascot is disabled.
- The light/dark theme selector is immediately before Notifications.
- The active vault opens from the centered badge in the header, not from a far-right icon: the badge opens the selector to switch, create, rename, duplicate, reset, or delete vaults according to the available action. The command palette also has the “Vaults” action.
- Collections no longer has its own header icon; it opens from the command palette in academic vaults.
- Inbox appears only when something has arrived from another device; it belongs to each vault connected to Nodus Server.
- Commands opens the global palette; its visible shortcut is ⌘K on macOS.
- The Assistant button in the header opens the research assistant. Nodi is the independent mascot in the lower-right area when enabled.

## Official visible roadmap
The roadmap opens from Settings > About Nodus Research > View Nodus Research roadmap, and also from the command palette. The current order is:
__ROADMAP_GUIDE__

## Settings
- Settings is the last sidebar item and also has an icon at the far right of the header.
- Its actual tabs are: Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research, and Updates and news.
- Providers: API keys, local providers, and favorite models.
- AI Models: the general model and models specific to different tasks.
- Library: Zotero integration and synchronization. Testimonies, Prosopography, and Worldbuilding do not use Zotero and do not show that route.
- Interface: language, theme, accessibility, sidebar, and Nodi Mascot.
- Integrations: local MCP server and writing copilots for Word and LibreOffice.
- Server: connecting each vault to Nodus Server and publishing its filtered copy.
- Tutorials: application help and walkthroughs.
- Backup: backups, import, export, and maintenance.
- Nodi's visibility, floating window, and outfits are in Settings > Interface > Nodi Mascot.

## Academic vault
- It is oriented toward academic research and writing.
- It may include Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes, and Settings.
- Sections can be hidden or reordered from Settings > Interface > Sidebar.
- Deep Research retrieves evidence from the corpus, generates a report, and allows export as a document or PDF with the vault's visual identity.

## Genealogy vault
- It is available and oriented toward document-supported family history.
- It includes People, Timeline, Family tree, Social relations, Map, and Archive.
- Claims about identities and kinships must be supported by records or evidence. Sharing a surname, address, or appearing in the same document does not prove kinship.

## Database vaults
- They are available and manage structured tables with typed columns, rows, views, search, analysis, and Data Chat.
- User-created databases appear in the sidebar. Fixed sections include Search, Analysis, and Data Chat.

## Study vault
- It is available. Its hierarchy is Course > Subject; inside a subject there may be folders, topics, subtopics, notes, and materials.
- It includes Courses and subjects, Schedules, Calendar, Search, Materials, Recordings, Study chat, Ideas, Graph, Question bank, and Review.
- Schedules uses a clock icon; Calendar uses a calendar icon.
- In Schedules, clicking a cell opens a dropdown to add an existing subject or an independent activity.
- Calendar offers monthly, weekly, and yearly views, events with reminders, and export to iCloud or Google Calendar.
- The Question bank contains questions, tests, exams, and flashcards; a flashcard opens in its specific modal.

## Teaching vault
- It is implemented and available in BETA. It reuses the Course > Subject organization and adds a teaching workspace.
- Implemented sections include Courses, subjects and groups, Groups, Schedules, Calendar, Materials, Recordings, Chat, Ideas, Graph, Question bank, Rubrics, Exams, Grades, and Unit design.
- Teaching guide / Planning, Learning situations, Adaptations, Notes, and Innovation projects appear as “In design” items: they open their feedback thread and must not be described as finished features.
- To start: create courses and subjects, create groups, add materials, and then use the assessment surfaces you need. Student data is managed inside Groups and Grades.

## Primary sources vault
- It is implemented and available in PRE-ALPHA exclusively for collaboration and testing, not real work.
- Its sections are Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit, and Settings.
- Archive organizes documents by archival location or work collections. The tree's side panel can be hidden and shown again with its panel control.
- To add documents: open Archive and use Add source. The table shows cataloguing metadata and a thumbnail when an image exists.
- Clicking a row opens the document modal. From that modal, cataloguing data, description, text, evidence, analysis, notes, history, files, and representations can be consulted and edited; compact actions use icons with accessible labels.
- The user can choose the icon or document type; Nodus suggests one based on the source type, but the choice remains editable.
- Map represents the provenance assigned to each source, not every city mentioned in its text. Provenance is chosen in the document through a dropdown connected to places available on the map.
- Every automatic result is a proposal pending review. Distinguish transcription, observation, and inference, and preserve provenance, locators, contradictions, and uncertainty.

## Testimonies vault
- It is implemented and available in PRE-ALPHA exclusively for collaboration and testing, not real work.
- Its sections are Search, Interviews, Participants, Contrasts, Notes, Toolkit, and Settings.
- Specific work happens inside each interview's dossier: sessions, media, transcriptions, fragments, codes, annotations, agreements, and restrictions. Menu views gather what crosses several interviews.
- To start: create an interview, record participants and agreements, add a session or medium, and prepare or import the transcription. Codes and annotations are applied to fragments; Contrasts compares documented fragments.
- Editing a participant uses a modal inside the current view.
- Nodi respects access, anonymization, embargo, and attribution. It must not expose material that the agreement does not authorize or infer sensitive attributes, emotions, sincerity, or credibility.

## Prosopography vault
- It is implemented and available in PRE-ALPHA exclusively for collaboration and testing, not real work.
- Its sections are Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit, and Settings.
- Recommended flow: define and version the population methodology; design the questionnaire and vocabularies; record sources and segments; capture atomic factoids and statements; resolve identities; decide membership; and only then run analyses or networks.
- Search covers people, mentions, sources, and statements. Analysis declares population, denominator, absences, and input footprint. Networks visually separates explicit, derived, and hypothetical relationships.
- Do not confuse person, mention, source, factoid, and statement. Do not merge identities or turn a documentary observation into a fact without review.

## Worldbuilding vault
- It is implemented and available in ALPHA, recommended only for testers.
- Explore includes Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, and Dynasties.
- Analyze includes World chat, World rules, Conflicts, Narrative arcs, Continuity, and Open questions. Create includes Notes, Scenes, and Manuscript.
- To start: record the world's canonical sheets; relate characters, places, groups, and scenes; define rules and storylines; use Continuity to detect documented tensions; and write in Manuscript.
- The author is the source of truth. Nodi does not invent canon: it must clearly distinguish established information from a proposal.

## Tools (Nodus Toolkit)
- Tools is a sidebar section in its own group and also has a header icon. It appears for every vault type.
- Its home page is a hub with five cards: Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter, and OCR Workspace.
- Nodus Convert works: it converts and processes files locally, one at a time or in batches, in five categories — Documents (PDF, DOCX, EPUB, Markdown, HTML, text), PDF utilities (merge, split, rotate, reorder, extract images, metadata, images→PDF), light OCR (image or scanned PDF to text, and searchable PDF), Images (format conversion including HEIC, resize, compress), and Text (clean text pasted from PDF, upper/lower case, subtitles to text, checksums).
- Nodus Protect works: it accepts PDFs and images from disk or the active vault, concatenates documents, can hide or blur data, crop, rotate, straighten, convert to grayscale, add seven watermark patterns and a legal footer, and export rasterized copies as PNG, ZIP, or PDF.
- Protect can save a copy to disk, share it, or add it to the vault's “Protected copies” library. It also creates and verifies traceable IDPS v1 marks compatible with IDprotector; the mark authenticates a copy but does not encrypt it and may be lost through JPEG, screenshots, resizing, or recompression.
- Nodus Translate works: it translates pasted text, TXT, Markdown, HTML, DOCX, EPUB, and PDF files, as well as attachments imported from Zotero. It allows choosing target language, model, folder, and output format, and adding optional source language and glossary.
- In DOCX and EPUB, Translate directly preserves styles, hierarchy, headers, footers, notes, links, and images from the original. In PDF it offers a reflow reading mode and a rasterized facsimile mode that preserves pages, geometry, backgrounds, and images and visibly replaces text in position; it can use vision for scans and text inside images. If a translation does not fit, it reduces the size and warns about affected pages.
- Translation requires the selected AI provider and may send it the text or pages that need recognition. The original file is never modified: the result is saved as a new copy.
- Nodus Presenter can be opened: it imports PDF files or presentations made in PowerPoint, LibreOffice, or Keynote into a global Tools library (with tags, search, sorting, and thumbnails). External presentations are converted locally to PDF after warning that animations and transitions are not preserved; modern PowerPoint notes are imported automatically. It also allows writing notes per slide, exporting and importing them together in TXT, adding YouTube videos per slide, and downloading the deck's PDF back out of the library. When presenting, it opens the slide full-screen (on the external display if there are two) and a presenter view with the current slide, next slide, notes, timer, and clock; it includes live annotation tools (torch, drawing, pointer, and magnifier), black screen, and remote control from a mobile by scanning a PIN-protected QR code. YouTube videos are the only element that needs a connection; everything else works offline.
- OCR Workspace can be opened and offers an AI-assisted flow to import scans, review and correct each page, and export the result.
- Nodus Convert is deterministic and 100% offline (there is no AI), never modifies the original file, and uploads nothing to any service; the only optional network call is downloading Tesseract OCR languages, which the user decides.
- Nodus Protect document processing is local and does not send documents to AI, providers, or external services. This statement concerns Protect, not every optional network feature of Nodus.
- Within a tool, a button to the left of its title returns to the Tools hub.

## Local MCP and Nodus Server
- The local MCP server is configured in Settings > Integrations > MCP Server. It can be enabled, its status checked, connection help opened, and its token regenerated.
- MCP exposes tools suitable for the active vault type, as well as general tools. Switching vault changes the context those tools query.
- Nodus Server is independent of local MCP. It is configured in Settings > Server, and each vault connects separately through the server's HTTPS URL and a one-time code.
- Nodus publishes a logical, filtered copy over outbound HTTPS: it does not open an incoming port on the computer and does not share a listener, port, or token with local MCP.
- While Nodus is open it keeps the copy updated; the Docker server can serve the last published copy to authorized clients even when the computer is off.
- The interface allows publishing now, pausing, managing, or disconnecting each connected vault. Remote access uses OAuth and read permissions over assigned spaces.
- In the roadmap, the Server initiative is “Planned”, as is vault sharing and collaborative work. Do not present collaborative work as available.

## Roadmap summary status
- In development: Polishing and stability.
- Planned: Server; Vault sharing and collaborative work; Apps for iOS and iPadOS.
- Implemented: Teaching, Primary sources, Testimonies, User-suggested vaults —Prosopography and Worldbuilding—, Nodus Toolkit, Nodus Translate, Nodus Presenter, and OCR Workspace.
- There are no fixed dates for roadmap initiatives.

## Protocol for answering about the interface
- Use the exact names in this guide and, when selected, the Current view.
- Do not fill gaps with common patterns from other applications. Do not invent buttons, menus, paths, shortcuts, versions, dates, or statuses.
- Do not turn the availability of a PRE-ALPHA or ALPHA vault into a recommendation for real use. Always state its phase when relevant.
- If an answer is not covered, say “I cannot verify this with the selected sources” and state what context would help, without proposing an invented route.
- Always distinguish available, conditional, future, and unverified.
- When the question asks for a location or instructions, give brief numbered steps and end with a “Base: …” line listing the sources used.`;

/** Localized headings keep the complete factual copy legible in each language. */
/* Localized copies below are the sole non-Spanish documentation source. */
const COMPACT_LOCALIZED_DOCUMENTATION: Record<Exclude<PromptLanguage, 'es'>, string> = {
  en: ENGLISH_DOCUMENTATION,
  fr: `# Guide interne vérifiable de Nodus

## Règles de lecture
- Cette guide décrit l’interface actuelle et la feuille de route officielle. Ne déduis aucune fonction, route, date, version ou état absent des sources.
- « Mis en œuvre » signifie que la fonction existe et s’ouvre, pas qu’elle est stable. Nodus est local-first et chaque vault conserve ses données sur l’ordinateur.

## Vaults disponibles et maturité
- Vaults > Ajouter un vault permet de créer Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography et Worldbuilding.
- Primary sources, Testimonies et Prosopography sont PRE-ALPHA; Worldbuilding est ALPHA; Databases, Teaching, Study et Genealogy sont BETA. Academic n’affiche pas de phase. Le tutoriel ne s’ouvre pas avec les données de démonstration.

## En-tête et contrôles globaux
- L’ordre général à droite est Commands, Assistant, Tools, contrôles du vault, Suggest / Report, thème, Notifications et Settings; Commands utilise ⌘K sur macOS.
- La pastille centrale ouvre le sélecteur du vault. Notifications contient « Nodus notices » et « Activity » et reste disponible si Nodi est désactivé.

## Feuille de route officielle visible
- Elle s’ouvre dans Settings > About Nodus Research > View Nodus Research roadmap ou dans la palette de commandes. L’ordre et les états sont :
__ROADMAP_GUIDE__

## Réglages
- Les onglets sont Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research et Updates and news.
- Providers gère clés et modèles; Library synchronise Zotero; Interface gère langue, thème, accessibilité, barre latérale et Nodi; Server publie la copie filtrée du vault.

## Vault académique
- Il sert à la recherche et à l’écriture; ses surfaces comprennent Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes et Settings.
- Deep Research récupère le corpus, produit un rapport et l’exporte en document ou PDF avec l’identité du vault.

## Vault de généalogie
- Il comprend People, Timeline, Family tree, Social relations, Map et Archive. Les identités et parentés exigent des registres ou preuves; un nom, une adresse ou un document commun ne suffit pas.

## Vaults de bases de données
- Ils gèrent des tables structurées, colonnes typées, lignes, vues, recherche, analyse et Data Chat; les bases utilisateur apparaissent dans la barre latérale.

## Vault d’étude
- La hiérarchie est Course > Subject avec dossiers, thèmes, sous-thèmes, notes et matériaux; il comprend Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank et Review.
- Schedules permet une activité par cellule; Calendar offre vues mensuelle, hebdomadaire et annuelle et export iCloud ou Google Calendar; Question bank contient questions, tests, examens et flashcards.

## Vault d’enseignement
- Implémenté en BETA, il réutilise Course > Subject et ajoute groupes, matériaux, Chat, Rúbricas, Exams, Grades et Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes et Innovation projects sont « In design ».

## Vault de sources primaires
- Implémenté en PRE-ALPHA pour tests et collaboration, il comprend Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit et Settings; Archive gère provenance et métadonnées.
- Les résultats automatiques restent des propositions à vérifier; distingue transcription, observation et inférence et conserve localisateurs, contradictions et incertitude.

## Vault de témoignages
- Implémenté en PRE-ALPHA, il comprend Search, Interviews, Participants, Contrasts, Notes, Toolkit et Settings; les dossiers regroupent sessions, médias, transcriptions, fragments, codes, accords et restrictions.
- Nodi respecte accès, anonymisation, embargo et attribution et n’infère pas d’attributs sensibles, émotions, sincérité ou crédibilité.

## Vault de prosopographie
- Implémenté en PRE-ALPHA, il comprend Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit et Settings; la méthode précède identités, appartenance, analyses et réseaux.
- Ne confonds pas person, mention, source, factoid et statement; les identités ne sont fusionnées qu’après révision.

## Vault de worldbuilding
- Implémenté en ALPHA, il propose Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families et Dynasties, ainsi que World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes et Manuscript.
- L’auteur est la source de vérité; Nodi distingue le canon établi de toute proposition.

## Outils (Nodus Toolkit)
- Le hub contient Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter et OCR Workspace. Convert traite localement Documents (PDF, DOCX, EPUB, Markdown, HTML), utilitaires PDF, OCR léger, Images et Text.
- Protect rasterise et exporte PNG, ZIP ou PDF, sans modifier l’original. Translate traite TXT, Markdown, HTML, DOCX, EPUB, PDF et pièces Zotero; il conserve la structure et propose un mode fac-similé. Nodus Presenter importe PowerPoint, LibreOffice et Keynote; OCR Workspace révise chaque page.
- Convert est déterministe et 100 % offline; Protect ne transmet pas de documents à l’IA. La seule connexion facultative de Convert télécharge les langues OCR de Tesseract.

## MCP local et Nodus Server
- MCP se règle dans Settings > Integrations > MCP Server et expose les outils du vault actif. Nodus Server est séparé, se règle dans Settings > Server et utilise URL HTTPS et code unique par vault.
- La copie publiée est filtrée et sortante; elle ne partage ni listener, ni port, ni token avec MCP. OAuth protège l’accès distant. Server et le partage collaboratif restent « Planifié ».

## État récapitulatif de la feuille de route
- En développement : Polissage et stabilité. Planifié : Server, partage de vaults et travail collaboratif, applications iOS et iPadOS. Mis en œuvre : Teaching, Primary sources, Testimonies, vaults suggérés, Nodus Toolkit, Nodus Translate, Nodus Presenter et OCR Workspace.
- Aucune date fixe n’est annoncée.

## Protocole d’interface
- Utilise les noms exacts et la Vue actuelle; sépare disponible, conditionnel, futur et non vérifié. Si la source manque, dis « Je ne peux pas le vérifier avec les sources sélectionnées ».
- Ne transforme jamais PRE-ALPHA ou ALPHA en recommandation réelle; pour une localisation, donne des étapes brèves et termine par « Base: … ».
`,
  pt: `# Guia interno verificável do Nodus

## Regras de leitura
- Este guia descreve a interface atual e o roteiro oficial. Não invente funcionalidades, caminhos, datas, versões ou estados que não estejam documentados.
- «Implementado» significa que existe e pode ser aberto, não que seja estável. O Nodus é local-first e cada cofre guarda os dados no computador.

## Cofres disponíveis e maturidade
- Em Cofres > Adicionar cofre podem ser criados Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography e Worldbuilding.
- Primary sources, Testimonies e Prosopography são PRE-ALPHA; Worldbuilding é ALPHA; Databases, Teaching, Study e Genealogy são BETA. Academic não mostra fase e dados de demonstração não abrem o tutorial.

## Cabeçalho e controlos globais
- À direita aparecem Commands, Assistant, Tools, controlos do cofre, Suggest / Report, tema, Notifications e Settings; Commands usa ⌘K no macOS.
- A insígnia central abre o seletor do cofre. Notifications contém «Nodus notices» e «Activity» e funciona com Nodi desativado.

## Roteiro oficial visível
- Abre-se em Settings > About Nodus Research > View Nodus Research roadmap ou na paleta de comandos. Ordem e estados:
__ROADMAP_GUIDE__

## Definições
- Os separadores são Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research e Updates and news.
- Providers gere chaves e modelos; Library sincroniza Zotero; Interface gere idioma, tema, acessibilidade, barra lateral e Nodi; Server publica a cópia filtrada.

## Cofre académico
- Serve para investigação e escrita e inclui Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes e Settings.
- Deep Research recupera evidência do corpus, cria um relatório e permite exportá-lo como documento ou PDF.

## Cofre de genealogia
- Inclui People, Timeline, Family tree, Social relations, Map e Archive. Identidades e parentescos exigem registos ou provas; apelido, morada ou documento comum não bastam.

## Cofres de bases de dados
- Gerem tabelas estruturadas com colunas tipadas, linhas, vistas, pesquisa, análise e Data Chat; as bases do utilizador aparecem na barra lateral.

## Cofre de estudo
- A hierarquia é Course > Subject, com pastas, temas, subtemas, notas e materiais; inclui Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank e Review.
- Schedules aceita uma atividade por célula; Calendar oferece vistas mensal, semanal e anual e exportação para iCloud ou Google Calendar; Question bank contém perguntas, testes, exames e flashcards.

## Cofre de docência
- Está implementado em BETA, reutiliza Course > Subject e acrescenta grupos, materiais, Chat, Rubrics, Exams, Grades e Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes e Innovation projects continuam «In design».

## Cofre de fontes primárias
- Está implementado em PRE-ALPHA para testes e colaboração, com Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit e Settings; Archive gere proveniência e metadados.
- Resultados automáticos são propostas pendentes de revisão; separa transcrição, observação e inferência e conserva localizadores, contradições e incerteza.

## Cofre de testemunhos
- Está implementado em PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit e Settings organizam sessões, meios, transcrições, fragmentos, códigos, acordos e restrições.
- Nodi respeita acesso, anonimização, embargo e atribuição e não infere atributos sensíveis, emoções, sinceridade ou credibilidade.

## Cofre de prosopografia
- Está implementado em PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit e Settings seguem metodologia, identidades, pertença, análise e redes.
- Não confundas person, mention, source, factoid e statement; não fusiones identidades sem revisão.

## Cofre de worldbuilding
- Está implementado em ALPHA e inclui Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes e Manuscript.
- O autor é a fonte de verdade; Nodi separa cânone estabelecido de propostas.

## Ferramentas (Nodus Toolkit)
- O hub contém Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter e OCR Workspace. Convert processa localmente Documents, utilitários PDF, OCR leve, Images e Text.
- Protect exporta PNG, ZIP ou PDF sem alterar o original; Translate trata TXT, Markdown, HTML, DOCX, EPUB, PDF e anexos Zotero; Nodus Presenter importa PowerPoint, LibreOffice e Keynote; OCR Workspace revê cada página.
- Convert é determinístico e 100 % offline; Protect não envia documentos à IA. Só a descarga opcional de idiomas OCR do Tesseract usa rede.

## MCP local e Nodus Server
- MCP configura-se em Settings > Integrations > MCP Server. Nodus Server é separado, configura-se em Settings > Server e usa URL HTTPS e código único por cofre.
- A cópia publicada é filtrada e apenas de saída; OAuth protege o acesso. Server e partilha colaborativa continuam «Planeado».

## Estado resumido do roteiro
- Em desenvolvimento: Polimento e estabilidade. Planeado: Server, partilha de cofres e colaboração, aplicações iOS e iPadOS. Implementado: Teaching, Primary sources, Testimonies, cofres sugeridos, Nodus Toolkit, Nodus Translate, Nodus Presenter e OCR Workspace.
- Não há datas fixas.

## Protocolo da interface
- Usa os nomes exatos e a Vista atual; distingue disponível, condicional, futuro e não verificado. Se faltar fonte, diz «Não consigo verificar isto com as fontes selecionadas».
- Nunca recomendes PRE-ALPHA ou ALPHA para trabalho real; em instruções termina com «Base: …».
`,
  'pt-BR': `# Guia interno verificável do Nodus

## Regras de leitura
- Este guia descreve a interface atual e o roadmap oficial. Não invente recursos, caminhos, datas, versões ou status que não estejam documentados.
- “Implementado” significa que existe e pode ser aberto, não que seja estável. O Nodus é local-first e cada vault armazena os dados no computador.

## Vaults disponíveis e maturidade
- Em Vaults > Adicionar vault podem ser criados Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography e Worldbuilding.
- Primary sources, Testimonies e Prosopography são PRE-ALPHA; Worldbuilding é ALPHA; Databases, Teaching, Study e Genealogy são BETA. Academic não mostra fase e dados de demonstração não abrem o tutorial.

## Cabeçalho e controles globais
- À direita aparecem Commands, Assistant, Tools, controles do vault, Suggest / Report, tema, Notifications e Settings; Commands usa ⌘K no macOS.
- O emblema central abre o seletor do vault. Notifications contém “Nodus notices” e “Activity” e funciona mesmo com Nodi desativado.

## Roadmap oficial visível
- Abre em Settings > About Nodus Research > View Nodus Research roadmap ou na paleta de comandos. Ordem e status:
__ROADMAP_GUIDE__

## Configurações
- As abas são Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research e Updates and news.
- Providers gerencia chaves e modelos; Library sincroniza Zotero; Interface gerencia idioma, tema, acessibilidade, barra lateral e Nodi; Server publica a cópia filtrada.

## Vault acadêmico
- Destina-se à pesquisa e escrita e inclui Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes e Settings.
- Deep Research recupera evidências do corpus, gera relatório e permite exportar documento ou PDF.

## Vault de genealogia
- Inclui People, Timeline, Family tree, Social relations, Map e Archive. Identidades e parentescos exigem registros ou evidências; sobrenome, endereço ou documento comum não bastam.

## Vaults de bancos de dados
- Gerenciam tabelas estruturadas com colunas tipadas, linhas, visualizações, busca, análise e Data Chat; as bases do usuário aparecem na barra lateral.

## Vault de estudo
- A hierarquia é Course > Subject, com pastas, temas, subtemas, notas e materiais; inclui Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank e Review.
- Schedules aceita atividade por célula; Calendar oferece visões mensal, semanal e anual e exportação para iCloud ou Google Calendar; Question bank contém perguntas, testes, exames e flashcards.

## Vault de ensino
- Está implementado em BETA, reutiliza Course > Subject e acrescenta grupos, materiais, Chat, Rubrics, Exams, Grades e Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes e Innovation projects continuam “In design”.

## Vault de fontes primárias
- Está implementado em PRE-ALPHA para testes e colaboração, com Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit e Settings; Archive gerencia proveniência e metadados.
- Resultados automáticos são propostas pendentes de revisão; separe transcrição, observação e inferência e preserve localizadores, contradições e incerteza.

## Vault de depoimentos
- Está implementado em PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit e Settings organizam sessões, mídias, transcrições, fragmentos, códigos, acordos e restrições.
- Nodi respeita acesso, anonimização, embargo e atribuição e não infere atributos sensíveis, emoções, sinceridade ou credibilidade.

## Vault de prosopografia
- Está implementado em PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit e Settings seguem metodologia, identidades, pertencimento, análise e redes.
- Não confunda person, mention, source, factoid e statement; não una identidades sem revisão.

## Vault de worldbuilding
- Está implementado em ALPHA e inclui Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes e Manuscript.
- O autor é a fonte da verdade; Nodi separa cânone estabelecido de propostas.

## Ferramentas (Nodus Toolkit)
- O hub contém Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter e OCR Workspace. Convert processa localmente Documents, utilitários PDF, OCR leve, Images e Text.
- Protect exporta PNG, ZIP ou PDF sem alterar o original; Translate trata TXT, Markdown, HTML, DOCX, EPUB, PDF e anexos Zotero; Nodus Presenter importa PowerPoint, LibreOffice e Keynote; OCR Workspace revisa cada página.
- Convert é determinístico e 100% offline; Protect não envia documentos à IA. Só o download opcional de idiomas OCR do Tesseract usa rede.

## MCP local e Nodus Server
- MCP é configurado em Settings > Integrations > MCP Server. Nodus Server é separado, fica em Settings > Server e usa URL HTTPS e código único por vault.
- A cópia publicada é filtrada e apenas de saída; OAuth protege o acesso. Server e compartilhamento colaborativo continuam “Planejado”.

## Status resumido do roadmap
- Em desenvolvimento: Polimento e estabilidade. Planejado: Server, compartilhamento de vaults e colaboração, aplicativos para iOS e iPadOS. Implementado: Teaching, Primary sources, Testimonies, vaults sugeridos, Nodus Toolkit, Nodus Translate, Nodus Presenter e OCR Workspace.
- Não há datas fixas.

## Protocolo da interface
- Use os nomes exatos e a Visão atual; diferencie disponível, condicional, futuro e não verificado. Se faltar fonte, diga “Não consigo verificar isso com as fontes selecionadas”.
- Nunca recomende PRE-ALPHA ou ALPHA para trabalho real; em instruções termine com “Base: …”.
`,
  it: `# Guida interna verificabile di Nodus

## Regole di lettura
- Questa guida descrive l’interfaccia attuale e la roadmap ufficiale. Non inventare funzioni, percorsi, date, versioni o stati non documentati.
- «Implementato» significa esistente e apribile, non stabile. Nodus è local-first e ogni vault conserva i dati sul computer dell’utente.

## Vault disponibili e maturità
- In Vaults > Aggiungi vault si possono creare Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography e Worldbuilding.
- Primary sources, Testimonies e Prosopography sono PRE-ALPHA; Worldbuilding è ALPHA; Databases, Teaching, Study e Genealogy sono BETA. Academic non mostra una fase e i dati demo non aprono il tutorial.

## Intestazione e controlli globali
- A destra compaiono Commands, Assistant, Tools, controlli del vault, Suggest / Report, tema, Notifications e Settings; su macOS Commands usa ⌘K.
- Il contrassegno centrale apre il selettore del vault. Notifications contiene «Nodus notices» e «Activity» e funziona anche con Nodi disattivato.

## Roadmap ufficiale visibile
- Si apre da Settings > About Nodus Research > View Nodus Research roadmap o dalla palette dei comandi. Ordine e stati:
__ROADMAP_GUIDE__

## Impostazioni
- Le schede sono Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research e Updates and news.
- Providers gestisce chiavi e modelli; Library sincronizza Zotero; Interface gestisce lingua, tema, accessibilità, barra laterale e Nodi; Server pubblica la copia filtrata.

## Vault accademico
- È dedicato alla ricerca e alla scrittura e comprende Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes e Settings.
- Deep Research recupera prove dal corpus, genera un rapporto e consente l’esportazione come documento o PDF.

## Vault genealogico
- Comprende People, Timeline, Family tree, Social relations, Map e Archive. Identità e parentele richiedono registri o prove; cognome, indirizzo o documento comune non bastano.

## Vault di database
- Gestisce tabelle strutturate con colonne tipizzate, righe, viste, ricerca, analisi e Data Chat; i database dell’utente compaiono nella barra laterale.

## Vault di studio
- La gerarchia è Course > Subject con cartelle, temi, sottotemi, appunti e materiali; include Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank e Review.
- Schedules accetta attività per cella; Calendar offre viste mensile, settimanale e annuale ed esportazione in iCloud o Google Calendar; Question bank contiene domande, test, esami e flashcard.

## Vault didattico
- Implementato in BETA, riusa Course > Subject e aggiunge gruppi, materiali, Chat, Rubrics, Exams, Grades e Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes e Innovation projects restano «In design».

## Vault delle fonti primarie
- Implementato in PRE-ALPHA per test e collaborazione, comprende Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit e Settings; Archive gestisce provenienza e metadati.
- I risultati automatici sono proposte da revisionare; separa trascrizione, osservazione e inferenza e conserva riferimenti, contraddizioni e incertezza.

## Vault delle testimonianze
- Implementato in PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit e Settings organizzano sessioni, media, trascrizioni, frammenti, codici, accordi e restrizioni.
- Nodi rispetta accesso, anonimizzazione, embargo e attribuzione e non deduce attributi sensibili, emozioni, sincerità o credibilità.

## Vault di prosopografia
- Implementato in PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit e Settings seguono metodologia, identità, appartenenza, analisi e reti.
- Non confondere person, mention, source, factoid e statement; non unire identità senza revisione.

## Vault di worldbuilding
- Implementato in ALPHA e include Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes e Manuscript.
- L’autore è la fonte della verità; Nodi distingue il canone stabilito dalle proposte.

## Strumenti (Nodus Toolkit)
- L’hub contiene Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter e OCR Workspace. Convert elabora localmente Documents, utilità PDF, OCR leggero, Images e Text.
- Protect esporta PNG, ZIP o PDF senza modificare l’originale; Translate tratta TXT, Markdown, HTML, DOCX, EPUB, PDF e allegati Zotero; Nodus Presenter importa PowerPoint, LibreOffice e Keynote; OCR Workspace revisiona ogni pagina.
- Convert è deterministico e 100% offline; Protect non invia documenti all’IA. Solo il download facoltativo delle lingue OCR di Tesseract usa la rete.

## MCP locale e Nodus Server
- MCP si configura in Settings > Integrations > MCP Server. Nodus Server è separato, si configura in Settings > Server e usa URL HTTPS e codice monouso per vault.
- La copia pubblicata è filtrata e in uscita; OAuth protegge l’accesso. Server e condivisione collaborativa restano «Pianificati».

## Stato riassuntivo della roadmap
- In sviluppo: Rifinitura e stabilità. Pianificato: Server, condivisione dei vault e collaborazione, app iOS e iPadOS. Implementato: Teaching, Primary sources, Testimonies, vault suggeriti, Nodus Toolkit, Nodus Translate, Nodus Presenter e OCR Workspace.
- Non ci sono date fissate.

## Protocollo dell’interfaccia
- Usa i nomi esatti e la Vista attuale; distingui disponibile, condizionale, futuro e non verificato. Se manca una fonte, dì «Non posso verificarlo con le fonti selezionate».
- Non raccomandare mai PRE-ALPHA o ALPHA per lavoro reale; nelle istruzioni termina con «Base: …».
`,
  tr: `# Nodus Doğrulanabilir Dahili Kılavuz

## Okuma kuralları
- Bu kılavuz mevcut arayüzü ve resmî yol haritasını açıklar. Belgelenmeyen özellik, yol, tarih, sürüm veya durum uydurmayın.
- “Uygulandı” mevcut ve açılabilir demektir; kararlı demek değildir. Nodus local-first çalışır ve her kasa verilerini bilgisayarda saklar.

## Kullanılabilir kasalar ve olgunluk
- Kasalar > Kasa ekle üzerinden Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography ve Worldbuilding oluşturulabilir.
- Primary sources, Testimonies ve Prosopography PRE-ALPHA; Worldbuilding ALPHA; Databases, Teaching, Study ve Genealogy BETA’dır. Academic aşama göstermez; demo verileri öğreticiyi açmaz.

## Başlık ve genel denetimler
- Sağda genel olarak Commands, Assistant, Tools, kasa denetimleri, Suggest / Report, tema, Notifications ve Settings bulunur; macOS’ta Commands kısayolu ⌘K’dır.
- Ortadaki rozet kasa seçicisini açar. Notifications “Nodus notices” ve “Activity” listelerini içerir ve Nodi kapalıyken de çalışır.

## Resmî görünür yol haritası
- Settings > About Nodus Research > View Nodus Research roadmap üzerinden veya komut paletinden açılır. Sıra ve durumlar:
__ROADMAP_GUIDE__

## Ayarlar
- Gerçek sekmeler Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research ve Updates and news’tur.
- Providers anahtarları ve modelleri; Library Zotero eşzamanlamasını; Interface dil, tema, erişilebilirlik, kenar çubuğu ve Nodi’yi; Server filtrelenmiş kopyayı yönetir.

## Akademik kasa
- Araştırma ve akademik yazım içindir; Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes ve Settings içerir.
- Deep Research derlemden kanıt alır, rapor üretir ve belge veya PDF olarak dışa aktarır.

## Soybilim kasası
- People, Timeline, Family tree, Social relations, Map ve Archive içerir. Kimlik ve akrabalık iddiaları kayıt veya kanıt gerektirir; soyadı, adres ya da ortak belge yeterli değildir.

## Veritabanı kasaları
- Yazılı sütunlara sahip yapılandırılmış tabloları, satırları, görünümleri, aramayı, analizi ve Data Chat’i yönetir; kullanıcı veritabanları kenar çubuğunda görünür.

## Çalışma kasası
- Hiyerarşi Course > Subject’tir; klasör, konu, alt konu, not ve materyaller içerir. Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank ve Review bulunur.
- Schedules hücre başına etkinlik ekler; Calendar aylık, haftalık ve yıllık görünümler ile iCloud veya Google Calendar dışa aktarımı sunar; Question bank sorular, testler, sınavlar ve flashcard’lar içerir.

## Öğretim kasası
- BETA’da uygulanmıştır; Course > Subject düzenini kullanır ve gruplar, materyaller, Chat, Rubrics, Exams, Grades ve Unit design ekler. Teaching guide / Planning, Learning situations, Adaptations, Notes ve Innovation projects “In design” durumundadır.

## Birincil kaynaklar kasası
- Test ve iş birliği için PRE-ALPHA’da uygulanmıştır; Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit ve Settings içerir. Archive provenans ve katalog verilerini yönetir.
- Otomatik sonuçlar incelenmesi gereken önerilerdir; transkripsiyon, gözlem ve çıkarımı ayırın, konumlandırıcıları, çelişkileri ve belirsizliği koruyun.

## Tanıklıklar kasası
- PRE-ALPHA’da uygulanmıştır; Search, Interviews, Participants, Contrasts, Notes, Toolkit ve Settings oturum, medya, transkripsiyon, parçalar, kodlar, anlaşmalar ve kısıtları düzenler.
- Nodi erişim, anonimleştirme, ambargo ve atıfa uyar; hassas özellikleri, duyguları, samimiyeti veya güvenilirliği çıkarmaz.

## Prosopografi kasası
- PRE-ALPHA’da uygulanmıştır; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit ve Settings yöntem, kimlik, üyelik, analiz ve ağ akışını destekler.
- person, mention, source, factoid ve statement kavramlarını karıştırmayın; inceleme olmadan kimlikleri birleştirmeyin.

## Worldbuilding kasası
- ALPHA’da uygulanmıştır ve Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes ve Manuscript içerir.
- Doğruluk kaynağı yazardır; Nodi yerleşik kanonu önerilerden ayırır.

## Araçlar (Nodus Toolkit)
- Hub Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter ve OCR Workspace içerir. Convert Documents, PDF utilities, light OCR, Images ve Text kategorilerini yerel işler.
- Protect özgün dosyayı değiştirmeden PNG, ZIP veya PDF dışa aktarır; Translate TXT, Markdown, HTML, DOCX, EPUB, PDF ve Zotero eklerini işler; Nodus Presenter PowerPoint, LibreOffice ve Keynote içe aktarır; OCR Workspace her sayfayı inceler.
- Convert deterministik ve %100 offline’dır; Protect belgeleri yapay zekâya göndermez. Yalnızca isteğe bağlı Tesseract OCR dil indirmesi ağ kullanır.

## Yerel MCP ve Nodus Server
- MCP Settings > Integrations > MCP Server bölümünde kurulur. Nodus Server bağımsızdır, Settings > Server’dan ayarlanır ve her kasa için HTTPS URL ile tek kullanımlık kod kullanır.
- Yayınlanan kopya filtrelenmiş ve dışa giden bir kopyadır; OAuth uzaktan erişimi korur. Server ve ortak paylaşım “Planlandı” durumundadır.

## Yol haritası özet durumu
- Geliştiriliyor: İyileştirme ve kararlılık. Planlandı: Server, kasa paylaşımı ve ortak çalışma, iOS ve iPadOS uygulamaları. Uygulandı: Teaching, Primary sources, Testimonies, önerilen kasalar, Nodus Toolkit, Nodus Translate, Nodus Presenter ve OCR Workspace.
- Kesin tarihler yoktur.

## Arayüz protokolü
- Kesin adları ve Güncel görünümü kullanın; mevcut, koşullu, gelecek ve doğrulanmamış olanı ayırın. Kaynak yoksa “Seçilen kaynaklarla bunu doğrulayamıyorum” deyin.
- PRE-ALPHA veya ALPHA’yı gerçek iş için önermeyin; konum veya talimat sorularında kısa adımlar verip “Base: …” ile bitirin.
`,
  de: `# Überprüfbarer interner Leitfaden von Nodus

## Regeln zum Lesen
- Dieser Leitfaden beschreibt die aktuelle Oberfläche und die offizielle Roadmap. Erfinde keine Funktionen, Pfade, Daten, Versionen oder Statusangaben.
- „Implementiert“ bedeutet vorhanden und öffnbar, nicht stabil. Nodus ist local-first und jeder Vault speichert seine Daten auf dem Computer.

## Verfügbare Vaults und Reifegrad
- Unter Vaults > Vault hinzufügen sind Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography und Worldbuilding verfügbar.
- Primary sources, Testimonies und Prosopography sind PRE-ALPHA; Worldbuilding ist ALPHA; Databases, Teaching, Study und Genealogy sind BETA. Academic zeigt keine Phase. Demodaten öffnen den Rundgang nicht.

## Kopfzeile und globale Steuerung
- Rechts stehen allgemein Commands, Assistant, Tools, Vault-Steuerung, Suggest / Report, Theme, Notifications und Settings; Commands verwendet unter macOS ⌘K.
- Das mittige Abzeichen öffnet die Vault-Auswahl. Notifications enthält „Nodus notices“ und „Activity“ und funktioniert auch ohne Nodi.

## Offizielle sichtbare Roadmap
- Sie öffnet sich unter Settings > About Nodus Research > View Nodus Research roadmap oder in der Befehlspalette. Reihenfolge und Status:
__ROADMAP_GUIDE__

## Einstellungen
- Die echten Tabs sind Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research und Updates and news.
- Providers verwaltet Schlüssel und Modelle; Library synchronisiert Zotero; Interface verwaltet Sprache, Thema, Barrierefreiheit, Seitenleiste und Nodi; Server veröffentlicht die gefilterte Vault-Kopie.

## Akademischer Vault
- Er dient Forschung und wissenschaftlichem Schreiben und enthält unter anderem Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes und Settings.
- Deep Research holt Korpusbelege, erstellt einen Bericht und exportiert ihn als Dokument oder PDF mit der Vault-Identität.

## Genealogie-Vault
- Er umfasst People, Timeline, Family tree, Social relations, Map und Archive. Identitäts- und Verwandtschaftsaussagen benötigen Aufzeichnungen oder Belege; ein gemeinsamer Name, eine Adresse oder ein Dokument genügt nicht.

## Datenbank-Vaults
- Sie verwalten strukturierte Tabellen mit typisierten Spalten, Zeilen, Ansichten, Suche, Analyse und Data Chat; eigene Datenbanken erscheinen in der Seitenleiste.

## Lern-Vault
- Die Hierarchie ist Course > Subject mit Ordnern, Themen, Unterthemen, Notizen und Materialien; enthalten sind Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank und Review.
- Schedules erlaubt Aktivitäten pro Zelle; Calendar bietet Monats-, Wochen- und Jahresansicht sowie iCloud- oder Google-Calendar-Export; Question bank enthält Fragen, Tests, Prüfungen und Flashcards.

## Lehr-Vault
- In BETA implementiert, übernimmt er Course > Subject und ergänzt Gruppen, Materialien, Chat, Rubrics, Exams, Grades und Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes und Innovation projects bleiben „In design“.

## Vault für Primärquellen
- In PRE-ALPHA für Tests und Zusammenarbeit implementiert; Bereiche sind Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit und Settings. Archive verwaltet Provenienz und Katalogdaten.
- Automatische Ergebnisse sind Vorschläge zur Prüfung; Transkription, Beobachtung und Schlussfolgerung müssen getrennt sowie Lokatoren, Widersprüche und Unsicherheit erhalten werden.

## Zeugnis-Vault
- In PRE-ALPHA implementiert; Search, Interviews, Participants, Contrasts, Notes, Toolkit und Settings führen Dossiers mit Sitzungen, Medien, Transkriptionen, Fragmenten, Codes, Vereinbarungen und Einschränkungen.
- Nodi achtet auf Zugriff, Anonymisierung, Sperrfrist und Zuschreibung und leitet keine sensiblen Merkmale, Gefühle, Aufrichtigkeit oder Glaubwürdigkeit ab.

## Prosopographie-Vault
- In PRE-ALPHA implementiert; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit und Settings folgen dem Ablauf Methode, Identität, Zugehörigkeit, Analyse und Netzwerk.
- Person, Erwähnung, Quelle, Factoid und Statement dürfen nicht verwechselt werden; Identitäten werden erst nach Prüfung zusammengeführt.

## Worldbuilding-Vault
- In ALPHA implementiert; er bietet Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties sowie World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes und Manuscript.
- Der Autor ist die Wahrheitsquelle; Nodi trennt etablierten Kanon von Vorschlägen.

## Werkzeuge (Nodus Toolkit)
- Der Hub enthält Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter und OCR Workspace. Convert verarbeitet lokal Documents (PDF, DOCX, EPUB, Markdown, HTML), PDF utilities, light OCR, Images und Text.
- Protect exportiert rasterisierte PNG-, ZIP- oder PDF-Kopien ohne das Original zu ändern. Translate verarbeitet TXT, Markdown, HTML, DOCX, EPUB, PDF und Zotero-Anhänge, bewahrt Struktur und bietet Faksimile. Nodus Presenter importiert PowerPoint, LibreOffice und Keynote; OCR Workspace prüft jede Seite.
- Convert ist deterministisch und 100 % offline; Protect sendet keine Dokumente an KI. Nur der optionale Download von Tesseract-OCR-Sprachen benötigt Netzwerk.

## Lokales MCP und Nodus Server
- MCP wird unter Settings > Integrations > MCP Server eingerichtet und folgt dem aktiven Vault. Nodus Server ist unabhängig, steht unter Settings > Server und verwendet je Vault HTTPS-URL und Einmalcode.
- Die veröffentlichte Kopie ist gefiltert und ausgehend; Listener, Port und Token werden nicht mit MCP geteilt. OAuth schützt Fernzugriff. Server und kollaboratives Teilen sind „Geplant“.

## Roadmap-Status zusammengefasst
- In Entwicklung: Feinschliff und Stabilität. Geplant: Server, Vault-Sharing und Zusammenarbeit, iOS- und iPadOS-Apps. Implementiert: Teaching, Primary sources, Testimonies, vorgeschlagene Vaults, Nodus Toolkit, Nodus Translate, Nodus Presenter und OCR Workspace.
- Es gibt keine festen Termine.

## Protokoll für die Oberfläche
- Verwende exakte Namen und die aktuelle Ansicht; unterscheide verfügbar, bedingt, zukünftig und ungeprüft. Bei fehlender Quelle sage „Ich kann dies mit den ausgewählten Quellen nicht überprüfen“.
- Mache PRE-ALPHA oder ALPHA nie zur Empfehlung für reale Arbeit; bei Orts- oder Bedienfragen gib kurze Schritte und schließe mit „Base: …“.
`,
  'zh-Hans': `# Nodus 可验证内部指南

## 阅读规则
- 本指南记录当前界面与官方可见路线图。不要虚构未在此记录的功能、路径、日期、版本或状态。
- “已实现”表示功能存在且可以打开，并不表示已经稳定。Nodus 采用 local-first：每个 vault 都把数据保存在用户电脑上。

## 可用 vault 与成熟度
- 在 Vaults > Add vault 中可创建 Academic、Primary sources、Testimonies、Databases、Teaching、Study、Genealogy、Prosopography 和 Worldbuilding。
- Primary sources、Testimonies 与 Prosopography 处于 PRE-ALPHA；Worldbuilding 处于 ALPHA；Databases、Teaching、Study 与 Genealogy 处于 BETA。Academic 不显示阶段标签，演示数据不会打开教程。

## 标题栏与全局控件
- 右侧大致依次为 Commands、Assistant、Tools、vault 控件、Suggest / Report、主题切换、Notifications 和 Settings；在 macOS 上 Commands 的快捷键是 ⌘K。
- 中央徽章打开 vault 选择器。Notifications 包含 “Nodus notices” 和 “Activity”，即使 Nodi 被禁用也可使用。

## 官方可见路线图
- 可从 Settings > About Nodus Research > View Nodus Research roadmap 或命令面板打开。顺序与状态如下：
__ROADMAP_GUIDE__

## 设置
- 实际选项卡为 Providers、AI Models、Library、Text and OCR、Interface、Integrations、Server、Tutorials、Backup、About Nodus Research 和 Updates and news。
- Providers 管理密钥与模型；Library 同步 Zotero；Interface 管理语言、主题、无障碍、侧边栏和 Nodi；Server 发布经过筛选的 vault 副本。

## 学术 vault
- 面向研究与写作；包含 Home、Search、Library、Graph、Argument map、Ideas、Authors、Immersion、Gaps、Debates、Coverage、Hypotheses、Reading path、Deep Research、Writing、Projects、Notes 和 Settings；各区块可在 Settings > Interface > Sidebar 中隐藏或重新排序。
- Deep Research 从语料库中提取证据，生成报告，并可按 vault 的视觉标识导出为文档或 PDF。

## 家谱 vault
- 包含 People、Timeline、Family tree、Social relations、Map 和 Archive。关于身份与亲属关系的论断必须以档案或证据为依据；姓氏相同、住址相同或出现在同一份文件中并不能证明亲属关系。

## 数据库 vault
- 管理带类型列的结构化表格、行、视图、搜索、分析和 Data Chat；用户创建的数据库显示在侧边栏。

## 学习 vault
- 层级为 Course > Subject，学科内可包含文件夹、主题、子主题、笔记和材料；包含 Schedules、Calendar、Materials、Recordings、Study chat、Ideas、Graph、Question bank 和 Review。
- Schedules 每个单元格可添加一项活动；Calendar 提供月、周、年视图以及导出到 iCloud 或 Google Calendar；Question bank 包含问题、测验、考试和 flashcards。

## 教学 vault
- 已实现，处于 BETA；沿用 Course > Subject 结构并增加分组、材料、Chat、Rubrics、Exams、Grades 和 Unit design。Teaching guide / Planning、Learning situations、Adaptations、Notes 和 Innovation projects 仍为 “In design”。

## 原始资料 vault
- 已实现，处于 PRE-ALPHA，仅用于测试与协作；包含 Search、Archive、People、Timeline、Map、Social relations、Notes、Toolkit 和 Settings；Archive 管理来源与元数据。
- 自动结果均为待审阅的建议；请区分转录、观察与推断，并保留定位信息、矛盾与不确定性。

## 口述证词 vault
- 已实现，处于 PRE-ALPHA；Search、Interviews、Participants、Contrasts、Notes、Toolkit 和 Settings 组织会话、媒体、转录、片段、编码、约定和限制。
- Nodi 尊重访问权限、匿名化、禁阅期与署名，不推断敏感属性、情绪、真诚度或可信度。

## 群体传记 vault
- 已实现，处于 PRE-ALPHA；Search、Population、People、Sources、Analysis、Networks、Notes、Toolkit 和 Settings 遵循方法、身份、归属、分析与网络。
- 不要混淆 person、mention、source、factoid 和 statement；未经审阅不得合并身份。

## 世界构建 vault
- 已实现，处于 ALPHA；包含 Encyclopedia、Characters、Places、Factions、Cultures、Timeline、Map、Relationships、Families、Dynasties、World chat、World rules、Conflicts、Narrative arcs、Continuity、Notes、Scenes 和 Manuscript。
- 作者是事实的来源；Nodi 区分既定设定与提议。

## 工具（Nodus Toolkit）
- 中心页包含 Nodus Convert、Nodus Protect、Nodus Translate、Nodus Presenter 和 OCR Workspace。Convert 在本地处理 Documents、PDF utilities、light OCR、Images 和 Text。
- Protect 在不修改原文件的情况下导出 PNG、ZIP 或 PDF；Translate 处理 TXT、Markdown、HTML、DOCX、EPUB、PDF 和 Zotero 附件；Nodus Presenter 导入 PowerPoint、LibreOffice 和 Keynote；OCR Workspace 逐页审阅。
- Convert 是确定性的且 100% 离线；Protect 不向 AI 发送文档。只有可选的 Tesseract OCR 语言下载需要联网。

## 本地 MCP 与 Nodus Server
- MCP 在 Settings > Integrations > MCP Server 中配置。Nodus Server 相互独立，在 Settings > Server 中配置，每个 vault 使用 HTTPS URL 和一次性代码连接。
- 发布的副本经过筛选且为出站；OAuth 保护访问。Server 与协作共享仍为 “已计划”。

## 路线图状态摘要
- 开发中：打磨与稳定性。已计划：Server、vault 共享与协作、iOS 与 iPadOS 应用。已实现：Teaching、Primary sources、Testimonies、用户建议的 vault、Nodus Toolkit、Nodus Translate、Nodus Presenter 和 OCR Workspace。
- 没有固定的日期。

## 界面答复协议
- 使用准确名称和 Current view；区分可用、有条件、未来与未核实。若缺少来源，请说 “我无法用所选来源核实这一点”。
- 绝不要把 PRE-ALPHA 或 ALPHA 当作实际工作的推荐；在操作说明中以 “Base: …” 结尾。
`,
  'zh-Hant': `# Nodus 可驗證內部指南

## 閱讀規則
- 本指南記錄目前介面與官方可見藍圖。不得虛構未在此記錄的功能、路徑、日期、版本或狀態。
- 「已實作」表示功能存在且可以開啟，並不表示已經穩定。Nodus 採 local-first：每個 vault 都將資料保存在使用者電腦上。

## 可用 vault 與成熟度
- 在 Vaults > Add vault 中可建立 Academic、Primary sources、Testimonies、Databases、Teaching、Study、Genealogy、Prosopography 與 Worldbuilding。
- Primary sources、Testimonies 與 Prosopography 處於 PRE-ALPHA；Worldbuilding 處於 ALPHA；Databases、Teaching、Study 與 Genealogy 處於 BETA。Academic 不顯示階段標籤，示範資料不會開啟教學導覽。

## 標題列與全域控制項
- 右側大致依序為 Commands、Assistant、Tools、vault 控制項、Suggest / Report、佈景主題、Notifications 與 Settings；在 macOS 上 Commands 的快速鍵是 ⌘K。
- 中央徽章會開啟 vault 選擇器。Notifications 包含「Nodus notices」與「Activity」，即使 Nodi 已停用也可使用。

## 官方可見藍圖
- 可從 Settings > About Nodus Research > View Nodus Research roadmap 或命令面板開啟。順序與狀態如下：
__ROADMAP_GUIDE__

## 設定
- 實際索引標籤為 Providers、AI Models、Library、Text and OCR、Interface、Integrations、Server、Tutorials、Backup、About Nodus Research 與 Updates and news。
- Providers 管理金鑰與模型；Library 同步 Zotero；Interface 管理語言、佈景主題、無障礙、側邊欄與 Nodi；Server 發佈經過篩選的 vault 副本。

## 學術 vault
- 面向研究與寫作；包含 Home、Search、Library、Graph、Argument map、Ideas、Authors、Immersion、Gaps、Debates、Coverage、Hypotheses、Reading path、Deep Research、Writing、Projects、Notes 與 Settings；各區段可在 Settings > Interface > Sidebar 中隱藏或重新排序。
- Deep Research 從語料庫擷取證據、產生報告，並可依 vault 的視覺識別匯出為文件或 PDF。

## 族譜 vault
- 包含 People、Timeline、Family tree、Social relations、Map 與 Archive。關於身分與親屬關係的論斷必須以紀錄或證據為依據；姓氏相同、住址相同或出現在同一份文件中，並不能證明親屬關係。

## 資料庫 vault
- 管理含型別資料行的結構化表格、資料列、檢視、搜尋、分析與 Data Chat；使用者建立的資料庫會顯示在側邊欄。

## 學習 vault
- 階層為 Course > Subject，科目內可包含資料夾、主題、子主題、筆記與教材；包含 Schedules、Calendar、Materials、Recordings、Study chat、Ideas、Graph、Question bank 與 Review。
- Schedules 每個儲存格可新增一項活動；Calendar 提供月、週、年檢視以及匯出至 iCloud 或 Google Calendar；Question bank 包含問題、測驗、考試與 flashcards。

## 教學 vault
- 已實作，處於 BETA；沿用 Course > Subject 結構並加入群組、教材、Chat、Rubrics、Exams、Grades 與 Unit design。Teaching guide / Planning、Learning situations、Adaptations、Notes 與 Innovation projects 仍為「In design」。

## 原始史料 vault
- 已實作，處於 PRE-ALPHA，僅供測試與協作；包含 Search、Archive、People、Timeline、Map、Social relations、Notes、Toolkit 與 Settings；Archive 管理來源與詮釋資料。
- 自動結果都是待審閱的建議；請區分轉錄、觀察與推論，並保留定位資訊、矛盾與不確定性。

## 口述見證 vault
- 已實作，處於 PRE-ALPHA；Search、Interviews、Participants、Contrasts、Notes、Toolkit 與 Settings 組織場次、媒體、轉錄、片段、編碼、約定與限制。
- Nodi 尊重存取權、匿名化、禁閱期與姓名標示，不推論敏感屬性、情緒、真誠度或可信度。

## 群體傳記 vault
- 已實作，處於 PRE-ALPHA；Search、Population、People、Sources、Analysis、Networks、Notes、Toolkit 與 Settings 依循方法、身分、歸屬、分析與網路。
- 不要混淆 person、mention、source、factoid 與 statement；未經審閱不得合併身分。

## 世界觀建構 vault
- 已實作，處於 ALPHA；包含 Encyclopedia、Characters、Places、Factions、Cultures、Timeline、Map、Relationships、Families、Dynasties、World chat、World rules、Conflicts、Narrative arcs、Continuity、Notes、Scenes 與 Manuscript。
- 作者是事實的來源；Nodi 區分既定設定與提議。

## 工具（Nodus Toolkit）
- 中樞頁面包含 Nodus Convert、Nodus Protect、Nodus Translate、Nodus Presenter 與 OCR Workspace。Convert 在本機處理 Documents、PDF utilities、light OCR、Images 與 Text。
- Protect 在不修改原始檔案的情況下匯出 PNG、ZIP 或 PDF；Translate 處理 TXT、Markdown、HTML、DOCX、EPUB、PDF 與 Zotero 附件；Nodus Presenter 匯入 PowerPoint、LibreOffice 與 Keynote；OCR Workspace 逐頁檢閱。
- Convert 具確定性且 100% 離線；Protect 不會將文件傳送給 AI。只有選用的 Tesseract OCR 語言下載需要連線。

## 本機 MCP 與 Nodus Server
- MCP 在 Settings > Integrations > MCP Server 中設定。Nodus Server 彼此獨立，在 Settings > Server 中設定，每個 vault 使用 HTTPS URL 與一次性代碼連線。
- 發佈的副本經過篩選且為對外傳送；OAuth 保護存取。Server 與協作共享仍為「已規劃」。

## 藍圖狀態摘要
- 開發中：打磨與穩定性。已規劃：Server、vault 共享與協作、iOS 與 iPadOS 應用程式。已實作：Teaching、Primary sources、Testimonies、使用者建議的 vault、Nodus Toolkit、Nodus Translate、Nodus Presenter 與 OCR Workspace。
- 沒有固定日期。

## 介面答覆協定
- 使用精確名稱與 Current view；區分可用、有條件、未來與未驗證。若缺少來源，請說「我無法用所選來源核實這一點」。
- 絕不要把 PRE-ALPHA 或 ALPHA 當作實際工作的推薦；在操作說明中以「Base: …」結尾。
`,
  vi: `# Hướng dẫn nội bộ có thể kiểm chứng của Nodus

## Quy tắc đọc hướng dẫn
- Hướng dẫn này mô tả giao diện hiện tại và lộ trình chính thức đang hiển thị. Không được bịa ra tính năng, đường dẫn, ngày tháng, phiên bản hoặc trạng thái không có trong tài liệu.
- “Đã triển khai” nghĩa là tính năng tồn tại và có thể mở được, không có nghĩa là đã ổn định. Nodus hoạt động theo hướng local-first: mỗi vault lưu dữ liệu trên máy tính của người dùng.

## Các vault khả dụng và mức độ trưởng thành
- Tại Vaults > Add vault có thể tạo Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography và Worldbuilding.
- Primary sources, Testimonies và Prosopography ở PRE-ALPHA; Worldbuilding ở ALPHA; Databases, Teaching, Study và Genealogy ở BETA. Academic không hiển thị nhãn giai đoạn và dữ liệu minh họa không mở phần hướng dẫn.

## Thanh tiêu đề và điều khiển toàn cục
- Ở bên phải, thứ tự chung là Commands, Assistant, Tools, các điều khiển của vault, Suggest / Report, giao diện sáng/tối, Notifications và Settings; trên macOS Commands dùng ⌘K.
- Huy hiệu ở giữa mở bộ chọn vault. Notifications chứa “Nodus notices” và “Activity”, vẫn hoạt động khi Nodi bị tắt.

## Lộ trình chính thức đang hiển thị
- Mở từ Settings > About Nodus Research > View Nodus Research roadmap hoặc từ bảng lệnh. Thứ tự và trạng thái:
__ROADMAP_GUIDE__

## Cài đặt
- Các thẻ thực tế là Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research và Updates and news.
- Providers quản lý khóa và mô hình; Library đồng bộ Zotero; Interface quản lý ngôn ngữ, giao diện, trợ năng, thanh bên và Nodi; Server công bố bản sao đã lọc của vault.

## Vault học thuật
- Phục vụ nghiên cứu và viết học thuật; gồm Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes và Settings; có thể ẩn hoặc sắp xếp lại các mục trong Settings > Interface > Sidebar.
- Deep Research thu thập chứng cứ từ kho ngữ liệu, tạo báo cáo và cho phép xuất thành tài liệu hoặc PDF theo bản sắc hình ảnh của vault.

## Vault gia phả
- Gồm People, Timeline, Family tree, Social relations, Map và Archive. Các khẳng định về danh tính và quan hệ huyết thống phải dựa trên sổ sách hoặc chứng cứ; trùng họ, trùng địa chỉ hoặc cùng xuất hiện trong một tài liệu không chứng minh được quan hệ huyết thống.

## Vault cơ sở dữ liệu
- Quản lý bảng có cấu trúc với cột có kiểu, hàng, chế độ xem, tìm kiếm, phân tích và Data Chat; cơ sở dữ liệu do người dùng tạo xuất hiện ở thanh bên.

## Vault học tập
- Phân cấp là Course > Subject, trong một môn có thể có thư mục, chủ đề, chủ đề con, ghi chú và tài liệu; gồm Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank và Review.
- Schedules cho phép thêm một hoạt động cho mỗi ô; Calendar cung cấp chế độ xem tháng, tuần, năm và xuất sang iCloud hoặc Google Calendar; Question bank chứa câu hỏi, bài kiểm tra, bài thi và flashcards.

## Vault giảng dạy
- Đã triển khai ở BETA; tái sử dụng cấu trúc Course > Subject và bổ sung nhóm, tài liệu, Chat, Rubrics, Exams, Grades và Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes và Innovation projects vẫn ở trạng thái “In design”.

## Vault nguồn sơ cấp
- Đã triển khai ở PRE-ALPHA, chỉ dành cho thử nghiệm và cộng tác; gồm Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit và Settings; Archive quản lý xuất xứ và siêu dữ liệu.
- Mọi kết quả tự động đều là đề xuất chờ duyệt; hãy phân biệt bản chép lời, quan sát và suy luận, đồng thời giữ nguyên định vị, mâu thuẫn và bất định.

## Vault lời chứng
- Đã triển khai ở PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit và Settings tổ chức phiên, phương tiện, bản chép lời, phân đoạn, mã, thỏa thuận và hạn chế.
- Nodi tôn trọng quyền truy cập, ẩn danh, thời hạn cấm công bố và ghi công; không suy diễn thuộc tính nhạy cảm, cảm xúc, sự chân thành hay độ tin cậy.

## Vault văn liệu nhân vật
- Đã triển khai ở PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit và Settings tuân theo phương pháp, danh tính, tư cách thành viên, phân tích và mạng lưới.
- Không nhầm lẫn person, mention, source, factoid và statement; không hợp nhất danh tính khi chưa duyệt.

## Vault worldbuilding
- Đã triển khai ở ALPHA; gồm Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes và Manuscript.
- Tác giả là nguồn chân lý; Nodi phân biệt rõ canon đã thiết lập với đề xuất.

## Công cụ (Nodus Toolkit)
- Trang trung tâm gồm Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter và OCR Workspace. Convert xử lý cục bộ Documents, PDF utilities, light OCR, Images và Text.
- Protect xuất PNG, ZIP hoặc PDF mà không sửa tệp gốc; Translate xử lý TXT, Markdown, HTML, DOCX, EPUB, PDF và tệp đính kèm Zotero; Nodus Presenter nhập PowerPoint, LibreOffice và Keynote; OCR Workspace duyệt từng trang.
- Convert có tính xác định và 100% ngoại tuyến; Protect không gửi tài liệu cho AI. Chỉ thao tác tải ngôn ngữ OCR của Tesseract (tùy chọn) mới cần mạng.

## MCP cục bộ và Nodus Server
- MCP được cấu hình tại Settings > Integrations > MCP Server. Nodus Server độc lập, được cấu hình tại Settings > Server, mỗi vault kết nối bằng URL HTTPS và mã dùng một lần.
- Bản sao được công bố đã lọc và chỉ gửi ra ngoài; OAuth bảo vệ quyền truy cập. Server và chia sẻ cộng tác vẫn ở trạng thái “Đã lên kế hoạch”.

## Tình trạng tóm tắt lộ trình
- Đang phát triển: Hoàn thiện và ổn định. Đã lên kế hoạch: Server, chia sẻ vault và cộng tác, ứng dụng iOS và iPadOS. Đã triển khai: Teaching, Primary sources, Testimonies, các vault do người dùng đề xuất, Nodus Toolkit, Nodus Translate, Nodus Presenter và OCR Workspace.
- Không có mốc thời gian cố định.

## Giao thức trả lời về giao diện
- Dùng đúng tên trong hướng dẫn này và Current view khi được chọn; phân biệt khả dụng, có điều kiện, tương lai và chưa kiểm chứng. Nếu thiếu nguồn, hãy nói “Tôi không thể kiểm chứng điều này bằng các nguồn đã chọn”.
- Đừng bao giờ biến PRE-ALPHA hoặc ALPHA thành khuyến nghị cho công việc thực tế; trong hướng dẫn thao tác, kết thúc bằng “Base: …”.
`,
  ja: `# Nodus 検証可能な内部ガイド

## このガイドの読み方
- このガイドは現在のインターフェースと公式に表示されるロードマップを記載します。ここにない機能、経路、日付、バージョン、状態を創作しないでください。
- 「実装済み」は機能が存在して開けることを意味し、安定版に達したことを意味しません。Nodus は local-first で、各 vault はデータをユーザーのコンピューターに保存します。

## 利用可能な vault と成熟度
- Vaults > Add vault から Academic、Primary sources、Testimonies、Databases、Teaching、Study、Genealogy、Prosopography、Worldbuilding を作成できます。
- Primary sources、Testimonies、Prosopography は PRE-ALPHA、Worldbuilding は ALPHA、Databases、Teaching、Study、Genealogy は BETA です。Academic はフェーズ表示がなく、デモデータでチュートリアルは開きません。

## ヘッダーとグローバルコントロール
- 右側は概ね Commands、Assistant、Tools、vault のコントロール、Suggest / Report、テーマ、Notifications、Settings の順です。macOS では Commands のショートカットは ⌘K です。
- 中央のバッジが vault セレクターを開きます。Notifications には「Nodus notices」と「Activity」があり、Nodi を無効にしても動作します。

## 公式に表示されるロードマップ
- Settings > About Nodus Research > View Nodus Research roadmap またはコマンドパレットから開きます。順序と状態は次のとおりです：
__ROADMAP_GUIDE__

## 設定
- 実際のタブは Providers、AI Models、Library、Text and OCR、Interface、Integrations、Server、Tutorials、Backup、About Nodus Research、Updates and news です。
- Providers はキーとモデルを管理し、Library は Zotero を同期し、Interface は言語、テーマ、アクセシビリティ、サイドバー、Nodi を管理し、Server はフィルター済みの vault コピーを公開します。

## 学術 vault
- 研究と学術的執筆を目的とし、Home、Search、Library、Graph、Argument map、Ideas、Authors、Immersion、Gaps、Debates、Coverage、Hypotheses、Reading path、Deep Research、Writing、Projects、Notes、Settings を含みます。セクションは Settings > Interface > Sidebar で非表示または並べ替えできます。
- Deep Research はコーパスから証拠を取得してレポートを生成し、vault のビジュアルアイデンティティで文書または PDF としてエクスポートできます。

## 系譜 vault
- People、Timeline、Family tree、Social relations、Map、Archive を含みます。身元や親族関係の主張は記録や証拠に基づかなければなりません。姓、住所、同じ文書への登場が一致しても親族関係の証明にはなりません。

## データベース vault
- 型付き列を持つ構造化テーブル、行、ビュー、検索、分析、Data Chat を管理します。ユーザーが作成したデータベースはサイドバーに表示されます。

## 学習 vault
- 階層は Course > Subject で、科目内にフォルダー、トピック、サブトピック、ノート、教材を置けます。Schedules、Calendar、Materials、Recordings、Study chat、Ideas、Graph、Question bank、Review を含みます。
- Schedules はセルごとに活動を追加でき、Calendar は月・週・年の表示と iCloud または Google Calendar へのエクスポートを提供し、Question bank には問題、テスト、試験、flashcards が含まれます。

## 教育 vault
- BETA で実装済みで、Course > Subject の構成を再利用し、グループ、教材、Chat、Rubrics、Exams、Grades、Unit design を追加します。Teaching guide / Planning、Learning situations、Adaptations、Notes、Innovation projects は「In design」のままです。

## 一次資料 vault
- PRE-ALPHA で実装済みで、試験と共同作業のみを目的とします。Search、Archive、People、Timeline、Map、Social relations、Notes、Toolkit、Settings を含み、Archive は出所とメタデータを管理します。
- 自動結果はすべて確認待ちの提案です。文字起こし、観察、推論を区別し、位置情報、矛盾、不確実性を保持してください。

## 証言 vault
- PRE-ALPHA で実装済みです。Search、Interviews、Participants、Contrasts、Notes、Toolkit、Settings がセッション、メディア、文字起こし、断片、コード、合意、制限を整理します。
- Nodi はアクセス、匿名化、公開禁止期間、帰属を尊重し、機微な属性、感情、誠実さ、信頼性を推論しません。

## プロソポグラフィー vault
- PRE-ALPHA で実装済みです。Search、Population、People、Sources、Analysis、Networks、Notes、Toolkit、Settings が方法論、身元、所属、分析、ネットワークに従います。
- person、mention、source、factoid、statement を混同しないでください。確認なしに身元を統合しないでください。

## ワールドビルディング vault
- ALPHA で実装済みで、Encyclopedia、Characters、Places、Factions、Cultures、Timeline、Map、Relationships、Families、Dynasties、World chat、World rules、Conflicts、Narrative arcs、Continuity、Notes、Scenes、Manuscript を含みます。
- 作者が真実の源泉です。Nodi は確立された設定と提案を区別します。

## ツール（Nodus Toolkit）
- ハブには Nodus Convert、Nodus Protect、Nodus Translate、Nodus Presenter、OCR Workspace があります。Convert は Documents、PDF utilities、light OCR、Images、Text をローカルで処理します。
- Protect は元ファイルを変更せずに PNG、ZIP、PDF をエクスポートし、Translate は TXT、Markdown、HTML、DOCX、EPUB、PDF、Zotero 添付を処理し、Nodus Presenter は PowerPoint、LibreOffice、Keynote を取り込み、OCR Workspace は各ページを確認します。
- Convert は決定的で 100% オフラインです。Protect は文書を AI に送信しません。ネットワークを使うのは任意の Tesseract OCR 言語のダウンロードだけです。

## ローカル MCP と Nodus Server
- MCP は Settings > Integrations > MCP Server で設定します。Nodus Server は独立しており、Settings > Server で設定し、vault ごとに HTTPS URL とワンタイムコードで接続します。
- 公開されるコピーはフィルター済みで送信方向のみです。OAuth がアクセスを保護します。Server と共同共有は「計画済み」のままです。

## ロードマップの状態まとめ
- 開発中：磨き込みと安定性。計画済み：Server、vault の共有と共同作業、iOS および iPadOS アプリ。実装済み：Teaching、Primary sources、Testimonies、ユーザー提案の vault、Nodus Toolkit、Nodus Translate、Nodus Presenter、OCR Workspace。
- 固定された日付はありません。

## インターフェース回答プロトコル
- 正確な名称と Current view を使い、利用可能、条件付き、将来、未検証を区別してください。情報源がない場合は「選択した情報源ではこれを検証できません」と述べてください。
- PRE-ALPHA や ALPHA を実務利用の推奨として扱わないでください。手順では「Base: …」で締めくくってください。
`,
  ru: `# Проверяемый внутренний справочник Nodus

## Правила чтения справочника
- Этот справочник описывает текущий интерфейс и официальный видимый план развития. Не придумывайте функции, маршруты, даты, версии или состояния, которых здесь нет.
- «Реализовано» означает, что функция существует и открывается, а не то, что она достигла стабильной версии. Nodus работает по принципу local-first: каждый vault хранит данные на компьютере пользователя.

## Доступные vault и уровень зрелости
- Через Vaults > Add vault можно создать Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography и Worldbuilding.
- Primary sources, Testimonies и Prosopography находятся в PRE-ALPHA; Worldbuilding — в ALPHA; Databases, Teaching, Study и Genealogy — в BETA. Academic не показывает метку фазы, а демонстрационные данные не открывают обучение.

## Заголовок и глобальные элементы управления
- Справа в общем порядке расположены Commands, Assistant, Tools, элементы управления vault, Suggest / Report, выбор темы, Notifications и Settings; в macOS для Commands используется ⌘K.
- Центральный значок открывает выбор vault. Notifications содержит «Nodus notices» и «Activity» и работает даже при отключённой Nodi.

## Официальный видимый план развития
- Он открывается из Settings > About Nodus Research > View Nodus Research roadmap или из палитры команд. Порядок и состояния:
__ROADMAP_GUIDE__

## Настройки
- Реальные вкладки: Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research и Updates and news.
- Providers управляет ключами и моделями; Library синхронизирует Zotero; Interface управляет языком, темой, доступностью, боковой панелью и Nodi; Server публикует отфильтрованную копию vault.

## Академический vault
- Он предназначен для исследований и научного письма; включает Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes и Settings; разделы можно скрывать или переупорядочивать в Settings > Interface > Sidebar.
- Deep Research извлекает доказательства из корпуса, формирует отчёт и позволяет экспортировать его как документ или PDF с визуальной идентичностью vault.

## Генеалогический vault
- Включает People, Timeline, Family tree, Social relations, Map и Archive. Утверждения о личностях и родстве должны опираться на записи или доказательства; совпадение фамилии, адреса или присутствие в одном документе не доказывает родство.

## Vault баз данных
- Управляет структурированными таблицами с типизированными столбцами, строками, представлениями, поиском, анализом и Data Chat; созданные пользователем базы появляются в боковой панели.

## Учебный vault
- Иерархия — Course > Subject; внутри предмета могут быть папки, темы, подтемы, заметки и материалы; включает Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank и Review.
- В Schedules в каждую ячейку можно добавить занятие; Calendar предлагает месячный, недельный и годовой виды и экспорт в iCloud или Google Calendar; Question bank содержит вопросы, тесты, экзамены и flashcards.

## Преподавательский vault
- Реализован в BETA; использует структуру Course > Subject и добавляет группы, материалы, Chat, Rubrics, Exams, Grades и Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes и Innovation projects остаются в состоянии «In design».

## Vault первоисточников
- Реализован в PRE-ALPHA только для тестирования и совместной работы; включает Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit и Settings; Archive управляет происхождением и метаданными.
- Любой автоматический результат — это предложение, ожидающее проверки; различайте транскрипцию, наблюдение и вывод, сохраняя локаторы, противоречия и неопределённость.

## Vault свидетельств
- Реализован в PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit и Settings организуют сессии, медиа, расшифровки, фрагменты, коды, соглашения и ограничения.
- Nodi соблюдает доступ, анонимизацию, эмбарго и атрибуцию и не выводит чувствительные признаки, эмоции, искренность или достоверность.

## Vault просопографии
- Реализован в PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit и Settings следуют методологии, идентичностям, принадлежности, анализу и сетям.
- Не путайте person, mention, source, factoid и statement; не объединяйте идентичности без проверки.

## Vault миростроения
- Реализован в ALPHA; включает Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes и Manuscript.
- Автор — источник истины; Nodi чётко разделяет установленный канон и предложения.

## Инструменты (Nodus Toolkit)
- В центре собраны Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter и OCR Workspace. Convert локально обрабатывает Documents, PDF utilities, light OCR, Images и Text.
- Protect экспортирует PNG, ZIP или PDF, не изменяя оригинал; Translate обрабатывает TXT, Markdown, HTML, DOCX, EPUB, PDF и вложения Zotero; Nodus Presenter импортирует PowerPoint, LibreOffice и Keynote; OCR Workspace проверяет каждую страницу.
- Convert детерминирован и работает на 100 % офлайн; Protect не отправляет документы ИИ. Сеть нужна только для необязательной загрузки языков OCR Tesseract.

## Локальный MCP и Nodus Server
- MCP настраивается в Settings > Integrations > MCP Server. Nodus Server независим, настраивается в Settings > Server, и каждый vault подключается по HTTPS-URL с одноразовым кодом.
- Публикуемая копия отфильтрована и исходящая; OAuth защищает доступ. Server и совместная работа остаются «Запланировано».

## Сводный статус плана развития
- В разработке: Оттачивание и стабильность. Запланировано: Server, совместное использование vault и командная работа, приложения для iOS и iPadOS. Реализовано: Teaching, Primary sources, Testimonies, предложенные пользователями vault, Nodus Toolkit, Nodus Translate, Nodus Presenter и OCR Workspace.
- Фиксированных дат нет.

## Протокол ответов об интерфейсе
- Используйте точные названия и Current view; различайте доступное, условное, будущее и непроверенное. Если источника нет, скажите: «Я не могу проверить это по выбранным источникам».
- Никогда не превращайте PRE-ALPHA или ALPHA в рекомендацию для реальной работы; в инструкциях завершайте строкой «Base: …».
`,
  uk: `# Перевірний внутрішній довідник Nodus

## Правила читання довідника
- Цей довідник описує поточний інтерфейс і офіційний видимий план розвитку. Не вигадуйте функції, маршрути, дати, версії чи стани, яких тут немає.
- «Реалізовано» означає, що функція існує й відкривається, а не те, що вона досягла стабільної версії. Nodus працює за принципом local-first: кожен vault зберігає дані на комп’ютері користувача.

## Доступні vault і рівень зрілості
- Через Vaults > Add vault можна створити Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography і Worldbuilding.
- Primary sources, Testimonies і Prosopography перебувають у PRE-ALPHA; Worldbuilding — в ALPHA; Databases, Teaching, Study і Genealogy — в BETA. Academic не показує позначку фази, а демонстраційні дані не відкривають навчання.

## Заголовок і глобальні елементи керування
- Праворуч у загальному порядку розташовані Commands, Assistant, Tools, елементи керування vault, Suggest / Report, вибір теми, Notifications і Settings; у macOS для Commands використовується ⌘K.
- Центральний значок відкриває вибір vault. Notifications містить «Nodus notices» і «Activity» та працює навіть із вимкненою Nodi.

## Офіційний видимий план розвитку
- Він відкривається з Settings > About Nodus Research > View Nodus Research roadmap або з палітри команд. Порядок і стани:
__ROADMAP_GUIDE__

## Налаштування
- Реальні вкладки: Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research і Updates and news.
- Providers керує ключами та моделями; Library синхронізує Zotero; Interface керує мовою, темою, доступністю, бічною панеллю та Nodi; Server публікує відфільтровану копію vault.

## Академічний vault
- Призначений для досліджень і наукового письма; містить Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes і Settings; розділи можна приховувати або впорядковувати в Settings > Interface > Sidebar.
- Deep Research отримує докази з корпусу, формує звіт і дозволяє експортувати його як документ або PDF із візуальною ідентичністю vault.

## Генеалогічний vault
- Містить People, Timeline, Family tree, Social relations, Map і Archive. Твердження про особи та спорідненість мають підкріплюватися записами або доказами; збіг прізвища, адреси чи наявність в одному документі не доводить спорідненості.

## Vault баз даних
- Керує структурованими таблицями з типізованими стовпцями, рядками, поданнями, пошуком, аналізом і Data Chat; створені користувачем бази з’являються на бічній панелі.

## Навчальний vault
- Ієрархія — Course > Subject; усередині предмета можуть бути теки, теми, підтеми, нотатки й матеріали; містить Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank і Review.
- У Schedules до кожної клітинки можна додати заняття; Calendar пропонує місячний, тижневий і річний види та експорт в iCloud або Google Calendar; Question bank містить питання, тести, іспити й flashcards.

## Викладацький vault
- Реалізовано в BETA; використовує структуру Course > Subject і додає групи, матеріали, Chat, Rubrics, Exams, Grades і Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes і Innovation projects залишаються в стані «In design».

## Vault першоджерел
- Реалізовано в PRE-ALPHA лише для тестування та співпраці; містить Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit і Settings; Archive керує походженням і метаданими.
- Будь-який автоматичний результат — це пропозиція, що очікує перевірки; розрізняйте транскрипцію, спостереження та висновок, зберігаючи локатори, суперечності та непевність.

## Vault свідчень
- Реалізовано в PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit і Settings упорядковують сесії, медіа, розшифровки, фрагменти, коди, домовленості та обмеження.
- Nodi поважає доступ, анонімізацію, ембарго та атрибуцію й не виводить чутливі ознаки, емоції, щирість чи достовірність.

## Vault просопографії
- Реалізовано в PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit і Settings дотримуються методології, ідентичностей, належності, аналізу та мереж.
- Не плутайте person, mention, source, factoid і statement; не об’єднуйте ідентичності без перевірки.

## Vault світобудови
- Реалізовано в ALPHA; містить Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes і Manuscript.
- Автор — джерело істини; Nodi чітко розділяє встановлений канон і пропозиції.

## Інструменти (Nodus Toolkit)
- У центрі зібрано Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter і OCR Workspace. Convert локально обробляє Documents, PDF utilities, light OCR, Images і Text.
- Protect експортує PNG, ZIP або PDF, не змінюючи оригінал; Translate обробляє TXT, Markdown, HTML, DOCX, EPUB, PDF і вкладення Zotero; Nodus Presenter імпортує PowerPoint, LibreOffice і Keynote; OCR Workspace переглядає кожну сторінку.
- Convert детермінований і працює на 100 % офлайн; Protect не надсилає документи ШІ. Мережа потрібна лише для необов’язкового завантаження мов OCR Tesseract.

## Локальний MCP і Nodus Server
- MCP налаштовується в Settings > Integrations > MCP Server. Nodus Server незалежний, налаштовується в Settings > Server, і кожен vault підключається за HTTPS-URL з одноразовим кодом.
- Опублікована копія відфільтрована й вихідна; OAuth захищає доступ. Server і спільна робота залишаються «Заплановано».

## Підсумковий стан плану розвитку
- У розробці: Доопрацювання та стабільність. Заплановано: Server, спільне використання vault і командна робота, застосунки для iOS та iPadOS. Реалізовано: Teaching, Primary sources, Testimonies, запропоновані користувачами vault, Nodus Toolkit, Nodus Translate, Nodus Presenter і OCR Workspace.
- Фіксованих дат немає.

## Протокол відповідей про інтерфейс
- Використовуйте точні назви та Current view; розрізняйте доступне, умовне, майбутнє й неперевірене. Якщо джерела немає, скажіть: «Я не можу перевірити це за вибраними джерелами».
- Ніколи не перетворюйте PRE-ALPHA або ALPHA на рекомендацію для реальної роботи; в інструкціях завершуйте рядком «Base: …».
`,
  ko: `# Nodus 검증 가능 내부 안내서

## 안내서를 읽는 규칙
- 이 안내서는 현재 인터페이스와 공식적으로 공개된 로드맵을 설명합니다. 여기에 없는 기능, 경로, 날짜, 버전 또는 상태를 지어내지 마십시오.
- “구현됨”은 기능이 존재하고 열 수 있다는 뜻이며 안정 버전에 도달했다는 뜻이 아닙니다. Nodus는 local-first 방식으로 동작하며 각 vault는 사용자 컴퓨터에 데이터를 저장합니다.

## 사용 가능한 vault와 성숙도
- Vaults > Add vault에서 Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography, Worldbuilding을 만들 수 있습니다.
- Primary sources, Testimonies, Prosopography는 PRE-ALPHA, Worldbuilding은 ALPHA, Databases, Teaching, Study, Genealogy는 BETA입니다. Academic은 단계 표시가 없으며 데모 데이터로는 튜토리얼이 열리지 않습니다.

## 헤더와 전역 컨트롤
- 오른쪽에는 대체로 Commands, Assistant, Tools, vault 컨트롤, Suggest / Report, 테마, Notifications, Settings 순서로 있습니다. macOS에서 Commands 단축키는 ⌘K입니다.
- 중앙 배지가 vault 선택기를 엽니다. Notifications에는 “Nodus notices”와 “Activity”가 있으며 Nodi가 비활성화되어도 동작합니다.

## 공식 공개 로드맵
- Settings > About Nodus Research > View Nodus Research roadmap 또는 명령 팔레트에서 엽니다. 순서와 상태는 다음과 같습니다:
__ROADMAP_GUIDE__

## 설정
- 실제 탭은 Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research, Updates and news입니다.
- Providers는 키와 모델을 관리하고, Library는 Zotero를 동기화하며, Interface는 언어, 테마, 접근성, 사이드바, Nodi를 관리하고, Server는 필터링된 vault 사본을 게시합니다.

## 학술 vault
- 연구와 학술 작성을 위한 공간이며 Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes, Settings를 포함합니다. 섹션은 Settings > Interface > Sidebar에서 숨기거나 순서를 바꿀 수 있습니다.
- Deep Research는 코퍼스에서 증거를 가져와 보고서를 생성하고 vault의 시각적 정체성으로 문서 또는 PDF로 내보낼 수 있습니다.

## 계보 vault
- People, Timeline, Family tree, Social relations, Map, Archive를 포함합니다. 신원과 친족 관계에 대한 주장은 기록이나 증거로 뒷받침되어야 합니다. 성이 같거나 주소가 같거나 같은 문서에 등장한다고 해서 친족 관계가 증명되지는 않습니다.

## 데이터베이스 vault
- 형식이 지정된 열이 있는 구조화된 표, 행, 보기, 검색, 분석, Data Chat을 관리합니다. 사용자가 만든 데이터베이스는 사이드바에 표시됩니다.

## 학습 vault
- 계층은 Course > Subject이며 과목 안에 폴더, 주제, 하위 주제, 노트, 자료가 있을 수 있습니다. Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank, Review를 포함합니다.
- Schedules는 셀마다 활동을 추가할 수 있고, Calendar는 월간·주간·연간 보기와 iCloud 또는 Google Calendar 내보내기를 제공하며, Question bank에는 문제, 시험지, 시험, flashcards가 들어 있습니다.

## 교육 vault
- BETA로 구현되었으며 Course > Subject 구조를 재사용하고 그룹, 자료, Chat, Rubrics, Exams, Grades, Unit design을 추가합니다. Teaching guide / Planning, Learning situations, Adaptations, Notes, Innovation projects는 “In design” 상태로 남아 있습니다.

## 1차 사료 vault
- PRE-ALPHA로 구현되었으며 테스트와 협업 전용입니다. Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit, Settings를 포함하고 Archive는 출처와 메타데이터를 관리합니다.
- 모든 자동 결과는 검토 대기 중인 제안입니다. 전사, 관찰, 추론을 구분하고 위치 정보, 모순, 불확실성을 보존하십시오.

## 증언 vault
- PRE-ALPHA로 구현되었습니다. Search, Interviews, Participants, Contrasts, Notes, Toolkit, Settings가 세션, 미디어, 전사, 단편, 코드, 합의, 제한을 정리합니다.
- Nodi는 접근, 익명화, 공개 금지 기간, 저작자 표시를 존중하며 민감한 속성, 감정, 진실성, 신뢰성을 추론하지 않습니다.

## 프로소포그래피 vault
- PRE-ALPHA로 구현되었습니다. Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit, Settings가 방법론, 정체성, 소속, 분석, 네트워크를 따릅니다.
- person, mention, source, factoid, statement를 혼동하지 마십시오. 검토 없이 정체성을 병합하지 마십시오.

## 월드빌딩 vault
- ALPHA로 구현되었으며 Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes, Manuscript를 포함합니다.
- 작가가 진실의 원천입니다. Nodi는 확립된 설정과 제안을 명확히 구분합니다.

## 도구(Nodus Toolkit)
- 허브에는 Nodus Convert, Nodus Protect, Nodus Translate, Nodus Presenter, OCR Workspace가 있습니다. Convert는 Documents, PDF utilities, light OCR, Images, Text를 로컬에서 처리합니다.
- Protect는 원본을 수정하지 않고 PNG, ZIP, PDF로 내보내고, Translate는 TXT, Markdown, HTML, DOCX, EPUB, PDF, Zotero 첨부 파일을 처리하며, Nodus Presenter는 PowerPoint, LibreOffice, Keynote를 가져오고, OCR Workspace는 각 페이지를 검토합니다.
- Convert는 결정적이며 100% 오프라인으로 동작합니다. Protect는 문서를 AI로 보내지 않습니다. 선택적인 Tesseract OCR 언어 다운로드만 네트워크를 사용합니다.

## 로컬 MCP와 Nodus Server
- MCP는 Settings > Integrations > MCP Server에서 구성합니다. Nodus Server는 별개이며 Settings > Server에서 구성하고, 각 vault는 HTTPS URL과 일회용 코드로 연결합니다.
- 게시되는 사본은 필터링된 발신 전용입니다. OAuth가 접근을 보호합니다. Server와 협업 공유는 여전히 “계획됨”입니다.

## 로드맵 상태 요약
- 개발 중: 다듬기와 안정성. 계획됨: Server, vault 공유 및 협업, iOS 및 iPadOS 앱. 구현됨: Teaching, Primary sources, Testimonies, 사용자 제안 vault, Nodus Toolkit, Nodus Translate, Nodus Presenter, OCR Workspace.
- 고정된 날짜는 없습니다.

## 인터페이스 답변 프로토콜
- 정확한 이름과 Current view를 사용하고 사용 가능, 조건부, 미래, 미검증을 구분하십시오. 출처가 없으면 “선택한 출처로는 이를 검증할 수 없습니다”라고 말하십시오.
- PRE-ALPHA 또는 ALPHA를 실제 업무에 권장하지 마십시오. 안내에서는 “Base: …”로 끝내십시오.
`,

};

export function buildNodusDocumentation(language: PromptLanguage = 'es'): string {
  if (language === 'es') return NODUS_DOCUMENTATION;
  const template = language === 'en' ? ENGLISH_DOCUMENTATION : COMPACT_LOCALIZED_DOCUMENTATION[language];
  return template.replace('__ROADMAP_GUIDE__', roadmapGuide(language));
}

/** Alias for consumers that read localized documentation as a getter. */
export const getNodusDocumentation = buildNodusDocumentation;

export const NODUS_DOCUMENTATION_BY_LANGUAGE: Record<PromptLanguage, string> = {
  es: NODUS_DOCUMENTATION,
  en: buildNodusDocumentation('en'),
  fr: buildNodusDocumentation('fr'),
  de: buildNodusDocumentation('de'),
  pt: buildNodusDocumentation('pt'),
  'pt-BR': buildNodusDocumentation('pt-BR'),
  it: buildNodusDocumentation('it'),
  tr: buildNodusDocumentation('tr'),
  'zh-Hans': buildNodusDocumentation('zh-Hans'),
  'zh-Hant': buildNodusDocumentation('zh-Hant'),
  vi: buildNodusDocumentation('vi'),
  ja: buildNodusDocumentation('ja'),
  ru: buildNodusDocumentation('ru'),
  uk: buildNodusDocumentation('uk'),
  ko: buildNodusDocumentation('ko'),
};
