# Restricción temporal de GitHub Actions

Solicitada por el propietario el 11 de octubre de 2026 para ahorrar minutos,
conservando la calidad de la validación de PR y releases.
**Restaurar únicamente cuando el propietario lo indique expresamente.** No hay
reactivación programada al comenzar otro mes.

## PR: suite completa, un único runner Linux

`CI / test` instala y compila una vez en Ubuntu 22.04, comprueba lint y TypeScript,
construye también Server Web y ejecuta todos los archivos descubiertos por el
runner original, los cuatro E2E y los contratos reales del marketplace, incluidos
los procesos nativos y las migraciones. El inventario comprueba que cada archivo
se ejecuta exactamente una vez. Se mantienen cachés, concurrencia limitada de
los tests, fallo ante omisiones y cancelación de PR obsoletos. No se repite el CI
al fusionar en `main` ni se transfieren builds entre varios runners.

Los E2E de Linux usan Xvfb y el driver OpenGL ES de SwiftShader de
Chromium para ejecutar WebGL real sin GPU. Los flags solo se aplican a Linux en
CI y no desactivan el sandbox de Electron. El arranque, los cuatro E2E y las
migraciones se comprueban antes de la suite larga para fallar pronto.

Solo los nueve casos que dependen de APIs nativas de macOS se aplazan en Linux,
con una lista explícita por archivo, nombre y razón; pasan a ser comprobaciones
obligatorias en la release de Apple silicon. Ninguna omisión nueva es aceptada.
Todas las pruebas siguen conservadas. El workflow tiene `workflow_call` para
validar también el tag exacto de cada release antes de preparar un borrador.

## Releases: tres plataformas y publicación condicionada

Stable release, Beta release y Release build permanecen habilitados. Sus tags y
entradas manuales originales se conservan. La suite Linux completa valida el tag
antes del empaquetado. Cada release conserva las verificaciones nativas de macOS
Apple silicon, Windows y Linux, firma/notarización, integridad, artefactos y el
gate final: cualquier fallo impide publicar. Los contratos del marketplace y sus
migraciones en Windows/macOS se comprueban aquí en vez de repetir esas plataformas
en todos los PR.

El propietario también pidió dejar de producir releases macOS Intel. Se retira
esa fila de la matriz, se normaliza el manifiesto de Apple silicon con el merger
original y dejan de exigirse los assets Intel. Se conservan el backfill y todos
los verificadores históricos, pausados; las descargas Intel públicas apuntan a
la última release existente con Intel, `v5.8.1`, para no romper sus enlaces.

GitHub anunció en 2025 el fin de `macos-15-intel` para agosto de 2027, pero su
[anuncio del 26 de febrero de 2026](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/)
introdujo `macos-26-intel`. No se considera confirmada una retirada inmediata de
todos los runners Intel; retirar nuestra compilación es la decisión de ahorro
solicitada por el propietario.

## Workflows secundarios y reglas

Se deshabilitan desde GitHub AppImage, Backfill macOS Intel, CLA, Local AI runtime,
imagen del servidor, Website, Presenter, Research corpus native, Research corpus
packaging, Scheme scan y SearXNG. Sus YAML y triggers siguen intactos. El workflow
interno `pages-build-deployment` no admite deshabilitación por API. Pages usa
`build_type=workflow`; al pausar Website no se generan publicaciones automáticas.
El sitio ya publicado se conserva.

El requisito `CLA / signature` del ruleset de `main` se retira temporalmente para
que una comprobación pausada no impida fusionar. Las otras reglas y el ruleset de
`cla-signatures` se conservan; no se inventan firmas ni estados de éxito.

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
