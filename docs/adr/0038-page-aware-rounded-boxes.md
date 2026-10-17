# ADR-0038 — Esquinas redondeadas vectoriales que respetan la paginación

**Fecha:** 2026-10-17 · **Estado:** implementado y verificado localmente
**Unidad:** 37 · **Rama:** `feature/unit37-rounded-page-aware-boxes`
**Base:** Unidad36 `11fff8c` · `origin/main` sigue `6399ebd`

## Problema de experiencia visual

Vufra tiene una Fluent API componible con `box()`, `grid()`,
tablas, temas y presets. Sin embargo, los fondos y bordes de
`box()` solo podían tener esquinas cuadradas. Un diseñador de
tarjetas y reportes empresariales no podía controlar ese detalle
sin imágenes externas o dibujar figuras manuales.

La Unidad36 había establecido un principio importante:
**los límites reales de contenido** —no los encabezados de tabla
repetidos en cada página— determinan cuándo empieza y
cuándo termina un contenedor.

## Decisión de API

Agregar la propiedad numérica opcional `radius` a
`BoxOptions` y `PdfBox`, reutilizando `box()` y los
presets de caja existentes. No se implementa CSS ni otra
sintaxis paralela:

```ts
const app=createVufra({font,theme:{
  presets:{box:{
    card:{padding:16,radius:12,background:'#EEF4FF',
      border:{width:2,color:'#173D78'}}
  }}
}});
const pdf=await app.document()
  .box({preset:'card'},b=>b.paragraph('Reporte'))
  .render();
```

- `radius` está en **puntos PDF**, de 0 a 24 y no mayor
  que `padding`. Cero es el valor por defecto.
- Se valida tempranamente en TypeScript y de nuevo en Rust;
  se rechazan NaN, infinito y valores fuera de geometría.
- Funciona en cajas normales, `row()`, `grid()`, cajas anidadas
  y presets, sin cambiar las APIs previas ni conservar rutas
  legacy del experimento.
- Es un valor único para las cuatro esquinas. No se añade
  `borderRadius`, selectores CSS, `clip-path` ni
  ajustes independientes por esquina.

## Datos y renderizado

La propiedad atraviesa sin perderse:

`Fluent BoxOptions` →
`renderer.normalizeBox` →
`NodeBox.radius` (NAPI) →
`PdfBox.radius` y `ContentFrame.radius` del AST owned →
`PreparedBox.radius` →
`Krilla PathBuilder`.

La pintura utiliza curvas **cuadráticas vectoriales** con
`PathBuilder::quad_to`. Se distinguen dos casos:

1. **Fondos**: un único contorno cerrado con radio en los
   extremos que realmente comienzan y terminan el contenido,
   y lados rectos en fragmentos intermedios.
2. **Bordes**: barras verticales rectas entre los extremos
   del contorno más trazados curvos para rematar los bordes
   superior e inferior. Se dibujan solamente donde existe
   el comienzo o fin **real** de la caja.

Los indicadores `first` y `last` provienen del rango
`original` implementado en la Unidad36, separado de las
hojas para dibujar encabezados repetidos. Por ello una tabla
puede repetir su cabecera sin redondear artificialmente la
parte superior del contenedor en páginas posteriores.

Con `radius=0` se ejecuta exactamente el código de
rectángulos que existía anteriormente, sin alterar la
geometría, tamaño del PDF ni apariencia en documentos
que no optan por las esquinas redondeadas.

La representación geométrica de contenido y la fragmentación
de texto/tablas no cambia. El tamaño de las cajas sigue
dependiendo de `padding`, contenido y sus estilos: el
radius **no** añade espacio ni fuerza saltos de página.

## Validación de PDFs reales

Se creó `packages/vufra/tests/rounded-boxes.test.mjs`
con cuatro pruebas Node de integración:

- Un preset `card` produce un PDF **binariamente idéntico**
  a la declaración manual de fondo, borde, padding y radius.
  Poppler comprueba píxel blanco exterior a la curva,
  borde superior y lateral exactos y fondo interior RGB.
- Una caja sin `radius` y otra con `radius:0` producen
  PDFs binariamente idénticos.
- Dos cajas anidadas alrededor de una tabla de 115 registros
  conservan IDs únicos, encabezados en cada página y
  bordes laterales. Solo la página original pinta esquina
  superior; las continuaciones tienen borde recto arriba
  sin falso remate; la última dibuja el borde inferior.
- Valores incorrectos (negativo, superior al padding,
  superior a 24, NaN, infinito y un preset inválido)
  se rechazan antes de producir documentos dañados.

La prueba usa `pdftoppm -r 72` y píxeles RGB reales,
además de `pdfinfo` y `pdftotext`.

Rust comprueba explícitamente validación de radio en la
capa PDF y que `ContentNode` mantiene un radio definido
al hacer round-trip mediante `ContentFrame`.

## Ejemplo empresarial

`examples/fluent-rounded-dashboard.mjs` compone
**9 tarjetas KPI reutilizables**, grid automático, estilos
de tema, panel exterior e interior con radios distintos
y tabla multipágina con **165 facturas** y celdas rich.

```bash
node examples/fluent-rounded-dashboard.mjs \
  REGULAR.ttf BOLD.ttf artifacts/fluent-rounded-dashboard.pdf
```

Salida observada: **11 páginas /43.861 bytes**,
9 identificadores KPI en orden, 165 IDs
`ROUNDINV_0001..ROUNDINV_0165` únicos en orden,
`ROUNDED_COMPANY` repetido en todas las páginas,
marcadores de cierre una sola vez.

El archivo se genera en workspace remoto y no proporciona
un enlace `sandbox:` de esta sesión.

## Calidad y límites

Se ejecutan `cargo fmt`, `cargo clippy -D warnings`,
todos los tests Rust, NAPI release build, TypeScript build,
Node tests y el experimento histórico de 1.000 registros
en 29 páginas. No se atribuye mejora de rendimiento sin
benchmark ni se introducen cachés o concurrencia nuevos.

Esta primera implementación no proporciona clipping del
contenido arbitrario dentro de la máscara redondeada;
el contrato exige `radius <= padding` para mantener
el contenido principal dentro de los límites interiores.
No implementa sombras ni esquinas asimétricas.

**Entrega:** commit local, ADR, documentación y Obsidian;
sin push ni merge a `main`.
