# Experimento 50 — Corpus determinista de tablas combinadas y cajas

Estado: primera batería local de regresión, Unidad de estabilización parcial.

## Objetivo

Reducir la probabilidad de inconsistencias en el cruce de geometría y paginación: tablas con `rowSpan`, bordes, estilos alternos y padding individual en cajas con `minHeight`, incluyendo generación de documentos repetida en un proceso de Node.js. A diferencia de ejemplos manuales, el corpus cubre combinaciones estructurales con una semilla fija.

## Método

`packages/vufra/tests/layout-corpus.test.mjs` usa xorshift32 con semilla fija `0x8acafe73`; genera **40 tablas** con 19–26 filas y tres columnas, rectángulos `rowSpan` de 1–4 filas en tracks independientes, fondos, bordes 0.5/1pt, padding de celda individual y contenedores con padding por cuatro lados y `minHeight` opcional. Se emite cada PDF por el renderer nativo, se extrae texto mediante Poppler y se comprueba que **cada etiqueta de celda fuente aparece exactamente una vez**. No se guardan binarios en Git.

## Lo que prueba y lo que no

Prueba ausencia de pérdida/duplicación de etiquetas bajo combinaciones reproducibles y la aceptación de un lote de estructuras válidas. Las pruebas específicas `table-rowspan.test.mjs`, `box-side-padding.test.mjs` y `table-style-edges.test.mjs` verifican además posiciones X/Y y colores RGB mediante Poppler. Esto **no es fuzzing arbitrario**, ni verifica todavía golden images hash estables en distintos sistemas operativos, rendimiento de millones de filas, PDF/A o accesibilidad etiquetada.

Rollback: revertir el test y este experimento sin modificar las implementaciones verificadas.
