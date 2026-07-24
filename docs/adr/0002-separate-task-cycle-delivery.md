# Separar Task, Cycle y Delivery

AIWS mantiene Task como agregado e identidad estable, Task Cycle como unidad incremental de intención y Delivery como continuidad Git. Un mensaje desde Done crea un Cycle y vuelve a Curating; nunca reutiliza silenciosamente la spec como autorización para saltar a Ready. Delivery puede agrupar varios Cycles y Runs, mientras Questions, Attachments, specs y respuestas conservan el Cycle que les dio contexto.

## Consequences

- `Task.status` representa el Cycle activo y las proyecciones `userRequest`, `curatorSpec` y `prUrl` siguen siendo compatibles.
- Messages, Spec Revisions y Question Answers son append-only.
- Los Runs de implementation comparten la rama de Delivery; curation inspecciona ese mismo ref.
- Los recursos de Cycles históricos son de solo lectura.
