# ADR-0003 — Integración PDF y SDK Node.js en el prototipo

- **Fecha:** 2026-10-16
- **Estado:** aceptada para el prototipo, revisable antes de v1
- **Licencia del proyecto:** MIT OR Apache-2.0

## Contexto

SP-01 generó PDFs reales mediante pdf-writer y Krilla; SP-02 probó medición con Parley. Queremos una API Rust consumible desde Node.js sin reescribir el motor ni pasar por HTML/Chromium.

## Decisión

1. **Krilla 0.8.2** escribirá PDFs dentro de `vufra-pdf` en la primera implementación. No se declara ganador absoluto sobre pdf-writer; Krilla utiliza pdf-writer internamente.
2. **Parley 0.12.0** mide texto y calcula saltos de línea usando los bytes de la fuente provistos por el usuario. El renderizado aún usa `krilla::Surface::draw_text`, por lo que no admitimos bidi avanzado ni todo el shaping complejo que Parley soporta.
3. **NAPI-RS 3** ofrece un binding nativo pequeño en `bindings/vufra-node`. Los tipos y validaciones públicas del SDK se mantienen en `packages/vufra`.
4. La API Rust devuelve `Result<Vec<u8>, RenderError>`, mientras que el SDK TypeScript entrega `Uint8Array` (`Buffer` en Node).
5. El SDK se desarrolla primero localmente y no se publica ni ofrece binarios precompilados universalmente. Solo se ha verificado Linux x86_64.

## Consecuencias

- Cambios de Rust y TypeScript pueden probarse juntos en el monorepo.
- Node.js ejecuta código nativo, sin procesos hijos de renderizado.
- La interfaz hoy es **síncrona**, y puede bloquear el event loop con documentos grandes; una versión asíncrona será necesaria para cargas intensivas de servidor.
- El empaquetado requiere añadir binarios por plataforma y una estrategia de publicación/suministro segura antes de producción.
- Las interfaces siguen marcadas experimentales y podrán cambiar con la evolución del motor de layout.

## Alternativas diferidas

- Ejecución de CLI Rust como proceso hijo.
- Wasm como único medio de interoperabilidad.
- Dibujar glifos complejos desde Parley antes de un plan de fuentes/fallback/RTL validado.
