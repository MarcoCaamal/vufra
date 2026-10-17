# ADR-0034 — Presets visuales planos para la Fluent API

**Fecha:** 2026-10-17 · **Estado:** implementado y verificado localmente
**Unidad:** 33 · **Rama:** `feature/unit33-reusable-style-presets`
**Base:** Unit32 `c787677`; `origin/main` sigue `6399ebd`.

## Problema

Aunque Vufra tenía temas con tokens de color, texto base y títulos
h1/h2/h3, cada componente debía repetir manualmente propiedades como
`padding`, `background`, `border`, `fontSize`, `color` y
`bold`. En documentos empresariales con muchas tarjetas,
secciones y labels esto dificultaba garantizar consistencia y
mantenibilidad de la UI documental.

## Decisión

Se utiliza **la misma Fluent API existente** y se agregan nombres
de presets como opciones de apariencia.

```ts
const report=createVufra({
  font, fonts:{bold},
  theme:{
    colors:{primary:'#173D78',panel:'#EDF4FC',edge:'#BDCEE0'},
    presets:{
      text:{label:{color:'primary',bold:true,fontSize:11}},
      box:{card:{padding:12,background:'panel',
        border:{width:1,color:'edge'}}}
    }
  }
}).document();

report.box({preset:'card'},card=>
  card.paragraph('Resumen',{preset:'label'})
);
```

El tipo `VufraStyle` incorpora `preset?:string`;
`BoxOptions` incorpora `preset?:string`.
`VufraTheme.presets` se divide expresamente en:
- `text: Record<string,Omit<VufraStyle,'preset'>>`
- `box: Record<string,Omit<BoxOptions,'preset'>>`

Las definiciones son **planas**, sin herencia de otras definiciones
ni árboles de dependencias. Se conserva `theme.colors` como
mecanismo único para tokens cromáticos; los presets simplemente
los referencian.

## Orden de precedencia

Para texto, el resolver `mergeStyle` aplica las capas:
1. `theme.text` (incluido su preset, si tiene uno)
2. `theme.h1/h2/h3` cuando es un heading
3. El preset solicitado por el autor
4. Las opciones explícitas del autor

Cada capa individual resuelve su preset y luego los overrides propios.
Por eso `{preset:'label',fontSize:14}` mantiene el color/bold del
preset pero usa tamaño 14. Esto también respeta estilos hN y
personalizaciones locales.

Para cajas, `resolveBoxOptions` toma primero el preset y después
el objeto de opciones proporcionado en `.box(...)`. El objeto
`border` tiene merge **por propiedades**, de modo que
`{preset:'card',border:{width:2}}` no pierde el borde cromático
de la definición. Los colores se resuelven mediante el validador
de tokens existente, antes de construir el AST para Rust.

Los nombres de preset se consultan con `Object.prototype.hasOwnProperty`
para impedir heredar accidentalmente `constructor`, `__proto__`
o `toString`. Un preset desconocido, vacío o con referencia
recursiva a otro preset produce un `TypeError` explícito y temprano.
Ningún preset sin resolver llega al wire nativo.

## Alcance

- `.paragraph(text,{preset:'muted'})`,
  `.heading(text,{preset:'title'})`,
  `.box({preset:'card'},cb)`.
- Equivalente en `ColumnScope.paragraph/heading` y
  runs `richText` (root/column).
- `PageBandScope.text` (headers y footers) respeta tamaño
  procedente del preset sin sobrescribirlo por un default.
- Los nodos declarativos `paragraph()`, `box()`,
  `grid()` y `.add()` usan exactamente los mismos resolvers,
  sin estilos globales ocultos.
- El factory hace un snapshot del tema con `structuredClone`;
  modificar el tema original luego de `createVufra` no
  modifica documentos existentes ni sus hermanos.

No se agrega un parser de CSS, archivos CSS, selectores de clase,
cascadas complejas, contextos de estilo mutables ni nuevos
módulos renderer. No hay duplicación de la API actual.
Los estilos se resuelven en TS antes de llamar a Rust.

## Validación empírica

`packages/vufra/tests/style-presets.test.mjs`: nueve pruebas
de integración que cubren equivalencia **byte a byte** de PDF
con opciones explícitas, overrides de box y texto, spans rich
y page bands, tarjetas como componentes funcionales, aislamiento
de mutación del tema, presets ausentes/recursivos, tablas
paginadas con 155 IDs, precedence heading y ausencia de presets
globales.

`examples/fluent-style-presets.mjs`: informe empresarial con
logo, presets de texto/cajas, cuatro tarjetas KPI, panel
anidado de estado, header/footer y tabla de 175 registros.
Resultado real observado: **10 páginas, 40.688 bytes, 175/175
identificadores únicos y ordenados**, y encabezado `NORTH_REPORT`
en las 10 páginas.

Verificaciones técnicas: Rust fmt/clippy y 57 tests; NAPI build,
TypeScript build + suite Node completa; y regresión de 1.000 filas
paginadas con Unicode. No se modifica la implementación nativa
o los algoritmos de paginación.

## Límites

No se ha implementado tipografía CSS, tamaños de letra relativos,
bordes redondeados, sombras, breakpoints, ni `rowspan` o
`colspan`. Los presets representan únicamente opciones de
texto y caja que Vufra **ya podía dibujar**.
Errores de geometría existentes siguen siendo errores: un preset
no evita los presupuestos de alto/ancho de un contenedor.

**Entrega:** commit local, sin push ni merge; documentado en Obsidian.
