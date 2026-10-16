# ADR-0008 — Renderizado asíncrono en Node con N-API

- **Fecha:** 2026-10-16
- **Estado:** aceptada para el prototipo (Unidad 07); API experimental.

## Problema

`renderPdf()` ejecuta medición de texto, composición y serialización PDF de forma sincrónica dentro del hilo que lo invoca. En un backend NestJS, un documento grande bloquea el event loop y retrasa otras solicitudes.

## Decisión

- Conservar `renderPdf(document, font)` síncrona sin cambios.
- Añadir `renderPdfAsync(document, font): Promise<Uint8Array>` al SDK TypeScript.
- Ambas APIs usan **una sola función de normalización y validación** de argumentos TypeScript y **la misma conversión a `PdfDocument` Rust** en el binding N-API. La generación PDF sigue en `vufra-pdf::render_pdf`.
- `renderPdfAsyncNative` devuelve `AsyncTask<PdfRenderTask>` de napi-rs 3, con `Task::compute` ejecutándose en el pool nativo de libuv y `Task::resolve` construyendo `Buffer` en el hilo de Node.
- El trabajo es propietario de un `PdfDocument` Rust y una copia `Vec<u8>` de la fuente antes de entrar a la cola; no se retienen referencias a objetos JS durante `compute`.
- Usar **AsyncTask**, no envolver `renderPdf()` en `Promise.resolve`, porque una promesa alrededor del trabajo síncrono seguiría bloqueando el event loop.
- Evitar añadir Tokio para este trabajo CPU-bound, ya que el pool de libuv de N-API es suficiente para el primer hito.
- En TypeScript, `renderPdfAsync` es una función `async`, de manera que errores de validación se convierten en promesas rechazadas como errores de trabajo nativo.

## Alcance y límites

- El método es no bloqueante durante render PDF, pero **la validación y la copia inicial de inputs sí se realizan en el event loop**, así que no hay garantía de tiempo constante al enviarlo.
- `libuv` tiene un pool de hilos compartido con otras operaciones de Node. Concurrencia excesiva puede saturarlo, generar presión de memoria y ralentizar otras operaciones; NestJS debe tener límites de trabajos activos/encolados.
- Los PDFs siguen generándose **íntegramente en memoria**. No hay streaming incremental ni límite global de memoria entre tareas concurrentes.
- No se ofrece progreso, cancelación, timeout/cooperación de aborto, persistencia, jobs distribuidos o limitación automática de concurrencia.
- La promesa resuelve a `Uint8Array` a nivel de TS y `Buffer` en Node (subclase compatible). Fallos rechazados con mensajes del motor Rust.
- No publicar aún paquetes npm/crates.io ni declarar listo para producción.

## Pruebas

Tests E2E con Poppler validan equivalencia textual, 9.500 filas sin pérdida, reactividad de una iteración `setImmediate` mientras el trabajo corre, cuatro jobs simultáneos sin intercambio de datos, rechazo de errores y propiedad/copia de entradas modificadas tras encolar.
