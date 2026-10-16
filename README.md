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

### Generación asíncrona para Node.js y NestJS (Unidad 07)

```typescript
import { renderPdfAsync } from 'vufra';

const bytes = await renderPdfAsync({
  title: 'Reporte de operaciones',
  blocks: [
    { type: 'heading', level: 1, text: 'Resultados' },
    { type: 'paragraph', text: '¡Hola, México!' }
  ]
}, font);
```

`renderPdfAsync` ejecuta el render PDF en una tarea nativa de libuv y devuelve una `Promise<Uint8Array>`; en Node el valor es un `Buffer`. La validación inicial y copia de inputs sigue siendo síncrona y la memoria se mantiene hasta completar cada tarea. La **Unidad 09 añadió cancelación cooperativa** mediante `AbortSignal`, sin terminar hilos bruscamente. No hay streaming ni límite global de concurrencia incorporado en la API sin cola: los servidores deben controlar los jobs. La API `renderPdf` sincrónica sigue funcionando.

Ejemplos: `examples/async-usage.mjs` y `examples/nestjs/` (los últimos son snippets de integración, no una aplicación NestJS compilada).

### Nuevo: cola con límites y backpressure (Unidad 08)

Para servidores puedes usar una cola **opt-in**, independiente de `renderPdfAsync()`:

```typescript
import { PdfRenderQueue } from 'vufra';

const queue = new PdfRenderQueue({
  maxConcurrent: 2, maxQueued: 8,
  maxQueuedBytes: 24 * 1024 * 1024,
  maxJobBytes: 16 * 1024 * 1024,
});

const pdf = await queue.render(document, font, { waitTimeoutMs: 5000 });
console.log(queue.stats);
queue.close(); // Solo rechaza los trabajos pendientes
```

Los trabajos que no caben en la cola fallan con `PdfQueueError.code` (`QUEUE_FULL`, etc.). Desde la Unidad 09, `AbortSignal` **cancela cooperativamente también renders nativos iniciados**, cuando Rust alcanza el siguiente checkpoint; `waitTimeoutMs` sigue siendo exclusivamente un límite de espera. Los límites son locales por cola/proceso, no globales entre instancias/pods. El presupuesto de bytes estima entradas en cola, **no limita la RAM total**.

### Nuevo: cancelación Rust y métricas (Unidad 09)

```typescript
import { renderPdfAsyncMeasured, PdfRenderQueue } from 'vufra';

const controller = new AbortController();
const result = await renderPdfAsyncMeasured(document, font, {
  signal: controller.signal
});
console.log(result.renderMs, result.pdf.byteLength);

// O bien observar los trabajos que pasan por la cola:
const queue = new PdfRenderQueue({
  maxConcurrent: 2,
  onJobEvent: ({ outcome, queueMs, renderMs, outputBytes }) => {
    console.log({ outcome, queueMs, renderMs, outputBytes });
  }
});
```

`renderPdfAsync(document, font, {signal})` mantiene su tipo `Promise<Uint8Array>`. Si Rust observa la cancelación antes de completar, la promesa rechaza `PdfRenderCancelledError` con `code='ABORTED'`. No existe cancelación instantánea dentro de llamadas indivisibles a Parley o Krilla, ni timeout total de CPU. Los contadores y duraciones de la cola son **locales al proceso**.

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

### Nuevo: nodos semánticos, estilos y geometría de página (Unidad 06)

```typescript
const styled = renderPdf({
  title: 'Informe ejecutivo',
  page: { format: 'letter', margins: { top: 135, bottom: 72, left: 56, right: 56 } },
  blocks: [
    { type: 'heading', level: 1, text: 'Resumen ejecutivo' },
    { type: 'styled-paragraph', text: 'Contenido personalizado', style: {
      fontSize: 12, lineHeight: 19, spaceBefore: 10, spaceAfter: 14
    }},
    { type: 'spacer', height: 24 },
    { type: 'heading', level: 2, text: 'Conclusiones' },
    { type: 'paragraph', text: 'Texto con el estilo predeterminado.' }
  ]
}, font);
```

`page` admite `a4`, `letter` o `width`/`height` expresados en puntos PDF, más márgenes opcionales. Solo se utiliza junto con `blocks`; la API heredada conserva su geometría. Los títulos `heading` ofrecen niveles del 1 al 3.

