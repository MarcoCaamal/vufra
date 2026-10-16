# Unidad 15 — `box()`, decoración y continuación

**Fecha:** 2026-10-16. **Estado:** prototipo funcional, compatible con la Unidad 14.

## API Fluent

```typescript
const pdf = await vufra.document({title:'Reporte',page:'A4'})
  .heading('Resumen')
  .box({
    width:320,
    align:'right',
    padding:16,
    background:'#EFF5FC',
    border:{width:2,color:'#244A89'}
  },box=>{
    box.heading('Resultados del mes',{level:2,color:'#244A89'});
    box.paragraph('Facturación $125,000');
    box.divider({color:'#244A89'});
    box.paragraph('Las condiciones pueden continuar en otra página.');
  })
  .render();
```

`box()` admite párrafos, títulos, `list`, `spacer`, `image`, `divider` y `rectangle` en sus callbacks, con fuente regular, tamaño e interlineado y color RGB individual de texto. Los títulos dentro de la caja son semánticos para el builder, pero no se exportan como un árbol completo de tagged PDF.

## Implementación

- `crates/vufra-pdf/src/box_layout.rs`: prepara texto medido en ancho interior, imagen, gráfica y spacer; conserva anchos, estilos y padding; dibuja fondo RGB y cuatro lados del borde de acuerdo con la posición de cada fragmento.
- `crates/vufra-layout/src/flow.rs`: `FlowBlock::Box` y `FlowFragment::Box` con rangos de unidades a dibujar; una caja pequeña que cabe en hoja nueva es indivisible, caja larga continúa por líneas manteniendo fondo y bordes laterales y mostrando las tapas solo al principio/final; imágenes son unidades atómicas.
- `bindings/vufra-node/src/lib.rs` agrega `NodeBox` y análisis de RGB con validación de imágenes anidadas antes de copiar bytes.
- `packages/vufra/src/index.ts` agrega `PdfBox`/AST/normalización y presupuestos de imágenes; `packages/vufra/src/fluent.ts` agrega `BoxOptions` y `BoxScope`, con colores del tema y callbacks síncronos.
- Se conserva `PdfRenderQueue`, con contabilidad binaria recursiva introducida en la unidad anterior.

## Experimentos verificables

- `packages/vufra/tests/box.test.mjs`: pixel de relleno/borde en PNG renderizado con Poppler, coordenadas bbox que confirman padding y alineación, 1000 tokens únicos extraídos en orden a través de varias páginas, caja corta movida junta a página siguiente, PNG y línea vectorial dentro, errores de validación, generación async y cola.
- Tests Rust en `vufra-layout` validan fragmentos y rangos consecutivos, banderas first/last, límites de página y error al intentar ubicar una unidad demasiado grande.
- `examples/fluent-panels.mjs` crea `artifacts/fluent-panels.pdf`: 9 páginas Letter, resumen con fondo azul, total a la derecha con fondo cálido, 110 filas de servicios y un apartado legal largo con 500 tokens continuos.
- `pdftotext -raw` confirma orden, `pdftoppm` las apariencias de primera página y página 8. `pdfinfo` verifica formato/cantidad.

## Próximos trabajos

- Párrafos enriched/bold/fallback dentro de cajas, tablas/nested rows y cajas con `keepTogether` explícito.
- Diseño de headers/footers corporativos, repetición de encabezados de secciones largas, bordes redondeados y sombras.
- Generación a partir de PDFs existentes como overlay sin Chromium.

Decisión de arquitectura: [ADR-0016](../adr/0016-decorated-boxes-page-fragments.md).
