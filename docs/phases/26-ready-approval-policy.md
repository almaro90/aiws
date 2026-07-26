# Hito 26 — Aprobación Ready configurable

## Resultado

Cada Project gestionado decide si un curator correcto puede marcar Ready o debe esperar aprobación
manual explícita.

## Dominio

- `Project.readyPolicy = curator_decides | manual_approval_required`.
- Projects existentes y nuevos usan `curator_decides` por defecto.
- `Task.readyApprovalPending` comienza false.
- Cada Run de curation captura `readyPolicy`.
- Con aprobación manual, un resultado completo aplica título/spec, crea la revisión, termina con
  `outcome=approval_required`, conserva Curating, activa el flag y sube Task.version una vez.
- La aprobación pendiente excluye la Task de nuevos claims de curation.
- Web o CLI pueden ejecutar Curating → Ready; se garantiza aprobación manual explícita, no identidad
  humana verificable.
- Questions, reapertura, nuevo Cycle o invalidación del contexto preparado limpian el flag.

## Persistencia y compatibilidad

- Migración forward-only para política, flag, snapshot de Run y nuevo outcome.
- El backfill conserva el comportamiento actual.
- Cambiar Project no reinterpreta Tasks o Runs existentes.

## Aceptación

- Ambas políticas, aprobación concurrente, resultado obsoleto, cambio de política durante Run,
  retry y nuevo Cycle.
- Una única subida de versión y eventos/spec transaccionales.
- API, CLI, Web, cliente, SQL, OpenAPI y timeline sincronizados.
