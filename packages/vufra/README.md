# vufra — Fluent PDF SDK experimental

Node.js + TypeScript, Rust NAPI y Krilla. Licencia `MIT OR Apache-2.0`.
**Sin garantías de compatibilidad hasta llegar a una versión estable.**

## API única

```ts
import {createVufra,box,paragraph} from 'vufra';

const app=createVufra({font:regularFont,fonts:{bold:boldFont}});
const Card=(name:string,value:string)=>box({padding:12},[
  paragraph(name),paragraph(value,{bold:true})
]);

const pdf=await app.document({title:'Reporte',page:'Letter'})
  .heading('Datos')
  .paragraph('Introducción')
  .box({padding:16},c=>c
    .table([
      ['C001',{runs:[{text:'Texto ',bold:true},{text:'detallado'}]}],
      ['C002','Otro servicio']
    ],{columns:[
      {title:'Folio',width:'30%'},{title:'Detalle',width:'70%'}
    ]})
  )
  .add(Card('TOTAL','$120'))
  .render();
```

Únicamente `.table(rows, {columns})`: no hay `.tableStyled()`,
no se admiten tablas desde objetos indexados por propiedades y
no existe el viejo documento con `paragraphs`, `rows` y `table`.

Las cajas admiten varios hijos, box dentro de box, rows, grids y tablas.
`.add(node)` permite reutilizar componentes funcionales. La Fluent
API sigue encadenada e inmutable. `.renderSync()`, `.render()` y
`.enqueue(queue)` comparten el motor nativo Rust.

## Cola y cancelación

```ts
import {PdfRenderQueue} from 'vufra';

const queue=new PdfRenderQueue({maxConcurrent:2,maxQueued:8});
const pdf=await app.document({title:'Contrato'})
  .paragraph('Documento con contenido')
  .enqueue(queue);
queue.close();
```

`PdfRenderQueue` ofrece FIFO, límites de tamaño/capacidad, cancelación
y estadísticas. El `DocumentBuilder` aísla los buffers cuando crea
cada componente; `.toDocument()` devuelve una copia profunda segura
para inspección. El render directo evita esa copia innecesaria.
La cola conserva su snapshot de entrada al admitir un trabajo.

No se expone `renderPdf` como API npm. Las rutas de NAPI,
el normalizador de datos y los adaptadores del dibujador Krilla
son internos y pueden cambiar.

## Verificaciones

```bash
# Desde el raíz del monorepo
bash scripts/build-native.sh
cd packages/vufra
npm run build
npm test
```

Pruebas de PDFs reales verifican Unicode, exactitud de registros,
fuentes incrustadas, paginación, tablas, colores RGB e imágenes PNG/JPEG.
Los ejemplos vigentes se encuentran en `examples/fluent-*.mjs`
y `examples/nestjs/` (snippets sin compilación NestJS dentro del repo).

## Límites

La API es experimental. Algunas imágenes, celdas y encabezados
indivisibles pueden producir un error cuando exceden la página;
no hay rowspan/colspan, bidi/RTL completo ni SVG. No se incluyen
fuentes. Detalles de arquitectura y decisiones en los ADR del README raíz.

## Perfilado owned del motor

La API Rust `render_semantic_pdf` recibe el documento owned por valor.
El AST se consume hacia el pintor sin clonación completa; no existe
zero-copy universal entre TypeScript, NAPI, Rust y Krilla.
Benchmark reproducible: `scripts/benchmark-native-memory.mjs`.

## Optimización de buffers de fuentes

Unidad 25: comparte bytes de fuentes entre Krilla/Fontique/Rust
mediante `Arc<Vec<u8>>` y mueve fragmentos de filas sin volver
a clonar imágenes/rich text durante el ensamblaje. Los snapshots
de la cola y la API Fluent siguen intactos. El benchmark:
`scripts/benchmark-font-rows.mjs`; documentación ADR-0026.

## Filas grandes sin repetir el shaping

Al fragmentar una fila que excede la altura imprimible, el motor
reutiliza las líneas y offsets obtenidos del primer paso de medición.
Funciona en filas raíz, boxes y cuerpos de tablas enriquecidas,
preservando estilos, colores, alineación y encabezados. La sintaxis
Fluent no cambia. Consultar ADR-0027 y el benchmark
`scripts/benchmark-font-rows.mjs`.

## Imágenes reutilizadas al fragmentar filas

El motor Rust ya no reinterpreta ni copia imágenes PNG/JPEG al
dividir filas largas. Su objeto `PreparedImage` se reutiliza
internamente a través de un `Arc` con la misma geometría, fit
y controles de seguridad. Funciona en raíz, boxes y tablas styled.
La API Fluent pública no cambia.

Benchmark: `scripts/benchmark-fragmented-images.mjs`.
Más información: ADR-0028.

## Fuente principal owned y snapshots en NAPI

