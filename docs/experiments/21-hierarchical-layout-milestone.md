# Hito 21 / Unidad 20 — Layout jerárquico fragmentable

**Fecha:** 2026-10-17. **Estado:** implementación local verificada.

## Componentes añadidos

- `LayoutNode` de `vufra-layout::tree` es el modelo común **geométrico**
  independiente de PDF: Leaf/Container/RepeatTable.
- Cajas anidadas con decenas o cientos de párrafos se pueden cortar entre
  páginas, conservando el texto y repintando fondos/bordes por fragmento.
- Las tablas en cajas profundas repiten encabezados sin perder registros.
- Las filas multicolumna largas se dividen entre elementos. Los párrafos
  regulares se dividen adicionalmente en líneas Parley reales cuando es
  necesario. Se preservan los anchos y el orden por columna.
- Políticas `keepTogether`/`breakBefore` de cajas anidadas y rechazo
  explícito de geometrías irrealizables.

## Sintaxis Fluent (sin cambios)

```ts
const pdf=await engine.document({page:'Letter'})
  .box({padding:18},c=>c
    .box({padding:12},inner=>inner
      .paragraph('Texto largo '.repeat(5000))
    )
  )
  .row(r=>r
    .column(c=>c.paragraph('Texto largo '.repeat(700)))
    .column(c=>c.paragraph('Otro contenido '.repeat(500)))
  )
  .render();
```

## Limitaciones

El AST de geometría está unificado, pero la semántica de PDF de Rust
todavía conserva enums especializados. Los segmentos de filas desbordadas
se sincronizan por elemento y no pueden fragmentar una imagen,
un rich-run individual demasiado alto ni una caja dentro de una celda
que por sí sola exceda la página. Tablas enriquecidas parten entre filas;
ningún colspan/rowspan ni soporte RTL completo.

## Pruebas

Ejecutar `cargo fmt --all -- --check`, `cargo test --workspace`,
`cargo clippy --workspace --all-targets --all-features -- -D warnings`,
`bash scripts/build-native.sh`, `bash scripts/verify-experiments.sh`,
`(cd packages/vufra && npm run build && npm test)`, y
`node examples/fluent-hierarchical.mjs REGULAR BOLD artifacts/fluent-hierarchical.pdf`.
Inspeccionar `pdfinfo`, `pdffonts`, `pdftotext -raw`, `pdftoppm`.
