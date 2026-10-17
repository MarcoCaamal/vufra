# Unidad 21 — Nodos semánticos y fragmentación de rich-text

Fecha: 2026-10-17. Estado: hito funcional local.

## Entregado

- `SemanticNode<'a>` normaliza semánticas de `PdfBlock`,
  `PdfBoxItem` y `PdfRowItem` con un visitor de presupuesto de recursos
  y validación común en Rust, sin romper bindings.
- `PdfRowItem::MeasuredRichLine` solo puede ser generado por el propio
  renderer; conserva posiciones, color, fuente elegida y tamaños de los
  runs originales preparados. Segmentación multi-página de Row/Grid
  con rich text real.
- `PdfBoxTable` admite una sola celda de cuerpo muy alta y la fragmenta
  por líneas de texto rich; cada segmento conserva fondo RGB y estilos,
  encabezado repetido en cada página.
- No cambió el DSL Fluent ni el API público TypeScript.

## Pruebas

Rust fmt/clippy/test, compilación NAPI, npm build/test, 1000-row
experimentos y ejemplo `examples/fluent-rich-pagination.mjs`. Usar
Poppler para revisar text, fuentes y color de páginas de continuación.

## Límites

El semantic view es canónico para recorrido y presupuestos, pero el renderer
conserva payloads especializados. No admite corte de imágenes u objetos
gigantes, encabezados demasiado grandes ni rowspan/colspan. Cursores de
columnas independientes y AST semántico completamente owned son trabajos
posteriores. Máximo 500 fragmentos por fila desbordada.
