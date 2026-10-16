# ADR-0006 — Flujo de bloques ordenados, paginación desacoplada

- **Fecha:** 2026-10-16
- **Estado:** aceptada para el prototipo, no estabilidad de API v1
- **Licencia:** MIT OR Apache-2.0

## Contexto

Hasta la Unidad 04 se renderizaban dos secuencias rígidas: primero párrafos/filas heredados, luego una tabla que comenzaba en páginas independientes. Los párrafos largos se rechazaban. Una herramienta para generar reportes y contratos necesita intercalar múltiples tablas y párrafos, reanudar texto entre páginas y reutilizar espacios sobrantes.

## Decisión

1. Agregar `blocks?: PdfBlock[]` al documento y `PdfBlock = Paragraph(String) | Table(PdfTable)` al API Rust. En TypeScript es la unión discriminada `{type:"paragraph",text}` o `{type:"table",table}`.
2. `blocks` es mutuamente exclusivo de los campos `paragraphs`, `rows`, `table`. Se mantiene **intacta** la ruta heredada para no introducir roturas silenciosas.
3. Crear `vufra-layout/src/flow.rs` como planificador **sin dependencia del escritor PDF**, con `FlowBlock`, `FlowFragment`, `FlowPage` y `paginate_flow`.
4. `vufra-pdf/src/flow_render.rs` mide cada bloque con Parley, invoca `paginate_flow` y emite las páginas desde Krilla. Los fragmentos tienen alturas medidas, incluyendo espacio previo al primer renglón de un párrafo para evitar colisión visual con las tablas.
5. La tabla reutiliza `paginate_split_page` (cursor por fila/línea) y repite el encabezado en cada página donde aparece. Los párrafos se dividen por línea y mantienen el orden.
6. Un párrafo corto que cabe completo en la siguiente página se mantiene unido. Los largos se fragmentan, sin duplicar líneas.
7. No se introducen plantillas HTML, Chromium, archivos temporales ni procesos externos como parte del motor.

## Consecuencias y deuda

- Podemos intercalar párrafos y tablas, en una misma página o varias, de manera determinista para las fuentes y opciones dadas.
- Un flujo nuevo usa reglas ligeramente distintas a las heredadas: política explícita, documentada y tipada.
- Sigue pendiente generalizar nodos, estilos, márgenes, imágenes y jerarquías a un AST completo.
- Paginación por líneas sin control de viudas/huérfanas ni guionado; contenido RTL y shaping avanzado sin garantía.
- PDF generado completamente en memoria y NAPI síncrona (puede bloquear el event loop).
- La reutilización de `prepare_table` calcula aún páginas aisladas durante medición, por lo que existen oportunidades de eliminar trabajo duplicado cuando el planificador madure.

## Evidencia

Pruebas Rust y Node.js de orden, no duplicación, aprovechamiento de páginas, párrafos extensos, tablas repetidas y modos incompatibles. Consultar [Unidad 05](../experiments/06-unified-flow.md).
