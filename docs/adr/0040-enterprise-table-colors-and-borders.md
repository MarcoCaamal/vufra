# ADR-0040 — Bordes, paletas y filas agrupadas (roadmap Unidad 39)

Estado: implementación local incremental. No confundir con `colSpan` o `rowSpan`: aún no soportados.

## Contrato

- `table(rows,{columns,border,headerBackground,oddRowBackground,evenRowBackground})`.
- Los objetos `border:{width?:number,color?:string}` son válidos por tabla, columna o celda; prioridad celda > columna > tabla. Anchura 0..4pt. El borde `width:0` elimina el trazo; las celdas tienen relleno independiente. Valor por defecto igual que la tabla anterior (0.5pt gris).
- Los colores de filas alternas y encabezado se resuelven en el SDK desde el `theme`. El `background` particular de una celda tiene prioridad y los encabezados repiten su mismo fondo en las páginas siguientes.
- `groupTableRows(groups,columnCount,{groupBackground,subtotalBackground,bold?})` construye filas de título, cuerpo y subtotal en la tabla existente. `subtotal` es provisto por el autor: la biblioteca no calcula dinero con `number` flotante ni introduce reglas financieras automáticas. No es `colSpan`, y los títulos de grupo pueden quedar separados de su siguiente fila en un salto de página.
- Celdas vacías explícitas `{text:''}` o `text:''` dentro de una tabla se dibujan como contenido en blanco con altura medida, en lugar de emitir textos inválidos.

## Arquitectura

El SDK calcula rellenos y bordes por celda. `PdfBoxTable.borders` serializa un mapa de estilos opcional por NAPI `NodeBoxTable.borders`, se conserva en `ContentNode::StyledTable` y se pinta en `PreparedBox::draw_table_row`. Rust valida tamaño y valores finitos, preservando cabeceras y filas fragmentadas sin cambiar sus métricas. Los callers nativos que no manden bordes siguen usando el estilo gris original.

## Evidencia

Pruebas Poppler reales en `packages/vufra/tests/table-style-edges.test.mjs` comprueban colores RGB en píxeles de encabezado/filas/bordes, continuidad de 130 facturas y cabecera repetida; grupos con 123 registros + subtotales; rechazos de colores/ancho inválidos y aislamiento entre documentos.

## Aún pendiente

`rowSpan`, `colSpan`, agrupación semántica con `keepWithNext`, totales tipados exactos y optimización de tablas de millones de filas. Requieren otro trabajo de layout/paginación, no una simulación gráfica.
