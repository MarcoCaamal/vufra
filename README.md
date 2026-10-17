# Vufra 🦀

Motor PDF **open source** escrito en Rust. Incluye un **SDK experimental para Node.js/TypeScript** que llama al motor Rust mediante N-API, sin Chromium ni HTML.

> **Estado actual: prototipo funcional (2026-10-16).** El API y el empaquetado todavía no son estables ni adecuados para producción. Nada está publicado en npm o crates.io.

## ¡La nueva API Fluent de Vufra! (Unidad 14)

```typescript
import { createVufra } from 'vufra';
import { readFileSync, writeFileSync } from 'node:fs';

const vufra = createVufra({
  font: readFileSync('regular.ttf')
});

const pdf = await vufra
  .document({ title: 'Reporte de ventas', page: 'A4' })
  .heading('Reporte de ventas')
  .paragraph('Resultados de octubre de 2026')
  .table(ventas)
  .render();

writeFileSync('reporte.pdf', pdf);
```

La API usa **builders encadenados y callbacks para layouts avanzados**, sin obligarte a describir el AST manualmente. No hay búsqueda de fuentes del sistema: proporciona un TTF/OTF. El método `render()` ejecuta Rust de forma asíncrona.

```typescript
const invoice = vufra.document({title:'Factura',page:'Letter'})
  .row({gap:16},row=>{
    row.column({width:'40%'},col=>col.paragraph('Mi empresa'));
    row.column({width:'60%',align:'right'},col=>col.paragraph('FAC-2026-001'));
  })
  .table(productos,{columns:[
    {key:'nombre',title:'Producto',width:'*'},
    {key:'importe',title:'Importe',width:130}
  ]})
  .render();
```

Las filas se dibujan en **columnas reales** medidas por Parley; las tablas extensas siguen repitiendo su encabezado y paginándose en Rust. Los callbacks de composición son síncronos. Además tienes `.section()`, `.grid()`, `.richText()`, `.image()`, `.list()`, `.divider()` y `.pageBreak()`. `toDocument()` permite inspeccionar el AST; `renderSync()` y `enqueue(queue)` reutilizan el mismo motor.

**Alcance actual:** las filas cortas son atómicas, las largas se fragmentan entre elementos o líneas de texto simple; los boxes anidados pueden continuar entre páginas. Las tablas avanzadas repiten encabezados, aunque cada celda enriquecida se mantiene atómica. Los márgenes y límites continúan siendo explícitos.

La API Rust subyacente vive en `crates/vufra-pdf`: `render_pdf(&PdfDocument, &[u8], RenderOptions)`.

### Nuevo: contenedores visuales fragmentables (Unidad 15)

```typescript
const pdf = await vufra.document({title:'Resumen'})
  .heading('Reporte empresarial')
  .box({
    padding:16,
    background:'#EFF5FC',
    border:{width:2,color:'#244A89'}
  },box=>{
    box.heading('Indicadores',{level:2,color:'#244A89'});
    box.paragraph('Ingresos: $125,000');
    box.divider({color:'#244A89'});
    box.paragraph('Notas de operación.');
  })
  .table(detalle)
  .render();
```

`box()` utiliza un compositor Rust nativo. Los textos se envuelven al ancho interior (descontando padding) y las cajas largas pueden fragmentarse entre páginas con fondo y bordes continuos. También acepta imágenes PNG/JPEG, rectángulos, espacios y listas sencillas. Se puede elegir ancho y alineación `left/center/right`.

**Limitaciones actuales:** imágenes grandes, rich runs individuales demasiado altos y cajas dentro de celdas Row/Grid demasiado altas aún son atómicos. Tablas, rows y grids sí pueden anidarse en boxes. Los callbacks son síncronos.

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

### Nuevo: color/tamaño por fragmento y fallback explícito (Unidad 13)

```typescript
const pdf = await renderPdfAsync({
  title: 'Certificado',
  fontFaces: {bold: boldFontBytes, symbols: symbolsFontBytes},
  blocks: [{
    type: 'rich-paragraph',
    runs: [
      {text: 'Texto regular '},
      {text: 'IMPORTANTE ', font: 'bold', fontSize: 27, color: '#BB3322'},
      {text: '★', fontSize: 18, color: '#2255BB', fallbackFonts: ['symbols']}
    ]
  }]
}, regularFontBytes);
```

