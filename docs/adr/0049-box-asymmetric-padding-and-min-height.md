# ADR-0049 — Box model nativo: padding por lado y altura mínima

Estado: implementado localmente en el roadmap Unidad 40. Ambos mecanismos reutilizan el motor de layout paginado existente y sus medidas de texto, sin estimación de fuentes ni HTML.

## Fluent API

```ts
doc.box({
  padding:{top:18,right:8,bottom:11,left:30},
  minHeight:190,
  background:'#F4F7FF',border:{width:1,color:'#335577'}
},box=>{
  box.paragraph('Tarjeta empresarial');
});
```

`padding` acepta el mismo número escalar anterior o un objeto parcial de `{top?,right?,bottom?,left?}`; cada lado no indicado hereda el **default de 12pt**. Los lados valen 0..60pt, el contenido debe conservar 60pt mínimo de ancho y el borde/radio no deben invadir el padding de cualquiera de los lados. La forma escalar anterior mantiene medidas y PDF bytes actuales cuando `minHeight` no se usa.

`minHeight` representa la altura mínima **total de la caja decorada**, incluido padding/bordes. Se valida como número finito, no negativo y no mayor que la altura imprimible disponible para ese box. **No recorta contenido**: la altura medida real prevalece cuando supera `minHeight`. No existe aún un `maxHeight` o clipping contractual.

## Geometría

- El SDK resuelve el ancho interior como `width-left-right` antes de componer hijos, incluyendo grid/row/table/nested boxes.
- El normalizador envía `paddingSides` a NAPI, mantiene un escalar vertical promedio `(top+bottom)/2` para preservar el contrato matemático del paginador previo (`2*padding` representa la reserva vertical total), y vuelve a validar lados y color/borde/radio.
- `PdfBox.padding_sides: Option<CellPadding>` permite que los callers de Rust sigan usando el escalar cuando no se requieran lados distintos. El AST owned `ContentFrame` conserva metadata sin pérdida. Rust `PdfBox::validate_depth` y `prepare_depth` usan ancho `left+right` y altura `top+bottom` reales.
- `PreparedBox` almacena `padding_top` y `padding_left` para posicionar contenido pintado en cada fragmento. El padding promedio solo alimenta **alturas de reserva**, no offsets de dibujo. El resto de la geometría de fondos, bordes, esquinas redondeadas y headers repetidos conserva el camino de renderizado existente.
- Después de medir el contenido y todos sus fragmentos, Rust agrega un spacer interno de altura `max(0,minHeight-total_intrinsic_height)`. El spacer es una hoja real del AST layout; participa en alturas y paginación, sin falsificar texto o ignorar límites del PDF.

## No alcance

`minHeight` no crea alturas distribuidas equitativamente entre siblings, y `maxHeight` no se admite. No hay Flexbox CSS, márgenes colapsables, auto-height iterativo ni alineación vertical de todos los hijos. Tampoco permite que una misma caja configure distinto padding **según el número de página**: la combinación de lados se aplica por fragmento del contenedor.

## Evidencia

`packages/vufra/tests/box-min-height.test.mjs`: compara el posicionamiento Y de un texto siguiente contra caja normal, comprueba minHeight en caja anidada y validaciones SDK/nativas. `packages/vufra/tests/box-side-padding.test.mjs` compara offsets Poppler X/Y contra box padding=0, comprueba ancho interior y crecimiento de altura por `top+bottom`, caso anidado con minHeight y tabla de 140 filas con encabezados repetidos multipágina. Los tests históricos de PDF/rounded boxes también se ejecutan con la suite completa.
