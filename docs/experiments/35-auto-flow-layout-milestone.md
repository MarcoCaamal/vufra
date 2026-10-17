# Unidad 34 — Auto flow de tarjetas por ancho mínimo

**Fecha:** 2026-10-17 · **Rama local:**
`feature/unit34-auto-flow-grids`. Base: Unidad33 `e9b409a`;
`origin/main` `6399ebd`.

## Experiencia del desarrollador

```ts
document.grid({
  columns:{minWidth:150,maxColumns:3},
  gap:12,rowGap:16
},g=>{
  for(const metric of metrics)
    g.cell(c=>c.box({preset:'card'},b=>
      b.paragraph(metric.label).paragraph(metric.value)));
});
```

Vufra decide 1..6 columnas de igual ancho a partir del ancho real
del contenedor, agrupando celdas en filas en orden.
El motor Rust conserva su altura natural y paginación.
`rowGap` inserta un Spacer solamente entre filas.

También funciona con nodos reutilizables
`grid(...)` y `.add(component)`, cajas anidadas, página y
banda de encabezado/pie (una fila, sin rowGap adicional).

## Validación

- Geometría calculada antes de Rust, con `minWidth>=60`,
  `maxColumns` entero1..6, gaps entre 0 y 80.
- Siete tests con bbox físico de columnas, límites de 311/312pt,
  dos o tres columnas según contenedor, alturas desiguales,
  espacio vertical, page bands, errores y 62 KPI paginados.
- Ejemplo 13 páginas/47.313B con 37 KPI y 175 transacciones
  en orden; header repetido en todas las páginas.
- Rust fmt/clippy/test; Node build/full suite; addon NAPI;
  regresión 1000 filas/29p Unicode.

## Decisión

No sumar otro motor CSS, masonry, cachés ni concurrencia.
Continuar mejorando casos reales de authoring y calidad visual.
Documentación ADR-0035, Obsidian y README. Entrega local,
sin push ni merge.
