# ADR-0029 — Propiedad de buffers entre NAPI y Rust sin eliminar snapshots seguros

**Fecha:** 2026-10-17 · **Estado:** implementado y verificado localmente
**Unidad:** 28 · **Rama:** `feature/unit28-owned-font-napi`
**Base:** Unidad27 `486ae4e`; Unidades24–27 siguen locales.

## Auditoría real de copias en NAPI

Se inspeccionó el código instalado de `napi-rs 3.14.2`. El tipo
`Buffer` obtenido con `FromNapiValue` retiene una referencia al
buffer de Node y expone sus bytes directamente. No transfiere la
propiedad exclusiva de esa memoria. Es memoria que JavaScript puede
modificar mientras corre el trabajador nativo.

`Buffer::to_vec()` y `From<Buffer> for Vec<u8>` copian los bytes.
Para trabajos asíncronos esta copia **es necesaria** salvo que exista
un mecanismo explícito y seguro de transferencia y detach del origen.
Vufra no introduce punteros inseguros, aliasing entre hilos ni
`Buffer` mutable accesible desde un worker como supuesto zero-copy.

### Copias antes de la Unidad 28

En el caso asíncrono:

1. JS → NAPI: `font_data.to_vec()` crea snapshot de la fuente.
2. NAPI → Rust: `&self.font_data` prestaba ese snapshot.
3. `flow_render::render_writer_flow` hacía otra
   `font_bytes.to_vec()` para `Arc<Vec<u8>>` (Krilla y font registry).
4. Por separado, Fontique recibía **otro**
   `Arc::new(font_bytes.to_vec())`, duplicando por segunda vez el
   buffer de fuente una vez dentro de Rust.

Las imágenes y las fuentes adicionales aún requieren una copia de
entrada NAPI para sus propios modelos Rust. La API Fluent clona datos
cuando recibe valores externos y la cola crea snapshots de trabajos.

## Decisión técnica

- La API Rust `render_semantic_pdf` y la variante con cancelación
  consumen ahora `Vec<u8>` de la fuente principal **por valor**.
  El cambio de firma es incompatible de forma intencional; no se
  añaden adaptadores de compatibilidad pre-v1.
- `render_semantic_flow` y `render_writer_flow` también consumen
  el buffer por propiedad. Después de los preflights, se envuelve
  en `Arc::new(font_bytes)` **sin copiar su contenido**.
- `krilla::Font::new`, `fontique::Blob` y `FontRegistry`
  comparten clones ligeros del **mismo Arc**.
- NAPI sync hace una única copia segura del Buffer proporcionado
  por JS y transfiere ese `Vec<u8>` a Rust.
- NAPI async ya había creado ese snapshot; el trabajo lo mueve
  una sola vez mediante `std::mem::take(&mut self.font_data)`
  en `Task::compute`. No modifica el `Buffer` de JS, no presta
  su memoria al worker y mantiene cancelación.
- Las copias de imágenes y fuentes adicionales a la entrada NAPI
  permanecen intencionadamente por aislamiento e inmutabilidad.
  La salida PDF `Buffer::from(Vec<u8>)` sigue pasando la memoria
  Rust owned a Node sin clonar ese `Vec` en la construcción NAPI.

## Pruebas de seguridad y propiedad

- Rust: `owned_font_vec_moves_to_single_krilla_fontique_allocation`.
  Comprueba identidad de dirección del `Vec` de 3 MiB antes/después
  de envolverlo en `Arc`, y que `krilla::Data` y
  `fontique::Blob` conservan la misma dirección de bytes
  compartidos, sin copias adicionales.
- Node: `native async snapshots regular font, additional bold face and PNG against caller mutation`.
  Genera un PDF de referencia sync, inicia un async con esos datos,
  modifica inmediatamente los bytes de la fuente regular, bold y
  PNG originales y comprueba **PDF binariamente idéntico** al
  snapshot de referencia.
- Pruebas existentes de cancelación, trabajos en paralelo,
  snapshots de cola, errores de fuentes, imágenes y presupuestos
  continúan activas.

## Benchmark reproducible

```bash
node scripts/benchmark-napi-font-ownership.mjs REGULAR.ttf BOLD.ttf 3
```

Para poner bajo estrés las copias de bytes sin requerir una fuente
grande poco común, el script **rellena una TTF regular válida con
ceros finales hasta 10 MiB** en un directorio temporal. El contenido
de glifos real sigue siendo el de la fuente original (Noto Sans
Regular, 621.572 bytes); no se simula una tipografía compleja
de diez megabytes. El archivo temporal se elimina al terminar.

Se renderizan ocho filas rich largas, 2.640 IDs, 13 páginas,
39.119 bytes de PDF, tres procesos Node independientes por versión.

| Mediana de 3 procesos | Antes (Unidad 27) | Después (Unidad 28) |
|---|---:|---:|
| Max RSS del proceso | 136,46 MiB | 116,52 MiB |
| Render | 89,26 ms | 86,18 ms |
| PDF | 39.119 bytes, 13 páginas | igual |
| IDs | 2.640/2.640 | igual |

**Diferencia observada:** −19,94 MiB (−14,6 %) de pico RSS para
esta carga sintética. Es consistente con evitar dos copias completas
de una fuente de 10 MiB, **pero** `maxRSS` incluye el proceso entero,
asignador, JS, NAPI y renderer, sin atribución aislada. La diferencia
de tiempo es pequeña y no permite proclamar speedup general.
Otra medición posterior arrojó 116,56 MiB/84,82 ms.

### Control con fuentes normales e imágenes

Benchmark existente con Noto Sans normal, 450 filas styled,
24 PNG y 27 páginas de 514.161 bytes:

| Mediana de 3 procesos | Antes | Después |
|---|---:|---:|
| maxRSS | 136,57 MiB | 133,63 MiB |
| render | 351,53 ms | 356,23 ms |

El ahorro fue pequeño (~2,94 MiB) y la velocidad no mejoró:
**no extrapolar la ganancia de la fuente sintética**. El benchmark
de filas con PNG sobre 40 páginas mantiene 497.061 bytes,
y mediana de 162,43 ms / 115,84 MiB tras el cambio.

## Límites y próxima decisión

No se ha eliminado la copia inicial JS→NAPI porque eliminarla
introduciría una carrera de datos. Optimizar más este límite
requeriría una API explícita de transferencia de ownership con
semántica de detach o un recurso nativo inmutable manejado desde
Rust y con reglas claras de duración, cancelación y concurrencia.
**No implementar con `unsafe` para conseguir un "zero-copy" nominal.**

No se modifica la Fluent API ni se añade compatibilidad con la vieja
sintaxis. Entrega local, sin merge ni push.