### Nuevo: imágenes PNG/JPEG en documentos (Unidad 10)

Las imágenes ahora pueden mezclarse con títulos, párrafos y tablas dentro de `blocks`.

```typescript
import { readFileSync } from 'node:fs';
import { renderPdfAsync } from 'vufra';

const pdf = await renderPdfAsync({
  title: 'Informe ilustrado',
  blocks: [
    { type: 'heading', level: 1, text: 'Certificado' },
    { type: 'image', data: readFileSync('logo.png'),
      width: 180, height: 80, fit: 'contain' },
    { type: 'paragraph', text: 'Documento con imagen incrustada.' }
  ]
}, font);
```

`fit: 'contain'` respeta la proporción y deja espacio libre; `fit: 'cover'` llena el recuadro con recorte centrado. El bloque se mueve completo a la siguiente página si no cabe, conservando los márgenes. Se admiten PNG (incluyendo transparencia) y JPEG; la imagen se recibe como bytes, sin leer rutas desde Rust.

Límites experimentales de entrada: **8 MiB por imagen, 32 MiB de imágenes en total, 64 bloques, 12 megapíxeles por imagen y 24 megapíxeles acumulados**. No garantizan una cota estricta de RSS. No soportamos imágenes divididas entre páginas, posicionamiento absoluto ni anclar encabezados a su imagen (pueden quedar separados por salto de página).

### Nuevo: listas, formas vectoriales y `keepWithNext` (Unidad 11)

```typescript
const pdf = await renderPdfAsync({
  title: 'Reporte ilustrado',
  blocks: [
    {type:'heading',level:2,text:'Evidencia',keepWithNext:true},
    {type:'image',data:photoJpeg,width:240,height:130,fit:'cover'},
    {type:'rule',width:450,height:3,color:'#245fa8'},
    {type:'list',items:['Primer punto','Segundo punto']},
    {type:'list',ordered:true,items:['Preparar','Verificar','Emitir']},
    {type:'rectangle',width:320,height:24,color:'#dceaf7'}
  ]
},font);
```

Las listas pueden continuar en otras páginas sin duplicar el texto, con numeración o viñetas y sangría. Las reglas y los rectángulos se dibujan como vectores RGB, no como imágenes. Los títulos conservan por defecto `keepWithNext: true`, de modo que, cuando sea posible, se muevan con la imagen o la primera fila de la tabla siguiente. `keepWithNext: false` lo desactiva. No es aún un agrupador general de varios bloques consecutivos.

### Nuevo: tipografía real por fragmentos (Unidad 12)

```typescript
const pdf = await renderPdfAsync({
  title: 'Contrato',
  fontFaces: {
    bold: readFileSync('NotoSans-Bold.ttf'),
    italic: readFileSync('NotoSans-Italic.ttf'),
    serif: readFileSync('NotoSerif-Regular.ttf')
  },
  blocks: [{
    type: 'rich-paragraph',
    runs: [
      {text: 'Texto normal '},
      {text: 'negrita real ',font: 'bold'},
      {text: 'cursiva real ',font: 'italic'},
      {text: 'y otra familia.',font: 'serif'}
    ]
  }]
}, regularFontBytes);
```

La fuente de `renderPdfAsync(...,regularFontBytes)` es la cara `regular`; las adicionales se identifican por nombre. Cada fragmento se mide usando Parley y se dibuja con su **archivo de fuente auténtico incrustado en el PDF** por Krilla; no se simulan negritas ni cursivas. El compositor conserva cambios de fuente en líneas que envuelven y saltan de página. Este hito todavía no implementa fallback por glifos ni shaping entre estilos, y los tamaños/colores son de bloque, no por run. Los archivos TTF/OTF los proporciona el consumidor.

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
node examples/styled-document.mjs "$FONT" artifacts/styled-document.pdf
node examples/async-usage.mjs "$FONT" artifacts/async-first.pdf
node examples/queue-usage.mjs "$FONT"
node examples/cancellation-observe.mjs "$FONT"
node examples/images-usage.mjs "$FONT" artifacts/images-report.pdf
node examples/graphics-lists-usage.mjs "$FONT" artifacts/graphics-lists-report.pdf
node examples/rich-typography.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Italic' -f '%{file}')" \
  "$(fc-match 'Noto Serif' -f '%{file}')" artifacts/rich-typography.pdf
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
| 06 | Nodos estilizados y geometría de página configurable | Prototipo funcional |
| 07 | SDK async no bloqueante para Node/NestJS (N-API/libuv) | Prototipo funcional |
| 08 | Scheduler FIFO acotado, backpressure y cancelación en espera | Prototipo funcional |
| 09 | Cancelación cooperativa Rust y telemetría de renders | Prototipo funcional |
| 10 | Imágenes PNG/JPEG, contain/cover, recorte y flujo de bloques | Prototipo funcional |
| 11 | Listas, figuras vectoriales y continuidad título/contenido | Prototipo funcional |
| 12 | Font faces incrustadas y párrafos enriquecidos por fragmento | Prototipo funcional |
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

