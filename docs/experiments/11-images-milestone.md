# Unidad 10 — PNG/JPEG en el compositor PDF

**Fecha:** 2026-10-16. **Estado:** prototipo funcional.

## Implementación

- `crates/vufra-pdf/src/image.rs`: `PdfImage`, `ImageFit`, `PreparedImage`. PNG/JPEG validados, embedding con Krilla, contain/cover mediante escalado isotrópico + clip rectangular, límites de bytes y píxeles.
- `crates/vufra-layout/src/flow.rs`: bloque y fragmento `Image` indivisible; ocupa su propia altura y cambia de página si el espacio remanente no alcanza, sin página extra vacía.
- `crates/vufra-pdf/src/flow_render.rs`: imágenes junto a títulos, párrafos, espaciadores y tablas en `blocks`; medición usando geometría A4/Letter/custom y chequeos de cancelación antes/durante la preparación.
- `bindings/vufra-node/src/lib.rs`: `NodeImage` recibe `Buffer` para datos binarios. La propiedad de los bytes pasa a Rust y la misma ruta funciona en `renderPdf` y `renderPdfAsync`.
- `packages/vufra/src/index.ts`: nodo plano `image`, `PdfImage` tipado y validación de tamaños/fit. La forma anidada provisional también funciona, aunque preferimos el nodo plano.
- `packages/vufra/src/queue.ts`: estimación de tamaño de entradas binarias por `byteLength`; snapshots inmutables del documento/imágenes al encolar.

## Ejemplo

```ts
import { readFileSync } from 'node:fs';
import { renderPdfAsync } from 'vufra';

const pdf = await renderPdfAsync({
  title: 'Certificado ilustrado',
  blocks: [
    { type: 'image', data: readFileSync('logo.png'), width: 180, height: 80, fit: 'contain' },
    { type: 'heading', level: 1, text: 'Certificado' },
    { type: 'image', data: readFileSync('foto.jpg'), width: 200, height: 200, fit: 'cover' }
  ]
}, font);
```

## Pruebas y QA

- `packages/vufra/tests/images.test.mjs`: 6 pruebas PDF reales para PNG/JPEG, contenido mixto y orden, diferencias píxel a píxel entre contain/cover mediante PPM generado por Poppler, PNG transparente con `smask`, paginación de imágenes, validación de formatos/tamaños/presupuestos y aislamiento en cola + SDK asíncrono.
- `packages/vufra/tests/fixtures/`: imágenes de colores generadas localmente, incluyendo casos de PNG grande/comprimido para validar límites de dimensiones (sin fotografías, fuentes ni licencias de terceros).
- `examples/images-usage.mjs`: genera `artifacts/images-report.pdf` de **4 páginas Letter**, con imágenes y 33 filas ordenadas/extractables mediante `pdftotext`.
- `pdfimages -list` detectó dos imágenes raster RGB, un PNG con canal alfa y la máscara `smask` correspondiente; `pdftoppm` renderizó las primeras dos páginas y se inspeccionaron visualmente.
- La API de imagen funciona sin npm/nativos empaquetados adicionales. La batería previa de Node y Rust continúa en verde.

## Limitaciones y siguiente paso

- No hay composición `keep-with-next` todavía: un heading inmediatamente anterior a una imagen puede quedar en la página previa a esa imagen. Las imágenes **sí** se mueven indivisiblemente.
- No existe lectura de URL/path por la librería; cada usuario pasa sus bytes de imagen directamente.
- No soportamos SVG/paths vectoriales, imágenes por celda, estilos de imagen, ajustes `object-position`, recorte manual, auto tamaño de imagen, streaming ni PDF multi-font/RTL completo.
- Faltan pruebas de memoria real bajo cargas hostiles; los límites preflight no son presupuesto exacto de RSS.
- Próximo hito recomendado: **listas/elementos gráficos y agrupación semántica `keepWithNext`** para que los títulos permanezcan unidos a imágenes y tablas.
