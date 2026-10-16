# Vufra 🦀

Motor PDF **open source** escrito en Rust. Incluye un **SDK experimental para Node.js/TypeScript** que llama al motor Rust mediante N-API, sin Chromium ni HTML.

> **Estado actual: prototipo funcional (2026-10-16).** El API y el empaquetado todavía no son estables ni adecuados para producción. Nada está publicado en npm o crates.io.

## ¡Ya puedes generar documentos con TypeScript!

```typescript
import { renderPdf } from 'vufra';
import { readFileSync, writeFileSync } from 'node:fs';

const font = readFileSync('/ruta/a/NotoSans-Regular.ttf');
const bytes = renderPdf({
  title: 'Reporte de ventas',
  paragraphs: ['¡Hola, Cancún! Documento generado desde Rust y Node.js.'],
  rows: Array.from({ length: 1000 }, (_, i) => 'Registro ' + (i + 1))
}, font);

writeFileSync('reporte.pdf', bytes);
```

La API Rust subyacente vive en `crates/vufra-pdf`: `render_pdf(&PdfDocument, &[u8], RenderOptions)`.

También puedes pasar una tabla de varias columnas:

```typescript
const pdf = renderPdf({
  title: 'Inventario',
  table: {
    columns: [
      { header: 'Código', width: 100 },
      { header: 'Descripción', width: 275 },
      { header: 'Precio MXN', width: 122 }
    ],
    rows: [
      ['SKU-0001', 'Producto de Cancún', '$ 145.00'],
      ['SKU-0002', 'Artículo con una descripción que puede ocupar varias líneas', '$ 290.00']
    ]
  }
}, font);
```

Los anchos están expresados en puntos PDF y no pueden sumar más de 497 puntos en el área A4 actual. **Esta API antigua de `table` comienza en una página nueva**; en el nuevo modo `blocks` las tablas pueden compartir página con los párrafos y se repite el encabezado cuando continúan.

### Nuevo: compositor unificado (`blocks`)

Los bloques se renderizan en el orden indicado, utilizando el espacio restante de la página. Los párrafos largos pueden continuar en páginas siguientes sin perder texto.

```typescript
const bytes = renderPdf({
  title: 'Informe unificado',
  blocks: [
    { type: 'paragraph', text: 'Introducción al reporte.' },
    { type: 'table', table: {
      columns: [
        { header: 'Código', width: 110 },
        { header: 'Concepto', width: 270 },
        { header: 'Monto', width: 117 }
      ],
      rows: [['A-001', 'Concepto registrado', '$100.00']]
    }},
    { type: 'paragraph', text: 'Conclusiones después de la tabla.' }
  ]
}, font);
```

El modo `blocks` es alternativo: **no se combina** con los campos antiguos `paragraphs`, `rows` o `table`. Estos últimos siguen funcionando con el comportamiento anterior.

### Iniciar en el workspace

Requisitos: Rust **1.92**, Node.js **20+**, npm, compilador de Rust/C disponible, fuente TTF/OTF propia y Poppler para pruebas PDF.

```bash
# Desde la raíz de Vufra
bash scripts/build-native.sh
cd packages/vufra
npm ci
npm run build
npm test
cd ../..

# Crear un ejemplo de 1,000 registros
FONT=$(fc-match 'Noto Sans' -f '%{file}\n' | head -1)
node examples/sdk-usage.mjs "$FONT" artifacts/sdk-first.pdf
node examples/table-usage.mjs "$FONT" artifacts/table-first.pdf
node examples/long-row-usage.mjs "$FONT" artifacts/long-row.pdf
node examples/flow-usage.mjs "$FONT" artifacts/flow-first.pdf
pdfinfo artifacts/sdk-first.pdf
```

El archivo generado es `artifacts/sdk-first.pdf`; se ignora en Git. **La fuente la proporciona el usuario**; no empaquetamos ni redistribuimos fuentes externas.

## Hitos

| Unidad | Hito | Estado |
|---|---|---|
| 00 | Diseño y decisiones del proyecto | Completada |
| 01 | Prototipos `pdf-writer`, `krilla`, Parley y tablas 1,000 filas | Completada |
| 02 | API Rust reusable, texto medido con Parley, SDK TypeScript + N-API | Prototipo funcional |
| 03 | Tablas multicolumna con medidas, bordes, encabezados repetidos y paginación | Prototipo funcional |
| 04 | Continuación de una fila de tabla a través de varias páginas | Prototipo funcional |
| 05 | Compositor ordenado de tablas y párrafos fragmentables | Prototipo funcional |
| Más adelante | Bindings multiplataforma, publicaciones, estabilidad | Pendiente |

## Arquitectura implementada

```text
packages/vufra/src/index.ts   SDK TypeScript (validación y tipos)
             │
             ▼
bindings/vufra-node            API nativa con NAPI-RS
             │
             ▼
crates/vufra-pdf               Composición y escritura PDF con Krilla
           │       │
     Parley       vufra-layout  -> BreakToken
                      │
                  vufra-core

experiments/sp-01-*            Comparación de escritores (Unidad 01)
experiments/sp-02-parley       Medición aislada (Unidad 01)
experiments/sp-03-pagination   PDF de 1000 filas (Unidad 01)
```

## Calidad y límites

Ejecutar:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
bash scripts/verify-experiments.sh
cd packages/vufra && npm test
```

La Unidad 02 comprobó texto en español, párrafos con ajuste de línea, 1,000 registros ordenados sin pérdida/duplicación, PDFs multipágina y errores de entrada controlados.

**No soporta aún:** texto RTL/shaping complejo, fallback de fuentes, imágenes, celdas combinadas, estilos arbitrarios ni tamaños de página configurables. **En el modo `blocks`, los párrafos y las filas de tablas multicolumna continúan entre páginas; en el modo heredado, párrafos y filas simples siguen indivisibles.** Palabras inquebrantables más anchas que una columna generan error. Solo se ha probado Linux x86_64.

## Documentación

- [Plan de W0](docs/planning/01-w0-workspace.md)
- [Arquitectura conceptual](docs/architecture/overview.md)
- [Resultados de Unidad 01](docs/experiments/02-results.md)
- [Resultados y guía Unidad 02](docs/experiments/03-sdk-milestone.md)
- [Unidad 03 — Tablas multicolumna](docs/experiments/04-tables-milestone.md)
- [Unidad 04 — Filas fragmentables](docs/experiments/05-row-fragmentation.md)
- [Unidad 05 — Compositor unificado](docs/experiments/06-unified-flow.md)
- [ADR-0001 Licencia](docs/adr/0001-license.md)
- [ADR-0002 Monorepo](docs/adr/0002-monorepo.md)
- [ADR-0003 Writer PDF y SDK Node](docs/adr/0003-prototype-pdf-and-node.md)
- [ADR-0004 Tablas multicolumna](docs/adr/0004-table-layout.md)
- [ADR-0005 Fragmentación por líneas](docs/adr/0005-split-row-pagination.md)
- [ADR-0006 Flujo de contenido ordenado](docs/adr/0006-unified-flow.md)
- [Paquete TypeScript](packages/vufra/README.md)

## Licencia

**MIT OR Apache-2.0**. Textos en [LICENSE-MIT](LICENSE-MIT) y [LICENSE-APACHE](LICENSE-APACHE).