La fuente principal se transfiere como `Vec<u8>` owned desde NAPI
hasta `Arc<Vec<u8>>` de Rust sin copias internas adicionales.
Se **conserva** un snapshot seguro desde la memoria mutable de JS
para evitar carreras con el worker asíncrono. También se mantiene
el aislamiento de `PdfRenderQueue` y sus cancelaciones.

Benchmark: `scripts/benchmark-napi-font-ownership.mjs`, ADR-0029.

## Reutilización automática de fuente nativa

`createVufra({font})` crea un snapshot inmutable en Rust y
reutiliza el mismo recurso `NativeFont` en documentos Fluent
sucesivos. Una fuente de override crea su propio recurso. No cambia
la sintaxis pública ni los snapshots y límites de `PdfRenderQueue`.

El primer paso JS→NAPI sigue copiando los bytes por seguridad:
no es zero-copy de buffers arbitrarios de Node. Benchmark
`scripts/benchmark-reused-native-font.mjs` y ADR-0030.

## Assets gráficos y fuentes adicionales inmutables

El factory Fluent reutiliza internamente fuentes bold/fallback
y contenidos PNG/JPEG registrados en recursos nativos mediante
`Arc<Vec<u8>>`, sin añadir una nueva sintaxis.
El caché de imágenes tiene un límite residente por factory
(256 elementos / 64 MiB), con fallback a contenido inline.
Los límites por documento, snapshots de cola y cancelación
siguen aplicándose, incluso con referencias a imágenes idénticas.

Las fuentes extraordinariamente grandes se liberan después
de la preparación del trabajo para evitar retención del GC.
Ver `scripts/benchmark-reused-assets.mjs` y ADR-0031.

## Rendimiento raster y renders concurrentes

Los PNG y JPEG se preparan de forma aislada para cada PDF.
Un caché compartido del objeto preparado de Krilla fue probado
y **rechazado** por una regresión severa en tareas concurrentes.
El caché acotado de bytes comprimidos permanece intacto.

Benchmark: `scripts/benchmark-large-raster.mjs`; test:
`packages/vufra/tests/large-raster-concurrency.test.mjs`.
Detalles: ADR-0032. La Fluent API no cambia.

## Layout de grid proporcional

Además de `grid({columns:3})`, ahora puedes expresar
`grid({columns:['2fr','1fr'],gap:12})`,
`grid({columns:[100,'30%','1fr']})` o
`grid({columns:['*','2fr']})`.
Las pistas se calculan en puntos PDF desde el ancho real
del contenedor (también en `box()`, `header()` y `footer()`).

Vufra valida que cada columna tenga al menos 60pt y que el
grid no exceda el espacio disponible antes de enviarlo a Rust.
Se usa el mismo builder Fluent y un único resolver.

Ejemplo completo: `examples/fluent-grid-tracks.mjs`.
Ver ADR-0033.

## Presets reutilizables de texto y caja

Configura `theme.presets.text` y `theme.presets.box` y referencia
cada estilo desde `paragraph('Texto',{preset:'label'})` o
`box({preset:'card'},callback)`. Las opciones explícitas tienen
prioridad y los presets son planos, sin herencia recursiva.
También funcionan en headings, rich text, cajas anidadas,
componentes `.add()` y texto de header/footer.

Ejemplo completo: `examples/fluent-style-presets.mjs`.
Más contexto en ADR-0034.

## Grid automático por ancho mínimo

Además de `grid({columns:3})` y pistas explícitas,
`GridOptions.columns` acepta `AutoGridColumns`:
`{minWidth:150,maxColumns:3}`. El número de columnas
se calcula según el ancho real de página o caja.
Usa `rowGap` para espaciar filas de distintas alturas
sin establecer posiciones o alturas manualmente.

Es la misma API Fluent y también funciona con
nodos reutilizables `grid(...)` en `.add(...)`.
Ejemplo completo: `examples/fluent-auto-flow.mjs`;
diseño: ADR-0035.

## Saltos de página visualmente coherentes

Los títulos (keepWithNext por defecto) ahora permanecen unidos
al siguiente contenido visible aunque existan `spacer()` entre
ambos. Una tabla que cabe completa se mueve con el título;
una tabla multipágina puede mantener el título con su
primera sección útil.

Los espaciados que cruzan una frontera implícita dejan de
introducir margen superior accidental. Los `spacer()`
al inicio o después de `.pageBreak()` siguen siendo explícitos.
No cambia la API Fluent. Ver ADR-0036 y el ejemplo
`examples/fluent-page-aware-sections.mjs`.

## Bordes y fondos de cajas en varias páginas

Al anidar `box()` y `table()`, Vufra mantiene los fondos y
bordes laterales en cada fragmento y dibuja los bordes superior
e inferior únicamente al comienzo y fin **reales** de cada
contenedor. Los encabezados repetidos de tablas no cuentan como
nuevo inicio de caja.

