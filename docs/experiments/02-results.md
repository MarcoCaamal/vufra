# Unidad 01 — Resultados de experimentos (2026-10-16)

**Nivel de madurez:** prototipo, sin promesas de producción.

## Ambiente

- Linux x86_64 (workspace local).
- Rust/Cargo 1.92.0; edición 2024.
- pdf-writer 0.15.0; krilla 0.8.2; Parley 0.12.0.
- Fuente del sistema NotoSans-Regular.ttf, no se incluye en repo.
- Herramientas independientes: pdfinfo, pdftotext y pdftoppm (Poppler).

## W0-B

- Monorepo Cargo inicializado con paquetes experimentales y crates semánticos de prueba.
- Git local inicializado en rama main, sin remoto configurado por este trabajo.
- LICENSE-MIT, LICENSE-APACHE, Cargo.lock y rust-toolchain.toml incorporados.
- No publicación de paquetes ni deployment.

## SP-01 — escritores

| Candidato | Fixture | Páginas | Tamaño observado | Características evaluadas |
|---|---|---:|---:|---|
| pdf-writer 0.15.0 | artifacts/pdf-writer-first.pdf | 1 | 741 bytes | Escribe objetos y texto ASCII Helvetica básico |
| krilla 0.8.2 | artifacts/krilla-first.pdf | 2 | 10,755 bytes | Unicode español, fuente embebida, texto extraíble |
| krilla 0.8.2 | artifacts/1000-rows.pdf | 29 | 35,162 bytes | Generación multipágina de tabla paginada externamente |

Los tamaños **no son una comparación justa de rendimiento**, porque los fixtures tienen distintas características (embebido de fuentes, contenido y páginas). No se ha tomado una decisión de backend final. Krilla usa pdf-writer internamente; no son necesariamente alternativas excluyentes.

**Evidencia:** pdfinfo reconoce versiones/estructura; pdftotext extrae las cadenas esperadas; los PDF tienen header %PDF y terminador %%EOF. Primera página de tabla renderizada e inspeccionada visualmente sin solapamiento aparente.

## SP-02 — tipografía

- Parley formó 5 líneas con ancho 180 pt y 3 líneas con ancho 360 pt en el fixture español.
- Krilla y Noto Sans conservaron en extracción: Cancún, Niño, acción, México, Página y ¿Qué.
- **No concluido:** integración de Parley con la API de dibujo de krilla, ToUnicode con shaping complejo árabe/RTL, fallback multifuente, emoji y coincidencia de métricas Parley/PDF. Estos casos son requeridos antes de consolidar el módulo de texto.

## SP-03 — paginación

- Implementado BreakToken { next_row } con un paginador por filas **indivisibles**.
- Se generan 29 páginas para 1,000 filas de 19 puntos con espacio 700 pt y encabezado 28 pt.
- Validación independiente: exactamente IDs 0001–1000, ordenados, sin faltantes ni repetidos.
- Seis pruebas unitarias: 1,000 filas, fila excesiva, entradas NaN, tabla vacía, token al final e inválido.
- El pie y cabecera repetidos son dibujados explícitamente en el spike PDF.

**Limitaciones:** no hay ajuste de texto por celda, filas divisibles, celdas múltiples, tablas anidadas ni encabezado semántico con medición dinámica; no confundir este spike con el sistema final de layout.

## Calidad

- cargo test --workspace: 6/6 tests en verde.
- cargo fmt --all -- --check: verde.
- cargo clippy --workspace --all-targets --all-features -- -D warnings: verde.
- Comprobación de extracción mediante Poppler: verde.
- Los PDF generados están ignorados por Git en artifacts/.

## Decisiones y continuidad

1. Mantener krilla y pdf-writer como hipótesis viables; evaluar complejidad y perfiles comparables antes de decidir backend.
2. Contrato de paginación por token muestra viabilidad básica, pero requiere políticas explícitas para nodos indivisibles y fragmentables.
3. Próxima unidad: integrar medición Parley con un escritor PDF, definir API Rust estable y pruebas de composición de celdas; después recién considerar bindings Node.
4. No afirmar que existe un SDK TypeScript ni que el motor está listo para producción.
