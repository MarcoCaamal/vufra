# ADR-0037 — Límites visuales reales frente a encabezados repetidos en cajas paginadas

**Fecha:** 2026-10-17 · **Estado:** implementado y comprobado localmente
**Unidad:** 36 · **Rama:** `feature/unit36-nested-box-continuation`
**Base:** Unidad35 `284581d` · `origin/main` `6399ebd`

## Contexto

Vufra ya soporta cajas decoradas (`box`), estilos reutilizables,
contenedores anidados, tablas con encabezados repetidos y paginación
del contenido en múltiples páginas. El código de renderizado construye
un árbol semántico y lo aplana a `LayoutNode` / `FlowBlock`.

Para dibujar un fragmento de caja, `PreparedBox::draw` recoge las
hojas reales de la página y, si está continuando una tabla, añade una
copia de la hoja correspondiente a su encabezado. El método
`draw_selected` empleaba **esta selección visual** para decidir
si una caja estaba en su primera o última página:

```rust
let first = leaves.first() == Some(&0);
let last = leaves.last().is_some_and(|v| v+1 == self.item_heights.len());
```

El primer cálculo confundía el encabezado de tabla **repetido**
(indice cero, pintado por presentación) con el **inicio real**
de la caja. En cada nueva página de esa tabla podía volver a
dibujarse el borde superior de la caja exterior y de sus cajas
anidadas. La repetición de un encabezado no significa que una
sección haya vuelto a empezar.

## Decisión

Separar dos nociones que antes compartían un mismo arreglo:

1. **Selección de pintura**: `leaves`, que contiene tanto las
   hojas reales como el encabezado repetido para dar contexto
   en una página de continuación.
2. **Segmento original**: `original: Range<usize>`, el rango
   de hojas del documento realmente consumidas en esa página,
   sin las repeticiones.

`PreparedBox::draw_selected` recibe ahora ambas. Se dibuja
el borde superior **solo** cuando existe contenido real y
`original.start == 0`; se dibuja el borde inferior **solo**
cuando el rango real alcanza el último elemento de la caja.
Los bordes laterales y el fondo siguen aplicándose **en
cada fragmento de página ocupado**, conservando su continuidad.

En cada `PreparedContent::Box` anidado, los límites reales
se intersectan con `flat_start..flat_end` y se traducen al
sistema de índices local del hijo; las hojas repetidas se
traducen independientemente para seguir pintando el header.

Esto mantiene tres invariantes:

- Un encabezado repetido **puede dibujarse** sin recrear
  un borde superior de ninguno de sus contenedores.
- Cada caja **se abre una sola vez y se cierra cuando termina**,
  aunque la caja que la contiene continúe durante otra página.
- `selection_height` continúa contando el tamaño real de
  las hojas de visualización y comprueba la concordancia con
  `FlowFragment::Box.height` (tolerancia 0,1pt). No se altera
  el paginador ni la ubicación del texto o de las imágenes.

## Experiencia del desarrollador

La API pública no cambia. El caso se expresa mediante las
mismas funciones y presets de la Fluent API:

```ts
document.box({preset:'panel'},outer=>{
  outer.box({preset:'section'},section=>{
    section.box({preset:'ledger'},content=>{
      content.table(rows,{columns});
    });
  });
  outer.paragraph('Observación final');
});
```

El autor no calcula alturas, posiciones o dónde pintar
el borde de una página intermedia.

No se implementó un parser CSS, una nueva modalidad de
documento, cachés ni funcionalidades de concurrencia.

## Evidencia visual mediante Poppler

Nuevo test `packages/vufra/tests/nested-table-borders.test.mjs`
con **dos pruebas de integración sobre PDFs reales**:

**Prueba de dos contenedores:** tabla de 110 operaciones
distribuida en al menos cuatro páginas. La prueba verifica
`pdftotext`, IDs ordenados, encabezado de tabla exactamente
una vez en cada página y muestras RGB mediante
`pdftoppm -r 72` en primera, intermedias y última página.

- Fondo exterior RGB `[238,244,255]` en cada continuación.
- Fondo interior RGB `[237,249,236]` en cada continuación.
- Bordes laterales RGB `[187,17,34]` y `[18,122,62]`
  pintados en cada página.
- Bordes horizontales superiores **solo** en la primera página.
- Bordes inferiores **solo** en la última página.
- Sin interpolación visual subjetiva: los píxeles concretos
  deben coincidir con esos valores en la posición de comprobación.

**Prueba de tres contenedores:** tabla de 85 operaciones y un
párrafo posterior que pertenece solo a la caja exterior.
Además de la integridad de registros y encabezados repetidos,
se verifican tres colores de fondo/borde distintos, aperturas
independientes y que la caja interior y la intermedia cierran
sus bordes en la última página con tabla, **antes** de que
la caja exterior termine en una página posterior con el texto
final. El encabezado de tabla no aparece en la página
que únicamente contiene el párrafo final.

El uso de `Map` local en los tests evita volver a rasterizar
el mismo PDF para cada píxel; esto es una optimización del test,
**no del renderer**.

## Ejemplo empresarial

`examples/fluent-nested-box-continuations.mjs` usa
regular/bold reales, tema cromático con presets, tres cajas
anidadas y una tabla de 165 operaciones con textos rich, bold
y fondos de celdas. La caja exterior también contiene una
observación final fuera de la tabla.

```bash
node examples/fluent-nested-box-continuations.mjs \
  REGULAR.ttf BOLD.ttf artifacts/fluent-nested-box-continuations.pdf
```

Resultado inspeccionado con Poppler: **11 páginas, 40.007 bytes,
165/165 referencias BILL_0001–BILL_0165 una sola vez y en orden**,
encabezado de empresa en 11 páginas, encabezado de tabla en
10 páginas que contienen datos, marcador de cierre una sola vez.

No se presenta la ruta en `artifacts/` del workspace
remoto como `sandbox:` del runtime local.

## Validación y límites

- `cargo fmt --all -- --check`: PASS
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`: PASS
- `cargo test --workspace`: **65 Rust (39 layout +26 PDF)** PASS
- `bash scripts/build-native.sh`: PASS
- `cd packages/vufra && npm run build && npm test`:
  **173 Node** PASS (171 anteriores +2 nuevas)
- `bash scripts/verify-experiments.sh`: **1.000 registros /29 páginas**,
  Unicode y orden íntegros.

No se alteran semántica de `keepTogether`, `breakBefore`,
tablas, fuentes ni lógica del paginador. Tampoco se
promete una mejora de tiempo/RSS sin benchmark.

El cambio es una corrección del diseño visual y de la
correspondencia entre layout y pintura, sin compatibilidad
con el comportamiento incorrecto del prototipo pre-v1.

**Entrega:** commit local, SDD y Obsidian; no push ni merge.
