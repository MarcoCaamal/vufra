# ADR-0009 — Control local de concurrencia para renders PDF

- **Fecha:** 2026-10-16
- **Estado:** aceptada para prototipo experimental (Unidad 08).
- **Licencia:** MIT OR Apache-2.0.

## Contexto

La Unidad 07 implementó `renderPdfAsync` mediante N-API/AsyncTask en el pool de libuv. Cada invocación puede consumir CPU y memoria; invocaciones concurrentes sin restricción pueden agotar el pool y degradar otros servicios Node/NestJS.

## Decisión

Crear `PdfRenderQueue` por proceso con una cola FIFO **explícita y opt-in** delante de `renderPdfAsync`. La API sin cola sigue disponible, sin romper compatibilidad.

Opciones: `maxConcurrent`, `maxQueued`, `maxQueuedBytes` y `maxJobBytes` (valores predeterminados 2, 16, 64 MiB, 32 MiB). La validación evita límites 0/negativos cuando son inválidos; `maxQueued=0` deshabilita la espera.

La entrada se mide **aproximadamente** como tamaño de fuente más doble del número de caracteres de la serialización JSON. Se rechazan trabajos excesivos **antes de clonar las entradas**, y solo entonces se crean snapshots de documento (`structuredClone`) y fuente (`Uint8Array.from`). Esta medida no limita memoria real de Parley, Krilla o PDF final: es solo un presupuesto sobre entradas en espera.

Cuando se agota el cupo, el rechazo tiene `PdfQueueError.code`: `QUEUE_FULL`, `JOB_TOO_LARGE`, `ABORTED`, `WAIT_TIMEOUT` o `CLOSED`.

El método `render(document,font,{signal?,waitTimeoutMs?})` acepta `AbortSignal` y límite de espera **solo mientras el trabajo está en cola**. Una vez iniciado el render nativo, no existe cancelación cooperativa: incluso si el `AbortController` se dispara después, el trabajo prosigue y mantiene su cupo hasta finalizar. Un `waitTimeoutMs` no constituye un timeout de generación.

El cierre `close()` es idempotente: rechaza entradas en espera y nuevas solicitudes, pero deja que las ya iniciadas terminen. `stats` ofrece contadores instantáneos de activos, en espera, bytes estimados en espera, completados, fallidos y rechazados.

## Alternativas descartadas por ahora

- Poner un semáforo alrededor de `renderPdfAsync` que admita cola **sin límite**.
- Cancelar/prometer timeout para un render Rust ya en marcha sin soporte real en el motor.
- Usar BullMQ/Redis como requisito para todos los usuarios (este scheduler es deliberadamente local y sin persistencia).
- Interceptar/alterar el método público `renderPdfAsync`; la cola es opt-in y explícita.

## Riesgos y continuidad

- Cada instancia de `PdfRenderQueue` tiene sus propios límites: varias instancias, procesos, worker threads, pods o servidores **no comparten cuota**. Crear un singleton NestJS por proceso y gestionar límites globales con coordinación externa cuando sea necesario.
- El worker pool libuv es compartido con otras funciones Node; limitar trabajos Vufra no aísla totalmente los recursos.
- La instantánea y validación se ejecutan en el hilo JS; un documento inmenso todavía podría causar latencia antes del encolado.
- No existe cuota de tamaño del resultado, límite de RSS, streaming, persistencia, ordenamiento por prioridad, cuotas por tenant ni cancelación de trabajos ya iniciados.
- La cola **no equivale a** un job queue distribuido ni a ejecución lista para producción. Implementar métricas de duración, propagación de IDs, política por tenant, observabilidad y abortos cooperativos más adelante.
