# Unidad 30 — Reutilizar fonts extra e imágenes con control de vida útil

**Fecha:** 2026-10-17. Rama local
`feature/unit30-reusable-fonts-and-images`,
base Unit29 `403fba1`, `origin/main` `6399ebd`.

## Entregado

- Fuentes `bold` / `fallback` compartidas como
  `Arc<Vec<u8>>` mediante `NativeAssets`.
- `PdfFontFace` y `PdfImage` conservan bytes codificados
  en `Arc`; `krilla::Image` recibe datos compartidos.
- Caché de PNG/JPEG por factory con indexado por huella y
  comparación exacta, IDs estables; 256 entradas o 64 MiB máximos.
- Si el caché está lleno, se usa el PNG/JPEG inline, sin fallos
  para documentos válidos.
- Imágenes contabilizadas cada vez por documento (64 bloques,
  32 MiB lógicos, píxeles), aunque apunten al mismo asset.
- En bundles con fuentes extra grandes no se retienen
  indefinidamente en Rust. Los temporales se liberan después
  de preparar el trabajo, incluso en la ruta asíncrona.
- El SDK Fluent mantiene sintaxis única, snapshots propios,
  cancelación y aislamiento de `PdfRenderQueue`.
- Sin `unsafe` ni compatibilidad de sintaxis vieja.

## Benchmark

Ocho PDFs consecutivos con logo PNG y bold desde un factory,
hash PDF **idéntico** entre Unidades 29 y 30:
`1c7f822c7066400c7c957ee9751a88f1946851ac86172dbaa28447ab9707fdcd`.

| Mediana de 3 procesos | Antes | Después |
|---|---:|---:|
| Bold real maxRSS | 91,04 MiB | 91,69 MiB |
| Bold real render+Poppler | 198,09 ms | 207,45 ms |
| Bold válida rellenada 10MiB maxRSS | 119,65 MiB | 120,26 MiB |
| Bold 10MiB render+Poppler | 200,63 ms | 211,37 ms |

**No hubo aceleración ni reducción de pico RSS demostradas**;
la ganancia es evitar copias de bytes y acotar la duración de
recursos inmutables en documentos repetidos. Se corrigió
regresión inicial de RSS hasta ~170MiB con fuente grande.

## Verificación

Rust fmt/clippy/tests, Node suite con regresiones de imágenes
cacheadas, PNG real, fuente bold, cancelación y cola,
NAPI release build y experimento de 1.000 registros / 29 páginas.
Guardar Obsidian y commit local. No push/merge.
