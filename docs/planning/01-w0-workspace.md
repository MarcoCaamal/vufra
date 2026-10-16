# W0 — Diseño y preparación del workspace de Vufra

- **Estado:** documento histórico de planificación W0-A. **W0-B se ejecutó el 2026-10-16** tras autorización del usuario; consultar [resultados](../experiments/02-results.md) para el estado actual. Los pendientes y ejemplos de este documento describen el plan previo, no el repositorio actual.
- **Decisión de producto:** open source, motor nativo Rust primero; TypeScript/Node.js en una fase futura.
- **Licencia:** `MIT OR Apache-2.0` (aprobada).
- **Regla original de trabajo:** no crear código, `Cargo.toml`, `git init` ni paquetes hasta autorización. **La autorización fue concedida el 2026-10-16 y W0-B ya se realizó.**

## 1. Objetivo

Diseñar un repositorio mantenible que permita validar generación PDF, composición tipográfica y paginación, sin acoplar el modelo documental al escritor concreto ni condicionar el núcleo a Node.js.

## 2. Estructura objetivo (NO creada todavía)

```text
vufra/
├── .github/
│   └── workflows/
│       └── ci.yml                    # reservado
├── crates/
│   ├── vufra-core/                   # AST, estilos, recursos, errores compartidos
│   ├── vufra-text/                   # fuentes, shaping y medición
│   ├── vufra-layout/                 # layout, fragmentos, paginación
│   ├── vufra-pdf/                    # emisión PDF
│   └── vufra/                        # fachada Rust futura; decisión de publicación pendiente
├── packages/
│   └── vufra/                        # SDK TypeScript posterior, no MVP
├── experiments/
│   ├── sp-01-pdf/
│   ├── sp-02-text/
│   └── sp-03-pagination/
├── examples/
├── benches/
├── docs/
│   ├── planning/
│   ├── architecture/
│   ├── adr/
│   └── experiments/
├── Cargo.toml                        # virtual workspace (pendiente)
├── rust-toolchain.toml               # versión por fijar tras pruebas
├── rustfmt.toml                      # opcional
├── .gitignore
├── README.md
├── CONTRIBUTING.md                   # antes de aceptar PRs externos
├── LICENSE-MIT                       # texto oficial pendiente de incorporar
└── LICENSE-APACHE                    # texto oficial pendiente de incorporar
```

**Criterio YAGNI:** no crear todos estos directorios como paquetes vacíos durante W0-A. `packages/` y los bindings no se activan en v0.1. Los experimentos pueden comenzar como binarios aislados sin forzar librerías definitivas.

## 3. Cargo y configuración propuesta

- **Tipo:** *virtual workspace* (sin `[package]` en la raíz).
- **Edición Rust:** `2024` como preferencia inicial.
- **Resolver Cargo:** `3` explícito, necesario para workspace virtual.
- **Metadatos compartidos:** `edition`, `license`, `repository` (cuando exista), `rust-version` (cuando se fije).
- **Gestión de dependencias:** centralizar versiones comunes con `[workspace.dependencies]`, pero no instalar dependencias especulativas.
- **Features:** aditivas y mínimas; no habilitar `default-features = false` por reflejo; verificar efectos de unificación.
- **MSRV:** no fijarlo arbitrariamente: evaluar dependencias y sistema de CI primero.
- **Lockfile:** mantener uno compartido en desarrollo. Definir política de empaquetado y publicabilidad antes del release.

**Fragmento orientativo, NO manifiesto ya escrito:**

```toml
[workspace]
resolver = "3"
members = ["crates/*"]

[workspace.package]
edition = "2024"
license = "MIT OR Apache-2.0"
```

El glob `crates/*` solo es válido cuando sus directorios contienen crates reales. Antes de introducirlo, decidir qué paquetes se crearán en W0-B.

## 4. Módulos y responsabilidades

| Componente | Responsabilidad | Dependencias internas admitidas |
|---|---|---|
| `vufra-core` | AST documental, estilos semánticos, IDs, referencias de recursos, errores transversales | Ninguna |
| `vufra-text` | Fuentes, shaping, líneas, métricas y mapeos Unicode | Ninguna preferentemente |
| `vufra-layout` | Medición, geometría, fragmentos, BreakToken, flujos, tablas | `core`, `text` |
| `vufra-pdf` | Recursos PDF, fuentes embebidas, escritura de páginas y objetos | `core`, `text`, `layout` |
| `vufra` (fachada propuesta) | Entrada pública ergonomía/orquestación | `core`, `text`, `layout`, `pdf` |
| `packages/vufra` (futuro) | TypeScript API y bindings NAPI-RS | Solo consume la API Rust estable |

