# Hito 30 — Delivery Projection

## Resultado

AIWS observa manualmente el estado externo de PR y checks sin cambiar el estado de negocio.

## Dominio y seam de provider

- Delivery conserva la última observación y `lastSynchronizedAt`.
- PR: draft/open/closed/merged. Checks: pending/passed/failed/unknown.
- Task permanece Done.
- Refresh explícito y manual; sin worker de polling ni webhook.
- GitHub y Azure implementan la misma interfaz provider-neutral desde el primer release.
- Un error conserva la última observación y devuelve diagnóstico seguro.

## Superficies

- Consultar proyección vigente.
- Refresh desde Web y CLI.
- Task Detail muestra staleness y evidencia.
- Checks fallidos alimentan Necesita atención.

## Aceptación

- Paridad de providers, PR ausente/actualizada/merged/closed, checks mixtos, permisos,
  reautorización, rate limit y observación stale.
- El provider nunca cambia Task.status ni sobrescribe identidad de Delivery.
