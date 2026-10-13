import type { NodusDocTopic } from './types';

/** Nodus Toolkit: the hub and each tool with its requirements and limits. */
export const TOOL_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'toolkit-focus', area: 'tools',
    title: { es: 'Nodus Focus: concentración entre bóvedas', en: 'Nodus Focus: focus across vaults' },
    keywords: ['focus', 'concentración', 'temporizador', 'pomodoro', 'sesión', 'bóveda', 'historial'],
    body: {
      es: `- Nodus Focus aparece en Nodus Tools y en Herramientas por defecto. También puedes abrir el temporizador desde la cabecera o la paleta de comandos.
- Iniciar o reanudar un bloque de trabajo activa el modo concentración. Si desmarcas la casilla, se recuerda tu elección en todas las bóvedas.
- Cambiar de bóveda conserva la sesión y el temporizador en marcha; el panel se adapta a las secciones y la personalización de la nueva bóveda. Estudio y Docencia mantienen sus asignaturas, apuntes y materiales.
- El historial es global y muestra cuánto tiempo has dedicado a cada bóveda. Los descansos y las pausas no suman tiempo de trabajo.
- Salir del modo pausa el bloque y permite finalizar la sesión o dejarla en pausa. La suspensión y el cierre también pausan; tras un fallo se recupera hasta el último punto guardado.`,
      en: `- Nodus Focus appears in Nodus Tools and the Tools sidebar group by default. You can also open the timer from the header or command palette.
- Starting or resuming a work block enables focus mode. Unticking the checkbox remembers your choice across all vaults.
- Switching vaults preserves the session and running timer; the panel adapts to the new vault's sections and customisation. Study and Teaching retain their subjects, notes and materials.
- History is global and shows the time spent in each vault. Breaks and pauses do not count as work time.
- Leaving focus mode pauses the block and offers to end the session or keep it paused. Suspension and closing also pause; after a crash, recovery uses the last checkpoint.`,
    }, related: ['toolkit-hub'],
  },
  {
    id: 'toolkit-hub',
    area: 'tools',
    title: { es: 'Nodus Toolkit: el hub de herramientas', en: 'Nodus Toolkit: the tools hub' },
    keywords: ['toolkit', 'herramientas', 'hub', 'nodus tools', 'catalogo', 'fijar', 'desfijar', 'nodus scriptor', 'utilidades', 'convert', 'protect', 'translate', 'presenter', 'ocr'],
    body: {
      es: `- Herramientas es una sección de la barra lateral en su propio grupo y también tiene icono en la cabecera («Abrir Nodus Toolkit»). Aparece en todos los tipos de bóveda.
- Su página principal es un hub con las tarjetas del catálogo: Nodus Apps, Nodus Browser, Nodus Compass, Nodus Convert, Nodus Drift, Nodus Focus, Nodus Protect, Nodus Radar, Nodus Scriptor, Nodus Translate, Nodus Presenter y OCR Workspace. Cada tarjeta se puede fijar como atajo en la barra lateral («Fijar» / «Desfijar»).
- Nodus Scriptor está fijado por defecto en Herramientas, con fondo blanco y edición por bloques. El usuario puede desfijarlo; la elección se conserva después de la activación inicial de esta actualización.
- Dentro de una herramienta, el botón a la izquierda de su título vuelve al hub.
- Utilidades locales para investigación, docencia y estudio: convertir y procesar archivos sin salir de Nodus.`,
      en: `- Tools is a sidebar section in its own group and also has a header icon ("Open Nodus Toolkit"). It appears in every vault type.
- Its home is a hub with the catalogue cards: Nodus Apps, Nodus Browser, Nodus Compass, Nodus Convert, Nodus Drift, Nodus Focus, Nodus Protect, Nodus Radar, Nodus Scriptor, Nodus Translate, Nodus Presenter and OCR Workspace. Each card can be pinned as a sidebar shortcut ("Pin" / "Unpin").
- Nodus Scriptor is pinned under Tools by default, with a white background and block editing. Users can unpin it; that choice persists after this update initially enables it.
- Inside a tool, the button to the left of its title returns to the hub.
- Local utilities for research, teaching and study: convert and process files without leaving Nodus.`,
    },
    related: ['toolkit-focus', 'toolkit-convert', 'toolkit-ocr', 'sections-workspace-notes'],
  },
  {
    id: 'toolkit-convert',
    area: 'tools',
    title: { es: 'Nodus Convert: conversión y procesamiento local', en: 'Nodus Convert: local conversion and processing' },
    keywords: ['convert', 'convertir', 'pdf a texto', 'pdf a markdown', 'docx', 'epub', 'unir pdf', 'dividir pdf', 'comprimir', 'ocr ligero', 'heic', 'redimensionar', 'checksum', 'srt', 'grises', 'marca de agua', 'offline', 'sin ia'],
    body: {
      es: `- Nodus Convert ya funciona: convierte y procesa archivos en local, de uno en uno o en lote.
- Cinco categorías: Documentos («PDF → texto», «PDF → Markdown», «DOCX → Markdown/HTML/texto», «Markdown o HTML → DOCX», «Markdown o HTML → PDF», «EPUB → Markdown/texto» y «Markdown → EPUB»), utilidades PDF (unir, dividir o extraer páginas, rotar, reordenar o eliminar páginas, extraer imágenes incrustadas, «Imágenes → PDF», «PDF → imágenes», comprimir, escala de grises, numerar páginas, marca de agua, recortar márgenes y editar metadatos), OCR ligero («Imagen → texto», «PDF escaneado → texto» y «PDF escaneado → PDF buscable», además de preprocesar imagen para OCR), Imágenes (convertir formato incluido «HEIC → JPEG o PNG», redimensionar, comprimir, recortar con proporción, rotar o voltear, marca de agua) y Texto (limpiar texto pegado de PDF, mayúsculas y minúsculas, «Subtítulos (SRT/VTT) → texto» y checksum SHA-256 o MD5).
- Nodus Convert es determinista y 100 % offline (no hay IA), nunca modifica el archivo original y no sube nada a ningún servicio. La única conexión de red opcional es la descarga de idiomas de OCR de Tesseract, que decide el usuario.
- La opción «Idiomas de OCR» de las operaciones de OCR usa la notación de Tesseract (por defecto spa+eng).
- Si la operación falla por un PDF dañado o protegido, el error lo dice: un PDF cifrado pide una copia sin contraseña y un PDF dañado avisa de que no es válido.`,
      en: `- Nodus Convert already works: it converts and processes files locally, one at a time or in batch.
- Five categories: Documents ("PDF → text", "PDF → Markdown", "DOCX → Markdown/HTML/text", "Markdown or HTML → DOCX", "Markdown or HTML → PDF", "EPUB → Markdown/text" and "Markdown → EPUB"), PDF utilities (merge, split or extract pages, rotate, reorder or delete pages, extract embedded images, "Images → PDF", "PDF → images", compress, greyscale, page numbers, watermark, crop margins and edit metadata), Light OCR ("Image → text", "Scanned PDF → text" and "Scanned PDF → searchable PDF", plus image preprocessing for OCR), Images (format conversion including "HEIC → JPEG or PNG", resize, compress, crop to ratio, rotate or flip, watermark) and Text (clean text pasted from a PDF, upper/lower case, "Subtitles (SRT/VTT) → text" and SHA-256 or MD5 checksum).
- Nodus Convert is deterministic and 100% offline (no AI), never modifies the original file and uploads nothing to any service. Its only optional network connection is the Tesseract OCR language download, which the user decides.
- The "OCR languages" option in OCR operations uses Tesseract notation (spa+eng by default).
- When an operation fails on a damaged or protected PDF, the error says so: an encrypted PDF asks for a copy without a password and a damaged one reports that it is not valid.`,
    },
    related: ['toolkit-hub', 'settings-text-ocr'],
  },
  {
    id: 'toolkit-protect',
    area: 'tools',
    title: { es: 'Nodus Protect: proteger, marcar y verificar copias', en: 'Nodus Protect: redact, mark and verify copies' },
    keywords: ['protect', 'proteger', 'ocultar datos', 'desenfocar', 'recortar', 'enderezar', 'marca de agua', 'pie legal', 'idps', 'marca trazable', 'verificar copia', 'zip', 'png', 'anexar pdf', 'anonimizar'],
    body: {
      es: `- Nodus Protect ya funciona y tiene dos flujos: «Proteger documentos» y «Verificar una copia trazable».
- Proteger acepta PDF e imágenes del disco o de la bóveda activa, permite concatenar documentos, ocultar o desenfocar datos, recortar, rotar, enderezar, convertir a escala de grises, añadir siete patrones de marca de agua y un pie legal, y exportar copias rasterizadas como PNG, ZIP o PDF.
- Puede guardar una copia en disco, compartirla o incorporarla a la biblioteca «Copias protegidas» de la bóveda.
- Crea y verifica marcas trazables IDPS v1 compatibles con IDprotector. La marca autentica una copia, pero no la cifra y puede perderse por JPEG, capturas, reescalado o recompresión.
- El procesamiento de Nodus Protect es local y no envía documentos a IA, proveedores ni servicios externos.`,
      en: `- Nodus Protect already works and has two flows: "Protect documents" and "Verify a traceable copy".
- Protecting accepts PDFs and images from disk or the active vault, concatenates documents, hides or blurs data, crops, rotates, straightens, converts to greyscale, adds seven watermark patterns and a legal footer, and exports rasterised copies as PNG, ZIP or PDF.
- It can save a copy to disk, share it, or add it to the vault's "Protected copies" library.
- It creates and verifies IDPS v1 traceable marks compatible with IDprotector. The mark authenticates a copy but does not encrypt it, and it can be lost to JPEG, screenshots, rescaling or recompression.
- Nodus Protect processes locally and sends no documents to AI, providers or external services.`,
    },
    related: ['toolkit-hub', 'privacy-what-is-sent'],
  },
  {
    id: 'toolkit-translate',
    area: 'tools',
    title: { es: 'Nodus Translate: traducir texto, documentos y adjuntos', en: 'Nodus Translate: translate text, documents and attachments' },
    keywords: ['translate', 'traducir', 'traduccion', 'docx', 'epub', 'pdf', 'facsimil', 'refluido', 'glosario', 'zotero', 'idioma de origen', 'vision', 'modelo requerido', 'historial'],
    body: {
      es: `- Nodus Translate ya funciona: traduce texto pegado, archivos TXT, Markdown, HTML, DOCX, EPUB y PDF, y adjuntos importados de Zotero.
- Requiere un modelo seleccionado: sin él el botón queda deshabilitado y avisa «Selecciona un modelo para continuar.».
- Permite elegir idioma de destino, modelo, carpeta y formato de salida, y añadir idioma de origen (vacío significa automático) y un glosario con pares origen=destino.
- En DOCX y EPUB conserva estilos, jerarquía, cabeceras, pies, notas, enlaces e imágenes del archivo original. En PDF ofrece un modo de lectura redistribuida y un modo facsímil rasterizado que mantiene páginas, geometría, fondos e imágenes y sustituye visiblemente el texto en su posición; puede usar visión para escaneados y texto dentro de imágenes. Si una traducción no cabe, reduce el tamaño y avisa de las páginas afectadas.
- El archivo original nunca se modifica: el resultado se guarda como una copia nueva.
- Cuando el modelo no es local, un aviso indica que el contenido se enviará al proveedor. El historial permite mostrar, copiar, quitar o eliminar el archivo de cada traducción.`,
      en: `- Nodus Translate already works: it translates pasted text, TXT, Markdown, HTML, DOCX, EPUB and PDF files, and attachments imported from Zotero.
- It needs a selected model: without one the button stays disabled and warns "Select a model to continue.".
- It lets you choose target language, model, folder and output format, and add a source language (empty means automatic) and a glossary of source=target pairs.
- In DOCX and EPUB it preserves the original file's styles, hierarchy, headers, footers, notes, links and images. For PDF it offers a redistributed-reading mode and a rasterised facsimile mode that keeps pages, geometry, backgrounds and images while visibly replacing the text in place; it can use vision for scans and text inside images. When a translation does not fit, it shrinks the type and reports the affected pages.
- The original file is never modified: the result is saved as a new copy.
- When the model is not local, a notice states that the content will be sent to the provider. The history can show, copy, remove or delete each translation's file.`,
    },
    related: ['toolkit-hub', 'privacy-what-is-sent'],
  },
  {
    id: 'toolkit-presenter',
    area: 'tools',
    title: { es: 'Nodus Presenter: biblioteca de presentaciones', en: 'Nodus Presenter: presentation library' },
    keywords: ['presenter', 'presentaciones', 'diapositivas', 'powerpoint', 'keynote', 'libreoffice', 'notas del orador', 'youtube', 'video', 'pdf', 'biblioteca', 'pantalla externa', 'mando', 'qr', 'pin'],
    body: {
      es: `- Nodus Presenter importa archivos PDF o presentaciones creadas en PowerPoint, LibreOffice o Keynote a una biblioteca global de Herramientas, con etiquetas, búsqueda, orden (añadido recientemente, abierto recientemente, nombre A→Z y Z→A), renombrar, descargar, eliminar y miniaturas.
- Las presentaciones externas se convierten localmente a PDF y se avisa de que las animaciones y transiciones no se conservan; las notas de los PowerPoint modernos se importan automáticamente.
- Permite escribir notas por diapositiva, exportarlas e importarlas juntas en TXT, añadir vídeos de YouTube por diapositiva y descargar el PDF de la presentación.
- Al presentar abre la diapositiva a pantalla completa (en la pantalla externa si hay dos) y una vista del presentador con la diapositiva actual, la siguiente, las notas, un temporizador y el reloj, además de herramientas de anotación en directo (linterna, dibujo, puntero y lupa), pantalla en negro y control remoto desde el móvil con un código QR protegido por PIN.
- Lo único que necesita conexión son los vídeos de YouTube; el resto funciona sin internet.
- En esta versión, la vista disponible en Herramientas es la biblioteca con sus modales de notas y vídeo: si alguien pregunta por la presentación en vivo o el mando remoto dentro de Nodus, indícalo como no verificado en vez de prometerlo.`,
      en: `- Nodus Presenter imports PDF files or presentations made in PowerPoint, LibreOffice or Keynote into a global Tools library, with tags, search, ordering (recently added, recently opened, name A→Z and Z→A), rename, download, delete and thumbnails.
- External presentations are converted locally to PDF and a notice says animations and transitions are not preserved; notes from modern PowerPoint files are imported automatically.
- It supports per-slide speaker notes, exporting and importing them together as TXT, per-slide YouTube videos and downloading the presentation's PDF.
- While presenting it opens the slide full screen (on the external display when there are two) and a presenter view with the current slide, the next one, the notes, a timer and the clock, plus live annotation tools (flashlight, drawing, pointer and magnifier), a black screen, and a mobile remote through a QR code protected by a PIN.
- Only the YouTube videos need a connection; everything else works offline.
- In this version the surface available in Tools is the library with its notes and video modals: if asked about live presenting or the remote inside Nodus, mark it unverified instead of promising it.`,
    },
    related: ['toolkit-hub'],
  },
  {
    id: 'toolkit-ocr',
    area: 'tools',
    title: { es: 'OCR Workspace: escaneados difíciles con IA', en: 'OCR Workspace: hard scans with AI' },
    keywords: ['ocr workspace', 'ocr', 'escaneado', 'transcribir', 'traducir', 'revision pagina a pagina', 'modelo de vision', 'instrucciones propias', 'presets', 'concurrencia', 'zip', 'reprocesar'],
    body: {
      es: `- OCR Workspace ya se puede abrir: flujo asistido por IA para importar escaneados, revisar y corregir cada página y exportar el resultado.
- Requiere un modelo con visión; por defecto usa el modelo de visión configurado y, si falta, avisa «Elige un modelo de visión antes de procesar.».
- Modos: Transcribir (idioma original), Traducir (pide el idioma de destino) e Instrucciones propias, con presets guardables.
- Opciones adicionales: páginas (solo PDF), eliminar referencias, texto simple, dividir columnas, imágenes pequeñas y concurrencia (5 por defecto con nube y bloqueada a 1 con modelo local).
- La biblioteca de documentos OCR permite buscar, reprocesar, eliminar y exportar en ZIP todos los terminados, y la revisión página a página corrige el resultado antes de guardarlo.
- Con un modelo remoto hay un aviso de privacidad: las imágenes de cada página se envían a ese proveedor. Con un modelo local, todo se queda en el equipo.`,
      en: `- OCR Workspace can already be opened: an AI-assisted flow to import scans, review and correct every page and export the result.
- It needs a vision model; by default it uses the configured vision model and, when missing, warns "Choose a vision model before processing.".
- Modes: Transcribe (original language), Translate (asks for the target language) and Custom instructions, with saveable presets.
- Additional options: pages (PDF only), remove references, plain text, split columns, small images and concurrency (5 by default on the cloud, pinned to 1 with a local model).
- The OCR document library supports search, reprocessing, deletion and ZIP export of everything finished, and page-by-page review corrects the result before saving.
- With a remote model a privacy notice appears: each page's images are sent to that provider. With a local model everything stays on the machine.`,
    },
    related: ['toolkit-hub', 'settings-models-advanced'],
  },
  {
    id: 'toolkit-apps',
    area: 'tools',
    title: { es: 'Nodus Apps: crear herramientas con IA', en: 'Nodus Apps: build tools with AI' },
    keywords: ['nodus apps', 'apps', 'crear app', 'herramienta propia', 'generar', 'qr', 'compartir', 'archivar', 'modelo requerido', 'toolkit apps'],
    body: {
      es: `- Nodus Apps crea herramientas para investigar, estudiar o enseñar con IA, se adaptan hablando con el modelo y se comparten por QR.
- El catálogo separa las incluidas, las creadas por el usuario y las archivadas. La generación muestra sus fases: «Entendiendo tu idea», «Construyendo la app», «Revisando la coherencia visual», «Comprobando funciones y conexiones» y «Validando el paquete final».
- Requiere un modelo de IA; sin él el botón se deshabilita y muestra «Elige un modelo de IA para construir la app.».
- Se puede mejorar con IA, guardar, archivar y restaurar, eliminar y ejecutar la app, además de compartirla por QR o sesión.`,
      en: `- Nodus Apps builds tools for research, study or teaching with AI, adapts them by talking to the model, and shares them by QR.
- The catalogue separates built-in, user-created and archived apps. Generation shows its phases: "Understanding your idea", "Building the app", "Reviewing visual coherence", "Checking features and connections" and "Validating the final package".
- It needs an AI model; without one the button is disabled and shows "Choose an AI model to build the app.".
- Apps can be improved with AI, saved, archived and restored, deleted and run, and shared by QR or session.`,
    },
    related: ['toolkit-hub', 'settings-models-basic'],
  },
];
