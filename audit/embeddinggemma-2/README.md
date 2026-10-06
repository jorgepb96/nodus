# Campaña EmbeddingGemma 2 · 2026-10-06

Los perfiles de 512 y 256 dimensiones están implementados como opciones experimentales. No se ha cambiado el modelo predeterminado ni se ha accedido a bases de datos reales. Los umbrales de recuperación controlada se han superado en este corpus. La muestra revisada de respuestas factuales incumple el criterio de fundamentación. Falta cobertura nativa en otros sistemas. No se ofrecen como opciones validadas. Los criterios completos están en campaign.json.

## Recuperación controlada

40 documentos, 120 consultas; 70 positivas y 10 sin evidencia en evaluación, 40 consultas para desarrollo. Los textos controlados son extractos; la importación completa se mide aparte.

| Perfil | Preparación | Recall@10 | nDCG@10 |
| --- | --- | --- | --- |
| multilingual-e5-small-int8 | current | 0.995 | 0.993 |
| multilingual-e5-small-int8 | recommended | 0.995 | 0.982 |
| gte-multilingual-base-int8 | current | 0.976 | 0.935 |
| gte-multilingual-base-int8 | recommended | 0.976 | 0.935 |
| bge-m3-q8_0 | current | 1.000 | 0.989 |
| bge-m3-q8_0 | recommended | 1.000 | 0.989 |
| embeddinggemma-2-text-q8-256-v1 | recommended | 1.000 | 1.000 |
| embeddinggemma-2-text-q4-512-lab | recommended | 1.000 | 1.000 |
| embeddinggemma-2-text-q4-256-lab | recommended | 1.000 | 1.000 |
| embeddinggemma-2-text-q8-768-lab | recommended | 1.000 | 1.000 |
| embeddinggemma-2-text-q8-512-v1 | recommended | 1.000 | 1.000 |

## Producto completo

| Perfil | Ejecución | Recall@10 semántico | Respuestas capturadas |
| --- | --- | --- | --- |
| embeddinggemma-2-text-q8-512-v1 | recorrido completado | 0.998 | 28 |
| multilingual-e5-small-int8 | recorrido completado | 0.971 | 31 |
| gte-multilingual-base-int8 | recorrido completado | 0.981 | 28 |
| bge-m3-q8_0 | recorrido completado | 0.995 | 27 |
| embeddinggemma-2-text-q8-256-v1 | recorrido completado | 0.993 | 28 |

## Fundamentación revisada

| Perfil | Factuales sustentadas / revisadas | Ausencia reconocida / revisada | Citas resolubles / capturadas |
| --- | --- | --- | --- |
| embeddinggemma-2-text-q8-512-v1 | 5/10 | 4/4 | 203/203 |
| multilingual-e5-small-int8 | 10/20 | 4/4 | 197/197 |
| gte-multilingual-base-int8 | 1/3 | 4/4 | 191/191 |
| bge-m3-q8_0 | 1/3 | 4/4 | 207/207 |
| embeddinggemma-2-text-q8-256-v1 | 2/6 | 4/4 | 188/188 |

Revisión manual de Codex contra los pasajes originales; no auditoría humana externa. La muestra dirigida no estima la tasa de respuestas sin revisar. Los errores observados incluyen atribuciones de idioma, inferencias estadísticas sin datos y condiciones de restauración no documentadas. Se conservan respuestas, pasajes, hashes y notas de cada revisión.

## Capacidad en Desktop

| Fragmentos reales | Frío (ms) | Caliente p50 (ms) | Caliente p95 (ms) | Mayor pausa entre frames (ms) |
| --- | --- | --- | --- | --- |
| 1000 | 2306.7 | 265.7 | 309.4 | 116.7 |
| 10000 | 2403.3 | 377.3 | 414.0 | 100.0 |

Perfil medido: embeddinggemma-2-text-q8-512-v1. Carga concurrente declarada: quiet-no-other-QA-or-build. Las pruebas anteriores bajo carga permanecen en supplementaryDesktopRuns. El objetivo de 1,5 s se evalúa sobre 10.000 fragmentos en el Desktop real; la comparación de vectores en JavaScript se informa por separado. Las muestras completas de memoria se conservan; la compresión impide interpretar una diferencia negativa de RSS como consumo negativo.

Con 10.000 fragmentos, el mayor total residente muestreado de la aplicación fue 1.84 GiB y el incremento final frente al arranque fue 1.00 GiB. La suma conservadora de picos por proceso menos el total inicial da 1.23 GiB de incremento. Solo acredita este recorrido y perfil en el M2.

Contextos largos, medidos aparte: 2048 tokens: 3.30 s y 1.90 GiB de RSS máximo del proceso nativo; 8192 tokens: 56.57 s y 5.71 GiB de RSS máximo del proceso nativo. El máximo de 8K tokens requiere bastante más memoria que el recorrido habitual. La medida de capacidad de 256 dimensiones y la cobertura de Windows, Linux e Intel permanecen pendientes.

## Alcance y límites

Apple M2, 16 GB, macOS ARM64; las cifras no se extrapolan a Windows, Linux o Intel. El corpus sintético contiene traducciones paralelas y pocos casos por idioma de estrés. Los rankings completos, contratos, fuentes, localizadores, errores y revisiones están en los JSON adjuntos. El modelo generativo es DeepSeek Flash directo, idéntico para todos los perfiles.

Presupuesto compartido: 1.769614 USD como cota de gasto comprometido o reservado, de 5 USD. No se incorporan credenciales al informe.

Los contextos de 2K y 8K se presentan por separado del consumo habitual. Una cita resoluble no certifica que todas las afirmaciones de la respuesta estén sustentadas. Los fallos de generación y de recuperación permanecen separados.

## Reproducción

Ver docs/embeddinggemma-2.md y los comandos test:embeddinggemma:contracts, audit:embeddinggemma, audit:embeddinggemma:product, test:e2e:embeddinggemma, test:embeddinggemma:capacity, test:embeddinggemma:restart, test:embeddinggemma:server:native y test:embeddinggemma:package. Toda ejecución crea perfiles marcados y bóvedas desechables con una frontera de aislamiento del sistema operativo.

## Verificación final de la entrega

La evidencia y los hashes de 17 comprobaciones están en [verification.json](verification.json): lint, typecheck, builds de Desktop y Server Web, 35 pruebas de contratos/runtime, 106 regresiones focalizadas, tres pruebas nativas de Server Web, el smoke general de Electron y el paquete ASAR real. Los perfiles comparten una descarga y la confirmación de eliminación identifica ambos; las capturas finales de Ajustes son de un perfil QA temporal.

La suite completa terminó con 4.634 pruebas aprobadas, dos omitidas y un fallo por fechas desactualizadas del sitemap después del commit de dependencias. Se regeneró el sitemap y sus tres pruebas pasan al repetirlas. Se conserva el log completo anterior a esa corrección y la referencia a su resolución; no se presenta ese log como una ejecución sin fallos. No cambió código de la aplicación después del smoke del paquete.

Los atributos de Git conservan los bytes de fixtures e informes en todos los sistemas; los hashes no dependen de la conversión de finales de línea de Windows. No se archivan pesos, perfiles, bases de datos ni credenciales.
