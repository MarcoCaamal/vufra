# Unidad 26 — Filas fragmentables con shaping reutilizado

**Fecha:** 2026-10-17. Estado: verificado localmente.
Rama: `feature/unit26-single-pass-long-rows`,
apilada sobre Unit25 `d666ebf`, Unit24 `98e5830`;
`origin/main` en `6399ebd`.

## Entregado

- `PdfRow::prepare_allow_overflow_depth` devuelve preparación con
  líneas completas para filas que exceden altura de página.
- `PdfRow::fragments_from_prepared` conserva texto, métrica,
  espaciado y runs de fuente/color sin volver a medir el original.
- `MeasuredTextLine` usa offset Parley guardado y evita re-shaping.
- `MeasuredRichLine` reutiliza offset incluso alineado a derecha.
- Integración en root row, box row y cuerpo de tabla.
- La medida de fila normal sigue siendo atómica y con validación
  de dimensiones; no se pierde protección de 500 fragmentos.
- Test Rust con identidad de `String`, RGB, fuentes y offsets.
- PDF de ejemplo rich 7 páginas, 30.154 bytes y fuentes reg/bold.

## Benchmark

8 filas, 2.640 identificadores y 13 páginas iguales (39.119 B).

| Mediana de 3 procesos | Antes | Después |
|---|---:|---:|
| Render | 127,48 ms | 85,63 ms |
| Pico RSS | 89,63 MiB | 89,75 MiB |

Velocidad observada específica de esta carga (−32,8 % tiempo),
**no prometerla en otras cargas**. El benchmark de 450 filas
y 24 imágenes no mejoró materialmente.

## Verificación

`cargo fmt --all -- --check`, clippy con `-D warnings`,
tests Rust/Node, NAPI build, verificaciones PDF y experimento
de 1.000 registros. Documentar Obsidian. No push/merge.
