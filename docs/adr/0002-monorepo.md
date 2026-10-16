# ADR-0002: Monorepo modular Rust primero, TypeScript después

- **Estado:** aceptada en principio para el diseño; límites concretos sujetos a experimentos.
- **Fecha:** 2026-10-16.

## Contexto

Vufra necesita un AST propio, layout/paginación, tipografía y salida PDF. También se prevén bindings Node y SDK TS. Separar repositorios desde el inicio añadiría fricción para cambios coordinados.

## Decisión

- Un **solo monorepo** alojará Rust y, en el futuro, TypeScript.
- W0 inicia con documentación y posteriormente workspace Cargo virtual.
- El código de Rust se separará por responsabilidad: `core`, `text`, `layout`, `pdf`.
- Dependencias internas unidireccionales; bindings TS consumirán una fachada estable y no importarán internals.
- SDK TS y NAPI-RS no son parte del MVP v0.1.
- El número exacto de crates/paquetes, su publicabilidad y API se ajustarán con evidencia SP-01–03, evitando fragmentación prematura.

## Tradeoffs

- Pro: una sola fuente de verdad, CI integrado, atomicidad de cambios, benchmarks comparables.
- Contra: pipelines y release pueden ser más complejos al integrar otros lenguajes.
- Advertencia: paquetes internos no publicados impiden publicar una fachada que dependa de ellos sin resolver antes la estrategia crates.io.

## Alternativas descartadas provisionalmente

- Dos repositorios Rust/TypeScript desde el día 1.
- API pública NAPI antes de estabilizar el motor Rust.
- Usar HTML/CSS/DOM como única representación documental.

## Pendientes

Después de los experimentos, emitir ADR para elección de escritor, módulo de texto y fragmentación, y definir estrategia de release, versionado y compatibilidad de crates.
