# Unidad 12 — Tipografía real y párrafos multifuente

**Fecha:** 2026-10-16. **Estado:** experimental, funcional.

## Implementado

- `crates/vufra-pdf/src/rich_text.rs`: `PdfFontFace`, `PdfTextRun`, `FontRegistry` y planificación de tokens `PositionedRun` por fuente. Fuentes separadas registradas y medidas con Parley; Krilla dibuja incrustando cada archivo TTF/OTF explícito.
- `crates/vufra-pdf/src/flow_render.rs`: `PreparedBlock::Rich` y `FlowBlock::Paragraph` para saltos de línea/página con múltiples fonts; se conserva el resto del motor, incluida cancelación cooperativa.
- `bindings/vufra-node/src/lib.rs`: `NodeFontFace`/ `NodeRichRun` y extensión final de argumentos nativos sin alterar los argumentos preexistentes. Validación temprana del presupuesto de fuentes.
- `packages/vufra/src/index.ts`: `fontFaces?:Record<string,Uint8Array>` y `rich-paragraph` tipado con validación. La fuente `regular` es el segundo argumento de `renderPdf` y es el valor predeterminado del span.
- `packages/vufra/src/queue.ts`: presupuesto byte-aware de fonts adicionales, no convertir buffers de varios MB en JSON decimal durante el cálculo de capacidad.
- `packages/vufra/tests/rich-text.test.mjs`: tests de fuentes verdaderamente incrustadas, 700 tokens y salto de página, cajas de texto y ausencia de superposición mediante `pdftotext -bbox`, invalid inputs y clone seguro de fuentes tras encolar.
- `examples/rich-typography.mjs`: PDF de **3 páginas Letter** y 350 tokens identificados que alternan Noto Sans Regular/Bold/Italic y Noto Serif; PDF inspeccionado con `pdffonts`, extracción, y miniatura rasterizada.

## Ejemplo

```typescript
import { readFileSync } from 'node:fs';
import { renderPdfAsync } from 'vufra';

const pdf=await renderPdfAsync({
  title:'Informe tipográfico',
  fontFaces:{
    bold:readFileSync('MySans-Bold.ttf'),
    italic:readFileSync('MySans-Italic.ttf'),
    serif:readFileSync('MySerif-Regular.ttf')
  },
  blocks:[
    {type:'rich-paragraph',
      runs:[
        {text:'Regular '},
        {text:'negrita ',font:'bold'},
        {text:'cursiva ',font:'italic'},
        {text:'y serif.',font:'serif'}
      ],
      style:{fontSize:12,lineHeight:19,spaceBefore:10,spaceAfter:8}
    }
  ]
},regularFontBytes);
```

## Comprobaciones

- Las fuentes adicionales no se incluyen ni se publican; la demo recibe rutas de fuentes del usuario.
- `pdffonts` permite verificar `emb=yes`, `sub=yes` y `uni=yes` para cada font utilizado.
- `pdftotext -layout` verifica continuidad y ausencia de duplicaciones.
- `pdftotext -bbox` verifica anchura real y no superposición dentro de los márgenes.
- `pdftoppm` verifica resultados visuales. No afirmar fallback Unicode automático ni shaping intercambiable entre estilos.
- Ejecutar de nuevo las regresiones de PDF, Rust y Node antes del commit.

## Por hacer

Color y tamaños independientes por run, kerning/ligaduras entre runs, fallback por glifos, escritura bidireccional/RTL y multifuentes automáticas en tablas/encabezados. Posteriormente: motor de plantillas, PDFs base y distribución multiplataforma.
