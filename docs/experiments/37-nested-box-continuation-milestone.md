# Unidad 36 — Bordes y fondos al continuar cajas anidadas

**Fecha:** 2026-10-17
**Rama local:** `feature/unit36-nested-box-continuation`
**Base:** Unit35 `284581d` · `origin/main` `6399ebd`

## Problema

El pintor de cajas consideraba un encabezado de tabla repetido
(indice original cero, añadido a hojas visibles en una página de
continuación) como señal de que la caja se estaba dibujando
por primera vez. Por ello podía repetir su borde superior.

## Corrección

- `PreparedBox::draw_selected` distingue `leaves` de
  `original: Range<usize>`.
- Bordes superiores/inferiores dependen **solo** de inicio y
  fin real de cada caja; fondos y laterales se dibujan en
  cada página ocupada.
- En cajas anidadas, los límites de contenido original se
  convierten a índices del hijo, sin confundir el replay.
- La medición de altura y paginación existentes se preservan.
- **Cero cambios en la Fluent API** y sin cachés nuevos.

## Verificación

- 2 regresiones Node de PDF real con RGB Poppler, dos y tres
  cajas anidadas y tabla con header repetido, 110/85 registros.
  Primera/intermedia/última página y cierre de caja interior
  antes de fin de caja exterior.
- Ejemplo empresarial `examples/fluent-nested-box-continuations.mjs`
  genera 11 páginas /40.007B con 165 registros en orden,
  encabezados repetidos y observación final.
- Cargo fmt/clippy, 65 Rust, addon NAPI release, TS build y
  173 pruebas Node, experimento 1000 filas/29 páginas: PASS.

Documentación: ADR-0037, README y Obsidian.
Entrega local; no push, merge o PR remoto.
