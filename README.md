# Vufra 🦀

Motor PDF open source en **Rust** para documentos estructurados, texto Unicode y paginación. Un SDK TypeScript/Node.js vendrá después de estabilizar el núcleo.

> **Estado: prototipo experimental de Unidad 01 (NO producción).** Ya genera PDF desde Rust; aún no existe la API pública final, un motor integral de layout, ni el SDK TypeScript.

## Hito completado (2026-10-16)

- Tres PDF reales generados: uno mediante pdf-writer y dos con krilla.
- PDF multipágina con texto español Unicode seleccionable y fuente embebida.
- Tabla de **1,000 filas en 29 páginas**, paginada por vufra-layout mediante BreakToken.
- Extracción independiente confirma que las filas aparecen una sola vez y en orden.
- Seis tests de Rust, cargo fmt y cargo clippy superados.
- Parley probado para medición y line breaking (3 líneas a 360 pt, 5 a 180 pt).

Archivos locales generados (ignorados por Git):

```text
artifacts/pdf-writer-first.pdf
artifacts/krilla-first.pdf
artifacts/1000-rows.pdf
```

## Ejecutar experimentos

Requiere Rust **1.92**, Cargo, una fuente TrueType con cobertura en español (como Noto Sans), y opcionalmente Poppler para validación.

```bash
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings

FONT=$(fc-match 'Noto Sans' -f '%{file}\n' | head -1)
cargo run -p sp-01-pdf-writer -- artifacts/pdf-writer-first.pdf
cargo run -p sp-01-krilla -- artifacts/krilla-first.pdf "$FONT"
cargo run -p sp-02-parley
cargo run -p sp-03-pagination -- artifacts/1000-rows.pdf "$FONT"

# Generación y verificación automatizadas (requiere pdfinfo y pdftotext):
bash scripts/verify-experiments.sh
```

Los experimentos consumen una fuente instalada en el sistema; **no** se distribuye un archivo de fuente con Vufra.

## Arquitectura

```text
crates/vufra-core         Semántica de filas/página (experimental)
crates/vufra-layout       Paginación reanudable (experimental)
experiments/sp-01-*       Comparación de escritores PDF
experiments/sp-02-parley  Tipografía, medición y saltos de línea
experiments/sp-03-*       Integración real: 1,000 filas a PDF
```

El diseño previsto contempla añadir vufra-text, vufra-pdf y una fachada Rust una vez se evalúen sus límites; el SDK TS no es parte de estos experimentos.

## Documentación

- [W0 — Plan original](docs/planning/01-w0-workspace.md)
- [Arquitectura conceptual](docs/architecture/overview.md)
- [Experimentos y criterios](docs/experiments/01-spikes.md)
- [Resultados medidos de Unidad 01](docs/experiments/02-results.md)
- [ADR 0001: licencia](docs/adr/0001-license.md)
- [ADR 0002: monorepo](docs/adr/0002-monorepo.md)

## Licencia

**MIT OR Apache-2.0**. Textos oficiales en [LICENSE-MIT](LICENSE-MIT) y [LICENSE-APACHE](LICENSE-APACHE).
