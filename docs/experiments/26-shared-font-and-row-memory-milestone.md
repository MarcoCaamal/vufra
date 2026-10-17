# Unidad 25 — Fuentes Arc y fragmentos owned

Fecha: 2026-10-17. Rama local:
`feature/unit25-font-sharing-row-fragments`.
Base: Unidad24 `98e5830`; main/origin/main: `6399ebd`.

## Implementación
- [x] Una misma fuente como `Arc<Vec<u8>>` compartida en
  Krilla, Fontique y `ttf_parser`.
- [x] `FontRegistry` consume `Vec<PdfFontFace>` para no copiar
  buffers extra al registrarlos.
- [x] `PdfRow::as_fragmentable_box` pasa los fragmentos mediante
  `VecDeque::pop_front`, sin segunda clonación de ítems.
- [x] Test de identidad de byte buffer de fuente Krilla/Fontique.
- [x] Test de identidad de imagen/rich text, estilo, orden,
  columnas vacías y font index tras dividir la fila.
- [x] Benchmark aislado Node `scripts/benchmark-font-rows.mjs`
  con todos los IDs y páginas comprobados.
- [x] Suite Rust y Node, PDFs de ejemplo con Noto embebido.
- [x] Documentación ADR0026/README/Obsidian.
- [ ] Push, merge o CI remoto (no autorizado para esta unidad).

## Métricas observadas

Ocho filas largas, 2640 tokens y 13 páginas idénticas:

| mediana de tres procesos | antes | después |
|---|---:|---:|
| RSS pico de Node | 93.39 MiB | 89.64 MiB |
| render | 131.89 ms | 124.21 ms |

Cambio de RSS medido: −3.75 MiB (~4 %), específico de esta
carga y máquina. No prometer aceleración general de renderizado.
Los tests específicos evitan pérdida de fuentes, colores,
documentos y fragmentos por copia/consumo del ownership.
