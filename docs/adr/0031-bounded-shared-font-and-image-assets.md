# ADR-0031 — Compartir fuentes adicionales e imágenes con retención acotada

**Fecha:** 2026-10-17 · **Estado:** implementado y verificado localmente
**Unidad:** 30 · **Rama:** `feature/unit30-reusable-fonts-and-images`
**Base:** Unidad 29 `403fba1` (rama local; no push ni merge).

## Contexto

Unidad29 añadió `NativeFont` para compartir la fuente regular.
Sin embargo, `fontFaces` seguía convirtiendo cada fuente bold/fallback
desde un `Buffer` a `Vec<u8>` en cada PDF. Las imágenes PNG/JPEG
de NAPI también copiaban sus bytes codificados por cada aparición y
`PdfImage::prepare` copiaba de nuevo esos bytes al llamar a Krilla.

Se midieron ocho PDFs desde un único factory, cada uno con una fuente
bold y una imagen PNG. La fuente regular y los datos gráficos son
externos, por lo que deben mantenerse los snapshots de Node, pero
resulta innecesario repetir las copias del mismo contenido ya aislado.

## Decisión

1. Se introduce `NativeAssets`, un recurso **interno** NAPI por
   instancia `Vufra`, con fuentes adicionales named e imágenes
   codificadas en memoria nativa inmutable (`Arc<Vec<u8>>`).
2. `PdfFontFace.data` y `PdfImage.data` pasan a ser
   `Arc<Vec<u8>>`. La conversión NAPI y `FontRegistry` conservan
   el mismo buffer, y la preparación Krilla PNG/JPEG también utiliza
   un `Arc`, sin clonar el `Vec` de bytes codificados.
3. Una `NativeAssets` registra imágenes mediante
   `registerImage(Buffer)`. El índice es estable y la deduplicación
   utiliza una huella `u64` para seleccionar candidatos **más una
   comparación exacta del contenido**; una colisión no fusiona
   imágenes diferentes.
4. El caché de imágenes es **por factory**, no global, y está
   acotado a **256 recursos únicos / 64 MiB residentes**. Si se llena,
   devuelve `-1`; el normalizador envía ese contenido como buffer
   temporal inline, manteniendo PDFs válidos en vez de retener bytes
   indefinidamente.
5. `NodeImage` acepta **exactamente una fuente**:
   `assetId` o `data` (ambas privadas de NAPI). Los adaptadores
   recursivos de root, row, box, tabla y chrome resuelven el asset y
   conservan la misma identidad del `Arc` hasta el renderer.
6. Los presupuestos de imágenes se siguen cobrando **por aparición
   lógica dentro de un documento**, no por recurso único: máximo
   64 bloques de imagen, 32 MiB de bytes lógicos en total,
   8 MiB por imagen, 12MP por imagen y 24MP agregados. No se
   puede eludir el preflight apuntando 65 veces al mismo asset.
7. Se aplica retención selectiva para fonts:
   las fuentes extra individuales de hasta 2 MiB y conjunto de
   hasta 6 MiB pueden vivir con el factory. Si exceden esos límites
   internos de *retención*, se crean bundles nativos temporales
   **por render**, sin modificar el límite de aceptación del
   documento (hasta 12 MiB por cara, 30 MiB totales).
8. Los bundles temporales se liberan explícitamente llamando
   `NativeAssets.release()` **justo después** de la conversión
   síncrona de NAPI, aunque el trabajo asíncrono todavía se
   encuentre en el worker: este ya tomó sus `Arc` independientes.
   Así no depende la liberación de buffers grandes del GC de Node.
   Los bundles persistentes nunca se liberan en esa ruta.
9. `PdfRenderQueue` mantiene sus snapshots de admisión y usa un
   bundle temporal por trabajo. No se comparte memoria JS mutable
   entre workers ni recursos globales entre clientes.
10. La Fluent API pública sigue sin cambios:
    `createVufra({font,fonts})`, `.document()`,
    `.box()`, `.image()`, `.table()` y
    `.render()` funcionan igual. Las firmas nativas son
    intencionalmente incompatibles en este experimento; **sin
    adaptadores de compatibilidad**.

## Qué no se está cacheando

El caché de imágenes conserva únicamente los **bytes codificados**
PNG/JPEG. Un render diferente puede volver a construir la
representación `krilla::Image`. No se ha añadido un caché global de
objetos de PDF, bitmap/raster, glyph shaping o recursos entre procesos.

