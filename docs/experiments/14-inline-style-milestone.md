# Unidad 13 — Estilos por run y fallback explícito

**Fecha:** 2026-10-16. **Estado:** prototipo funcional.

## Entregable

- Rust `crates/vufra-pdf/src/rich_text.rs`: `PdfTextRun.font_size`, `color`, `fallback_fonts`, coalescencia de spans compatibles, selección de fuente por token mediante `ttf-parser` y cache de cobertura, cálculo de avance Parley por tamaño y fuente reales.
- Rust `crates/vufra-pdf/src/flow_render.rs`: reserva de línea `max(lineHeight,1.35*maxInlineSize)`, baseline al 80% de la línea, Krilla dibuja con tamaño/fill RGB del run; restaura el estado de fill en cada uno.
- Binding NAPI: propiedades `NodeRichRun.font_size?:number`, `color?:string`, `fallback_fonts?:string[]` y parseo de RGB, sin cambiar los argumentos posicionales del endpoint.
- SDK TS: `PdfRichRun.fontSize?`, `color?`, `fallbackFonts?`; errores claros en datos inválidos; las APIs sync, async y `PdfRenderQueue` conservan compatibilidad.
- Nuevo directo de `ttf-parser 0.25.1` (ya dependencia transitiva de Krilla) para verificar cobertura Unicode.

## Ejemplo TypeScript

```ts
const pdf=await renderPdfAsync({
  title:'Certificado',
  fontFaces:{bold:boldBytes,symbols:symbolBytes},
  blocks:[{type:'rich-paragraph',
    runs:[
      {text:'Regular '},
      {text:'IMPORTANTE ',font:'bold',fontSize:27,color:'#BB3322'},
      {text:'★',fontSize:18,color:'#2255BB',fallbackFonts:['symbols']}
    ]
  }]
},regularBytes);
```

## Pruebas/experimentos

- `packages/vufra/tests/inline-style.test.mjs`: tests de píxeles realmente rojos/azules y retorno del fill predeterminado negro; bbox de tamaños 8/15/30pt; 210 tokens con distintas caras/tamaños/colores a través de páginas; errores de color/tamaño; cola/async; fallback de `★` con fuente Symbols 2 embebida; rechazo de glifos no cubiertos; comparación de `office` contra `of`+`fice` para estilo igual.
- `examples/inline-typography.mjs`: documento de 7 páginas Letter con 5 fuentes auténticas, 360 tokens marcados, tamaño 8–30pt, colores RGB y símbolo Unicode resuelto con fallback explícito. PDF extraíble; usar `pdftotext -raw` al comprobar el orden por la limitación geométrica explicada.
- Regresión de PDFs anteriores y SDK, tests Rust, fmt/clippy, empaquetado npm y GitHub Actions deben pasar para cerrar el hito.

## Pendientes

- Bidi/RTL y shaping de scripts complejos, fallback por grapheme cluster, remapeo por run con varias fuentes dentro de una misma palabra.
- Alturas variables por línea y estimación más eficiente de layouts, metadatos de accesibilidad (Tagged PDF/ActualText), formas SVG, tablas rich, PDF base y plantillas.
