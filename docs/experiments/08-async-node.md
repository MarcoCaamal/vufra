# Unidad 07 — API asíncrona para Node.js y NestJS

**Estado:** implementación experimental ejecutable, 2026-10-16.

## Entregado

- `renderPdfAsync(document, font): Promise<Uint8Array>` desde `packages/vufra/src/index.ts`, tipado mediante TypeScript.
- `renderPdfAsyncNative` en `bindings/vufra-node/src/lib.rs` usa napi-rs `AsyncTask`, ejecutado en el pool de libuv.
- `parse_document` compartida entre APIs síncrona y asíncrona, sin duplicar reglas ni construir otro motor PDF.
- La función síncrona `renderPdf` permanece disponible y compatible.
- `examples/async-usage.mjs`: 3.000 filas desde el SDK nativo async, archivo `artifacts/async-first.pdf` (151 páginas Letter en la corrida realizada), extrayendo todos los IDs.
- `examples/nestjs/pdf.service.ts` y `pdf.controller.ts`: archivos de referencia para **copiar a un proyecto NestJS**, no compilados ni ejecutados dentro de este repo. Usan `await renderPdfAsync` y `StreamableFile`.

## Contrato de TypeScript

```typescript
import { renderPdfAsync } from 'vufra';

const bytes = await renderPdfAsync({
  title: 'Reporte de octubre',
  blocks: [
    { type: 'heading', level: 1, text: 'Reporte' },
    { type: 'paragraph', text: '¡Hola, Cancún!' }
  ]
}, fontBytes);
```

- Recibe exactamente los mismos argumentos que `renderPdf`.
- Devuelve promesa que resuelve a bytes PDF estándar; errores de validación/generación rechazan la promesa.
- Reutiliza el mismo PDF writer, fuentes/medición y paginación del núcleo Rust.

## Evidencia de pruebas

- `packages/vufra/tests/async.test.mjs`: 5 tests:
  1. PDF con flujo y tabla: mismo texto seleccionable y mismo número de páginas en los caminos sync y async.
  2. Documento pesado con 9.500 filas: una iteración `setImmediate` de Node puede transcurrir antes de que el trabajo termine; los 9.500 IDs están presentes, en orden.
  3. Cuatro jobs concurrentes de 350 filas cada uno: ninguna filtración/copia cruzada de tokens.
  4. Errores de título, fuente, geometría y palabra no fragmentable rechazan la promesa.
  5. Mutar el Buffer de fuente y un texto inmediatamente tras enviar el trabajo no altera el resultado, demostrando propiedad/aislamiento de entradas.
- Regresión: 22 tests previos de Node y 27 de Rust se mantienen verdes.
- `npm pack` local instalado en un consumidor Node independiente, ejecutando la nueva API asíncrona y generando un PDF válido (sin publicación).
- `scripts/verify-experiments.sh`, Rust clippy/fmt/test y `npm ci/build/test` continúan funcionando.

## Límites para uso de servidor

- `UV_THREADPOOL_SIZE` puede cambiar el tamaño del pool de libuv **antes de arrancar Node**, pero ese pool también atiende otras tareas Node. Ajustarlo tras medir; no recomendar aumentarlo indiscriminadamente.
- Deben existir límites por tenant/usuario, máximo de jobs concurrentes, límites de memoria y política de timeouts a nivel de la aplicación.
- El render de cada documento consume memoria y CPU durante toda la tarea. No se pueden cancelar tareas en marcha con esta API.
- `renderPdfAsync` no convierte a Vufra en apto automáticamente para producción: falta soporte multiplataforma, observabilidad del job, backpressure, manejo avanzado de fuente, y hardening.

## Siguiente unidad propuesta

1. Pool/concurrencia configurable o API de jobs para el SDK, con límites y backpressure.
2. Streaming incremental/archivos grandes, métricas y cancelación cooperativa (si el motor de composición lo permite).
3. Evolución del AST para imágenes, listas, estructuras semánticas y fuentes/fallback.
