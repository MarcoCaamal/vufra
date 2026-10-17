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
