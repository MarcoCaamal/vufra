# ADR-0027 — Reutilizar la medición de filas largas al fragmentar

**Fecha:** 2026-10-17 · **Estado:** implementado y probado localmente
**Unidad:** 26 · **Rama:** `feature/unit26-single-pass-long-rows`
**Base:** Unidad 25 `d666ebf` (local, sobre Unidad 24 `98e5830`)

## Problema medido

Cuando `PdfRow::prepare_depth` encontraba una fila superior a la altura
imprimible, devolvía error y descartaba las líneas ya calculadas por
Parley (`measure_text_lines`) y `prepare_rich`. Los tres consumidores,
en raíz, boxes y cuerpos de tablas enriquecidas, respondían llamando
`as_fragmentable_box`, que volvía a procesar los textos originales.
Cada segmento se preparaba una tercera vez, aunque representara una
línea ya medida. En rich alineado a la derecha se recalculaba su ancho.

## Decisión técnica

1. `PdfRow::prepare_allow_overflow_depth` valida y prepara columnas
   **una sola vez**, conservando un `PreparedRow` completo aunque su
   altura acumulada supere la página. `prepare_depth` conserva la regla
   de rechazo para quienes requieren un renglón atómico.
2. La preparación de raíz/box/tabla decide por la **altura preparada**
   si mantiene la fila atómica o si utiliza
   `PdfRow::fragments_from_prepared`. Este consume el
   `PreparedRow` y transfiere directamente líneas `String`,
   `RichLine`, offsets, índices de fuente, RGB y espaciado a los
   fragmentos. Ya no se ejecuta `prepare_rich` ni
   `measure_text_lines` de nuevo sobre el texto **original**.
3. `PdfRowItem::MeasuredTextLine(PreparedTextFragment)` es una variante
   interna con campos privados para conservar `text`, `style` y
   offset horizontal medido. La preparación de esta variante
   reutiliza el resultado Parley sin repetir el shaping.
4. `PreparedRichFragment` incluye offset medido opcional para no
   recalcular anchura en fragmentos rich alineados a la derecha.
   La línea ya contiene `PositionedRun` con índice real de fuente,
   tamaño, color y `x`; no se intenta reconstruirla desde texto.
5. Las tres rutas afectadas —root row, box row y table body row—
   reutilizan la misma estructura y conservan el tratamiento
   de encabezado, relleno de celdas y origen de la fila.
   Los encabezados excesivamente altos siguen rechazándose;
   solo se permite fragmentar filas de cuerpo de tabla.

Los fragments `MeasuredTextLine` y `MeasuredRichLine` son detalles
internos, no una nueva sintaxis de autoría para el SDK público.
No se crean alias ni modos de compatibilidad.

## Precauciones

- `PdfRow::prepare_allow_overflow_depth` sigue validando anidación
  (límite de ocho niveles), presupuesto de imágenes, anchuras y
  `style`; `fragments_from_prepared` mantiene el límite de
  **500 fragmentos** por columna.
- `PreparedTextFragment` conserva el `space_before` de la primera
  línea y `space_after` de la última; no repite espaciado intermedio.
- Se preservan los offsets horizontales de cada línea, especialmente
  para alineación a la derecha, y color RGB y `font_index` de rich text.
- Los objetos indivisibles (imagen o box demasiado alta) aún se
  rechazan. Los bitmaps presentes en una fila que necesita dividirse
  pueden volver a prepararse cuando se reconstruye su fragmento;
  esta unidad elimina la duplicación del shaping de **texto**,
  no todas las operaciones de rasterización.

## Medición reproducible

```bash
node scripts/benchmark-font-rows.mjs REGULAR.ttf BOLD.ttf 3
```

Ocho filas largas, 2.640 IDs, 13 páginas PDF, 39.119 bytes en
ambas versiones; tres procesos Node frescos por medición:

| Mediana | Antes (Unidad 25) | Después (Unidad 26) |
|---|---:|---:|
| `.render()` | 127,48 ms | 85,63 ms |
| Pico RSS, proceso Node | 89,63 MiB | 89,75 MiB |
| PDF / páginas / tokens | 39.119 B / 13 / 2.640 | idéntico |

**Diferencia observada de tiempo:** −41,85 ms (−32,8 %) en este
workload. No implica aceleración del 33 % para todos los PDFs ni
demuestra atribución aislada de CPU por biblioteca. Medición
complementaria de cinco procesos posteriores: 87,01 ms y
89,64 MiB; similar.

El control `benchmark-native-memory.mjs` de 450 filas, 24 imágenes,
27 páginas y 514.161 B obtuvo **364,91 ms** y **136,48 MiB** después
(no muestra mejora general frente a la medición previa de Unidad 25:
358,72 ms, 134,99 MiB; fluctúan las asignaciones).

## Verificación

- `cargo fmt --all -- --check`, `cargo clippy ... -D warnings`.
- `cargo test --workspace` Rust (31 layout + 22 PDF = 53).
- NAPI release build, SDK TypeScript y 130 pruebas Node.
- `bash scripts/verify-experiments.sh`: 1.000 registros y 29 páginas.
- Test `prepared_long_row_reuses_parley_lines_and_styled_font_offsets`
  verifica identidad de punteros `String`, primer/último espaciado,
  `x`, font index, color, offsets y columna agotada.
- Se mantienen tests de PDF real para fondos de celdas,
  encabezados, fuentes embebidas, paginación, cancelación y Unicode.

## Pendientes

No se elimina toda repetición de bitmap/rasterización en filas
mixtas con imágenes/boxes; medir antes de optimizar. También podría
perfilarse la paginación de líneas muy largas y el consumo de la
caché de glifos. No cambiar el SDK Fluent ni crear compatibilidad.

**Entrega:** commit local, sin push ni merge a `main`.
