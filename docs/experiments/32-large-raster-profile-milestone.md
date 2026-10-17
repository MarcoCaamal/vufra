# Unidad 31 — Rendimiento de raster grandes y concurrencia

**Fecha:** 2026-10-17 · **Estado:** investigación verificada;
rechazado caché preparado entre PDFs por regresión concurrente.
**Rama:** `feature/unit31-raster-preparation-profile`,
base Unidad30 `8a73f28`. `origin/main` continúa `6399ebd`.

## Trabajos

- Benchmark nuevo `scripts/benchmark-large-raster.mjs`: seis
  documentos con misma imagen RGB determinista 1280×1280;
  tres secuenciales y tres paralelos, Poppler, hashes,
  memoria y tiempos de procesos frescos.
- `scripts/lib/deterministic-png.mjs` crea datos PNG
  reproducibles sin fixtures grandes en el repositorio.
- Modo opcional JPEG con ImageMagick local.
- Node tests `large-raster-concurrency.test.mjs`:
  PNG real de 800px, Contain/Cover y JPEG; render sync
  contra async paralelo idéntico, mutación externa segura.
- Se implementó un prototipo de caché preparado
  `Arc<PreparedImage>`, se midió y **se revirtió**.
  No queda código experimental no utilizado.

## Medición antes / experimento / después

| 1280px PNG, mediana 3 procesos | Original | Prototipo | Restaurada |
|---|---:|---:|---:|
| 3 secuenciales | 340,62 ms | 340,27 ms | 342,96 ms |
| 3 paralelos | 119,88 ms | **327,07 ms** | 119,13 ms |
| maxRSS | 225,58 MiB | 219,50 MiB | 226,41 MiB |

Los seis PDFs son idénticos (29.554.771 bytes),
SHA256 `cdf0303fe410d414aab9824d8abb419d177ce84638ffd567f6347e58e0f52d5c`.

Control JPEG 1280px (2.691.240B), mediana 3 procesos:
serial 14,05 ms, paralelo 6,51 ms, RSS158,22 MiB,
6 PDFs16.206.313B.

Interpretación: el pequeño ahorro de RSS no compensa la
regresión concurrente. No imponer umbrales rígidos de
tiempo en CI, porque dependen de máquina/carga.

## Comprobaciones

Cargo fmt/clippy/test, NAPI release, Node tests,
`scripts/verify-experiments.sh` con 1.000 registros/29 páginas,
notas de Obsidian, ADR-0032.

Sin cambios en Fluent ni cachés de Krilla en producción.
Commit local y sin push/merge.
