# ADR-0048 — `rowSpan` real con fondos y bordes continuos entre páginas

Estado: implementado en `feature/roadmap-39-43`. El soporte es **top-aligned**, con límites de tamaño explícitos y sin fragmentación de una *misma fila individual* que participe en el `rowSpan`.

## API

En un cuerpo de tabla con tres columnas, se puede crear la siguiente disposición:

```ts
.table([
  [{text:'Finanzas',rowSpan:3,colSpan:2,background:'#EEF6FF'},'$10'],
  ['$20'],
  ['$30'],
  ['Operaciones','Servicio','$40']
], {columns:[{title:'Área'},{title:'Concepto'},{title:'Total'}]})
```

`rowSpan:3` ocupa tres filas lógicas sucesivas y, combinado con `colSpan:2`, también dos columnas lógicas. Las siguientes filas **omiten** las columnas ocupadas; no se introducen placeholders manuales en la API. `rowSpan` está permitido solo en el cuerpo, es entero entre 1 y 32 (1 significa celda normal), no puede exceder el número de filas, y los rectángulos no pueden solaparse. La celda propietaria es top-aligned; `verticalAlign:'center'|'bottom'` en una celda con `rowSpan` se rechaza para evitar un centrado aparente por fila en vez de a lo largo del área combinada.

## Implementación

El SDK expande los rectángulos a una matriz de celdas físicas contiguas, insertando únicamente placeholders vacíos para los huecos cubiertos. Registra rectángulos `{row,column,colSpan,rowSpan}` sobre tracks originales de cabecera. `PdfBoxTable.row_spans` conserva esa metadata mediante normalización TS, NAPI y AST semántico Rust owned. Rust comprueba índices, límites, anchuras coincidentes con la cabecera, contenidos vacíos en continuaciones y ausencia de solapamientos.

En cada página Rust dibuja el relleno original de la celda combinada, no el color de zebra de las filas siguientes. Pinta solo los **bordes exteriores**: superior en la primera fila, inferior en la última, laterales en todas, incluso si filas distintas quedan en páginas diferentes y el encabezado de tabla se repite entre ellas. El texto de la celda propietaria se escribe **una sola vez**, en su primera fila.

Un `rowSpan` **no** se representa fingiendo una sola fila con texto repetido ni con bordes invisibles de celdas independientes. La selección de fondo/borde proviene de la celda propietaria para todas las filas continuadas.

## Políticas de página y límites

- Las filas que componen el `rowSpan` pueden caer en páginas distintas: el borde se interrumpe para la cabecera repetida y continúa después, sin repetir el texto o generar contenido adicional.
- Si **una fila individual** incluida en el `rowSpan` tiene más contenido que una página imprimible, la generación falla expresamente (`rowSpan does not support individual rows taller than a page`). No se deja contenido oculto ni se trunca; la división en líneas de una celda spanned requerirá una etapa posterior.
- El contenido del `rowSpan` se mide dentro de la primera fila y aumenta su altura si es necesario. No redistribuye dinámicamente su altura mínima entre filas, por lo que puede utilizar más espacio vertical de lo estrictamente necesario en algunos casos. Los layouts empresariales básicos siguen siendo seguros.
- No hay combinación con paginación de una celda individual de varias páginas; el contenido multilineal largo debe separarse por filas o usar una celda sin `rowSpan`.

## Pruebas

`packages/vufra/tests/table-rowspan.test.mjs` comprueba `rowSpan` + `colSpan`, AST de salida, PDF multipágina con 139 identificadores y celda propietaria única, fondo RGB [246,213,167] verificado en dos páginas y cabecera repetida, errores de bounds/solapamiento/align y validación de metadata alterada. Rust prueba continuidad vacía y solapamiento inválido desde el AST nativo. La suite existente y el experimento de 1000 filas deben seguir intactos.

Ejemplo integral: `examples/fluent-rowspan.mjs` produce una tabla con celdas verticales fusionadas y 148 operaciones. El texto se extrae y verifica en orden con Poppler.
