# Hito 31 — Trazabilidad de Spec y métricas

## Resultado

El operador revisa la evolución de la spec y exporta evidencia local del rendimiento del producto.

## Spec

- Task Detail compara Spec Revisions inmutables.
- Antes de Ready muestra spec actual, diff previo, Questions abiertas y aprobación explícita.
- Timeline aporta contexto cronológico sin atribuir causalidad no almacenada.

## Métricas

- API y CLI read-only por Project y rango UTC.
- Petición→Ready, duración bloqueada, Questions, Curation/Implementation, primer Run, retries
  full/publish-only/waiver, Verification, PR y merge observado.
- Derivadas de Runs, TaskEvents, Verification Results y Delivery Projection.
- La salida comunica cobertura y staleness.
- Sin dashboard Web, coste/tokens, presupuestos ni telemetría externa.

## Aceptación

- [x] Rangos vacíos, historia parcial, Projects archivados, límites UTC, Delivery stale, retries y
  Cycles.
- [x] Agregados deterministas sin mutar fuentes.
- [x] API, CLI, OpenAPI y cliente generado sincronizados.
- [x] Diff acotado visible en Task Detail antes de Ready, cubierto en desktop y mobile.
- [x] Gates: 373 tests, 107 E2E pasados, 5 omitidos por matriz, build y smoke local.

El smoke Docker se inició con acceso al daemon, pero se interrumpió tras más de 16 minutos
bloqueado dentro de `docker build` sin salida. Los playbooks con credenciales GitHub/Azure reales
siguen siendo gates operativos protegidos.
