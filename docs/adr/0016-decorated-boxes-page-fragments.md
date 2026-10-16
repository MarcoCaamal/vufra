# ADR-0016 — `box()` con decoración y fragmentación multipágina

- **Fecha:** 2026-10-16
- **Estado:** aceptado como prototipo de la Unidad 15.

## Contexto

La API Fluent de la Unidad 14 permite componer documentos y filas horizontales reales, pero carece de contenedores con padding, fondo y borde. Los ejemplos empresariales requieren tarjetas, totales resaltados, resúmenes y apartados contractuales largos sin pedir coordenadas absolutas.

## Decisión

1. Incorporar `box(options,callback)` a `DocumentBuilder` y a `ContentScope`; callbacks síncronos como el resto de los scopes. Las opciones son `width?:number` (puntos; por defecto ancho imprimible), `align?:'left'|'center'|'right'`, `padding?:number` (0..60pt; predeterminado 12), `background?:'#RRGGBB'|themeColor`, `border?:{width?:number,color?:string}` (0..6pt). El borde debe caber dentro del padding. Se mantienen snapshots inmutables de los builders.
2. Los hijos de la versión inicial son párrafos y títulos con estilo regular, imágenes PNG/JPEG, reglas, rectángulos, separadores verticales y listas sencillas convertidas en párrafos. **No se simula negrita ni tablas anidadas**. Hasta contar con un compositor tipográfico anidado, no se permite fuente bold/alternativa en el interior de la caja.
3. Añadir el AST `PdfBlock::Box(PdfBox)`, NAPI `NodeBox`, normalizador TS `PdfBox`, compositor `crates/vufra-pdf/src/box_layout.rs` y `FlowBlock::Box`/`FlowFragment::Box` de paginación en `vufra-layout`. Son nodos reales, no una expansión en gráficos superpuestos.
4. El texto interior se envuelve en Parley según el **ancho interior** (width−2×padding), con estilos y altura de línea propios. Cada línea preparada es una unidad de continuación; imágenes, figuras y filas son unidades atómicas. Se rechaza una unidad que no puede caber en una página imprimible con el padding requerido.
5. Las cajas cuya altura íntegra cabe en una página nueva se mantienen enteras cuando ya no caben en el espacio restante; las más largas se fragmentan entre páginas. Cada fragmento reserva su propio padding superior e inferior para que el contenido no toque los bordes. Se dibuja fondo y bordes laterales por fragmento; borde superior solo en el primero y borde inferior solo en el último. El fondo se mantiene dentro del ancho fijo de la caja.
6. El renderer mide primero todas las unidades y después las dibuja con el mismo orden; fragmentos de texto no se duplican ni pierden. Se comprueban los límites totales de bytes/píxeles de imágenes, incluidos hijos anidados en filas o cajas; NAPI rechaza entradas excesivas antes de copiar Buffers.
7. Límites iniciales: hasta 500 hijos por caja y 10 000 líneas resultantes, anchura ≥100pt e interior ≥60pt, hasta 6pt de borde. El cálculo de altura incluye espaciados de párrafos, imágenes y padding. No hay cambios incompatibles en APIs anteriores.

## Semántica y compatibilidad

La Fluent API mantiene encadenamiento e inmutabilidad. El AST de bajo nivel admite `{type:'box',box:{...}}`. La versión asíncrona, sincrónica y `PdfRenderQueue` conservan los mismos métodos. La cola contabiliza buffers binarios arbitrariamente anidados por sus bytes reales en vez de expandirlos a JSON.

Las filas y grids de Unidad 14 continúan siendo atómicos y no se subdividen verticalmente. El nuevo `box` sí puede fragmentar su **texto** entre páginas. Esta distinción está documentada.

## Limitaciones explícitas

- No se admiten todavía tablas, cajas dentro de cajas, grids/columnas anidados, texto rich con negritas/fallback por fragmento ni estilos tipográficos alternativos dentro de `box()`; tampoco numeración avanzada de listas ni padding individual por lado.
- No se prometen fondos transparentes, sombras, radios de esquina, líneas de borde discontinuas o bordes SVG. Los colores son RGB opacos.
- Una imagen/figura indivisible que excede la página después de contar padding se rechaza; no se redimensiona silenciosamente.
- Una caja fragmentada **no repite títulos** de manera automática. Si hace falta encabezado repetido para muchos datos, usar `table()`, no `box()`.
- Se conservan encabezado y pie nativos fijos y las restricciones de márgenes de Vufra (top 110pt, bottom 50pt).

## Verificación

Los tests del paginador comprueban índices continuos, inicio/fin de bordes y ausencia de páginas vacías; Node E2E valida color/píxeles de fondo y bordes, ancho y padding, alineación de cajas, continuación de 1000 tokens, preservación de imagen y contenido posterior, validación de geometría, modo asíncrono y cola. El ejemplo `examples/fluent-panels.mjs` genera una factura Letter de nueve páginas con 110 servicios y 500 términos marcados, revisada visualmente en primera y página intermedia.
