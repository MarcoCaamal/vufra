# ADR-0042 — Plantillas JSON v1 de datos y componentes (fundación U43)

Estado: prototipo funcional local. La Fluent API sigue siendo la API principal para autores de TypeScript, `defineTemplate()` reutiliza exactamente la misma salida de nodos, sin introducir segundo compositor.

## Contrato

`defineTemplate({schemaVersion:1,title,page,margins,content})` acepta datos JSON serializables. `.document(vufra,data)` devuelve el `DocumentBuilder` usual, que conserva `.render()`, `.renderSync()`, `.enqueue()`. Los nodos soportados en esta primera versión son `heading`, `paragraph`, `box`, `if`, `each` y `table` con columnas declaradas y `value:{bind:'row.prop'}`. Los textos aceptan literales o `{bind:'ruta.simplificada'}`. En `if`, el binding ha de ser booleano explícito. En `each`, la colección debe ser array y se resuelve bajo un alias léxico, por defecto `item`. En tabla, por defecto `row`.

Ejemplo:

```ts
const template=defineTemplate({
 schemaVersion:1,title:{bind:'company.name'},page:'Letter',content:[
  {type:'heading',text:{bind:'company.name'}},
  {type:'table',from:'invoices',as:'invoice',columns:[
   {title:'Concepto',width:'60%',value:{bind:'invoice.name'}},
   {title:'Importe',width:'40%',align:'right',value:{bind:'invoice.amount'}}
  ]}
 ]
});
const bytes=await template.document(vufra, data).render();
```

## Seguridad

Sin `eval`, `Function`, HTML o llamadas de red/archivos por la plantilla. Rechazar funciones, `undefined`, NaN/Infinity, prototipos arbitrarios, ciclos y claves peligrosas. La definición se valida y clona al definirla; los datos se clonan por trabajo. Binding usa exclusivamente propiedades propias, sin traversal de prototipos. `schemaVersion` distinto de 1 se rechaza en vez de hacer migración no definida. Se limita tamaño JSON de definición (1MiB), datos (4MiB), profundidad (24), nodos materializados (10k), items por `each`/tabla (1k). Errores por rutas faltantes o tipos incompatibles son explícitos y no se convierten silenciosamente en cadenas `undefined`.

## Alcance y próximos requisitos

No hay todavía schemas de datos declarativos con formatos/tipos opcionales, expresiones aritméticas, fechas/monedas de precisión decimal, links ni bindings de imágenes. Los arrays de registros son materializados en memoria de forma acotada, **no streaming**. No hay `schemaVersion:2`, editor web o migrador. El motor Rust permanece autoritativo para layout, métricas y paginación. Para dinero, la aplicación debe proporcionar texto exacto (p.ej. `MXN 1,234.00`), no operar en floating point.

Pruebas `packages/vufra/tests/json-template.test.mjs` comprueban 160 registros únicos, encabezados repetidos, condicionales, loops, snapshots inmutables, rutas inseguras, contratos JSON inválidos y ausencia de evaluación de código.