**Fronteras:** core no puede importar layout ni PDF; text no conoce la sintaxis PDF; layout no conoce APIs de `pdf-writer`/`krilla`; módulos posteriores no influyen en el dominio hacia atrás. Evitar `pub use` masivos por comodidad antes de estabilizar API.

**Atención de publicación:** una fachada publicada en crates.io no puede depender únicamente de crates internos no publicados. Antes del primer release se deberá decidir si publicar/versionar dependencias internas o consolidar empaquetado. El monorepo no obliga a publicar cada crate.

## 5. Contratos funcionales a preservar

1. **AST semántico:** lo que representa el documento está separado de las coordenadas finales.
2. **Layout propio:** Stack, Row, Box y tabla sin asumir CSS/DOM.
3. **Texto real:** shaping, métricas y producción de texto seleccionable deben ser consistentes; validar ToUnicode/embedding en el experimento.
4. **Paginación reanudable:** un fragmento puede producir `BreakToken`, que indica dónde continuar en la página siguiente, sin perder, duplicar ni reordenar contenido.
5. **Encabezados y pies:** definir separación entre área de contenido y áreas repetidas.
6. **Errores tipados:** resultados recuperables y diagnósticos contextualizados; evitar panics para errores de usuario.
7. **Determinismo funcional:** mismo AST+fuentes+opciones debe producir mismo contenido/orden visual; reproducibilidad binaria se investigará por metadata/IDs del PDF.

## 6. Disciplina de ingeniería propuesta

### Desarrollo local y futuro CI

- `cargo fmt --all -- --check` para formato.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` para lint (revisar señales y falsos positivos).
- `cargo test --workspace` para pruebas.
- `cargo doc --workspace --no-deps` para documentación API.
- Pruebas de matriz plataforma/versión Rust cuando haya código.
- Escaneo de dependencias y licencias con herramientas existentes, por seleccionar más adelante.
- En componentes puros evitar `unsafe`; encapsular y auditar cualquier FFI `unsafe` si en el futuro es necesaria.

### Capas de test

- **Unitarias:** medidas, saltos, estilos, nodos.
- **Integración:** PDF válido, extracción texto, recursos y número de páginas.
- **Golden/snapshot:** inspección estructural con fixtures; tolerancias explícitas para hashes y metadatos.
- **Propiedad:** paginación sin pérdida/duplicación y progreso.
- **Benchmarks:** memoria máxima, tiempo total, throughput, tamaño generado, comparados en hardware/flags idénticos.

### Convenciones

- APIs Rust pequeñas, contratos tipados y doc comments sobre invariantes.
- Dependencias dirigidas; cambios de límites requieren ADR.
- Seguridad: entradas no confiables (fuentes/imágenes) con límites de tamaño, sin asumir panic = recuperación.
- `Result<T, E>` en límites recuperables; evita cargar el modelo con lógica de representación.
- Nada de optimizaciones antes de una medición reproducible.
- PRs pequeños con caso de prueba y explicación del tradeoff.

## 7. Registro de decisiones y preguntas abiertas

**Decidido:** nombre Vufra; open source; licencia MIT OR Apache-2.0; Rust primero; TypeScript después; AST/layout/render distintos; necesidad de tablas multipágina.

**Propuesto pero aún no validado:** crate split exacto, Rust 2024/resolver 3, patrón de fachada, herramienta de release, estructura de errores, estrategia de publicación.

**Pendiente de spikes:** `pdf-writer` vs `krilla`, Parley y tipografía, algoritmo concreto de BreakToken, compatibilidad de fuentes, performance y límites de memoria.

## 8. Puertas de aceptación

### W0-A: diseño (se puede completar sin código)
- [x] Workspace localizado y estado inspeccionado.
- [x] Licencia aprobada registrada.
- [x] Topología, grafo de dependencias y responsabilidades documentados.
- [x] Convenciones y estrategia de CI especificadas.
- [x] Planes de experimentos verificables.
- [x] Separación entre decisiones, hipótesis y pendientes.
- [x] Sin generación de código.

### W0-B: scaffolding (BLOQUEADO HASTA AUTORIZACIÓN)
- [ ] Crear Git y `Cargo.toml`/crates mínimos apropiados.
- [ ] Incorporar los textos oficiales de ambas licencias.
- [ ] Instalar/seleccionar toolchain y CI.
- [ ] Ejecutar `cargo fmt`, `clippy`, `test` en verde.
- [ ] Ejecutar spikes por separado, preservando resultados.

**Siguiente paso tras W0-A:** autorización de W0-B o continuar refinando su diseño; no se asume permiso de implementación.
