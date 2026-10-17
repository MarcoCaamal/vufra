# ADR-0033 — Grid con pistas fr, porcentajes y puntos en la Fluent API

**Fecha:** 2026-10-17
**Estado:** implementado y verificado localmente
**Unidad:** 32
**Rama:** `feature/unit32-grid-fractional-tracks`
**Base:** Unidad31 `cdaa6c6`; `origin/main` continúa `6399ebd`.

## Contexto

Vufra tiene un motor nativo de filas, cajas anidadas, paginación
y tablas complejas. Sin embargo, la Fluent API de `grid` únicamente
permitía declarar un número de columnas de igual tamaño:

```ts
.grid({columns:3,gap:12},grid=>{ /* tres pistas iguales */ })
```

Para paneles visuales con una tarjeta de resumen ancha junto a una
tarjeta estrecha, los autores debían recurrir al builder `row`
y calcular anchos manualmente. La experiencia no era tan cómoda
como los layouts habituales de las interfaces web.

## Decisión: evolucionar la misma API Grid

La opción `columns` ahora acepta también una lista tipada de pistas:

```ts
.grid({columns:['2fr','1fr'],gap:12},g=>{
  g.cell(c=>c.heading('Ventas').paragraph('MXN 842,560'));
  g.cell(c=>c.heading('Pedidos').paragraph('1,240'));
});
```

El tipo exportado públicamente `GridTrack` admite:

- Número positivo, en puntos PDF: `120`
- Porcentaje positivo del ancho utilizable: `'30%'`
- Parte flexible con peso positivo: `'2fr'`, `'1fr'`, `'0.5fr'`
- `'*'`: equivalente a `'1fr'`
- `columns:3`: tres pistas iguales, ahora resueltas con el mismo
  algoritmo que las pistas explícitas

No se añade `css()`, `gridTemplateColumns()`, un motor CSS ni otra
API de autoría. Se conserva la composición con `grid(...)`, sus
`cell(...)`, `.add(grid(...))` y el chaining Fluent actual.

## Modelo de medición y layout

Una función TS única, `resolveGridTracks(options,width)`, prepara
el tamaño de las columnas **antes** de construir el árbol de filas
que ya consume Rust. Se usa en tres contextos:

1. Cuerpo del documento
2. Box anidados y componentes reutilizables
3. Header y footer mediante `PageBandScope.grid`

Algoritmo:

1. Comprueba número de pistas 1..6, ancho disponible válido y
   `gap` finito de 0..80pt.
2. Ancho utilizable = ancho del contenedor − `gap × (n−1)`.
3. Reserva los puntos fijos y los porcentajes calculados
   sobre el ancho utilizable (igual que `RowOptions.width`).
4. Distribuye el remanente según pesos fr:
   `width_i = fixed_i + remainder * fr_i / sum_fr`.
5. Valida que ninguna columna sea menor de 60pt, que los anchos
   sean finitos y que no excedan el contenedor.

Si no hay pistas fr, el espacio restante puede quedar vacío a la
derecha; las pistas fijas no se estiran artificialmente.
La última fila de grid puede tener menos celdas que columnas;
los huecos restantes quedan vacíos sin ocultar los contenidos
anteriores.

Una configuración imposible falla de forma temprana con
`TypeError('Vufra: grid ...')`, antes de empezar el renderizado
nativo, incluyendo `0fr`, tamaños no finitos, anchos excesivos,
porcentajes de cero o sobreasignados, demasiadas columnas,
gap inválido, grids vacíos y columnas finales menores de 60pt.

El resultado es el mismo `PdfRow` interno que existía antes, sin
cambios en la lógica Rust, saltos de página o copia de recursos.
No se añade compatibilidad con sintaxis antigua: la opción numérica
actual y la lista nueva son dos modos del mismo contrato de `grid`.

## Evidencia funcional y geométrica

Se añadieron seis pruebas en
`packages/vufra/tests/grid-tracks.test.mjs`:

- `2fr/1fr` coloca palabras de cada columna en coordenadas físicas
  esperadas, verificadas con `pdftotext -bbox` y tolerancia de 3pt.
- Mezcla `[100,'30%','2fr']` en una caja de ancho 440pt y padding
  20pt; se valida el comienzo de cada pista y el límite de página.
- Header y footer utilizan **el mismo algoritmo** para las pistas
  mixtas y no pisan el contenido central.
- Tarjetas composables de `box()`, `paragraph()` y
  `grid()` retienen estilos, secuencia Fluent y una fila final
  incompleta.
- 16+ configuraciones inválidas se rechazan antes del renderer,
  incluyendo anchos imposibles dentro de cajas estrechas.
- Reporte con tarjetas y tabla paginada de 180 filas conserva
  todos los IDs en orden y repite encabezados de página.

## Ejemplo empresarial completo

`examples/fluent-grid-tracks.mjs` demuestra una API orientada
a composición real de documentos, usando:

- Logo y header repetido de dos pistas `[110,'1fr']`
- Footer con `['2fr','1fr']`
- Tarjetas KPI reutilizables como funciones que devuelven
  `VufraNode`
- Caja anidada con pistas `[125,'30%','1fr']`
- Secciones, encabezados, tabla styled de 190 movimientos,
  tipografía bold real y colores de un tema

Comando de reproducción:

```bash
node examples/fluent-grid-tracks.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-grid-tracks.pdf
```

Resultado observado: PDF Letter de **11 páginas / 42.421 bytes**,
**190/190 movimientos** en orden y sin repeticiones, header
`NORTH REGION` en las 11 páginas, indicadores principales una
sola vez cada uno. El archivo se produce en el workspace remoto;
no presentar su ruta como descarga local `sandbox:`.

## Verificación técnica

- `cargo fmt --all -- --check` PASS
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` PASS
- `cargo test --workspace`: 31 layout + 26 PDF = **57 Rust PASS**
- `cd packages/vufra && npm run build && npm test`:
  **150/150 Node PASS**, seis pruebas nuevas
- `bash scripts/verify-experiments.sh`: 1.000 registros,
  29 páginas, Unicode y orden correcto
- Poppler en el ejemplo: coordenadas reales de columnas,
  PDFInfo, texto extraíble y encabezados repetidos.

## Límites y próximos pasos

Esto **no es** una implementación de CSS Grid ni un
motor de navegación HTML. No hay rowspan/colspan, auto-fit,
media queries, baseline-sharing o reglas CSS globales.
Las pistas se resuelven a partir del ancho real de cada
contenedor, antes de generar el mismo árbol de filas nativo.
Se priorizó una mejora sencilla de autoría y legibilidad sobre
otra capa de abstracciones, benchmarks de microoptimización o
más cachés/concurrencia.

La siguiente evolución debe partir de documentos que un
desarrollador realmente necesite construir y de pruebas
visuales de layout, no de optimización por intuición.

**Entrega:** rama local, commit local, sin push ni merge a main.
