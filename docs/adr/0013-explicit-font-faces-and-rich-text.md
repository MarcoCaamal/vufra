# ADR-0013 — Fuentes nombradas y párrafos enriquecidos

- **Fecha:** 2026-10-16
- **Estado:** aceptada para prototipo experimental (Unidad 12).

## Problema

Vufra solamente utilizaba un font por documento. Un simple `styled-paragraph` cambiaba tamaño, pero no podía incrustar negrita/cursiva auténticas ni varias familias tipográficas dentro de una línea. Medir con una fuente y dibujar con otra podría producir texto solapado, desbordamientos y saltos incorrectos.

## Decisión

1. Conservar `renderPdf(document,font)` y `renderPdfAsync(document,font)` sin cambios obligatorios. `font` sigue siendo la fuente `regular` predeterminada.
2. Añadir `document.fontFaces?: Record<string,Uint8Array>`, donde los nombres son identificadores ASCII únicos de 1–24 caracteres (reservar `regular`), y `PdfBlock::RichParagraph{runs,style}` Rust. Cada run contiene texto y nombre de font.
3. El SDK expone `{type:'rich-paragraph',runs:[{text,font?}],style?}`. Un run sin nombre usa `regular`. No se simulan grosor, inclinación ni fallbacks por sistema operativo: el usuario proporciona los bytes de archivo para negrita, cursiva, otra familia, etc.
4. `FontRegistry` posee contextos independientes de Parley por fuente. Eso evita que una familia compartida como Noto Sans Bold/Regular escoja la variante equivocada. Para cada token (palabra + espacios) se utiliza `Layout::full_width()`, que contabiliza whitespace final; Krilla usa el mismo archivo de fuente para `draw_text`. La paginación reutiliza las líneas `FlowBlock::Paragraph` y el dibujado por fragmento del compositor.
5. El primer alcance admite texto latino/UTF-8, espacios, tabuladores sencillos y saltos explícitos `\n`; permite partir el párrafo en fronteras de palabra y páginas. Cada span mantiene su fuente en las líneas resultantes. Un token indivisible más ancho que la caja se rechaza explícitamente.
6. Los bytes de fuentes adicionales se contabilizan en `PdfRenderQueue` mediante `byteLength`, sin expansión del binario a arreglos JSON; `structuredClone` preserva instantáneas de los datos encolados.
7. Límites: máximo 6 fuentes adicionales (sin contar la regular), 12 MiB por fuente, 30 MiB en total; 1–1000 runs por párrafo y límites globales previos de contenido. API únicamente en `blocks`. Los formatos font siguen siendo los que Krilla/Parley pueden aceptar.

## Restricciones conocidas

- **No hay fallback automático por glifo, bidi/RTL avanzado ni shaping conjunto entre runs.** Esta primera integración mide y dibuja cada token con una sola fuente; las ligaduras que cruzan fronteras de estilos no se modelan. La API no promete soporte equivalente a HarfBuzz/Word para escrituras complejas.
- Las negritas y cursivas requieren fuentes **reales suministradas por el usuario**. `font:'bold'` es un identificador de registro, no un mecanismo que convierta en bold una fuente regular.
- No hay color ni tamaño de letra distinto por run: `style` configura el tamaño y el interlineado a nivel de todo el bloque. El enriquecimiento consiste por ahora en cambios de fuente. Las tablas y encabezados siguen usando la fuente `regular` de documento.
- No se redistribuyen archivos de fuentes de terceros en el repositorio ni en el paquete npm.
- Por ahora no se asegura accesibilidad PDF/UA ni PDF etiquetado a nivel semántico.

## Verificación

End-to-end Node con `pdffonts` demuestra incrustación efectiva de NotoSans Regular/Bold/Italic y NotoSerif Regular en el mismo PDF, extracción en orden con `pdftotext`, posiciones con `-bbox`, salto de página y recuperación sin pérdidas de cientos de tokens. El SDK async y la cola se verifican con buffers de font mutados después de encolar.
