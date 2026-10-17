# Unidad 27 — Imágenes preparadas reutilizables

**Fecha:** 2026-10-17. **Estado:** implementado localmente.
Rama: `feature/unit27-cached-row-images`, apilada sobre Unidad 26
`d5cb28a`. `origin/main` permanece en `6399ebd`.

## Implementación

- [x] `ImagePlacement` separa posición, dimensiones y fit de datos PNG/JPEG.
- [x] `Arc<PreparedImage>` conserva el objeto parseado al medir una fila.
- [x] `PdfRowItem::CachedImage` es interno y comparte el mismo Arc al fragmentar.
- [x] Preparación del fragmento reutiliza el objeto, sin segundo parse ni clonación de bytes codificados.
- [x] Dibujo de imágenes en root, boxes y tablas con metadatos de recorte originales.
- [x] Controles de presupuesto nativos preservados y sin alias de compatibilidad.
- [x] Test Rust de identidad de puntero y `Cover`/`Contain`.
- [x] Tests Node de PNG/JPEG en raíz, box y tabla styled con fondos y headers.
- [x] Benchmark reproducible con PDFs binariamente idénticos.

## Resultados

Benchmark de 10 filas largas, 10 PNG, 4.200 IDs y 40 páginas:
**mediana de tres procesos: 270,89 → 162,86 ms de render**;
**RSS máximo 121,14 → 117,08 MiB**. Todos los datos conservados;
mismo PDF 497.061 B y SHA-256 exacto antes/después.

La reducción de tiempo (~39,9 %) corresponde a una carga diseñada para
forzar imágenes en filas largas. No extrapolar a documentos generales.

## Verificaciones de entrega

`cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets
--all-features -- -D warnings`, `cargo test --workspace`,
`bash scripts/build-native.sh`, `npm run build`, `npm test`,
`bash scripts/verify-experiments.sh`, pruebas directas con Poppler
y Obsidian. No push/merge remoto de esta unidad.
