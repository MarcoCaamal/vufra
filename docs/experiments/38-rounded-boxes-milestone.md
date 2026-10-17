# Unidad 37 — Tarjetas con esquinas redondeadas

**Fecha:** 2026-10-17
**Rama local:** `feature/unit37-rounded-page-aware-boxes`
**Base:** Unidad36 `11fff8c` · `origin/main` `6399ebd`

## Valor para la Fluent API

Se añadió `radius?:number` a `BoxOptions`:

```ts
document.box({radius:12,padding:16,background:'#EEF4FF'},card=>
  card.paragraph('Resumen'));
```

La misma propiedad está disponible en los presets:
`theme.presets.box.card.radius`. El radio se mide en
puntos PDF, es finito, de 0 a 24 e inferior o igual al padding.

## Renderizado

- Radio propagado por TypeScript, NAPI y AST owned Rust.
- Fondos y bordes vectoriales mediante PathBuilder de Krilla.
- Esquinas redondeadas solo en principio y fin reales de caja,
  conservando los cortes rectos en páginas intermedias.
- Los headers de tabla repetidos no restauran esquinas superiores.
- Con radio cero se utiliza la representación rectangular previa
  y el PDF es binariamente idéntico.
- Sin cambio en paddings, saltos, medición o paginación.

## Verificación

- 4 pruebas Node nuevas con comparación binaria,
  muestras RGB Poppler, tabla anidada multipágina y
  validación estricta.
- Test Rust directo de radius y round-trip del AST.
- Ejemplo enterprise con nueve KPI +165 facturas ordenadas,
  11 páginas /43.861 bytes.
- Full Rust fmt/clippy/test, NAPI release,
  Node build/test y regresión 1000 registros/29p.

Documentación ADR-0038, READMEs y Obsidian.
**Entrega local: sin push ni merge.**
