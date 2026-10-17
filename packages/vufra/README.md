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
