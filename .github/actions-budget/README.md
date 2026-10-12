# Política de GitHub Actions y restauración

Solicitada por el propietario el 11 de octubre de 2026 para ahorrar minutos,
conservando la calidad de la validación de PR y releases.
**Restaurar únicamente cuando el propietario lo indique expresamente.** No hay
reactivación programada al comenzar otro mes.

## Política duradera de validación con consumo reducido

Los PR de código conservan la suite Linux completa: una sola instalación y
compilación, lint/TypeScript, todos los archivos descubiertos, cuatro E2E, contratos
del marketplace, procesos nativos y migraciones. No se cachean resultados de tests
ni se seleccionan pruebas individuales por los archivos modificados.

Los PR que solo cambian `README.md`, Markdown de `docs/`, documentación de esta
restricción o el sitio (excepto `site/data/`, que también consume el desktop) usan
una vía rápida: citas, todos los contratos del sitio y
CLA. Cualquier archivo desconocido requiere Linux completo. El selector usa el
diff Git completo, incluye borrados y ambos extremos de renombrados y falla si
no puede comparar commits inmutables; no depende del límite de 300 archivos de
los filtros de GitHub. Los cambios en el propio selector fuerzan todas las vías.

Electron, dependencias, configuración de build, código nativo y contratos
compartidos añaden macOS Apple silicon y Windows antes de fusionar. Esos runners
compilan y ejecutan las APIs nativas de macOS, credenciales Python, contratos y
migraciones de capacidades y Presenter de Windows. Los nueve casos que requieren
macOS siguen aplazados en Linux, pero son obligatorios y no admiten omisiones en
su host nativo. Un nuevo skip, cancelación o test pendiente falla la puerta nativa.

Research añade el runtime privado real, MCP/SearXNG locales, coexistencia y ciclo
de vida en los tres sistemas, las 17 regresiones especializadas en los hosts
nativos y el E2E de notebooks/PDF/actividad aislado en macOS. Linux ejecuta esas 17
regresiones dentro de su inventario completo, sin repetirlas. Scheme scan y la
imagen del servidor se validan en Linux cuando cambia su código; el contenedor
real arranca y comprueba salud y protección de acceso sin publicarse. AppImage y
Presenter Linux se comprueban en el mismo runner principal cuando corresponde.

`CI / test` se ejecuta siempre y exige éxito de cada job seleccionado y omisión
solo de los jobs no necesarios. Es obligatorio para fusionar, junto a
`CLA / signature`, que conserva el workflow y los triggers originales. La vía
rápida también produce el check obligatorio; ningún filtro de workflow lo deja
pendiente indefinidamente. Los PR obsoletos se cancelan; las releases no. Se admite
`merge_group` sin activar ninguna cola de fusión. No se repite CI al fusionar en
`main`. Una ejecución manual de CI ejercita todas las vías sin publicar.

Los E2E de Linux conservan Xvfb, Mesa por CPU, ANGLE y el sandbox normal de
Electron. El compositor sigue por software y los grafos usan WebGL real. Se
comprueba el runtime antes de la suite larga para fallar pronto. Los artefactos
diagnósticos tienen retención de tres días; npm, Electron y compilación incremental
conservan sus cachés, pero ninguna caché sustituye una comprobación.

## Releases: tres plataformas y publicación condicionada

Stable release y Beta release conservan sus tags y entradas manuales originales.
La suite Linux completa y sus controles especializados validan el tag exacto
antes de preparar un borrador. Las ejecuciones del mismo tag se serializan y
ninguna release se cancela al empezar otra. Los jobs tienen límites explícitos de
tiempo para evitar consumos por procesos colgados. Cada release conserva macOS Apple silicon, Windows
y Linux, firma/notarización, procesos nativos, migraciones, runtime Research,
integridad y el gate final: cualquier fallo impide publicar. Los controles nativos
rechazan skips y se ejecutan aunque ese código no haya cambiado.

El propietario pidió dejar de producir releases macOS Intel. Se conserva el
merger auditado para normalizar el manifiesto arm64 y dejan de exigirse assets
Intel. El backfill histórico sigue conservado y deshabilitado; las descargas Intel
públicas apuntan a la última release existente con Intel, `v5.8.1`.

GitHub introdujo `macos-26-intel` en su
[anuncio del 26 de febrero de 2026](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/).
No se considera confirmada una retirada general de los runners Intel: retirar
nuestra compilación es la decisión de ahorro solicitada por el propietario.

