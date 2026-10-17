# Unidad 19 — Composición de nodos + Fluent compartida

Fecha: 2026-10-17. Estado: fase funcional de refactor, con límites explícitos.

## Implementado

- `ContentBuilder` reemplaza el par duplicado de scopes raíz/caja y admite métodos encadenados compartidos.
- `DocumentBuilder.add(...)` combina nodos creados con `paragraph()`, `heading()`, `image()`, `box()`, `flow()`, `table()`, `grid()`, `row()`, `column()`.
- `Box` es contenedor visual flexible, con un único `child` o arreglo de `children` sin atributos obligatorios. Los hijos se disponen verticalmente.
- Rust soporta anidar boxes con fuentes reales, imágenes y tablas/grids dentro del contenedor padre o de las celdas de Row/Grid.
- ColumnScope expone .box(), .table(), .row(), .grid() y .add() encadenables; los layouts se resuelven al conocer el ancho real de columna.
- NAPI y Rust rechazan recursión profunda, sobreuso de imágenes y cajas anidadas mayores que una página en vez de superponerlas.
- Los métodos antiguos y renderizados sync/async/cola se mantienen.

## Próxima fase

Completar la convergencia del AST Rust: `PdfBlock`, `PdfBoxItem` y `PdfRowItem` siguen existiendo como tipos distintos tras el lowering lógico de TypeScript. La composición de layouts complejos en columnas ya funciona; queda implementar fragmentación vertical real de filas y cajas anidadas sobre un único motor recursivo Rust.

## Verificaciones

`cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace`, `bash scripts/build-native.sh`, `(cd packages/vufra && npm run build && npm test)`, `node examples/fluent-composition.mjs REGULAR BOLD OUTPUT`. Validar con `pdfinfo/pdffonts/pdftotext/pdfimages`.

Complementos: ADR-0020, `packages/vufra/tests/composable.test.mjs`.
