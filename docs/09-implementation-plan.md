# 09 — Plan de implementación

## Reglas

- Ejecutar hitos en orden.
- Un único hito en progreso.
- No marcar un hito completo con tests omitidos.
- Cada hito debe dejar main buildable.
- No posponer tests de dominio al final.
- No comenzar Web antes de completar CLI.

## Hito 0 — Foundation

### Entregables

- Bun Workspaces.
- Estructura `apps/` y `packages/`.
- TypeScript base estricto.
- Biome.
- Scripts root.
- CI.
- Config loader Zod.
- Clock/ID utilities.
- README de desarrollo.

### Trabajo

- [ ] Crear root package y workspaces.
- [ ] Crear package manifests sin dependencias circulares.
- [ ] Configurar `strict` y `noUncheckedIndexedAccess`.
- [ ] Configurar aliases/export maps.
- [ ] Configurar Biome.
- [ ] Crear scripts `format`, `format:check`, `lint`, `typecheck`, `test`, `build`, `contract:check`, `smoke`.
- [ ] Configurar CI con install frozen lockfile.
- [ ] Implementar validación de env.
- [ ] Implementar prefijos ULID.

### Done criteria

- [ ] `bun install --frozen-lockfile`.
- [ ] Format/lint/typecheck/test vacíos en verde.
- [ ] Import graph respeta arquitectura.
- [ ] Config inválida falla con mensaje redactado.
- [ ] Generadores producen IDs válidos.

## Hito 1 — Core de Project y Task

### Entregables

- Entidades/value objects.
- Errores.
- State machine.
- Puertos.
- Use cases sin infraestructura.

### Trabajo

- [ ] Project invariants.
- [ ] Task invariants.
- [ ] Título generado.
- [ ] Spec y PR URL.
- [ ] Transiciones explícitas.
- [ ] Archive/unarchive.
- [ ] Version conflict abstraction.
- [ ] Event factory/metadata segura.

### Done criteria

- [ ] Tests unitarios de PRD R-DOM-001, 002, 005, 006, 008, 009 y 010.
- [ ] Core no importa frameworks/runtime infrastructure.
- [ ] Todas las transiciones no permitidas están testeadas.

## Hito 2 — SQLite y migraciones

### Entregables

- Database adapter.
- Migration runner.
- Repositories.
- Unit of Work.
- Queries/pagination.

### Trabajo

- [ ] Copiar `0001_initial.sql` al package.
- [ ] Implementar pragmas.
- [ ] Implementar checksums/migrations forward-only.
- [ ] Mappers row ↔ domain.
- [ ] Repositories Project/Task/Event.
- [ ] UnitOfWork con `BEGIN IMMEDIATE`.
- [ ] Keyset cursors.
- [ ] Queries filtradas/indexadas.

### Done criteria

- [ ] Matriz SQLite/migrations completa.
- [ ] Integration tests con DB temporal.
- [ ] Trigger User Request probado.
- [ ] Query plans usan índices en consultas objetivo.
- [ ] DB resources se cierran limpiamente.

## Hito 3 — Server, auth y Projects vertical slice

### Entregables

- Hono Server.
- Middleware.
- Login/session/Bearer.
- Projects API.
- OpenAPI generation.

### Trabajo

- [ ] Request ID.
- [ ] Logs/redaction.
- [ ] Error mapper.
- [ ] Auth cookie.
- [ ] Bearer validation.
- [ ] Origin protection.
- [ ] Login rate limit.
- [ ] Health.
- [ ] Repository root validation/Git spawn.
- [ ] Projects endpoints.
- [ ] OpenAPI endpoint/snapshot tooling.

### Done criteria

- [ ] Auth matrix.
- [ ] Projects endpoints coinciden con OpenAPI.
- [ ] Path/symlink security tests.
- [ ] Sin auth salvo health devuelve 401.
- [ ] Contract snapshot sin diff.

## Hito 4 — Tasks y Activity vertical slice

### Entregables

- Tasks endpoints.
- List/filter/pagination.
- Aggregate.
- Transitions.
- Activity.
- ETag/If-Match.

### Trabajo

- [ ] Create/list/show/update.
- [ ] Transition.
- [ ] Archive/unarchive.
- [ ] Activity pagination.
- [ ] Transaction + events.
- [ ] Concurrency SQL.

### Done criteria

- [ ] Task/domain/API matrices relevantes.
- [ ] Dos claims concurrentes: uno vence.
- [ ] Task show realiza el agregado esperado.
- [ ] List devuelve summaries.
- [ ] If-Match/ETag en todos los endpoints.

