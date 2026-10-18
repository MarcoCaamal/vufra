# ADR-0046 — Validación de entradas y monedas en plantillas JSON v1

Estado: implementado localmente como continuación de Unidad 43, sin cambios de motor Rust ni de Fluent authoring.

## Problema

Las plantillas JSON v1 permitían bindings seguros, pero los tipos y campos requeridos de un dataset no se comprobaban hasta resolver cada nodo. Además, el SDK trataba importes como cadenas ya preparadas. La responsabilidad de validar campos y usar una convención monetaria reproducible debe estar en el contrato explícito de la plantilla, no en el locale de la máquina.

## Contrato de tipos

La definición puede contener `dataSchema:{fields:[{path,type,required?,minLength?,maxLength?}]}`. Los tipos iniciales son `string`, `number`, `integer` (entero IEEE seguro), `boolean`, `array` y `object` JSON plano. `required` es true por defecto. `minLength`/`maxLength` solo se admiten para string y array. Máximo 200 campos y longitudes 0..10.000. Se validan rutas y nombres duplicados al compilar `defineTemplate`; `.document(engine,data)` valida los datos clonados antes de producir nodos o invocar Rust. Objetos adicionales y campos no listados se permiten; esto **no es JSON Schema universal** (aún faltan constraints condicionales, discriminadores, validación recursiva de elementos y migraciones).

```ts
const tpl=defineTemplate({
  schemaVersion:1,title:{bind:'report.title'},
  dataSchema:{fields:[
    {path:'report.title',type:'string',minLength:3},
    {path:'amountMinor',type:'integer'}
  ]},
  content:[{type:'paragraph',text:{bind:'amountMinor',
    format:{kind:'currencyMinor',currency:'MXN',locale:'es-MX'}}}]
});
```

## Formato monetario

`{bind:'amountMinor',format:{kind:'currencyMinor',currency:'MXN',locale:'es-MX'}}` interpreta la entrada como **unidades menores enteras** (centavos para MXN, 1 yen para JPY, milésimos para KWD) y utiliza `Intl.NumberFormat` con código ISO de tres letras y locale explícito. Las posiciones decimales se obtienen de la resolución real de currency en Intl (no se asume siempre /100), soporta casos de 0, 2 y 3 decimales. La entrada debe ser safeInteger con magnitud <=1e12 para evitar pérdida de precisión submonetaria al escalar. Se rechazan locales no soportados, formatos mal formados, rutas inseguras, datos `undefined`, funciones y `NaN` mediante el preflight existente. No se suman ni se agregan importes en floating point.

### Limitaciones

No hay aún decimal arbitrario, fechas/zonas horarias, formatos locales personalizados, versionado `schemaVersion:2`, validación JSON Schema estándar ni motor de expresiones. Los formateos siguen siendo materializados en la capa SDK; el renderizado sigue en Rust. Si no se incluye `dataSchema`, se mantiene validación de bindings por ruta al materializarlos.

## Evidencia

`packages/vufra/tests/json-template.test.mjs`: validación de tipos, campos faltantes, límites, seguridad, MXN/JPY/KWD y extracción del texto PDF; ejemplo `examples/fluent-json-template.mjs` utiliza `dataSchema` y `currencyMinor` en 150 registros multipágina.
