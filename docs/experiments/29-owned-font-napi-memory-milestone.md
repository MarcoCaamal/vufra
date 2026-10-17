# Unidad 28 — Snapshot seguro en NAPI, fuente owned dentro de Rust

**Fecha:** 2026-10-17. Estado: implementada y verificada localmente.
Rama `feature/unit28-owned-font-napi`. Base Unidad27 `486ae4e`.
`origin/main` permanece `6399ebd` (Unidades17–23).

## Entregado

- Auditoría código instalado NAPI-RS v3.14.2:
  `Buffer` entrante referencia memoria JS modificable;
  `to_vec()` copia para establecer ownership seguro.
- Se mantiene copia de snapshot JS→NAPI en sync/async.
- `render_semantic_pdf(document, font: Vec<u8>, ...)`
  consume fuente por valor, no por `&[u8]`.
- El worker asíncrono usa `std::mem::take` para transferir
  su único `Vec` sin duplicarlo.
- Krilla, Fontique y FontRegistry comparten el mismo
  `Arc<Vec<u8>>` moved sin dos copias adicionales.
- Rust test de dirección del buffer al envolverlo en Arc y
  compartirlo entre librerías.
- Node test muta inmediatamente fuente regular, bold y PNG
  tras iniciar render y recibe el mismo PDF binario que sync.
- Benchmark reproducible sintético de font 10 MiB y control
  de fuentes normales; PDFs idénticos.
- Sin alias ni compatibilidad con firma Rust anterior.

## Mediciones

| Benchmark (3 procesos) | Antes | Después |
|---|---:|---:|
| Fuente válida rellenada a 10 MiB, maxRSS | 136,46 MiB | 116,52 MiB |
| Render de 2640 IDs / 13 páginas | 89,26 ms | 86,18 ms |
| Noto Sans normal + 24 PNG, maxRSS | 136,57 MiB | 133,63 MiB |
| Render de 450 filas / 27 páginas | 351,53 ms | 356,23 ms |

La TTF de 10 MiB contiene datos reales de Noto Sans (~621 KB)
más ceros de relleno. Sirve para medir **copias de bytes**,
no el costo de un sistema tipográfico de 10 MiB.
El RSS mide todo el proceso Node; no hay zero-copy JS→Rust.

## Verificaciones

Rust fmt/clippy/tests, NAPI build, Node/Fluent suite, experimentos
de 1.000 filas/29 páginas, pruebas de mutación y benchmark binario.
Documentar ADR-0029, Obsidian y README. No hacer push/merge.