## Hito 5 — Questions

### Entregables

- Core/use cases.
- SQLite adapter.
- API.
- Auto-state workflow.

### Trabajo

- [ ] Text/single/multiple validation.
- [ ] Option IDs/positions.
- [ ] Create/update/answer/dismiss/reopen.
- [ ] Curating/Ready/Implementing → Blocked; Draft rechaza Questions.
- [ ] Last open resolved → Curating.
- [ ] Events.

### Done criteria

- [ ] Question matrix completa.
- [ ] Mutation/version/event en una transacción.
- [ ] Done rechaza create/reopen.
- [ ] Ready nunca automático.
- [ ] OpenAPI actualizado/sin diff.

## Hito 6 — Attachments

### Entregables

- Staging/quarantine storage.
- Validación de formato.
- API upload/download/delete.
- Cleanup de huérfanos.

### Trabajo

- [ ] Directorios/permisos.
- [ ] Streaming limit/hash.
- [ ] Magic bytes/text validation.
- [ ] Add/list/get/content/delete.
- [ ] Coordination DB/files.
- [ ] Content headers.
- [ ] Startup cleanup.

### Done criteria

- [ ] Attachment matrix completa.
- [ ] No traversal.
- [ ] No blob huérfano en fallos simulados.
- [ ] Bytes descargados idénticos.
- [ ] Memoria no crece con tamaño completo del upload.

## Hito 7 — CLI completo

### Entregables

- Commander command tree.
- OpenAPI client generado.
- Human/JSON output.
- File/stdin/stream support.
- Exit codes.

### Trabajo

- [ ] Global config.
- [ ] Projects commands.
- [ ] Tasks commands.
- [ ] Questions commands.
- [ ] Attachments commands.
- [ ] Activity.
- [ ] Errors/exit mapping.
- [ ] Compile targets.

### Done criteria

- [ ] CLI matrix completa.
- [ ] Agent flow completo solo con `--json`.
- [ ] No prompts en JSON.
- [ ] Token nunca se imprime.
- [ ] Binario Linux x64 y ARM64 se construye en CI/release.

## Hito 8 — Web

### Entregables

- SPA.
- Auth.
- Projects.
- Tasks.
- Questions.
- Attachments.
- Activity.

### Trabajo

- [ ] Router/shell/guards.
- [ ] API Query client.
- [ ] Login/logout.
- [ ] Project views.
- [ ] Task list/filters.
- [ ] Task create.
- [ ] Task detail.
- [ ] Question forms.
- [ ] Markdown editor/preview.
- [ ] Upload/download/delete.
- [ ] Conflict handling.
- [ ] Accessibility states.
- [ ] Playwright Chromium para flujos UI críticos desktop/mobile.

### Done criteria

- [ ] Checklist Web completo.
- [ ] Raw HTML Markdown no ejecuta.
- [ ] Conflicto conserva input.
- [ ] Build sin warnings relevantes.
- [ ] SPA servida por Server.

## Hito 9 — Packaging y hardening

### Entregables

- Dockerfile multi-stage.
- Compose.
- Healthcheck command.
- Secret helper commands.
- Install/run docs.
- Smoke suite.

### Trabajo

- [ ] Container non-root/read-only rootfs.
- [ ] `/data` persistente.
- [ ] Repo root mounts.
- [ ] Graceful shutdown.
- [ ] Secret generators.
- [ ] Production headers.
- [ ] Docker smoke.
- [ ] CLI release build matrix.
- [ ] Final contract synchronization.

### Done criteria

- [ ] Docker smoke completo.
- [ ] Reinicio conserva DB/attachments.
- [ ] Healthcheck detecta DB no disponible.
- [ ] Container no escribe fuera de `/data` y `/tmp`.
- [ ] OpenAPI snapshot coincide.
- [ ] Todos los gates root en verde.

## Hito 10 — Acceptance

### Flujo final obligatorio

1. Crear Project.
2. Crear Task con screenshot/log.
3. Usuario envía Draft → Curating.
4. Curator lee agregado y adjuntos.
5. Curator crea single-choice Question.
6. Task queda Blocked.
7. Usuario responde.
8. Task vuelve a Curating.
9. Curator actualiza spec.
10. Curator transiciona Curating → Ready.
11. Dos agentes intentan claim.
12. Solo uno obtiene Implementing.
13. Agente registra PR URL.
14. Agente completa Done.
15. Usuario solicita un cambio; se crea otro Cycle y Done → Curating.
16. Archiva Task.
17. Archiva Project.
18. Reinicia y verifica todo.

