# Snapshot de Base Branch en Delivery

AIWS trata `Project.defaultBranch` como la preferencia editable para nuevas Tasks y copia la
elección efectiva a `Delivery.baseBranch` al crear una Task gestionada. Curation prepara un
worktree detached desde esa Base Branch mientras la rama de Delivery todavía no existe;
Implementation reutiliza después la misma Delivery y el pull request usa su Base Branch como
destino.

Guardar solo el valor del Project haría que una edición posterior reinterpretase Tasks y pull
requests ya existentes. Guardarlo en Task duplicaría información cuya continuidad pertenece a
Delivery y no resolvería la relación con PR y Runs.

## Consequences

- Cambiar `Project.defaultBranch` solo afecta a Tasks gestionadas creadas después del cambio.
- `Delivery.baseBranch` es inmutable y se conserva entre Runs y Cycles.
- La lista de ramas de GitHub ayuda a seleccionar y validar, pero no sustituye el snapshot local.
- Las Deliveries históricas se rellenan con el default del Project vigente al migrar.
