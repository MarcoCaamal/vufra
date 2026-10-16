# Unidad 02 — SDK Node.js / TypeScript y API Rust (2026-10-16)

**Hito alcanzado: primer paquete TypeScript local funcional, puente NAPI-RS compilado y PDF comprobado.** No publicado y API aún experimental.

## Construido

- Crate `vufra-pdf` (`render_pdf`, `PdfDocument`, `RenderOptions`, `RenderError`) con entrada y salida en memoria.
- Parley 0.12 mide y divide cada entrada en líneas según el ancho usando **la fuente registrada explícitamente**. Se evita depender de las fuentes instaladas en la máquina para decidir métricas.
- Krilla 0.8.2 integra y dibuja los textos (sólo validado para Latin/español). El `draw_text` de krilla no proporciona shaping complejo ni soporte bidireccional garantizado.
- `vufra-layout` devuelve intervalos paginados (`BreakToken`) de bloques medidos; cada fila o párrafo es indivisible, pero puede contener varias líneas.
- Binding nativo `vufra-node`, con `napi` 3 y `napi-derive`, expone `renderPdfNative`.
- Paquete TypeScript `packages/vufra` con `renderPdf(document, fontData)` y tipos exportados. Devuelve bytes PDF (`Buffer` en Node).
- Script para compilar y copiar el addon de Linux/macOS a `packages/vufra/native/vufra.node`.
- Tests JavaScript con `node:test` y Poppler (sin mock del motor Rust).

## Evidencias de la ejecución local

- `npm run build` generó JavaScript + declaraciones `.d.ts` desde TypeScript.
- `bash scripts/build-native.sh` compiló la biblioteca nativa en modo release (Linux x86_64).
- `npm test`: **5/5**:
  - PDF multipágina y extracción de texto español con símbolos.
  - **1,000 registros** en orden mediante extracción Poppler.
  - Validación de título, fuente y tipos.
  - Rechazo explícito de una fila demasiado larga para la página.
  - Rechazo explícito de títulos demasiado anchos y contenido indivisible demasiado largo.
- `examples/sdk-usage.mjs` produjo `artifacts/sdk-first.pdf`: **32 páginas, 44,467 bytes** en la corrida observada.
- Primera página renderizada con pdftoppm, inspección visual satisfactoria de salto de línea, encabezado, pie y filas.
- `npm pack` incluyó JS, declaraciones TypeScript y binario nativo. El archivo `.tgz` se instaló en un proyecto Node separado y produjo un PDF válido de una página con texto Unicode: prueba de distribución **local**, no publicación.
- CI configurada para compilar y probar Rust y Node en Linux; todavía no ha corrido remotamente en GitHub Actions.

## Ejemplo mínimo

```ts
import { renderPdf } from 'vufra';
import { readFileSync, writeFileSync } from 'node:fs';

writeFileSync('documento.pdf', renderPdf({
  title: 'Hola Vufra',
  paragraphs: ['¡Hola, Cancún!'],
  rows: ['Primera fila', 'Segunda fila']
}, readFileSync('/ruta/a/NotoSans-Regular.ttf')));
```

## Restricciones de diseño

- A4 595x842 pt fijo. Texto 11pt y línea 16pt configurados internamente; por ahora sin tema ni estilos.
- El contenido se representa como párrafos (en orden) seguidos por filas (en orden); no hay DSL ni AST jerárquico completo.
- Fuente TTF/OTF suministrada en bytes; sin bundling de fuentes ni búsqueda en el OS. Se recomienda fuente con glifos del texto.
- Las entradas se limitan para evitar PDFs enormes accidentales (≤10,000 filas, ≤1,000 párrafos y ≤4 MiB de texto; fuente ≤20 MiB).
- Cada fila/párrafo supera el tamaño disponible => error controlado, no paginación dentro de la fila.
- No se han integrado el shaping avanzado de Parley y la colocación de glifos de Krilla; hoy Parley decide los saltos de línea y Krilla dibuja cada línea. RTL/árabe, emojis y fallback siguen sin validación.
- El motor construye el PDF completo en memoria, no streaming todavía.
- No hay publicación npm/crates ni matrices de binarios multiplataforma. El empaquetado es local.

## Próxima unidad recomendada

1. Asegurar contrato de estilo/página y layout de bloques con separación real del writer; pruebas de overflow de palabras largas.
2. Gestionar fragmentación dentro de filas y celdas, nested layout y cabeceras de tabla reales.
3. Integrar shaping Parley -> glyph rendering Krilla, font fallback y bidi, antes de prometer texto complejo.
4. Binarios multiplataforma precompilados, npm package publicable, CI de release, benchmarks.
5. Confirmar API estable antes de SemVer de producción.
