# Unidad 29 — Reutilización de fuentes nativas inmutables

Fecha: 2026-10-17. Rama: `feature/unit29-native-immutable-font-assets`.
Base: Unidad28 `a9dfe02`; `origin/main`: `6399ebd`.

## Resultado

- No forzar `napi_detach_arraybuffer` ni interpretar un `Buffer`
  mutable de Node como un `Vec<u8>` de Rust.
- Nuevo `NativeFont` privado: snapshot inicial único y bytes
  guardados en `Arc<Vec<u8>>` inmutable.
- Rust API consume `Arc<Vec<u8>>`, sin volver a copiar al renderizar.
- NAPI sync/async aceptan recurso; workers guardan clon de Arc.
- La Fluent API prepara el recurso por instancia de `Vufra`,
  documentos sucesivos reutilizan el mismo, sin nueva sintaxis.
- Overrides de fuente usan recurso diferente y aislado.
- La cola conserva snapshots propios y cancelación.
- Migración de la prueba interna NAPI a la firma nueva; sin compat.
- Nuevos tests de NativeFont, mutación de original, concurrencia,
  override y PDFs válidos.
- Benchmark repetible de nueve PDFs por factory.

## Medición local (tres procesos, TTF válida rellenada a 10MiB)

| Medida | Antes | Después |
|---|---:|---:|
| maxRSS | 172,57 MiB | 110,74 MiB |
| render + verificación de nueve PDFs | 205,00 ms | 163,72 ms |
| total PDF | 86.701 B, nueve páginas | idéntico |

Benchmark con fuente original real post-cambio: maxRSS 90,00 MiB,
tiempo 167,80ms, sin baseline pareada anterior.

No prometer cero copias ni un porcentaje general. Los valores
sintéticos estresan el coste de snapshots de fuentes grandes.

## Validación y entrega

`cargo fmt`, `cargo clippy -D warnings`,
`cargo test --workspace`, NAPI build,
Node build/test, experimentos de 1.000 registros/29 páginas.
ADR-0030, README y Obsidian.

Entrega local sin push/merge.
