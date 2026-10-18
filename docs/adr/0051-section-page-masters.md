# ADR-0051 — Maestros de página por sección sobre un solo flujo paginado

Estado: funcional en Fluent + TypeScript normalization + NAPI + Rust. No hay navegador, subdocumentos ni concatenación de PDFs. El mismo `FlowBlock` y motor de fuentes sigue siendo la única fuente de verdad.

## API

```ts
const document=vufra.document({page:'Letter'})
 .coverPage({padding:28},cover=>cover.heading('Informe anual'))
 .pageSection({
   header:h=>h.text('DEPARTAMENTO VENTAS'),
   footer:f=>f.text('Página {{page}} de {{total}}')
 },sales=>sales.heading('Ventas').table(rowsSales,{columns}))
 .pageSection({header:h=>h.text('DEPARTAMENTO FINANZAS')},finance=>
   finance.heading('Finanzas').table(rowsFinance,{columns}));
```

Cada `pageSection(masterBands,callback)` añade automáticamente **un salto de página real** antes de su primer bloque, salvo que sea el principio del documento o ya exista un salto inmediatamente antes. Captura las bandas en una instantánea propia y devuelve un `DocumentBuilder` inmutable. La sección exige contenido y acepta máximo 16 maestros por documento. `PageMasterOptions` permite `header`, `footer`, `oddHeader`, `evenHeader`, `oddFooter`, `evenFooter`; cada variante admite callback o `null` para supresión explícita. Los campos no definidos heredan el maestro inmediatamente anterior, o las bandas globales de la primera sección.

El autor puede continuar añadiendo contenido después de una sección; sigue usando su maestro hasta iniciar otra. Los elementos previos a la primera sección usan el `pageChrome` global. Las bandas `firstHeader`/`firstFooter` siguen siendo **del primer folio del documento**, no se reinician por sección. Los tokens `{{page}}`, `{{total}}` y odd/even siempre cuentan páginas físicas absolutas, sin numeración reiniciada por capítulo.

## Arquitectura y seguridad

- `PdfDocument.pageMasters` guarda `{startBlock,pageChrome}` sin introducir nodos invisibles. `DocumentBuilder` añade explícitamente `page-break` y valida callbacks de manera síncrona; el snapshot público es una copia profunda.
- TypeScript comprueba 1..16 maestros, índices crecientes, referencias dentro del arreglo de bloques y salto inmediatamente anterior cuando `startBlock>0`. Reutiliza `normalizeRow` para validar bandas, imágenes, estilos y geometría.
- NAPI introduce `NodePageMaster` con ownership del `NodePageChrome` por sección. Reutiliza conversiones y preflight de imágenes; la transformación semántica contiene `PdfPageMaster` sin duplicar el flujo de contenido.
- Rust valida otra vez los índices y el `PageBreak` real en el AST owned. Antes de paginar, mide **todas** las bandas de todos los maestros y reserva un solo máximo global de márgenes, evitando una re-paginación por cada cambio de header/footer o superposiciones con el cuerpo.
- Al dibujar cada página, se determina el maestro cuyo `startBlock` es el último no posterior al primer fragmento real de esa página. Así los continuadores de una tabla o caja usan su capítulo original, y una sección nueva cambia de banda exactamente al cruzar el salto declarado.
- Tanto la ruta síncrona como el worker asíncrono usan el mismo documento owned y reciben la misma lista de maestros.

## Limitaciones

La geometría de hoja (tamaño/márgenes) permanece uniforme para todo el documento; las variantes no pueden modificar tamaño de página ni reiniciar el contador. Todas reservan el margen máximo por anticipado —algunas páginas pueden tener espacio sobrante—. Aún no se generan TOC/referencias cruzadas, primera página especial **por capítulo**, ni secciones que empiecen automáticamente en página par. El primer capítulo respeta la portada global. Si un cliente define un maestro después de emitir bloques, los bloques anteriores no se reescriben.

## Verificación

`packages/vufra/tests/page-section-masters.test.mjs`: tres capítulos extensos, 332 IDs en orden, bandas sin fugas entre páginas, índices del AST (`[0,3,6]`), herencia y `null`, portada sin bandas y render síncrono/asíncrono equivalentes, odd/even absoluto y rechazos de índices alterados. Rust prueba índices desordenados/fuera de rango o sin `PageBreak`. Ejemplo `examples/fluent-page-masters.mjs`: 325 registros y tres bandas específicas.
