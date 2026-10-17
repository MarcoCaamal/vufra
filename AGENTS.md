# Vufra — reglas para contribuciones y asistentes

Vufra es un **experimento pre-v1**. El diseño de la API puede cambiar.

## Evolución de API

- **No añadir compatibilidad hacia atrás por defecto.** No crear alias,
  overloads, wrappers ni rutas “legacy” para preservar sintaxis experimental.
  Solo conservar compatibilidad si la persona responsable lo solicita
  explícitamente y documenta su justificación.
- Al reemplazar una API, **eliminar** la sintaxis vieja, los tipos y
  mapeadores asociados, rutas muertas, tests obsoletos y ejemplos rotos.
  Actualizar README, snippets NestJS y tests a la API nueva.
- La autoría pública de TypeScript es **Fluent y componible**,
  con encadenamiento y `.add(component)`; las tablas se crean
  exclusivamente con `.table(rows,{columns})`.
- Rust usa `SemanticDocument/ContentNode` como AST semántico owned y
  `LayoutNode` para paginar. Los tipos de dibujo Krilla/NAPI internos
  se mantienen solo mientras se utilicen realmente, no para compatibilidad
  con las APIs públicas experimentales.
- No introducir una segunda modalidad de documento, tablas simples
  paralelas ni una sintaxis especial distinta según el contenedor
  sin una decisión arquitectónica explícita.

## Calidad e invariantes

- Ejecución local obligatoria:
  `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
  `cargo test --workspace`,
  `bash scripts/build-native.sh`,
  `(cd packages/vufra && npm run build && npm test)`.
- Los PDFs de regresión se verifican por contenido extraíble,
  encabezados repetidos, fonts incrustadas, imágenes y, cuando
  aplique, píxeles reales de color con Poppler.
- La Fluent API es inmutable. `toDocument()` debe dar un snapshot
  independiente. Las colas deben aislar buffers/documentos de
  mutaciones de callers antes de encolar.
- No anunciar mejoras de rendimiento sin benchmark reproducible y
  comparable; distinguir JS heap, RSS y memoria nativa.
- Los registros de diseño están en `docs/adr/` y Obsidian. Las
  decisiones antiguas no definen la sintaxis actual.
- No hacer push, merge ni crear PR remoto sin indicación expresa.

## Licencia

Mantener la licencia dual `MIT OR Apache-2.0`.
