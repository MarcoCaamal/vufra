# ADR-0036 — Separadores conscientes de página y títulos no huérfanos

**Fecha:** 2026-10-17 · **Estado:** implementado y verificado localmente
**Unidad:** 35 · **Rama:** `feature/unit35-pagination-separators`
**Base:** Unidad34 `0be76ab`; `origin/main` sigue `6399ebd`.

## Problema observado

Vufra ya soportaba `heading({keepWithNext:true})` —por defecto
en la Fluent API—, `box({keepTogether:true})` y
`box({breakBefore:true})`. Sin embargo, la implementación nativa
de `paginate_flow_with_keep` solamente inspeccionaba el bloque
inmediatamente siguiente al encabezado.

```ts
doc.heading('Detalle de operaciones')
  .spacer(12)
  .table(rows,{columns});
```

El `spacer` era tratado como el sucesor que debía quedar junto
al título; la tabla podía saltar sola a la siguiente página,
dejando un título huérfano. El problema afectaba también a
`.section('Detalle',s=>s.spacer(12).table(...))`, aunque el
autor utilizara exactamente el API recomendado.

Además, cuando un `spacer` utilizado **entre** dos bloques
coincidía con un salto implícito de página, el paginador podía
llevar el espacio vacío al principio de la página siguiente.
Esto producía páginas con margen excesivo y podía inducir
cortes innecesarios.

## Decisión

Mejorar **el paginador Rust existente** y conservar la misma
sintaxis Fluent y las mismas políticas explícitas del usuario.

### 1. Keep-with-next salta separadores, nunca contenido

El paginador examina una secuencia consecutiva de `Spacer`
hasta el próximo bloque visual. Si el bloque actual es un
`Paragraph` o `Box` marcado `keepWithNext`, reserva:

- La altura del encabezado o caja actual
- La suma de las alturas de los separadores intermedios
- El tamaño mínimo que realmente necesita el contenido visual
  siguiente

El bloque objetivo puede ser un párrafo, imagen, gráfico o caja
(con tablas). No se saltan documentos ni se altera el orden.

`PageBreak` y `Box.breakBefore` son barreras explícitas
que tienen prioridad; **no se empareja contenido a través de
un salto impuesto por el autor**.

### 2. Reservar la geometría que el renderizador realmente usa

El paginador de cajas existentes mueve una caja **entera**
a una página nueva cuando cabe íntegramente en una página vacía,
en vez de fragmentarla prematuramente. Para evitar cálculos
contradictorios, el nuevo `first_visible_height` aplica:

- Si la caja completa cabe en la altura disponible de una página
  nueva: sumar **todos los items, padding y overhead de
  contenedores anidados**.
- Si debe fragmentarse: estimar el primer item más padding.
- Si el próximo bloque es una tabla fragmentada, reservar
  **el encabezado repetido más su primera fila real**.
- Si el próximo bloque tiene `breakBefore`, detener el lookahead.

Un test y un PDF real detectaron específicamente una caja con
tabla que cabía en una página completa pero no en el espacio
restante de la actual; reservar solo su encabezado dejaba el
título atrás. Se corrigió esa discrepancia antes de entregar.

### 3. Los gaps de página son separadores, no sangrías nuevas

Una secuencia de separadores que cae entre dos bloques visibles
se mantiene si el grupo cabe en la página actual.

Si el espacio restante no permite acomodar los separadores
**junto al primer fragmento siguiente**, el paginador:

1. Termina la página actual
2. Inicia una página nueva
3. Omite solamente los separadores de esa frontera implícita
4. Continúa renderizando el contenido visible en orden

Se conservan las alturas originales de los separadores que sí
caben, y los márgenes intencionales siguientes **no se omiten**:

- `doc.spacer(25).paragraph(...)` al inicio del documento
- `doc.pageBreak().spacer(25).paragraph(...)` después de un
  salto explícito
