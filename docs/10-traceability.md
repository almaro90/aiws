# 10 — Matriz de trazabilidad

Esta matriz evita que un requisito quede documentado pero no implementado o probado.

| Requisito | Dominio/API | Hito | Pruebas |
| --- | --- | ---: | --- |
| R-DOM-001 User Request Draft-only | Task update + SQL trigger | 16 | Core, API y SQLite trigger |
| R-DOM-002 Ready controlado | TransitionTask | 1, 4 | Transitions |
| R-DOM-003 Bloqueo conservador | Question create/reopen | 5 | Questions |
| R-DOM-004 Última respuesta → Curating | Answer/DismissQuestion | 16 | Questions + re-curation |
| R-DOM-005 Claim atómico | `/tasks/{id}/transition` | 4 | Concurrency claim |
| R-DOM-006 Versionado agregado | If-Match + UoW | 1–6 | Concurrency/API |
| R-DOM-007 Eventos transaccionales | TaskEventStore | 2, 4–6 | SQLite/failure injection |
| R-DOM-008 Archivado | archive endpoints | 1, 3–4 | Archive |
| R-DOM-009 PR externo | Task PATCH | 1, 4 | Task update |
| R-DOM-010 Un repositorio | Project | 1, 3 | Projects |
| R-NFR-001 Instalación | Docker Compose | 9 | Docker smoke |
| R-NFR-002 Sin servicios externos | Architecture | todos | Build/deploy review |
| R-NFR-003 Contratos estables | OpenAPI/CLI JSON | 3–7 | Contract/CLI |
| R-NFR-004 Seguridad | Auth/storage | 3, 6, 9 | Security |
| R-NFR-005 Persistencia | SQLite/data volume | 2, 9 | Migrations/restart |
| R-NFR-006 Portabilidad CLI | Bun compile | 7, 9 | Build matrix |
| R-NFR-007 Instancia única | Deploy docs | 9 | Config review |
| R-NFR-008 Observabilidad | middleware | 3 | API/log tests |

## Cobertura por endpoint

| Endpoint group | Use cases | Hito |
| --- | --- | ---: |
| `/health` | HealthCheck | 3 |
| `/auth/*` | Login/Session/Logout | 3 |
| `/projects*` | Project use cases | 3 |
| `/tasks` | Create/ListTask | 4 |
| `/tasks/{id}` | Get/UpdateTask | 4 |
| `/transition` | TransitionTask | 4 |
| `/archive`, `/unarchive` | ArchiveTask | 4 |
| `/questions*` | Question use cases | 5 |
| `/attachments*` | Attachment use cases | 6 |
| `/activity` | ListTaskActivity | 4 |
| `/openapi.json` | Generated contract | 3 |
| `/notification-settings*` | NotificationSettingsService | 20 |

## Cobertura CLI

| CLI | Endpoint | Hito |
| --- | --- | ---: |
| `project create/list/show/update/archive/unarchive` | Projects | 7 |
| `task create/list/show/update/transition/archive/unarchive` | Tasks | 7 |
| `task activity` | Activity | 7 |
| `task question *` | Questions | 7 |
| `task attachment *` | Attachments | 7 |

## Cobertura Web

| Pantalla | Endpoints | Hito |
| --- | --- | ---: |
| Login | Auth | 8 |
| Projects list/form/detail | Projects | 8 |
| Tasks list/create | Tasks/Attachments | 8 |
| Task detail | Task aggregate | 8 |
| Questions | Questions | 8 |
| Spec/PR/status | Task update/transition | 8 |
| Attachments | Attachments | 8 |
| Activity | Activity | 8 |
| Notificaciones | Notification settings/test | 20 |

## Acceptance → evidencia

| Acceptance PRD | Evidencia mínima |
| --- | --- |
| Project válido/ruta inválida | Integration test con roots y git temp |
| Task editable en Draft y congelada | Core/API test + trigger test |
| Agregado completo | API schema + integration assertion |
| Spec por stdin | CLI integration |
| Question bloquea | Domain + API integration |
| Tres tipos Web | Component/manual checklist |
| Última pregunta → Curating | Domain concurrency-safe test + nuevo curation attempt |
| Ready requirements | Transition matrix |
| Claim concurrente | Parallel integration test |
| Agente lee adjuntos | CLI upload/download checksum |
| PR URL | Update tests |
| Done sin PR | Transition test |
| Done reabre | Transition test |
| Archive/restaura | Domain/API/CLI tests |
| Activity completa | Event assertions por mutation |
| HTTP-only Web/CLI | Dependency/import rule |
| Auth total | Route matrix |
| Restart persistente | Docker smoke |
| Auto migrations | Empty DB boot smoke |
| OpenAPI coincide | CI contract check |
| Gates verdes | CI status |

## Decisiones cerradas

No quedan decisiones de producto o arquitectura abiertas para comenzar la implementación.

Durante la implementación solo se permiten decisiones locales que no alteren:

