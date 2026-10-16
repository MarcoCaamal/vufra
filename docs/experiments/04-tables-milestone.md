# Unidad 03 — Tablas multicolumna (2026-10-16)

**Hito:** API Rust y TypeScript genera una tabla real de 1–12 columnas con anchura por columna en puntos PDF, celdas con ajuste de texto, encabezado repetido y paginación por filas.

## Implementación

- `crates/vufra-pdf/src/table.rs`: `PdfTable`, `PdfColumn`, `prepare_table`, `draw_table_fragment`.
- `crates/vufra-pdf/src/lib.rs`: `PdfDocument.table: Option<PdfTable>` y render de páginas de tabla posteriores al flujo anterior.
- `bindings/vufra-node/src/lib.rs`: objetos tipados `NodeTable`, `NodeTableColumn` mediante NAPI-RS.
- `packages/vufra/src/index.ts`: interfaces `PdfTable`, `PdfColumn`, validación de anchos, estructura y tipos.
- `examples/table-usage.mjs`: catálogo PDF multipágina reproducible.

## Reglas actuales

- Tamaño A4, zona de contenido de **497 pt** de ancho y 650 pt de altura, ya descontados márgenes y encabezado/pie generales.
- Cada ancho >=36 pt; suma <=497 pt. Medida en puntos PDF, no porcentajes ni píxeles.
- Fuente TTF/OTF suministrada por quien usa el SDK; medición de líneas con Parley (sin fuentes de sistema en el motor).
- Hasta 12 columnas y 10,000 filas por tabla. Cada fila debe contener tantas celdas como columnas.
- Altura de fila = máximo de líneas medidas entre celdas + padding; la fila es indivisible.
- Encabezado de tabla con altura medida, repetido al inicio de todas las páginas de la tabla.
- Fondo celeste del encabezado, franjas alternadas y bordes finos; texto negro seleccionable.
- Páginas de tabla **separadas** del flujo de párrafos y filas sencillas existentes; el pie refleja numeración total del documento.
- Una tabla vacía (sin filas) dibuja solamente los encabezados, sin página de contenido adicional.
- Entradas inválidas devuelven errores tipados de Rust y errores normales de JavaScript, sin loops de paginación.

## Evidencia local

- Tests `node --test tests/*.test.mjs`: **10 pruebas pasadas**; el test de 600 filas generó **40 páginas** y la extracción `pdftotext` recuperó los 600 IDs en orden.
- La cantidad de apariciones del encabezado en el test coincide con el total de páginas de tabla.
- Caso mixto (párrafos + tabla), sin filas, límite de anchura, error por celdas faltantes, celda sin cortes y fila más alta que la página cubiertos en pruebas.
- Ejemplo `artifacts/table-first.pdf`: **200 filas en 14 páginas**, una de párrafos y trece de tabla, artefacto local no versionado.
- Segunda página rasterizada con `pdftoppm` e inspeccionada visualmente: grid, encabezados, sombreado, wrapping, pie y alineación visibles sin colisión aparente.
- Se mantienen los tests de la Unidad 02, `cargo fmt`, `cargo clippy`, `cargo test` y script de regresión de la Unidad 01.

## Ejemplo

```typescript
const pdf = renderPdf({
  title: "Productos",
  table: {
    columns: [
      { header: "Código", width: 110 },
      { header: "Descripción", width: 270 },
      { header: "Precio", width: 117 },
    ],
    rows: [["SKU-0001", "Producto en Cancún", "$100.00"]],
  },
}, fontBytes);
```

## Limitaciones

- No se permite que una sola fila se divida entre páginas.
- No hay rowspan/colspan, bordes configurables, alineación distinta por columna, imágenes en celdas ni porcentajes de ancho.
- Parley se usa para saltos de línea; **Krilla dibuja texto simple por línea**. No garantizar scripts complejos, bidi o fallback.
- API síncrona: operaciones muy grandes pueden bloquear el event loop. No está listo para producción, npm público ni plataformas distintas a la probada.

## Próximo objetivo arquitectónico

Fragmentación **dentro** de una celda/fila multipágina, estilos tipados y flujo compuesto de secciones; después render asíncrono y soporte tipográfico completo.