### Done criteria

- [ ] Flujo ejecutado por CLI JSON.
- [ ] Flujo funcional en Web.
- [ ] Activity refleja la secuencia.
- [ ] No existen inconsistencias SQL/files.
- [ ] PRD Acceptance completo.
- [ ] Documentación y contratos finales.

## Definition of Done por hito

Un hito está completo solo si:

- Código implementado.
- Unit tests.
- Integration tests.
- Error paths.
- Docs/contratos sincronizados.
- Format/lint/typecheck/test.
- No TODO/FIXME del hito.
- Revisión de scope.

## Extensión v0.2 — completada

Los hitos 1–10 describen la baseline v0.1. La v0.2 se implementa en orden como un único vertical slice post-MVP:

### Hito 11 — Contratos y persistencia

- [x] Modelo de Connection, AgentProfile y Run.
- [x] Migración `0002_managed_automation.sql` e índices.
- [x] OpenAPI v0.2 y cliente generado.

### Hito 12 — GitHub y Projects gestionados

- [x] GitHub App, callback firmado e instalación idempotente.
- [x] Listado e importación de repositorios.
- [x] Credenciales de instalación efímeras y draft PR.

### Hito 13 — Runner Codex aislado

- [x] Claim atómico, cron y concurrencia.
- [x] Mirror/worktree por Run.
- [x] Contenedor Codex restringido y proxy de credenciales.
- [x] Heartbeat, reconciliación, logs, éxito, fallo y retry manual.

### Hito 14 — Superficies de usuario

- [x] CLI para Connections, Agent Profiles y Runs.
- [x] Web para conexión/importación, perfiles, configuración del Project e historial de Runs.

### Hito 15 — Packaging y aceptación

- [x] Targets Docker server, manager y agent; volúmenes y red interna.
- [x] Gates completos, smoke y revisión final de aceptación.

## Extensión v0.3 — completada

### Hito 16 — Curation gestionada

- [x] Curating, edición Draft y congelación de User Request.
- [x] Migración `0003_managed_curation.sql` con compatibilidad v0.2.
- [x] Run kind/outcome, attempts por kind y concurrencia compartida.
- [x] Claim, resultado estructurado atómico, conflicto, fallo y Retry.
- [x] Runner read-only con Attachments, imágenes, PDF y output schema.
- [x] API, CLI, Web, OpenAPI y cliente generado.
- [x] PRD, modelo, ADR, glosario, trazabilidad y workflow skill.
- [x] Gates completos, E2E gestionado y Docker smoke.

## Extensión v0.4 — completada

### Hito 17 — Cambios incrementales por ciclos

- [x] Modelo Task/Cycle/Message/SpecRevision/QuestionAnswer/Delivery e IDs.
- [x] Migración forward-only con backfill sin pérdida e índices.
- [x] Done + Message → nuevo Cycle + Curating; Blocked + Message conserva Questions.
- [x] Snapshots de specs y respuestas; Questions históricas read-only.
- [x] API multipart de mensajes, timeline paginada y agregado extendido.
- [x] CLI message/timeline y runner con historial/ref de Delivery.
- [x] Timeline Web, inspector, composer condicional y polling.
- [x] Gates completos, E2E desktop/mobile y Docker smoke con volumen conservado.

## Recuperación y observabilidad — completada

### Hito 18 — Runs recuperables y observables

- [x] Polling de Task, timeline, Run y logs sin WebSockets.
- [x] Logs incrementales atómicos, redactados y limitados a 5 MB.
- [x] Cancelación efectiva y reconciliación periódica de contenedores.
- [x] Checkpoint publishing, credenciales Git renovadas y Retry auto/full/publish_only.
- [x] Migración `0005_run_recovery.sql`, OpenAPI, cliente, CLI y documentación.
- [x] Gates completos, E2E y Docker smoke aislado.
- [x] Recuperación del attempt 2 y Task final en Done.

## Catálogo de modelos — completada

### Hito 19 — Catálogo vivo y reasoning effort

- [x] Adapter encapsulado para `codex app-server`, inicialización, paginación y normalización.
- [x] Canal de control Server → runner con secreto dedicado y red interna.
- [x] Endpoint público autenticado y validación de modelo/effort al crear.
- [x] Migración `0006` compatible con perfiles legacy nulos.
- [x] CLI y Web con selección cerrada, defaults, error y retry.
- [x] Modelo/effort exactos en Runs; contratos, cliente y documentación sincronizados.
- [x] Gates completos, E2E afectado y Docker smoke.

