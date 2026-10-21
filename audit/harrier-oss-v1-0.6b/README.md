# Harrier OSS v1 0.6B como modelo de embeddings integrado · 2026-10-20

`harrier-oss-v1-0.6b-q8_0` se añade a los modelos locales de Nodus. Corre en el mismo motor llama.cpp que BGE-M3 (b10002, Metal en macOS, `--fit` en Windows y Linux), con *pooling* del último token y la instrucción de búsqueda de Microsoft solo en las consultas. Las cifras son de un Apple M2 con 16 GB y macOS ARM64; Windows, Linux y Mac Intel siguen pendientes.

## Por qué llama.cpp y no ONNX

| Opción | Resultado |
| --- | --- |
| ONNX con el Transformers.js 3.8.1 de Nodus | No carga: el export usa `GatherBlockQuantized` con un atributo que ONNX Runtime 1.21 no conoce. |
| ONNX con el Transformers.js 4.3.1 aislado | Funciona, pero solo en CPU: 2,1 pasajes/s y 200–400 ms por consulta; no disponible en Mac Intel. |
| GGUF Q8_0 en llama.cpp | 11,8 pasajes/s y 12 ms por consulta en Metal; mismo motor y ciclo de vida que BGE-M3. |

El GGUF elegido (`mradermacher/harrier-oss-v1-0.6b-GGUF`, revisión `d79decec…`, SHA-256 `ba2c9408…`) declara `pooling_type = 3` (último token) y añade `<|endoftext|>`. Frente a la exportación FP16 de los pesos de Microsoft, sus vectores dan un coseno medio de 0,99993 sobre textos en cinco idiomas, el mismo orden que el ONNX q8 (0,99995). El ONNX q4 se queda en 0,987. Detalle en [weight-parity.json](weight-parity.json).

## Recuperación controlada

El corpus archivado de la campaña de EmbeddingGemma 2 (40 documentos, 70 consultas positivas de evaluación) se reprodujo byte a byte. Las cifras de los demás modelos coinciden con las archivadas, así que la comparación es directa. Detalle en [controlled-retrieval.json](controlled-retrieval.json).

| Perfil | Recall@10 | nDCG@10 | Negativos difíciles (nDCG) |
| --- | --- | --- | --- |
| **harrier-oss-v1-0.6b-q8_0** | **1,000** | 0,989 | 0,999 |
| embeddinggemma-2-text-q8-512-v1 | 1,000 | 1,000 | 1,000 |
| bge-m3-q8_0 | 1,000 | 0,989 | 1,000 |
| multilingual-e5-small-int8 | 0,995 | 0,982 | 0,959 |
| gte-multilingual-base-int8 | 0,976 | 0,935 | 0,852 |

El corpus está casi saturado. El único fallo de Harrier (y de BGE-M3) es la consulta sobre LoRA, que recupera antes el artículo de QLoRA.

## Producto completo

`node scripts/e2e-embeddinggemma.mjs --profile=harrier-oss-v1-0.6b-q8_0 --no-chat` en Electron real, con perfil aislado: descarga desde Ajustes con cancelación y reanudación, importación de los 40 documentos, OCR local, preparación documental y 120 búsquedas. Las 19 comprobaciones pasan, incluidas funcionamiento sin red, persistencia tras reiniciar y aislamiento de la base de datos. Detalle en [product-retrieval.json](product-retrieval.json).

| Perfil | Semántica R@10 | Semántica nDCG@10 | Consulta p50 / p95 |
| --- | --- | --- | --- |
| **harrier-oss-v1-0.6b-q8_0** | **1,000** | **1,000** | **168 / 207 ms** |
| embeddinggemma-2-text-q8-512-v1 | 0,998 | 0,997 | 321 / 468 ms |
| bge-m3-q8_0 | 0,995 | 0,969 | 480 / 880 ms |
| gte-multilingual-base-int8 | 0,981 | 0,959 | 474 / 633 ms |
| multilingual-e5-small-int8 | 0,971 | 0,977 | 164 / 179 ms |

