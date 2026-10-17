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

## Fluent API — recommended for new documents (Unit 14)

```ts
import {createVufra} from 'vufra';
import {readFileSync,writeFileSync} from 'node:fs';

const engine=createVufra({font:readFileSync('regular.ttf'),
  fonts:{bold:readFileSync('bold.ttf')},
  theme:{colors:{primary:'#245fa8'},h1:{color:'primary',bold:true,fontSize:24}}
});

const pdf=await engine.document({title:'Invoice',page:'Letter'})
  .row({gap:16},row=>{
    row.column({width:'40%'},col=>{
      col.heading('Seller').paragraph('Company S.A.');
    });
    row.column({width:'60%',align:'right'},col=>{
      col.heading('Invoice').paragraph('INV-2026-001');
    });
  })
  .table(items,{columns:[
    {key:'description',title:'Description',width:'*'},
    {key:'price',title:'Price',width:100}
  ]})
  .render();

writeFileSync('invoice.pdf',pdf);
```

Also supported: `heading`, `paragraph`, `richText`, `box`, `image`, `list`, `divider`, `rectangle`, `spacer`, `section`, `grid`, `pageBreak`, `renderSync`, `enqueue(queue)` and `toDocument()`.

**Important limits:** Rows/grids are measured horizontally. Long ones can split between column items and ordinary Parley-measured text lines. A single rich-text run, image, or giant cell box is still atomic. Styled tables repeat headers but split between complete rows, not within complex cells. Content callbacks are synchronous, fonts are supplied by callers and PDF overlays/charts are pending.

## Decorated boxes with real multipage continuation (Unit 15)

```ts
const pdf = await engine.document({title:'Business report'})
  .box({
    padding:16,
    background:'#EFF5FC',
    border:{width:2,color:'#244A89'},
    width:320,
    align:'right'
  },b=>{
    b.heading('Summary',{level:2,color:'#244A89'});
    b.paragraph('Measured text and long notes can continue on another page.');
    b.divider({height:1,color:'#244A89'});
    b.paragraph('This is drawn by the Rust PDF engine.');
  })
  .render();
```

Box children support paragraphs, images, nested boxes, rich rows/grids and styled tables, with real embedded fonts. Long nested boxes fragment across pages and repaint backgrounds/borders with correct padding; images and individual rich runs remain atomic. No rounded corners, shadows, PDF overlays or SVG yet.

## Layouts anidados y paginación avanzada (Unidad 16)

El builder sigue siendo Fluent: las cajas ahora admiten `row()`, `grid()`, `richText()` y negritas verdaderas a partir de las fuentes que registre el consumidor.

```ts
const pdf=await engine.document({title:'Reporte',page:'Letter'})
  .box({padding:18,background:'#EFF5FC',keepWithNext:true},box=>{
    box.heading('Resultados',{bold:true});
    box.grid({columns:2,gap:12},grid=>{
      grid.cell(c=>c.paragraph('Ingresos',{bold:true}));
      grid.cell(c=>c.paragraph('$125,000'));
    });
    box.richText(text=>{
      text.add('Estado: ');
      text.add('VALIDADO',{bold:true,color:'#008F88'});
    });
  })
  .paragraph('Comentario de gerencia')
  .box({breakBefore:true,keepTogether:true},box=>{
    box.row(row=>{
      row.column(c=>c.paragraph('Responsable',{bold:true}));
      row.column(c=>c.paragraph('Operaciones'));
    });
  })
  .render();
```

`breakBefore` empieza la caja en una página nueva si la actual ya tiene contenido. `keepTogether` evita dividir la caja y **rechaza** los elementos más altos que una página. `keepWithNext` intenta mantener la caja y al menos el comienzo del bloque siguiente en la misma página cuando caben juntos. Las filas y las filas de grid son atómicas (se mueven enteras a otra página o se rechazan si exceden una página). Las cajas largas siguen dividiéndose por líneas.

El ancho de fila y grid anidados se resuelve desde el ancho interno de la caja. Las fuentes, incluyendo la cara `bold`, se suministran explícitamente con `fonts`; una cara desconocida genera error y **no** se sintetiza. Ejemplo completo: `examples/fluent-nested.mjs`. Diseño: `docs/adr/0017-nested-layouts-and-page-policies.md`.

## Low-level AST API (still supported)

