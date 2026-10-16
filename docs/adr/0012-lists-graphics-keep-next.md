# ADR-0012 — Listas, gráficos vectoriales y continuidad semántica

- **Fecha:** 2026-10-16
- **Estado:** aceptada para la Unidad 11, API experimental.

## Contexto

El motor ya integraba texto, títulos, tablas e imágenes. Pero para formularios, reportes y contratos faltaban listas, figuras vectoriales sencillas y la capacidad de mantener juntos el título y el primer contenido relacionado. En la Unidad 10 un título podía quedar solo en la página anterior a su imagen.

## Decisiones

1. Extender el AST Rust `PdfBlock` con `List { items, ordered }` y `Graphic(PdfGraphic)`. En TypeScript, los nodos `{type:'list',ordered?,items:string[]}`, `{type:'rule',width,height,color?}` y `{type:'rectangle',width,height,color?}` se convierten a esos bloques a través de NAPI.
2. Una lista se mide por ítem con Parley en el ancho disponible descontando 27pt de sangría. Las líneas resultantes se aplanan al paginador de párrafos, pero conservan metadatos del inicio de ítem; la primera línea recibe su marcador `•` o `N.`, con el cuerpo sangrado. Las líneas siguientes alinean su texto a la misma sangría; listas largas y elementos largos pueden fragmentarse entre páginas.
3. Gráficos vectoriales: una regla horizontal es un rectángulo relleno de altura acotada hasta 8pt; un rectángulo es una caja rellena en el flujo. Ambos admiten color `#RRGGBB` y ancho/alto explícitos en puntos. Krilla dibuja un path vectorial, sin convertirlo en bitmap. El estado de fill/stroke se guarda y restaura para no contaminar dibujos posteriores.
4. El paginador `vufra-layout` incorpora `FlowBlock::Graphic` atómico y `FlowFragment::Graphic`. Ninguna figura puede superar las dimensiones imprimibles.
5. `paginate_flow_with_keep(blocks, flags, page_height)` permite marcar una entrada de tipo párrafo (en este contrato, un título) como `keepWithNext`. Si el título completo más el primer fragmento del siguiente bloque caben en una página nueva, ambos cambian juntos cuando el espacio actual no alcanza. El encabezado de tabla y su primera línea cuentan como mínimo; para una imagen o gráfico se requiere su alto completo. Si el grupo no cabe ni en una página vacía, se degrada a la paginación convencional sin bucles ni páginas vacías. El `paginate_flow` anterior permanece compatible y delega con flags false.
6. Los títulos `heading` del SDK usan `keepWithNext: true` por defecto; se puede desactivar explícitamente con `false`. No se impone a párrafos de texto ni se modifica el formato heredado.
7. Mantener validación en TypeScript y Rust: listas entre 1 y 1,000 elementos no vacíos, texto total <= 4 MiB, hex RGB válido, dimensiones finitas positivas y dentro del área de contenido, espesor de línea <= 8pt.

## Alcance y límites

- `keepWithNext` es **entre dos bloques contiguos**, no un sistema general de grupos arbitrarios o de títulos encadenados recursivamente. Para párrafos/tables extensos preserva solo el inicio del bloque siguiente cuando quepa.
- Las listas no son un AST anidado; sin listas multinivel, reinicio de contador personalizado, marcadores arbitrarios o estilos por ítem.
- Los gráficos por ahora son reglas y rectángulos rellenos; no bordes independientes, esquinas redondeadas, paths SVG arbitrarios, degradados ni posicionamiento absoluto.
- No hay un sistema general de widow/orphan control, ni PDF etiquetado semánticamente/UA garantizado. Los marcadores son texto dibujado en PDF.
- La implementación continúa siendo experimental y no ofrece streaming ni límites de RSS nativos.

## Pruebas

Rust verifica que el título y la imagen (o inicio de tabla) salten juntos, manejo de grupos imposibles y geometría de gráficos. End-to-end Node comprueba numeración, viñetas, ítems divididos con tokens extraíbles, RGB real mediante Poppler PPM, `keepWithNext` configurable, imágenes, tablas, rechazo de entradas inválidas y compatibilidad asíncrona/cola.
