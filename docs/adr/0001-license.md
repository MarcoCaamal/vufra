# ADR-0001: Licencia permisiva dual

- **Estado:** aceptada.
- **Fecha:** 2026-10-16.
- **Decisión:** Vufra se ofrecerá bajo `MIT OR Apache-2.0`.

## Contexto

Vufra será open source y se busca uso sencillo desde proyectos independientes y productos comerciales. Ambas licencias son permisivas: no obligan a publicar código propietario derivado.

## Decisión

- Los paquetes Rust usarán `license = "MIT OR Apache-2.0"` en su metadata Cargo.
- Se incluirán los textos estándar oficiales `LICENSE-MIT` y `LICENSE-APACHE` durante el scaffolding.
- La documentación explicará que los destinatarios pueden elegir cualquiera de las dos licencias, no que deban cumplir ambas simultáneamente.
- Las contribuciones recibidas deberán poder distribuirse bajo la misma fórmula dual (documentar en CONTRIBUTING).
- Se verificará compatibilidad de licencias de las dependencias antes de publicar.

## Consecuencias

- Ventaja: adopción comercial y comunitaria flexible; Apache 2.0 aporta concesión explícita de patentes conforme a sus términos.
- Coste: mantener textos legales, avisos y cumplimiento de dependencias.
- No implica una cesión de marca ni crea obligación de soporte.
- **Pendiente operativo:** determinar titular(es) y año(s) de copyright a mostrar, sin inventarlos.

## Referencias

- https://opensource.org/license/mit
- https://www.apache.org/licenses/LICENSE-2.0
