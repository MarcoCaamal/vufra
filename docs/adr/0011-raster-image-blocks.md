# ADR-0011 — Bloques de imágenes raster PNG/JPEG en Vufra

- **Fecha:** 2026-10-16
- **Estado:** aceptada para prototipo (Unidad 10); API aún experimental.

## Contexto

El compositor de las Unidades 05–09 soportaba texto y tablas, pero no logotipos, fotografías, sellos ni firmas en formatos raster. Se requiere introducir imágenes sin usar Chromium, HTML ni procesos externos al motor PDF y sin romper la ruta síncrona, asíncrona o su cola.

## Decisión

1. Extender `PdfBlock` Rust con `Image(PdfImage)`; `PdfImage { data: Vec<u8>, width: f32, height: f32, fit: ImageFit }`. Los bytes recibidos se incrustan en Krilla; no se interpretan rutas externas.
2. El SDK expone una unión discriminada `{ type: 'image', data: Uint8Array, width, height, fit?: 'contain'|'cover' }`. El binding NAPI conserva un objeto interno `NodeImage` con los mismos campos. Se acepta como compatibilidad experimental `{ type: 'image', image: { data, width, height, fit? } }`.
3. Krilla 0.8.2 interpreta PNG/JPEG y registra los recursos PDF; PNG con alfa produce una máscara de transparencia. `contain` escala isotrópicamente al máximo dentro de un box y centra; `cover` escala isotrópicamente hasta llenar y **recorta** a la caja usando `PathBuilder` y `FillRule::NonZero`.
4. El nodo se planifica como `FlowBlock::Image`, fragmento `FlowFragment::Image`, **indivisible**. Cabe en el remanente o pasa completo a la página siguiente. Su alto siempre se reserva como tamaño de caja, independientemente del bitmap escalado.
5. El motor aplica el ancho/alto imprimible real de `PageGeometry` y no sale de sus márgenes. Si el box no cabe en una página **completa**, rechaza explícitamente; no parte imágenes ni reduce silenciosamente las medidas solicitadas.
6. Limitar fuentes de datos: PNG/JPEG solamente, bytes entre 1 y 8 MiB, como máximo 64 imágenes y 32 MiB codificados en total, máximo 12 megapíxeles por imagen y 24 megapíxeles acumulados. Se validan dimensiones de metadata **antes de decodificar los píxeles** en la finalización de Krilla. El límite no es una garantía de consumo RSS total ni evita todos los posibles casos de decompression-bomb: sigue siendo un prototipo.
7. La cola `PdfRenderQueue` elimina los payloads binarios del JSON de estimación y contabiliza `byteLength` real, evitando expandir `Uint8Array` y `Buffer` en JSON decimal. La instancia mantiene snapshots mediante `structuredClone`; las tareas NAPI son Rust-owned como antes.
8. `renderPdf`, `renderPdfAsync`, medición nativa, cancelación cooperativa y los campos antiguos `paragraphs/rows/table` conservan sus contratos.

## Alternativas no implementadas

- SVG, GIF/WebP y conversiones automáticas, aunque Krilla pueda admitir formatos adicionales.
- Imágenes por URI o paths resueltos desde Rust, para evitar acceso implícito a I/O.
- Posicionamiento absoluto, rotación arbitraria, bordes, alineaciones de bloque más allá de caja/centrado, imágenes repetidas como watermark, imagen dentro de celda y segmentación de imágenes.
- Keep-with-next/keep-heading con el bloque de imagen, control de viudas y huérfanas.
- Deduplicación global de inputs del SDK y protección dura de RSS durante rasterización.

## Evidencia

Pruebas e2e con `pdfimages -list`, `pdftoppm` y `pdftotext`: PNG/JPEG embebidos, contain con letterbox blanco, cover sin estiramiento y clipping visible, máscara de transparencia, paginación con márgenes custom, límites de entrada e imagen binaria retenida correctamente en cola y render asíncrono. Véase [Unidad 10](../experiments/11-images-milestone.md).
