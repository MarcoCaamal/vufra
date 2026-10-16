# Unidad 06 — AST estilizado y geometría de página

**Fecha:** 2026-10-16. **Estado:** prototipo implementado y verificado.

## Implementado

- `crates/vufra-pdf/src/style.rs`: `PageGeometry` y `TextStyle` con valores y validación en Rust. A4, Letter y páginas a medida en puntos PDF (1/72 pulgada).
- `crates/vufra-pdf/src/lib.rs`: nuevos bloques `Heading`, `StyledParagraph`, `Spacer`, y `PdfDocument.page`. Compatibilidad con el modo antiguo.
- `crates/vufra-layout/src/flow.rs`: planifica `Spacer` y cambia de página si no cabe, sin dibujarlo.
- `crates/vufra-pdf/src/flow_render.rs`: mide el texto de cada bloque según su estilo, dibuja a escala y adapta posiciones de título, contenido, encabezados y pies a las medidas del papel y márgenes.
- `crates/vufra-pdf/src/table.rs`: aplica ancho/alto de contenido real al medir y dibujar tablas. Tablas de formato personalizado con más de 497 puntos de ancho están soportadas si el papel lo permite.
- `bindings/vufra-node/src/lib.rs` y `packages/vufra/src/index.ts`: contratos NAPI/TS de nodos/estilos/geometría y validaciones en ambos lados.

## Ejemplo

```ts
const pdf = renderPdf({
  title: 'Reporte ejecutivo',
  page: {format:'letter', margins:{top:135,bottom:72,left:56,right:56}},
  blocks:[
    {type:'heading',level:1,text:'Resultados'},
    {type:'styled-paragraph',text:'Resumen',style:{
      fontSize:12,lineHeight:19,spaceBefore:12,spaceAfter:12
    }},
    {type:'spacer',height:24},
    {type:'heading',level:2,text:'Análisis'},
    {type:'paragraph',text:'Contenido normal.'}
  ]
}, font);
```

## Evidencias

- `packages/vufra/tests/style.test.mjs`: tests end-to-end con `pdfinfo` (medidas de páginas), `pdftotext -bbox` (tamaños reales de fuente y coordenadas/márgenes), pruebas Letter, papel personalizado, continuidad de tablas, espaciador, validación y compatibilidad de modos.
- Prueba de área imprimible menor comprueba que cambie el número de páginas **sin perder ninguna fila** de tabla.
- PDF demostrativo `artifacts/styled-document.pdf`, **3 páginas Letter**, producido por `examples/styled-document.mjs`; primera página rasterizada a `artifacts/styled-document-preview.png` e inspeccionada visualmente. Fuente del sistema Noto Sans para la demostración; Vufra no empaqueta fuentes.
- Regresión completa del SDK TypeScript y experimentos Rust anteriores.

## Límites

- Solo el modo `blocks` soporta página a medida y estilos; modo heredado mantiene A4.
- Un único tamaño y márgenes por documento (no mezcla A4/Letter dentro del mismo archivo).
- Color, negritas reales, fuentes múltiples, contenido RTL y shaping complejo no están cubiertos. Encabezados cambian tamaño e interlineado, no necesariamente peso de fuente.
- El motor sigue siendo síncrono y la salida se construye completamente en memoria. No publicar en npm o crates.io hasta completar pruebas y empaquetado multiplataforma.

## Próximo hito

Separar claramente el AST semántico del compositor y extender el modelo (listas, imágenes, encabezado/pie personalizado), después ofrecer una API asíncrona para Node.js mediante tareas nativas.
