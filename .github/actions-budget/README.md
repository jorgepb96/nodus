# Restricción temporal de GitHub Actions

Solicitada por el propietario el 11 de octubre de 2026 para ahorrar minutos.
**Restaurar únicamente cuando el propietario lo indique expresamente.** No hay
reactivación programada al comenzar otro mes.

La única comprobación automática es `CI / test`, en un runner Ubuntu por PR:
citación, lint, compilación con TypeScript y 13 archivos de tests esenciales.
Se conservan los tests originales, incluyendo la suite completa, los E2E y las
verificaciones de plataformas y empaquetado. No se ejecuta CI de nuevo al fusionar
en `main`; las actualizaciones del mismo PR cancelan la ejecución anterior.

Se han deshabilitado desde GitHub los demás workflows: AppImage, Backfill macOS
Intel, CLA, Local AI runtime, imagen del servidor, Website, Presenter, Beta release,
Release build, Stable release, Research corpus native, Research corpus packaging,
Scheme scan y SearXNG. Sus archivos, jobs y triggers permanecen intactos; mientras
estén deshabilitados tampoco se pueden lanzar manualmente sin habilitarlos.
El workflow interno `pages-build-deployment` lo gestiona GitHub y su API no permite
deshabilitarlo. Pages usa `build_type=workflow`; con Website deshabilitado no se
generan publicaciones automáticas y el sitio publicado se conserva.

El requisito `CLA / signature` del ruleset de `main` se retira temporalmente para
evitar que una comprobación pausada impida fusionar. Se conservan el requisito de
PR y las protecciones contra borrado y force-push, así como el ruleset de
`cla-signatures`. No se generan firmas CLA ni estados de éxito ficticios.

## Copia original y restauración

- Commit original: `0735f381485e5a0685e1f639e4e213ba1b014432`.
- `original-ci.yml`: copia exacta del único workflow modificado.
- `original-state.json`: estados de los 16 workflows registrados, hashes de todos
  los workflows originales y snapshots de ambos rulesets de GitHub.
- `restore.py`: restauración con comprobaciones de integridad y de cambios posteriores.

Después de recibir la petición explícita de restaurar:

1. Ejecutar `python3 .github/actions-budget/restore.py restore-files`.
2. Revisar, confirmar y fusionar la restauración de `ci.yml` en `main`. Mantener
   los workflows secundarios deshabilitados hasta terminar esta fusión.
3. Ejecutar `python3 .github/actions-budget/restore.py restore-github`. Comprueba
   que todos los YAML de `main` coinciden con los originales antes de habilitar
   los workflows y restaurar exactamente el ruleset de CLA.
4. Verificar los triggers, runners, estados y reglas restaurados, y validar el CI.

El script sin argumentos solo consulta los estados. Si un workflow o una regla
ha cambiado entretanto, revisar la diferencia antes de continuar; no sobrescribir
otros cambios a ciegas. Conservar esta copia hasta verificar la restauración.
