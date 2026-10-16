# ADR-0004: tablas multicolumna con filas indivisibles (experimental)

**Fecha:** 2026-10-16. **Estado:** parcialmente reemplazada por [ADR-0005](0005-split-row-pagination.md) en lo relativo a filas indivisibles. El diseño de columnas, medición y modelo sigue vigente.

## Decisión

- Introducir `PdfTable` con lista de columnas (`header`, `width` en puntos) y filas de celdas string, expuesta tanto por Rust como TypeScript.
- Usar el medidor actual de Parley para calcular el wrapping de cada celda **antes** de la paginación.
- La altura de una fila la define la celda más alta, sumado padding.
- Reutilizar `vufra-layout::paginate_all` para distribuir filas por `BreakToken`, descontando una altura de encabezado que reaparece en cada página de tabla.
- Conservar la API previa `rows?: string[]` para compatibilidad y añadir `table?: PdfTable`. El contenido de tabla empieza en su propia página.
- Dibujar fondos, bordes y texto dentro de `vufra-pdf` mediante Krilla; no hacer que el modelo semántico dependa de su API.

## Alternativas y costes

La elección de **filas indivisibles** evita el riesgo de partir celdas desalineadas, pero una fila mayor al espacio útil completo falla con error. El desperdicio al iniciar una tabla en una página aparte queda documentado; el futuro compositor deberá poder colocar bloques consecutivos en una misma página.

Para uso más avanzado faltan porcentajes, balanceo de anchos, celdas fusionadas, imágenes, headers complejos, render asíncrono y shaping con glifos. Estos temas no se resuelven en esta unidad.
