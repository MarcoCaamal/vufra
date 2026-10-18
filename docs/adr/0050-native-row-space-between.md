# ADR-0050 — Distribución de espacio sobrante en filas Fluent

Estado: implementado localmente; no se añade un segundo algoritmo de tipografía ni se supone que PDF soporta CSS Flexbox.

## Contrato

`row({gap:12,justify:'space-between'},r=>r.column({width:120},...).column({width:120},...))` distribuye todo el ancho sobrante en los **huecos físicos** entre dos a seis columnas de anchura fija declarada. Con `justify:'start'` (por defecto) permanece la geometría histórica; no cambia ningún PDF existente. Las columnas con ancho implícito `'*'` no admiten `space-between` porque consumen el ancho sobrante de otro modo y la combinación sería ambigua. Tampoco se admite en fila con una sola columna.

El SDK resuelve las anchuras con el mismo `buildColumnWidth` y calcula `gap=(printableWidth-sum(columnWidths))/(columnCount-1)`, con límite `0..80pt` del motor actual. El motor nativo mide, valida y dibuja esa `PdfRow` en un solo camino sin offsets ficticios de texto. No existen `space-around`, `space-evenly`, grow/shrink automáticos, ni reglas CSS; esas políticas necesitan cambios de layout aparte.

Prueba `packages/vufra/tests/row-space-between.test.mjs` inspecciona las coordenadas reales de LEFT/MIDDLE/RIGHT con Poppler y verifica las diferencias contra `justify:'start'`, además de rechazar widths implícitos y valores inválidos. Ejemplo en `examples/fluent-page-masters.mjs`.
