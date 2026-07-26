# AIWS v0.6.2–v0.8 — fases de desarrollo

> Baseline: AIWS v0.6.1, Hito 24 completado.

Este directorio ordena las extensiones posteriores al Hito 24. Solo puede existir un hito
`in_progress`. Antes de implementar una fase se sincronizan PRD, dominio, arquitectura, seguridad,
testing, trazabilidad, OpenAPI y SQL que resulten afectados.

| Hito | Versión | Estado | Resultado |
| ---: | --- | --- | --- |
| 25 | v0.6.2 | `implemented` | Project Readiness efímero; smoke real protegido pendiente |
| 26 | v0.7 | `implemented` | Política configurable de aprobación Ready |
| 27 | v0.7 | `implemented` | Verification Contract versionado por Project |
| 28 | v0.7 | `implemented` | Verification Results confiables, waiver y provenance |
| 29 | v0.7 | `implemented` | Bandeja global Necesita atención |
| 30 | v0.8 | `implemented` | Delivery Projection manual persistida |
| 31 | v0.8 | `implemented` | Diff de Spec y métricas locales exportables |

## Protocolo

1. Sincronizar el implementation pack canónico.
2. Implementar Core → SQLite → API → CLI → Web → packaging.
3. Mantener SQL, OpenAPI, cliente generado, documentación y tests sincronizados.
4. Ejecutar format, lint, typecheck, unitarios, integración, E2E, contrato, build y smoke.
5. Completar aceptación antes de abrir el siguiente hito.

## Fuera de alcance

Execution Profiles, GitLab, webhooks, SSO, RBAC, identidades múltiples, ejecución multiagente,
auto-merge, despliegue, límites de coste y dashboard avanzado.
