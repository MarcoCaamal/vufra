# Unidad 17 — Plantillas de página corporativas y numeración

Fecha: 2026-10-16. Implementación experimental.

## API

DocumentBuilder incorpora header(cb|null), footer(cb|null), firstHeader(cb|null) y firstFooter(cb|null). La banda admite text(value,style?), row(options?,cb), grid({columns,gap?},cb) e image(bytes,opts).

text(({page,total}) => ...) recibe **cadenas token** cuyos valores reales resuelve Rust tras paginar. También se admiten {{page}}/{{total}} como texto low-level. Null oculta la banda elegida.

Ejemplo:
~~~ts
const pdf=await createVufra({font:regular,fonts:{bold}}).document({page:'Letter'})
  .header(h=>h.row(row=>{
    row.column({width:'40%'},c=>c.image(logo,{width:75,height:36}));
    row.column({width:'60%',align:'right'},c=>c.paragraph('ACME',{bold:true}));
  }))
  .firstHeader(h=>h.text('Portada corporativa',{bold:true}))
  .footer(f=>f.text(({page,total})=>'Página '+page+' de '+total))
  .firstFooter(null)
  .paragraph('Contenido profesional multipágina')
  .render();
~~~

## Comportamiento

Las bandas reutilizan PdfRow con fuentes auténticas, gráficos y PNG/JPEG. Márgenes crecientes automáticos antes de componer el cuerpo y paginación total calculada antes de dibujar los pies. Las dimensiones imposibles generan errores.

## Pruebas

- Rust: cargo fmt, cargo clippy, cargo test workspace.
- Native: bash scripts/build-native.sh.
- SDK: npm run build && npm test en packages/vufra.
- Especializadas: node --test tests/page-template.test.mjs.
- Ejemplo empresarial: node examples/fluent-page-templates.mjs FONT.ttf BOLD.ttf artifacts/fluent-page-templates.pdf.
- Evidencia PDF: pdfinfo, pdffonts, pdfimages -list, pdftotext -raw, bbox.

## Límites

Solo una fila/grid/texto/imagen por banda; sin paridad pares-impares, portada con tamaño independiente, SVG ni overlay sobre PDF base. El mayor alto de banda se reserva en todas las páginas.
