# ADR-0043 — Barras vectoriales y columnas alineadas (fundaciones U40/U42)

Estado: primera implementación local; no sustituye todavía una biblioteca completa de gráficos.

## Layout de columnas (U40)

`row.column({width,align:'left'|'center'|'right',verticalAlign:'top'|'center'|'bottom',padding:{top,right,bottom,left}})` usa el metadato opcional `PdfRowColumn.cell` introducido en U38 para medir/anclar contenido de columna, también fuera de tablas. El padding es por lado y se valida antes del render. Las columnas estándar sin nuevas propiedades conservan el mismo modelo previo. El texto se centra usando Parley y la alineación vertical se determina con la altura real del `PdfRow`, no aproximaciones en JS. Los valores de padding de una columna y sus hijos siguen siendo gestionados por el mismo renderizador Rust. Esto no es un sistema general de CSS Flexbox ni permite alturas mínimas/máximas de boxes.

## Gráfico de barras (U42)

`document.barChart(data,{color,barHeight,maxValue,gap})` y el componente funcional `barChart(data,options)` aprovechan los `row` nativos y los rectángulos vectoriales Krilla ya existentes. Cada barra conserva su etiqueta y valor como texto seleccionable; las filas saltan entre páginas junto con su barra. Los datos son `{label:string,value:number}` con valores finitos no negativos, máximo de escala >0, longitud 1–1000 filas raíz y 1–250 en box. Un valor cero no dibuja barra, mantiene su etiqueta. Sin datos internos compartidos, cachés nuevas ni rasterización. `color` permite token de tema.

## Limitaciones

Todavía no hay barras apiladas, ejes, marcas, series múltiples, leyendas, gráfica de líneas/pie ni QR/código de barras. El chart admite sólo número de valor en texto plano, no cálculo contable ni formateo local. Para trazados avanzados y QR se necesitan más primitivas vectoriales nativas y pruebas de legibilidad/correctitud.

## Evidencia

`row-layout-align.test.mjs` comprueba coordenadas X/Y reales con Poppler; `chart-bars.test.mjs` verifica 145 valores únicos en varias páginas y raster RGB de rectángulos vectoriales, y rechazos de geometrías/escala inválidas. Demostración: `examples/fluent-visual-report.mjs`.
