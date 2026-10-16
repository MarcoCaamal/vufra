# Unidad 01 — Plan experimental (SP-01, SP-02, SP-03)

**Estado:** planes de ejecución, no ejecutados. No se han instalado bibliotecas ni generado benchmarks.

## Método común

Para cada spike registrar:
- entorno: OS, arquitectura, `rustc --version`, `cargo --version`;
- commits de la prueba, versión de biblioteca, flags, perfil de build;
- datasets/fixtures y semilla cuando corresponda;
- número de corridas (mínimo tres para mediciones exploratorias), dispersión y outliers;
- salida PDF o reporte inspeccionable;
- qué pasa, qué falla, compromisos y riesgos de mantenimiento.

No elegir un ganador por una sola corrida. Los criterios funcionales son obligatorios; la velocidad no compensa perder contenido ni corromper PDF.

## SP-01 — Escritor PDF: pdf-writer vs krilla

**Pregunta:** ¿qué estrategia ofrece el control correcto sobre texto, recursos y páginas con complejidad y rendimiento aceptables?

### Casos comparables
1. Documento de 1 página con texto, rectángulos y metadatos.
2. Documento multipágina con recursos reutilizados.
3. Texto Unicode y fuente embebida, con extracción e inspección (en combinación con SP-02).
4. Imagen PNG y JPEG con tamaño de salida registrado.
5. Manejo de error/respuesta frente a datos de entrada inválidos.

### Evidencia
- Validez sintáctica del PDF con al menos una herramienta externa (selección posterior).
- Visualización/inspección estructural, extracción de texto y verificación de selección.
- Bytes del PDF, memoria pico, tiempos de construcción/serialización y complejidad de integración.
- Riesgo de dependencias, mantenimiento, licencia y restricciones para dibujar glifos/ToUnicode.

### Go/no-go
Pasa si puede generar archivos válidos multipágina con fuentes/recursos representables y API adaptables al pipeline de Vufra; si hay limitaciones, explicitar costos y mitigación. Puede resultar en usar una capa de bajo nivel con abstracción propia, no solo escoger una de dos alternativas.

### Decisión al terminar
ADR-0003 elegir escritor o estrategia híbrida, con evidencia de fixtures.

## SP-02 — Tipografía: Parley y Unicode

**Pregunta:** ¿pueden medición, shaping y salida PDF conservar texto complejo y seleccionable?

### Casos
- Español: `Cancún, niño, acción, ¿Qué?`.
- Acentos combinantes frente a precompuestos: `e + ◌́` vs `é`.
- Saltos de línea por anchura y variación del tamaño de fuente.
- Texto mixto latino + otro sistema de escritura (p. ej. árabe) con fuente compatible y prueba RTL.
- Fallback entre dos fuentes cuando falten glifos.
- Emoji: registrar explícitamente si se soporta o se rechaza, sin prometer color emoji en MVP.

### Evidencia
- Métricas, posiciones, saltos de línea y repetibilidad.
- Extracción PDF que conserve el texto original o equivalente Unicode esperado.
- Fuente y glifos embebidos, tratamiento ToUnicode y licencias de fuentes.
- Evaluar Parley como candidato; `skrifa`/`fontique` y otros crates del ecosistema solo si son necesarios y están validados, sin preselección.

### Go/no-go
Pasa si el texto con fuentes de prueba soportadas se mide y dibuja sin truncado, el PDF permite selección/extracción correcta para la matriz comprometida, y errores por fuentes no disponibles son diagnósticos. Caso parcialmente soportado debe quedar registrado como limitación explícita.

### Decisión al terminar
ADR-0004 tipografía y contratos entre `text`, `layout` y `pdf`.

## SP-03 — Fragmentación de tablas de 1.000 filas

**Pregunta:** ¿un compositor resumible puede dividir tablas largas sin perder o duplicar contenido?

### Casos
1. 1.000 filas sencillas, con IDs únicos consecutivos.
2. Filas de altura variable y texto envuelto en varias líneas.
3. Filas que caben justo, exceden espacio restante o exceden una página completa.
4. Celdas vacías y tabla sin filas.
5. Encabezados repetidos en páginas siguientes.
6. Header/footer de documento reservando espacio real.
7. Casos extremos para detectar tokens que no progresan.

### Prototipo lógico
`paginate(node, constraints, token?) -> (fragments, next_token?)`.

Este ejemplo es un **contrato conceptual**, no una firma Rust fijada. Probar estado de reanudación por nodo/fila/fragmento con un contador de progreso para detectar loops, y un control de geometría que rechace alturas negativas/NaN.

### Aserciones indispensables
- Cada ID de fila aparece exactamente una vez en el flujo semántico, en orden.
- Los encabezados de tabla se repiten solo cuando corresponde y no se cuentan como fila de datos.
- Cada nueva página de contenido progresa o emite error explícito.
- Ningún fragmento se sitúa fuera de su área asignada.
- Resultado estable con las mismas fuentes y restricciones.
- Reportar páginas, tiempos, memoria, número de fragmentaciones y límites.

### Decisión al terminar
ADR-0005 mecanismo de BreakToken, política para filas indivisibles/divisibles y diseño de layout final.

## Orden y cierre

**Secuencia:** W0-B (scaffolding autorizado) -> SP-01 y SP-02 (interfaces e integración) -> SP-03 -> ADRs -> diseño de Unidad 02.

**No-go global:** no iniciar implementación productiva del motor sin conocer restricciones de escritura PDF, medición Unicode y algoritmo de paginación. Los spikes son descartables; no copiar su código directamente a producción sin revisar.
