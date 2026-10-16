# Unidad 09 — Cancelación cooperativa y telemetría de trabajos PDF

**Fecha:** 2026-10-16. **Estado:** prototipo implementado, verificado localmente.

## Entregado

- **Motor Rust**: `render_pdf_with_cancel(...,&AtomicBool)` y `RenderError::Cancelled`, con checkpoints en medición y paginación de documentos antiguos, tablas multicolumna y compositor de bloques.
- **N-API**: `PdfCancellationToken` expone un flag atómico compartido. `Task::compute` ejecuta `render_pdf_with_cancel` en worker libuv y mide el tiempo con `Instant`.
- **SDK TypeScript**:
  - `renderPdfAsync(document,font,{signal?:AbortSignal})` mantiene el tipo de salida `Promise<Uint8Array>`.
  - `renderPdfAsyncMeasured(document,font,{signal?})` devuelve `{pdf,renderMs}`.
  - `PdfRenderCancelledError.code === 'ABORTED'` identifica el aborto de un trabajo en ejecución.
  - `renderPdf` sincronía sigue disponible.
- **Cola**: `PdfRenderQueue` propaga AbortSignal a la tarea activa, libera slot y drena espera tras cancelación o fallo. `waitTimeoutMs` **no** se convierte en timeout de CPU.
- **Observabilidad**: `onJobEvent` opcional + `queue.stats`, con tiempo en cola, duración nativa o wall estimada, salida en bytes y estado. Sin retener un historial completo ni requerir Redis/Prometheus.
- **NestJS**: ejemplo de servicio singleton acepta señal de abort externa opcional, configura espera máxima y emite eventos de resultado/timing por Logger de Nest (solo ejemplo; no se ha compilado dentro de aplicación Nest).

## Cómo probar

```bash
bash scripts/build-native.sh
cd packages/vufra && npm ci && npm run build && npm test && cd ../..
FONT=$(fc-match 'Noto Sans' -f '%{file}\n' | head -1)
node examples/cancellation-observe.mjs "$FONT"
pdfinfo artifacts/cancel-recovered.pdf
```

## Evidencia funcional

- Un render con 9.500 filas se abortó durante la ejecución; el error resultante fue `ABORTED`, sin PDF parcial.
- Un segundo trabajo en espera continuó y escribió `artifacts/cancel-recovered.pdf`, de una página, con texto extraíble.
- El ejemplo registró dos eventos (cancelled/completed), la cola finalizó con `active=0`, `queued=0`, `failed=0`, `cancelled=1`, `completed=1`.
- Pruebas Rust prueban el error de cancelación distinto de errores de fuente. Pruebas Node validan aborto antes de inicio, aborto durante render antiguo y tabla extensa, liberación de slots, tiempos y observador que arroja excepciones, así como toda la regresión anterior.
- Regresión de experimentos original con pdfinfo/pdftotext y paquete npm instalado localmente: verificar antes de cerrar unidad.

## Advertencias

- Abortar no mata el worker ni interrumpe el interior de Parley/Krilla; depende de checkpoints.
- `onJobEvent` no es un sistema de tracing distribuido. Se recomienda correlacionarlo con IDs y exporter en la aplicación consumidora.
- Aún sin RSS/cupo de output, temporizador de duración total, límites por tenant o streaming real.
