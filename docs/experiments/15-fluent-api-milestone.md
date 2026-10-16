# Unidad 14 — Fluent API y layouts horizontales reales

**Fecha:** 2026-10-16. **Estado:** prototipo experimental funcional.

## Nuevas superficies públicas

```typescript
import {createVufra} from 'vufra';
const vufra=createVufra({font:regularBytes,fonts:{bold:boldBytes}});
const pdf=await vufra.document({title:'Factura',page:'A4'})
  .heading('Factura')
  .row({gap:16},row=>{
    row.column({width:'40%'},col=>col.paragraph('Empresa'));
    row.column({width:'60%',align:'right'},col=>col.paragraph('Folio 2026'));
  })
  .table(productos,{columns:[
    {key:'name',title:'Producto',width:'*'},
    {key:'price',title:'Precio',width:120}
  ]})
  .render();
```

`createVufra()` también admite `theme.colors`, `theme.h1/h2/h3`, fuente principal y un conjunto de fuentes nombradas. `vufra.document({font})` funciona sin factoría para documentos mínimos. Los builders son composables y su estado estructural es inmutable; los callbacks temporales solo son síncronos.

## Implementación

- `packages/vufra/src/fluent.ts` contiene builder público y scopes tipados para `row/column/grid/section/richText`, estilos de texto, themes, layout de tablas a partir de objetos y salida sync/async/queue.
- `crates/vufra-pdf/src/row.rs` prepara y pinta filas verdaderamente horizontales: cada columna tiene ancho fijo y medición Parley independiente, alineación del texto a la derecha y soporte de imágenes y figuras. Composición atómica entre páginas y error explícito cuando el alto supera la página.
- `vufra-layout/src/flow.rs` añade `PageBreak`, sin páginas vacías por saltos consecutivos o salto al final.
- `crates/vufra-pdf/src/lib.rs`, `flow_render.rs`, NAPI Rust y `packages/vufra/src/index.ts` reconocen los nuevos nodos. Rich headings personalizados ahora conservan `keepWithNext`.
- Los PNG/JPEG incrustados en columnas cuentan dentro de los presupuestos globales de bytes y píxeles del render. No se agregaron dependencias externas a npm ni nuevas fuentes vendorizadas.

## Ejemplos verificables

- `examples/fluent-invoice.mjs`: factura empresarial multipágina con logotipo, emisor y folio en columnas diferentes, datos del cliente, 260 filas, tabla repetida y resumen de totales. PDF en `artifacts/fluent-invoice.pdf`, Letter, 14 páginas; `pdftotext -raw` confirma registros 1..260 sin pérdidas ni duplicados.
- `examples/fluent-report.mjs`: resumen ejecutivo A4 con tres indicadores horizontales, secciones y un salto de página que separa el apéndice. PDF `artifacts/fluent-report.pdf`, dos páginas.
- `packages/vufra/tests/fluent.test.mjs`: cadena simple, sync y async, snapshots, real bbox de columnas y alineación derecha, logotipo más texto sin superposición, theme bold real y `keepWithNext`, grid y section, factura de 480 registros con header repetido, error ante solicitudes de layout no soportadas, pageBreak y compatibilidad AST de bajo nivel.
- Las pruebas Rust de layout y fila cubren salto explícito sin páginas vacías, límites de anchura/gap/altura y errores previsibles.

## Límites publicados

Esta unidad ofrece una API usable **sin afirmar que todos los layouts empresariales estén completos**. Se dejan para hitos siguientes los bordes/fondos/padding de `box`, más componentes visuales, row multipágina, headers/footers configurables, secciones con `keepTogether` multiparte y superposición sobre PDFs existentes.

Ver decisiones técnicas: [ADR-0015](../adr/0015-fluent-builders-and-atomic-rows.md).
