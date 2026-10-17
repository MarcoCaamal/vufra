# Vufra

**Motor experimental de PDFs**: un SDK Fluent en TypeScript que delega
la medición y el renderizado a Rust. Sin navegador headless, HTML/CSS
ni dependencia del motor Chromium.

> **Estado experimental — API inestable.** No se mantiene compatibilidad
> con la antigua sintaxis de arrays `paragraphs`/`rows` ni con las
> tablas de objetos. No se recomienda para producción antes de validar
> los casos de uso y límites del motor.

Licencia dual: **MIT OR Apache-2.0**.

## Qué permite construir

- Párrafos, headings, rich text con fuentes proporcionadas por el usuario,
  imágenes PNG/JPEG, divisores y rectángulos.
- Cajas decoradas, cajas anidadas y continuaciones entre páginas.
- Rows y grids, con columnas que pueden contener cajas, tablas o más grids.
- Tablas enriquecidas con color por celda, runs de distintas fuentes,
  imágenes y encabezados que se repiten después del salto de página.
- Header/footer reutilizables, número de página y total de páginas.
- PDF en Letter, A4 o dimensiones/márgenes personalizados.
- Renderizado sync, async con cancelación y una cola FIFO de trabajos.

El árbol semántico interno es `ContentNode` (owned, Rust). El
`LayoutNode` geométrico del crate `vufra-layout` calcula los fragmentos.
NAPI traduce los bloques del SDK al AST semántico; el dibujador
todavía emplea estructuras especializadas para las fuentes, filas,
geometrías y primitivas de Krilla.

## Sintaxis recomendada: Fluent + componentes

```ts
import {createVufra, box, paragraph} from 'vufra';

const vufra = createVufra({
  font: regularFontBytes,
  fonts: {bold: boldFontBytes},
  theme: {colors: {accent: '#204D88', soft: '#EDF4FC'}}
});

const TotalCard = (total: string) =>
  box({padding: 12, background: 'soft'}, [
    paragraph('Total'),
    paragraph(total, {bold: true, color: 'accent'})
  ]);

const pdf = await vufra.document({title: 'Factura', page: 'Letter'})
  .heading('Estado de cuenta')
  .paragraph('Resumen del periodo')
  .box({padding: 16}, content => content
    .image(logoPng, {width: 96, height: 48})
    .grid({columns: 2, gap: 12}, grid => grid
      .cell(cell => cell.paragraph('Entradas'))
      .cell(cell => cell.paragraph('Salidas'))
    )
    .table([
      ['INV-001', 'Servicio', '$250'],
      ['INV-002', {runs: [
        {text: 'Servicio ', bold: true},
        {text: 'premium', color: 'accent'}
      ]}, '$420']
    ], {columns: [
      {title: 'Folio', width: '25%'},
      {title: 'Detalle', width: '50%'},
      {title: 'Importe', width: '25%', align: 'right'}
    ]})
  )
  .add(TotalCard('$670'))
  .render();
```

La cadena Fluent se conserva; `.add()` inserta componentes reutilizables
y `.box()` recibe un callback de `ContentBuilder` o un componente
declarativo con hijos.

**Una sola API para tablas:** `.table(rows, {columns})` funciona en
la raíz, dentro de boxes y dentro de celdas. `rows` es un arreglo
de arreglos de celdas. No existen `.tableStyled()`, tablas inferidas
desde propiedades de objetos ni la vieja modalidad
`{paragraphs, rows, table}`.

## Desarrollo y verificación

Requisitos: Node.js 22+, Rust/Cargo, herramientas nativas de C/C++,
y para inspección local `pdfinfo`, `pdftotext`, `pdffonts`,
`pdfimages` y `pdftoppm` (Poppler). Las fuentes no se incluyen.

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
bash scripts/build-native.sh

cd packages/vufra
npm run build
npm test
```

Ejemplo funcional de facturas multipágina:

```bash
node examples/fluent-styled-tables.mjs \
  "$(fc-match 'Noto Sans' -f '%{file}')" \
  "$(fc-match 'Noto Sans:style=Bold' -f '%{file}')" \
  artifacts/fluent-styled-tables.pdf
