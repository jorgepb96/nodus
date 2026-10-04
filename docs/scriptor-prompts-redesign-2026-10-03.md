# Biblioteca de prompts de Nodus Scriptor · 3 de octubre de 2026

El modal adopta las superficies blancas, divisores finos y acentos violetas del editor y sus diálogos académicos. La cabecera mantiene el símbolo de tres estrellas de IA. La búsqueda y «Nuevo prompt» ocupan una fila fija; la lista y el texto del prompt se desplazan de forma independiente.

Editar y eliminar permanecen en la cabecera de la ficha. Aplicar, cancelar y guardar permanecen en un pie fijo. Los prompts incluidos mantienen sus acciones desactivadas y una explicación visible. Los títulos largos pueden ocupar varias líneas; la ventana estrecha apila la lista sobre la ficha sin introducir desplazamiento horizontal.

La búsqueda conserva la consulta por nombre, descripción y contenido, e informa cuando no hay resultados. Se mantienen los cuatro accesos rápidos, los iconos personalizados y la configuración de cada prompt. El borrado conserva la confirmación existente; Escape vuelve a la ficha y el foco del teclado permanece en la confirmación mientras está abierta.

La estrella de un acceso rápido marcado se muestra rellena tanto en la lista como en el pie de la ficha; al desmarcarlo vuelve al contorno. El estado permanece visible al seleccionar otro prompt y funciona en ambos temas. `node --test scripts/test-study-improve-ui.mjs` verifica los estilos calculados del SVG en el componente real, los cambios con ratón y teclado, la reapertura y el límite de cuatro accesos rápidos. La prueba reproduce el fallo antes de aplicar la corrección.

[Antes, tema claro](screenshots/scriptor/prompt-stars/before-light.png) · [Después, tema claro](screenshots/scriptor/prompt-stars/after-light.png) · [Después, tema oscuro](screenshots/scriptor/prompt-stars/after-dark.png). Las capturas usan datos sintéticos y el componente real con los estilos de la aplicación.

## Verificación

- `node scripts/e2e-scriptor-prompts.mjs`: lectura y edición con un prompt de más de 7.000 caracteres en 1280×800, 1440×900, 1920×1080, 900×700 y 600×800, con temas claro y oscuro. Comprueba que búsqueda, editar, eliminar y aplicar mantienen su posición y reciben clics tras desplazar ambas zonas. Sin desbordamiento horizontal.
- Creación, edición, borrado confirmado y cancelado, búsqueda por contenido, estado sin resultados, protección de los prompts incluidos y límite de cuatro accesos rápidos. La edición conserva contenido, idioma, temperatura, instrucciones de sistema e icono. El documento permanece intacto.
- `node --test scripts/test-study-improve-ui.mjs` y `node scripts/test-study-improve.mjs`: comprobaciones de UI, estilos guardados, versiones, protección y migraciones. Se retiraron las expectativas antiguas de clases Tailwind del modal y de la corrección en streaming que mutaba el documento durante la vista previa.
- Se sincronizó `SCHEMA_VERSION` con la migración académica 199 ya registrada; no se añadió ni alteró SQL de migración.
- Typecheck y compilaciones de escritorio/web. La revisión del modal no realiza solicitudes a proveedores de IA.
- `node scripts/e2e-scriptor-polish.mjs`: flujo de mejora con prompts guardados, streaming controlado, cancelación y deshacer; la IA usa un transporte de prueba y no llama a un proveedor externo.

[Galería de 24 capturas](../output/qa/scriptor-prompts-redesign/index.html) y [resultados](../output/qa/scriptor-prompts-redesign/results.json). Se inspeccionaron visualmente las vistas de lectura, edición, búsqueda, prompts incluidos y la distribución estrecha.

La vista de prueba queda abierta con «Académico v3» seleccionado. Se compararon el JSON nativo, Markdown y todos los prompts antes y después de abrir el modal y desplazar su contenido: permanecen iguales. [Captura real del modal](../output/qa/scriptor-prompts-redesign/user-prompts-top.png) y [comprobación de preservación](../output/qa/scriptor-prompts-redesign/user-preview-check.json).
