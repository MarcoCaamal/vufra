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
