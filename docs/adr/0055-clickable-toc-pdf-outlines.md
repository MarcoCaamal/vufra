# ADR-0055 — Anotaciones internas clicables y bookmarks reales del PDF

**Estado:** implementado sobre el paginador nativo. Amplía el ADR-0053 sin cambiar su Fluent API ni reescribir los bytes del PDF.

## Contrato Fluent

`document.tableOfContents('Índice')`, `.pageReference('Finanzas', 'Consultar finanzas')` y `.pageSection({title:'Finanzas'},...)` conservan la sintaxis existente, pero ahora sus referencias emitidas son **enlaces internos clicables**. Los títulos de capítulo opcionales se convierten también en entradas **PDF Outlines / Bookmarks** en el orden de las secciones. Los capítulos sin título mantienen las bandas y paginación existentes y no generan bookmarks vacíos.

## Arquitectura

- `PdfDocument.pageMasters[].title` se valida como línea no vacía de máximo 64 caracteres y se transporta a `NodePageMaster.title` y `PdfPageMaster.title`. Rust revalida títulos procedentes del input nativo. No es necesario cambiar el contrato de `PageReference` ni agregar metadatos por fila.
- Rust aprovecha `page_of[target_block]`, ya calculado sobre la **paginación definitiva**, para crear destinos `krilla::destination::XyzDestination` 0-based. No se inventan páginas y los destinos fuera de rango/no renderizables se siguen rechazando antes de emitir el archivo.
- Al dibujar cada `PdfBlock::PageReference` se pinta la etiqueta y el número como hasta ahora y se registra el rectángulo visual de esa línea de 26 puntos. Tras cerrar `Surface` se incorpora un `krilla::annotation::Annotation::new_link(LinkAnnotation)` con destino `Target::Destination(XyzDestination)` y texto alternativo descriptivo; **toda la fila es clicable**, no solo los dígitos.
- Antes de finalizar el PDF, se compone un `krilla::outline::Outline` con `OutlineNode` para cada sección titulada, apuntando a la primera página real de esa sección. La posición de destino es el inicio del área de contenido, donde empieza el capítulo. Cada destino pertenece al mismo documento original, sin anexar PDFs ni navegar a URLs externas.
- El renderer Krilla produce los objetos PDF `/Annots`, `/Subtype /Link`, destinos `/Dest`, `/Outlines` y el árbol de páginas. No hay scripts, postprocesamiento, navegador o dependencias extra. La salida sigue siendo un PDF 1.7 válido con tipografía embebida.

## Pruebas y verificación

`packages/vufra/tests/table-of-contents.test.mjs` genera capítulos con 314 registros, portada e índice. Extrae sus páginas efectivas con `pdftotext`, inspecciona los enlaces **PDF reales** con Poppler `pdftohtml -xml` (las entradas `<a href="...#página">`) y comprueba las entradas `<outline><item page="página">` de los capítulos. Un segundo caso crece de 20 a 150 filas y verifica que **tanto el número pintado como el href y el bookmark** cambian al destino correcto. Se comprueba además render síncrono y asíncrono, títulos alterados/inválidos, y que secciones sin título no generen destinos/outline fantasmas.

`examples/fluent-page-masters.mjs`: informe con tres capítulos nombrados y un enlace independiente al último, con 325 filas y 21 páginas, comprobado con `pdftohtml -xml -hidden` para Operations/Finance/Quality en las páginas físicas 3/10/16.

## Límites vigentes

Los bookmarks son **planos por capítulo**, no jerárquicos; los enlaces por ahora apuntan al **inicio del área de contenido de la página del capítulo**, no a coordenadas exactas de celdas internas. No hay anotaciones a URLs externas, elementos arbitrarios ni control avanzado de apertura/cierre de outlines. Geometría de papel y numeración siguen siendo globales. Una extensión posterior podrá incorporar anchors semánticos y jerarquía si el modelo documental lo requiere.
