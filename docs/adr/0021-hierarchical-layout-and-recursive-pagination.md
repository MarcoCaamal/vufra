# ADR-0021 — Árbol de layout Rust y paginación jerárquica por hojas

**Fecha:** 2026-10-17. **Estado:** implementado y verificado localmente. Unidad 20.

## Contexto

Hasta Unidad 19 la Fluent API TypeScript compone un AST lógico con Box, Row,
Grid, Table, Paragraph e Image, pero Rust conservaba `PdfBlock/PdfBoxItem/PdfRowItem`
y el paginador trataba una caja anidada como átomo. Una caja hija con cientos
de líneas era rechazada aunque cada línea individual cupiera.

Queremos un **árbol común de medición y fragmentación**, independiente de Krilla,
sin reemplazar de golpe los motores maduros de shaping y las tablas existentes.

## Decisión arquitectónica

1. Nuevo tipo independiente de PDF: `crates/vufra-layout/src/tree.rs` con
   `LayoutNode::{Leaf,Container,RepeatTable}` y
   `FlattenedLayout::{heights,groups,headers}`.
   El renderer Rust **baja** los contenidos específicos a nodos geométricos
   al concluir la medición de cada `PreparedBox`. Este árbol define un orden
   DFS estable, medido en puntos. Ya se usa realmente para planificar páginas.
2. Un contenedor `Container` registra rango [start,end), padding, keepTogether
   y breakBefore. El paginador Rust cobra padding *en cada página ocupada*
   por el contenedor, incluyendo continuaciones de Box->Box->Box. Los índices
   anidados no permiten cruces parciales de intervalos.
3. Las tablas enriquecidas se registran como `RepeatTable` con cabecera y
   filas. El header solo se repite cuando una tabla continúa en otra página,
   incluyendo tablas insertadas dentro de varias cajas anidadas; el coste
   de la cabecera se reserva antes de acomodar filas.
4. `PreparedBox` retiene el árbol de objetos preparados con sus fuentes,
   imágenes y estilos, más los rangos DFS de cada item. En cada fragmento
   de página el pintor selecciona las hojas y recorre **recursivamente**
   solo los contenedores ocupados. Cada uno dibuja su fondo/borde/padding
   medido sin recortar ni repetir contenido. Los bordes horizontales
   superior/inferior aparecen solo en el primer/último fragmento.
5. Fila `PdfRow` con columnas que exceden una página: el motor preserva la
   representación atómica cuando la fila cabe. Cuando no cabe, convierte
   los párrafos de texto normal en líneas reales medidas por Parley y
   crea segmentos de fila sincronizados por índice de elemento en cada
   columna; en cada segmento conserva anchos, alineación y elementos de
   otras columnas. Los segmentos son hojas del mismo paginador de cajas.
   Aplicado tanto a filas raíz como dentro de Box->Row y Grid. No se
   omite ninguna columna ni se duplica su contenido.
6. Conservamos la semántica de seguridad: profundidad máxima de 8;
   hasta 10,000 hojas por box y hasta 500 líneas por fila desbordada;
   presupuesto global de texto e imágenes de las unidades anteriores;
   rechazo explícito de filas enriquecidas individuales que no se
   pueden subdividir sin perder shaping.

## Garantías

- `keepTogether` y `breakBefore` de cajas anidadas aplican a sus
  spans reales, no solo a cajas raíz. Un keepTogether imposible falla,
  no dibuja fuera de página.
- Los márgenes imprimibles y la geometría del `PageChrome` se reservan
  antes del layout. El paginador `vufra-layout` es independiente del
  PDF writer.
- Fluent TypeScript y `.add()` siguen iguales; no añadimos una sintaxis
  distinta ni un headless browser.
- `table()` clásico con filas divisibles sigue usando el paginador
  `split` original; las tablas enriquecidas con celdas complejas
  siguen siendo atómicas por fila y repiten encabezados.

## Limitaciones explícitas

**No hay todavía un AST semántico universal para todo Rust.** La
representación de geometría sí está unificada y se usa para fragmentar
cajas y filas, mientras que `PdfBlock/PdfBoxItem/PdfRowItem` siguen
especializados para pintura, shaping y AST de NAPI. Una futura migración
puede normalizar estos tipos sin reescribir la paginación aquí presentada.

Los fragmentos multicolumna de filas desbordadas se sincronizan por índice
de elemento, no mediante cursores totalmente independientes. Un solo
elemento de rich text con múltiples fuentes, una imagen gigante o una caja
compleja dentro de una celda que exceda una página aún es atómico y se
rechaza. Las tablas enriquecidas siguen dividiendo entre filas, no en
medio de una celda, y no hay rowspan/colspan ni bidi/RTL universal.

## Validación

- `vufra-layout/src/tree.rs`: prueba del DFS, ranges, tables, rechazos
  de datos inválidos y profundidad; `flow.rs`: paddings por página,
  headers repetidos, keepTogether y breakBefore.
- `packages/vufra/tests/composable.test.mjs`: 250 tokens en 3 cajas
  profundas, repetición de headers de una tabla de 175 registros,
  42/35 columnas largas, 41/42 columnas anidadas, 2,000 términos de
  texto en una única fila, `pdftotext -bbox` sin desbordes y muestreo
  RGB real de la caja repetida en primera, media y última página.
- `examples/fluent-hierarchical.mjs`: PDF de 23 páginas, 210
  `STATEMENT_*`, 160 `INVOICE_*`, 45 `LEFT_COL_*` y 39 `RIGHT_COL_*`
  exactamente una vez y en orden; 2 fuentes Noto incrustadas. Archivos
  de salida están ignorados en `artifacts/`.
- Regresión de Unidades 1–19 validada con Rust, Clippy, TypeScript y
  pruebas Node. No se ha ejecutado CI remoto (sin push).
