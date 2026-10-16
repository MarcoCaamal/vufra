# Vufra — Arquitectura conceptual (objetivo de diseño)

> Unidad 01 validó los escritores y BreakToken. Unidad 02 implementó una **primera versión parcial** del pipeline usando `vufra-pdf`, Parley, Krilla y el SDK Node/TypeScript. El AST jerárquico y el layout general de cajas abajo siguen **propuestos**, no están terminados. Véanse los [resultados de Unidad 02](../experiments/03-sdk-milestone.md).

## Problema que resolvemos

Un productor de documentos necesita convertir una descripción semántica en páginas PDF con texto seleccionable, fuentes correctas, imágenes y contenidos grandes. El principal riesgo no es dibujar texto en una página; es medir y fragmentar el documento sin discrepancias entre el layout y la escritura final.

## Pipeline propuesto

```text
Documento / Builder
  -> AST + Style + AssetRefs                       [core]
  -> Font registry, shaping, measurement           [text]
  -> Box tree, constraints, fragmentation          [layout]
  -> List<LaidOutPage> + positioned fragments      [layout]
  -> Fonts/images/resources + emit PDF objects     [pdf]
  -> PDF bytes o output stream                     [fuente salida por decidir]
```

No se mezclan coordenadas absolutas en el AST. El renderizador no debe ejecutar layout ni decidir el salto de página. No comprometer API pública final antes de validar el flujo.

## Dependencias permitidas (DAG)

```text
             [core]       [text]
                \         /   \
                 \       /     \
                 [layout]       \
                     \           \
                      \---------[pdf]
                               /
                      [facade vufra]
```

Interpretación normativa: `layout -> core,text`; `pdf -> core,layout,text`; `facade -> core,layout,pdf,text`. `core` y `text` no dependen de los demás crates Vufra. (El diagrama es conceptual, no código.)

## Contratos tentativos (no API definitiva)

- `Document`: raíz semántica con página/estilos/nodos/referencias a recursos.
- `DocumentNode`: estructura semántica tipo texto, imagen, bloque, tabla.
- `LayoutConstraints`: tamaño disponible, áreas, configuraciones de página.
- `Fragment`: porción medida y posicionada, con referencia inequívoca a contenido fuente.
- `BreakToken`: estado serializable o transferible en memoria para retomar **el mismo nodo** en la siguiente región/página, no un cursor global frágil.
- `LaidOutPage`: página compuesta por fragmentos sin detalles del backend PDF.
- `VufraError`: errores categorizados con contexto (fuente, estilo, layout, recurso, render, límites).

## Invariantes de paginación

1. **Conservación:** ningún nodo/parte de contenido se pierde ni se duplica.
2. **Orden:** los fragmentos mantienen orden documental salvo reglas explícitas de layout.
3. **Progreso:** al reanudar, el token avanza o reporta "no cabe" con error recuperable; nunca loop infinito.
4. **Límites:** alturas y márgenes acotados, sin solapamiento indebido de áreas reservadas.
5. **Repetición controlada:** headers/footers y encabezados de tablas se repiten pero se distinguen de contenido semántico original.
6. **Interoperabilidad:** el writer PDF recibe fragmentos ya resueltos, no decisión de page break.

## Texto e imágenes

- Medición de texto con misma familia/tamaño/variantes usadas para escribir.
- Validar Unicode, caracteres combinantes, acentos, ñ, emoji y al menos un guion no latino con cobertura real de fuente.
- Separar shaping, line breaking y mapeo de glifos en PDF (ToUnicode y extracción).
- Assets con IDs y límites explícitos; decoding/embedding desacoplados del AST.
- No asumir que la fuente o imagen enviada es válida; errores de entrada tipados.

## Características del MVP (no promete producción aún)

PDF multipágina, texto seleccionable, imágenes PNG/JPEG, Stack/Row/Box, tabla de 1.000 filas paginada, headers/footers, fuentes integradas y errores claros. Los benchmarks y validadores deben demostrar estas capacidades; no inferirlas solo de que un PDF abre en un visor.

## Riesgos y decisiones abiertas

- Elección backend `pdf-writer` o `krilla` (SP-01).
- Solución fuente/shaping/line breaking y su integración con el escritor (SP-02).
- API y semántica exacta de fragmentación + `BreakToken` (SP-03).
- Dependencias externas/licencias, MSRV, tamaños máximos, formatos de salida, optimización memoria.
- Evitar publicar prematuramente crates internos como contratos de estabilidad semver.

Véanse [W0](../planning/01-w0-workspace.md) y [experimentos](../experiments/01-spikes.md).