No hay cambios en la sintaxis Fluent ni en los presets.
Ejemplo: `examples/fluent-nested-box-continuations.mjs`.
Documentación de diseño: ADR-0037.

## Esquinas redondeadas en `box()`

`box({radius:12,padding:16},cb)` genera curvas vectoriales
con un único radio expresado en puntos PDF. También admite
`theme.presets.box.card.radius`. Reglas: radio finito
entre 0 y 24, no mayor que `padding`.

Los bordes de cajas paginadas solo se redondean en la
primera/última página real de cada contenedor. Los cortes
intermedios permanecen rectos, sin afectar tablas ni
encabezados repetidos. `radius:0` conserva el dibujo anterior.

Ejemplo: `examples/fluent-rounded-dashboard.mjs`.
Detalles: ADR-0038.

## Alineación y espacio interior de tablas

La Fluent API permite controlar `align`, `verticalAlign` y `padding` en la tabla,
la columna y cada celda. `align` admite `left`, `center`, `right`; `verticalAlign`
admite `top`, `center`, `bottom`. `padding` puede ser un número (todos los lados)
o un objeto parcial de `{top,right,bottom,left}` expresados en puntos PDF.
Cada lado hereda por separado del nivel superior; los valores predeterminados
son 5pt arriba/abajo y 0 a los lados, evitando un cambio inesperado en los
reportes preexistentes. El área interior reserva por lo menos 12pt de ancho.
El centro vertical se aplica en filas completas; en filas que cruzan páginas el
contenido se alinea al inicio de cada fragmento.

Ejemplo ejecutable: `examples/fluent-table-cells.mjs`.

## Tablas profesionales: bordes, bandas y grupos (Unidad 39 parcial)

`table(rows,{columns,border:{width:1,color:'#CCDDEE'},
headerBackground:'#EAF2FF',oddRowBackground:'#FFFFFF',evenRowBackground:'#F4F7FB'})`
admite bordes por tabla, columna o celda y un `background` explícito por celda
que prevalece sobre las bandas. `border:{width:0}` suprime el trazo.
`groupTableRows(groups,columnCount,options)` convierte grupos con filas y
subtotales preformateados a la misma tabla Fluent sin introducir otra DSL.
No hay `colSpan`/`rowSpan` ni cálculo monetario implícito.

Las celdas también admiten `colSpan`, por ejemplo:
`[{text:'Sección norte',colSpan:2}, {text:'MXN 1,500',align:'right'}]`
para una tabla con tres columnas. No se admite todavía `rowSpan`.

## Plantillas JSON tipadas sin código ejecutable

`defineTemplate()` crea un contrato serializable `schemaVersion:1` con
`heading`, `paragraph`, `box`, `table`, `if`, `each`. Los `bind` son rutas de
propiedades propias de datos, sin evaluación. El resultado de
`.document(vufra,data)` es un `DocumentBuilder` normal. Véase
`examples/fluent-json-template.mjs` y ADR-0042. Sin dataSchema completo,
formateadores de moneda/fecha o modo streaming.

## Composición y gráficos sin imágenes raster

`row.column({align:'center',verticalAlign:'center',padding:{left:8,right:8}},... )`
centra contenido según medidas reales. `document.coverPage(options,callback)`
genera portada como primer bloque, sin header/footer en la portada y con salto
único diferido hacia contenido posterior. `document.barChart(data,options)`
permite barras horizontales vectoriales con texto real de etiquetas/valores.
Ejemplo ejecutable: `examples/fluent-visual-report.mjs`. Las variantes de
maestras par/impar, line/pie/QR y box model general siguen pendientes.

Las agrupaciones generadas por `groupTableRows()` mantienen el título con su
primera fila de datos cuando cabe en una página. También se puede usar
`{text:'Grupo',colSpan:2,keepWithNext:true}` como primera y única celda
de una fila de grupo (seguida de al menos una fila). `rowSpan` sigue pendiente.

Para validación de datos de plantillas JSON, `defineTemplate` admite
`dataSchema.fields` con tipos `string|number|integer|boolean|array|object`,
`required` y límites de longitud para strings/arrays. Los bindings de texto
admiten formato determinista `{kind:'currencyMinor',currency:'MXN',locale:'es-MX'}`
con entero de unidades menores; JPY y KWD respetan sus unidades distintas.
Sin transformaciones ejecutables ni dependencias de terceros para formato.

Se pueden configurar encabezados y pies diferenciados por número impreso
impar/par con `.oddHeader()`, `.evenHeader()`, `.oddFooter()` y `.evenFooter()`.
Cada método acepta callback o `null` para suprimir la variante; la primera
página puede redefinirse con `firstHeader`/`firstFooter` o `coverPage`.
La paginación mide de antemano la variante de banda más alta.
