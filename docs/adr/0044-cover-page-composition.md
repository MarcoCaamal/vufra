# ADR-0044 — Página de portada especial y salto diferido (fundación U41)

Estado: funcional en la Fluent API; no equivale todavía a `page masters` independientes.

## Contrato

`document.coverPage({padding,background,radius,border}, cover => cover.heading(...).paragraph(...))` exige que no exista contenido previo. Materializa una caja con `keepTogether:true` para portada, oculta header/footer recurrente **solo en la primera página** mediante `firstHeader(null)` y `firstFooter(null)` y difiere el `pageBreak` hasta que el autor agregue un bloque posterior.

Esto evita el error común de una página extra en un documento que solo tiene portada. El primer bloque después de la portada dispara exactamente un salto, incluso si el autor define bandas posteriormente. Los cuerpos posteriores conservan encabezados/pies de página existentes y las capacidades de paginación.

## Alcance

La portada comparte `PageGeometry` y márgenes con el resto. El fondo coloreado cubre solo la caja decorada, no sangra a bordes de página. Todavía no existen maestras por sección, alternancia par/impar, índices automáticos, referencias internas o distinto tamaño/márgenes por sección. Exigir portada como primer bloque evita comportamientos indeterminados.

Prueba `cover-page.test.mjs`: portada única sin hoja sobrante, documento con 135 filas y encabezados/pies solo después de portada, contenidos sin pérdida y error si se intenta crear la portada después del cuerpo.
