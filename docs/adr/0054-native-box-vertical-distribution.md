# ADR-0054 — Distribución vertical entre hijos de una caja con `minHeight`

Estado: implementación incremental de composición avanzada U40. **No pretende implementar todo Flexbox.**

## API

```ts
doc.box({minHeight:260,justifyContent:'space-between',padding:12},box=>{
  box.paragraph('Título');
  box.paragraph('Pie de la tarjeta');
});
```

`justifyContent:'start'` es el default y preserva el modelo anterior. `justifyContent:'space-between'` requiere `minHeight`, entre dos y 32 **hijos directos** de la caja y un ancho/alto válidos conforme a las reglas existentes. Si el contenido ya supera `minHeight`, se conserva íntegro, sin crear espacios adicionales, recortar ni reducir tipografías. `maxHeight` mantiene su validación estricta.

## Layout nativo

La caja prepara y mide completamente cada hijo usando las rutinas anteriores de Parley/PDF. Durante `PdfBox::prepare_depth`, registra **límites reales entre hijos** antes de expandir cada párrafo a líneas, cada fila a fragmentos o cada tabla a encabezado/filas. Si existe espacio sobrante `minHeight - altura_intrínseca`, crea N-1 hojas `PreparedContent::Spacer` entre los límites de N hijos, cada una con `deficit/(N-1)` puntos. Se insertan de derecha a izquierda para conservar los índices preparados previos. Después se construye el mismo árbol de layout y se pagina normalmente.

A diferencia de insertar espaciadores desde TypeScript, esta solución no adivina la altura de las fuentes ni separa líneas de un mismo párrafo. No introduce otra jerarquía de widgets ni redibuja un PDF después de medirlo. La propagación es `BoxOptions` → normalizador → `NodeBox.spaceBetween` → `PdfBox.space_between` → `ContentFrame` owned; Rust también rechaza el AST inválido. Las opciones de siempre no insertan hojas nuevas.

## Casos y límites

- Tarjetas con dos o más bloques cortos mantienen uno arriba y otro más abajo; el bloque siguiente fuera de la caja **no cambia de posición** si `minHeight` era igual.
- Cajas anidadas y párrafos de varias líneas conservan el contenido: solo se distribuye entre hijos directos.
- Cuando un reporte excede `minHeight`, sigue su paginación normal entre varias páginas, sin forzar la distribución.
- No hay `space-around`, `space-evenly`, `align-items`, `flex-grow`, `flex-shrink`, cuotas proporcionales por hijo, márgenes colapsables o cajas CSS.

Verificación: `packages/vufra/tests/box-justify-content.test.mjs` utiliza posiciones X/Y con Poppler, compara contra `start`, verifica párrafo multilínea y caja anidada, límites y normalización maliciosa, además de 115 filas multipágina sin pérdida.
