# ADR-0052 — `maxHeight` como restricción intrínseca sin clipping

Estado: implementado en el roadmap de box layout (Unidad 40). **No se recorta contenido**, ni se pinta una caja con elementos faltantes.

## Contrato

`box({padding:{top:12,right:8,bottom:10,left:15},minHeight:125,maxHeight:180},b=>b.paragraph('...'))` define una altura mínima y una altura máxima para el contenedor *completo* incluyendo padding, bordes y todos los descendientes preparados. `minHeight` puede omitirse, `maxHeight` es opcional, estrictamente positivo, finito y acotado a 20,000pt; la cota inferior, si existe, debe ser menor o igual a la superior. El límite superior puede superar una hoja física, porque algunos contenedores son fragmentables entre páginas.

La medida es exactamente la misma que utiliza el paginador (`PreparedBox.total_height()`), no un cálculo heurístico JS. Si el contenido preparado excede `maxHeight`, la generación falla con `box content exceeds maxHeight; clipping is unsupported`. A diferencia de CSS, **no** se aplica `overflow:hidden` ni scroll ni ajuste automático de tamaños de fuentes. Un `maxHeight` menor que la suma de paddings del contenedor se rechaza antes de medir.

El límite viaja por `BoxOptions` → `PdfBox` de TypeScript → NAPI `NodeBox` → Rust `PdfBox` → AST owned `ContentFrame`; se valida nuevamente en Rust, también ante un AST manipulado en la frontera nativa. El criterio se verifica tras medir todas las hojas y los rellenos intrínsecos, incluidos `minHeight` y cajas anidadas; no altera la representación ni el paginador de los documentos que no lo utilizan.

## Casos de prueba

`packages/vufra/tests/box-max-height.test.mjs` genera una caja que respeta `minHeight`/`maxHeight`, comprueba que su contenido y el siguiente se conservan, y ejercita desbordamientos intrínsecos y anidados que deben fallar antes de crear un PDF recortado. También cubre NaN/Infinity, negativos y `minHeight>maxHeight` tanto en la DSL como en la frontera de normalización.

## Pendiente

Distribución vertical `space-between` de bloques heterogéneos, flex grow/shrink y alineación vertical de hijos. `maxHeight` es una **restricción validada**, no una política de overflow ni un clip.
