# ADR-0014 — Estilos por fragmento, ligaduras compatibles y fallback opt-in

- **Fecha:** 2026-10-16
- **Estado:** aceptada como prototipo (Unidad 13); **no** constituye una garantía de shaping Unicode universal.

## Contexto

La Unidad 12 permitía seleccionar el archivo real de fuente de cada fragmento, pero todos compartían el tamaño del párrafo y color negro. Además, los fragmentos contiguos de igual estilo podían cortar innecesariamente una secuencia que forma ligadura, y no existía una forma explícita de utilizar otra fuente cuando faltaba un glifo.

## Decisiones

1. Añadir a cada `PdfTextRun` Rust los campos opcionales `font_size: Option<f32>`, `color: Option<[u8;3]>` y `fallback_fonts: Vec<String>`. TypeScript refleja `fontSize?:number` (6–36 pt), `color?:'#RRGGBB'` y `fallbackFonts?:string[]`. NAPI recibe las mismas propiedades opcionales. Las llamadas existentes siguen usando tamaño heredado del bloque, negro y ninguna fuente alternativa.
2. Parley mide tokens usando **la fuente real elegida y el tamaño individual** del fragmento; Krilla dibuja el mismo archivo, tamaño y RGB. Antes de cada fragmento se guarda el fill y se restablece inmediatamente después: el color no contamina las siguientes instrucciones ni el resto del PDF.
3. El planificador actual usa altura de línea constante por párrafo. Se reserva `max(paragraph.lineHeight, largestRun.fontSize*1.35)` para todas las líneas del bloque y se ubica el baseline al 80% de cada línea. Es conservador: evita superposición de tamaños heterogéneos, pero puede aumentar la longitud del documento. Una futura versión utilizará mediciones de altura por línea y baseline según ascenso/descenso de fuentes.
4. Se **coalescen runs API contiguos con font, tamaño, color y lista de fallbacks idénticos** antes de segmentar por palabras. Esto permite que un token como `of` + `fice` se forme como `office` y evita cortar ligaduras dentro de secuencias compatibles; las fronteras reales de estilo siguen siendo fronteras de shaping. No se promete shaping conjunto cuando cambian los estilos.
5. Fallback de glifos **opt-in, por token completo**. Cuando `fallbackFonts` contiene nombres registrados, `ttf-parser` comprueba la cobertura de cada carácter Unicode del token en la fuente principal y en las alternativas, en orden. Se elige la primera fuente capaz de representar el token completo; al faltar cobertura, se rechaza con error explícito. Se cachea cobertura por índice de fuente y carácter para evitar reparsear en las consultas repetidas. No se descarga ninguna fuente ni se buscan fuentes del sistema.
6. No se fragmenta una palabra entre distintas fuentes: mantiene ligaduras y combinaciones dentro de un mismo face, a costa de rechazar palabras que requerirían mezclar familias. Sin `fallbackFonts`, se conserva el comportamiento anterior; no se activa ninguna nueva política de sustitución.
7. Mantener límites de la Unidad 12 (6 fuentes adicionales, 12 MiB por archivo, 30 MiB total, 1000 spans/bloque), con seis candidatos fallback máximo, referenciando únicamente nombres cargados.

## Limitaciones importantes

- Aunque `ttf-parser` confirma que existe un glifo Unicode, **eso no prueba que el shaping completo de escrituras complejas sea correcto**. Bidi/RTL, secuencias emoji ZWJ, marcas combinantes, variantes tipográficas y Unicode fallback por cluster requerirán un motor de composición y tests específicos.
- La selección es por palabra completa, no por letra ni cluster, y puede rechazar palabras mezcladas que ninguna fuente individual cubra. Es deliberado.
- `pdftotext -raw` conserva el orden del flujo de instrucciones PDF. Herramientas como `pdftotext -layout` pueden reordenar palabras **cuando una misma línea contiene tamaños de letra muy distintos** porque calculan lectura por cajas geométricas. Pendiente tagging/ActualText/accesibilidad.
- Un párrafo con una sola palabra de tamaño grande puede aumentar la altura de **todas** sus líneas. Pendiente alturas por línea.
- Siguen fuera del alcance: colores CMYK, opacidad, underline, superíndices, fallback automático del SO, fuentes web, text shaping continuo entre estilos diferentes y firma/pdf base.

## Verificación

Se usa `pdffonts` para demostrar fuentes embebidas, `pdftotext -raw` para el orden lógico, `pdftotext -bbox` para anchuras relativas y límites, y rasterizado Poppler de 72 DPI para comprobar visualmente píxeles RGB. Se prueba fallback real de Noto Sans a Noto Sans Symbols 2 para `★`, rechazo sin fuente que cubra `☯`, y equivalencia geométrica entre `office` y `of`+`fice` cuando tienen idéntico estilo.