Las filas de los demás modelos son las archivadas el 2026-10-06 con el mismo corpus y arnés.

## Banco público

Cada modelo recibe exactamente la entrada que le envía Nodus, con el límite de 8.000 caracteres. Detalle en [public-benchmark.json](public-benchmark.json).

| nDCG@10 | Harrier | Harrier sin instrucción | BGE-M3 | E5 small | GTE base |
| --- | --- | --- | --- | --- | --- |
| SciFact (300 consultas, 5.183 resúmenes) | **0,765** | 0,725 | 0,425 | 0,641 | 0,398 |
| Belebele es→es | **0,947** | 0,932 | 0,905 | 0,911 | 0,710 |
| Belebele en→es | **0,949** | 0,936 | 0,885 | 0,874 | 0,687 |
| Belebele es→en | **0,937** | 0,925 | 0,901 | 0,839 | 0,739 |

La instrucción mejora todas las tareas, así que forma parte de la receta del índice. BGE-M3 y GTE quedan muy por debajo de sus resultados publicados: ambos se entrenaron con *pooling* CLS y Nodus los ejecuta con *mean pooling*. Es una receta previa a este cambio y modificarla exige perfiles nuevos para no invalidar índices existentes.

## Memoria y límites

- llama.cpp b10002 exige que cada entrada quepa en un lote físico y reserva la cabeza de vocabulario de 151.936 tokens para todos ellos (unos 0,6 MB por token). Con la ventana de 8K, Harrier reserva unos 6,4 GB en Metal; BGE-M3, unos 0,6 GB. La descripción del modelo lo indica y recomienda 16 GB.
- La ventana de 8K cubre el límite de 8.000 caracteres en todas las escrituras habituales (español, 2.266 tokens; chino, 4.432; griego, 6.811; hindi, 7.168). Un texto tibetano de esa longitud (10.838 tokens) se rechaza con un error explícito, no se trunca.
- Con la GPU saturada por otros procesos, llama.cpp respondió «Compute error» y el servidor siguió fallando en todas las peticiones posteriores. Nodus retira ahora ese proceso en cuanto terminan sus peticiones y el reintento arranca uno nuevo (`scripts/test-nodus-local-compute-error-restart.mjs`).

## Reproducción

```sh
node scripts/embeddinggemma-qa.mjs replay-corpus --manifest=audit/embeddinggemma-2/corpus-manifest.json
node scripts/embeddinggemma-qa.mjs prepare-child --profile=harrier-oss-v1-0.6b-q8_0 --audit --corpus-root=<raíz reproducida>
node scripts/e2e-embeddinggemma.mjs --profile=harrier-oss-v1-0.6b-q8_0 --no-chat --corpus-root=<raíz reproducida>
```

No se archivan pesos, perfiles, bases de datos ni credenciales. Ninguna prueba usó proveedores de pago.

## Rerankers locales

La búsqueda documental ofrece ahora tres rerankers, cada uno con su descarga, su borrado con confirmación y la selección del que se usa. El BGE Reranker v2 M3 Q8_0 instalado por versiones anteriores (o por `scripts/install-reranker.mjs`) se detecta en su ruta de siempre y no se descarga de nuevo. Los tres arrancan con los argumentos de `electron/ai/localReranker.ts` en llama.cpp b10002 y ordenan primero el pasaje correcto en tres casos multilingües (es→es, en→es, fr→en).

| Reranker | Descarga | Reserva en Metal |
| --- | --- | --- |
| BGE Reranker v2 M3 Q4_K_M | 418 MB | ~0,3 GB |
| Qwen3 Reranker 0.6B Q8_0 (`ggml-org`) | 610 MB | ~4,8 GB |
| BGE Reranker v2 M3 Q8_0 | 606 MB | ~0,4 GB |

GTE Multilingual Reranker Base, que recomienda la guía de modelos, no se ofrece: llama.cpp b10002 rechaza su arquitectura (`unknown model architecture: 'new'`). No se midió la calidad comparada de los rerankers.
