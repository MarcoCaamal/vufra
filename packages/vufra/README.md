# Vufra Node/TypeScript SDK — experimental

Built using **napi-rs 3** and the Rust crate `vufra-pdf`. This package is not yet published to npm.

## Build locally

From the repository root:

```bash
cargo build --release -p vufra-node
bash scripts/build-native.sh
cd packages/vufra
npm ci
npm run build
npm test
```

## Usage

```ts
import { renderPdf } from 'vufra';
import { readFileSync, writeFileSync } from 'node:fs';

const font = readFileSync('/path/to/NotoSans-Regular.ttf');
const pdf = renderPdf({
  title: 'Reporte de octubre',
  paragraphs: ['¡Hola, Cancún! PDF nativo desde Rust y TypeScript.'],
  rows: Array.from({ length: 1000 }, (_, i) => 'Registro ' + (i + 1))
}, font);

writeFileSync('report.pdf', pdf);
```

## Multi-column tables

```ts
const catalog = renderPdf({
  title: 'Catálogo',
  table: {
    columns: [
      { header: 'Código', width: 110 },
      { header: 'Descripción', width: 270 },
      { header: 'Precio', width: 117 }
    ],
    rows: [
      ['SKU-0001', 'Producto con descripción extensa que puede ocupar varias líneas', '$ 120.00']
    ]
  }
}, font);
```

Column widths use PDF points, add up to **at most 497** on the fixed A4 layout, and have a minimum of 36 points each. The table starts on a new page; headers repeat whenever it continues onto another page. **Rows longer than a single page can continue on subsequent pages without duplicating their text.**

For a complete runnable example, use `node examples/table-usage.mjs path/to/font.ttf artifacts/table-first.pdf` from the monorepo root.

## Unified ordered flow

Use `blocks` to place paragraphs and tables in authored order, without adding blank pages between them. A long paragraph resumes on the next page; a table can start in the remaining space after text.

```ts
const pdf = renderPdf({
  title: 'Unified report',
  blocks: [
    {type: 'paragraph', text: 'Introduction to our report'},
    {type: 'table', table: {
      columns: [
        {header: 'ID', width: 110},
        {header: 'Description', width: 270},
        {header: 'Price', width: 117}
      ],
      rows: [['A-001', 'First record', '$100.00']]
    }},
    {type: 'paragraph', text: 'Conclusions after the table'}
  ]
}, font);
```

**Compatibility:** do not combine `blocks` with legacy `paragraphs`, `rows` or `table`. The legacy mode remains unchanged. Example: `node examples/flow-usage.mjs path/to/font.ttf artifacts/flow-first.pdf`.

## Current support

- UTF-8 Spanish/Latin text with caller-supplied TTF/OTF font
- Automatic paragraph/row line-breaking driven by Parley
- A4 pages, running header/footer and row pagination from Rust
- Error handling for invalid input (including too-tall paragraphs)
- Returns PDF bytes, without requiring a filesystem from the Rust engine
- Multi-column tables with explicit widths, borders, striped rows and repeated headers

**Limitations:** no complex bidi, font fallback, images, merged cells, arbitrary page size or configurable themes. Multi-column table rows split across pages; long paragraphs only split in the new `blocks` flow mode. Unbreakable words wider than the line/cell still fail. The legacy standalone `table` always starts on a fresh page. No prebuilt platform packages; Linux x86_64 only.
