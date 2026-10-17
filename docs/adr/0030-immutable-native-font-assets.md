# ADR-0030 — Fuentes nativas inmutables reutilizables, no transferencia falsa de ArrayBuffer

**Fecha:** 2026-10-17 · **Estado:** implementada y validada localmente
**Unidad:** 29 · **Rama:** `feature/unit29-native-immutable-font-assets`

## Hallazgo sobre propiedad y seguridad

Node permite transferir ciertos `ArrayBuffer` entre workers, pero no
garantiza transferibilidad de cualquier `Buffer`: los `Buffer`
compartidos del pool de Node no pueden transferirse, y una transferencia
real inutiliza otras vistas del mismo `ArrayBuffer`.
Documentación: https://nodejs.org/download/release/latest-v20.x/docs/api/worker_threads.html

El receptor de `napi-rs::Buffer` conserva una referencia a memoria
de JavaScript que sigue siendo mutable. Transferir un `ArrayBuffer`
entre workers JS **no convierte** esa memoria en un `Vec<u8>` que
Rust pueda administrar/liberar libremente. Retener un puntero a JS
durante un worker y asumir exclusividad crearía una carrera de datos,
especialmente con buffers compartidos.

**Decisión:** rechazar el falso zero-copy por detach, punteros `unsafe`
o memoria JS mutable compartida. Implementar un recurso **nativo
inmutable** que realiza un snapshot inicial y reutiliza esos bytes en
todos los renderizados de una misma instancia de Vufra.

## Implementación

- NAPI `NativeFont` es una clase con un `Arc<Vec<u8>>` privado.
  Su constructor recibe `Buffer` y valida tamaño `1..12 MiB`,
  copiando los bytes **una sola vez** al ingresar. No hay ningún
  getter de bytes o vista mutable; solo `byteLength`.
- La firma nativa de `render_pdf_native` y `render_pdf_async_native`
  acepta `&NativeFont`, no buffers crudos, intencionalmente sin
  adaptadores para la interfaz experimental previa.
- El trabajo async clona únicamente `Arc` en el hilo Node; se queda
  con una referencia propia hasta que termina o se cancela.
  El documento sigue tomando snapshots nativos al prepararse.
- El motor Rust `render_semantic_pdf` y `with_cancel`
  consumen `Arc<Vec<u8>>`, comparten esa memoria con Krilla,
  Fontique y el registro de fuentes, sin copias del payload regular
  al renderizar.
- `packages/vufra/src/renderer.ts` construye un recurso NAPI
  temporal para las llamadas internas que reciben buffers crudos;
  también acepta un recurso nativo preparado. El módulo es
  **interno**, no se reintrodujo `renderPdf` como export público.
- `createVufra({font})` crea el recurso inmutable **una vez**
  desde los defaults ya aislados; `.document()` y todas las
  ramificaciones Fluent lo comparten. Esto no requiere una nueva
  sintaxis de usuario.
- `.document({font:otro})` crea un recurso diferente desde
  un snapshot aislado del override, sin sobrescribir el default.
- Se dejó de duplicar en `.document()` la configuración privada
  que `Vufra` había copiado en constructor. Solo los overrides
  del caller se copian. `.toDocument()` sigue devolviendo
  snapshots profundos independientes.
- `PdfRenderQueue` mantiene `structuredClone(document)` y
  `Uint8Array.from(font)` al admitir trabajos; no se transfieren
  recursos privados de una cola a otra ni se rompe cancelación/FIFO.
- No se modifican los formatos de imagen ni se añade un caché global
  de recursos entre documentos, procesos o tenants.

## Pruebas

- `NativeFont` devuelve byteLength, no expone bytes,
  rechaza entrada vacía; después de modificar el buffer original,
  el mismo recurso genera un PDF válido.
- `createVufra` con un default produce múltiples PDFs
  incluso después de modificar el `Buffer` original;
  comprobación de renders async paralelos.
- Overrides de `font` quedan aislados de mutaciones posteriores
  y no afectan el recurso default.
- Pruebas existentes de cola, cancelación, aislamiento de buffers
  y preflight profundo migradas a la nueva firma NAPI sin wrappers
  de compatibilidad.

## Benchmark reproducible

```bash
node scripts/benchmark-reused-native-font.mjs REGULAR.ttf BOLD.ttf 3 10
# Control con la fuente original, sin relleno:
node scripts/benchmark-reused-native-font.mjs REGULAR.ttf BOLD.ttf 3 0
```

El benchmark genera **nueve documentos PDF consecutivos** desde
la misma instancia Fluent. El caso de estrés rellena con ceros
una TTF válida de Noto Sans a 10MiB para medir específicamente
copias, sin simular glifos complejos. Cada muestra usa
un proceso Node independiente, verifica nueve tokens por Poppler
y suma tamaños y páginas.

| Mediana de tres procesos (10MiB sintéticos) | Antes U29 | Después U29 |
|---|---:|---:|
| MaxRSS de todo Node | 172,57 MiB | 110,74 MiB |
| Tiempo para renderizar y verificar 9 PDFs | 205,00 ms | 163,72 ms |
| PDFs | 9 páginas, 86.701 bytes sumados | igual |

Diferencia local: **−61,83MiB (−35,8 %) de pico RSS** y
**−41,28ms (−20,1 %) del tiempo que incluye verificaciones Poppler**,
no únicamente el tiempo nativo. El benchmark específico es
artificial y no prueba un speedup general de Vufra.

Con fuente regular *real* sin relleno, tras el cambio se observaron
**90,00MiB de maxRSS** y **167,80ms** de mediana para nueve PDFs.
No se realizó control pareado anterior sin relleno: no inventar
comparación relativa de esa variante.

Los nueve documentos generados conservaron tamaño total
86.701 bytes y nueve páginas. El nuevo recurso reduce copias
redundantes al crear más de un documento desde el mismo factory.

## Límites de este alcance

- Sigue existiendo una copia inicial JS→Rust que establece propiedad
  real. **No es zero-copy desde un Buffer arbitrario**.
- Las fuentes extra `bold` y las imágenes siguen recibiendo su
  snapshot por documento. Un siguiente hito puede investigar
  recursos inmutables reutilizables para estas clases, priorizando
  simplicidad y presupuestos de memoria.
- Las clases NAPI se usan solamente en el puente interno; la API
  Fluent permanece sencilla y componible.
- Se conservaron límites de memoria, cancelación, robustez de
  errores y separación entre trabajos. Nada de alias de
  compatibilidad pre-v1.

## Entrega

Rama local basada en la Unidad 28. Sin push ni merge a main.