```

Otros ejemplos activos: `examples/fluent-invoice.mjs`,
`fluent-panels.mjs`, `fluent-report.mjs`,
`fluent-page-templates.mjs`, `fluent-composition.mjs`,
`fluent-hierarchical.mjs`, `fluent-rich-pagination.mjs` y
`crates/vufra-pdf/examples/owned-semantic.rs` para la entrada nativa
directa desde Rust. `examples/nestjs/` muestra snippets de integración
con la cola, no una aplicación compilada.

`bash scripts/verify-experiments.sh` prueba experimentos históricos
de componentes Rust, **no** una API heredada del SDK.

## Arquitectura

| Crate o paquete | Responsabilidad |
|---|---|
| `packages/vufra` | Fluent, nodos funcionales, validación de entrada y cola |
| `bindings/vufra-node` | Paso de datos NAPI y trabajos nativos con cancelación |
| `crates/vufra-pdf` | AST semántico owned, shaping y pintura con Krilla |
| `crates/vufra-layout` | LayoutNode y paginación independiente del PDF writer |
| `experiments/` | Experimentos Rust no expuestos por el SDK |

La API del paquete npm **exporta solo Fluent, componentes y la cola**.
El normalizador NAPI y el modelo de dibujo son detalles internos que
pueden cambiar sin mantener adapters de compatibilidad.

### ADR y experimentos recientes

- [ADR-0020 — Fluent componible](docs/adr/0020-composable-fluent-and-unified-nodes.md)
- [ADR-0021 — Layout jerárquico](docs/adr/0021-hierarchical-layout-and-recursive-pagination.md)
- [ADR-0022 — Fragmentación rich](docs/adr/0022-shared-semantic-view-and-rich-cell-fragments.md)
- [ADR-0023 — AST semántico owned](docs/adr/0023-owned-semantic-ast-and-legacy-paint-adapters.md)
- [ADR-0024 — Limpieza incompatible y memoria](docs/adr/0024-breaking-cleanup-and-memory.md)

Estos ADR documentan las decisiones **en su momento**. Cuando mencionen
una sintaxis anterior, considérese histórica; solo este README y
`packages/vufra/README.md` describen la API actual.

## Limitaciones actuales

No hay soporte completo de bidi/RTL, SVG, rowspan/colspan,
universal PDF overlays ni fragmentación de objetos individuales que
no caben en una página. Un rich text puede dividirse entre líneas,
pero las imágenes indivisibles y encabezados excesivamente grandes
se rechazan explícitamente. Se aplican límites de profundidad,
tamaño de buffers y número de imágenes.

**No se entregan promesas de rendimiento** hasta medir workloads
repetibles. El experimento admite refactors que rompen APIs.

## Perfilado de memoria (Unidad 24)

El motor Rust ahora consume `SemanticDocument` **por valor** al llamar
a `render_semantic_pdf(document, font_bytes, options)`. El lowering
del árbol semántico al pintor no duplica los buffers de imágenes anidadas.
Los snapshots de la cola y de `toDocument()` se conservan.

Para medir el RSS máximo de todo el proceso Node con 450 filas,
24 imágenes y comprobación de los 450 identificadores:

```bash
node scripts/benchmark-native-memory.mjs REGULAR.ttf BOLD.ttf 3
```

Medición local: la mediana de RSS máxima pasó de **150,67 a
139,91 MiB** (−10,76 MiB, −7,1 %). No mide el allocator Rust aislado
ni garantiza este porcentaje en otras máquinas o cargas.
Detalles: [ADR-0025](docs/adr/0025-owned-render-memory-profile.md).

## Unidad 25: buffers de fuentes y filas fragmentables

Los bytes de cada fuente se comparten mediante `Arc<Vec<u8>>` entre
Krilla, Fontique y el verificador de glifos; las fuentes adicionales
se transfieren por valor. Al fragmentar filas largas, Vufra mueve
los ítems ya medidos hacia cada segmento, evitando una copia extra
de imágenes y rich text. La sintaxis Fluent pública no cambia.

```bash
node scripts/benchmark-font-rows.mjs REGULAR.ttf BOLD.ttf 3
```

En la muestra local de 2640 identificadores y 13 páginas, la mediana
de RSS máximo de tres procesos Node bajó de **93,39 a 89,64 MiB**.
Es un resultado de esta máquina/carga; no hay garantía global de
velocidad ni un pipeline completamente zero-copy.
Detalles: [ADR-0026](docs/adr/0026-shared-font-buffers-and-owned-row-fragments.md).

## Unidad 26: medir filas largas una sola vez

Al paginar una fila que excede la página, Rust reutiliza las líneas
y offsets de Parley ya medidos y las líneas `RichLine` con color y
fuentes reales. Los fragmentos `MeasuredTextLine` y
`MeasuredRichLine` son internos: la Fluent API no cambia.

El benchmark repetible `scripts/benchmark-font-rows.mjs` produjo
para ocho filas enriquecidas, 2.640 identificadores y 13 páginas
una mediana de **127,48 → 85,63 ms** de render en tres procesos
por versión. Es un resultado para esta carga, no un speedup general.
El pico de RSS fue prácticamente igual. Ver
[ADR-0027](docs/adr/0027-reuse-prepared-row-lines-for-pagination.md).

## Unidad 27: imágenes cacheadas en filas fragmentables

Las filas demasiado altas reutilizan el mismo objeto nativo
`PreparedImage` cuando se dividen en páginas. Solo se transfieren
la geometría de pintado y una referencia `Arc`: no se copian
los bytes comprimidos ni se parsea otra vez el PNG/JPEG.

```bash
node scripts/benchmark-fragmented-images.mjs REGULAR.ttf BOLD.ttf 3
```

En la carga sintética de 10 PNG y 4.200 tokens (40 páginas), la
mediana local de render bajó de **270,89 a 162,86 ms** y el
pico RSS de **121,14 a 117,08 MiB**. Ambas versiones produjeron
un PDF binariamente idéntico de 497.061 bytes. No es una promesa
de velocidad en todos los PDF.

La Fluent API y la protección de presupuestos siguen intactas.
Ver [ADR-0028](docs/adr/0028-cached-image-fragments.md).

## Unidad 28: buffers de fuentes owned entre NAPI y Rust

La API Rust consume `Vec<u8>` para la fuente principal y lo
comparte entre Krilla, Fontique y FontRegistry con `Arc<Vec<u8>>`,
sin duplicar esos bytes de nuevo dentro de Rust.

La copia inicial al recibir un Buffer desde JS **se conserva**:
los trabajos asíncronos necesitan aislar memoria JS modificable.
La cola conserva sus propios snapshots. No se hace zero-copy inseguro.

```bash
node scripts/benchmark-napi-font-ownership.mjs REGULAR.ttf BOLD.ttf 3
```

El benchmark utiliza una TTF válida rellenada artificialmente a
10 MiB para medir las copias; no simula 10 MiB de glifos complejos.
Se observó maxRSS de 136,46 → 116,52 MiB con ese payload y
136,57 → 133,63 MiB en el control con fuente normal y 24 PNG.
Estos resultados no garantizan aceleración general.

Detalles: [ADR-0029](docs/adr/0029-owned-font-buffer-and-safe-napi-snapshots.md).
