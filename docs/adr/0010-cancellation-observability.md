# ADR-0010 — Cancelación cooperativa nativa y métricas de render

- **Fecha:** 2026-10-16
- **Estado:** aceptada para el prototipo (Unidad 09), no contrato estable de producción.

## Contexto

La Unidad 07 introdujo `renderPdfAsync` en pool libuv, y la Unidad 08 controló la admisión con `PdfRenderQueue`. Anteriormente, `AbortSignal` solo retiraba trabajos en espera; un render Rust iniciado podía consumir CPU hasta completar.

## Decisiones

1. Mantener `renderPdf` síncrona y `renderPdfAsync(document,font)` compatibles.
2. Añadir `renderPdfAsync(document,font,{signal})` y `renderPdfAsyncMeasured(document,font,{signal})` al SDK. La segunda devuelve `{pdf,renderMs}`, donde `renderMs` se mide con `std::time::Instant` dentro del worker Rust (en milisegundos).
3. Introducir un `PdfCancellationToken` N-API que comparte `Arc<AtomicBool>` entre el hilo Node y el render Rust. `cancel()` activa el flag sin bloquear; el worker comprueba `Ordering::Relaxed` y termina con `RenderError::Cancelled`.
4. Comprobar cancelación antes de empezar, entre párrafos, filas, celdas, fragmentos y páginas, y antes de serializar PDF. No se pueden interrumpir llamadas indivisibles a Parley, Krilla o a la serialización final; no prometer cancelación instantánea.
5. No producir un archivo PDF parcial cuando una tarea se cancela: el resultado será una promesa rechazada con `PdfRenderCancelledError` y `code='ABORTED'`.
6. Permitir `AbortSignal` en `PdfRenderQueue` tanto en espera como durante el render activo; `waitTimeoutMs` sigue siendo **solo un límite de espera**, no de ejecución.
7. Instrumentar el scheduler de manera **acotada**, sin retener trazas por cada trabajo: `onJobEvent(event)` recibe `outcome` (completed/failed/cancelled/rejected), `queueMs`, `renderMs` si hubo render, `estimatedInputBytes`, `outputBytes` en completados y `errorCode` cuando aplique. La cola guarda contadores acumulativos `cancelled`, `totalQueueMs`, `totalRenderMs`, `lastRenderMs`.
8. Proteger la cola de errores en callbacks de instrumentación: una excepción lanzada por el observador se ignora y no retiene slots.

## Medición

- Los renders correctos informan `renderMs` medido por Rust en el worker.
- Los renders fallidos o cancelados informan duración wall-clock aproximada desde Node hasta el rechazo (incluye coordinación de hilos y entrega de resultado).
- `queueMs` y los totales del scheduler se miden con `Date.now` y son duraciones aproximadas; no constituyen un perfilador de CPU ni histograma distribuido.
- No incluye los tiempos de validación/clonado de inputs inicial ni mide RSS de memoria, consumo de CPU por proceso o bytes de salida parciales.

## Limitaciones

- La cancelación es **cooperativa**, no destructiva: el abort puede tardar hasta el próximo checkpoint. Un render que ya completó puede devolver un PDF si el abort ocurre demasiado tarde.
- No existe timeout total de render, cancelación forzada de terceros, streaming ni garantía de deshacer efectos externos (el motor genera bytes in-memory).
- La cola y métricas son locales por proceso/instancia; para múltiples pods/tenants se necesita observabilidad y coordinación externa.
- El control de `maxQueuedBytes` sigue siendo una **estimación de memoria de inputs pendientes**, no un límite real de RAM/pico nativo.
- El SDK permanece experimental y el binario verificado actualmente es Linux x86_64.
