# Novedades de Nodus 5.8.1

## Funciones nuevas

- [toolkit] Nodus Scriptor, en Herramientas, permite escribir y organizar documentos con texto enriquecido, tablas, imágenes y fórmulas. Inserta fuentes e ideas con [[, añade citas, bibliografía y notas, reúne capítulos y exporta a Word, PDF o LaTeX. Incluye historial de versiones, escritura a pantalla completa y mejoras de texto con IA que puedes cancelar o deshacer. Disponible en escritorio y en la web del servidor.

## Mejoras

- [ai] Las plantillas de Chemistry Studio consideran los reactivos de cada esquema. La preparación de los índices valida el mapeo de átomos y permite excluir esquemas con problemas de mecanismo o estereoquímica.

- [academic] Research Chat ajusta la longitud de sus respuestas al espacio disponible y a los límites del modelo. Esto permite respuestas y rutas de síntesis más largas en los modelos compatibles, con menos interrupciones por el límite de salida.

## Correcciones

- [ai] La comprobación de rutas de síntesis usa las sustancias declaradas en el texto y conserva los componentes repetidos de las sales. Distingue los pasos que no pudo comprobar y muestra el origen de las estructuras. El diagrama de la ruta solo se genera cuando esta supera la comprobación.

- [ai] Los resultados guardados por los plugins registran la versión del contenido que los produjo. Sustituir un paquete instalado ya no hace que el resultado indique una versión anterior del plugin.

- [academic] Research Chat vuelve a recuperar pasajes en bibliotecas grandes y con instrucciones extensas. Las citas guardadas siguen resolviéndose y las nuevas no se bloquean al alcanzar el límite anterior. El contexto incluye las obras que participaron en la consulta, sin añadir títulos ajenos a ella.

- [zotero] El complemento de Nodus para Zotero vuelve a guardar las claves de API y las credenciales de conexión en Zotero 10. Usa el gestor de contraseñas de Zotero y confirma que los datos se han guardado antes de continuar.

- [general] Los paquetes de instalación incluyen solo los archivos de la compilación actual. Se eliminan las copias de compilaciones anteriores para reducir el tamaño de la aplicación.