## Workflows secundarios y reglas

AppImage, Presenter, Research native, Research packaging y Scheme scan permanecen
habilitados con entrada manual; su cobertura automática necesaria se selecciona
desde CI. Website y la publicación de la imagen del servidor son manuales. La
imagen del servidor requiere `publish=true` y `main` para publicar; por defecto
solo comprueba un contenedor sin publicar. Website publica siempre el `main`
canónico. Sus despliegues y las comprobaciones de instaladores no se lanzan para
probar esta política. SearXNG conserva su alerta de versión/salud y pasa de semanal
a mensual, además de su entrada manual.

La entrada histórica Local AI runtime ya no tiene YAML en `main` y permanece
deshabilitada. Pages usa `build_type=workflow`; su workflow interno no dispara
publicaciones sin el productor Website. Todas las pruebas y todos los workflows
originales están conservados. La matriz manual Research usa los tres sistemas
soportados y Node 22, como CI y las releases.

Se conservan todas las reglas originales de `main` y `cla-signatures`, añadiendo
únicamente el check agregado `test` como requisito de calidad. Las firmas CLA no
se inventan ni se modifican. La instantánea original permite deshacer también
este requisito añadido cuando se solicite la restauración completa.

## Restauración exacta

Commit original: `0735f381485e5a0685e1f639e4e213ba1b014432`.
`original-ci.yml` y `original-files/` contienen copias byte por byte de todos los
archivos modificados. `original-state.json` conserva sus hashes, los estados de
los 16 workflows registrados y snapshots completos de ambos rulesets.

Después de recibir la petición explícita de restaurar:

1. Ejecutar `python3 .github/actions-budget/restore.py restore-files`.
2. Revisar y confirmar los archivos restaurados. Después ejecutar
   `node scripts/build-sitemap.mjs` y confirmar la fecha regenerada: el sitemap
   fecha el commit que recupera la página, no su antigua modificación. Este dato
   generado es la única excepción a la restauración byte por byte; los workflows,
   triggers, pruebas y contenido de las páginas sí recuperan sus bytes originales.
   Fusionar conservando los commits y actualizar este checkout al nuevo `main`.
   Mantener los workflows secundarios deshabilitados hasta terminar esta fusión.
3. Ejecutar `python3 .github/actions-budget/restore.py restore-github`. Comprueba
   los archivos originales de `main` antes de habilitar los workflows y restaurar
   exactamente el ruleset de CLA; exige también el sitemap válido en ese checkout.
4. Verificar triggers, runners, estados y reglas y validar el CI original.

La restauración completa reproduce la configuración original, incluida la matriz
Intel y sus verificaciones. El script sin argumentos solo consulta estados. Si
algún archivo o regla cambió entretanto, revisar antes de continuar, sin pisar
cambios ajenos. Conservar las copias hasta verificar la restauración.

## Verificación de la política

[CI completo verificado](https://github.com/jorgepb96/nodus/actions/runs/38128596957):
835 archivos ejecutados exactamente una vez, 4.667 casos, 4.657 aprobados, cero
fallos/cancelaciones y las diez omisiones previstas de Linux. Los nueve casos
exclusivos de macOS también se ejecutaron y aprobaron en su host nativo.
macOS aprobó los 33 casos nativos/Python, las 17 regresiones de Research y los E2E
reales de notebooks, PDF y actividad. Windows aprobó sus seis casos nativos/Python,
las 17 regresiones de Research, Presenter y la instalación/migración de capacidades.
Scheme scan, AppImage, Presenter Linux y el arranque del contenedor también
aprobaron. El proceso CLI de la prueba de corpus de Windows termina explícitamente
solo después de completar todas las aserciones y la limpieza esperada; los errores
no se aceptan ni se convierten en éxito.

[CI de documentación verificado](https://github.com/jorgepb96/nodus/actions/runs/38128712044):
83 segundos, 101 contratos del sitio y 27 casos del CLA aprobados, `test` y
`CLA / signature` satisfactorios y todas las vías costosas omitidas. El selector
y el validador de workflows siguen ejecutándose también en esta vía rápida.

La restauración se probó en una copia aislada: recupera los 28 archivos originales
byte por byte y retira los cinco archivos añadidos por esta política. La publicación
firmada y los instaladores conservan sus gates; se ejercitarán al solicitar su
ejecución, sin generar una release o un despliegue únicamente para esta validación.
