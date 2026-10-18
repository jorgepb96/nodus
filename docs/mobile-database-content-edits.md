# Escritura de contenido de bases de datos desde el companion

Los cuatro controles de creación y edición (`db_databases`, `db_columns`, `db_rows`, `db_cells`) usan el ledger de mutaciones existente con funciones canónicas del repositorio. Crear una fila conserva su página universal; cambiar un título conserva los enlaces y los valores derivados. No se acepta SQL arbitrario ni se habilitan reglas, herramientas, administración o procesos de extracción.

Las creaciones conservan la identidad generada en el móvil para que sus propiedades y filas puedan continuar referenciándolas sin red. Desktop genera los metadatos reales. Solo se permiten propiedades básicas con configuración vacía en esta ruta; las fórmulas y configuraciones avanzadas requieren su operación especializada.

Las celdas incluyen revisión y valor anterior. Deben coincidir con el dato canónico, lo que evita que una segunda edición pendiente sobrescriba una edición ajena que coincida por casualidad en el número de revisión. Vaciar una celda ejecuta la eliminación canónica de su valor. Los recibos se guardan junto con cada operación y permiten repetir una petición sin duplicar su aplicación.

Los rechazos son explícitos y sus datos permanecen en la cola del dispositivo. El móvil no los presenta como un guardado sincronizado. La proyección de la cola permite reabrir creaciones y cambios pendientes; una fila canónica que haya alcanzado la revisión confirmada reemplaza esa proyección. El estado de entrega de una mutación no implica que todas las vistas hayan refrescado su snapshot.

Pendientes de ejecución: `scripts/test-mobile-database-mutations.mjs`, `CompanionContentProjectionTests`, pruebas de cola, compilaciones locales y aceptación en ambos dispositivos. Hay que comprobar creación encadenada sin red, cancelación, rechazo y recuperación del borrador, cambios de título, valores tipados y reaparición en Desktop antes de cerrar esta cobertura.
