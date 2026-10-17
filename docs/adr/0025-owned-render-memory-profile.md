# ADR-0025 — Consumo owned del AST y perfilado de RSS nativo

**Fecha:** 2026-10-17 · **Estado:** implementado localmente
**Unidad:** 24 · **Rama:** `feature/unit24-native-memory-profiling`

## Problema y evidencia

Desde la Unidad 23, la frontera NAPI ya entrega `SemanticDocument`
owned. Sin embargo, `render_semantic_flow` recibía `&[ContentNode]`
y hacía:

```rust
canonical.iter().cloned().map(PdfBlock::try_from)
```

Esto duplicaba en memoria las imágenes anidadas en box, row y tabla
durante la construcción del modelo del pintor. En un trabajo rico en
imágenes la clonación no aportaba semántica ni seguridad.

## Decisión

La API Rust de renderizado **consume** el `SemanticDocument`. Se
elimina deliberadamente la firma borrowed anterior; Vufra es pre-v1
y no se añaden wrappers de compatibilidad.

- `render_semantic_pdf(document: SemanticDocument, ..)` y
  `render_semantic_pdf_with_cancel(document: SemanticDocument, ..)`
  reciben ownership por valor.
- El renderer valida los recursos sobre `&[ContentNode]` antes
  de mover el árbol, separando validación semántica de validación
  de estructuras destinadas al pintor.
- La conversión a `PdfBlock` usa
  `canonical.into_iter().map(PdfBlock::try_from)`. Los buffers
  `Vec<u8>` se **mueven** sin duplicarse en esta conversión.
- NAPI sync entrega el `SemanticDocument` por valor. NAPI async
  guarda `Option<SemanticDocument>` y toma el documento una sola vez
  en `Task.compute()`; no retiene una copia adicional en el worker.
- Se actualizó el ejemplo Rust `owned-semantic.rs` y los tests
  de render/cancelación. Se añadió una prueba que comprueba identidad
  de los punteros de imágenes nested en box, row y tabla styled.
- No se cambian snapshots de `PdfRenderQueue` o `toDocument()`
  del SDK: esas copias siguen siendo necesarias por contratos
  de inmutabilidad y aislamiento frente a mutaciones externas.

## Perfilado reproducible

Script: `scripts/benchmark-native-memory.mjs`:

```bash
node scripts/benchmark-native-memory.mjs regular.ttf bold.ttf 3
```

Cada ejecución es un proceso Node nuevo, con PDF verificable de 27
páginas, 450 filas enriquecidas y 24 imágenes PNG (10.6 MB de input
nativo entre todas); comprueba que todos los 450 IDs sobreviven en orden.
Usa `process.resourceUsage().maxRSS` expresado en MiB
(al reportar KiB en Linux), `performance.now()` para render/build,
e informa también heap y RSS final de proceso.

### Datos de esta máquina (tres procesos por variante)

| Medida, mediana | Base antes de cambiar el renderer | Después |
|---|---:|---:|
| RSS máxima del proceso | 150.67 MiB | 139.91 MiB |
| Render nativo vía `.render()` | 355.46 ms | 353.79 ms |
| PDF final | 514 161 bytes | 514 161 bytes |
| Páginas | 27 | 27 |
| IDs de tabla conservados | 450/450 | 450/450 |

**Diferencia observada en RSS máxima: −10.76 MiB, aprox. −7.1 %.**
El tiempo resultó esencialmente igual en este ensayo (diferencia
~1.7 ms, no concluyente). En una comprobación adicional de cinco
procesos posteriores, mediana RSS fue 138.69 MiB y 356.74 ms de render.

Este **no** es un benchmark universal. `maxRSS` incluye heap JS,
nativo, fuentes, imágenes, configuración, cachés y pintura;
no separa el pico nativo ni representa el uso de memoria de una
carga concurrente de servidores. No atribuir todo el ahorro observado
exclusivamente a un componente interno sin profiling de allocator.
Los tiempos incluyen la fase de renderizado del puente API; se usa
el mismo entorno y los mismos archivos de fuentes.

## Invariantes y límites

- El modelado y pinta de imagen (Krilla) puede copiar datos para
  parsear/comprimir fuentes e imágenes. No existe cero copia
  extremo a extremo (JS → NAPI → Rust → Krilla).
- El worker async no se puede ejecutar dos veces; la toma única
  con `Option::take` produce un error explícito.
- Cancelación cooperativa, PDF extraíble, header repetido,
  validación de geometría, límites de recursos y aislamiento
  de trabajos en cola deben seguir funcionando.
- La siguiente unidad podría perfilar copias separadas de fuentes
  y decodificación/cachés de imágenes; requiere medirlas antes
  de cambios de ownership más amplios.

## Referencias

- `crates/vufra-pdf/src/lib.rs`
- `crates/vufra-pdf/src/flow_render.rs`
- `crates/vufra-pdf/src/semantic.rs`
- `bindings/vufra-node/src/lib.rs`
- `scripts/benchmark-native-memory.mjs`
- `docs/experiments/25-owned-render-memory-milestone.md`
