# Vufra

**Motor experimental de PDFs**: un SDK Fluent en TypeScript que delega
la medición y el renderizado a Rust. Sin navegador headless, HTML/CSS
ni dependencia del motor Chromium.

> **Estado experimental — API inestable.** No se mantiene compatibilidad
> con la antigua sintaxis de arrays `paragraphs`/`rows` ni con las
> tablas de objetos. No se recomienda para producción antes de validar
> los casos de uso y límites del motor.

Licencia dual: **MIT OR Apache-2.0**.

## Qué permite construir

- Párrafos, headings, rich text con fuentes proporcionadas por el usuario,
  imágenes PNG/JPEG, divisores y rectángulos.
- Cajas decoradas, cajas anidadas y continuaciones entre páginas.
- Rows y grids, con columnas que pueden contener cajas, tablas o más grids.
- Tablas enriquecidas con color por celda, runs de distintas fuentes,
  imágenes y encabezados que se repiten después del salto de página.
- Header/footer reutilizables, número de página y total de páginas.
- PDF en Letter, A4 o dimensiones/márgenes personalizados.
- Renderizado sync, async con cancelación y una cola FIFO de trabajos.

El árbol semántico interno es `ContentNode` (owned, Rust). El
`LayoutNode` geométrico del crate `vufra-layout` calcula los fragmentos.
NAPI traduce los bloques del SDK al AST semántico; el dibujador
todavía emplea estructuras especializadas para las fuentes, filas,
geometrías y primitivas de Krilla.

## Sintaxis recomendada: Fluent + componentes

```ts
import {createVufra, box, paragraph} from 'vufra';

const vufra = createVufra({
  font: regularFontBytes,
  fonts: {bold: boldFontBytes},
  theme: {colors: {accent: '#204D88', soft: '#EDF4FC'}}
});

const TotalCard = (total: string) =>
  box({padding: 12, background: 'soft'}, [
    paragraph('Total'),
    paragraph(total, {bold: true, color: 'accent'})
  ]);

const pdf = await vufra.document({title: 'Factura', page: 'Letter'})
  .heading('Estado de cuenta')
  .paragraph('Resumen del periodo')
  .box({padding: 16}, content => content
    .image(logoPng, {width: 96, height: 48})
    .grid({columns: 2, gap: 12}, grid => grid
      .cell(cell => cell.paragraph('Entradas'))
      .cell(cell => cell.paragraph('Salidas'))
    )
    .table([
      ['INV-001', 'Servicio', '$250'],
      ['INV-002', {runs: [
        {text: 'Servicio ', bold: true},
        {text: 'premium', color: 'accent'}
      ]}, '$420']
    ], {columns: [
      {title: 'Folio', width: '25%'},
      {title: 'Detalle', width: '50%'},
      {title: 'Importe', width: '25%', align: 'right'}
    ]})
  )
  .add(TotalCard('$670'))
  .render();
```

La cadena Fluent se conserva; `.add()` inserta componentes reutilizables
y `.box()` recibe un callback de `ContentBuilder` o un componente
declarativo con hijos.

**Una sola API para tablas:** `.table(rows, {columns})` funciona en
la raíz, dentro de boxes y dentro de celdas. `rows` es un arreglo
de arreglos de celdas. No existen `.tableStyled()`, tablas inferidas
desde propiedades de objetos ni la vieja modalidad
`{paragraphs, rows, table}`.

## Desarrollo y verificación

Requisitos: Node.js 22+, Rust/Cargo, herramientas nativas de C/C++,
y para inspección local `pdfinfo`, `pdftotext`, `pdffonts`,
`pdfimages` y `pdftoppm` (Poppler). Las fuentes no se incluyen.

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
bash scripts/build-native.sh

cd packages/vufra
npm run build
npm test
```

Ejemplo funcional de facturas multipágina:

```bash
node examples/fluent-styled-tables.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" \
  artifacts/fluent-styled-tables.pdf
