# Hito 29 — Necesita atención

## Resultado

El operador obtiene una proyección global y accionable sin inspeccionar cada Task.

## Proyección

- Server-side, paginada, determinista y read-only.
- Razones: `approval_pending`, `questions_open`, `run_failed`, `publication_recoverable`,
  `automation_paused`, `connection_reauthorization`, `runner_unavailable` y
  `verification_failed`.
- Síntomas relacionados se deduplican bajo una causa principal.
- Cada item contiene referencias seguras, explicación, instante detectado y siguiente acción.
- Runner indisponible es un item singleton, no uno por Task.

## Superficies

- `GET /api/v1/attention`.
- `aiws attention list --json`.
- Navegación Web y acciones mediante mutaciones existentes.

## Aceptación

- Orden, paginación, deduplicación, archivados, resolución de causa e item global.
- Sin prioridades, asignaciones, acknowledgement ni nuevo estado Task.
