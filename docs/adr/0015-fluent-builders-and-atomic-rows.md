# ADR-0015 — API Fluent con callbacks sobre AST único

- **Fecha:** 2026-10-16
- **Estado:** aceptado para prototipo experimental (Unidad 14).

## Motivación

Vufra tiene compositor Rust y AST de bajo nivel potentes, pero exigir `{type:'rich-paragraph',runs,...}` para cualquier documento incrementa complejidad accidental. El objetivo de la biblioteca es generar PDFs desde TypeScript/NestJS sin administrar manualmente cada posición.

## Decisiones

1. La **API principal** será `createVufra({font,fonts,theme}).document(options).heading(...).paragraph(...).table(...).render()`. El usuario puede utilizar `vufra.document({font})` sin configuraciones globales. Los archivos de fuente los proporciona el consumidor: no se usan fuentes implícitas del SO ni se redistribuyen fuentes de terceros.
2. `DocumentBuilder` será *estructuralmente inmutable*: cada método devuelve un builder nuevo. Se copian bytes de configuración y bloques al crearlo/agregarlos para aislar documentos concurrentes. `toDocument()` devuelve una instantánea del AST existente. `render()` es asíncrono; `renderSync()` y `enqueue(queue)` exponen las rutas ya existentes, sin añadir un segundo motor.
3. En las zonas jerárquicas, `row({gap}, row=>row.column({width,align},col=>...))`, `grid({columns},grid=>grid.cell(...))`, `section(title?,section=>...)` y `richText(text=>text.add(...))` permiten composición con callbacks de TypeScript. Los scopes son temporales y **estrictamente síncronos**: deben preparar datos externos antes de construir el layout; el scope se cierra al terminar su callback.
4. El motor Rust añade `PdfBlock::Row(PdfRow)` con ancho explícito por columna, separación en puntos, texto medido por Parley en su ancho correspondiente, alineación izquierda/derecha por avance de texto medido, y PNG/JPEG/figuras/espacios dentro de columnas. Los bloques Row se posicionan realmente uno al lado del otro. El `row` es **atómico**, pasa íntegro a otra página o devuelve error si excede el alto imprimible. Las tablas existentes siguen siendo el mecanismo robusto para datos multipágina y conservan filas segmentables y encabezados repetidos.
5. Las anchuras de columnas admiten puntos, `'40%'` o `'*'`, resolviendo los flexibles sobre el espacio disponible menos los gaps. Se rechazan grupos con más de seis columnas, anchos menores a 60pt y un total que exceda el ancho imprimible.
6. `grid` utiliza filas nativas independientes, no un posicionamiento visual simulado. `section` agrupa semánticamente en el builder (flatten de bloques) y puede insertar heading con `keepWithNext`; **no ofrece todavía keepTogether general de toda la sección**.
7. `table(rows,{columns})` soporta objetos tipados y `PdfTable` heredada, inferencia de columnas por propiedades, anchos fijos/flexibles y conversión de valores a celdas de texto. La salida se delega a la implementación de tablas de Rust; solicitudes de desactivar las bandas o la repetición del header se rechazan porque todavía no está disponible.
8. `heading`, `paragraph`, `richText`, `image`, `divider`, `rectangle`, `list`, `spacer` y `pageBreak` emiten bloques compatibles con el AST existente. Los títulos con fuente/color personalizado se convierten a rich paragraphs y conservan `keepWithNext`, ahora soportado por el paginador de Rust.
9. Los temas permiten nombres de colores `theme.colors.primary`, estilo de texto y heading `h1/h2/h3`; no simulan fuentes bold: `bold:true` exige un archivo bold configurado. Opciones que no pueden cumplirse provocan errores claros.
10. El `PageBreak` introducido en el paginador permite saltos explícitos sin insertar páginas vacías en caso de saltos consecutivos o al final.

## Restricciones y decisiones diferidas

- `row`/`grid` atómicos: no dividen una columna dentro de una misma fila entre páginas. Para contenidos largos utilizar `table` o contenido secuencial.
- Por ahora las columnas pueden contener texto regular con estilo de tamaño/interlineado, imagen, regla, rectángulo y spacer; no texto enriquecido por span, tablas anidadas, grids anidados ni cajas decoradas.
- **No se implementan aún** `box({padding,border,background})`, encabezados y pies personalizables, numeración configurable ni `fromPdf()/overlay()`, `signature()` o `chart()`. El header/footer actual permanece en el motor como antes; no anunciar APIs que no existen.
- La geometría existente reserva márgenes verticales para ese header/footer (top >= 110pt, bottom >=50pt). `margins` es por lados, no un shorthand numérico uniforme.
- No hay un layout CSS con flexbox completo, saltos de sección multi-block keep-together, RTL garantizado, PDFs etiquetados ni streaming.
- La versión npm continúa privada/experimental y no tiene bundles nativos Windows/macOS.

## Compatibilidad

Ninguna API previa `renderPdf`, `renderPdfAsync`, `PdfRenderQueue` cambia de nombre o obligatoriedad. El AST subyacente recibe únicamente nuevas variantes opcionales. Las pruebas de regresión existentes se ejecutan junto a las pruebas Fluent.

## Criterios de prueba

Pruebas e2e con PDF real usando Poppler para ubicar columnas vía bbox, comprobar tamaños y texto sin overlap, fuente bold incrustada, 480 registros de una factura que sobreviven a la paginación, encabezados de tabla repetidos y documento empresarial con varios bloques. Se inspecciona visualmente el PDF demo rasterizado y se instala el tarball en un consumidor Node independiente.