```

Otros ejemplos activos: `examples/fluent-invoice.mjs`,
`fluent-panels.mjs`, `fluent-report.mjs`,
`fluent-page-templates.mjs`, `fluent-composition.mjs`,
`fluent-hierarchical.mjs`, `fluent-rich-pagination.mjs` y
`crates/vufra-pdf/examples/owned-semantic.rs` para la entrada nativa
directa desde Rust. `examples/nestjs/` muestra snippets de integración
con la cola, no una aplicación compilada.

`bash scripts/verify-experiments.sh` prueba experimentos históricos
de componentes Rust, **no** una API heredada del SDK.

## Arquitectura

| Crate o paquete | Responsabilidad |
|---|---|
| `packages/vufra` | Fluent, nodos funcionales, validación de entrada y cola |
| `bindings/vufra-node` | Paso de datos NAPI y trabajos nativos con cancelación |
| `crates/vufra-pdf` | AST semántico owned, shaping y pintura con Krilla |
| `crates/vufra-layout` | LayoutNode y paginación independiente del PDF writer |
| `experiments/` | Experimentos Rust no expuestos por el SDK |

La API del paquete npm **exporta solo Fluent, componentes y la cola**.
El normalizador NAPI y el modelo de dibujo son detalles internos que
pueden cambiar sin mantener adapters de compatibilidad.

### ADR y experimentos recientes

- [ADR-0020 — Fluent componible](docs/adr/0020-composable-fluent-and-unified-nodes.md)
- [ADR-0021 — Layout jerárquico](docs/adr/0021-hierarchical-layout-and-recursive-pagination.md)
- [ADR-0022 — Fragmentación rich](docs/adr/0022-shared-semantic-view-and-rich-cell-fragments.md)
- [ADR-0023 — AST semántico owned](docs/adr/0023-owned-semantic-ast-and-legacy-paint-adapters.md)
- [ADR-0024 — Limpieza incompatible y memoria](docs/adr/0024-breaking-cleanup-and-memory.md)

Estos ADR documentan las decisiones **en su momento**. Cuando mencionen
una sintaxis anterior, considérese histórica; solo este README y
`packages/vufra/README.md` describen la API actual.

## Limitaciones actuales

No hay soporte completo de bidi/RTL, SVG, rowspan/colspan,
universal PDF overlays ni fragmentación de objetos individuales que
no caben en una página. Un rich text puede dividirse entre líneas,
pero las imágenes indivisibles y encabezados excesivamente grandes
se rechazan explícitamente. Se aplican límites de profundidad,
tamaño de buffers y número de imágenes.

**No se entregan promesas de rendimiento** hasta medir workloads
repetibles. El experimento admite refactors que rompen APIs.

## Perfilado de memoria (Unidad 24)

El motor Rust ahora consume `SemanticDocument` **por valor** al llamar
a `render_semantic_pdf(document, font_bytes, options)`. El lowering
del árbol semántico al pintor no duplica los buffers de imágenes anidadas.
Los snapshots de la cola y de `toDocument()` se conservan.

Para medir el RSS máximo de todo el proceso Node con 450 filas,
24 imágenes y comprobación de los 450 identificadores:

```bash
node scripts/benchmark-native-memory.mjs REGULAR.ttf BOLD.ttf 3
```

Medición local: la mediana de RSS máxima pasó de **150,67 a
139,91 MiB** (−10,76 MiB, −7,1 %). No mide el allocator Rust aislado
ni garantiza este porcentaje en otras máquinas o cargas.
Detalles: [ADR-0025](docs/adr/0025-owned-render-memory-profile.md).

## Unidad 25: buffers de fuentes y filas fragmentables

Los bytes de cada fuente se comparten mediante `Arc<Vec<u8>>` entre
Krilla, Fontique y el verificador de glifos; las fuentes adicionales
se transfieren por valor. Al fragmentar filas largas, Vufra mueve
los ítems ya medidos hacia cada segmento, evitando una copia extra
de imágenes y rich text. La sintaxis Fluent pública no cambia.

```bash
node scripts/benchmark-font-rows.mjs REGULAR.ttf BOLD.ttf 3
```

En la muestra local de 2640 identificadores y 13 páginas, la mediana
de RSS máximo de tres procesos Node bajó de **93,39 a 89,64 MiB**.
Es un resultado de esta máquina/carga; no hay garantía global de
velocidad ni un pipeline completamente zero-copy.
Detalles: [ADR-0026](docs/adr/0026-shared-font-buffers-and-owned-row-fragments.md).

## Unidad 26: medir filas largas una sola vez

Al paginar una fila que excede la página, Rust reutiliza las líneas
y offsets de Parley ya medidos y las líneas `RichLine` con color y
fuentes reales. Los fragmentos `MeasuredTextLine` y
`MeasuredRichLine` son internos: la Fluent API no cambia.

El benchmark repetible `scripts/benchmark-font-rows.mjs` produjo
para ocho filas enriquecidas, 2.640 identificadores y 13 páginas
una mediana de **127,48 → 85,63 ms** de render en tres procesos
por versión. Es un resultado para esta carga, no un speedup general.
El pico de RSS fue prácticamente igual. Ver
[ADR-0027](docs/adr/0027-reuse-prepared-row-lines-for-pagination.md).

## Unidad 27: imágenes cacheadas en filas fragmentables

Las filas demasiado altas reutilizan el mismo objeto nativo
`PreparedImage` cuando se dividen en páginas. Solo se transfieren
la geometría de pintado y una referencia `Arc`: no se copian
los bytes comprimidos ni se parsea otra vez el PNG/JPEG.

```bash
node scripts/benchmark-fragmented-images.mjs REGULAR.ttf BOLD.ttf 3
```

En la carga sintética de 10 PNG y 4.200 tokens (40 páginas), la
mediana local de render bajó de **270,89 a 162,86 ms** y el
pico RSS de **121,14 a 117,08 MiB**. Ambas versiones produjeron
un PDF binariamente idéntico de 497.061 bytes. No es una promesa
de velocidad en todos los PDF.

La Fluent API y la protección de presupuestos siguen intactas.
Ver [ADR-0028](docs/adr/0028-cached-image-fragments.md).

## Unidad 28: buffers de fuentes owned entre NAPI y Rust

La API Rust consume `Vec<u8>` para la fuente principal y lo
comparte entre Krilla, Fontique y FontRegistry con `Arc<Vec<u8>>`,
sin duplicar esos bytes de nuevo dentro de Rust.

La copia inicial al recibir un Buffer desde JS **se conserva**:
los trabajos asíncronos necesitan aislar memoria JS modificable.
La cola conserva sus propios snapshots. No se hace zero-copy inseguro.

```bash
node scripts/benchmark-napi-font-ownership.mjs REGULAR.ttf BOLD.ttf 3
```

El benchmark utiliza una TTF válida rellenada artificialmente a
10 MiB para medir las copias; no simula 10 MiB de glifos complejos.
Se observó maxRSS de 136,46 → 116,52 MiB con ese payload y
136,57 → 133,63 MiB en el control con fuente normal y 24 PNG.
Estos resultados no garantizan aceleración general.

Detalles: [ADR-0029](docs/adr/0029-owned-font-buffer-and-safe-napi-snapshots.md).

## Unidad 29: fuentes nativas inmutables reutilizables

Una misma instancia `createVufra({font})` conserva una fuente en un
recurso inmutable de Rust, compartido mediante `Arc<Vec<u8>>` entre
sus documentos. Se hace **una copia al registrar la fuente** y
no otra por cada render. Las opciones `document({font})` generan
otro snapshot aislado; las colas siguen copiando inputs al admitirlos.

Esto **no es zero-copy** desde el `Buffer` de JavaScript: ciertos
Buffer comparten memoria del pool de Node y no pueden transferirse
con seguridad. Nunca prestamos memoria mutable de JS a un worker.

```bash
node scripts/benchmark-reused-native-font.mjs REGULAR.ttf BOLD.ttf 3 10
```

Con una TTF válida rellenada artificialmente a 10 MiB, nueve
documentos sucesivos dieron una mediana de maxRSS de
172,57 → 110,74 MiB (tres procesos por versión). Es una carga
sintética dirigida a copias de buffers, no una ganancia universal.

Más detalles: [ADR-0030](docs/adr/0030-immutable-native-font-assets.md).

## Unidad 30: recursos nativos compartidos de fonts y PNG/JPEG

Además de la fuente regular, Vufra puede compartir buffers
inmutables de fuentes bold/fallback y PNG/JPEG entre documentos
de una misma instancia `createVufra`. `NativeAssets` conserva
referencias `Arc<Vec<u8>>` con IDs de imagen deduplicados por
huella **y comparación exacta**.

El caché de imágenes es local a la instancia y está limitado a
256 imágenes únicas o 64 MiB. Si se llena, el documento usa
recursos temporales en lugar de retener memoria sin límite.
Cada uso sigue contando para los límites por PDF.

Las fuentes extra habituales (hasta 2 MiB por archivo y 6 MiB
acumulados) pueden mantenerse en el factory; los archivos
excepcionalmente grandes usan bundles temporales liberados
después de preparar el render. La copia inicial JS→NAPI
sigue siendo necesaria por seguridad; la Fluent API no cambia.

```bash
node scripts/benchmark-reused-assets.mjs REGULAR.ttf BOLD.ttf 3 0
node scripts/benchmark-reused-assets.mjs REGULAR.ttf BOLD.ttf 3 10
```

Con ocho PDFs y la misma imagen/face, la salida es binariamente
idéntica entre versiones. **No se observó una reducción estable de
tiempo o pico RSS** en este benchmark; se optimizaron las copias
de buffers, el alcance y la vida útil de los recursos.

Consulta [ADR-0031](docs/adr/0031-bounded-shared-font-and-image-assets.md).

## Unidad 31: raster grande y concurrencia

Vufra dispone de un benchmark reproducible para repetir un mismo
PNG/JPEG de 1.280×1.280 entre **3 renderizados secuenciales y
3 concurrentes**. Se prueban páginas, fuentes, imágenes, hashes
y memoria máxima de procesos independientes.

```bash
node scripts/benchmark-large-raster.mjs REGULAR.ttf 3 1280 png
# La variante JPEG requiere ImageMagick local (magick):
node scripts/benchmark-large-raster.mjs REGULAR.ttf 3 1280 jpeg
```

Se experimentó con compartir un `krilla::Image` ya preparado
entre PDFs, pero el lote paralelo pasó de **119,88 ms a 327,07 ms**
(mediana de tres procesos PNG) a cambio de un ahorro de RSS
de unos 6 MiB. La optimización fue **revertida** y la latencia
volvió a **119,13 ms**. Se conserva únicamente el caché acotado
de bytes comprimidos de Unidad30, sin nuevo código muerto ni
API experimental de compatibilidad.

La investigación y la decisión están en
[ADR-0032](docs/adr/0032-large-raster-concurrency-and-cache-rejection.md).

## Unidad 32: cuadrículas con proporciones al estilo web

Vufra permite distribuir un grid mediante puntos, porcentajes y
fracciones **sin implementar un navegador ni CSS Grid completo**:

```ts
report.grid({columns:['2fr','1fr'],gap:12},grid=>{
  grid.cell(c=>c.heading('Ingresos').paragraph('$842,560'));
  grid.cell(c=>c.heading('Pedidos').paragraph('1,240'));
});
```

También funcionan `columns:3` (pistas iguales),
`columns:[125,'30%','1fr']` y `'*'` para una fracción flexible.
El mismo algoritmo valida el espacio disponible en el cuerpo,
las cajas anidadas y los encabezados o pies de página.
Valores que no caben, fracciones inválidas y grids vacíos fallan
antes del render nativo, con errores claros.

```bash
node examples/fluent-grid-tracks.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-grid-tracks.pdf
```

El ejemplo empresarial genera 11 páginas, con tarjetas KPI
reutilizables, estilos, encabezados y 190 registros en una tabla
paginada. El objetivo es **facilidad de autoría y layouts robustos**,
no sumar cachés o subsistemas de concurrencia.

Detalles: [ADR-0033](docs/adr/0033-fluent-grid-fractional-tracks.md).

## Unidad 33: presets visuales de texto y cajas

Define la apariencia de tarjetas, títulos y etiquetas una sola vez
en el tema y reutilízala con la Fluent API existente:

```ts
const report = createVufra({font,fonts:{bold},theme:{
  colors:{primary:'#173D78',paper:'#EDF4FC'},
  presets:{
    text:{label:{bold:true,color:'primary',fontSize:11}},
    box:{card:{padding:12,background:'paper'}}
  }
}}).document();

