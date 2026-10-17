# Unidad 23 — API única, eliminación de legacy y memoria

Fecha: 2026-10-17. Estado: implementada localmente.

## Entregado

- Fluent único para tablas `.table(rows,{columns})` dentro o fuera de
  boxes. `tableStyled`, tablas de objetos y modo `paragraphs/rows/table`
  eliminados, sin alias ni compatibilidad.
- El único API npm de autoría es Fluent y helpers funcionales.
  `renderer.ts` y normalización NAPI son internos. `exports` npm
  solo permite la raíz.
- Motor Rust sin renderer ni struct PdfDocument antiguo;
  solo entrada semántica owned. Tablas simples antiguas y su
  paginador FlowBlock::Table eliminado; tablas ricas usan
  Box/Table y LayoutNode::RepeatTable.
- Eliminados cinco conversores borrowed de semántica y copias de la
  conversión consumidora NAPI. Se conservan structs de painter.
- Render Fluent evita el clonado completo en cada uso;
  `toDocument()` sigue devolviendo una copia segura y Queue guarda
  snapshot propio.
- 12 ejemplos obsoletos borrados, snippet NestJS y documentación
  modernizados. Pruebas de la API Fluent y privadas conservan
  cobertura de paginación, cancelación, estilos y recursos.
- Benchmark: `node --expose-gc scripts/benchmark-fluent.mjs
  regular.ttf bold.ttf 350` obtiene números del entorno sin inferir
  mejoras entre commits.

## Verificación

`cargo fmt --all -- --check`, `cargo clippy --workspace
--all-targets --all-features -- -D warnings`,
`cargo test --workspace`, `bash scripts/build-native.sh`,
`(cd packages/vufra && npm run build && npm test)`,
`bash scripts/verify-experiments.sh`.
Ejecutar ejemplos Fluent multipágina y verificar PDFs con
Poppler (`pdfinfo,pdftotext,pdffonts,pdfimages`).

## Límites

NAPI y el renderer todavía tienen representaciones
orientadas a pintura, aunque no se exportan como sintaxis de
autoría pública; no hay zero-copy global JS-Rust-Krilla.
`PdfRenderQueue` debe seguir aislando documentos encolados.
No colspan/rowspan ni RTL universal.
