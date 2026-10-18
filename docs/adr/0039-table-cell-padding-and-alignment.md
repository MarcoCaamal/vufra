# ADR-0039 — Padding y alineación por celda de tabla

Estado: implemented locally (Unit 38, 2026-10-17). El commit/estado Git se documenta en el milestone.

## Motivación

Las tablas solo podían justificar el contenido hacia la izquierda o derecha y medían
las líneas usando el ancho **completo** de la columna. Los 5pt verticales del texto
no eran configurables; faltaban centrado horizontal, distribución vertical entre
celdas de distinta altura y padding de cuatro lados. Las tablas tienen que seguir
permitiendo contenido rich, imágenes, cabeceras repetidas y paginación de filas largas.

## Interfaz pública

`StyledTableOptions.padding`, `StyledTableColumn.padding` y `StyledTableCell.padding`
aceptan `number` o `{top?,right?,bottom?,left?}` en puntos PDF. Cada nivel
sobrescribe **solo los lados especificados**: celda > columna > tabla > defaults
(top=5, bottom=5, left=0, right=0). Valores 0..40pt finitos, suma horizontal
que deje al menos 12pt de contenido. Para padding escalar se sustituyen los
cuatro lados.

`align: 'left'|'center'|'right'` en columnas y celdas; celda > columna >
left. `verticalAlign: 'top'|'center'|'bottom'` se define opcionalmente en tabla,
columna y celda, con esa misma precedencia; default top. La alineación horizontal
se calcula *por línea* sobre el ancho real de contenido y funciona para texto
simple y rich; el offset ya medido sobrevive a la fragmentación sin re-shaping.

No se agrega un segundo DSL ni CSS universal. La nueva geometría de celda viaja
como metadatos del `PdfRowColumn.cell` hasta NAPI/AST semántico owned/Rust. Las
filas normales siguen usando `cell:None` y sus reglas previas de alineación.

## Implementación y límites

- El normalizador TS valida antes del render, Rust vuelve a validar (no confiar
  en objetos NAPI); tamaños de imágenes/cajas/gráficos dentro de una celda
  respetan el ancho después del padding.
- Rust usa la anchura interior para medición de texto Parley/rich y posiciona
  las líneas left/center/right, sin cálculos absolutos en JavaScript.
- Cada columna suma padding top/bottom a la altura medida. La altura de la fila
  es el máximo de las columnas; para filas **atómicas**, la diferencia restante
  se reparte por `verticalAlign` (0%, 50%, 100%) sin mover bordes ni fondos.
- Filas cuya altura excede una página se convierten en filas de líneas
  fragmentadas: se mantiene el padding horizontal en cada línea, el superior
  **solo en el primer fragmento** y el inferior **solo en el último**. El alineado
  vertical de esas filas se normaliza a top por fragmento: no existe un 'centro'
  único significativo para una celda que atraviesa páginas.
- Columnas sin centrado/derecha conservan el camino rápido de posiciones
  constantes y no vuelven a medir la anchura por línea.
- No se implementan rowspan/colspan, CSS completo, clipping arbitrario o
  sombreado por celda.

## Calidad

Pruebas Node Poppler inspeccionan `pdftotext -bbox` para obtener coordenadas X/Y
reales de las líneas, preservación de 450 IDs en fila rica fragmentada y rechazo
de datos inválidos. Rust prueba validación nativa, preservación del AST owned y
padding solo en límites originales de fragmentos. Ejemplo:
`examples/fluent-table-cells.mjs` genera 135 operaciones en 11 páginas.

Rollback: revertir el commit Unit38 completo (API, NAPI, Rust, pruebas, docs).
Vufra es pre-v1: no conservar la API interna antigua si evoluciona el contrato.
