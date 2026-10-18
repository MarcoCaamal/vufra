# Milestone 39 — Geometría nativa de celdas (Unidad 38)

Fecha: 2026-10-17. Implementación en `feature/unit38-table-cell-layout`, sin push.

## Criterios de aceptación

- [x] Alineación left/center/right medida por línea, incluido texto rich.
- [x] Padding escalonado tabla → columna → celda, preservando lados no sustituidos.
- [x] Alineación vertical top/center/bottom en filas atómicas, altura real.
- [x] Encabezados y fondos siguen pintándose de forma nativa con padding.
- [x] Filas largas mantienen offsets horizontales y padding de inicio/fin.
- [x] Validaciones TS y Rust sin columnas que desborden por padding.
- [x] AST semántico owned y NAPI conservan metadatos de celda.
- [x] Ejemplo empresarial con 135 filas/11 páginas, IDs únicos y ordenados.

## Resultado de verificación local (2026-10-17)

- `cargo fmt --all -- --check`: PASS.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`: PASS.
- `cargo test --workspace -q`: PASS, **68/68 Rust** (39 layout + 29 PDF).
- `bash scripts/build-native.sh`: PASS.
- `cd packages/vufra && npm run build && npm test`: PASS, **182/182 Node**.
- `bash scripts/verify-experiments.sh`: PASS, 1.000 filas/29 páginas, Unicode íntegro.
- Poppler: ejemplo 135 registros únicos ordenados, 11 páginas, 41.305 bytes.
- `git diff --check`: PASS. CI remoto no ejecutado. Sin push/merge.

## Pruebas

Comandos: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace`, `bash scripts/build-native.sh`, `cd packages/vufra && npm run build && npm test`, `bash scripts/verify-experiments.sh`.

Node: `packages/vufra/tests/table-cell-layout.test.mjs`. Los PDFs de ejemplo son
artefactos locales no publicados. Registro final de conteos en Obsidian.
