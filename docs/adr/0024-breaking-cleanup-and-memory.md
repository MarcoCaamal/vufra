# ADR-0024 — API experimental sin compatibilidad y limpieza de código

**Fecha:** 2026-10-17. **Estado:** implementada localmente.
**Unidad:** 23. **Modalidad:** ruptura deliberada, sin wrappers deprecados.

## Razón

Vufra todavía no tiene una versión estable. Las Unidades 1–22 construyeron
prototipos y dejaron tres maneras de construir tablas y dos caminos Rust para
renderizar contenido. Cada camino extra cuesta mantenimiento, complejidad
de NAPI, documentación confusa y copias.

**Decisión:** no conservar compatibilidad con APIs experimentales. Eliminar
sintaxis y código que no forman parte del modelo Fluent + ContentNode owned.

## Cambios deliberadamente incompatibles

- TypeScript: única llamada pública de tablas `.table(rows,{columns})`
  para documento y contenedores, así como función `table(rows,options)`.
  Eliminar `.tableStyled()`, `TableOptions<T>`, `TableColumn<T>`,
  `asTable` y mapeo automático de propiedades de objetos.
- Única autoría pública npm: `createVufra`, `Vufra`,
  `DocumentBuilder`, `ContentBuilder`, helpers `paragraph`,
  `heading`, `image`, `box`, `flow`, `table`, `column`,
  `row`, `grid` y `PdfRenderQueue`. El módulo de normalización
  `renderer.ts` es **interno**, no exportado como subpath npm. La
  cola puede aceptar documentos internos con `blocks` porque así
  implementa `.enqueue(queue)`, pero el uso recomendado externo
  sigue siendo Fluent.
- El documento interno requiere `blocks`, no `paragraphs`,
  `rows`, ni `table` de raíz. NAPI recibe únicamente
  `title,blocks,font,page,fontFaces,chrome` (más token async).
- Rust: eliminar el `PdfDocument` anterior, su renderer de páginas
  independiente, sus validaciones y constantes, la vieja tabla
  `PdfBlock::Table` y `crates/vufra-pdf/src/table.rs`.
  El nuevo `SemanticDocument` owned y `render_semantic_pdf`
  (con variante cooperativa de cancelación) son las únicas entradas.
  `ContentNode::PlainTable` también se elimina; la tabla enriquecida
  es la única representación.
- Eliminar `FlowBlock::Table`, `FlowFragment::Table` y sus
  tests específicos del paginador antiguo. Las tablas nuevas siguen
  modeladas como `LayoutNode::RepeatTable` y `PdfBoxTable`.
- Eliminar cinco conversores borrowed `From<&PdfBlock/Box/Row/...>`
  ahora innecesarios, dejando los conversores owned que consumen
  los buffers. Los tipos de pintado `PdfBlock/PdfBoxItem/PdfRowItem`
  **sí siguen existiendo** porque son usados por Krilla/NAPI, no para
  ofrecer compatibilidad de sintaxis.
- Eliminar doce ejemplos ejecutables con la API obsoleta, reescribir
  los README y modernizar el snippet NestJS. ADR históricos quedan
  como registro, no como instrucciones de uso vigente.

## Memoria y medición

**Sin comprometer la seguridad frente a mutaciones externas:**

1. `DocumentBuilder` aún copia buffers cuando recibe datos de callers
   y mantiene inmutabilidad entre ramificaciones de la cadena.
2. `.render()` y `.renderSync()` utilizan `renderInput()` interno:
   ya no crean `structuredClone(this.toDocument())` cada vez.
   `.toDocument()` es una copia profunda explícita, segura.
3. La cola `PdfRenderQueue` sigue clonando cada input al admitirlo,
   necesaria para su garantía de snapshot/FIFO.
4. NAPI convierte `Vec<PdfBlock>` a `Vec<ContentNode>`
   **consumiendo** los bloques con `into_iter().map(ContentNode::from)`
   sin volver a copiar los bytes de imágenes en ese paso.
5. Ni Rust ni NAPI son totalmente zero-copy. La frontera JS/Buffer →
   Vec nativo y el lowering a estructuras de dibujo Krilla
   pueden seguir realizando copias. No afirmar lo contrario.
6. Bench reproducible `scripts/benchmark-fluent.mjs` mide
   `builderMs`, `builderHeapDeltaBytes`, mediana de 5 renders
   ya calientes y mediana de 5 snapshots explícitos.
   Un resultado local: **350 filas, PDF 59 225 B, 6,50 ms construcción,
   +1 882 392 B heap, 84,85 ms mediana renderSync, 3,77 ms
   mediana snapshot explícito**. Estos números NO son speedup
   respecto a un commit anterior y dependen del hardware/entorno.
   La columna de memoria es JS heap, NO pico total de RSS nativo.

## Pruebas y alcance

Se preservan las pruebas de funcionalidades actuales y se reescriben
las pruebas de viejas tablas/mode SDK para usar `createVufra`.
Se mantienen pruebas internas del normalizador y puente nativo de
manera aislada, pero no se exportan sus interfaces como API npm.
Tests explícitos confirman que `renderPdf` y `tableStyled` ya no
se exportan, que `vufra/renderer` no puede importarse por subpath,
y que `toDocument()` continúa aislando mutaciones.

No implementar rowspan/colspan, SVG, RTL completo, corte de imágenes
gigantes, ni cursores de columna independientes en esta unidad.

## Rollout

Cambio **solo local** en `feature/unit23-breaking-cleanup-and-memory`,
apilado sobre las Unidades 17–22. Sin push/merge/CI remoto hasta
indicación del usuario. Los cambios tocan múltiples módulos y reescriben
documentación/tests; se requiere revisión explícita si se crean PRs.
