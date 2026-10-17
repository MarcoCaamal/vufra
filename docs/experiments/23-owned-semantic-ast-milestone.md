# Unidad 22 — AST semántico Rust owned

**Fecha:** 2026-10-17. **Estado:** implementación local.

## Entregado

- `ContentNode` owned y recursivo, único modelo semántico de entrada
  nativo para texto, rich, imágenes, gráficos, boxes, rows, tablas
  simples/enriquecidas, listas y saltos de página.
- `ContentFrame`, `ContentColumn`, `ContentTableColumn`,
  `TextPresentation`, `SemanticDocument` para modelar jerarquía
  y estilos con metadata compatible.
- `From` adapters desde `PdfBlock/PdfBoxItem/PdfRowItem` de
  entrada histórica y `TryFrom` de vuelta para el dibujador, con
  errores explícitos si la conversión perdería una capacidad.
- Todo `render_flow` primero normaliza el contenido y valida el AST
  owned; solo entonces crea adaptadores para Krilla. El pipeline
  geométrico de Unidad20 sigue haciendo paginación recursiva.
- API pública `render_semantic_pdf` para construir PDF directamente
  con nodos owned desde Rust. Flutter-like composability y TypeScript
  Fluent siguen funcionando sin cambios.
- `SemanticBudget` ya solo recorre `ContentNode`, unificando cuentas
  recursivas y seguridad de contenido; sin acceso de escritura de fuente
  artificial en los rich spans pre-medidos.

## Ejemplo y pruebas

`cargo run -p vufra-pdf --example owned-semantic -- REGULAR.ttf BOLD.ttf OUTPUT.pdf`.

Pruebas cargo Rust y suites npm anteriores; validar PDF con
`pdfinfo`, `pdffonts`, `pdftotext`, `pdfimages`. La geometría de
cajas, tablas, fondos, fuentes y paginación debe coincidir con
el renderizador legado.

## Limitaciones

Los tipos de **pintura/prepared input** específicos permanecen como
adaptadores públicos para mantener compatibilidad, no como fuente
semántica independiente. Esto completa la convergencia del **modelo de
contenido de entrada**, no un único renderer/painter interno.
No se agregan rowspan/colspan, fragmentación de imágenes grandes,
cursos independientes por columna ni RTL completo. Normalización
legacy a AST owned puede clonar cadenas e imágenes.
