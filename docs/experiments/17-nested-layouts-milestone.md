# Unidad 16 — Anidación tipográfica y saltos de página

Fecha: 2026-10-16. Estado: prototipo funcional, rama feature/unit16-nested-layouts.

## DSL Fluent

Uso: engine.document({title:'Reporte'}).box({keepWithNext:true,padding:18}, box => {
  box.heading('Resumen', {bold:true});
  box.grid({columns:2,gap:12}, grid => {
    grid.cell(col => col.paragraph('Ingresos',{bold:true}));
    grid.cell(col => col.paragraph('$125,000'));
  });
  box.richText(text => { text.add('Estado: '); text.add('VALIDADO',{bold:true}); });
}).paragraph('Sección siguiente').box({breakBefore:true,keepTogether:true}, box => {
  box.row(row => {row.column(col=>col.paragraph('Empresa')); row.column(col=>col.paragraph('2026'));});
});

Registrar la fuente con createVufra({font:regularBytes,fonts:{bold:boldBytes}}), sin fuentes falsificadas.

## Reglas

- BoxScope.row/grid respetan el ancho interior calculado con padding.
- RichText en cajas y filas usa tipografía real embebida y medición/renders coherentes.
- keepTogether rechaza caja entera demasiado alta; breakBefore inicia página nueva; keepWithNext agrupa caja e inicio del siguiente bloque cuando cabe.
- Filas son atómicas, incluso dentro de una caja que se continúa entre páginas.
- No se habilitan cajas recursivas ni tablas dentro de cajas.

## Verificación

- cargo fmt --all -- --check: OK
- cargo clippy --workspace --all-targets --all-features -- -D warnings: OK
- cargo test --workspace: OK (31 tests en vufra-layout, 11 en vufra-pdf)
- bash scripts/build-native.sh: OK
- npm run build && npm test (packages/vufra): OK (89/89)
- examples/fluent-nested.mjs: PDF Letter 5 páginas, NotoSans-Regular y NotoSans-Bold embebidas, 700/700 identificadores CLAUSE recuperados por pdftotext -raw.

## Cambios

crates/vufra-pdf/src/box_layout.rs; row.rs; rich_text.rs; flow_render.rs; crates/vufra-layout/src/flow.rs; bindings/vufra-node/src/lib.rs; packages/vufra/src/{fluent,index}.ts; tests; examples/fluent-nested.mjs.

ADR: [0017](../adr/0017-nested-layouts-and-page-policies.md).
