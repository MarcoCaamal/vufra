# Unidad 33 — Presets reutilizables para documentos consistentes

Fecha: 2026-10-17.
Rama: `feature/unit33-reusable-style-presets`.
Base Unit32 `c787677`, `origin/main` `6399ebd`.

## Objetivo

Hacer más fácil construir documentos con tarjetas, secciones y
estilos visuales consistentes con la misma Fluent API.
No extender concurrencia, cachés, CSS ni engine Rust.

## Entregado

- `theme.presets.text` y `theme.presets.box` por nombre.
- `paragraph/heading/richText` y `box` admiten
  `{preset:'nombre'}`, incluyendo nodos de `.add()`
  y layouts anidados.
- Opciones explícitas sobrescriben el preset sin mutarlo;
  `border.width` puede sobrescribirse sin perder `border.color`.
- Textos de `header/footer` y headings de columnas respetan
  tamaños definidos en presets.
- Resolver plano, sin referencias recursivas, evita claves
  heredadas del prototipo y lanza errores informativos.
- Tema y estilos quedan aislados del llamador mediante snapshot.
- Ningún campo `preset` se envía al bridge NAPI.
- Ningún cambio al motor Rust ni a los límites de layout.

## Validación

Nueve pruebas de integración nuevas con PDF binariamente
idéntico al construido de forma explícita, layouts composables,
precedencias, aislamiento, errores y paginación.
Nuevo ejemplo `examples/fluent-style-presets.mjs` con 175
operaciones en **10 páginas** y 40.688 bytes de PDF validado.

Verificación: Rust fmt/clippy/test; Node build/tests;
NAPI build; `scripts/verify-experiments.sh` con 1.000 filas/29 páginas.
Documentar en ADR-0034, README y Obsidian.

Entrega local; no push/merge.
