# ADR-0007 — Bloques semánticos, estilos medidos y geometría configurable

- **Fecha:** 2026-10-16
- **Estado:** aceptada como contrato experimental de Unidad 06, no API v1.

## Contexto

El compositor de Unidad 05 solo aceptaba párrafos y tablas, con A4 y tamaño de texto fijos. Vufra requiere encabezados diferenciados, estilos por bloque y control explícito de dimensiones/márgenes para imprimir documentos como Letter y reportes empresariales.

## Decisión

- Extender el AST tipado `PdfBlock` con `Heading {text, level}`, `StyledParagraph {text, style}` y `Spacer {height}`, conservando `Paragraph` y `Table`.
- Estilos en puntos: `TextStyle {font_size, line_height, space_before, space_after}`. Encabezados semánticos nivel 1/2/3 tienen presets nativos y estilos que afectan medición, paginación y render.
- Geometría por documento en `PageGeometry {width,height,margin_top,margin_bottom,margin_left,margin_right}` con presets A4 y Letter. Se valida que el área imprimible permita la composición y que quepan encabezados/pie.
- La geometría personalizada solo aplica a `blocks`. En la ruta heredada se conserva el papel A4 y se rechaza `page` para evitar comportamientos implícitos.
- Tablas validan anchura contra área imprimible real y el planificador recibe altura de contenido real; el renderizador posiciona tablas en el margen izquierdo, y pie/encabezado se mueven con el tamaño de página.
- `Spacer` participa en el layout pero no dibuja. Si no cabe en el resto de la página, pasa a la siguiente, sin loops.
- Extender NAPI-RS y TypeScript sin introducir un motor HTML ni acoplar `vufra-layout` a Krilla.

## Límites explícitos

Esto es un **AST de bloques tipados incremental**, no un árbol completo con nodos anidados, estilos por span, tablas anidadas o herencia de CSS. Todavía no admite títulos multiestilo, color/tipografía arbitraria, widow/orphan control, páginas de formato diferente dentro de un documento, ni streaming/asíncrono.

## Validación

Pruebas Rust y Node comprueban tamaño de página obtenido por Poppler, coordenadas de palabras mediante `pdftotext -bbox`, dimensiones de tipografía, cambios reales de paginación por márgenes, límites de entradas y compatibilidad con APIs anteriores.
