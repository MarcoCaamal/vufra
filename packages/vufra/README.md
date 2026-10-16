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

Native cooperative cancellation is available using `AbortSignal` (Unit 09). There is **no built-in concurrency limit or streaming** in the direct API. Jobs produce full PDFs in memory. For NestJS, use `await renderPdfAsync`, expose the response as `StreamableFile`, and apply app-level job limits. Copyable NestJS reference snippets: `examples/nestjs/pdf.service.ts` and `examples/nestjs/pdf.controller.ts`. These are not compiled/tested as a standalone NestJS application in this repository.

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

`AbortSignal` now cancels queued jobs and can **cooperatively stop active Rust renders** at the next checkpoint. `waitTimeoutMs` still applies only before a job starts. Native work is never force-killed; it consumes a slot until it exits. `close()` rejects pending/new tasks and lets active tasks finish. Count/memory budgets are per queue, within one Node process. Memory budget is an estimate of waiting inputs, **not an RSS or PDF output limit**. Avoid creating one queue per request. For replicated NestJS instances, use external quotas as well.

Runnable example: `node examples/queue-usage.mjs /path/to/font.ttf`. NestJS singleton integration snippets under `examples/nestjs/` are not a compiled NestJS service.

## Native cooperative cancellation and timing

```typescript
import { renderPdfAsync, renderPdfAsyncMeasured, PdfRenderQueue } from 'vufra';

const abort = new AbortController();
const pdf = await renderPdfAsync(document, font, {signal:abort.signal});
const result = await renderPdfAsyncMeasured(document, font);
console.log(result.renderMs); // Native Rust worker render duration in milliseconds

const queue = new PdfRenderQueue({
  maxConcurrent: 2,
  onJobEvent: event => console.log(event.outcome, event.queueMs, event.renderMs),
});
```

`AbortSignal` sets an atomic flag shared with Rust. A cancelled native worker rejects with `PdfRenderCancelledError` / `code='ABORTED'`, then releases its queue slot. Cancellation is cooperative and may be delayed during a third-party shaping/PDF operation; successful renders that complete before the signal takes effect still return PDF bytes. The scheduler collects local counters (`completed`, `failed`, `cancelled`, `rejected`), queue delay, measured Rust time on success, approximate wall time on failure, and output bytes. The callback is best-effort and exceptions within it do not interrupt rendering. Neither RSS nor CPU percentage is measured.

Runnable: `node examples/cancellation-observe.mjs /path/to/font.ttf`.

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

## PNG/JPEG image blocks

```typescript
import { readFileSync } from 'node:fs';
import { renderPdfAsync } from 'vufra';

const pdf = await renderPdfAsync({
  title: 'Photo report',
  blocks: [
    { type: 'heading', level: 1, text: 'Report with logo' },
    { type: 'image', data: readFileSync('logo.png'),
      width: 180, height: 80, fit: 'contain' /* or 'cover' */ },
    { type: 'paragraph', text: 'More selectable text here' }
  ]
}, font);
```

Images are embedded as raw bytes, not file paths. `contain` retains the entire aspect ratio, centered inside the specified box; `cover` crops centered content to fill that box. PNG transparency is supported. JPEG is embedded without unnecessary raster re-encoding. Image boxes are **atomic pagination blocks**: an image that doesn't fit moves to the next page rather than splitting.

Input limits: 8 MiB per image, 32 MiB total encoded images, 64 images, 12 megapixels per image, 24 megapixels total. These checks mitigate costly images but **are not strict process-memory ceilings**. The queue estimates byte size using raw binary length, not JSON arrays, before copying inputs. Images are not supported in the legacy `paragraphs/rows/table` mode, only `blocks`. Absolute positioning and advanced grouping are pending; heading `keepWithNext` for the next block was implemented in Unit 11.

Demo: `node examples/images-usage.mjs /path/to/font.ttf artifacts/images-report.pdf`.

## Lists, vector shapes and keepWithNext (Unit 11)

```ts
const pdf=await renderPdfAsync({
  title:'Visual report',
  blocks:[
    {type:'heading',level:2,text:'Evidence',keepWithNext:true},
    {type:'image',data:jpegBytes,width:180,height:90,fit:'cover'},
    {type:'rule',width:440,height:3,color:'#245fa8'},
    {type:'list',items:['First bullet','Second bullet']},
    {type:'list',ordered:true,items:['Prepare','Validate','Publish']},
    {type:'rectangle',width:300,height:20,color:'#dceaf7'}
  ]
},font);
```

- Lists: 1–1000 non-empty text entries; both numbered and bullet lists can span pages, with 27-point hanging indentation. Markers appear only on the first line of each item.
- Graphics: vector-filled horizontal rule (height up to 8pt) and rectangle, with `#RRGGBB` color, fixed width and height, and page-aware positioning.
- Headings: `keepWithNext` defaults to true; the heading and the first chunk of the next block move together when the group can fit on a fresh page. Set false to disable. It is not a general-purpose multi-block keep-together mechanism.

