# Unidad 32 — Grid proporcional y experiencia Fluent

**Fecha:** 2026-10-17.
**Rama local:** `feature/unit32-grid-fractional-tracks`.
**Base:** Unit31 `cdaa6c6`; `origin/main` `6399ebd`.

## Objetivo

Simplificar layouts complejos al estilo de las interfaces web,
manteniendo el motor PDF en Rust y una única Fluent API.

## Implementado

- Nuevo tipo TypeScript exportado `GridTrack`: puntos,
  porcentajes, fr y `*`.
- `grid({columns:['2fr','1fr'],gap:12},...)`
  en body, box, page bands y componentes funcionales.
- `grid({columns:3})` sigue utilizando el mismo resolver para
  repartir anchos iguales.
- Algoritmo compartido de sizing, sin duplicarlo en header/footer.
- Geometría validada antes de ejecutar Rust:
  1..6 pistas, gap 0..80pt, cada pista al menos 60pt,
  valores positivos finitos y límites de contenedor.
- Las filas incompletas mantienen las celdas ya construidas
  y no inventan contenido.
- Se rechazan grids vacíos en lugar de omitirlos silenciosamente.
- Se mantienen paginación, fuentes y colores, sin nuevas
  abstracciones de backend ni cambio de sintaxis base.

## Pruebas

- Seis nuevas pruebas Node, incluyendo posiciones `pdftotext -bbox`
  para 2fr/1fr y [100,30%,2fr] dentro de box anidado.
- Page bands con sizing compartido; tarjetas como nodos
  funcionales reutilizables.
- Configuraciones inválidas rechazadas con mensajes claros.
- Reporte de 180 IDs, tabla multipágina y encabezados correctos.
- Ejemplo de 190 registros:
  `examples/fluent-grid-tracks.mjs`;
  PDF 11 páginas y 42.421 bytes con 190 IDs únicos en orden.
- 57 tests Rust, 150 Node, Clippy y 1000 registros/29 páginas PASS.

## Decisión

No agregar CSS Grid completo, SVG/raster extra, concurrencia,
cachés ni compatibilidad experimental. Continuar mejorando
la ergonomía y los límites reales del motor de layout.
ADR-0033 y Obsidian.

**No push/merge** hasta autorización.