- Separadores antes de `PageBreak` (no se atraviesan barreras)
- Bloques sin separación intermedia

No se crea un nuevo `autoPageBreak`, `keepSection` ni
un wrapper de compatibilidad; las opciones existentes cumplen
mejor su intención.

### 4. Validación defensiva

Todos los `Spacer` se validan **antes** de la paginación,
incluyendo aquellos que podrían omitirse al cruzar páginas.
Ningún `NaN`, altura negativa, cero o mayor que la altura de
una página puede ser silenciado por el optimizador.

La decisión sigue utilizando `FlowBlock`, `FlowFragment` y
`LayoutNode` existentes; no se añadió caché, paralelismo ni
lógica CSS dentro del motor Rust.

## Pruebas de regresión

### Rust, `vufra-layout`

Se actualizaron los tests de semántica vieja de gap en frontera
y se añadieron **ocho pruebas** nuevas de:

- `keepWithNext` atravesando uno o varios `Spacer`
- Tablas con encabezado repetido y primera fila agrupada
- Cajas completas movidas junto al encabezado
- Gaps exactos sin cambio si ambos bloques caben
- Un separador que cruza frontera implícita se elimina
- Gaps después de saltos explícitos y al inicio se mantienen
- No cruzar un `PageBreak` explícito
- No silenciar gaps inválidos en una secuencia suprimida

### Node, `page-aware-spacing.test.mjs`

Cinco pruebas generan PDFs reales y los inspeccionan con
Poppler (`pdfinfo`, `pdftotext -raw`, `-bbox`):

- Un título rich/styled de sección con `spacer` y PNG permanece
  en la misma página que la imagen; `keepWithNext:false`
  continúa permitiendo su separación explícita.
- `section(title)` con gap y tabla de 8 registros mantiene
  título, encabezado y primer registro juntos.
- En un salto implícito, el siguiente texto comienza a la misma
  altura que tras un `pageBreak` explícito sin separador;
  no lleva los 70pt al margen superior.
- Un `spacer` al comienzo y después de `pageBreak`
  desplaza el contenido **exactamente** los puntos solicitados.
- Un ledger de 175 registros conserva todos los IDs en orden,
  sin duplicación, con encabezado de página repetido.

## Demostración empresarial

```bash
node examples/fluent-page-aware-sections.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-page-aware-sections.pdf
```

Genera un reporte de **11 páginas y 39.404 bytes** con 185
transacciones, logo/paleta/estilos, resumen y tabla paginada,
sin posiciones manuales.

La verificación con Poppler confirmó:

- IDs `INV_0001` a `INV_0185` exactamente una vez, en orden
- Encabezado `VUFRA_OPERATIONS` en las 11 páginas
- `EXECUTIVE_SUMMARY` y `BUSINESS_RESULT` en la misma página
- `STATEMENT_DETAILS` y `INV_0001` en la misma página
- `END_OF_STATEMENT` al final una sola vez

El PDF se genera dentro del workspace remoto y **no**
constituye un enlace de descarga `sandbox:` en esta sesión.

## Consecuencias y límites

La paginación es ahora más predictiva y puede mover un título
junto con su primer bloque visible cuando hay espacio suficiente.
Esto puede alterar **intencionalmente el número de página** en
documentos que antes dibujaban el título aislado. No mantener
una ruta de compatibilidad pre-v1 que perpetúe ese defecto.

La política no agrupa secciones arbitrariamente grandes:
si un grupo no cabe ni en una página nueva, aplica degradación
segura a flujo normal. Una tabla extensa puede seguir
ocupando varias páginas con headers repetidos.

No se implementó una navegación web, ni CSS completo,
`widows/orphans` configurable por línea dentro de cajas
anidadas, ni paginación concurrente; esos problemas quedan
fuera de alcance.

**Entrega:** código probado localmente, ADR e informe de unidad,
nota de Obsidian, commit local, sin push ni merge.
