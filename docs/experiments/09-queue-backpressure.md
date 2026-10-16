# Unidad 08 — Backpressure y cola de renders PDF para NestJS

**Fecha:** 2026-10-16. **Estado:** hito local experimental implementado.

## Entregado

- `packages/vufra/src/queue.ts`: `PdfRenderQueue`, `PdfQueueError`, opciones tipadas, métricas, snapshot de inputs, cola FIFO limitada, liberación de cupos tras éxito/error.
- La API `renderPdfAsync` de Unidad 07 sigue igual: la nueva cola es opt-in y solo llama la función asíncrona nativa cuando se libera un cupo.
- `render(document,font,{signal?,waitTimeoutMs?})`: abortar y timeout solo mientras el trabajo **espera**. Si el trabajo ya comenzó, prosigue sin interrupción.
- `close()` rechaza en espera/nuevos; el render activo sigue hasta resolver/rechazar.
- `stats` (solo lectura): active, queued, queuedBytes (estimado), completed, failed, rejected, closed.
- `examples/nestjs/pdf.service.ts` ahora tiene `PdfRenderQueue` como singleton por provider, lo cierra en `onModuleDestroy`, y expone `queueStats`. El controlador de ejemplo adapta errores de cola a HTTP; siguen siendo **snippets** que requieren una app NestJS externa.
- `examples/queue-usage.mjs`: tres PDF ejecutados por cola de un solo slot activo y dos en espera.

## Ejemplo

```typescript
import { PdfRenderQueue } from 'vufra';

const queue = new PdfRenderQueue({
  maxConcurrent: 2,
  maxQueued: 8,
  maxQueuedBytes: 24 * 1024 * 1024,
  maxJobBytes: 16 * 1024 * 1024
});

// En un singleton por proceso Node/NestJS:
const pdf = await queue.render(document, fontBytes, { waitTimeoutMs: 5_000 });

// Durante el apagado de la aplicación:
queue.close();
```

## Pruebas / evidencia

- `packages/vufra/tests/queue.test.mjs`: siete pruebas del scheduler: FIFO y saturación, abort/timeouts en espera, snapshot de entradas mutadas, fallo nativo y recuperación de slot, cierre idempotente, presupuesto de trabajos, instancias independientes.
- 27 pruebas Node previas siguen pasando; total esperado **34/34**.
- Las 27 pruebas Rust y los scripts de regresión de experimentos PDF anteriores siguen funcionando sin modificaciones.
- `examples/queue-usage.mjs` generó tres PDFs A4 de **32 páginas cada uno**, con 700 filas por PDF; los 2,100 identificadores fueron recuperados exactamente una vez en orden.
- `npm pack` local se instaló en `artifacts/queue-consumer`; otro programa Node creó un PDF usando `PdfRenderQueue`. Esto **no significa publicación**.
- El tamaño estimado de inputs pendientes y el número de trabajos se observaron cambiar a cero tras completar.
- El test no pretende probar resistencia a saturación real de memoria de producción: hacen falta mediciones de RSS/pico, benchmarks y límites de salida nativos.

## Límites

No hay cancelación del render iniciado, timeout de CPU ni streaming; el pool libuv y RAM son compartidos con Node. La cola es local por instancia/proceso; servidores replicados requieren coordinación externa, además de límites de tasa/autorización por tenant. El estado de Vufra sigue siendo prototipo experimental Linux x86_64.

## Próximos objetivos

- Instrumentación de duración, cola/renders activos y errores por motivo con contadores métricos.
- Límite de bytes de salida nativo y gestión de consumo memoria durante render.
- Cancelación cooperativa en el layout Rust para trabajos que lo soporten; diseñar un control de aborto real, no simplemente rechazar la Promise.
- Mejorar el motor documental (imágenes, listas, vectores y fuentes/fallback) sin perder las garantías de composición.
