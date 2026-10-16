# Unidad 11 — Listas, gráficos y keepWithNext

**Fecha:** 2026-10-16. **Estado:** prototipo funcional en Rust + Node/TypeScript.

## Entregado

- `vufra-layout/src/flow.rs`: `paginate_flow_with_keep`, gráficos indivisibles y conservación del título con el siguiente bloque en página disponible. El método anterior `paginate_flow` no cambia de comportamiento.
- `vufra-pdf/src/graphic.rs`: `PdfGraphic {kind,width,height,rgb}`, regla horizontal y rectángulo relleno, dibujados con paths vectoriales Krilla, colores RGB y validación de área.
- `vufra-pdf/src/flow_render.rs`: medición de listas ordenadas y no ordenadas con Parley, marcadores que no se repiten en el fragmento de continuación, sangría colgante 27pt, listas que abarcan páginas, plan de conservación de títulos y render de gráficos.
- `vufra-pdf/src/lib.rs`: `PdfBlock::List`, `PdfBlock::Graphic`, y `PdfBlock::Heading{keep_with_next}`.
- `bindings/vufra-node/src/lib.rs`: `NodeBlock.items`, `ordered`, `keepWithNext`, `NodeGraphic` con `#RRGGBB`.
- `packages/vufra/src/index.ts`: API tipada para los nuevos nodos, validación y `keepWithNext:true` por defecto en títulos; `renderPdf` y `renderPdfAsync` permanecen disponibles.

## Ejemplo de API

```typescript
const pdf=await renderPdfAsync({
  title:'Reporte gráfico',
  blocks:[
    {type:'heading',level:2,text:'Fotografía',keepWithNext:true},
    {type:'image',data:photoJpeg,width:240,height:150,fit:'cover'},
    {type:'rule',width:450,height:3,color:'#245fa8'},
    {type:'list',items:['Primera opción','Segunda opción']},
    {type:'list',ordered:true,items:['Preparar','Verificar','Emitir']},
    {type:'rectangle',width:350,height:24,color:'#dceaf7'},
  ]
},font);
```

## Evidencia y QA

- Tests Rust `vufra-layout`: título e imagen comparten la segunda página, título + primera fila de tabla, cadena imposible degradada sin bloqueo, figura indivisible, validaciones.
- Tests Node `packages/vufra/tests/graphics-lists.test.mjs`: listas de 120 entradas, ítem largo con 680 tokens que conserva su orden y continúa en páginas siguientes, comprobación PPM real de colores rojo/azul, título junto a imagen/tabla, flag `false` y validaciones de tipos/geometría.
- `examples/graphics-lists-usage.mjs`: genera `artifacts/graphics-lists-report.pdf` de **5 páginas Letter** con listas, figura RGB, fotografía JPEG, tabla de 42 registros y heading junto a imagen; `pdftotext` confirma los 42 IDs ordenados. Las primeras dos páginas fueron rasterizadas e inspeccionadas visualmente.
- Regresiones previas de Vufra deben seguir pasando con el addon compilado en Linux x86_64; mantener pruebas CI con GitHub Actions.

## Próximos hitos

- `keepWithNext` generalizado para grupos de bloques de longitud variable y control de viudas/huérfanas.
- Listas anidadas y estilos específicos para marcadores.
- Figuras vectoriales avanzadas, stroke/bordes, líneas libres, curvas, gradientes y mejor diseño de formularios.
- Fuentes múltiples, tablas con estilos más ricos, artefactos de plantilla y PDF base.