report.box({preset:'card'},b=>
  b.paragraph('RESUMEN',{preset:'label'})
);
```

Las opciones explícitas sobrescriben el preset (incluyendo
propiedades individuales del borde), pero no modifican su
definición. El mismo mecanismo funciona con nodos reutilizables
de `.add()`, columnas, encabezados y cajas anidadas.
Los presets desconocidos o recursivos fallan con mensajes claros
antes de renderizar. No hay parser CSS ni otra sintaxis paralela.

```bash
node examples/fluent-style-presets.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-style-presets.pdf
```

El ejemplo empresarial real genera diez páginas y 175 registros
con tarjetas y paneles estilizados. Ver
[ADR-0034](docs/adr/0034-fluent-named-visual-presets.md).

## Unidad 34: grids automáticos con alturas naturales

Ya no necesitas contar manualmente cuántas tarjetas caben
en cada fila. Indica un ancho mínimo en puntos:

```ts
report.grid({
  columns:{minWidth:150,maxColumns:3},
  gap:12,rowGap:16
},grid=>{
  for(const item of metrics)
    grid.cell(c=>c.box({preset:'card'},b=>
      b.paragraph(item.label).paragraph(item.value)));
});
```

El mismo grid utiliza tres columnas en un ancho grande, dos
en un panel estrecho y una si solo cabe una. Cada fila conserva
la altura natural de su tarjeta más alta y puede paginarse
sin posiciones calculadas por el desarrollador.

`rowGap` es separación vertical entre filas; no se añade
al terminar la última fila. Vufra valida el ancho mínimo
(al menos 60pt), el máximo (1–6 columnas) y los gaps (0–80pt)
antes de renderizar. Sigue siendo la **misma Fluent API**.

```bash
node examples/fluent-auto-flow.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-auto-flow.pdf
```

El ejemplo incluye 37 tarjetas de altura variable y
175 transacciones en una tabla paginada, generando
un PDF de 13 páginas sin pérdida de IDs.

Consulta [ADR-0035](docs/adr/0035-automatic-grid-minimum-width-and-row-gap.md).

## Unidad 35: títulos y separadores conscientes de la paginación

Vufra mantiene el título junto al primer contenido visible,
incluso si el autor añade uno o varios `spacer()` intermedios:

```ts
report.section('Transacciones',section=>section
  .spacer(12)
  .table(rows,{columns})
);
```

El paginador calcula el espacio de la tabla o caja que realmente
deberá reservar: si toda la caja cabe en una página nueva,
mueve el grupo completo; si se fragmenta, conserva el título
junto al primer fragmento útil. Esto evita encabezados huérfanos.

Los separadores entre bloques que coinciden con un salto
**implícito** de página ya no ocupan margen superior en la
página nueva. En cambio, un espaciado al principio del documento
o después de `.pageBreak()` se conserva deliberadamente.

No añadimos otra sintaxis, CSS ni nuevo motor de layout.
```bash
node examples/fluent-page-aware-sections.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-page-aware-sections.pdf
```
El ejemplo empresarial valida 185 transacciones y 11 páginas.
Ver [ADR-0036](docs/adr/0036-page-aware-soft-separators-and-headings.md).

## Unidad 36: cajas anidadas con bordes correctos entre páginas

Los contenedores decorados pueden envolver tablas largas y seguir
varias páginas con fondos y bordes laterales continuos. Vufra
distingue el encabezado de tabla **repetido** de las hojas
originales del contenido: ya no redibuja por error un borde
superior cuando una tabla se reanuda en otra página.

```ts
document.box({preset:'panel'},outer=>{
  outer.box({preset:'section'},section=>
    section.table(rows,{columns})
  );
  outer.paragraph('Observación final');
});
```

Cada caja conserva sus colores y cierra el borde inferior
**donde termina realmente**, aunque su contenedor exterior
continúe en otra página. Las regresiones inspeccionan píxeles
RGB en PDFs reales con hasta tres niveles anidados.

```bash
node examples/fluent-nested-box-continuations.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-nested-box-continuations.pdf
```

El ejemplo genera once páginas con 165 registros en orden.
No cambió la Fluent API ni se añadieron cachés.

Detalles: [ADR-0037](docs/adr/0037-nested-box-borders-and-repeated-headers.md).

## Unidad 37: tarjetas redondeadas con bordes coherentes

Usa `radius` para crear tarjetas y paneles de aspecto moderno
sin imágenes ni CSS y con la misma Fluent API:

```ts
document.box({padding:16,radius:12,background:'#EEF4FF',
  border:{width:2,color:'#173D78'}},card=>
  card.heading('Resultados').paragraph('$842,560'));