No hay zero-copy arbitrario desde JS: se crea **un snapshot inicial
owned** al registrar el recurso. La propiedad y la seguridad de los
workers se mantienen.

## Benchmark reproducible y control de regresiones

```bash
# Font bold real, 631.484 bytes
node scripts/benchmark-reused-assets.mjs REGULAR.ttf BOLD.ttf 3 0
# Misma TTF válida rellenada artificialmente a 10 MiB
node scripts/benchmark-reused-assets.mjs REGULAR.ttf BOLD.ttf 3 10
```

Cada iteración independiente de proceso Node genera **8 PDFs**
con el mismo `createVufra`, una imagen PNG y una línea bold por PDF,
verifica los ocho títulos/textos y usa Poppler para validar los
objetos raster. PDF total: **117.664 bytes, ocho páginas,
ocho objetos imagen**. Los hashes agregados de los PDF resultaron
binariamente iguales antes y después:

`1c7f822c7066400c7c957ee9751a88f1946851ac86172dbaa28447ab9707fdcd`.

| Mediana de 3 procesos independientes | Unidad 29 | Unidad 30 |
|---|---:|---:|
| Fuente bold real: máximo RSS total Node | 91,04 MiB | 91,69 MiB |
| Fuente bold real: generación + Poppler | 198,09 ms | 207,45 ms |
| Bold artificial de 10 MiB: máximo RSS | 119,65 MiB | 120,26 MiB |
| Bold artificial: generación + Poppler | 200,63 ms | 211,37 ms |
| PDF e imágenes | idénticos | idénticos |

Estos datos **no demuestran una mejora de tiempo o pico RSS** en
esta carga. Incluso se observó una ligera regresión (posiblemente
debida a retención y trabajo extra de huellas). La ventaja
estructural probada es que una fuente adicional pequeña y un
PNG repetidos pueden compartir **una asignación nativa inmutable**,
sin copiar sus bytes por cada documento.

### Incidencia detectada durante la implementación

La primera versión mantenía cualquier fuente extra persistentemente:
con la TTF artificial de 10 MiB, el máximo RSS subió de unos
119–120 MiB a **170 MiB**, una regresión inaceptable. Se corrigió
introduciendo la política de retención selectiva y liberando
explícitamente los assets temporales tras el `parse_document`
de NAPI; el pico posterior volvió aproximadamente a los 120 MiB.
El control con una bold real quedó en ~91 MiB.

No se debe usar un benchmark de font rellena artificialmente
como sustituto de medir tipografías realmente complejas. Las cifras
incluyen proceso Node, GC, Krilla/Parley y el propio Poppler
en las mediciones de tiempo.

## Pruebas y seguridad

- Rust: pruebas de identidad de asignación con `Arc::ptr_eq`
  para fuentes adicionales e imágenes PNG codificadas.
- Node: las imágenes idénticas registran el mismo ID por bytes
  exactos, aunque provengan de `Buffer` distintos; modificar
  luego la fuente bold o el PNG original no afecta PDFs nativos.
- Node: trabajos async paralelos usan sus propios `Arc` y emiten
  PDFs binariamente iguales al render sync.
- Node: **65 referencias al mismo ID** siguen rechazándose
  por los presupuestos del documento, y un ID desconocido falla.
- Node: al llegar a 256 recursos únicos, la caché devuelve `-1`
  y el normalizador genera correctamente un PDF con PNG inline;
  las IDs previas siguen siendo válidas.
- Fluent: un documento con logo y rich bold compuesto antes de
  mutar los datos del llamador sigue generando el mismo PDF.
- Las suites de colas, cancelación, cabeceras repetidas,
  validación de fuentes y paginación siguen incluidas.

## Límites y decisión futura

La retención tiene costo fijo de memoria por factory incluso
cuando no hay render simultáneo. Se deben cerrar las instancias
cuando termina su vida útil y no compartir una instancia entre
tenants sin decidir explícitamente su scope. No implementar
cachés globales ni `unsafe` para eliminar la copia JS→Rust.
Antes de más optimizaciones, perfilar memoria/residencia
con recursos raster de tamaño real y concurrencia.

**Entrega:** solo rama local Unit30; no merge/push ni CI remoto.
