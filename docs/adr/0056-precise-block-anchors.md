# ADR-0056 — Anclas a bloques y destinos internos con coordenada exacta

Estado: implementado localmente en `feature/unit56-precise-pdf-anchors`, como continuación de la navegación PDF de ADR-0055. No introduce un sistema de reescritura de PDF ni cambia el motor de paginación.

## API Fluent

```ts
const doc = vufra.document({page:'Letter'})
  .linkTo('totals', 'Ir al resumen de cifras')
  .paragraph('Introducción')
  .anchor('totals', content => {
    content.heading('Resumen de cifras');
    content.table(rows, {columns});
  });
```

- `.anchor(id, callback)` incorpora uno o varios bloques del `ContentBuilder` y registra el **primer bloque** como destino con identificador `id`. Los IDs admiten 1..64 caracteres `[A-Za-z][A-Za-z0-9_-]*`, con máximo 256 anclas y sin duplicados. No se aceptan callbacks vacíos ni que empiecen con un `pageBreak`.
- `.linkTo(id,label?)` crea una fila enlazada al ID, incluso si el destino todavía no se ha declarado (forward reference). El texto de la fila admite hasta 64 caracteres en una línea. Un ID inexistente se rechaza en el snapshot de render, no se genera un enlace muerto.
- La Fluent API sigue siendo funcional e inmutable: cada llamada devuelve un builder distinto, sin alterar sus ancestros. Se permiten anclas en medio de capítulos y también en documentos sin capítulos. Las anclas no generan bookmarks por sí solas: los bookmarks siguen perteneciendo a `pageSection({title})`.

## Resolución y renderizado

1. La autoría conserva los registros de ancla como `{id,block}` referidos a los índices del árbol de contenido original, sin insertar filas de texto ocultas ni espaciadores. Los usos de `linkTo` son bloques authored `anchor-reference`.
2. En `DocumentBuilder.renderInput()`, una **única** expansión del índice automático y de las referencias (`tableOfContents`, `pageReference`, `linkTo`) produce nodos estándar `PdfBlock::PageReference`. Los índices que cambian por la expansión del TOC se remapean mediante `starts[originalBlock]`. La normalización TypeScript/NAPI y el AST de Rust siguen recibiendo solamente el `targetBlock` validado del modelo anterior, sin nuevo protocolo nativo de identidades.
3. Rust ejecuta su paginador normal, recorre `PagePlan.fragments` y acumula la altura medida de cada fragmento para registrar `(pageIndex,yTop)` de la **primera porción visible** de cada bloque. No se estiman alturas desde TypeScript ni se lee/reescribe el PDF final. La posición es la esquina superior del rectángulo de layout del bloque, no necesariamente el borde superior exacto de los glifos (párrafos tienen padding y baseline).
4. Los destinos `XyzDestination` de `LinkAnnotation` reciben la página absoluta y coordenada Y ya resueltas. Las entradas de TOC, referencias a capítulos y bookmarks también aprovechan la misma ubicación precisa, en vez del margen superior de la página. La región clicable de una referencia continúa siendo toda su fila de 26pt.
5. La posición de destino es local al contenido en el folio y sólo se calcula para bloques top-level. Una caja grande/table fragmentable se vincula al comienzo de su **primer fragmento**; no se soportan aún anclas en una fila concreta, en líneas internas o elementos anidados de un `row`/`box`.

## Evidencia

`packages/vufra/tests/precise-anchors.test.mjs`: Poppler verifica los renglones y las páginas, mientras se inspeccionan los destinos nativos PDF `/Dest [...] /XYZ` y se convierten desde coordenadas PDF inferiores para compararlos con los `bbox` reales de encabezados. El destino a medio folio corresponde a la Y del bloque (tolerancia ~16pt), no al margen superior de la página. Verifica snapshots remapeados tras expansión TOC, referencias adelantadas y desplazamientos multipágina, resultados idénticos de render síncrono/asíncrono, ausencia de bookmarks espurios y errores de identificadores/callbacks/destinos inválidos.

## Límites

No existen hyperlinks inline dentro de párrafos (se usa una fila de navegación propia), destinos a nivel de celda/línea, nombres PDF externos persistentes, ni outlines jerárquicos. La anchura y altura de página siguen uniformes por documento. Futuros cambios de geometría por sección deben preservar la resolución de coordenadas desde el **plan final** y no crear una segunda fuente de verdad.