```

También funciona en `theme.presets.box.card` y dentro de
`grid()`, `row()` y cajas anidadas. Las esquinas se dibujan
vectorialmente en el PDF, solo donde la caja realmente empieza
o termina. En las páginas intermedias los bordes laterales
continúan y los extremos son rectos, incluso cuando una tabla
repite encabezados. `radius:0` produce el mismo PDF rectangular.

El radio está en puntos PDF, debe ser de 0 a 24 y no superar
el padding. Los valores inválidos fallan antes del render.

```bash
node examples/fluent-rounded-dashboard.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-rounded-dashboard.pdf
```

El ejemplo muestra 9 tarjetas y 165 registros en 11 páginas.
Ver [ADR-0038](docs/adr/0038-page-aware-rounded-boxes.md).

## Unidad 38 — Alineación y padding de tablas

Las tablas admiten `align: 'left'|'center'|'right'` y
`verticalAlign: 'top'|'center'|'bottom'`, y padding por tabla, columna o celda.
Las celdas heredan únicamente los lados no especificados:

```ts
doc.table([
  ['Servicio', {text:'3',align:'center'}, {text:'$980',padding:{right:16}}]
], {
  padding:{top:8,bottom:8,left:10,right:10},
  verticalAlign:'center',
  columns:[
    {title:'Concepto',width:'50%'},
    {title:'Cantidad',width:'20%',align:'center'},
    {title:'Importe',width:'30%',align:'right'}
  ]
});
```

`examples/fluent-table-cells.mjs` genera un estado de cuenta real con
contenido rich, fondos, celdas centradas y padding por lado. Las filas largas
conservan padding horizontal al paginar; el vertical se aplica una vez en los
bordes reales de cada fila, no repetido en cada página. Véase
[ADR-0039](docs/adr/0039-table-cell-padding-and-alignment.md).

## Roadmap Unidad 39 (avance): tabla con bordes y bandas de color

Se añadieron `border` en tabla/columna/celda,
`headerBackground`, `oddRowBackground`, `evenRowBackground` y el helper
`groupTableRows()` para organizar encabezados y subtotales suministrados
por el autor. Ver [ADR-0040](docs/adr/0040-enterprise-table-colors-and-borders.md).
**No** están implementados aún `rowSpan` ni `colSpan` o separación inteligente
de filas de grupo al paginar.

### ColSpan paginado

En una tabla de tres columnas, `[{text:'Subtotal general',colSpan:2},'$1,230']`
produce **dos celdas físicas**, siendo la primera tan ancha como las dos
columnas declaradas. Los saltos de página y cabeceras repetidas siguen siendo
nativos. `rowSpan` no está disponible; véase
[ADR-0041](docs/adr/0041-colspan-and-page-safe-table-tracks.md).

## Fundamentos de plantillas JSON versionadas (Unidad 43)

`defineTemplate({schemaVersion:1,title,content})` compila una plantilla JSON
con nodos de texto, cajas, tablas, condiciones booleanas y repeticiones.
`template.document(vufra,data)` retorna el mismo `DocumentBuilder` que Fluent.
No admite código ejecutable ni expresiones arbitrarias en JSON. Véanse
[ADR-0042](docs/adr/0042-json-template-bindings-v1.md) y
`examples/fluent-json-template.mjs`. Son fundamentos experimentales:
faltan schema de datos rico, formatos y migraciones.

## Fundamentos de layout, portada y gráficas (U40–U42)

- `row.column({...})` admite `align:'center'`, `verticalAlign` y padding por lado;
  los offsets y alturas se miden en Rust (sin reconstruir el compositor).
- `document.coverPage(options,content=>...)` produce una portada con caja
  decorada, oculta encabezado/pie recurrente en la primera página y crea el
  salto hacia el primer bloque siguiente sin página final vacía.
- `document.barChart([{label:'Enero',value:10}],{color:'#14789F'})` y la función
  `barChart(data,options)` pintan barras vectoriales con etiquetas y valores
  seleccionables. Se repaginan con las filas, sin canvas ni navegador.

Véanse [ADR-0043](docs/adr/0043-native-bar-charts-and-column-alignment.md),
[ADR-0044](docs/adr/0044-cover-page-composition.md) y
`examples/fluent-visual-report.mjs`. Estos son **hitos parciales**: faltan
Flexbox avanzado, maestros por sección, charts de línea/pie, QR y códigos.

### Encabezados de grupo sin quedar huérfanos

`groupTableRows(...)` marca cada título fusionado con `keepWithNext:true`:
si el encabezado y la primera fila caben juntos en una nueva página,
el paginador Rust los conserva juntos, también en tablas dentro de cajas.
Si juntos exceden una página, se mantiene el comportamiento fragmentable.
Consulta [ADR-0045](docs/adr/0045-page-aware-group-headings.md).
