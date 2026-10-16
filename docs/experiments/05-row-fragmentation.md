# Unidad 04 — Fragmentación de filas y celdas (2026-10-16)

**Hito:** una sola fila multicolumna puede continuar en varias páginas sin duplicar ni perder líneas. El SDK TypeScript mantiene su API anterior.

## Implementación

- `crates/vufra-layout/src/split.rs`: paginador de líneas con `SplitBreakToken { row, line }`, `RowSlice { row, start_line, end_line, first, last }` y `SplitPage`. El cursor solo avanza si hay progreso.
- `crates/vufra-pdf/src/table.rs`: usa el paginador nuevo, sincronizando todas las celdas de la fila mediante un intervalo vertical común. Las celdas más cortas quedan vacías al terminar su contenido.
- El encabezado de la tabla se dibuja nuevamente por página. La celda/columna mantiene borde y sombreado, y la fila siguiente aparece después del último segmento de la fila larga.
- Cuando una fila **cabe entera en una página nueva**, pero no en el espacio restante de la actual, se mueve completa a la siguiente en vez de fragmentarla arbitrariamente.
- El padding superior se aplica solo al primer segmento y el inferior solo al último; el área de encabezado/pie del documento permanece reservada.
- `vufra-layout::paginate_all` anterior sigue disponible para los bloques indivisibles de párrafos y filas sencillas; solo las tablas multicolumna usan paginación nueva.

## Validación

- `cargo test --workspace` cubre tokens inválidos, filas vacías, capacidad mínima, conservación y orden, continuidad tras salto de página y estrés determinista de longitudes.
- `npm test` incluye una fila de 850 identificadores únicos que cruza varias páginas; todos se extraen exactamente una vez, junto al ID de la fila siguiente.
- Caso de dos celdas con longitudes distintas: el avance de línea es compartido, sin duplicación de textos ni aparición extra de la tercera columna.
- Conserva las pruebas anteriores: 600 filas de tabla, 1,000 registros básicos, encabezados, Unicode latino, PDF válido y rechazos por datos inválidos.
- `examples/long-row-usage.mjs` genera `artifacts/long-row.pdf` con 680 fragmentos identificados en una única fila y un ejemplo de fila posterior. El PDF observado tiene **6 páginas** y los identificadores fueron recuperados íntegros por `pdftotext`. Se renderizó la página 2 para inspección.
- Los artefactos son locales y se ignoran en Git, se reconstruyen con el script de ejemplo.

## Ejecución

```bash
bash scripts/build-native.sh
cd packages/vufra && npm ci && npm run build && npm test && cd ../..
FONT=$(fc-match 'Noto Sans' -f '%{file}\n' | head -1)
node examples/long-row-usage.mjs "$FONT" artifacts/long-row.pdf
pdfinfo artifacts/long-row.pdf
pdftotext -layout artifacts/long-row.pdf -
```

## Limitaciones vigentes

- La unidad de fragmentación es **la línea**. Una palabra intrínsecamente más ancha que la columna sigue siendo rechazada; no hay corte arbitrario de palabra ni guionado.
- Solo se fragmentan **filas de `table` multicolumna**; párrafos y `rows` legados continúan indivisibles.
- No hay rowspan/colspan, imágenes en celdas, orientación horizontal, estilos configurables, composición de varias tablas en la misma página, widow/orphan control ni streaming.
- El texto se mide con Parley, pero Krilla todavía renderiza texto simple por línea. No prometemos soporte Unicode complejo o bidi.
- PDF completo en memoria y API síncrona (puede bloquear Node). Proyecto experimental, no publicado.

## Siguiente unidad sugerida

Diseñar fragmentación de párrafos y flujos de bloques con un layout compositor independiente del backend PDF; después soporte asíncrono, estilos y estrategia tipográfica avanzada.
