# ADR-0032 — No compartir la imagen preparada de Krilla entre PDFs concurrentes

**Fecha:** 2026-10-17
**Estado:** decisión comprobada experimentalmente; se **rechaza** el caché de representación preparada entre documentos
**Unidad:** 31 · **Rama local:** `feature/unit31-raster-preparation-profile`
**Base:** Unidad30 `8a73f28`.

## Contexto

La Unidad30 comparte los **bytes PNG/JPEG codificados** mediante
`NativeAssets` y `Arc<Vec<u8>>`, acotados a 256 imágenes únicas / 64MiB
por factory. Cada render sigue creando su `krilla::Image`.

Se investigó si guardar y compartir también el objeto preparado
de Krilla entre **documentos PDF diferentes** ahorra CPU, memoria y
tiempo al repetir un logotipo o una fotografía de alta resolución.

Se inspeccionó el código local de Krilla v0.8.2, archivo
`src/graphics/image.rs`: `Image` envuelve
`Arc<ImageRepr>`, es barato de clonar y caro de crear;
`from_png` analiza metadata y crea un contenedor con decodificación
diferida (`Deferred`); `from_jpeg` sigue una ruta específica.
El objeto preparado puede retener datos rasterizados y
sincronización compartida durante la generación.

## Experimento implementado, evaluado y revertido

Se añadió temporalmente a `PdfImage` un
`Option<Arc<PreparedImage>>` con comprobación de identidad de
la asignación fuente, y a `NativeAssets` un caché por ID de
imagen de `PreparedImage` ya validada por Krilla. Se acotó
experimentalmente a imágenes de hasta **2 MP** y un total
de **4 MP estimados (16MiB a 4 bytes/píxel)** por factory.
Los workers recibían clones ligeros del mismo objeto.
El PDF seguía pasando tests y mantenía su hash exacto.

Sin embargo, en tres procesos independientes, la prueba de
1.280×1.280 PNG expuso una regresión grave de concurrencia:

| Mediana de 3 procesos | Unidad30 original | Caché de Krilla experimental |
|---|---:|---:|
| 3 PDFs secuenciales | 340,62 ms | 340,27 ms |
| 3 PDFs asíncronos paralelos | **119,88 ms** | **327,07 ms** |
| RSS máximo del proceso Node | 225,58 MiB | 219,50 MiB |
| PDFs | 6 páginas / 6 imágenes | idénticos |

La ruta paralela aumentó unos **207,19 ms** (aprox. **2,73×**
la duración anterior), por un ahorro de solo 6,08MiB de pico RSS.
Es plausible que compartir la instancia de `ImageRepr` con
decodificación diferida introduzca contención entre renders,
pero **no hay un perfil de bloqueo que permita atribuir
causalidad precisa**. La regresión observable es suficiente para
rechazar la modificación.

**Se revirtió todo el código experimental de `PdfImage`,
`PreparedImage` y `NativeAssets` antes del commit.**
No queda fallback de compatibilidad, atributo público `cached`,
`unsafe` ni un segundo caché adicional.

### Confirmación después de restaurar Unidad30

Después de recompilar el módulo NAPI release y volver a ejecutar el
mismo benchmark en tres procesos frescos:

- 3 PDFs secuenciales: **342,96 ms** de mediana
- 3 PDFs en paralelo: **119,13 ms** de mediana
- RSS máximo: **226,41 MiB** de mediana
- Mismo tamaño total de PDFs: **29.554.771 bytes**, 6 páginas,
  6 imágenes, archivo de entrada PNG de **4.918.048 bytes**
- SHA-256 concatenado:
  `cdf0303fe410d414aab9824d8abb419d177ce84638ffd567f6347e58e0f52d5c`

Nota metodológica: hubo un lote de cinco mediciones iniciado
**a la vez** que la reconstrucción del binario NAPI, que obtuvo
tiempos equivalentes al experimento. Ese lote se considera
**contaminado** y **se excluye** de las conclusiones. Se
repitió explícitamente después de terminar la compilación, con
tres procesos independientes, verificando la recuperación de
la latencia paralela.

## Perfil PNG frente a JPEG

Un segundo modo del benchmark genera desde la misma imagen
determinista un JPEG de 1.280×1.280 (calidad 90) mediante
ImageMagick instalado en el entorno. Es un recurso de **2.691.240
bytes**; no implica que todas las fotos JPEG tengan ese tamaño.

| Mediana de 3 procesos, implementación conservada | PNG RGB | JPEG |
|---|---:|---:|
| 3 PDFs secuenciales | 342,96 ms | **14,05 ms** |
| 3 PDFs paralelos | 119,13 ms | **6,51 ms** |
| RSS máximo Node | 226,41 MiB | 158,22 MiB |
| Imagen de origen | 4.918.048 B | 2.691.240 B |
| Total 6 PDFs | 29.554.771 B | 16.206.313 B |

SHA-256 concatenado JPEG:
`c606c3eb6c16051546efbbb90c7d2abd10a08367413391c55fca857862779993`.

Este resultado describe una imagen de **alta entropía generada
sintéticamente**, no fotografías reales de una cámara. La
diferencia puede estar influida por el formato y el tratamiento
de PNG y JPEG que hace Krilla, no solo por el tamaño comprimido.
El benchmark verifica resolución, imágenes en PDF, páginas,
texto extraíble y hashes deterministas.

## Artefactos reproducibles

```bash
# PNG sin dependencias de imágenes adicionales
node scripts/benchmark-large-raster.mjs REGULAR.ttf 3 1280 png

# JPEG requiere 'magick' (ImageMagick) para generar la misma fuente
node scripts/benchmark-large-raster.mjs REGULAR.ttf 3 1280 jpeg

# Regresión funcional de concurrencia (no impone umbral temporal)
cd packages/vufra
node --test tests/large-raster-concurrency.test.mjs
```

`scripts/lib/deterministic-png.mjs` produce un PNG RGB
repetible usando `zlib`, `CRC32` y una semilla fija.
El benchmark usa tres renders secuenciales seguidos de
tres simultáneos con `Promise.all`, en procesos Node
frescos, y comprueba cada PDF con Poppler.
El test de integración usa un PNG de **800 px** y un JPEG
real: compara binariamente resultados síncronos contra
asíncronos paralelos; modifica el buffer original después
de componer el documento para verificar aislamiento.

## Decisión y invariantes

- **Conservar** el caché de bytes comprimidos `NativeAssets`
  existente de Unidad30, con igualdad exacta y límites de
  memoria. Mantener `PdfImage::prepare()` por documento.
- **No cachear entre renders** `krilla::Image` ni
  `PreparedImage`; preservar el paralelismo real y no retener
  bitmaps potencialmente grandes durante toda la vida del factory.
- Mantener conteos por aparición (64 bloques, 32MiB de imagen
  comprimida, 12MP/imagen, 24MP/documento), snapshots
  de Node y cancelación.
- Ningún nuevo componente público, firma Fluent ni wrapper
  de compatibilidad pre-v1.
- Antes de reconsiderar el caché se necesita una medición
  de contención/bloqueo, pico RSS durante concurrencia y al menos
  una carga representativa de producción de varios tenants;
  cualquier caché futuro deberá ser por documento o de
  representación segura, no global entre renders.

La unidad incorpora **investigación, benchmark y pruebas de
regresión**, pero no añade optimización gráfica a producción
porque el experimento medido empeoró el rendimiento concurrente.

**Entrega:** commit local; sin push ni merge a `main`.
