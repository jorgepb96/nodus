# Integración compatible con Desktop 5.12.1 — 18 de octubre de 2026

Se integra `main` `18b16837113fc5741f057914cabc3d55bd71e6cf` sobre el PR móvil Desktop `b8a3b9c9a90354dd1ca4da3622fb08446558b390`, conservando versión 5.12.1. Se resuelven 26 conflictos sin reemplazar el Nodus instalado ni sus perfiles. Los diccionarios de idiomas conservan las incorporaciones de ambas ramas. No se fusiona el PR en GitHub ni se ejecutan Actions.

La recuperación de documentos conserva los textos indexados, las consultas especializadas y las trazas de Desktop actual en el núcleo portable. Las consultas SQL de ideas y sus obras permanecen en el host autorizado; se corrigen dos referencias fuera de ese límite. El auditor de afirmaciones conserva la resolución de sus servicios en cada llamada. El caso académico comprueba el rechazo de una publicación obsoleta antes de simular correctamente el cierre y reapertura de un perfil con pasajes antiguos: no se debilita el control de revisiones.

El contrato del chat móvil admite las capas canónicas `ideas`, `indexed`, `documents`, las opciones Web y el legado `indexedOnly`, manteniendo el rechazo de campos desconocidos y los permisos del vault. Devuelve la verificación efectiva del Mac como metadato; el móvil no modifica ajustes globales ni envía un parámetro de verificación inexistente.

En iPhone se corrigen los controles Web, esfuerzo y verificación, la confirmación del borrado múltiple y una indicación de teclado de escritorio. El recorrido del componente real con transporte simulado pasa en 390×844, 844×390 y 844×200: controles de 44 puntos sin intersecciones, cancelación sin borrar y confirmación exclusivamente de los dos chats seleccionados. Cero llamadas a proveedores. La última corrección del texto orientativo solo afecta CSS de teléfono y su prueba visual; no se atribuye a ella una repetición completa de las pruebas anteriores.

## Validación local ejecutada

En el checkout aislado se instalan las dependencias del lock y se verifica Electron 43.6 con SQLite ABI 148. SDK de macOS 26.2 y Xcode explícitos para evitar mezclar herramientas del SDK 27 del sistema.

- Typecheck frontend y Electron: correcto.
- 25 archivos de pruebas de investigación y chat: 44/44 aprobadas; la evaluación anidada de grounding incluye 38/38.
- Nueve archivos de Bridge y vinculación: 21/21 aprobadas, incluyendo HTTPS, espacio completo, renovación, revocación, descubrimiento y trabajos.
- Seis archivos de Sign y conectores incorporados desde main: 45 aprobadas, cero fallos y una prueba preexistente de instalación real de Sign omitida. Esa instalación no se considera verificada y queda fuera del alcance móvil.
- Hash de fuentes invariable durante los cuatro bloques: `76b2b5751091dd11bf05cf0f5f7942ae5c00b9ac29a87d4e95cf7a2e32690158`. Recibos y logs locales: `artifacts/main-integration-20261018-01/validation-summary-04.json` y logs `*-04`. Se conservan los intentos fallidos anteriores.

Estas pruebas seleccionadas no equivalen al conjunto completo de npm, a una compilación Release ni a aceptación nativa sobre esta integración. Falta promover el laboratorio preservando identidad/certificado/perfiles/permisos, regenerar superficies compartidas, compilar las aplicaciones, comprobar conexión y reconexión reales, recorrer iPad y ejecutar generación real en el Mac. La evidencia anterior sobre b8 conserva su alcance. Los fallos de WebKit en el simulador iOS 26.2 y la conexión VPN sin probar siguen registrados; las pruebas correctas sobre iOS 26.5 no los convierten en aprobados.