Cada run puede tener tamaño individual (6–36 puntos), color RGB `#RRGGBB` y un orden explícito de fuentes alternativas. Vufra mide con Parley, dibuja con Krilla y comprueba cobertura de glifos con `ttf-parser`; cuando ninguna fuente propuesta puede cubrir una **palabra completa**, devuelve un error. Se unen runs contiguos con estilo idéntico, conservando oportunidades de ligadura dentro de una misma palabra. **Esto no implementa fallback automático ni garantiza RTL/shaping Unicode complejo.** Las líneas reservan la altura del run mayor (por ahora con espaciado conservador); los extractores basados en coordenadas pueden reordenar palabras de tamaños distintos aunque `pdftotext -raw` conserve el flujo original.

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
node examples/inline-typography.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Italic' -f '%{file}')" \
  "$(fc-match 'Noto Serif' -f '%{file}')" \
  "$(fc-match 'Noto Sans Symbols 2' -f '%{file}')" artifacts/inline-typography.pdf
node examples/fluent-invoice.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" artifacts/fluent-invoice.pdf
node examples/fluent-report.mjs "$FONT" artifacts/fluent-report.pdf
node examples/fluent-panels.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" artifacts/fluent-panels.pdf
node examples/fluent-page-templates.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" artifacts/fluent-page-templates.pdf
node examples/fluent-styled-tables.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" artifacts/fluent-styled-tables.pdf
node examples/fluent-composition.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" artifacts/fluent-composition.pdf
pdfinfo artifacts/sdk-first.pdf
```

El archivo generado es `artifacts/sdk-first.pdf`; se ignora en Git. **La fuente la proporciona el usuario**; no empaquetamos ni redistribuimos fuentes externas.

### Nuevo: plantillas de página y numeración dinámica (Unidad 17)

Las bandas corporativas se construyen con la misma API de filas que el contenido,
sin navegador. La primera página admite una variante de portada, y los márgenes
se ajustan antes de paginar para que el encabezado y pie no invadan el cuerpo.

~~~typescript
const report = createVufra({font:regularBytes,fonts:{bold:boldBytes}})
  .document({title:'Reporte anual',page:'Letter'})
  .header(h=>h.row(row=>{
    row.column({width:'40%'},c=>c.image(logoBytes,{width:72,height:36}));
    row.column({width:'60%',align:'right'},c=>
      c.paragraph('ACME Corp',{bold:true}));
  }))
  .firstHeader(h=>h.text('Portada corporativa',{bold:true}))
  .footer(f=>f.text(({page,total})=>'Página '+page+' de '+total))
  .firstFooter(null)
  .paragraph('Mi reporte empresarial multipágina');

const pdf = await report.render();
~~~

**Importante:** las funciones de texto de banda se ejecutan solo al crear la
plantilla y reciben page y total como *tokens de cadena*, no como números
reales de la página. Rust resuelve {{page}} y {{total}} cuando ya conoce el
total. header(null)/footer(null) ocultan la banda histórica correspondiente.
Cada banda admite una fila, un grid de una fila, un texto o una imagen; los
layouts largos que dejarían menos de 100pt de cuerpo devuelven error.

Ejemplo real: examples/fluent-page-templates.mjs. ADR-0018 detalla la
precedencia y los límites de las plantillas.

### Nuevo: tablas enriquecidas dentro de cajas (Unidad 18)

Vufra puede generar tablas empresariales dentro de cajas decoradas, con
texto regular, negrita real, colores, relleno RGB, varios fragmentos tipográficos
o imagen PNG/JPEG por celda. El encabezado se repite en cada nueva página.

~~~typescript
const pdf = await createVufra({font: regularBytes, fonts: {bold: boldBytes}})
  .document({title:'Factura',page:'Letter'})
  .box({padding:14,background:'#FFFFFF',border:{width:1,color:'#223366'}},box=>{
    box.heading('Estado de cuenta', {bold:true});
    box.table([
      [{text:'INV0001',bold:true}, 'Servicio premium',
       {text:'$250.00',background:'#E1F4DC',align:'right'}],
      ['INV0002', {runs:[
        {text:'Envío ',bold:true,color:'#BB3344'},{text:'express'}
      ]}, '$99.00']
    ],{columns:[
      {title:'Folio',width:'25%'},
      {title:'Descripción',width:'50%'},
      {title:'Importe',width:'25%',align:'right'}
    ]});
  }).render();
~~~

También existe document.tableStyled(rows,{columns}) sin caja visible.
A diferencia de table() clásica, las filas enriquecidas son ATÓMICAS: pueden
moverse a otra página y el encabezado se repetirá, pero una fila más alta que
una página imprimible da error. No hay colspan, rowspan ni tablas recursivas.

### API Fluent componible (Unidad 19)

La sintaxis Fluent sigue siendo principal: las cadenas de llamadas
.heading().paragraph().box().table().render() no desaparecen. Ahora
.add() permite insertar componentes funcionales reutilizables, construidos
con box, paragraph, heading, image, grid, row, column, table y flow.
El documento y box reciben el mismo ContentBuilder con las mismas operaciones.

~~~typescript
const MetricCard = (title:string,value:string) =>
  box({padding:12,background:'#E8F2FC'},[
    paragraph(title),
    paragraph(value,{bold:true})
  ]);

const pdf = await engine.document({title:'Reporte'})
  .heading('Resultados')
  .box({padding:16},content => content
    .paragraph('Resumen del trimestre')
    .grid({columns:2},grid => grid
      .cell(col=>col.paragraph('Ventas'))
      .cell(col=>col.paragraph('Costos'))
    )
  )
  .add(MetricCard('Total','$125,000'))
  .render();
~~~

Una caja permite un nodo o arreglo de nodos; varios hijos se apilan.
Las cajas dentro de cajas miden y dibujan verdaderos fondos, bordes,
imágenes y fuentes, hasta ocho niveles.

LIMITES: cajas anidadas y filas de Row/Grid son atómicas al paginar.
Las columnas sí admiten Box/Table/Grid, pero una fila demasiado alta
no puede fragmentarse entre páginas.
El árbol funcional es un AST lógico TypeScript que se baja al AST especializado
existente en Rust; la unificación total de la medición Rust queda pendiente
(ADR-0020).

### Layout jerárquico y paginación recursiva (Unidad 20)

Rust baja los nodos preparados a un árbol geométrico común independiente
del PDF writer (Leaf, Container, RepeatTable). Los contenedores se
fragmentan por hojas y repintan fondos/bordes con padding en cada página.
Las tablas profundas repiten encabezados.

Las filas Row/Grid que caben en una página conservan su layout previo.
Las filas largas se dividen entre elementos y, para texto simple,
también entre líneas Parley. Las cajas hijas respetan keepTogether y
breakBefore.

~~~typescript
const pdf = await engine.document({title:'Informe'})
  .box({padding:18},content => content
    .box({padding:14},inner => inner
      .paragraph('Informe extensísimo '.repeat(2000))
    )
  )
  .row(r=>r
    .column(c=>c.paragraph('Columna A '.repeat(500)))
    .column(c=>c.paragraph('Columna B '.repeat(500)))
  )
  .render();
~~~

Límites: el AST geométrico es común en Rust, pero los tipos de contenido
siguen especializados. Un rich-run individual muy alto, una imagen
gigante o una caja muy alta dentro de una celda siguen siendo atómicos.
Las tablas enriquecidas parten entre filas. Véase ADR-0021.

### Texto enriquecido fragmentable y semántica Rust compartida (Unidad 21)

Vufra ahora divide entre páginas un párrafo rich con negritas, colores
y fuentes reales dentro de Row/Grid, así como el cuerpo de una celda de
tabla enriquecida. El encabezado de la tabla se repite y el fill RGB
permanece idéntico en cada segmento. No cambia la Fluent API.

~~~typescript
const pdf=await engine.document({page:'Letter'})
  .box({padding:14},b=>b.table([
    ['REC001',{runs:[
      {text:'Importante ',bold:true,color:'#BB3344'},
      {text:'detalle '.repeat(150)}
    ],background:'#E1F4DC'}]
  ],{columns:[
    {title:'Folio',width:'30%'},{title:'Detalle',width:'70%'}
  ]}))
  .render();
~~~

Internamente Rust tiene ahora una vista semántica común
(\`SemanticNode\` + \`SemanticBudget\`) para bloques, boxes, rows y
tablas; la validación recursiva utiliza efectivamente esa interfaz,
mientras que el layout geométrico de Unidad 20 sigue paginando.
Los tipos de contenido especializados antiguos siguen existiendo
como adaptadores para compatibilidad. El texto rich ya formado conserva
font index, x, size y color al fragmentarse, sin volver a reconstruirse.

Límites: rich fragmenta por líneas medidas (máx. 500 por fila),
no por mitad de un glyph o una imagen; encabezados de tabla muy altos,
imágenes imposibles y boxes gigantes dentro de celdas aún se rechazan.
Véase ADR-0022.

### AST semántico Rust owned y compatibilidad (Unidad 22)

Los documentos ahora se normalizan a un árbol \`ContentNode\` owned antes
de validarse o prepararse para el PDF. El mismo nodo semántico representa
texto, rich text, imágenes, cajas, filas, tablas, listas y saltos;
\`ContentFrame\` y \`ContentColumn\` guardan layout y estilos.

El motor mantiene el árbol geométrico \`LayoutNode\` de la Unidad 20
para paginar; el AST semántico no duplica sus responsabilidades.
\`SemanticBudget\` recorre el árbol owned para aplicar las mismas
reglas de seguridad en todas las ramas. Los tipos
\`PdfBlock/PdfBoxItem/PdfRowItem\` se conservan únicamente como
adaptadores públicos y de dibujo compatibles con el SDK anterior.

Nueva entrada nativa directamente en Rust:

~~~rust
let mut doc=SemanticDocument::new("Reporte");
doc.page=Some(PageGeometry::letter());
doc.nodes.push(ContentNode::paragraph("Introducción"));
doc.nodes.push(ContentNode::boxed(
    ContentFrame {padding:14.0,..ContentFrame::default()},
    vec![ContentNode::paragraph("Contenido anidado")]
));
let pdf=render_semantic_pdf(&doc,&font,RenderOptions::default())?;
~~~

No hay cambios a la sintaxis encadenada de TypeScript. Los contextos
inválidos (\`PageBreak\` dentro de una fila, estilo rich en tabla simple,
etc.) dan error explícito y no descartan propiedades.

**Límite actual:** no se han eliminado todos los tipos del pintor Krilla
ni el costo temporal de clonar datos al adaptar los inputs históricos.
El render de imágenes gigantes dentro de una celda, columnas
independientes, RTL universal y colspan/rowspan sigue fuera del alcance.
Detalles en ADR-0023 y ejemplo Rust \`owned-semantic.rs\`.

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
| 13 | Color y tamaño por run, coalescencia para ligaduras y fallback opt-in | Prototipo funcional |
| 14 | Fluent API, callbacks de layout, columnas horizontales reales y pageBreak | Prototipo funcional |
| 15 | `box()` con padding, fondo, bordes y fragmentación entre páginas | Prototipo funcional |
| 16 | Tipografía real y filas/grids anidados dentro de cajas; reglas de salto | Prototipo funcional |
| 17 | Plantillas de página, portada distinta, logos y numeración tardía | Prototipo funcional |
| 18 | Tablas enriquecidas y encabezados repetidos dentro de cajas | Prototipo funcional |
| 19 | Composición funcional + Fluent compartida, cajas anidadas nativas | Refactor incremental |
| 20 | Árbol geométrico Rust, cajas fragmentables y filas largas paginadas | Prototipo funcional |
| 21 | Vista semántica Rust común y celdas rich fragmentables | Hito funcional local |
| 22 | AST semántico owned Rust, API nativa y adapters legacy | Hito funcional local |
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

**No soporta aún:** RTL complejo, SVG, celdas combinadas ni tamaños distintos por página. Las tablas enriquecidas permiten estilos por celda pero no fragmentar el contenido de una celda individual. El modo heredado de filas simples conserva sus restricciones previas. El motor sigue en fase experimental.

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
- [Unidad 13 — Estilos inline y fallback](docs/experiments/14-inline-style-milestone.md)
- [Unidad 14 — Fluent API y filas](docs/experiments/15-fluent-api-milestone.md)
- [Unidad 15 — Cajas decoradas fragmentables](docs/experiments/16-decorated-boxes-milestone.md)
- [Unidad 16 — Layouts anidados](docs/experiments/17-nested-layouts-milestone.md)
- [Unidad 17 — Plantillas de página](docs/experiments/18-page-templates-milestone.md)
- [Unidad 18 — Tablas enriquecidas](docs/experiments/19-styled-tables-milestone.md)
- [Unidad 19 — Fluent componible](docs/experiments/20-composable-nodes-milestone.md)
- [Unidad 20 — Paginación jerárquica](docs/experiments/21-hierarchical-layout-milestone.md)
- [Unidad 21 — Rich en celdas](docs/experiments/22-rich-cell-pagination-milestone.md)
- [Unidad 22 — AST semántico owned](docs/experiments/23-owned-semantic-ast-milestone.md)
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
- [ADR-0014 Estilos inline y fallback explícito](docs/adr/0014-inline-styles-and-explicit-fallback.md)
- [ADR-0015 Builders Fluent y filas](docs/adr/0015-fluent-builders-and-atomic-rows.md)
- [ADR-0016 Cajas fragmentables](docs/adr/0016-decorated-boxes-page-fragments.md)
- [ADR-0017 Layouts anidados](docs/adr/0017-nested-layouts-and-page-policies.md)
- [ADR-0018 Plantillas de página](docs/adr/0018-page-templates-and-running-bands.md)
- [ADR-0019 Tablas enriquecidas en cajas](docs/adr/0019-styled-tables-in-boxes.md)
- [ADR-0020 Fluent componible y nodos](docs/adr/0020-composable-fluent-and-unified-nodes.md)
- [ADR-0021 Layout jerárquico y paginación](docs/adr/0021-hierarchical-layout-and-recursive-pagination.md)
- [ADR-0022 Semántica común y rich paginado](docs/adr/0022-shared-semantic-view-and-rich-cell-fragments.md)
- [ADR-0023 AST semántico owned en Rust](docs/adr/0023-owned-semantic-ast-and-legacy-paint-adapters.md)
- [Paquete TypeScript](packages/vufra/README.md)

## Licencia

**MIT OR Apache-2.0**. Textos en [LICENSE-MIT](LICENSE-MIT) y [LICENSE-APACHE](LICENSE-APACHE).
