# Sincronización de Zotero al iniciar y control manual

## Comportamiento

- Al iniciar Nodus o abrir un vault académico, sus colecciones de Zotero ya vinculadas se actualizan automáticamente. El arranque espera a que cargue la ventana y deja cinco segundos adicionales antes del sync. Funciona también con el modo de sincronización manual, sin activar el sondeo continuo.
- «This vault» incluye un icono de sync manual junto a los otros controles. El tooltip y el nombre accesible utilizan las traducciones existentes. El icono gira y se desactiva durante el sync; la aplicación permanece utilizable.
- El sync de arranque actualiza metadatos y pertenencias. Las obras nuevas y modificadas notifican a la preparación documental existente, que crea sus embeddings si la preferencia de indexación automática está activada. No se activan por este cambio los análisis de Ideas ni los resúmenes.
- El arranque, los botones y el sondeo comparten una ejecución por vault. Una sincronización manual completada durante la espera satisface la petición de arranque pendiente.
- Los lotes de metadatos ceden el bucle de eventos aproximadamente cada ocho milisegundos. Los lectores de archivos y la fragmentación conservan los procesos auxiliares y el límite compartido de concurrencia de la corrección anterior.
- Cambiar de vault cancela el sync pendiente antes de cerrar la conexión. Las llamadas conservan además su conexión de origen. No se bloquea la navegación esperando que Zotero responda.
- Si Zotero no está disponible, el sync de arranque termina silenciosamente y un sync manual posterior puede reintentarlo. No se interpreta una lectura incompleta como eliminación de obras ni se avanza su checkpoint.

## Verificación

Compilación de Vite, tipos de renderer y Electron, ESLint de los archivos modificados y comprobación del diff aprobados. Las pruebas cubren paginación, bibliotecas de grupo, reconciliación de borrados, errores de conexión, colecciones vacías, concurrencia, cancelación, el arranque con modo manual y un sync manual solicitado antes del arranque diferido. La importación de 1.200 registros permite ejecutar eventos de interfaz cuando solo parte de los metadatos se ha escrito. Las tablas de traducción mantienen sus claves y textos no vacíos.

`scripts/verify-zotero-background-sync.mjs` ejecuta Electron y el renderer reales, con dos PDF sintéticos, la API HTTP de un Zotero simulado y un proveedor local de embeddings. Configura un perfil desechable, reinicia la aplicación y exige que el sync comience por sí solo; conserva el buscador enfocado mientras otro control se une al sync de arranque, después pulsa el botón manual para añadir la segunda obra y comprueba que ambas tengan embeddings listos. También exige que la cola de Ideas y resúmenes permanezca vacía y registra las llamadas que podrían mostrar, restaurar o enfocar una ventana.

El perfil aislado desactiva las integraciones por defecto. La prueba habilita exclusivamente este servicio mediante `NODUS_ISOLATED_ZOTERO_STARTUP=1`; mantiene desactivados los demás servicios de arranque. Todas las esperas del guion exigen explícitamente alcanzar el estado esperado.

Resultado final: el primer acceso al Zotero simulado llegó 9.882 ms después de relanzar el proceso, ya con la interfaz disponible. Se hicieron dos solicitudes de embeddings, una por cada documento, y ambos terminaron con tres fragmentos indexados. No hubo llamadas a `focus`, `show`, `restore` ni `moveTop`, ni errores del renderer. La pausa máxima observada fue de **178 ms** en el proceso principal y **35 ms** en el renderer. Son mediciones de esta ejecución, no una garantía universal de latencia.

Los [resultados reproducibles](zotero-background-sync-2026-10-24.json) corresponden al perfil `/private/tmp/nodus-research-pUxcZp`. Antes de cada lanzamiento se verificó la frontera del sistema operativo: solo permite escribir dentro del perfil temporal, prohíbe leer los perfiles reales de Nodus y Zotero y solo permite los puertos locales explícitos de la simulación. No se instaló esta compilación ni se modificaron datos o preferencias del Nodus real.