- Contrato público.
- Invariantes.
- Stack.
- Scope.
- Persistencia.
- Seguridad.

## Cobertura v0.3

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Curating explícito | Task state machine | Core transition matrix + API |
| Curation gestionada siempre | Run claim de managed Curating | SQLite integration |
| Resultado discriminado | system-only curation-result | Contract + integration |
| Aplicación atómica | RunUseCases + UoW | Ready, Blocked y conflict tests |
| Attempts por kind | RunStore | Migration + retry tests |
| Concurrencia compartida | Project active Runs | Claim/retry tests |
| Contexto read-only | Runner mounts/output schema | Runner/Docker verification |

Una decisión que afecte alguno de estos puntos requiere actualizar el pack y aprobación antes de implementarla.

## Cobertura v0.4

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Cambio incremental | MessageUseCases + `/messages` | concurrencia Done |
| Contexto no responde | MessageUseCases | Question permanece Open |
| Historial append-only | SpecRevision/QuestionAnswer | dos respuestas revisadas |
| Aislamiento por Cycle | `cycleId` y validación | Question histórica rechazada |
| Delivery estable | Delivery + Run branch | retry comparte branch |
| Timeline | `/timeline`, CLI y Web | contrato, build y E2E |
| Migración sin pérdida | `0004_task_cycles.sql` | migration integration |

## Cobertura de recuperación de Runs

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Checkpoint de publicación | `Run.executionStage` | retry persistence |
| Reanudación enlazada | `resumeFromRunId` | migración + workspace tests |
| Logs incrementales | PUT atómico `/runs/{id}/logs` | runner/server tests |
| Cancelación efectiva | estado terminal + `docker stop` | runner/E2E |
| Credencial fresca | credenciales tras Codex | runner automation test |

## Cobertura del catálogo de modelos

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Catálogo vivo | `/agent-profiles/model-catalog` + runner adapter | JSON-RPC/paginación/API |
| Selección válida | AgentProfile create | Core/API modelo y effort inválidos |
| Compatibilidad legacy | migración 0006 | mapper y null sin backfill |
| Ejecución exacta | argumentos Codex | test modelo + `model_reasoning_effort` |
| UX cerrada | CLI/Web | flags obligatorios, defaults, retry y selección dependiente |

## Cobertura operativa del runner

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Disponibilidad visible | `/system/runner` | monitor determinista + API + Playwright |
| Pausa acotada al Cycle | MessageUseCases | regresión SQLite de nuevo Cycle |
| Resume seguro | `TaskUseCases.resumeAutomation` | Core/SQLite/API/CLI |
| Menor autoridad | Server sin socket Docker | arquitectura y revisión de composición |

## Cobertura de notificaciones

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Evento y outbox atómicos | TaskEventStore SQLite decorado | rollback + transición confirmada |
| Workflow independiente | Dispatcher post-commit | ntfy 503 conserva Task/outbox |
| Token secreto | AES-256-GCM + DTO enmascarado | crypto/startup/API/log tests |
| Entrega estable | backoff + `sequence_id` | publisher/dispatcher tests |
| Configuración global | `/notification-settings*` + Web | auth, Origin, validación y UI |

## Cobertura de perfiles separados — Hito 21

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Perfil curator obligatorio | Draft → Curating | Core, SQLite y API missing/disabled |
| Perfil implementador obligatorio | Project automation | Core y API con field path específico |
| Resolución por kind | Run claim/Retry | perfiles distintos y retry vigente |
| Snapshot histórico | `Run.agentProfileId` | Run previo y queued tras editar Project |
| Compatibilidad v0.5 | migración `0008` | backfill doble y Run preservado |
| UX independiente | Project Automation Web | dos selects y activación condicionada |

## Cobertura de rama de referencia — Hito 22

| Requisito | Dominio/API | Evidencia |
| --- | --- | --- |
| Default editable | Project + PATCH | API/UI y rama inexistente |
| Snapshot histórico | `Delivery.baseBranch` | Core + migración 0009 |
| Selección remota | `/projects/{id}/branches` | GitHub gateway + API |
| Ejecución coherente | runner workspace + PR | fetch/worktree y base mismatch |
| Compatibilidad | backfill desde Project | migration integration |

## Cobertura de distribución — Hito 23

| Requisito | Superficie | Evidencia |
| --- | --- | --- |
| Stack sin checkout | Bundle Compose + GHCR | test de contrato + workflow amd64/arm64 |
| CLI independiente | GitHub Release | matriz de cinco targets + checksums |
| Config compartida | `aiws config` + `aiws-agents` | precedencia, permisos y redacción |
| Actualización segura | installer + tags exactos | checksum y rename antes de reemplazo |
| Agentes desacoplados | skill/docs | sin servicios, credenciales ni overlays propios |
| Licencia | paquetes/OCI/OpenAPI/release | AGPL-3.0-only y metadatos |
| Contratos internos estables | OpenAPI/SQL | solo versión/licencia; cero migraciones |
