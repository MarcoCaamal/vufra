# ADR-0028 — Reutilización de imágenes preparadas en filas fragmentadas

**Fecha:** 2026-10-17
**Estado:** implementado y verificado localmente
**Unidad:** 27 · **Rama:** `feature/unit27-cached-row-images`

## Causa

Tras la Unidad 26, `PdfRow::prepare_allow_overflow_depth` ya conserva el texto medido, pero si una fila contiene imágenes y excede la altura de página:

1. La primera medición ejecutaba `PdfImage::prepare()` y obtenía `PreparedImage` con el objeto nativo Krilla.
2. `PdfRow::fragments_from_prepared` clonaba el `PdfImage` original (incluidos sus PNG/JPEG bytes) al construir los fragmentos y descartaba el `PreparedImage` anterior.
3. La preparación del nuevo fragmento ejecutaba **otra vez** `PdfImage::prepare()`, copiando bytes comprimidos y volviendo a parsear la imagen.

Ocurría tanto en filas raíz como en filas dentro de cajas y cuerpos de tablas styled.

## Decisión

- `ImagePlacement` es una estructura interna `Copy` con solo `width`, `height`, `fit`. Se valida frente al espacio disponible sin depender de los bytes codificados.
- `PdfImage::prepare()` **se ejecuta una sola vez** para la imagen física en el primer pase de la fila. La etapa posterior usa `Arc<PreparedImage>`, que apunta al mismo objeto nativo.
- `PdfRowItem::CachedImage(PreparedImageFragment)` es una variante **interna** que contiene `ImagePlacement` y `Arc<PreparedImage>`, con campos privados. No representa una sintaxis nueva para los consumidores.
- `PreparedItemKind::Image` conserva `Arc<PreparedImage>`. Al dividir la fila, `fragments_from_prepared` mueve ese mismo `Arc` hacia los fragmentos, sin clonar los bytes PNG/JPEG ni decodificar por segunda vez.
- `PdfRow::prepare_allow_overflow_depth` admite el fragmento cacheado y vuelve a validar su geometría, conservando el conteo de píxeles. Su preparación solo clona una referencia `Arc`, no datos gráficos.
- `PreparedImage::draw` recibe metadatos de ubicación y no un `PdfImage` completo. Los dibujadores raíz, de caja y de fila comparten esa misma interfaz interna. Los modos `Contain` y `Cover` mantienen escala y recorte.
- El AST semántico Rust reconoce únicamente como representación interna `ContentNode::PreparedImage`. El SDK público mantiene exclusivamente la Fluent API, sin aliases ni compatibilidad experimental.

**Seguridad:** los `CachedImage` solo se crean después del preflight nativo y del parse PNG/JPEG exitoso. Se preservan límites de bytes codificados, imágenes, píxeles, altura y profundidad; los presupuestos del documento original cuentan cada imagen física una sola vez.

## Validación de corrección

- Rust test `cached_png_fragment_keeps_the_exact_prepared_image_and_fit` usa un PNG real del repositorio. Comprueba `Arc::ptr_eq`, identidad del puntero `Arc::as_ptr`, mismo `pixel_count`, geometría, modos `Contain` y `Cover`, así como columna agotada en otro fragmento.
- Node tests nuevos `packages/vufra/tests/cached-images.test.mjs` verifican tres escenarios independientes: PNG Cover en fila raíz, JPEG Contain en caja anidada y PNG en cuerpo de tabla con fondo y encabezado repetido. Validan tokens únicos, páginas múltiples, una sola imagen física y dimensiones intrínsecas con `pdfimages`.
- Todas las suites de paginación, fuentes, imágenes con alpha, recurso total, cancelación, snapshots y tablas siguen ejecutándose.

## Benchmark reproducible

```bash
node scripts/benchmark-fragmented-images.mjs REGULAR.ttf BOLD.ttf 3
```

Genera un PNG RGB determinista de 384×384, lo inserta en diez filas largas, cada una con 420 tokens identificables. Se ejecuta cada medición en un proceso Node nuevo y se verifican los diez objetos de imagen con Poppler, los 4.200 tokens en orden, páginas y bytes.

| Métrica (mediana de 3 procesos) | Antes (Unidad 26) | Después (Unidad 27) |
|---|---:|---:|
| Render `.render()` | 270,89 ms | 162,86 ms |
| Máximo RSS del proceso Node | 121,14 MiB | 117,08 MiB |
| PDF | 497.061 B / 40 páginas | exactamente igual |
| Imágenes en PDF | 10 | 10 |
| Identificadores | 4.200/4.200 | 4.200/4.200 |

**Diferencia observada:** 108,03 ms menos (aproximadamente 39,9 %) y 4,06 MiB menos de RSS máximo (~3,4 %). Cinco ejecuciones posteriores: mediana 163,41 ms y 117,30 MiB.

El PDF anterior y el nuevo resultaron **idénticos byte a byte**, SHA-256:
`0168ea98b27ace4eaced8bc181aa2ce5086f5adcacac7c05389d6bd321299338`.

Esto no demuestra que otras clases de PDF sean un 40 % más rápidas. El workload está diseñado para enfatizar exactamente la duplicación corregida, mientras que `maxRSS` incluye JS, NAPI, Rust, Krilla, fuentes y cachés, no el heap del renderer aislado.

## No alcance / límites

La frontera JS→NAPI y las cargas de imágenes fuera de filas fragmentadas pueden requerir nuevas copias. El caché es **por preparación de la fila**, no un caché global entre imágenes/documentos, por lo que no mezcla datos de tenants ni recursos de renderizados distintos. No se añaden formatos SVG/WebP. No se cambia la API pública.

## Entrega

Cambios en una rama local que depende de las Unidades 24–26; **sin push ni merge** a `main` hasta que el usuario lo solicite.
