# ADR-0019 — Tablas enriquecidas y encabezados repetidos en cajas

Fecha: 2026-10-17. Estado: experimental (Unidad 18).

## Problema y objetivo

`PdfTable` existente usa celdas de texto simple y admite fragmentar una fila larga entre páginas. No era posible usar tablas dentro de cajas decoradas ni personalizar negrita, fuente, color y relleno de cada celda. Se necesita para facturas y estados de cuenta sin sacrificar una API Fluent simple.

## Decisiones de diseño

1. Introducir `PdfBoxItem::Table(PdfBoxTable)` que contiene `header:PdfRow`, `rows:Vec<PdfRow>`, `fills` RGB. Los anchos de columnas son idénticos, sin espacios, con 1–6 columnas (>=60pt), máximo 1000 filas. Reutilizar `PdfRow::prepare/draw` con tipografías reales y dibujo raster nativo.
2. Representar cada fila de la tabla como ítem atómico de `PreparedBox`: permite componer varias líneas, fragmentos tipográficos y PNG/JPEG en las celdas. Una fila no se corta verticalmente en esta unidad; debe caber en una página imprimible.
3. Guardar `BoxRepeatSpan{header_item,end_item}` en `FlowBlock::Box` y `repeat_header` en `FlowFragment::Box`. Si una tabla continúa en otra página, el paginador reserva el alto real del encabezado más padding. Si un encabezado quedaría solo al final de una página, se difiere junto con la primera fila. `PreparedBox::draw` repinta el encabezado de la tabla exactamente una vez por continuación, sin duplicar registros.
4. Pintar un rectángulo opaco por celda (RGB explícito o cabezal azul/alternancia de blancos/grises), con trazo de 0.5pt. Dibujar encima el contenido nativo de la fila, recuperando el estado anterior de relleno y trazo. El color de texto y la negrita pasan por `PdfRowItem::RichText` y `FontRegistry`: nada de negrita falsa.
5. NAPI agrega `NodeBoxTable` como `NodeBoxItem.tableData` y valida contenido antes de copiar buffers, contando imágenes y texto de tablas anidadas dentro de los límites existentes. El SDK TS valida las dimensiones contra el **ancho interior** del `box`. `DocumentBuilder.tableStyled()` permite usar el mismo modelo sin escribir un `box` explícito, creando uno transparente sin padding.
6. Preservar `DocumentBuilder.table()` clásico, con su fragmentación por líneas y encabezados repetidos. El modelo avanzado es **aditivo**, y soporta llamadas sync, async y cola inmutables.

## API pública

```ts
document.box({padding:14}, box=>{
  box.table([
    [{text:'INV001',bold:true}, 'Servicio', {text:'$50',background:'#E1F4DC'}],
    ['INV002', {runs:[{text:'Urgente ',bold:true},{text:'envío'}]}, '$99']
  ], {columns:[
    {title:'Folio',width:'25%'},{title:'Descripción',width:'50%'},{title:'Monto',width:'25%'}
  ]});
});
```

Además: `document.tableStyled(rows,{columns})`. Las celdas pueden contener texto regular, rich runs o una imagen PNG/JPEG con dimensiones explícitas. `repeatHeader` está siempre activo.

## Límites y riesgos aceptados

- **Filas enriquecidas atómicas**: a diferencia de `table()` clásico, una fila que no cabe ni en una página vacía devuelve error, no se parte por líneas. Puede dividirse entre filas, conservando encabezados.
- Sin celdas combinadas, rowspan/colspan, cajas dentro de celdas, tablas recursivas ni alineación vertical libre. Hasta seis columnas para conservar ancho mínimo de 60pt.
- La reserva de encabezado repetido consume altura real y caja exterior mantiene sus bordes/fondo de continuación.
- No alterar `Pdftable` clásico hasta una migración explícita con pruebas independientes.

## Evidencia

Pruebas `packages/vufra/tests/styled-table.test.mjs`: 210 registros únicos, cabecera por página, fuente Bold incrustada, filas con runs mixtos, caja angosta, rechazo de geometría, PNG en celda, relleno RGB real comprobado en píxeles PPM Poppler, async/FIFO. Pruebas Rust en `vufra-layout/src/flow.rs` verifican reserva exacta del encabezado y que no quede aislado. Ejemplo empresarial `examples/fluent-styled-tables.mjs`.

Relacionados: ADR-0015, ADR-0017, ADR-0018.
