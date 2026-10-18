# ADR-0041 — `colSpan` real en tablas paginadas (U39)

Estado: implementación local. `rowSpan` todavía no se admite y se rechaza explícitamente.

## Decisión

`StyledTableCell` acepta `colSpan?:number` entero ≥1; una fila debe cubrir exactamente las columnas declaradas en `columns`, sin huecos ni solapamientos. La cabecera conserva columnas simples; el cuerpo puede incluir filas con cualquier combinación de celdas horizontales contiguas. Para una celda fusionada, la columna física de `PdfRow` mide la **suma real** de los tracks declarados. El `PdfBoxTable` permite diferentes números de celdas por fila sin relajar la geometría: cada borde derecho de una celda física debe caer en una frontera acumulada de la cabecera, y el ancho final de cada fila debe coincidir con el de la tabla.

Las matrices opcionales `fills` y `borders` contienen una entrada por **celda física** (no por columna lógica) de cada fila. NAPI y Rust validan consistencia, y Rust dibuja un único rectángulo del ancho combinado. El título de grupos usa `colSpan:columnCount`. El paginador conserva líneas de texto, rellenos, saltos y header por página porque sigue tratando la fila real como `PdfRow` y conserva índices de tabla.

## No alcance

`rowSpan` exige resolver la altura de un grupo de filas y gestionar su división por páginas; no se simula con texto vacío, columnas falsas ni bordes ocultos. Se rechaza en la Fluent API para evitar pérdida de semántica. Agrupaciones no mantienen automáticamente su título junto a la siguiente fila si cruzan páginas. Mejorarlo requiere un bloque agrupado en el paginador.

## Verificación

`packages/vufra/tests/table-colspan.test.mjs` inspecciona el AST owned generado, la anchura de la celda unida, 180 IDs extraídos en orden, cabecera repetida y rechazos de spans inválidos, incluida solicitud de rowSpan.
