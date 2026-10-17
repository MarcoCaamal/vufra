# ADR-0017 — Fuentes reales, layouts anidados y paginación

Fecha: 2026-10-16. Estado: implementación experimental aceptada en la Unidad 16.

## Problema

Unidad 15 permitía cajas decoradas pero no negritas reales dentro de ellas, ni filas y grids públicos anidados. Faltaban reglas explícitas para agrupación y ruptura de páginas.

## Decisiones

1. Tipografía real: PdfBoxItem::RichText y PdfRowItem::RichText reutilizan PdfTextRun, FontRegistry y prepare_rich. Medir y pintar con la misma fuente TTF/OTF embebida; nunca sintetizar negritas. Se conserva el texto regular anterior. Rechazar fuentes no declaradas.
2. Layout jerárquico acotado: BoxScope.row() y BoxScope.grid() generan PdfRow nativo como hijo atómico de PdfBox. El ancho es la anchura interior de la caja (ancho menos dos paddings); filas/columnas no se fragmentan verticalmente. Se rechaza overflow.
3. Política breakBefore: nueva página solo si la página actual tiene contenido; no insertar páginas iniciales vacías.
4. Política keepTogether: impedir fragmentar cajas; si la caja supera una página imprimible, fallar explícitamente. Para cajas normales grandes, continuar por unidades.
5. Política keepWithNext: mantener caja + primer fragmento del siguiente bloque en una página cuando ambos caben en página vacía; degradar a flujo normal si no es factible. breakBefore explícito prevalece.
6. Seguridad y compatibilidad: presupuestos de texto/imagen cuentan contenido anidado; validación previa NAPI, sin cambio incompatible en API sync, async o cola.

## Límites reconocidos

- Sin box dentro de box, tablas anidadas ni filas/grids divisibles entre páginas. Cada fila/grupo es atómico.
- Sin mantener secciones arbitrariamente grandes ni algoritmo universal de huérfanas y viudas.
- Sin búsqueda automática de fuentes ni fallback universal bidi/RTL. El consumidor entrega archivos TTF/OTF.
- Las decoraciones entre páginas conservan sus reglas anteriores.

## Evidencia

Cargo fmt/clippy workspace sin advertencias; cargo test completo; Node 89/89, seis E2E nuevos. Ejemplo de cinco páginas Letter generado desde examples/fluent-nested.mjs; pdfinfo/pdffonts confirmaron incrustación Noto Sans Regular y Bold, 700 marcadores CLAUSE sin pérdida.

Relacionado: [ADR-0016](0016-decorated-boxes-page-fragments.md).
