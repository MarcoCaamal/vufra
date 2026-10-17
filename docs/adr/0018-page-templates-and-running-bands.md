# ADR-0018 — Plantillas de página, cabeceras y pies dinámicos

Fecha: 2026-10-16. Estado: experimental, implementada en Unidad 17.

## Problema

El compositor Fluent tenía cabecera fija con título y leyenda, pie fijo Página N/Total y ninguna opción para logotipo, páginas de portada o bandas corporativas. El contenido se paginaba antes de conocer el total definitivo.

## Decisiones

1. **Mismo renderer PdfRow** para las bandas. Admite hasta seis columnas, texto regular y enriquecido, tipografías TTF/OTF reales y PNG/JPEG, sin navegador; conserva medición/dibujado idénticos.
2. **Plantillas serializables:** PdfDocument.pageChrome contiene header, footer, firstHeader, firstFooter y banderas para ocultarlos. N-API agrega un argumento opcional AL FINAL de las firmas sync/async; no cambia el lugar del token de cancelación.
3. **Numeración tardía:** Rust sustituye {{page}} y {{total}} luego de paginar. En Fluent, .text(({page,total}) => ...) se invoca una única vez con tokens de cadena, NO por página en JS. La fila se vuelve a medir por página.
4. **Reserva automática:** antes de paginar se miden todas las variantes realmente visibles con tokens conservadores de ocho dígitos. La mayor altura aumenta marginTop o marginBottom; se vuelve a validar PageGeometry. Al dibujar se deja separación de 8pt hacia el cuerpo y borde de página. Si el contenido útil cae por debajo de 100pt se rechaza el documento.
5. **Seguridad:** el presupuesto de texto, imágenes, bytes y píxeles cubre el documento más sus bandas; la cola toma snapshots binarios de la plantilla.
6. **Compatibilidad:** cuando no hay pageChrome, cabecera y pie originales siguen intactos. Solo se admite pageChrome en modo blocks. La primera variante sustituye a la recurrente; null suprime la elegida y el diseño heredado correspondiente.

## Compromisos

- Una banda admite una sola fila, grid de una fila, texto o imagen, sin varios bloques verticales apilados.
- La primera página comparte geometría con las demás: se reserva en todo el documento la altura necesaria para la mayor variante visible, de modo que la paginación sea uniforme.
- Sin callbacks JS por página, ni fecha dinámica integrada. Sin fuentes inventadas, RTL/bidi general, SVG ni superposición sobre PDF base.
- La API de bajo nivel puede cambiar antes de v1.

## Evidencia

Pruebas E2E en packages/vufra/tests/page-template.test.mjs: numeración multipágina, portada distinta, supresión, logo/bold reales, reserva y rechazos, AST y sync/async/cola. Dos pruebas Rust de tokens y precedencia. Ejemplo en examples/fluent-page-templates.mjs.

Relacionado: ADR-0017, layouts anidados.
