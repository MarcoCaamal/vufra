# Unidad 05 — Compositor unificado de Vufra

**Fecha:** 2026-10-16. **Estado:** prototipo funcional, no listo para producción.

## Hito

Vufra ahora puede generar un documento de **bloques ordenados** desde TypeScript:
- Párrafo → tabla → párrafo → tabla, sin necesidad de páginas adicionales cuando queda espacio.
- Párrafos largos fragmentados a nivel de línea y continuados en páginas posteriores.
- Tablas reales multicolumna con celdas que continúan entre páginas, encabezados repetidos y sin desordenar registros.
- Metadatos de página (cabecera/pie) repetidos correctamente.
- API `blocks` nueva y coexistencia sin roturas con `paragraphs`, `rows` y `table` antiguos, que no se pueden mezclar en una misma llamada.

## Implementación

| Módulo | Responsabilidad |
|---|---|
| `crates/vufra-layout/src/flow.rs` | Calcula `FlowPage` y `FlowFragment`, fragmenta párrafos, administra espacio restante y delega filas de tabla al paginador existente |
| `crates/vufra-layout/src/split.rs` | Continúa filas de tabla mediante token de fila/línea, sin duplicaciones |
| `crates/vufra-pdf/src/flow_render.rs` | Prepara bloques, mide texto con Parley, dibuja páginas con Krilla |
| `bindings/vufra-node/src/lib.rs` | Convierte `NodeBlock` en el `PdfBlock` Rust correcto |
| `packages/vufra/src/index.ts` | Tipos discriminados, validación estructural y compatibilidad |

## Ejemplo de SDK

```typescript
const pdf = renderPdf({
  title: "Informe integrado",
  blocks: [
    { type: "paragraph", text: "Introducción al informe." },
    { type: "table", table: {
      columns: [
        { header: "Folio", width: 110 },
        { header: "Descripción", width: 270 },
        { header: "Valor", width: 117 },
      ],
      rows: [["A001", "Concepto", "$100"]],
    }},
    { type: "paragraph", text: "Conclusión después de la tabla." }
  ]
}, fontBytes);
```

## Pruebas

- `crates/vufra-layout/src/flow.rs`: 6 pruebas Rust sobre uso compartido de página, cursor de líneas, tablas largas, mantener párrafos cortos juntos, documento vacío, geometría inválida.
- `packages/vufra/tests/flow.test.mjs`: 5 pruebas de extremo a extremo:
  - Párrafo y tabla intercalados en **una única página**.
  - Un párrafo con **1,200 tokens** atravesando páginas, sin pérdidas ni reorden.
  - Tabla con fila extensa seguida de varios párrafos en la última página, aprovechando el espacio sobrante.
  - Dos tablas y dos párrafos en orden, sin saltos artificiales.
  - Entrada inválida, modo antiguo mezclado y flujo vacío.
- Se conservan las 11 pruebas Node de unidades anteriores y los tests Rust del paginador de filas.
- `examples/flow-usage.mjs` generó `artifacts/flow-first.pdf` de **9 páginas A4** con un párrafo de **1,100 tokens**, dos tablas y **72 registros** en la segunda tabla. Extracción independiente confirmó todos los tokens y el orden.
- Inspección de vista previa detectó un espacio insuficiente entre tabla y párrafo; corregido usando `padding_before` en la geometría del planificador. Se regeneró el PDF y verificó visualmente el espacio.
- Calidad: ejecutar `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace`, `bash scripts/verify-experiments.sh` y `npm test`.

## Límites conocidos

- Tamaño A4 fijo, alineación y estilos esencialmente predeterminados.
- Fragmentación por **líneas**, no palabras ni grafemas; una palabra indivisible demasiado ancha da error.
- No control de viudas/huérfanas, viñetas, títulos semánticos, imágenes, celdas fusionadas, tablas anidadas ni otros elementos de layout de bloques.
- Parley mide con la fuente indicada; Krilla todavía dibuja texto simple por línea. Soporte complejo RTL/fallback no validado.
- Render síncrono, output en memoria y binario nativo local Linux x64. Sin publicación en npm/crates.io.
- No se ha realizado verificación geométrica automática píxel a píxel: la revisión visual es exploratoria. Antes de producción se requieren pruebas gráficas de regresión.

## Siguiente objetivo sugerido

Evolucionar la representación del documento hacia un **AST de bloques extensible** y capacidades de estilos/página. Para despliegues Node en servidor, implementar posteriormente una versión asíncrona que no bloquee el hilo del event loop.
