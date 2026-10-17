# ADR-0022 — Vista semántica común y fragmentos rich seguros (Vufra Unidad 21)

**Fecha:** 2026-10-17. **Estado:** implementado y verificado localmente.
**Rama:** `feature/unit21-semantic-nodes-rich-cells`, basada en Unidad 20.

## Contexto

La Unidad 20 introdujo `LayoutNode` como árbol común de medición y
paginación para contenedores y tablas. Sin embargo, el modelo de contenido
del renderer todavía duplicaba `PdfBlock`, `PdfBoxItem` y `PdfRowItem`.
Además, las filas/columnas con texto rich multi-font más altas que una página
se rechazaban, aunque el motor ya medía sus líneas por separado.

## Decisiones

1. **Vista semántica común en Rust.** Nuevo `crates/vufra-pdf/src/semantic.rs`
   con `SemanticNode<'a>`, trait `SemanticView` y `SemanticBudget`.
   Los tres modelos existentes de contenido (`PdfBlock`, `PdfBoxItem` y
   `PdfRowItem`) se adaptan a los mismos conceptos: Text, Rich, Image,
   Box, Row, Table, Other. Es una representación común **efectivamente
   utilizada** por `flow_render::validate_flow` y su contabilidad
   recursiva para root, boxes, rows, tables y page chrome; no solo un enum
   cosmético. Cuenta fuentes de texto, imágenes y payloads con la misma
   lógica sin importar qué contenedor los incluya.
2. **Se preserva el protocolo actual.** NAPI y API Rust pública siguen
   aceptando `PdfBlock/PdfBoxItem/PdfRowItem` para compatibilidad. El nuevo
   semantic view es un adaptador cero-copia para recorrer la estructura.
   No afirmar que estos enums fueron eliminados ni que existe un AST
   semántico owned completamente nuevo que sustituye todos los payloads.
3. **Líneas rich pre-shapeadas.** Cuando un `PdfRow` excede la altura
   imprimible, el fallback `as_fragmentable_box` usa
   `prepare_rich(runs,style,columnWidth,registry,...)` para obtener
   `RichLine` con `PositionedRun` (font_index de la fuente real,
   font_size, color RGB, x medido, texto).
4. **Reuso exacto del shaping.** Cada línea queda como un
   `PdfRowItem::MeasuredRichLine(PreparedRichFragment)` generado por Rust.
   `PreparedRichFragment` tiene campos PRIVADOS: callers externos no
   pueden fabricar índices de fuentes. Se crea únicamente después del
   preflight sobre los runs originales; el renderer no vuelve a convertir
   líneas a texto plano ni elige un fallback distinto. Los márgenes verticales
   de la línea quedan solo al inicio/final del párrafo original.
5. **Tablas enriquecidas con celdas grandes.** Cuando una fila de cuerpo de
   `PdfBoxTable` es demasiado alta, su `PdfRow` se fragmenta en líneas/
   elementos sincronizados por columna. `PreparedContent::TableRowFragment`
   retiene (a) segmento preparado, (b) segmento original, (c) índice de
   tabla y (d) índice de fila original. Al dibujar usa el fill de la fila
   original (incluyendo el color RGB propio) y el mismo ancho/borde por celda.
   `LayoutNode::RepeatTable` agrupa esos segmentos como hojas en una tabla
   real y el encabezado se repinta en cada página de continuación.
6. **Seguridad y límites.** Preflight de profundidad 8 y presupuestos de
   texto/imágenes/celdas mantiene consistencia; como máximo 500 líneas
   de contenido en una fila fragmentable (límite para evitar explosión en
   CPU/memoria) y 10k hojas por box. Un encabezado de tabla demasiado alto,
   una imagen indivisible o una box dentro de una celda mayor a la página
   aún generan error explícito.

## API pública

La Fluent API y los builders funcionales NO CAMBIAN.

```ts
await engine.document({page:'Letter'})
  .box({padding:14},b=>b.table([
    ['REC001',{runs:[
      {text:'Algunos importes ',bold:true,color:'#BB3344'},
      {text:'y muchos renglones adicionales '.repeat(80)}
    ],background:'#E1F4DC'}]
  ],{columns:[
    {title:'Folio',width:'30%'},
    {title:'Concepto',width:'70%'}
  ]}))
  .render();
```

Este contenido ahora puede continuar automáticamente a otra página dentro
de una misma celda. Los títulos de columnas se repiten. El motor no agrega
nuevos métodos al SDK para esa funcionalidad.

## Evidencias y pruebas

- Rust `semantic.rs`: igualdad de contabilización de `Text` en root,
  box y row; visita semántica recursiva Row dentro de Box.
- Node `composable.test.mjs`: texto mixto bold+regular fragmentado en
  Row, tokens exactos; tabla con una celda rich de 320 tokens, sin
  duplicaciones y con header en cada página; muestreo real PPM
  [225,244,220] en páginas 1 y 2 de la celda verde.
- `styled-table.test.mjs`: celda plain de 640 tokens ahora se divide;
  un input excesivo de 2600 tokens se rechaza por >500 líneas preparadas.
- `examples/fluent-rich-pagination.mjs`: genera 7 páginas Letter, 170
  ITEMRED, 170 ITEMREG, 145 COLBOLD, 145 COLREG y 90 COLRIGHT, todos
  en orden y exactamente una vez; fuentes NotoSans Regular/Bold incrustadas.

## Límites y próximos trabajos

**No es sustitución total de los enums antiguos**: ahora existe un
`SemanticNode` como vista semántica canónica usada en presupuestos de
recursos y un `LayoutNode` geométrico ya integrado en la paginación.
Las estructuras específicas siguen necesarias para el drawing con Krilla
y las entradas NAPI. Para migrar a AST owned único habría que revisar
todos los render paths, schemas/bindings y compatibilidad de crates.

Las columnas de Row/Grid siguen sincronizadas por el índice de
sub-elemento y no tienen cursores de fragmentación independientes.
Rich body cells pueden continuar, pero encabezados demasiado altos,
media indivisible enorme, box dentro de celda mayor a una página,
`colspan/rowspan` y bidi/RTL completo quedan pendientes.
