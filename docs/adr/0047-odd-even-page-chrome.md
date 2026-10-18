# ADR-0047 — Encabezados/pies pares e impares (fundación de Unidad 41)

Estado: implementado en la Fluent API y motor nativo. No se considera todavía un sistema de `PageMaster` por sección.

## API

`document.oddHeader(callback|null)`, `.evenHeader(callback|null)`, `.oddFooter(callback|null)` y `.evenFooter(callback|null)` complementan `.header()`, `.footer()`, `.firstHeader()` y `.firstFooter()` existentes. Las páginas son **1-based** a la vista del usuario: portada/página 1 impar, página 2 par, etc.; el motor Rust recibe índice interno base cero. `null` suprime explícitamente la variante para esa paridad. Los callbacks admiten los mismos contenidos y tokens `{{page}}`, `{{total}}` que las bandas anteriores.

Orden de precedencia por cada banda (header/footer):

1. Supresión explícita o banda especial de primera página, si es página 1.
2. Supresión explícita o banda declarada para impar/par.
3. Banda general `header`/`footer`, o su supresión, si no hay override.
4. El encabezado/pie predeterminado del motor solo cuando no se eligió o suprimió alguna variante.

Una banda por paridad puede ser visible incluso si la genérica fue desactivada, porque es un override específico. La portada creada por `coverPage()` sigue ocultando *ambas* bandas de su primera página.

## Arquitectura

`PdfPageChrome` almacena cuatro rows opcionales adicionales y sus cuatro flags de supresión. TypeScript los normaliza y verifica el caso contradictorio `oddHeader` junto con `hideOddHeader`, etc. NAPI preserva los campos y ejecuta las validaciones/budgets de imágenes, píxeles y texto **sobre las ocho variantes** de bandas, no solo sobre las cuatro anteriores.

Rust `PdfPageChrome::band(index,header)` determina la banda una sola vez por índice/paridad, respetando prioridad y flags; `should_draw_default_*` refleja la misma selección. `reserve()` prepara y mide el máximo de las variantes posibles antes de paginar, así que no hay reflow de contenido al alternar encabezados de altura distinta. `draw()` sustituye tokens tras conocer el total de páginas y pinta con el renderizador de rows existente.

## Límites

La alternancia usa **el número absoluto de página del documento**, no la página relativa a una sección. No hay maestros de página por sección, divisiones pares forzadas, tamaño de portada diferente ni TOC. Se reserva la altura máxima entre bandas aunque una variante se oculte en una página concreta; el compromiso es paginación estable y ausencia de solapamientos.

## Verificación

Rust `page_chrome.rs` prueba precedencia de first/paridad/general, supresión y fallback. Node `odd-even-page-bands.test.mjs` verifica varias páginas con 180 registros únicos, headers/footers pares/impares y `{{page}}`, portada sin bandas y `firstHeader` con prioridad sobre odd, además del `evenHeader(null)` que oculta solo páginas pares. No se añade ningún navegador ni plugin de render.
