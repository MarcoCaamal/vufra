# ADR-0026 — Fuentes compartidas y fragmentación de filas por movimiento

**Fecha:** 2026-10-17 · **Estado:** verificada localmente
**Rama:** `feature/unit25-font-sharing-row-fragments`
**Dependencia:** Unidad 24 `98e5830` (sin push/merge)

## Problema

Aunque la Unidad 24 quitó la copia profunda del AST, la preparación
de fuentes conservaba buffers separados en tres consumidores:

1. `krilla::Font::new(bytes.to_vec())`
2. `fontique::Collection::register_fonts(Blob::new(Arc::new(bytes.to_vec())))`
3. `FontSlot.source = bytes.to_vec()`, necesario para el verificador
   de glifos y fuentes fallback mediante `ttf_parser`.

El render raíz repetía también la copia para registrar la fuente
regular en Krilla y Parley, y `FontRegistry::new` recibía las fuentes
extra por referencia, volviendo a copiarlas.

Una segunda duplicación ocurría en `PdfRow::as_fragmentable_box`: una
vez expandidas las columnas en fragmentos, se reconstruía cada fila
con `.cloned()`, duplicando buffers de imágenes y `RichLine`
preparados, incluidas métricas `x`, font index, tamaño y RGB.

## Decisiones implementadas

- Cada fuente dispone ahora de un `Arc<Vec<u8>>` compartido.
  `Font::new(bytes.clone().into())`, `Blob::new(bytes.clone())`
  y `FontSlot.source = bytes` comparten **los mismos bytes**:
  clonación del `Arc` (incremento de contador), no del `Vec<u8>`.
- `FontRegistry::new(default: Arc<Vec<u8>>, extras: Vec<PdfFontFace>)`
  consume los buffers de las fuentes adicionales, que pasan a
  `Arc<Vec<u8>>` sin hacer copias.
- `render_writer_flow` reserva una única copia de los bytes
  de la fuente regular, necesaria porque recibe `&[u8]`, y
  comparte ese `Arc` con Krilla, la colección de Parley y
  `FontRegistry`. Las fuentes adicionales se transfieren
  desde `SemanticDocument` por valor.
- `PdfRow::assemble_fragment_columns` utiliza `VecDeque`
  por columna y `pop_front()` al crear segmentos sincronizados.
  Los fragmentos se **mueven** a los contenedores definitivos.
  La expansión inicial desde la fila original aún puede requerir
  copiar ciertos ítems debido a `&self`; la segunda copia de
  cada ítem quedó eliminada.
- Las firmas Rust cambiaron donde era necesario; **sin wrappers
  de compatibilidad** en la fase experimental pre-v1.

## Seguridad y comprobaciones

- Test Rust `krilla_data_and_fontique_blob_share_one_arc_byte_buffer`
  comprueba la dirección original del buffer y la identidad
  compartida entre tipos de las bibliotecas sin fuente del sistema.
- Test Rust
  `synchronized_fragments_move_images_and_rich_runs_without_cloning`
  comprueba punteros `Vec<u8>::as_ptr` de imagen y `String::as_ptr`
  del rich fragment tras el ensamblaje, orden de columnas,
  justificación, color RGB, índice de fuente y segmentos vacíos.
- La API Fluent, fallback, encabezados repetidos, cancelación,
  aislamiento de cola, límites de 500 fragmentos, 8 niveles,
  presupuestos de imágenes y bytes no cambian.
- Las pruebas Node verifican fuentes embebidas, glifos,
  texto enriquecido, repetición de encabezados y paginación.

## Benchmark reproducible

```bash
node scripts/benchmark-font-rows.mjs REGULAR.ttf BOLD.ttf 3
```

El script usa procesos Node independientes; ocho filas muy largas
con texto rich en dos columnas, 125 tokens bold + 125 regular +
80 tokens por columna secundaria en cada fila. Valida
**2 640 identificadores únicos en orden**, PDF de **13 páginas**
y **39 119 bytes** en ambas versiones.

| Medición, mediana de 3 procesos | Unidad 24 (antes) | Unidad 25 (después) |
|---|---:|---:|
| RSS máxima, proceso Node | 93.39 MiB | 89.64 MiB |
| Tiempo `.render()` | 131.89 ms | 124.21 ms |
| PDF | 39,119 B / 13 páginas | 39,119 B / 13 páginas |

**Diferencia de RSS observada:** −3.75 MiB (aprox. −4.0 %).
La diferencia de tiempo de 7.68 ms es observación local con poca
muestra y fluctuación de scheduler/JIT: **no constituye speedup
estable demostrado**. Comprobación adicional post-cambio de cinco
procesos: mediana 89.66 MiB, 123.48 ms.

Como control adicional, `scripts/benchmark-native-memory.mjs` con
450 filas, 24 imágenes y 27 páginas produjo mediana después de
**134.99 MiB** de RSS máximo y 358.72 ms de render; son datos locales,
no un comparativo pareado de Unit24 en idénticas condiciones.

## Límites y siguientes unidades

- La frontera JS/Buffer → NAPI y Krilla aún pueden copiar datos.
  No es una solución totalmente zero-copy.
- El render preparado de imágenes genera representaciones Krilla
  y potencialmente decodificaciones.
- El flujo para texto fragmentable aún realiza shaping adicional
  al recibir una fila imposible de colocar completa; evitar esa
  repetición requiere guardar medidas/fragmentos desde el primer
  pase, con nuevos tests de precisión.
- Para medir atribución exacta por biblioteca haría falta un
  profiler de allocators nativos, además de RSS de proceso.

**No push ni merge a main.** Este ADR describe un commit local apilado
sobre Unidad 24, y no cambia la Fluent API pública.
