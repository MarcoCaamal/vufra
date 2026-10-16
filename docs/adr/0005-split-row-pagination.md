# ADR-0005 — Fragmentación por líneas dentro de filas

- **Fecha:** 2026-10-16
- **Estado:** aceptada para el prototipo (sustituye la política de filas indivisibles del ADR-0004).

## Contexto

La Unidad 03 puede paginar tablas pero falla si la altura de una sola fila supera el espacio completo de una página. Para documentos extensos necesitamos continuarla sin duplicar celdas ni perder el orden original.

## Decisión

Usar un cursor explícito `SplitBreakToken { row, line }` para continuar la fila en la siguiente página. Todas las celdas de una fila comparten el intervalo de líneas en el eje vertical; cada celda solo dibuja las líneas que tiene en ese intervalo. `RowSlice` incluye flags de primer/último fragmento para aplicar padding de manera correcta.

Los encabezados se repiten por página y las filas que caben completas en otra página se mantienen juntas. Los avances deben consumir al menos una línea o terminar con error; la geometría debe ser finita y mayor que el mínimo para una línea con padding.

Mantener intactos `paginate_all` y `BreakToken` existentes para filas simples, que continúan indivisibles. Separar paginadores evita cambios silenciosos de contrato.

## Consecuencias

- Pro: filas de longitud arbitraria (dentro de límites de memoria/entrada) y extracción de texto ordenada.
- Contra: una fila dividida ocupa varias páginas; celdas cortas se ven vacías en continuaciones.
- Pendiente: control de viudas/huérfanas, salto por grapheme, hifenación, splitting inline de bloques, diferentes tamaños de fuente y adaptación a otros page sizes.

La primera implementación es experimental, con TTF del usuario, Parley para ancho y Krilla para dibujo; no garantiza soporte bidi o fallback.