### Corrección operativa posterior al Hito 19

- [x] Un Cycle nuevo limpia pausas heredadas.
- [x] Estado online/offline/unknown del runner en API, header, Automatización y CLI.
- [x] Reanudación manual versionada de Tasks pausadas en API, Web y CLI.
- [x] Sin control Docker ni ampliación de autoridad del Server.

## Extensión v0.5 — completada

### Hito 20 — Notificaciones globales mediante ntfy

- [x] Configuración singleton, migración `0007` y outbox persistente indexada.
- [x] Decorador transaccional de `TaskEventStore` para todo `status_changed`.
- [x] AES-256-GCM, clave de entorno y generador offline.
- [x] Dispatcher Server con polling, lotes, concurrencia, timeout, backoff e idempotencia.
- [x] Cancelación por generación, sin backfill y sin acoplar Core a ntfy.
- [x] Endpoints autenticados, schemas Zod, OpenAPI y cliente generado.
- [x] Pantalla Web, navegación, token enmascarado, prueba y advertencia de privacidad.
- [x] Pruebas de migración, atomicidad, cifrado, entrega, retry, API, Web y contratos.
- [x] Documentación de configuración/Docker y revisión de alcance.

## Perfiles separados — completado

### Hito 21 — Agent Profiles por fase

- [x] `Project` y contrato público separan perfiles de Curation e Implementation sin fallback.
- [x] Migración `0008` preserva Projects existentes y snapshots de Runs.
- [x] Transición, claim y Retry validan/resuelven el perfil correspondiente al kind.
- [x] Cron exclusivo de Implementation y concurrencia compartida permanecen invariantes.
- [x] Web presenta dos selectores y permite Curation con Implementation desactivada.
- [x] OpenAPI, cliente generado, Core, SQLite, API, Web, E2E y documentación sincronizados.

## Rama de referencia — completada

### Hito 22 — Base Branch por Delivery y fetch seguro

- [x] `Project.defaultBranch` editable y validada contra GitHub.
- [x] `Delivery.baseBranch` inmutable con migración `0009` y backfill.
- [x] Selección por Task con default del Project en API, CLI y Web.
- [x] Curation, Implementation y PR consumen el snapshot.
- [x] Fetch aislado en `refs/remotes/origin/*` sin colisión con worktrees.
- [x] OpenAPI, cliente generado, tests y documentación sincronizados.

## Distribución v0.5.1 — completada

### Hito 23 — Stack publicable y CLI compartido

- [x] Configuración persistente del CLI, precedencia, redacción y comandos `config`.
- [x] Instalador Linux verificable, grupo `aiws-agents` y reemplazo atómico.
- [x] Cinco binarios comprimidos, checksums y contrato de assets.
- [x] Imágenes GHCR multi-arquitectura con tags exacto/minor/major/latest, SBOM y procedencia.
- [x] Bundle Compose sin builds, configuración, secretos y guía de operación.
- [x] Licencia AGPL-3.0-only y metadatos en paquetes, OpenAPI, imágenes y release.
- [x] Skill portable y ejemplos por agente desde el tag `v0.5.1`.
- [x] Documentación y pruebas de contratos de distribución sincronizadas.
- [x] Gates completos y smoke Docker del checkout y del bundle vacío.

No forman parte del hito la instalación/configuración de agentes externos, scopes nuevos,
overlays de sandbox, servicios adicionales ni cambios de dominio/API/SQLite.

## Azure DevOps v0.6.0 — completado

### Hito 24 — Provider gestionado Azure DevOps

- [x] Cerrar Hito 23 y sincronizar PRD, dominio, arquitectura, seguridad y trazabilidad.
- [x] Unión discriminada Connection y migración forward-only `0010`.
- [x] Entra OAuth multitenant con PKCE, selección de organización, cifrado y reautorización.
- [x] `ManagedGitProvider` con adapters GitHub/Azure para repos, ramas, Git y draft PR.
- [x] Credenciales Git system-only basic/bearer y runner sin exposición de secretos.
- [x] API, CLI, Web, OpenAPI, cliente generado y versión pública v0.6.0.
- [x] Tests Core/SQLite/OAuth/adapter/registry/runner/API/CLI/Web.
- [x] Gates completos, E2E, build y smoke sin red Azure real.

Fuera de alcance: Azure DevOps Server, MSA, PAT, service principals, webhooks, sincronización
posterior, merge, reviewers, Azure Boards y Pipelines.
