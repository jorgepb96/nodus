# Acciones tipadas a través de la vinculación directa

Las rutas `/corpus/actions`, `/corpus/actions/:id` y `/corpus/actions/:id/cancel` se adaptan a los trabajos persistentes del Bridge. Los estados se proyectan sin confundir aceptación con aplicación: solo un trabajo `available` se presenta como `applied`. La secuencia de creación y el recibo de idempotencia se conservan al reiniciar. Una acción interrumpida que pudiera haber escrito datos no se vuelve a ejecutar automáticamente.

Las acciones de contenido entran en las mismas funciones de Desktop: notas, proyectos, versiones de Pages, importación tipada de CSV, cambios de entidades y auditoría determinista de continuidad. La generación autorizada exige `executionMode: live`, además de corpus, escritura e investigación en el vault real; usa la configuración y los proveedores del Mac. Una petición autónoma no se redirige al proveedor del Mac. La síntesis de autor, matriz, revisión de prosa, mapas y taller cuentan con caminos autónomos separados; queda pendiente la revisión de todas las rutas heredadas. Un rechazo explícito no cuenta como paridad autónoma completa.

La frontera excluye Toolkit, automatizaciones, extracción/importación de documentos y recomputación académica. Los trabajos quedan ligados a la vinculación y al vault que los aceptó. Las revisiones de entrada se verifican contra el corpus real antes de ejecutar.

Contrato preparado: `scripts/test-mobile-space-actions.mjs`. Falta ejecutar los contratos, comprobar todas las acciones desde la interfaz, sus resultados persistidos, modo autónomo pertinente, progreso, cancelación, suspensión y reconexión. Este documento no certifica validación.
