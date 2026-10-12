# Novedades de Nodus 5.9.0

## Funciones nuevas

- [toolkit] Backups, en Herramientas, exporta el contenido que elijas de una o varias bóvedas en Markdown, CSV o JSON, a una carpeta o a un archivo ZIP. Puedes seleccionar registros concretos, incluir los documentos de la biblioteca vinculados a esas bóvedas o la biblioteca completa y guardar la selección para reutilizarla. La investigación puede organizarse por obras, autores o ideas. La copia completa .nodus sigue disponible en la misma herramienta. Disponible en escritorio.

- [toolkit] Nodus Scriptor permite dictar con los modelos de transcripción locales instalados. Las palabras aparecen en el documento mientras hablas como texto normal que puedes editar y deshacer. Puedes pausar, reanudar o detener el dictado. El audio no se envía a ningún servicio externo. Disponible en escritorio.

- [toolkit] Al seleccionar texto en Nodus Scriptor, puedes pedir a la IA que lo mejore con un estilo de tu biblioteca de prompts, el modelo que elijas e instrucciones opcionales. La propuesta se muestra en el texto a medida que se genera, con las palabras añadidas y eliminadas marcadas. El documento solo cambia si aceptas la propuesta completa, y puedes deshacerla en un paso. Disponible en escritorio.

- [toolkit] Nodus Scriptor puede crear imágenes con IA a partir de una descripción. Elige el modelo de imagen, revisa la vista previa e inserta la imagen en la posición del cursor. Puedes cancelar la generación y guardar modelos favoritos. Disponible en escritorio.

## Mejoras

- [academic] Research Chat es más rápido en bibliotecas grandes. La búsqueda en documentos, la recopilación de evidencias para ideas y síntesis y la comprobación del ámbito de Zotero tardan menos. Las conversaciones largas responden con fluidez mientras se escribe una respuesta.

- [academic] El grafo carga mucho más rápido el mapa completo de las bibliotecas grandes. Las ideas y sus conexiones aparecen en segundos en lugar de minutos.

- [toolkit] Nodus Scriptor usa los colores de la bóveda activa o del tema elegido en los modos claro y oscuro. Los ajustes de dictado y las opciones de formato adicionales se abren en menús independientes, y la barra de formato ya no necesita desplazamiento.

- [general] Las instalaciones de Nodus Cloud en Cloudflare limitan el uso diario y mensual de la sincronización. Al alcanzar el límite, la sincronización se pausa y Nodus muestra un aviso. Importar copias grandes de una bóveda ya no bloquea la aplicación, y las copias conectadas pueden sincronizarse entre sí aunque el equipo que publica esté desconectado. Requiere actualizar el servicio en Cloudflare.

## Correcciones

- [general] Abrir un adjunto o una fuente conservada que sea un archivo ejecutable lo muestra en el gestor de archivos en lugar de ejecutarlo. El PIN de acceso por red local de PDF Presenter y de las aplicaciones compartidas limita los intentos. Las descargas del navegador ya no sobrescriben archivos existentes. El HTML de las publicaciones importadas se depura antes de mostrarse y conserva las fórmulas matemáticas.

- [general] Las copias de seguridad de más de 4 GiB se crean correctamente. La sincronización conserva los cambios hechos durante un envío, no recupera elementos eliminados en otra copia e incluye todas las notas de Nodi. Si la primera descarga de una bóveda conectada falla, la conexión se deshace.

- [general] Los cambios escritos justo antes de salir de una página se guardan. Cerrar una grabación mientras se pide permiso para el micrófono lo libera. Las importaciones de Notion con enlaces a archivos fuera del ZIP finalizan con un aviso. La exportación GEDCOM conserva a ambos progenitores cuando ninguno consta como varón.

- [ai] En la comprobación de rutas de síntesis, cada paso muestra un resultado coherente con el veredicto de la ruta, también en los errores de continuidad. Detener la comprobación conserva la respuesta que estabas viendo, y las peticiones de buscar en la web se respetan.

- [plugin] Al cancelar una llamada a una herramienta de un plugin se detienen los procesos que había iniciado. El tiempo de espera agotado de una llamada ya no hace fallar las demás, y eliminar o actualizar un plugin detiene sus procesos en ejecución.

- [library] Las obras cuyo índice documental se completa tras un error dejan de aparecer en «Con errores». Una página ilegible ya no cancela el OCR ni hace rechazar un PDF completo. La detección de duplicados revisa todos los registros, no solo los 5.000 primeros, y los ISBN separados por espacios se leen por separado.
