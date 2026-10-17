# ADR-0035 — Grid autoajustable y separación vertical explícita

**Fecha:** 2026-10-17 · **Estado:** implementado y verificado localmente
**Unidad:** 34 · **Rama:** `feature/unit34-auto-flow-grids`
**Base:** Unidad33 `e9b409a` · `origin/main` aún `6399ebd`

## Problema de autoría

La Fluent API ofrecía desde Unidad32 un número fijo de columnas
o tracks explícitos en puntos, porcentajes y `fr`. Es útil cuando
el diseño exige proporciones concretas, pero para una colección
variable de tarjetas el autor todavía debía decidir cuántas
cabían dentro de la página, una caja con padding o un componente
anidado y calcular la separación vertical.

Vufra **ya prepara y pagina** filas de alturas naturales en Rust.
Por ello no hace falta crear otro motor de medición ni calcular
alturas en TypeScript.

## Contrato nuevo en el mismo `grid`

```ts
report.grid({
  columns:{minWidth:150,maxColumns:3},
  gap:12,
  rowGap:16
},grid=>{
  for(const item of metrics)
    grid.cell(c=>c.box({preset:'card'},b=>
      b.heading(item.title).paragraph(item.value)));
});
```

`AutoGridColumns` es un objeto con `minWidth:number` obligatorio
y `maxColumns?:number` opcional (predeterminado: seis).
`GridOptions.columns` ahora acepta un número, arreglo de
`GridTrack` o `AutoGridColumns`, **sin otra función o sintaxis**.
`GridOptions.rowGap?:number` añade separación **solo entre**
filas, nunca después de la última.

En su interior, `resolveGridTracks(options,availableWidth)` es
la **única** función que resuelve los anchos para `ContentBuilder`
y `PageBandScope` en raíz, boxes anidadas y componentes funcionales.

### Reglas geométricas

- El ancho se obtiene del contenedor real (página menos márgenes,
  o caja menos padding); se mantiene el mínimo estructural de 60pt.
- `minWidth` debe ser finito y al menos 60pt. Es un mínimo **real**,
  no una sugerencia que el motor ignore.
- `maxColumns` debe ser entero entre 1 y 6. Valor por omisión 6.
- `gap` y `rowGap` deben ser finitos y entre 0 y 80pt.
- Si el ancho del contenedor es menor al `minWidth`, la
  composición falla tempranamente; no recorta el contenido.
- El número de columnas es
  `min(maxColumns, floor((width+gap)/(minWidth+gap)))`.
  Repartimos el ancho utilizable después de los gaps **por igual**.
- El cálculo es determinista: no se depende de conocer qué
  tarjetas llegarán ni de usar CSS/masonry/DOM.
- Los componentes se asignan en orden de lectura **fila por fila**.
  La fila final puede tener espacios vacíos sin inventar contenido.
- Cada fila conserva la altura de su columna más alta,
  según el paginador Rust existente. `rowGap` produce
  `Spacer` nativo **entre** filas y nunca después del grid.
- Los grids de `header/footer` solo contienen una fila:
  se rechaza `rowGap>0` en ese contexto en vez de ignorarlo,
  y el número de celdas debe coincidir con las columnas
  resueltas.

No se introduce una API paralela `autoGrid`. Tampoco
hay masonry, reordenamiento de contenido, `rowspan`,
`colspan`, media queries ni ruptura del orden de lectura.

## Resiliencia y legibilidad

Se aprovecha la misma ruta ya probada de
`GridScope` → `compileColumnItems` → `PdfRow` →
paginación nativa. Para espaciar, se reutiliza
`PdfBlock::Spacer` / `PdfBoxItem::Spacer` existentes,
sin modificar el motor Rust ni su algoritmo de fragmentación.

Un componente de tarjeta puede contener más texto que otro,
incluso tablas, imágenes o cajas anidadas que el layout soporte;
Vufra calcula la altura natural del renglón. Los presupuestos
de geometría y contenido de Rust siguen vigentes y un
elemento físicamente imposible continúa devolviendo error,
en vez de silenciar clipping.

Los parámetros inválidos o claves desconocidas en el objeto
auto producen `TypeError('Vufra: grid ...')` antes de
preparar el documento. No se añaden alias ni compatibilidad
pre-v1.

## Regresiones verificadas

`packages/vufra/tests/auto-grid.test.mjs` añade siete pruebas
con PDFs reales y posiciones `pdftotext -bbox`:

1. Letter con `minWidth:150,gap:12` utiliza tres columnas
   de ≈163,33pt; cinco celdas → dos filas; el AST incluye
   exactamente un `Spacer` intermedio de 16pt.
2. El mismo grid dentro de caja más estrecha pasa a dos columnas.
3. Caso límite: contenido de 311pt no admite dos columnas de
   150pt+gap12, pero 312pt sí las admite exactamente.
4. Alturas naturales desiguales y `rowGap:24`: posición
   vertical de la siguiente fila se mueve ≈24pt, sin
   solaparse con la tarjeta más alta.
5. Uso en page band con columnas automáticas; rowGap>0
   en page band es error explícito.
6. Invalidación temprana de tamaños cero, pequeños, infinitos,
   maxColumns no entero/invalidado, gaps negativos o
   mayores de 80 y claves de auto desconocidas.
7. 62 tarjetas de tamaño de texto variable paginan sin
   IDs perdidos, preservan orden y repiten encabezado.

## PDF empresarial demostrativo

`examples/fluent-auto-flow.mjs` combina lo anterior con
presets de Unidad33, un panel secundario estrecho, 37 KPI
de alturas variables, un `header` autoajustable y tabla
de 175 transacciones.

```bash
node examples/fluent-auto-flow.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-auto-flow.pdf
```

Salida comprobada mediante Poppler:
**13 páginas, 47.313 bytes; 37/37 KPI y 175/175
transacciones únicos y ordenados**, `AUTO_LAYOUT_REPORT`
en las 13 páginas, `PANEL_A` y `PANEL_B` una sola vez.

El archivo está en el workspace remoto y no se debe
fingir un enlace `sandbox:` local.

## Alcance de calidad

- Mantener `cargo fmt`, `cargo clippy -D warnings`,
  57 pruebas Rust, addon NAPI y suite Node.
- `scripts/verify-experiments.sh` conserva
  1.000 registros, 29 páginas y Unicode ordenado.
- No tocar concurrencia, cachés o micro-optimizaciones.
- No implementar un navegador ni reinterpretar CSS Grid.
- Priorizar experiencia del autor, validación,
  rendimiento práctico y confiabilidad del layout.

**Entrega:** commit local y documentación en Obsidian.
No push, merge ni PR remoto.
