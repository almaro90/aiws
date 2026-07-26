# Hito 25 — Project Readiness

## Resultado

Un operador puede demostrar que un Project gestionado está preparado para su primera Delivery sin
crear una Task ni un Run de negocio.

## Contrato

- El informe es efímero y contiene `projectId`, `depth`, `checkedAt`, `durationMs`, `ok` y checks
  ordenados con `id`, `status=pass|warning|fail|skipped`, `message` y detalles seguros.
- `standard` comprueba Project, Connection, repositorio remoto, Base Branch, Agent Profiles
  seleccionados, autenticación del modelo y disponibilidad del runner.
- `deep` incluye lo anterior y pide al runner-manager validar imagen agente, ciclo de contenedor
  efímero, workspace escribible, red configurada y toolchain básico.
- El probe profundo usa timeout estricto y cleanup en éxito, error, cancelación y apagado.
- No se persisten informe, credenciales, rutas físicas, identificadores de contenedor ni secretos.

## Superficies

- `POST /api/v1/projects/{projectId}/readiness-check` con `{ "depth": "standard|deep" }`.
- `aiws project doctor PROJECT_ID [--deep]`.
- Acción Web en Project con advertencia explícita antes del probe profundo.
- Operación system-only acotada en runner-manager; nunca control Docker genérico.

## Aceptación

- Orden JSON y exit codes estables.
- GitHub y Azure satisfacen la misma interfaz de checks.
- Configuración ausente/revocada produce warnings/fallos seguros.
- Cleanup profundo probado con fallo inyectado en cada adquisición de recurso.
- Playbooks protegidos ejercitan Connections reales GitHub y Azure.
