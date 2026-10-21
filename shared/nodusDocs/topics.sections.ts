import type { NodusDocTopic } from './types';

/** The working sections: what each one is for and the procedures inside it. */
export const SECTION_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'sections-home',
    area: 'sections',
    title: { es: 'Inicio: panel de mando y salud del corpus', en: 'Home: command panel and corpus health' },
    keywords: ['inicio', 'home', 'panel', 'siguiente paso', 'salud del corpus', 'estado', 'pendientes', 'analizar', 'indexar', 'que hago ahora'],
    body: {
      es: `- Inicio muestra el estado del corpus, los análisis pendientes y un «Siguiente paso recomendado» con la acción concreta que toca.
- El bloque «Salud del corpus» agrupa lo que falta por analizar, indexar o recuperar (buckets como «Sin texto», «Solo análisis ligero», «Prioritarias por analizar» y «Recuperar texto») y muestra «Todo en orden» cuando no hay nada pendiente.
- Cuando la bóveda está vacía, Inicio ofrece cargar los datos de demostración del tipo de bóveda.
- En cada tipo de bóveda Inicio cambia: la académica resume corpus y análisis; Genealogía resume personas, lugares, eventos, vínculos y archivo; Estudio resume cursos, asignaturas y materiales; Docencia añade grupos y evaluación; Bases de datos es un lanzador de bases; Testimonios es un tablero de entrevistas; Fuentes primarias resume unidades documentales y preservación; Prosopografía guía el método; Worldbuilding resume el mundo y sus fichas.`,
      en: `- Home shows corpus status, pending analyses and a "Recommended next step" with the concrete action to take.
- The "Corpus health" block groups what is missing analysis, indexing or recovery (buckets such as "No text", "Light analysis only", "Priority to analyse" and "Recover text") and shows "All clear" when nothing is pending.
- While the vault is empty, Home offers to load the demo data for that vault type.
- Home changes with the vault type: academic summarises corpus and analysis; Genealogy summarises people, places, events, links and archive; Study summarises courses, subjects and materials; Teaching adds groups and assessment; Databases is a database launcher; Testimonies is an interview board; Primary sources summarises documentary units and preservation; Prosopography guides the method; Worldbuilding summarises the world and its entries.`,
    },
    related: ['troubleshooting-corpus-status', 'sections-library'],
  },
  {
    id: 'sections-search',
    area: 'sections',
    title: { es: 'Buscar en el vault', en: 'Search inside the vault' },
    keywords: ['buscar', 'buscador', 'search', 'busqueda', 'encontrar', 'filtros', 'buscador del vault', 'buscar en todo', 'búsquedas guardadas'],
    body: {
      es: `- Buscar es una caja única sobre el contenido del vault: notas, ideas, obras, pasajes, huecos, temas y autores en la bóveda académica, y el vocabulario propio en cada tipo (en Genealogía, persona, evento, archivo, obra, pasaje y nota; en Bases de datos, bases y filas; en Worldbuilding, las clases de entrada del mundo).
- Admite filtros por tipo de resultado y búsqueda híbrida (léxica y semántica); los resultados abren el detalle en su modal o vista.
- En la bóveda académica se pueden guardar búsquedas para reutilizarlas.
- En Estudio busca fragmentos, páginas y momentos de audio, con panel de índice y filtros. En Testimonios busca pasajes y muestra hablante, minuto y condición de acceso.`,
      en: `- Search is a single box over vault content: notes, ideas, works, passages, gaps, topics and authors in an academic vault, and that type's own vocabulary elsewhere (People, events, archive, works, passages and notes in Genealogy; databases and rows in Databases; world entry kinds in Worldbuilding).
- It filters by result type and runs hybrid retrieval (lexical and semantic); results open their detail in a modal or a view.
- In an academic vault, searches can be saved for reuse.
- In Study it searches passages, pages and audio moments, with an index panel and filters. In Testimonies it searches excerpts and shows speaker, minute and access condition.`,
    },
    related: ['sections-library', 'sections-graph'],
  },
  {
    id: 'sections-library',
    area: 'sections',
    title: { es: 'Biblioteca y Zotero: añadir, analizar y leer', en: 'Library and Zotero: add, analyse and read' },
    keywords: ['biblioteca', 'library', 'zotero', 'añadir obra', 'importar', 'doi', 'isbn', 'analizar', 'reanalizar', 'colecciones', 'papelera', 'adjunto', 'pdf', 'epub', 'sincronizar', 'citas'],
    body: {
      es: `- La Biblioteca tiene dos ámbitos: Global y «Este vault».
- «Añadir» acepta archivos, DOI, ISBN, referencia manual y elementos de Zotero. También hay importación de bibliografía y colecciones y búsquedas inteligentes de Zotero.
- Analizar tiene dos niveles: ligero (temas, ideas y evidencias) y profundo (comprensión del documento, resumen, relaciones y pasajes citables). «Process all» lanza el análisis del conjunto y una obra ya analizada se puede re-analizar (por ejemplo, solo el abstract).
- La papelera de la biblioteca es recuperable: los elementos salen del catálogo activo y Nodus conserva una copia de recuperación local; nunca borra los análisis de los vaults.
- El lector de documento abre la obra y permite leer, anotar, citar y trabajar con pasajes; las citas se insertan con enlaces nodus:// en las respuestas del asistente.
- Zotero se configura en Ajustes > Biblioteca: modo de sincronización (Manual o Tiempo real), tag de lectura, ruta de storage y automatizaciones (analizar temas al sincronizar, analizar a fondo obras con tag, resumir tras análisis profundo, descubrir relaciones al vaciar la cola, reanudar cola al abrir).
- Requisitos y fallos: Nodus usa la API local de Zotero en modo solo lectura (Zotero 7 o posterior). Si Zotero no está abierto, las obras fallan con «Zotero no está disponible. Ábrelo y vuelve a analizar.» y hay que activar «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero» en los ajustes avanzados de Zotero.
- Si un adjunto es un PDF escaneado sin capa de texto, el análisis avisa y hay que activar OCR en Ajustes > Texto y OCR y volver a analizar. Si el adjunto no existe en su ubicación original, la app lo dice en el estado de la obra.`,
      en: `- The Library has two scopes: Global and "This vault".
- "Add" accepts files, DOI, ISBN, a manual reference and Zotero items. Bibliography import and Zotero collections and saved searches are also there.
- Analysis has two levels: light (topics, ideas and evidence) and deep (document understanding, summary, relations and citable passages). "Process all" starts the whole set, and an already-analysed work can be re-analysed (the abstract only, for instance).
- The library trash is recoverable: items leave the active catalogue while Nodus keeps a local recovery copy, and vault analyses are never deleted.
- The document reader opens the work to read, annotate, cite and work with passages; citations are inserted as nodus:// links in assistant answers.
- Zotero is configured in Settings > Library: sync mode (Manual or Real time), reading tag, storage path and automations (analyse topics on sync, deep-analyse works with a tag, summarise after deep analysis, discover relations when the queue empties, resume the queue on open).
- Requirements and failures: Nodus uses Zotero's local API read-only (Zotero 7 or later). If Zotero is not running, works fail with "Zotero is not available. Open it and analyse again." and "Allow other applications on this computer to communicate with Zotero" must be enabled in Zotero's advanced settings.
- If an attachment is a scanned PDF with no text layer, the analysis says so and OCR must be enabled in Settings > Text and OCR before analysing again. If the attachment is no longer in its original location, the app states it in the work status.`,
    },
    related: ['troubleshooting-zotero', 'troubleshooting-corpus-status', 'sections-deep-research'],
  },
  {
    id: 'sections-graph',
    area: 'sections',
    title: { es: 'Grafo, mapa de argumentos y relaciones', en: 'Graph, argument map and relations' },
    keywords: ['grafo', 'graph', 'mapa de argumentos', 'argument map', 'relaciones', 'aristas', 'tutor', 'temas', 'duplicados', 'auditoria', 'presets', 'nodos'],
    body: {
      es: `- Grafo representa ideas, temas y autores como una red navegable. La franja de investigación incluye Tutor, Temas, Ideas duplicadas y Auditoría de relaciones; el Tutor se abre en un panel lateral.
- Hay presets de grafo: panorama, contradicciones, huecos, lectura, no leídas y autores.
- El mapa de argumentos tiene dos superficies: el catálogo de recorridos y el mapa. Se construye en modo automático (conectividad, sin IA) o en modo IA (esquema de argumentos), con filtros por mínimo de conexiones y tipo de relación, vista «Mapa visual» o «Esquema», expandir y contraer ramas, y «Trazar mapa» desde una idea.
- La auditoría de relaciones y la fusión de duplicados sirven para mantener el grafo limpio; el tutorial avanzado las recorre.`,
      en: `- Graph shows ideas, topics and authors as a navigable network. The research strip includes Tutor, Topics, Duplicate ideas and Relation audit; the Tutor opens in a side panel.
- Graph presets: overview, contradictions, gaps, reading, unread and authors.
- The argument map has two surfaces: the route catalogue and the map. It builds in automatic mode (connectivity, no AI) or AI mode (argument scheme), with filters by minimum connections and relation type, a "Visual map" or "Scheme" view, expandable and collapsible branches, and "Trace map" from an idea.
- Relation audit and duplicate merging keep the graph clean; the advanced tour walks through both.`,
    },
    related: ['sections-ideas-authors', 'sections-search'],
  },
  {
    id: 'sections-ideas-authors',
    area: 'sections',
    title: { es: 'Ideas, Autores y evidencia', en: 'Ideas, Authors and evidence' },
    keywords: ['ideas', 'autores', 'authors', 'ficha de autor', 'tesis', 'postura', 'sintesis', 'evidencia', 'ocurrencias', 'conexiones', 'exportar seleccion', 'ideas duplicadas'],
    body: {
      es: `- Ideas es un catálogo paginado con búsqueda, filtro por tipo y orden. La ficha muestra la idea con su evidencia anclada, sus ocurrencias y sus conexiones, y permite eliminar la idea, abrirla en el grafo, ver el detalle completo o guardarla en notas.
- Autores es un catálogo con filtros y orden; la ficha de autor reúne tesis, ideas, obras, conexiones y etiquetas, y permite «Generar postura» y «Generar síntesis».
- La matriz de síntesis se filtra por autores con o sin síntesis y permite exportar la selección.
- Toda afirmación de la ficha se apoya en evidencias del corpus: la evidencia anclada es lo que sostiene la idea, y el asistente solo debe atribuir a un autor lo que el corpus sostiene.`,
      en: `- Ideas is a paged catalogue with search, type filter and ordering. An idea's record shows it with its anchored evidence, its occurrences and its connections, and lets you delete it, open it in the graph, see the full detail or save it to notes.
- Authors is a catalogue with filters and ordering; an author record gathers theses, ideas, works, connections and tags, and offers "Generate stance" and "Generate synthesis".
- The synthesis matrix filters authors with or without a synthesis and can export the selection.
- Every claim in a record rests on corpus evidence: anchored evidence is what supports an idea, and the assistant must only attribute to an author what the corpus supports.`,
    },
    related: ['sections-graph', 'sections-library'],
  },
  {
    id: 'sections-dictionary-immersion',
    area: 'sections',
    title: { es: 'Diccionario e Inmersión', en: 'Dictionary and Immersion' },
    keywords: ['diccionario', 'dictionary', 'conceptos', 'alias', 'cobertura', 'inmersion', 'immersion', 'feynman', 'examen final', 'dossier', 'aprender el corpus', 'imagen decorativa'],
    body: {
      es: `- Diccionario (solo bóveda académica) mantiene conceptos con alias, descripción en Markdown, búsqueda y actualización de evidencia, propuestas de actualización aceptables, cobertura y colecciones, además de editar o eliminar entradas.
- Inmersión genera un recorrido narrativo por pasos sobre el corpus e incluye «Comenzar inmersión», cierre Feynman, examen final, fronteras del corpus y contrastes.
- Inmersión admite una «Imagen decorativa» opcional, exporta a PDF y permite «Guardar dossier en notas».`,
      en: `- Dictionary (academic vaults only) keeps concepts with aliases, a Markdown description, evidence search and refresh, acceptable update proposals, coverage and collections, and can edit or delete entries.
- Immersion builds a step-by-step narrative walk over the corpus and includes "Start immersion", a Feynman closing, a final exam, corpus boundaries and contrasts.
- Immersion accepts an optional "Decorative image", exports to PDF and offers "Save dossier to notes".`,
    },
    related: ['vault-academic'],
  },
  {
    id: 'sections-coverage-gaps-debates',
    area: 'sections',
    title: { es: 'Estado de la cuestión: cobertura, debate y huecos', en: 'State of the art: coverage, debate and gaps' },
    keywords: ['estado de la cuestion', 'cobertura', 'coverage', 'debates', 'debate', 'huecos', 'gaps', 'subpreguntas', 'bandos', 'cronologia', 'sintesis'],
    body: {
      es: `- Estado de la cuestión es una sola vista con tres pestañas: Cobertura, Debates y Huecos. Huecos y Debates no tienen entrada propia en el menú.
- Cobertura descompone una pregunta de investigación en subpreguntas y marca cada una como cubierta, parcial o disputada.
- Debates muestra dos bandos con sus autores, evidencias y cronología, y permite generar una síntesis con IA.
- Huecos reúne lo que el corpus no responde y alimenta la Ruta de lectura y el Grafo de huecos.`,
      en: `- State of the art is one view with three tabs: Coverage, Debates and Gaps. Gaps and Debates have no menu entry of their own.
- Coverage breaks a research question into sub-questions and marks each as covered, partial or disputed.
- Debates shows two sides with their authors, evidence and chronology, and can generate an AI synthesis.
- Gaps gathers what the corpus does not answer and feeds the Reading path and the gaps graph.`,
    },
    related: ['sections-ideas-authors', 'vault-academic'],
  },
  {
    id: 'sections-hypothesis-reading-path',
    area: 'sections',
    title: { es: 'Laboratorio de hipótesis y Ruta de lectura', en: 'Hypothesis lab and Reading path' },
    keywords: ['hipotesis', 'hypothesis', 'laboratorio', 'variables', 'mecanismo', 'predicciones', 'testabilidad', 'ruta de lectura', 'reading path', 'plan de lectura', 'leida', 'por leer'],
    body: {
      es: `- Las dos secciones vienen ocultas de fábrica en la bóveda académica y se activan en Ajustes > Interfaz > Barra lateral.
- Hipótesis candidatas: cada una declara variables y mecanismo, métodos, predicciones, objeciones, próximos pasos, testabilidad, novedad, riesgo y soporte, y puede generar un dossier y una evaluación.
- Ruta de lectura produce un plan priorizado con justificaciones (hueco, base, actualización, conectividad), filtros —incluido incluir o excluir las ya leídas—, estados leída / por leer y un resumen de orientación.`,
      en: `- Both sections ship hidden in an academic vault and are enabled in Settings > Interface > Sidebar.
- Candidate hypotheses: each declares variables and mechanism, methods, predictions, objections, next steps, testability, novelty, risk and support, and can produce a dossier and an evaluation.
- Reading path produces a prioritised plan with justifications (gap, foundation, update, connectivity), filters —including whether to include works already read—, read / unread states and an orientation summary.`,
    },
    related: ['general-sidebar', 'vault-academic'],
  },
  {
    id: 'sections-deep-research',
    area: 'sections',
    title: { es: 'Deep Research: informes largos con evidencia', en: 'Deep Research: long, evidence-backed reports' },
    keywords: ['deep research', 'informe', 'informes', 'investigacion profunda', 'exportar', 'zip', 'cola', 'matriz de apoyo', 'leido', 'estructura', 'generar informe'],
    body: {
      es: `- Deep Research genera un informe largo a partir de la pregunta y de la evidencia del corpus o del archivo, y lo guarda en una galería de informes.
- La galería tiene vista de rejilla y lista, búsqueda, orden, filtro por estado leído, y acciones por informe: abrir con pestañas, exportar (descargar el informe o un ZIP de los seleccionados), eliminar y marcar leído o no leído.
- La generación puede encadenarse en cola; los informes muestran su estructura, una matriz de apoyo y, si se pide, una imagen decorativa.
- En Bases de datos existe un Deep Research propio; en Estudio y Docencia genera guías y unidades citando los materiales; en Genealogía trabaja sobre el archivo indexado y la biblioteca.
- Cada afirmación del informe se apoya en evidencia del corpus y el asistente no debe presentar como documentado nada que el corpus no sostenga.`,
      en: `- Deep Research produces a long report from the question and the corpus or archive evidence, and keeps it in a report gallery.
- The gallery has grid and list views, search, ordering, a read filter, and per-report actions: open with tabs, export (download the report or a ZIP of the selected ones), delete and mark read or unread.
- Generation can be queued; reports show their structure, a support matrix and, on request, a decorative image.
- Databases has its own Deep Research; in Study and Teaching it produces guides and units citing the materials; in Genealogy it works over the indexed archive and the library.
- Every claim in a report rests on corpus evidence, and the assistant must never present as documented anything the corpus does not support.`,
    },
    related: ['sections-library', 'vault-databases'],
  },
  {
    id: 'sections-workspace-notes',
    area: 'sections',
    title: { es: 'Nodus Scriptor', en: 'Nodus Scriptor' },
    keywords: ['nodus scriptor', 'nodus tools', 'espacio de trabajo', 'workspace', 'notas', 'notes', 'colecciones', 'editor', 'etiquetas', 'papelera', 'duplicar nota', 'enlazar biblioteca', 'nota', 'escuchar', 'leer en voz alta', 'read aloud'],
    body: {
      es: `- Nodus Scriptor organiza colecciones que contienen notas e ideas, con el mismo editor que usan Estudio y Docencia.
- Acciones: crear nota o idea, buscar, etiquetar y filtrar por etiquetas, mover a colección, duplicar, enviar a la papelera, restaurar, eliminar definitivamente, enlazar con la biblioteca, abrir en pestaña, copiar el título y ver el panel de detalles.
- Se abre desde Nodus Tools o su acceso fijado en Herramientas, en todos los tipos de bóveda. Puedes ocultar el acceso manualmente; las rutas antiguas siguen funcionando. El lienzo editorial usa un fondo blanco y formato contextual por bloques.
- En Testimonios, las notas enlazan de vuelta al minuto exacto del fragmento; en Fuentes primarias, al documento y su evidencia.
- «Escuchar», en la cabecera del editor, narra el documento con la voz local y guarda el audio un día salvo que lo conserves. El icono de altavoz de la barra de selección lee el texto seleccionado al momento y no guarda nada.`,
      en: `- Nodus Scriptor organises collections that hold notes and ideas, with the same editor Study and Teaching use.
- Actions: create a note or an idea, search, tag and filter by tag, move to a collection, duplicate, send to trash, restore, delete permanently, link to the library, open in a tab, copy the title and open the details panel.
- Open it from Nodus Tools or its pinned shortcut under Tools, in every vault type. You can hide the shortcut manually; old routes still work. The editorial canvas uses a white background and contextual block formatting.
- In Testimonies, notes link back to the exact minute of the excerpt; in Primary sources, to the document and its evidence.
- «Escuchar» (Listen) in the editor header narrates the document with the local voice and keeps the audio for one day unless you keep it. The speaker icon in the selection toolbar reads the selected text at once and saves nothing.`,
    },
    related: ['sections-search'],
  },
  {
    id: 'sections-genealogy-records',
    area: 'sections',
    title: { es: 'Genealogía: personas, árbol, relaciones y archivo', en: 'Genealogy: people, tree, relations and archive' },
    keywords: ['personas', 'arbol genealogico', 'tree', 'linea temporal', 'timeline', 'relaciones sociales', 'mapa', 'archivo', 'archive', 'gedcom', 'parentesco sugerido', 'retratos', 'biografia'],
    body: {
      es: `- Personas: importar y exportar GEDCOM (Gramps, Ancestry); revisar parentescos sugeridos por IA uno a uno o en bloque (confirmar o descartar); crear una persona con su relación inicial; biografía factual y retratos.
- Línea temporal: eventos ordenados, incluidas fechas inciertas, con filtros por persona y por tipo.
- Árbol genealógico: generaciones, recentrado con doble clic, búsqueda de persona, colores y visibilidad de las ramas paterna y materna, leyenda de líneas y ficha lateral.
- Relaciones sociales: segunda red independiente del árbol (amistad, patronazgo, empleo, rivalidad, correspondencia). Es una superficie de lectura: las relaciones se crean desde la ficha de persona.
- Mapa: lugares de las personas, filtro por una o varias personas, deslizador cronológico, rutas migratorias y mapa base que se autoajusta.
- Archivo: rejilla de documentos con esquema fijo; importa fotos, CSV, XLSX y escaneos; extrae texto; indexa semánticamente el archivo; extrae personas y eventos; vincula coincidencias al árbol; y permite sustituir adjuntos con reextracción.
- Regla de método: ningún parentesco se da por bueno sin registro o evidencia.`,
      en: `- People: import and export GEDCOM (Gramps, Ancestry); review AI-suggested kinships one by one or in bulk (confirm or discard); create a person with an initial relation; factual biography and portraits.
- Timeline: ordered events, uncertain dates included, with filters by person and type.
- Family tree: generations, recentring on double-click, person search, colours and visibility for the paternal and maternal branches, a line legend and a side record.
- Social relations: a second network independent from the tree (friendship, patronage, employment, rivalry, correspondence). It is a reading surface: relations are created from a person's record.
- Map: people's places, a filter for one or several people, a chronological slider, migration routes and a self-fitting base map.
- Archive: a document grid with a fixed schema; imports photos, CSV, XLSX and scans; extracts text; indexes the archive semantically; extracts people and events; links matches to the tree; and can replace attachments with re-extraction.
- Method rule: no kinship is accepted without a record or evidence.`,
    },
    related: ['vault-genealogy', 'troubleshooting-corpus-status'],
  },
  {
    id: 'sections-primary-sources-archive',
    area: 'sections',
    title: { es: 'Fuentes primarias: Archivo, ingesta y vistas', en: 'Primary sources: Archive, ingest and views' },
    keywords: ['archivo', 'archive', 'ingesta', 'repositorio', 'sesion de captura', 'signatura', 'tabla galeria jerarquia', 'anadir fuente', 'catalogo', 'preservacion', 'master', 'derivado'],
    body: {
      es: `- Archivo organiza los documentos por ubicación archivística o por colecciones de trabajo, con tres modos de vista: Tabla, Galería y Jerarquía. El panel lateral del árbol se puede ocultar y volver a mostrar.
- Para añadir documentos: Archivo > «Añadir fuente». La tabla muestra metadatos catalográficos y una miniatura cuando existe imagen.
- La ingesta permite crear repositorios y sesiones de captura, clasificar en el momento de importar y conservar la procedencia (repositorio, signatura, unidad padre, sesión y hash del máster). El máster es inmutable: el trabajo se hace sobre derivados, OCR y transcripciones versionadas.
- Al pulsar una fila se abre el dossier del documento en un modal. Todo resultado automático es una propuesta que se acepta o se rechaza antes de convertirse en un hecho.
- Inicio resume unidades documentales, másteres preservados, fuentes listas para citar, personas, eventos y lugares, además de las tareas que requieren atención y las capas de investigación (contenido de la fuente, observación estructurada e interpretación).`,
      en: `- Archive organises documents by archival location or by working collections, with three view modes: Table, Gallery and Hierarchy. The tree side panel can be hidden and shown again.
- To add documents: Archive > "Add source". The table shows catalogue metadata and a thumbnail when an image exists.
- Ingest lets you create repositories and capture sessions, classify during import and preserve provenance (repository, shelfmark, parent unit, session and master hash). The master is immutable: work happens on derivatives, OCR and versioned transcriptions.
- Clicking a row opens the document dossier in a modal. Every automatic output is a proposal to accept or reject before it becomes a fact.
- Home summarises documentary units, preserved masters, sources ready to cite, people, events and places, plus the tasks needing attention and the research layers (source content, structured observation and interpretation).`,
    },
    related: ['sections-primary-sources-dossier', 'vault-primary-sources'],
  },
  {
    id: 'sections-primary-sources-dossier',
    area: 'sections',
    title: { es: 'Fuentes primarias: el dossier de una fuente', en: 'Primary sources: a source dossier' },
    keywords: ['dossier', 'fuente', 'descripcion', 'texto', 'evidencia', 'analisis', 'notas', 'historial', 'pestanas', 'procedencia', 'tipo documental', 'localizador'],
    body: {
      es: `- El dossier tiene siete pestañas: Fuente, Descripción, Texto, Evidencia, Análisis, Notas e Historial.
- En Fuente se consultan y editan los datos catalográficos y se elige el tipo documental: Nodus sugiere un icono o tipo según la fuente, pero la decisión es editable.
- La procedencia se elige en el documento con un desplegable conectado a los lugares disponibles en el mapa; el mapa representa esa procedencia asignada, no todas las ciudades mencionadas en el texto.
- Texto y Evidencia recogen la transcripción, los localizadores y las propuestas aceptadas; cada evidencia conserva su localización exacta.
- Historial conserva las versiones y los cambios, de modo que una conclusión siempre puede volver a su evidencia.`,
      en: `- The dossier has seven tabs: Source, Description, Text, Evidence, Analysis, Notes and History.
- Source holds the catalogue data and the documentary type: Nodus suggests an icon or type from the source itself, but the decision stays editable.
- Provenance is chosen inside the document from a dropdown connected to the places available on the map; the map shows that assigned provenance, not every city mentioned in the text.
- Text and Evidence gather the transcription, the locators and the accepted proposals; every piece of evidence keeps its exact location.
- History keeps the versions and changes, so a conclusion can always be traced back to its evidence.`,
    },
    related: ['sections-primary-sources-archive', 'settings-models-advanced'],
  },
  {
    id: 'sections-testimonies-interviews',
    area: 'sections',
    title: { es: 'Testimonios: entrevistas y su dossier', en: 'Testimonies: interviews and their dossier' },
    keywords: ['entrevistas', 'interviews', 'dossier', 'sesiones', 'transcripcion', 'fragmentos', 'codigos', 'anotaciones', 'acuerdo', 'embargo', 'version', 'narrador', 'grabacion'],
    body: {
      es: `- Entrevistas trae vistas guardadas de fábrica (Todas, Próximas, Pendientes de transcripción, En revisión, Pendientes del narrador, Completadas y Con restricciones) con filtros y orden.
- El dossier de una entrevista tiene las pestañas Resumen, Sesiones y transcripción, Análisis, Notas y Acuerdo y acceso. Ahí viven las sesiones, los medios, las transcripciones, los fragmentos, los códigos, las anotaciones, los acuerdos y las restricciones.
- El original nunca se corrige: corregir, revisar, anonimizar o traducir crea una versión nueva, y cada fragmento guarda texto, minuto y versión.
- Para empezar: crear la entrevista, registrar participantes y acuerdos, añadir una sesión o un medio y preparar o importar la transcripción; después codificar y anotar sobre fragmentos.
- El acuerdo y el acceso deciden qué material puede salir: Nodi respeta acceso, anonimización, embargo y atribución.`,
      en: `- Interviews ships with saved views (All, Upcoming, Awaiting transcription, In review, Awaiting narrator, Completed, With restrictions) plus filters and ordering.
- An interview dossier has the tabs Summary, Sessions and transcription, Analysis, Notes and Agreement and access. Sessions, media, transcriptions, excerpts, codes, annotations, agreements and restrictions live there.
- The original is never corrected: correcting, reviewing, anonymising or translating creates a new version, and each excerpt keeps text, minute and version.
- To start: create the interview, record participants and agreements, add a session or a medium and prepare or import the transcription; then code and annotate over excerpts.
- The agreement and access decide what material may leave: Nodi respects access, anonymisation, embargo and attribution.`,
    },
    related: ['sections-testimonies-contrasts', 'vault-testimonios'],
  },
  {
    id: 'sections-testimonies-contrasts',
    area: 'sections',
    title: { es: 'Testimonios: Contrastes', en: 'Testimonies: Contrasts' },
    keywords: ['contrastes', 'contrasts', 'paralelo', 'matriz', 'silencios', 'comparar entrevistas', 'codigos', 'fragmentos', 'llevar a notas'],
    body: {
      es: `- Contrastes compara lo que dicen varias entrevistas: se eligen entrevistas y códigos y se elige el modo paralelo o matriz.
- Muestra los silencios (lo que no aparece) y los fragmentos con narrador y minuto, para poder volver al audio.
- Permite guardar el contraste y llevarlo a Notas con sus referencias.`,
      en: `- Contrasts compares what several interviews say: pick interviews and codes, then choose parallel or matrix mode.
- It shows the silences (what never appears) and the excerpts with narrator and minute, so the audio can be revisited.
- A contrast can be saved and sent to Notes with its references.`,
    },
    related: ['sections-testimonies-interviews'],
  },
  {
    id: 'sections-prosop-population',
    area: 'sections',
    title: { es: 'Prosopografía: Población, criterios y cohortes', en: 'Prosopography: Population, criteria and cohorts' },
    keywords: ['poblacion', 'population', 'criterios', 'cuestionario', 'vocabularios', 'cohortes', 'cobertura', 'inclusion', 'exclusion', 'peso', 'versionado'],
    body: {
      es: `- Población reúne seis pestañas: Estudio, Criterios, Cuestionario, Vocabularios, Cohortes y Cobertura.
- Estudio define y versiona la metodología de población; Criterios declara reglas de inclusión, exclusión o apoyo, con peso y marca de obligatorio.
- Los pesos nunca incluyen a nadie automáticamente: la pertenencia siempre se decide de forma explícita.
- Cuestionario define variables versionadas; Vocabularios mantiene los valores controlados; Cohortes congela conjuntos de personas; Cobertura muestra qué queda fuera y con qué evidencia.`,
      en: `- Population gathers six tabs: Study, Criteria, Questionnaire, Vocabularies, Cohorts and Coverage.
- Study defines and versions the population methodology; Criteria declares inclusion, exclusion or support rules with weight and a mandatory flag.
- Weights never include anyone automatically: membership is always an explicit decision.
- Questionnaire defines versioned variables; Vocabularies keeps the controlled values; Cohorts freezes sets of people; Coverage shows what falls outside and on what evidence.`,
    },
    related: ['sections-prosop-sources', 'vault-prosopography'],
  },
  {
    id: 'sections-prosop-sources',
    area: 'sections',
    title: { es: 'Prosopografía: Fuentes, menciones y statements', en: 'Prosopography: Sources, mentions and statements' },
    keywords: ['fuentes', 'sources', 'catalogo', 'lotes', 'plantillas', 'observaciones', 'segmentos citables', 'importar csv', 'staging', 'factoid', 'statement', 'menciones'],
    body: {
      es: `- Fuentes tiene cuatro pestañas: Catálogo, Lotes, Plantillas y Observaciones.
- El dossier de una fuente declara cita, cobertura, fiabilidad y acceso, y guarda segmentos citables con su localizador.
- Las plantillas de vaciado sirven para capturar de forma homogénea; la importación CSV o TSV entra en un área de trabajo (staging) donde cada fila se acepta o se rechaza antes de crear nada.
- De las menciones se derivan factoids y statements atómicos: cada uno declara su fuente y su localizador. No se confunde una mención con una persona, ni un factoid con un hecho.`,
      en: `- Sources has four tabs: Catalogue, Batches, Templates and Observations.
- A source dossier declares citation, coverage, reliability and access, and keeps citable segments with their locator.
- Data-entry templates keep capture homogeneous; CSV or TSV import lands in a staging area where each row is accepted or rejected before anything is created.
- Mentions yield factoids and atomic statements: each declares its source and its locator. A mention is never a person, and a factoid is never a fact.`,
    },
    related: ['sections-prosop-population', 'vault-prosopography'],
  },
  {
    id: 'sections-prosop-analysis',
    area: 'sections',
    title: { es: 'Prosopografía: Personas, Análisis y Redes', en: 'Prosopography: People, Analysis and Networks' },
    keywords: ['personas', 'identidad', 'individualizar', 'candidatos', 'analisis', 'frecuencia', 'cronologia', 'trayectorias', 'mapa', 'denominador', 'redes', 'copresencia', 'hipotesis', 'metricas'],
    body: {
      es: `- Personas parte de una regla: una mención no es una persona. Se comparan candidatos, se documenta la decisión y se elige entre vincular, dejar sin resolver o crear una persona nueva. Registra nombres documentados, autoridades y organizaciones.
- Análisis ofrece los tipos Frecuencia, Cronología, Trayectorias y Mapa. Cada resultado declara población, denominador, ausencias y huella de entrada, y trae un panel de casos para inspeccionar los datos.
- Redes trabaja por capas con color: deriva copresencia cuando procede y mantiene separadas las relaciones explícitas, las derivadas y las hipótesis. Muestra métricas (nodos, aristas, densidad) y una tabla de aristas con su evidencia.
- Ninguna fusión de identidades ni conversión de observación en hecho ocurre sin revisión humana.`,
      en: `- People starts from one rule: a mention is not a person. Candidates are compared, the decision is documented, and the choice is link, leave unresolved or create a new person. It records documented names, authorities and organisations.
- Analysis offers Frequency, Chronology, Trajectories and Map. Every result declares population, denominator, absences and input fingerprint, and brings a case panel to inspect the data.
- Networks works in coloured layers: it derives co-presence when appropriate and keeps explicit, derived and hypothesised relations apart. It shows metrics (nodes, edges, density) and an edge table with its evidence.
- No identity merge and no observation-to-fact conversion happens without human review.`,
    },
    related: ['sections-prosop-sources', 'vault-prosopography'],
  },
  {
    id: 'sections-databases-table',
    area: 'sections',
    title: { es: 'Bases de datos: la tabla, columnas y vistas', en: 'Databases: the table, columns and views' },
    keywords: ['tabla', 'table', 'columna', 'tipos', 'fila', 'vistas', 'tablero', 'galeria', 'calendario', 'grafico', 'panel', 'feed', 'mapa', 'cronologia', 'lista', 'relaciones', 'formulas', 'automatizaciones', 'editar celda'],
    body: {
      es: `- La tabla se abre pulsando una base de datos en la barra lateral (no es una entrada de menú propia).
- Columnas tipadas: título, texto, número, fecha, hora, selección, selección múltiple y casilla. La edición se hace en la propia celda.
- Vistas: tabla, tablero, galería, calendario, gráfico, panel, feed, mapa, cronología y lista. Cada vista conserva sus propios ajustes.
- Admite relaciones entre bases y fórmulas, y automatizaciones sobre los datos.
- La importación de Notion y de CSV está en Inicio; con muchos archivos puede tardar horas y conviene adjuntarlos y procesarlos después.`,
      en: `- The table opens by clicking a database in the sidebar (it is not a menu entry of its own).
- Typed columns: title, text, number, date, time, select, multi-select and checkbox. Editing happens in the cell.
- Views: table, board, gallery, calendar, chart, dashboard, feed, map, timeline and list. Each view keeps its own settings.
- It supports relations between databases and formulas, plus automations over the data.
- Notion and CSV import live on Home; with many files it can take hours, so attaching now and processing later is the better path.`,
    },
    related: ['sections-databases-pages', 'vault-databases'],
  },
  {
    id: 'sections-databases-pages',
    area: 'sections',
    title: { es: 'Bases de datos: Páginas', en: 'Databases: Pages' },
    keywords: ['paginas', 'pages', 'wiki', 'arbol de paginas', 'editor de bloques', 'comentarios', 'historial', 'revisiones', 'portada', 'acceso'],
    body: {
      es: `- Páginas es una wiki con árbol de páginas arrastrable y editor de bloques.
- Cada página admite comentarios, panel de acceso, historial de revisiones y portada.
- Las páginas conviven con las bases: la barra lateral muestra «Páginas» y debajo la lista de bases de datos.`,
      en: `- Pages is a wiki with a draggable page tree and a block editor.
- Each page supports comments, an access panel, revision history and a cover.
- Pages live beside databases: the sidebar shows "Pages" and the list of databases below it.`,
    },
    related: ['sections-databases-table'],
  },
  {
    id: 'sections-databases-analysis',
    area: 'sections',
    title: { es: 'Bases de datos: Análisis y chat de datos', en: 'Databases: Analysis and data chat' },
    keywords: ['analisis', 'analysis', 'perfiles', 'distribucion', 'media', 'rangos', 'graficos', 'chat de datos', 'data chat', 'preguntas', 'conversaciones', 'atipicos'],
    body: {
      es: `- Análisis perfila las columnas (relleno, media, distribución y rangos), dibuja gráficos y ofrece una lectura con IA.
- El chat de datos permite elegir una o varias bases y responde con gráficos nativos; los prompts de arranque cubren resumen, distribución, valores atípicos y comparación de grupos, y las conversaciones se guardan.
- Ambos exigen un modelo de IA configurado; sin él, las acciones avisan en lugar de ejecutarse.`,
      en: `- Analysis profiles the columns (fill, mean, distribution and ranges), draws charts and offers an AI reading.
- The data chat takes one or several databases and answers with native charts; starter prompts cover summary, distribution, outliers and group comparison, and conversations are saved.
- Both need a configured AI model; without one the actions warn instead of running.`,
    },
    related: ['sections-databases-table', 'vault-databases'],
  },
  {
    id: 'sections-study-organization',
    area: 'sections',
    title: { es: 'Estudio: organización, horarios y calendario', en: 'Study: organisation, schedule and calendar' },
    keywords: ['curso', 'asignatura', 'organizacion', 'jerarquia', 'tema', 'subtema', 'horario', 'horarios', 'calendario', 'eventos', 'recordatorios', 'ical', 'outlook', 'apple calendar', 'icloud', 'google calendar'],
    body: {
      es: `- Cursos y asignaturas es el punto de partida: se crean cursos, asignaturas, carpetas, temas, subtemas y documentos, con editor y saltos a materiales y grabaciones.
- Horarios dibuja una rejilla de días y franjas; las actividades se colorean por asignatura y el horario se puede copiar. Al pulsar una celda se añade una asignatura existente o una actividad independiente.
- Calendario ofrece vistas mensual, semanal y anual, editor de eventos con recordatorios locales, exportación a Outlook (.ics) o Google Calendar y, en macOS, sincronización automática con el calendario de Apple que elijas mientras Nodus está abierto.
- En Docencia, esta misma organización añade Grupos por asignatura y curso académico, con importación de alumnado desde otro grupo.`,
      en: `- Courses and subjects is the starting point: create courses, subjects, folders, topics, subtopics and documents, with an editor and jumps to materials and recordings.
- Schedule draws a day-and-slot grid; activities are coloured per subject and the timetable can be copied. Clicking a cell adds an existing subject or a standalone activity.
- Calendar offers month, week and year views, an event editor with local reminders, export to Outlook (.ics) or Google Calendar and, on macOS, automatic sync with the Apple calendar you choose while Nodus is open.
- In Teaching, the same organisation adds Groups per subject and academic year, with student import from another group.`,
    },
    related: ['vault-estudio', 'sections-study-materials-recordings'],
  },
  {
    id: 'sections-study-materials-recordings',
    area: 'sections',
    title: { es: 'Estudio: materiales y grabaciones', en: 'Study: materials and recordings' },
    keywords: ['materiales', 'materials', 'importar apuntes', 'visor', 'notas de material', 'grabaciones', 'recordings', 'audio', 'transcribir', 'diarizar', 'nota enlazada', 'papelera', 'dropzone'],
    body: {
      es: `- Materiales importa archivos (PDF, documentos, presentaciones y audio; también desde Zotero), con zona de arrastre, visor, notas de material, buscador y borrado de la selección.
- Grabaciones permite grabar o importar audio, transcribirlo, aplicar diarización, generar notas y una nota enlazada, elegir idioma y vaciar la papelera.
- La transcripción se configura en Ajustes > Modelos IA: motor local (Transformers.js + ONNX o whisper.cpp) o la API de OpenAI. El motor local es el valor por defecto.
- Con un modelo local de conversación, la concurrencia se bloquea a 1 en las herramientas de IA como OCR para no competir por el mismo equipo.`,
      en: `- Materials imports files (PDFs, documents, presentations and audio; also from Zotero), with a drop zone, viewer, material notes, search and selection delete.
- Recordings records or imports audio, transcribes it, applies diarisation, generates notes and a linked note, chooses the language and empties the trash.
- Transcription is configured in Settings > AI models: local engine (Transformers.js + ONNX or whisper.cpp) or the OpenAI API. The local engine is the default.
- With a local conversational model, concurrency is pinned to 1 in AI tools such as OCR so they do not compete for the same machine.`,
    },
    related: ['vault-estudio', 'troubleshooting-local-ai'],
  },
  {
    id: 'sections-study-bank-review',
    area: 'sections',
    title: { es: 'Estudio: banco de preguntas y revisión', en: 'Study: question bank and review' },
    keywords: ['banco de preguntas', 'question bank', 'preguntas', 'tests', 'examenes', 'flashcards', 'importar', 'exportar', 'generar con ia', 'nivel cognitivo', 'repaso', 'revision', 'sesion'],
    body: {
      es: `- Banco de preguntas tiene dos pestañas: Preguntas y Flashcards. Una flashcard se abre en su modal específico.
- Acciones: importar y exportar, generar con IA, crear pregunta o flashcard, filtrar por categoría, tema, fuente, material y etiqueta, buscar en modo literal o híbrido, editar con nivel cognitivo y seleccionar varias para acciones en bloque (estado, dificultad, mover, crear flashcards, exportar).
- Revisión monta una sesión en tres pasos: modo (Test, Examen o Flashcards), asignatura, tema o grupo guardado, y contenido (existente o nuevo generado con IA) con el número de elementos. Al terminar muestra «Revisión completada».
- Generar preguntas y montar la sesión requieren un modelo de IA configurado.`,
      en: `- Question bank has two tabs: Questions and Flashcards. A flashcard opens in its own modal.
- Actions: import and export, generate with AI, create a question or a flashcard, filter by category, topic, source, material and tag, search literally or hybrid, edit with a cognitive level, and multi-select for bulk actions (state, difficulty, move, create flashcards, export).
- Review builds a session in three steps: mode (Test, Exam or Flashcards), subject, topic or saved group, and content (existing or newly AI-generated) with the number of items. It ends with "Review complete".
- Generating questions and building the session need a configured AI model.`,
    },
    related: ['vault-estudio', 'sections-teaching-exams-rubrics'],
  },
  {
    id: 'sections-teaching-groups-grades',
    area: 'sections',
    title: { es: 'Docencia: grupos y calificaciones', en: 'Teaching: groups and grades' },
    keywords: ['grupos', 'groups', 'alumnado', 'importar alumnado', 'privacidad', 'calificaciones', 'grades', 'cuaderno', 'plan de evaluacion', 'convocatoria', 'explicacion', 'exportar notas'],
    body: {
      es: `- Grupos lista los grupos con filtros por asignatura y curso, permite crear un grupo, importar alumnado de otro grupo, ver la tabla, abrir el detalle y cambiar su privacidad. Un grupo pertenece a una asignatura y a un curso académico.
- Calificaciones es una rejilla por grupo y convocatoria con exportación y análisis (distribución, convención e ítems) y un modal de explicación con descarga.
- El cuaderno se basa en el plan de evaluación congelado al publicar: una revisión crea una versión nueva y la nota es una proyección de valor y estado.
- Privacidad: la IA no recibe listas, notas ni respuestas del alumnado y no existen funciones de IA para calificar, perfilar o evaluar. En Ajustes > Modelos IA esta política aparece como «Bloqueado por diseño».`,
      en: `- Groups lists the groups with filters by subject and year, creates a group, imports students from another group, shows the table, opens the detail and toggles its privacy. A group belongs to a subject and an academic year.
- Grades is a grid per group and exam session with export and analysis (distribution, convention and items) and an explanation modal that can be downloaded.
- The gradebook is built on the assessment plan frozen when published: a revision creates a new version and the mark is a projection of value and state.
- Privacy: the AI never receives student lists, notes or answers, and no AI feature grades, profiles or assesses. In Settings > AI models this policy shows as "Locked by design".`,
    },
    related: ['vault-docencia', 'sections-teaching-exams-rubrics'],
  },
  {
    id: 'sections-teaching-exams-rubrics',
    area: 'sections',
    title: { es: 'Docencia: exámenes, rúbricas y diseño de unidades', en: 'Teaching: exams, rubrics and unit design' },
    keywords: ['examen', 'exam', 'imprimible', 'docx', 'pdf', 'rubrica', 'rubric', 'criterios', 'niveles', 'pesos', 'generador', 'unidad didactica', 'diseno de unidades', 'programacion'],
    body: {
      es: `- Exámenes construye un documento imprimible: cabecera, logos, tipos de pregunta y secciones enumeradas, con previsualización y exportación a DOCX o PDF, usando el banco de preguntas.
- Rúbricas permite crear criterios y niveles, con pesos por criterio que deben sumar 100 y avisos de calidad; incluye un generador con IA a partir de un material o de una descripción, previsualización y exportación a PDF.
- Diseño de unidades es un Deep Research con estructura fijable por el docente que cita los materiales del curso.
- Guía docente / Programación, Situaciones de aprendizaje, Adaptaciones y Proyectos de innovación están «En diseño»: abren su hilo de feedback y no deben presentarse como funciones terminadas.`,
      en: `- Exams builds a printable document: header, logos, question types and numbered sections, with preview and export to DOCX or PDF, drawing on the question bank.
- Rubrics creates criteria and levels, with per-criterion weights that must add up to 100 and quality warnings; it includes an AI generator from a material or a description, a preview and PDF export.
- Unit design is a Deep Research whose structure the teacher can fix, citing the course materials.
- Teaching guide / Syllabus, Learning situations, Adaptations and Innovation projects are "In design": they open their feedback thread and must not be presented as finished features.`,
    },
    related: ['sections-teaching-groups-grades', 'sections-study-bank-review'],
  },
  {
    id: 'sections-world-encyclopedia',
    area: 'sections',
    title: { es: 'Worldbuilding: Enciclopedia y búsqueda del mundo', en: 'Worldbuilding: Encyclopedia and world search' },
    keywords: ['enciclopedia', 'encyclopedia', 'indice', 'world bible', 'exportar', 'dobles corchetes', 'sin desarrollar', 'facetas', 'entradas ausentes', 'lector de entradas', 'buscar en el mundo'],
    body: {
      es: `- La Enciclopedia es el índice A-Z de todo el mundo: artículos nativos editables más proyecciones de lectura del resto de secciones.
- Tiene facetas, búsqueda «Buscar en todo el mundo…», marca de entradas «sin desarrollar», panel de entradas ausentes, exportación de la «world bible» y un lector de entradas.
- Los enlaces entre entradas se escriben con dobles corchetes y el lector los resuelve.
- Buscar en esta bóveda recorre las mismas clases de entrada del mundo y abre el lector.`,
      en: `- The Encyclopedia is the world's A-Z index: native editable articles plus reading projections from the other sections.
- It has facets, a "Search the whole world…" box, an "undeveloped" mark, a missing-entries panel, world-bible export and an entry reader.
- Links between entries are written with double brackets and the reader resolves them.
- Search in this vault walks the same world entry kinds and opens the reader.`,
    },
    related: ['vault-worldbuilding', 'sections-world-analysis'],
  },
  {
    id: 'sections-world-analysis',
    area: 'sections',
    title: { es: 'Worldbuilding: reglas, conflictos, arcos, continuidad y preguntas', en: 'Worldbuilding: rules, conflicts, arcs, continuity and questions' },
    keywords: ['reglas del mundo', 'rules', 'conflictos', 'conflicts', 'arcos narrativos', 'arcs', 'continuidad', 'continuity', 'preguntas abiertas', 'open questions', 'canon', 'excepciones', 'bloqueos'],
    body: {
      es: `- Reglas del mundo: cada regla declara enunciado, precio y límites; las excepciones se convierten en reglas propias al borrarlas, y admite pruebas, ámbito y propuestas.
- Conflictos: tablero y filas con partes, beats, sugerencias y huecos; se puede crear desde una escena y borrar un conflicto no elimina personajes ni escenas.
- Arcos narrativos: carriles, densidad, orden de cierre, tramos que no mueven nada y una hoja de hitos copiable.
- Continuidad: hallazgos, puntos ciegos, excepciones aceptadas y silenciadas, y recálculo de días desde la cadena temporal.
- Preguntas abiertas: opciones, aplicar y deshacer, «No puedo seguir sin esto», bloqueos de escena, evidencia, palanca, huecos restantes y propuesta con IA.
- El autor es la fuente de verdad: Nodi distingue lo establecido de lo propuesto y no inventa canon.`,
      en: `- World rules: every rule declares statement, price and limits; exceptions become rules of their own when deleted, and it accepts proofs, scope and proposals.
- Conflicts: a board and rows with sides, beats, suggestions and gaps; one can be created from a scene, and deleting a conflict removes neither characters nor scenes.
- Story arcs: lanes, density, closure order, stretches that move nothing, and a copyable milestone sheet.
- Continuity: findings, blind spots, accepted and silenced exceptions, and day recounts from the timeline chain.
- Open questions: options, apply and undo, "I cannot continue without this", scene blockers, evidence, leverage, remaining gaps and an AI proposal.
- The author is the source of truth: Nodi separates what is established from what is proposed and never invents canon.`,
    },
    related: ['sections-world-scenes-manuscript', 'vault-worldbuilding'],
  },
  {
    id: 'sections-world-scenes-manuscript',
    area: 'sections',
    title: { es: 'Worldbuilding: escenas y manuscrito', en: 'Worldbuilding: scenes and manuscript' },
    keywords: ['escenas', 'scenes', 'reparto', 'resumen', 'escribir', 'manuscrito', 'manuscript', 'capitulos', 'orden de relato', 'compilar', 'progreso', 'repaso'],
    body: {
      es: `- Escenas reúne reparto, resumen y escritura de cada escena; el reparto conecta la escena con los personajes y lugares del mundo.
- Manuscrito ordena las escenas en orden de relato (no cronológico), con capítulos, progreso, repaso y compilación.
- Ambos trabajan sobre las fichas canónicas: una escena puede crear conflictos y alimentar continuidad y arcos.`,
      en: `- Scenes gathers the cast, the summary and the writing of each scene; the cast links the scene to the world's characters and places.
- Manuscript orders scenes in narrative order (not chronological), with chapters, progress, review and compilation.
- Both work on the canonical entries: a scene can create conflicts and feed continuity and arcs.`,
    },
    related: ['sections-world-analysis', 'sections-world-encyclopedia'],
  },
];