**No soporta aún:** texto RTL/shaping complejo, fallback de fuentes, SVG/otras imágenes vectoriales, celdas combinadas, estilos de texto enriquecido por fragmento ni páginas de tamaño diferente dentro del mismo documento. **En el modo `blocks`, los párrafos y las filas de tablas multicolumna continúan entre páginas; en el modo heredado, párrafos y filas simples siguen indivisibles.** Palabras inquebrantables más anchas que una columna generan error. Solo se ha probado Linux x86_64.

## Documentación

- [Plan de W0](docs/planning/01-w0-workspace.md)
- [Arquitectura conceptual](docs/architecture/overview.md)
- [Resultados de Unidad 01](docs/experiments/02-results.md)
- [Resultados y guía Unidad 02](docs/experiments/03-sdk-milestone.md)
- [Unidad 03 — Tablas multicolumna](docs/experiments/04-tables-milestone.md)
- [Unidad 04 — Filas fragmentables](docs/experiments/05-row-fragmentation.md)
- [Unidad 05 — Compositor unificado](docs/experiments/06-unified-flow.md)
- [Unidad 06 — AST estilizado y geometría](docs/experiments/07-styled-geometry.md)
- [Unidad 07 — Generación asíncrona Node](docs/experiments/08-async-node.md)
- [Unidad 08 — Cola y backpressure](docs/experiments/09-queue-backpressure.md)
- [Unidad 09 — Cancelación y observabilidad](docs/experiments/10-cancellation-observability.md)
- [Unidad 10 — Imágenes en el compositor](docs/experiments/11-images-milestone.md)
- [Unidad 11 — Listas y gráficos](docs/experiments/12-lists-graphics-milestone.md)
- [Unidad 12 — Tipografía multifuente](docs/experiments/13-typography-milestone.md)
- [ADR-0001 Licencia](docs/adr/0001-license.md)
- [ADR-0002 Monorepo](docs/adr/0002-monorepo.md)
- [ADR-0003 Writer PDF y SDK Node](docs/adr/0003-prototype-pdf-and-node.md)
- [ADR-0004 Tablas multicolumna](docs/adr/0004-table-layout.md)
- [ADR-0005 Fragmentación por líneas](docs/adr/0005-split-row-pagination.md)
- [ADR-0006 Flujo de contenido ordenado](docs/adr/0006-unified-flow.md)
- [ADR-0007 Geometría y bloques semánticos](docs/adr/0007-styled-page.md)
- [ADR-0008 Trabajo nativo asíncrono N-API](docs/adr/0008-node-async-work.md)
- [ADR-0009 Cola de PDF local](docs/adr/0009-pdf-render-queue.md)
- [ADR-0010 Cancelación Rust y métricas](docs/adr/0010-cancellation-observability.md)
- [ADR-0011 Imágenes raster en bloques](docs/adr/0011-raster-image-blocks.md)
- [ADR-0012 Listas y continuidad semántica](docs/adr/0012-lists-graphics-keep-next.md)
- [ADR-0013 Fuentes y texto enriquecido](docs/adr/0013-explicit-font-faces-and-rich-text.md)
- [Paquete TypeScript](packages/vufra/README.md)

## Licencia

**MIT OR Apache-2.0**. Textos en [LICENSE-MIT](LICENSE-MIT) y [LICENSE-APACHE](LICENSE-APACHE).
