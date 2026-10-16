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

## Async PDF generation for backend servers

```typescript
import { renderPdfAsync } from 'vufra';

const pdf = await renderPdfAsync({
  title: 'Report',
  blocks: [{ type: 'paragraph', text: '¡Hola, Cancún!' }]
}, font);
```

The async method runs CPU-heavy rendering on a native libuv worker via napi-rs `AsyncTask`, keeping the event loop responsive. `renderPdf` remains synchronous, sharing the same validation and PDF engine. Both methods use the same document schema and embedded caller-supplied font.

There is **no built-in concurrency limit, cancellation or streaming**. Jobs produce full PDFs in memory. For NestJS, use `await renderPdfAsync`, expose the response as `StreamableFile`, and apply app-level job limits. Copyable NestJS reference snippets: `examples/nestjs/pdf.service.ts` and `examples/nestjs/pdf.controller.ts`. These are not compiled/tested as a standalone NestJS application in this repository.

Run `node examples/async-usage.mjs /path/to/font.ttf artifacts/async-first.pdf` from repo root.

## Bounded queue for Node.js and NestJS

Use `PdfRenderQueue` when many concurrent requests may generate large PDFs. The queue is opt-in; bare `renderPdfAsync()` continues to work.

```typescript
import { PdfRenderQueue, PdfQueueError } from 'vufra';

const queue = new PdfRenderQueue({
  maxConcurrent: 2, maxQueued: 8,
  maxQueuedBytes: 24 * 1024 * 1024,
  maxJobBytes: 16 * 1024 * 1024,
});

try {
  const result = await queue.render(document, font, { waitTimeoutMs: 5_000 });
} catch (error) {
  if (error instanceof PdfQueueError && error.code === 'QUEUE_FULL') {
    // Return 503 (or 429 when your own request-rate policy is responsible).
  }
}

console.log(queue.stats);
queue.close();
```

Only waiting tasks can be removed by `AbortSignal` or `waitTimeoutMs`; **running native work cannot be cancelled** and consumes a slot until settled. `close()` rejects pending/new tasks and lets active tasks finish. Count/memory budgets are per queue, within one Node process. Memory budget is an estimate of waiting inputs, **not an RSS or PDF output limit**. Avoid creating one queue per request. For replicated NestJS instances, use external quotas as well.

Runnable example: `node examples/queue-usage.mjs /path/to/font.ttf`. NestJS singleton integration snippets under `examples/nestjs/` are not a compiled NestJS service.

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

## Semantic headings, styling and page geometry

```ts
const styled = renderPdf({
  title: 'Report',
  page: {format:'letter', margins: {top:135,bottom:72,left:56,right:56}},
  blocks: [
    {type:'heading',level:1,text:'Executive summary'},
    {type:'styled-paragraph',text:'Customized text',
     style:{fontSize:12,lineHeight:19,spaceBefore:12,spaceAfter:12}},
    {type:'spacer',height:25},
    {type:'heading',level:2,text:'Conclusion'}
  ]
}, font);
```

`page` is flow-only. Presets: `a4` (default) and `letter`. Custom `width` and `height` in points must both be present; optional margins are `top,bottom,left,right` in points. Supported headings are levels 1–3; per-paragraph style covers font size, line height and vertical spacing. A table's total column width is limited by the printable width of the selected page.

Runnable: `node examples/styled-document.mjs /path/to/font.ttf artifacts/styled-document.pdf`.

## Current support

- UTF-8 Spanish/Latin text with caller-supplied TTF/OTF font
- Automatic paragraph/row line-breaking driven by Parley
- A4, Letter and custom-size pages (in ordered blocks mode), with configurable margins
- Error handling for invalid input (including too-tall paragraphs)
- Synchronous and asynchronous PDF generation; Rust renderer requires no filesystem
- Multi-column tables with explicit widths, borders, striped rows and repeated headers

**Limitations:** a bounded in-process queue is available, but native render cancellation, streaming, cross-process quotas, RSS/output limits, complex bidi, font fallback, images, merged cells, per-span rich-text styles and custom themes are not implemented. Multi-column table rows split across pages; long paragraphs only split in the new `blocks` flow mode. Unbreakable words wider than the line/cell still fail. The legacy standalone `table` always starts on a fresh page. No prebuilt platform packages; Linux x86_64 only.