```ts
import {renderPdf} from 'vufra';
const pdf=renderPdf({title:'Report',blocks:[
  {type:'heading',level:1,text:'Report'},
  {type:'paragraph',text:'From the original AST API'}
]},font);
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


## Encabezados y pies corporativos (Unidad 17)

La API Fluent incluye header, footer, firstHeader y firstFooter.
Cada banda acepta text, image, row o grid de una fila. Usa la misma
medición Rust que las columnas del cuerpo, con fuentes TTF/OTF incrustadas.

~~~ts
const pdf = await createVufra({font,fonts:{bold}}).document({page:'Letter'})
  .header(h => h.text('Mi empresa', {bold:true}))
  .footer(f => f.text(({page,total}) => 'Página '+page+' de '+total))
  .firstHeader(null)
  .paragraph('Informe')
  .render();
~~~

page y total son marcadores de cadena que se resuelven al paginar en Rust.
null desactiva una banda (también la original). Los márgenes se reservan
automáticamente según el alto máximo de las variantes, sin superponer cuerpo y
bandas. Una banda contiene una sola fila/texto/imagen/grid y, por ahora, no
admite apilar varios bloques ni páginas pares/impares distintas.


## Tablas enriquecidas (Unidad 18)

Dentro de box(), utiliza box.table(rows,{columns}) para diseñar tablas
con texto de varias fuentes, negritas reales, rich runs, rellenos RGB,
colores y logotipos PNG/JPEG. El motor conserva cada fila completa y repite
el encabezado en continuaciones. Los anchos usan el espacio INTERIOR de la caja.

document.tableStyled(rows,{columns}) crea una tabla sin panel visible.
Admite 1–6 columnas (mínimo 60pt cada una) y hasta 1000 filas.

~~~ts
const pdf = await engine.document({title:'Resumen'})
  .tableStyled([
    [{text:'Servicio A',bold:true}, {text:'$150',background:'#DDF0DD'}],
    ['Servicio B', {runs:[{text:'Envío ',bold:true},{text:'premium'}]}]
  ],{columns:[{title:'Concepto',width:'60%'},{title:'Total',width:'40%'}]})
  .render();
~~~

Las filas enriquecidas son indivisibles verticalmente. Si una fila no cabe
en una página vacía, se rechaza. table() clásico sigue fragmentando por líneas.
Los encabezados anidados se repiten; no hay colspan ni rowspan.


## Composición funcional + Fluent compartida (Unidad 19)

La API encadenada sigue vigente. Usa .add(node) o .add([node1,node2])
para insertar componentes reusables con las funciones exportadas:
paragraph(), heading(), image(), box(), grid(), row(), column(), table() y flow().

~~~ts
function Card(label:string,value:string){
  return box({padding:12,background:'#E8F2FC'},[
    paragraph(label), paragraph(value,{bold:true})
  ]);
}
const pdf=await engine.document({title:'Factura'})
  .heading('Resumen')
  .add(Card('Total','$1,200'))
  .render();
~~~

El mismo ContentBuilder se usa en callbacks de box() y secciones del
documento; soporta composición jerárquica y la API encadenada.
Las cajas pueden anidarse hasta ocho niveles con padding/bordes reales.
Las cajas hijas largas pueden continuar entre páginas; keepTogether
rechaza explícitamente una caja que no cabe en una página.
El motor sigue utilizando ASTs nativos especializados detrás de la capa
de nodos lógicos, y no admite aún Box/Table dentro de celdas Row/Grid.
Más información: ADR-0020 y examples/fluent-composition.mjs.


## Árbol geométrico Rust y paginación jerárquica (Unidad 20)

Los boxes anidados muy largos pueden continuar entre páginas:
el motor repinta fondo/bordes y reserva padding real en cada fragmento.
Las tablas dentro de varios boxes conservan encabezados repetidos.

Una Row/Grid larga se corta entre elementos sincronizados de columnas.
El texto normal puede cortarse entre líneas Parley medidas; las
filas cortas preservan su layout anterior. keepTogether y breakBefore
de boxes anidados se respetan.

El árbol geométrico de vufra-layout::tree es independiente de Krilla
pero no sustituye los tipos especializados para contenido y pintura.
Rich-text multi-font individual, imágenes gigantes o boxes muy grandes
dentro de celdas siguen indivisibles y las tablas avanzadas dividen
entre filas. ADR-0021 y examples/fluent-hierarchical.mjs.


## Texto enriquecido paginado en Row/Grid y celdas de tabla (Unidad 21)

Los párrafos rich dentro de Row/Grid y las celdas de cuerpo de tablas
enriquecidas pueden dividirse entre páginas sin perder el font face real,
color RGB ni offsets horizontales de sus spans. El renderer prepara las
líneas una sola vez y conserva el resultado por fragmento, evitando el
shaping distinto en la página siguiente. El encabezado de tabla se
repite y el fondo RGB de las celdas se vuelve a pintar. No hay cambios
en .richText(), .tableStyled(), .box(), ni en la Fluent chaining API.

Vufra Rust añade un semantic view unificado para recorrer contenido de
PdfBlock, PdfBoxItem y PdfRowItem y validar budgets de forma homogénea.
Los enums existentes siguen por compatibilidad: el AST semántico
owned universal queda pendiente. Tope de 500 fragmentos de línea por
fila desbordada; imágenes gigantes, encabezados imposibles, boxes
muy grandes dentro de una única celda y rowspan/colspan aún no se parten.

Ejemplo: examples/fluent-rich-pagination.mjs y ADR-0022.


## AST semántico Rust owned (Unidad 22)

El motor Rust incorpora un AST de entrada owned y recursivo
\`ContentNode\`, \`ContentFrame\`, \`ContentColumn\` y
\`SemanticDocument\`. Las estructuras antiguas \`PdfBlock\`,
\`PdfBoxItem\` y \`PdfRowItem\` se convierten automáticamente al modelo
semántico común antes de validar presupuestos y renderizar. Los tipos
históricos se mantienen como adaptadores para Krilla/NAPI, evitando
cambios a la Fluent API de TypeScript y a los métodos existentes.

Rust también expone \`render_semantic_pdf\` para construir documentos
desde nodos propios, sin necesidad de Node.js ni JSON. Incluye adapters
seguros que rechazan relaciones inválidas para evitar perder
\`keepWithNext\`, colores o estilos.

La etapa geométrica \`vufra-layout::tree::LayoutNode\` sigue paginando
contenedores, filas y tablas. La nueva capa semántica no cambia sus
reglas de 8 niveles, 500 fragmentos de fila ni los límites de imágenes.
La normalización del input legacy owned puede clonar datos grandes;
el renderer Krilla preparado todavía usa sus estructuras especializadas.

Ejemplo: \`crates/vufra-pdf/examples/owned-semantic.rs\`,
documentación: ADR-0023.
