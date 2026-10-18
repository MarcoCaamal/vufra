# Registro de rendimiento de Vufra

Esta carpeta conserva perfiles de ejecución de la **misma máquina** para vigilar cambios de rendimiento entre unidades. Los JSON son registros históricos reproducibles, no resultados garantizados para otras máquinas ni cifras de producción.

## Historial inicial

| Snapshot | Commit | Tabla 250 filas (mediana) | 50 cajas (mediana) | 150 registros multipágina (mediana) | 100 filas flexibles (mediana) |
|---|---|---:|---:|---:|---:|
| [Antes de flex](2026-10-18-unit57-baseline.json) | `a65e9d9` | 23,675 ms | 5,352 ms | 16,317 ms | no existía |
| [Con flex](2026-10-18-unit58-flex.json) | `17baa7a` | 23,843 ms | 5,258 ms | 15,431 ms | 7,958 ms |

Deltas de medianas para los tres casos comparables: **+0,7 %, −1,8 %, −5,4 %**, respectivamente. Los tamaños de PDF comparables permanecen **idénticos**. Los picos RSS de proceso difieren menos de 0,3 % en estas mediciones. **No interpretar estos porcentajes como una mejora/regresión estadísticamente demostrada**: 5 mediciones por caso son un primer indicador, y el benchmark está sujeto a cambios de frecuencias de CPU y carga del sistema. El p95 de una serie corta es especialmente sensible a un solo outlier.

## Para actualizar al implementar cada feature

1. Ejecutar la misma revisión de código, perfil del addon y fuente en el mismo equipo que el baseline. Idealmente correr varias rondas intercaladas antes/después para atenuar la deriva térmica/carga de CPU.
2. Compilar Rust addon y SDK, y medir cargas **sin alterar las fixtures previas** (`table-250`, `nested-50`, `mixed-150`). Añadir escenarios nuevos para funcionalidades nuevas; nunca sustituir silenciosamente un caso histórico por otro distinto.
3. Correr:

   ```bash
   FONT=$(fc-match 'Noto Sans' -f '%{file}' | head -1)
   node --expose-gc scripts/benchmark-regressions.mjs \
     --font "$FONT" --runs 9 \
     --compare docs/performance/2026-10-18-unit58-flex.json \
     --out artifacts/perf-current.json
   ```

4. Registrar el commit en Git y guardar el JSON como `docs/performance/YYYY-MM-DD-unidadNN.json` **después de realizar el commit principal**, para que `revision` señale un SHA real, documentando el resultado y las limitaciones en el ADR y Obsidian.
5. El CI incluye un job de medición informativa y sube `performance-ci.json` como artifact con retención de 60 días. Revisar tendencias entre runners similares, sin puertas de tiempo rígidas; variaciones reiteradas/altas justifican profiling reproducible en máquina fija.

## Qué se mide exactamente

- `medianMs`, `p95Ms`: **renderSync completo de un documento ya compilado** (no construcción de AST), con 2 warmups y N muestras en un proceso nuevo por escenario; `global.gc()` si está disponible, antes de cada muestra.
- `peakRssMiB`: `process.resourceUsage().maxRSS`, incluyendo memoria de Node, fonts, buffers y nativo durante el proceso. No es memoria retenida por documento ni pico exclusivo de Rust.
- `finalRssMiB`: RSS al terminar el escenario, puede diferir del pico.
- `pdfBytes`: bytes del PDF renderizado, comprobando cabecera `%PDF-` y longitud estable entre muestras. No mide solo velocidad: vigila posibles aumentos inesperados del archivo.
- `identity`/`revision`: plataforma, CPU, versión Node, archivo de fuente (tamaño), RAM y revisión Git para detectar comparaciones poco fiables.

Si falta un escenario en el baseline, figura como `new-scenario` y no produce un porcentaje ficticio. `--enforce --max-regression 20` permite un control manual opcional en hardware estable, pero **no se activa automáticamente en GitHub Actions**.
