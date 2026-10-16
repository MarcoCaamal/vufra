# Vufra 🦀

Motor PDF **open source** escrito en Rust. Incluye un **SDK experimental para Node.js/TypeScript** que llama al motor Rust mediante N-API, sin Chromium ni HTML.

> **Estado actual: prototipo funcional (2026-10-16).** El API y el empaquetado todavía no son estables ni adecuados para producción. Nada está publicado en npm o crates.io.

## ¡Ya puedes generar documentos con TypeScript!

```typescript
import { renderPdf } from 'vufra';
import { readFileSync, writeFileSync } from 'node:fs';

const font = readFileSync('/ruta/a/NotoSans-Regular.ttf');
const bytes = renderPdf({
  title: 'Reporte de ventas',
  paragraphs: ['¡Hola, Cancún! Documento generado desde Rust y Node.js.'],
  rows: Array.from({ length: 1000 }, (_, i) => 'Registro ' + (i + 1))
}, font);

writeFileSync('reporte.pdf', bytes);
```

La API Rust subyacente vive en `crates/vufra-pdf`: `render_pdf(&PdfDocument, &[u8], RenderOptions)`.

### Iniciar en el workspace

Requisitos: Rust **1.92**, Node.js **20+**, npm, compilador de Rust/C disponible, fuente TTF/OTF propia y Poppler para pruebas PDF.

```bash
# Desde la raíz de Vufra
bash scripts/build-native.sh
cd packages/vufra
npm ci
npm run build
npm test
cd ../..

# Crear un ejemplo de 1,000 registros
FONT=$(fc-match 'Noto Sans' -f '%{file}\n' | head -1)
node examples/sdk-usage.mjs "$FONT" artifacts/sdk-first.pdf
pdfinfo artifacts/sdk-first.pdf
```

El archivo generado es `artifacts/sdk-first.pdf`; se ignora en Git. **La fuente la proporciona el usuario**; no empaquetamos ni redistribuimos fuentes externas.

## Hitos

| Unidad | Hito | Estado |
|---|---|---|
| 00 | Diseño y decisiones del proyecto | Completada |
| 01 | Prototipos `pdf-writer`, `krilla`, Parley y tablas 1,000 filas | Completada |
| 02 | API Rust reusable, texto medido con Parley, SDK TypeScript + N-API | Prototipo funcional |
| 03 | Composición compleja, tablas multi-columna, fragmentación y más opciones | Pendiente |
| Más adelante | Bindings multiplataforma, publicaciones, estabilidad | Pendiente |

## Arquitectura implementada

```text
packages/vufra/src/index.ts   SDK TypeScript (validación y tipos)
             │
             ▼
bindings/vufra-node            API nativa con NAPI-RS
             │
             ▼
crates/vufra-pdf               Composición y escritura PDF con Krilla
           │       │
     Parley       vufra-layout  -> BreakToken
                      │
                  vufra-core

experiments/sp-01-*            Comparación de escritores (Unidad 01)
experiments/sp-02-parley       Medición aislada (Unidad 01)
experiments/sp-03-pagination   PDF de 1000 filas (Unidad 01)
```

## Calidad y límites

Ejecutar:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
bash scripts/verify-experiments.sh
cd packages/vufra && npm test
```

La Unidad 02 comprobó texto en español, párrafos con ajuste de línea, 1,000 registros ordenados sin pérdida/duplicación, PDFs multipágina y errores de entrada controlados.

**No soporta aún:** contenido RTL/shaping complejo, fallback de fuentes, imágenes, tablas multi-columna, estilos arbitrarios, división de una sola fila entre páginas o formatos de página configurables. Cada fila/paragraph es indivisible al paginar; demasiadas líneas generan un error explícito. El SDK actual se ha probado únicamente en Linux x86_64.

## Documentación

- [Plan de W0](docs/planning/01-w0-workspace.md)
- [Arquitectura conceptual](docs/architecture/overview.md)
- [Resultados de Unidad 01](docs/experiments/02-results.md)
- [Resultados y guía Unidad 02](docs/experiments/03-sdk-milestone.md)
- [ADR-0001 Licencia](docs/adr/0001-license.md)
- [ADR-0002 Monorepo](docs/adr/0002-monorepo.md)
- [ADR-0003 Writer PDF y SDK Node](docs/adr/0003-prototype-pdf-and-node.md)
- [Paquete TypeScript](packages/vufra/README.md)

## Licencia

**MIT OR Apache-2.0**. Textos en [LICENSE-MIT](LICENSE-MIT) y [LICENSE-APACHE](LICENSE-APACHE).
