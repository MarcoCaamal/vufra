# ADR-0058 — Flex grow/shrink explícitos y seguimiento reproducible de rendimiento

**Estado:** implementado localmente sobre `feature/unit58-flex-performance` (descendiente de las unidades 56/57), sin push ni merge. Se mantiene un único motor Rust para medidas y paginación; el solver de anchos es previo a la creación del AST `PdfRow`, por lo que la renderización, las tablas y los cabeceros siguen el mismo camino.

## Nueva Fluent API

```ts
doc.row({gap:12},row=>row
  .column({width:140,flexGrow:1,flexShrink:1},c=>c.paragraph('Cliente'))
  .column({width:200,flexGrow:2,flexShrink:2},c=>c.paragraph('Descripción'))
  .column({width:90},c=>c.paragraph('Total')));
```

- `ColumnOptions.flexGrow?: number` y `flexShrink?: number` aceptan pesos relativos finitos de `0..10`, con valor por defecto `0` (sin distribución implícita). Los pesos no modifican los PDFs antiguos si no se especifican. El ancho del parámetro `width` es la **base**; puede expresarse en puntos o porcentajes del espacio tras gaps. Se requieren bases explícitas en todas las columnas participantes de una fila flexible; combinar con `'*'` o `justify:'space-between'` se rechaza para evitar políticas contradictorias.
- Con espacio libre, `flexGrow` reparte el sobrante proporcionalmente a los pesos. Columnas sin peso quedan con su ancho base. En desbordamiento, `flexShrink` absorbe el déficit proporcionalmente a `peso × ancho_actual`, con algoritmo iterativo que congela columnas en su mínimo y redistribuye el resto entre otras columnas elegibles.
- **Mínimo nativo:** cada columna debe conservar por lo menos 60pt y 12pt de ancho interno después de padding izquierdo y derecho. Si el déficit no es resoluble (p. ej., otras columnas fijas demasiado grandes), fallamos temprano, en vez de dibujar contenido fuera del papel.
- Las columnas finales se envían al `PdfRow` anterior como anchos absolutos; las mediciones de texto, bordes, imágenes, spans y páginas siguen siendo nativas. No se introduce Flexbox CSS, `flex-basis:auto`, `order`, wrapping automático de columnas ni `align-content`. La distribución flex es **horizontal para columnas de una fila**, no una nueva estrategia para todos los elementos.
- `PageBandScope.row(...)` comparte los mismos controles, y las dimensiones se derivan del ancho del capítulo que contiene la fila, incluyendo custom Letter/landscape y cajas anidadas.

## Pruebas funcionales

`packages/vufra/tests/row-flex.test.mjs`: Poppler inspecciona posiciones X reales para crecimiento proporcional, reducción ponderada, freeze en mínimos con padding, rechazos por pesos inválidos/anchos implícitos/deficits imposibles y combinación de varias geometrías con bandas. `packages/vufra/tests/performance-harness.test.mjs` verifica esquema JSON de escenarios, muestra estadística/memoria/tamaño y comparación con el snapshot anterior. La suite integral y el experimento de 1000 filas siguen siendo obligatorios.

## Seguimiento de rendimiento desde esta unidad

Fuente de verdad: `scripts/benchmark-regressions.mjs` (sin paquetes extra). Se mantiene la familia de cargas de trabajo deliberadamente pequeña pero representativa: `table-250`, `nested-50`, `mixed-150` y `flex-100` (nuevo en U58).

```bash
# Compilar TypeScript y addon primero (en el mismo perfil para ambos commits)
(cd packages/vufra && npm run build)
bash scripts/build-native.sh
FONT=$(fc-match 'Noto Sans' -f '%{file}' | head -1)
node --expose-gc scripts/benchmark-regressions.mjs --font "$FONT" --runs 7 \
  --out artifacts/performance.json \
  --compare docs/performance/2026-10-18-unit57-baseline.json
```

Cada escenario corre en un **proceso Node nuevo**. El documento se construye **fuera** del cronómetro y se precalienta dos veces, luego se hacen N renders sincronizados secuenciales; hay una llamada opcional a GC antes de cada muestra para reducir el ruido del heap JS. Se registran todos los samples, mediana, p95, tamaño PDF, RSS final y `maxRSS` de proceso. `maxRSS` incluye carga de Node/fonts, warmups y memoria nativa; **no** se puede atribuir sólo a Rust. Linux informa maxRSS en KiB y macOS en bytes; el harness los normaliza a MiB.

Los JSON incluyen revisión, sistema, CPU, núcleos, versión Node, RAM y longitud del archivo de fuentes. Una comparación con otra CPU/OS/fuente/versión Node debe tratarse como informativa y `sameMachine=false`; *ni* un delta negativo es garantía de ganancia *ni* uno positivo aislado prueba regresión. Se conserva un resultado inicial `docs/performance/2026-10-18-unit57-baseline.json` (commit `a65e9d9`) y el snapshot de esta unidad en `docs/performance/`.

CI: cada ejecución tras compilar/validar SDK guarda `artifacts/performance-ci.json` y lo sube mediante `actions/upload-artifact@v4` con retención 60 días. **La latencia no actúa como umbral rígido de CI por defecto** (runners de GitHub cambian de hardware/ruido de carga); `--enforce --max-regression 20` es opcional y sólo adecuado en hardware estable y con evidencia estadística suficiente.

Limitaciones: el benchmark de render síncrono no sustituye carga simultánea/concurrencia, prueba de throughput de red ni profiling de allocations Rust. Antes de cualquier optimización, se debe comparar en la **misma máquina y perfil** y repetir rondas frente al baseline para distinguir ruido de diferencia reproducible.

## Primera comparación registrada

Después de implementar el solver, en el mismo host Linux x64, Node 24.11.1, fuente Noto Sans y 5 muestras, las medianas fueron: tabla 250 **23,675→23,843 ms** (+0,7 %), 50 cajas **5,352→5,258 ms** (−1,8 %), secciones mixtas **16,317→15,431 ms** (−5,4 %). Los tres tamaños PDF permanecieron idénticos. El nuevo escenario flex-100 obtuvo mediana **7,958 ms** y pico RSS **87,309 MiB**; no tiene comparación previa válida porque la capacidad no existía.

La variación es compatible con ruido de máquina y tamaño de muestra; **no anunciamos una mejora de rendimiento** ni introducimos caché o concurrencia nuevos. Los perfiles JSON están en `docs/performance/` junto a una guía para dar continuidad a cada feature. El addon probado fue el mismo perfil de build en ambas revisiones; los tests y muestras no incluyen tiempo de construcción del AST.