Runnable: `node examples/graphics-lists-usage.mjs /path/to/font.ttf artifacts/graphics-lists-report.pdf`.

## Explicit embedded font faces and inline rich paragraphs (Unit 12)

```typescript
import {readFileSync} from 'node:fs';
import {renderPdfAsync} from 'vufra';

const pdf=await renderPdfAsync({
  title:'Report',
  fontFaces:{
    bold:readFileSync('MySans-Bold.ttf'),
    italic:readFileSync('MySans-Italic.ttf'),
    serif:readFileSync('MySerif-Regular.ttf'),
  },
  blocks:[
    {type:'rich-paragraph',runs:[
      {text:'Regular text '},
      {text:'genuine bold ',font:'bold'},
      {text:'genuine italic ',font:'italic'},
      {text:'and serif.',font:'serif'}
    ],style:{fontSize:12,lineHeight:19,spaceBefore:8,spaceAfter:8}}
  ]
},regularFontBytes);
```

All faces are caller-supplied, embedded TTF/OTF bytes. `regular` denotes the second argument and need not be provided in `fontFaces`. Names are ASCII identifiers, with up to six additional faces / 12 MiB each / 30 MiB combined. Each run references its explicit face, enabling real bold and italic when the caller supplies the actual bold/italic font. Line wrapping uses Parley advance from that face and Krilla draws that same embedded file; no synthetic styles. Word-wrap, newlines and multiple pages work. The queue safely accounts for fonts using raw `byteLength`, not JSON byte expansion.

**Scope limitation:** No automatic Unicode font fallback, shaping across style boundaries, automatic bold/italic discovery, inline colors or per-run font sizes. This path has been tested primarily for Latin scripts. Existing paragraph/table/heading nodes still use the base regular font.

Example: `node examples/rich-typography.mjs regular.ttf bold.ttf italic.ttf serif.ttf artifacts/rich-typography.pdf`.

## Inline colors, per-run size and opt-in fallback (Unit 13)

```ts
const pdf=await renderPdfAsync({
  title:'Colorful certificate',
  fontFaces:{bold:boldBytes,symbols:symbolsBytes},
  blocks:[{type:'rich-paragraph',runs:[
    {text:'Normal '},
    {text:'LARGE RED ',font:'bold',fontSize:28,color:'#CC3311'},
    {text:'★',fontSize:18,color:'#3355AA',fallbackFonts:['symbols']}
  ]}]
},regularBytes);
```

Each `PdfRichRun` accepts optional `fontSize` (6–36pt), `color` (`#RRGGBB`), and `fallbackFonts` (up to six known font IDs). Fallback is **explicit per word/token**: only if the primary face lacks a codepoint does Vufra select the first nominated face that can draw that whole token, otherwise a clear error. It checks font character maps with `ttf-parser`; it does not query the operating system, split combining grapheme clusters, or guarantee complex-script shaping. Adjacent runs with identical font/size/color/fallback policy coalesce before shaping so words split between compatible API runs remain ligature-eligible.

Line heights grow to fit the largest inline size across a paragraph (currently conservative), while RGB fills are restored after each run. `pdftotext -raw` preserves text stream order; geometric extraction can reorder mixed-size words. No fonts are bundled. Example: `node examples/inline-typography.mjs regular.ttf bold.ttf italic.ttf serif.ttf symbols.ttf artifacts/inline-typography.pdf`.

## Current support

- UTF-8 Spanish/Latin text with caller-supplied TTF/OTF font
- Automatic paragraph/row line-breaking driven by Parley
- A4, Letter and custom-size pages (in ordered blocks mode), with configurable margins
- Error handling for invalid input (including too-tall paragraphs)
- Synchronous and asynchronous PDF generation; Rust renderer requires no filesystem
- Multi-column tables with explicit widths, borders, striped rows and repeated headers
- PNG/JPEG embedded images with transparent PNG, contain/cover cropping and page-aware flow
- Bullet/numbered lists, vector rules and rectangles with RGB fill, and heading keepWithNext
- Explicit embedded font faces and Latin rich paragraphs with real bold/italic/alternate families

**Limitations:** a bounded in-process queue and cooperative native cancellation are available, but streaming, cross-process quotas, RSS/output limits, complex bidi, automatic grapheme-cluster fallback, vector images/SVG, merged cells, rich styles inside tables and custom themes are not implemented. Multi-column table rows split across pages; long paragraphs only split in the new `blocks` flow mode. Unbreakable words wider than the line/cell still fail. The legacy standalone `table` always starts on a fresh page. No prebuilt platform packages; Linux x86_64 only.
