# ADR-0020 — Fluent componible y nodos de contenido compartidos

Fecha: 2026-10-17. Estado: implementada parcialmente como migración progresiva (Unidad 19).

## Problema

Con las Unidades 15–18 se añadió soporte ad hoc a `BoxScope`, `ContentScope` y columnas. La construcción se duplicaba y la extensión de un contenedor implicaba reimplementar muchos métodos. El usuario quiere conservar **Fluent encadenable**, añadir componentes funcionales reutilizables y componer párrafos, imágenes, grids y tablas dentro de cajas sin APIs especiales.

## Decisiones y alcance implementado

1. **Fluent sigue siendo la interfaz principal.** `DocumentBuilder` permanece inmutable y mantiene `.heading().paragraph().box().table().render()`. Nuevo `.add(node | nodes)` inserta componentes funcionales sin cambiar la cadena.
2. **AST lógico declarativo en TypeScript**: `VufraNode` discrimina `paragraph`, `heading`, `image`, `flow`, `box`, `table`, `row`, `grid`. Las funciones equivalentes construyen datos inertes, sin JSX, React, headless browser ni side effects. `column(children,options)` es helper para filas.
3. **Constructor común**: fusionamos `ContentScope` y `BoxScope` en un `ContentBuilder` con métodos Fluent compartidos y `.add()`. El constructor resuelve las mismas funciones según el ancho interior y baja el árbol lógico al AST nativo; `ColumnScope` mantiene restricciones específicas del modelo de columnas.
4. **Contenedor verdaderamente anidado**: `PdfBoxItem::Box(Box<PdfBox>)` y `PreparedBox` recursivo en Rust; dibuja fondos, bordes, padding y fuentes reales. NAPI `NodeBoxItem.boxData` recursivo; normalizador TS y preflight NAPI respetan profundidad máxima de 8 y presupuestos de texto, imágenes y píxeles.
5. **Paginación predecible**: los items de un box exterior siguen fragmentándose entre páginas; un box anidado individual es **atómico**. Se mide su contenido y se mueve a otra página o se rechaza si excede la altura imprimible. No fragmentamos a ciegas cajas anidadas. Tablas dentro del box padre conservan encabezados repetidos (Unidad 18).
6. **Compatibilidad**: se conservan `table()` clásico sobre objetos, `tableStyled()` y la cabecera/pie de Unidad 17. La nueva `table(rows,{columns})` también puede usar datos enriquecidos en documento o caja; sin remapear tablas existentes.

## Uso

```ts
const TotalCard=(label:string,amount:string)=>
  box({padding:12,background:'#E8F2FC'},[
    paragraph(label),paragraph(amount,{bold:true})
  ]);

const pdf=await app.document({title:'Factura'})
  .heading('Resumen')
  .box({padding:16},c=>c
    .paragraph('Bienvenido')
    .image(logo,{width:80,height:40})
    .grid({columns:2},g=>g.cell(c=>c.paragraph('A')).cell(c=>c.paragraph('B')))
  )
  .add(TotalCard('Total','$1,200'))
  .render();
```

También `.add(box(options,[paragraph(...),grid(...),table(...)]))` es equivalente en intención de composición.

## Límites y deuda técnica explícitos

- **No se ha sustituido por completo el motor Rust por un único `Node`**. El AST lógico `VufraNode` se normaliza hacia `PdfBlock/PdfBoxItem/PdfRowItem`, preservando el renderer existente y su paginación probada. Un árbol Rust universal que soporte medición/fragmentación homogénea se deja como la fase siguiente, no se finge completado.
- **Las columnas Row/Grid admiten Box, Table y Grid anidados.** Su contenido se compila con el mismo ContentBuilder cuando ya se conoce el ancho real. Los métodos encadenados .box/.table/.row/.grid están disponibles en columnas.
- **Restricción actual:** cada fila Row/Grid es atómica al paginar. Si una fila no cabe en una página, se rechaza en lugar de superponerse. El límite de profundidad 8 considera alternancias Box → Row → Box y se valida en TypeScript, NAPI y Rust.
- No hay fragmentación vertical de cajas anidadas, nested rows fragmentables, RTL/bidi completo ni tablas con rowspan/colspan.
- Máximo 8 niveles de cajas. `PdfBoxItem` y `NodeBoxItem` (NAPI) se mantienen para interoperar con SDKs/AST previos.

## Pruebas

`packages/vufra/tests/composable.test.mjs` verifica Fluent + `.add()`, tarjetas reutilizables, cajas anidadas con grid e imagen y tabla, filas funcionales con columnas, copia inmutable, queue, depth guard, rechazo de nodos inválidos y de 65 imágenes en cajas anidadas. Se mantienen suites anteriores. Rust valida límite de 8 niveles, incluso alternando cajas y filas, en pruebas dedicadas. También se prueban boxes y tablas dentro de columnas de Row/Grid. Ejemplo `examples/fluent-composition.mjs`.

## Alternativas rechazadas

No reescribir el paginador completo de Krilla/Parley en una sola unidad (alto riesgo de perder la fragmentación, cabeceras repetidas y perfiles de memoria ya probados); no eliminar Fluent en favor de un lenguaje solo declarativo; no multiplicar nuevas clases específicas de scope.
