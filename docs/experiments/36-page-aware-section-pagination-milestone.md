# Unidad 35 — Paginación visual con separadores suaves

Fecha: 2026-10-17.
Rama local `feature/unit35-pagination-separators`.
Base Unidad34 `0be76ab`; origin/main `6399ebd`.

## Cambios

- El paginador Rust `paginate_flow_with_keep` busca el primer
  bloque visual después de una serie de separadores, sin
  atravesar `PageBreak` o `breakBefore`.
- Heading/caja + gaps + siguiente bloque permanecen juntos
  cuando quepan íntegramente en una página nueva.
- Si la caja siguiente cabe completa, se reserva toda
  su geometría, no solo primera fila; si necesita páginas,
  se considera la primera porción útil, con header de tabla
  repetido y primera fila.
- Separadores de una frontera de salto implícito no se
  convierten en sangría al inicio de página nueva.
- Separadores de inicio o después de un salto explícito
  mantienen altura exacta. No se aceptan alturas inválidas,
  incluso si un gap fuera a omitirse.
- No hay cambios de sintaxis Fluent ni otro motor de layout.
  Los componentes, boxes y tablas reutilizan el renderer actual.

## Verificación

- Tests Rust de layout actualizados y nuevos
- Cinco nuevas regresiones Node con página real y bbox
- Ejemplo de 185 transacciones paginadas:
  11 páginas, 39.404 bytes, todos los IDs en orden y headers.
- Rust fmt/clippy/test, addon release, build TS,
  suite Node y prueba de 1.000 registros/29 páginas.

## Decisión

ADR-0036. La semántica incorrecta previa de arrastrar
separadores a páginas nuevas **se sustituye**, sin wrappers
de compatibilidad ni otra sintaxis.

Documentar en Obsidian y README. No push ni merge.
