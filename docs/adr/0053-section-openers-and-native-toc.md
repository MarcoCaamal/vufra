# ADR-0053 — Primer folio de capítulo e índice paginado con referencias reales

Estado: funcional, verificado en TS/NAPI/Rust; implementación incremental de la Unidad 41.

## 1. Primer folio propio de cada capítulo

`pageSection({title:'Ventas',firstHeader:h=>h.text('APERTURA'),firstFooter:null,header:h=>h.text('VENTAS')},content=>...)` permite elegir cabeceras/pies del primer folio físico **de esa sección** sin afectar otros capítulos. `null` oculta la banda solamente en la apertura. Si no se suministra `firstHeader` o `firstFooter`, el folio de apertura usa las bandas de paridad/estándar del capítulo.

Las bandas del primer folio no se heredan automáticamente por el capítulo siguiente. Una configuración global `document.firstHeader()` sigue aplicando únicamente al primer folio de todo el documento cuando no se sustituye explícitamente por una sección inicial. El código Rust calcula `section_first` al **cambiar de maestro entre páginas**, no cuando la misma tabla grande empieza un fragmento adicional en otra página. `{{page}}`/`{{total}}` y odd/even mantienen números absolutos del documento. La reserva global de márgenes ya contempla las ocho variantes de todos los maestros.

## 2. Índice automático y referencias por capítulo

```ts
const doc=vufra.document({page:'Letter'})
  .coverPage({padding:24},b=>b.heading('Informe anual'))
  .tableOfContents('Índice')
  .pageReference('Finanzas','Consultar el capítulo Finanzas')
  .pageSection({title:'Ventas',header:h=>h.text('Ventas')},body=>{
     body.heading('Ventas'); body.table(ventas,{columns});
  })
  .pageSection({title:'Finanzas',header:h=>h.text('Finanzas')},body=>{
     body.heading('Finanzas'); body.table(finanzas,{columns});
  });
```

- `pageSection({title})` establece el título de referencia del capítulo (1..64 caracteres). `tableOfContents()` inserta un solo índice autorado como placeholder, y lo expande a una entrada por sección **con título** al crear el snapshot de render. `pageReference(title,label?)` crea una referencia independiente por nombre de capítulo. Se rechaza un nombre no existente o ambiguo (dos capítulos con el mismo título), índices de destino fuera de rango y labels excesivas.
- Antes de normalizar, TypeScript transforma el índice y las referencias en bloques `page-reference` con un `targetBlock` exacto. Como el índice tiene N entradas y cambia la longitud del flujo, el builder crea un mapa de índices para ajustar tanto `startBlock` de los maestros como `targetBlock` de las referencias. El AST canónico mantiene estos nodos; NAPI y Rust vuelven a validar su payload y los presupuestos de texto.
- Rust mide una línea de etiqueta en una columna con margen reservado para la numeración; la entrada ocupa un bloque indivisible de 26pt, que puede pasar entero a la página siguiente. Después de la paginación definitiva, calcula **la primera página real de cada bloque fuente** inspeccionando los fragmentos del plan. Escribe el número de página en la columna derecha. No hay una segunda paginación, no se analiza el PDF generado ni se utilizan estimaciones de JS. Se mide también la numeración para evitar desbordes de cifras. Los destinos inválidos o no visibles fallan antes de producir un PDF erróneo.
- Esta primera entrega imprime **referencias textuales con número de página exacto**. Todavía no hay anotaciones de enlace interno clicable, bookmarks PDF, páginas físicas de tamaño variable por sección, reinicio de numeración por capítulo o referencias a celdas arbitrarias. Es una capacidad de índice profesional *básico*, no una implementación de todas las referencias cruzadas posibles.

## Evidencia

`packages/vufra/tests/page-section-masters.test.mjs` prueba tres capítulos multipágina con primera cabecera específica, supresiones y portada, incluyendo el caso donde `firstHeader` global solo afecta el primer folio del documento.

`packages/vufra/tests/table-of-contents.test.mjs` comprueba índice con tres capítulos y referencia independiente a Finanzas, comparación **exacta** de los números impresos con las páginas de cada capítulo extraídas con Poppler, estabilidad de 314 IDs, equivalencia síncrono/asíncrono, recálculo de páginas cuando crece el primer capítulo y errores por referencias ambiguas, ausentes o alteradas. Rust valida destinos no aptos, fuera de rango o autocitados.

Ejemplo ejecutable `examples/fluent-page-masters.mjs` integra índice, apertura diferenciada, maestros y 325 registros extraíbles.
