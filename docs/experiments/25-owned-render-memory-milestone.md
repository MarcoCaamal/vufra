# Unidad 24 — Profiling de memoria y AST owned hasta el pintor

Fecha: 2026-10-17. Inicio desde origin/main confirmado `6399ebd`.
Rama local: `feature/unit24-native-memory-profiling`.
Delivery: sin merge ni push (solo Unit17–23 fueron publicados en main).

## Tareas completadas

- [x] Benchmark reproducible del PDF sintético y baseline previo.
- [x] Eliminar `iter().cloned()` del AST semántico completo.
- [x] Rust renderizado owned por valor y validación pre-lowering.
- [x] NAPI sync/async mueve el documento una sola vez; worker `Option::take`.
- [x] Test de identidad `Vec<u8>::as_ptr()` para imagen directa, box, row y celda de tabla.
- [x] No crear wrappers para firma Rust vieja.
- [x] Sin cambios en política de snapshots de cola/Fluent.
- [x] Repetir benchmark y verificar PDFs de 450 IDs en orden.
- [x] Registrar medición con límites metodológicos.

## Resultados

Antes: mediana de **150.67 MiB maxRSS**, **355.46 ms render** (3 muestras).
Después: **139.91 MiB maxRSS**, **353.79 ms render** (3 muestras).
Diferencia de memoria observada: **−10.76 MiB, −7.1%**.
No inferir mejora significativa de tiempo. Ambos PDFs: 514161 bytes,
27 páginas, todos los 450 IDs extraídos en orden y 24 imágenes.

El script está en `scripts/benchmark-native-memory.mjs`.
Los resultados varían por sistema/fuente/carga concurrente;
`maxRSS` mide TODO el proceso Node, no solo Rust.

## Verificación

- Cargo fmt/clippy/test (sin warnings)
- NAPI release build
- TypeScript build y 130 pruebas
- Experimentos y PDFs reales con Poppler
- Obsidian + ADR-0025

La medición de memoria necesita mayor instrumentación para
aislar allocators nativos de Krilla/Parley y la frontera NAPI.
