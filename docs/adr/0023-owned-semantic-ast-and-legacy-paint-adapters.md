# ADR-0023 — AST semántico owned como contrato interno (Vufra Unidad 22)

Fecha: 2026-10-17. Estado: implementado en rama local, sujeto a verificación completa.

## Contexto

Las unidades 17–21 construyeron una Fluent API consistente, un paginador de
geometría Rust basado en `LayoutNode`, y una vista semántica *prestada*
(`SemanticNode<'a>`) para validar recursos de documentos, boxes y filas.
No había una representación semántica **owned** común para el contenido antes
del proceso de renderizado: los datos se expresaban como `PdfBlock`,
`PdfBoxItem` o `PdfRowItem` según el contenedor.

Se requería un verdadero árbol semántico nativo, sin romper las entradas
Rust y NAPI/TS del motor ya probadas ni duplicar motores de pintura.

## Decisión

**El contrato semántico interno canónico pasa a ser
`ContentNode`, recursivo y owned, en `vufra-pdf/src/semantic.rs`.**

`ContentNode` cubre `Text { text, presentation }` para texto normal,
heading y styled, `Rich` con fuentes/color/keepWithNext,
`Image`, `Graphic`, `Spacer`, `Row { columns: Vec<ContentColumn> }`,
`Box { frame: ContentFrame, children: Vec<ContentNode> }`,
`StyledTable { header: Box<ContentNode>, rows: Vec<ContentNode>, fills }`,
`PlainTable { columns, rows: Vec<Vec<ContentNode>> }`,
`List { items: Vec<ContentNode> }`, `PageBreak` y línea rich interna ya
medida con índices de fuentes encapsulados.

### Pipeline real

```text
DocumentBuilder Fluent TS
   → PdfDocument/PdfBlock (NAPI y Rust legacy compatible)
   → ContentNode (AST Rust OWNED)
   → SemanticBudget, validación estructural/contextual
   → lowering checked a los adaptadores de pintado
      PdfBlock/PdfBoxItem/PdfRowItem
   → LayoutNode geométrico Rust (Unidad 20)
   → paginador por fragmentos y Krilla
   → PDF final
```

La entrada `render_flow` SIEMPRE normaliza antes de validar/paginar y luego
solo utiliza las estructuras antiguas **como adaptadores del renderer**.
Se añadió `render_semantic_pdf(&SemanticDocument, font, options)`, una API
Rust pública para crear documentos directamente sobre `ContentNode`
sin pasar por TS ni construir `PdfBlock` manualmente. Utiliza el mismo
proceso de validación/medición y la misma ruta de renderizado, sin hacer
round-trip por el documento legacy.

Las conversiones de `PdfBlock`, `PdfBoxItem`, `PdfRowItem`, `PdfBox`
y `PdfRow` hacia `ContentNode` mantienen ancho, padding, fill, border,
control de páginas, columnas, estilos, imagen y runs. El lowering inverso
es **fallible** (`TryFrom`) y rechaza explícitamente nodos no soportados
en el contexto. Así evita degradación silenciosa de estilos: un
`keep_with_next=true` dentro de un Box/Row, `PageBreak` dentro de Row
o Rich/Styled dentro de una tabla simple no se ignoran.

La pasada `SemanticBudget` anterior deja de depender del trait prestado
`SemanticView`: opera únicamente sobre `ContentNode` y recorre
recursivamente sus columnas, cajas, tablas, listas e imágenes. Los
presupuestos, niveles de anidación, reglas de fuentes y límites nativos
anteriores se mantienen. Los boxes y filas preparados siguen usando
su shaping y dibujo Krilla/Parley probados, mediante adaptadores.

## Ejemplo Rust

```rust
let mut doc = SemanticDocument::new("Factura");
doc.page = Some(PageGeometry::letter());
doc.nodes.push(ContentNode::paragraph("Folio 001"));
doc.nodes.push(ContentNode::boxed(
    ContentFrame { padding: 16.0, ..ContentFrame::default() },
    vec![ContentNode::styled_text("Total $125", TextStyle::paragraph())],
));
let pdf = render_semantic_pdf(&doc, font_bytes, RenderOptions::default())?;
```

`crates/vufra-pdf/examples/owned-semantic.rs` amplía este uso con una imagen,
box estilizada, tabla rich que continúa páginas, filas multicolumna, tabla
simple y lista. El ejemplo no utiliza navegador ni Node.

## Compatibilidad y límites deliberados

- Se conservan `PdfBlock/PdfBoxItem/PdfRowItem` públicos como **wire/paint
  adapters**. Es una consolidación **de modelo semántico de entrada**,
  no la eliminación de los tipos internos del dibujador. El renderer de
  Krilla todavía requiere los prepared item types por layout,
  especialmente las líneas rich con índices de fuentes reales.
- `LayoutNode` del crate `vufra-layout` permanece como AST **geométrico**,
  diferente del semántico y responsable del paginado. No se pretende que
  un AST semántico sea también un árbol de medidas ni viceversa.
- Los fragmentos rich medidos se mantienen como tipo interno sin
  constructor público de índices/font handles. La nueva API no expone
  estas estructuras.
- `PlainTable` solo permite nodos de texto plano en sus celdas:
  estilos ricos pertenecen a `StyledTable`; una conversión inválida
  devuelve error y nunca descarta colores o atributos.
- No se implementa cursado independiente de columnas, rowspan/colspan,
  bidi/RTL general ni cortes de imágenes/bloques indivisibles gigantes.
  Todos los límites de profundidad/bytes/píxeles y el presupuesto
  de 500 fragmentos por fila siguen vigentes.
- Un `ContentNode` owned requiere clonar algunas cadenas y bytes al
  normalizar la entrada legacy. Es un compromiso temporal de compatibilidad.
  Posibles optimizaciones futuras: entrada nativa por valor, `Arc` para
  datos grandes y eliminar gradualmente los adapters del painter cuando
  sea seguro. No se promete un ahorro de RAM no medido.

## Verificación

Tests Rust: round-trip de los 12 tipos de bloque root, preservación de
configuración anidada/bordes/alineación, error en contextos no válidos,
normalización de listas y tablas simples; compilación del ejemplo público.

Tests PDF con `cargo run -p vufra-pdf --example owned-semantic`:
PDF Letter de varias páginas, glifos y fonts reales embebidos, encabezado
de tabla repetido, imagen PNG, texto rich y todas las fichas exactas.

Suite NAPI/TypeScript 127+ pruebas heredadas, pruebas Rust completas,
cargo fmt/clippy, script de 1000 filas, `pdfinfo`, `pdffonts`,
`pdftotext`, `pdfimages` para confirmar salida e invariantes.

No hacer push ni merge por esta implementación; rama de Unit22 apilada
sobre Unit17–21.
