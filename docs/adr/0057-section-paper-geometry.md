# ADR-0057 — Geometría de página independiente por sección

**Estado:** implementado localmente en `feature/unit56-precise-pdf-anchors`. Complementa los ADR-0051 (maestros por sección), 0053 (TOC) y 0056 (anclas precisas). Se conserva un único PDF, una única instancia de fonts y el mismo paginador Rust.

## API

```ts
const report=vufra.document({page:'A4'})
  .coverPage({padding:24},b=>b.heading('Reporte'))
  .tableOfContents('Índice')
  .pageSection({title:'Operaciones',page:'Letter',
    header:h=>h.text('Operaciones')},b=>b.table(operations,{columns}))
  .pageSection({title:'Finanzas',page:{width:920,height:520,
    margins:{left:92,right:30,top:122,bottom:62}},
    header:h=>h.text('Finanzas')},b=>b.table(finance,{columns}));
```

`pageSection({page})` acepta `'A4'`, `'Letter'` o el mismo `PdfPageOptions` ya usado por el documento: preset y/o tamaño custom con ambos `width`/`height`, más `margins` por lado. Todos los valores son puntos PDF. La sección comienza en una página física nueva según el contrato anterior. Si `page` no se especifica, hereda la geometría de la sección anterior (o la global en la primera). El `DocumentBuilder` captura una copia de la geometría para evitar mutaciones externas del objeto de configuración.

## Medición y paginación

1. `ContentBuilder` de cada sección —y los bloques Fluent añadidos después de ella— compila rows/grids/tablas contra el ancho interior **de su propia página**, no el inicial. Los page-band callbacks también usan el ancho de la sección. TypeScript normaliza y vuelve a validar la geometría por bloque; NAPI transforma `NodePageMaster.page` a `PageGeometry`. El AST owned transporta el mismo `PdfPageMaster.page`.
2. Rust valida otra vez cada geometría (`250..2000pt` para ancho/alto, anchos/márgenes mínimos, área imprimible) y el `PageBreak` requerido. Construye segmentos entre los índices originales de `pageSection`: excluye el separador que anuncia un cambio de sección para evitar hojas vacías, manteniendo los demás saltos explícitos del flujo.
3. Para cada segmento reserva sus bandas activas **en su geometría efectiva**. El contenido y sus hojas/fragmentos se preparan con el ancho y la altura imprimibles del mismo segmento, incluyendo Parley, tablas, filas complejas, imágenes, cajas fragmentables y encabezados repetidos.
4. El paginador `vufra-layout::paginate_flow_with_keep` es **el mismo** de siempre: se ejecuta sobre cada segmento homogéneo, y los índices de los fragmentos se convierten a los índices globales del documento. Se concatenan planes y sus `PageGeometry`, manteniendo numeración global, paridad y tokens `{{page}}`, `{{total}}`.
5. En cada hoja Krilla crea un `PageSettings` con su MediaBox real y dibuja el contenido, bordes y bandas en sus márgenes propios. El índice, los bookmarks y los enlaces `XyzDestination` se resuelven **después de paginar todo el documento**. La coordenada Y se extrae de los fragmentos, y el destino usa el margen izquierdo de **su página de llegada**, no el de la página donde se pulsó.

## Restricciones actuales

- La geometría sólo cambia **en el límite de una sección**, jamás a mitad de una misma tabla ni de una caja. Dentro de cada segmento las páginas tienen la misma geometría. No se cambian fuentes, recursos o tamaño de papel por cada fila.
- La numeración sigue siendo global; no se reinicia al cambiar de sección. No hay reglas automáticas de páginas pares/impares iniciales ni márgenes reflejados alternos.
- Las bandas heredadas son layouts reales de ancho fijo; si se pasa de una página ancha a otra más estrecha y la banda heredada no cabe, debe redefinirse el header/footer de la sección: el renderer **rechaza** una geometría imposible en vez de recortarla o simular reflow de una banda ya compuesta.
- Los TOC, destinos y bookmarks se conservan. No hay todavía anclas a filas específicas dentro de tablas o bookmarks jerárquicos.

## Pruebas

`packages/vufra/tests/mixed-page-sections.test.mjs` genera A4 de portada e índice, Letter con 112 IDs, horizontal custom `920x520pt` con 85 IDs, títulos y márgenes por capítulo, vínculos exactos a un resumen, rutas sync/async y verificaciones reales mediante `pdfinfo -box`, `pdftotext` y `pdftohtml -xml`. Contrasta también el objeto PDF `/XYZ` contra el `bbox` del encabezado en una página Letter, usando la altura de ese folio —no la portada A4—. Prueba compilación de tracks de tablas con anchos custom distintos (420 y 850 puntos), contenido posterior que hereda la sección activa, validación de documentos alterados y aislamiento de objetos de configuración mutados después de crear el builder.

La suite anterior permanece operativa: 1000 filas Unicode, tablas con `rowSpan`, portadas, bandas por paridad, TOC y anclas. Ejemplo completo `examples/fluent-mixed-pages.mjs` con 197 registros y tres tamaños de página.

Una salvaguarda adicional impide que el título estándar de la cabecera, medido con Parley, se pinte fuera del ancho imprimible de una sección más estrecha: si no hay un `header` específico de esa sección capaz de reemplazarlo, el render falla con `document title exceeds section printable width`. También se prueba que la geometría sigue siendo inmutable cuando el autor modifica posteriormente el objeto de márgenes proporcionado.
