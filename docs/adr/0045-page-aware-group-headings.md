# ADR-0045 — Agrupaciones que no dejan encabezados huérfanos (Unidad 39)

Estado: implementado localmente, sujeto a QA.

## Problema y contrato

`groupTableRows()` crea una fila de título (con `colSpan:columnCount`) seguida del primer registro del grupo. Si el título cabe justo al final de una página, el paginador lo dejaba aislado y pasaba el registro siguiente a la siguiente página.

Ahora `keepWithNext?: boolean` se acepta únicamente en la **primera celda fusionada de una fila del cuerpo** que cubra todo el ancho. `groupTableRows()` lo activa automáticamente. Se rechaza en celdas no fusionadas/múltiples, en la cabecera, sin fila siguiente o con valores que no sean booleanos.

El motor toma como indivisible la pareja título + primera fila *cuando su medida cabe en una página vacía*. Si esa pareja excede el alto disponible de una página nueva, conserva la política de división anterior y no crea un error nuevo por una agrupación opcional. No promete mantener un grupo de 100 filas completo.

## Diseño

El SDK calcula `PdfBoxTable.keepWithNext: number[]` de índices de filas del cuerpo. La normalización TypeScript valida límites, orden y continuidad antes de NAPI. La conversión Rust guarda `PdfBoxTable.keep_with_next` y el `ContentNode::StyledTable` conserva los índices mediante el AST owned. El preparador de `PreparedBox` detecta las dos hojas reales preparadas (título y siguiente fila) y añade una restricción `BoxNestedSpan {keep_together:true,padding:0,break_before:false}` al mismo paginador de cajas; no introduce contenido extra ni falsifica alturas. Las restricciones dentro de una caja anidada se trasladan al rango DFS del contenedor padre. Se ordenan por inicio y amplitud para conservar la validación de padres/hijos.

No se cambian los encabezados repetidos ni el algoritmo para medir líneas, imágenes y fondos. Un grupo no sustituye `rowSpan`, cuyo modelo de alturas multipágina todavía está pendiente.

## Comprobación

`packages/vufra/tests/group-keep-next.test.mjs` compara un PDF adverso sin keep (título aislado) contra el mismo conjunto de filas con keep (título + primera fila juntos), verifica PDF en box anidado, cabeceras repetidas, 39 IDs únicos y rechazos de valores inválidos. Rust valida índices duplicados, desordenados o sin siguiente fila.

Rollback: revertir únicamente el commit asociado a ADR-0045.
