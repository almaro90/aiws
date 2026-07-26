# AIWS — Product Requirements Document

> Versión: v0.8
> Estado: Hito 31 implementado
> Fecha: 26 de julio de 2026

## 1. Resumen

AIWS es un gestor de tareas local y AI-first. Permite que una persona cree una petición original e inmutable, que un curator externo la transforme en una especificación implementable, que formule preguntas estructuradas cuando falte información y que un agente externo implemente el trabajo usando el repositorio local asociado al proyecto.

La base v0.1 proporciona el registro, workflow, CLI y contratos para agentes externos. La extensión v0.2 añade repositorios GitHub gestionados y un runner Codex aislado. La v0.3 gestiona Curation. La v0.4 convierte cada Task en un hilo incremental de varios ciclos y separa cada Cycle de su Delivery Git. La v0.5 añade notificaciones globales de cambios de estado mediante ntfy sin acoplar el workflow a la red. El Hito 21 separa por Project gestionado los Agent Profiles de Curation e Implementation, manteniendo cada `Run.agentProfileId` como snapshot histórico. La v0.5.1 distribuye el stack y el CLI por canales independientes. La v0.6.0 añade Azure DevOps Services como segundo provider gestionado con paridad operativa con GitHub.

## 2. Problema

Las herramientas generalistas de tareas almacenan una descripción y un estado, pero no ofrecen un contrato preparado para agentes:

- La petición original suele mezclarse con interpretaciones posteriores.
- Las preguntas y respuestas no forman parte estructurada del workflow.
- No existe una especificación de curación claramente separada.
- Los agentes carecen de un CLI y un JSON estable.
- Dos agentes pueden intentar trabajar en la misma tarea.
- Capturas, logs y otros adjuntos no siempre son accesibles de forma automatizable.
- El contexto del repositorio y de la identidad Git suele quedar fuera de la tarea.

## 3. Objetivo

Entregar un núcleo instalable que permita completar este flujo:

1. Registrar un Project con un único repositorio local.
2. Crear una Task conservando la petición original.
3. Permitir que el curator consulte proyecto, petición y adjuntos.
4. Permitir que el curator escriba una Curator Spec o cree preguntas.
5. Facilitar respuestas abiertas, de selección única o múltiple.
6. Marcar la tarea como Ready únicamente mediante una decisión explícita del curator.
7. Permitir que un agente reclame la tarea de forma atómica.
8. Registrar la URL de un PR creado externamente.
9. Finalizar, reabrir, archivar y consultar la actividad.

## 4. Usuarios

### Administrador Web

Puede gestionar Projects y Tasks, responder preguntas, adjuntar archivos, editar la Curator Spec y cambiar estados.

En v0.1 existe un único administrador configurado externamente. No existen alta de usuarios, roles ni permisos por proyecto.

### Persona o agente mediante CLI

Opera usando un token Bearer. Puede realizar las mismas operaciones de dominio expuestas por la API, respetando versiones y transiciones.

### Curator externo

Es una persona o agente que:

- Busca Tasks en Curating.
- Lee el agregado completo de la Task.
- Inspecciona el repositorio y los adjuntos.
- Actualiza la Curator Spec.
- Crea preguntas cuando falta información.
- Decide explícitamente cuándo una Task está Ready.

### Implementador externo

Es una persona o agente que:

- Busca Tasks Ready.
- Realiza atómicamente Ready → Implementing.
- Lee la spec y los adjuntos.
- Trabaja directamente en el repositorio local.
- Puede bloquear la tarea creando una pregunta.
- Registra un único `pr_url` opcional.
- Finaliza mediante Implementing → Done.

## 5. Alcance funcional

### Projects

- Crear, listar, consultar y actualizar.
- Un Project representa exactamente un repositorio.
- Registrar nombre, descripción, ruta local, proveedor Git y ámbito de cuenta.
- Validar la ruta contra roots permitidos y comprobar que contiene un repositorio Git.
- Archivar y restaurar.
- Impedir el archivado mientras tenga Tasks activas.

### Tasks

- Crear, listar, consultar y actualizar.
- Pertenencia obligatoria a un Project.
- Petición editable en Draft e inmutable desde Curating.
- Título opcional con generación determinista si se omite.
- Curator Spec Markdown.
- Estados Draft, Curating, Blocked, Ready, Implementing y Done.
- Concurrencia optimista mediante `version`.
- Un único `pr_url` opcional.
- Archivado y restauración sin borrado físico.
- Vista agregada con Project, Questions y Attachments.

### Questions

- Texto libre, selección única o selección múltiple.
- Opciones estables con IDs.
- Opción “Otro” mediante `allow_other`.
- Responder, descartar y reabrir.
- Congelar texto/opciones después de la primera respuesta.
- Bloquear automáticamente una Task al crear o reabrir una pregunta.
- Devolver la Task a Curating cuando se resuelva su última pregunta abierta.
- Nunca mover automáticamente una Task a Ready.

### Attachments

- Añadir, listar, descargar y eliminar.
- Máximo inicial de 10 adjuntos por Task.
- Máximo inicial de 25 MiB por fichero.
- Imágenes, PDF y formatos textuales permitidos.
- Persistencia local fuera de SQLite.
- SHA-256.
- Acceso autenticado desde Web, API y CLI.
- Sin OCR, parsing, embeddings ni análisis automático.

### Activity

- Registro append-only de mutaciones relevantes.
- Actor `web`, `cli` o `system`.
- Motivo opcional de las transiciones.
- Sin restauración de versiones ni auditoría de contenidos completos.

### Web

- Login.
- Projects.
- Tasks y filtros.
- Crear Task con adjuntos.
- Detalle completo.
- Editor Markdown sencillo.
- Preguntas con controles adecuados.
- Adjuntos.
- Estado y PR URL.
- Actividad.
- Archivado/restauración.

### CLI

- Cobertura de las operaciones del MVP.
- Salida humana y `--json`.
- Textos largos mediante fichero o stdin.
- Descarga de adjuntos.
- Versiones esperadas en mutaciones.
- Errores y códigos de salida estables.

## 6. Requisitos de dominio

### R-DOM-001 — Petición inmutable

`user_request` puede modificarse únicamente en Draft y queda inmutable al ejecutar Draft → Curating.

### R-DOM-002 — Ready controlado

Una Task solo puede entrar en Ready si:

- `curator_spec.trim()` no está vacío.
- No existen Questions abiertas.
- La transición fue solicitada explícitamente.

### R-DOM-003 — Bloqueo conservador

Crear o reabrir una Question en Curating, Ready o Implementing cambia la Task a Blocked dentro de la misma transacción.

No se pueden crear ni reabrir Questions en Done.

### R-DOM-004 — Retorno al curator

Cuando se responde o descarta la última Question abierta de una Task Blocked, la Task cambia automáticamente a Curating. Conserva la Curator Spec existente y vuelve a ser elegible para curation gestionada.

### R-DOM-005 — Claim atómico

Ready → Implementing requiere el estado de origen y la versión esperada. Dos peticiones concurrentes no pueden vencer.

### R-DOM-006 — Versionado agregado

Toda mutación de Task o de sus Questions/Attachments incrementa exactamente una vez `Task.version`.

### R-DOM-007 — Historial transaccional

La mutación y sus TaskEvents se guardan en la misma transacción SQLite.

### R-DOM-008 — Archivado

Projects y Tasks se archivan, no se eliminan físicamente.

### R-DOM-009 — PR externo

AIWS almacena como máximo una URL de PR, pero no crea, consulta ni sincroniza el PR.

### R-DOM-010 — Un repositorio

Cada Project contiene exactamente una ruta de repositorio; no existe una entidad Repository.

## 7. Requisitos no funcionales

### R-NFR-001 — Instalación

El servidor debe arrancar mediante un Compose con un único servicio y un volumen persistente.

### R-NFR-002 — Sin dependencias operativas externas

El MVP no necesita Postgres, Redis, Nginx, object storage, workers ni servicios cloud.

### R-NFR-003 — Contratos estables

- API bajo `/api/v1`.
- OpenAPI 3.1 generado y verificable.
- JSON camelCase.
- Fechas UTC RFC 3339.
- IDs ULID con prefijos.

### R-NFR-004 — Seguridad

- Toda ruta salvo `/health` requiere autenticación.
- Sesión Web segura.
- Bearer token para CLI.
- No CORS por defecto.
- Validación de roots de repositorio.
- Protección ante path traversal y contenido Markdown inseguro.

### R-NFR-005 — Persistencia

- SQLite en WAL.
- Foreign keys habilitadas.
- Migraciones automáticas antes de servir tráfico.
- Todo estado mutable bajo `/data`.

### R-NFR-006 — Portabilidad

El CLI debe poder compilarse como binario para Linux x64/ARM64, macOS x64/ARM64 y Windows x64.

### R-NFR-007 — Instancia única

v0.1 admite una única instancia de servidor escribiendo sobre el volumen. El escalado horizontal queda fuera de alcance.

### R-NFR-008 — Observabilidad mínima

- Logs estructurados.
- Request ID.
- Healthcheck.
- Secretos y contenido sensible redactados.

## 8. Fuera de alcance

- Agentes internos y ejecución automática.
- GitHub, Azure DevOps o GitLab APIs.
- Creación, consulta o merge de PR.
- Branches y commits.
- Ingest e indexado del repositorio.
- Knowledge, RAG y embeddings.
- OCR y parsing de adjuntos.
- Usuarios múltiples, equipos, roles y permisos.
- Prioridad, etiquetas, fechas límite y asignaciones.
- Comentarios genéricos.
- Múltiples PR por Task.
- Reviewer, QA automáticos y orquestación multiagente.
- Plugins, MCP y webhooks.
- Dashboard avanzado.
- Borrado físico de Projects o Tasks.
- Restauración de versiones anteriores.
- Suites E2E exhaustivas o multi-browser; el MVP mantiene una verificación UI crítica en Chromium.
- Backups automatizados.

## 9. Criterios de aceptación del MVP

- [ ] Puede crearse un Project válido y rechazarse una ruta no permitida/no Git.
- [ ] Puede crearse una Task, editar su petición en Draft y congelarla al enviarla.
- [ ] El curator puede recuperar todo el contexto con una sola consulta de Task.
- [ ] La Curator Spec puede enviarse mediante fichero o stdin.
- [ ] Crear una pregunta bloquea automáticamente la Task.
- [ ] La Web renderiza correctamente los tres tipos de pregunta.
- [ ] Resolver la última pregunta devuelve la Task a Curating.
- [ ] Ready se rechaza sin spec o con Questions abiertas.
- [ ] Dos claims concurrentes producen un éxito y un conflicto.
- [ ] Un agente puede descargar y leer todos los tipos de adjunto admitidos.
- [ ] Puede establecerse, reemplazarse y eliminarse `pr_url`.
- [ ] Done no exige PR.
- [ ] Una Task Done acepta un cambio incremental que crea un Cycle y vuelve a Curating.
- [ ] Projects y Tasks pueden archivarse y restaurarse.
- [ ] La actividad refleja todas las mutaciones definidas.
- [ ] Web y CLI usan exclusivamente la API.
- [ ] Todos los endpoints protegidos rechazan credenciales ausentes o inválidas.
- [ ] El servidor reinicia sin perder SQLite ni adjuntos.
- [ ] Una instalación nueva ejecuta las migraciones automáticamente.
- [ ] El OpenAPI generado coincide con el snapshot.
- [ ] Todos los tests y verificaciones definidos están en verde.

## 10. Definition of Done global

El MVP se considera terminado cuando:

- Todos los requisitos P0 y criterios de aceptación están implementados.
- Todos los hitos de `docs/09-implementation-plan.md` están completos.
- No existen TODO/FIXME relativos al alcance v0.1.
- Lint, formato, typecheck y tests pasan en CI.
- La imagen Docker se construye y supera el smoke test.
- El CLI compilado supera el smoke test contra el contenedor.
- La documentación de instalación permite arrancar desde un checkout limpio.
- Los contratos SQL y OpenAPI están sincronizados con la implementación.

## 11. Extensión v0.2 — Git gestionado y Runs Codex

### Alcance

- Conectar una instalación de GitHub App sin almacenar tokens permanentes.
- Seleccionar repositorios visibles e importarlos como Projects `managed`.
- Mantener un mirror Git persistente y crear un worktree efímero por Run.
- Configurar Agent Profiles Codex mediante referencia a secreto, nunca mediante el valor del secreto.
- Activar automatización por Project con cron, timezone y límite de concurrencia.
- Reclamar Tasks Ready de forma atómica y ejecutar Codex en un contenedor aislado.
- Crear rama, commit, push y draft pull request con credenciales de instalación efímeras.
- Persistir estado, heartbeat, resumen y logs JSONL del Run.
- Tras fallo, devolver la Task a Ready, pausarla y exigir retry manual.

### Decisiones de alcance

- GitHub es el único provider gestionado en v0.2; GitLab y Azure DevOps permanecen como metadatos de Projects locales.
- Codex es el único runtime. La interfaz `AgentProfile` deja un seam explícito para otros runtimes posteriores.
- Un Run exitoso crea exactamente un PR y completa la Task como una única mutación versionada.
- El runner manager puede acceder al socket Docker; el contenedor del agente no puede acceder a Docker, SQLite, secretos permanentes ni la API de AIWS.
- No se implementan webhooks, sincronización de PR, reviewer, QA, prioridades ni ejecución multiagente.

### Aceptación v0.2

- [ ] Una instalación GitHub se registra de forma idempotente y puede revocarse.
- [ ] Un repositorio accesible se importa una sola vez como Project gestionado.
- [ ] Dos workers no pueden reclamar la misma Task ni superar la concurrencia del Project.
- [ ] El agente recibe un worktree aislado y credenciales de vida corta sin tokens en URLs.
- [ ] La API key permanente no entra en el contenedor agente.
- [ ] Un éxito publica draft PR y mueve Implementing → Done incrementando la versión una vez.
- [ ] Un fallo o heartbeat vencido mueve Implementing → Ready, pausa automatización y conserva diagnóstico.
- [ ] Retry manual exige `If-Match` y crea un nuevo attempt.
- [ ] Web y CLI permiten gestionar Connections, Agent Profiles y Runs exclusivamente por API.
- [ ] OpenAPI, migraciones, tests y documentación permanecen sincronizados.

## 12. Extensión v0.3 — Curation gestionada

### Workflow

```text
Draft → Curating → Ready → Implementing → Done
             ↘ Blocked ↗
```

- Draft permite editar título, User Request y Attachments antes del envío.
- Draft → Curating es explícita y congela para siempre User Request.
- Blocked implica al menos una Question abierta; resolver la última devuelve a Curating, nunca a Ready.
- Curating → Ready es una decisión explícita del curator y exige spec no vacía y cero Questions abiertas.
- Los Projects locales usan Curating con un curator externo. Los gestionados requieren un Agent Profile habilitado y crean Runs de curation sin depender del cron ni de `automationEnabled`.

### Runs de curation

- `Run.kind` distingue `curation` de `implementation`; los attempts se numeran por `(taskId, kind)`.
- Curation usa `queued → preparing → running → succeeded|failed`, no crea rama ni PR y termina con `outcome=ready|blocked`.
- El agente recibe repositorio y adjuntos read-only, no recibe credenciales Git ni token AIWS y entrega JSON conforme a un schema.
- El manager aplica título, Curator Spec, Questions, estado, eventos y una única subida de versión en una transacción condicionada por la versión capturada.
- Un fallo técnico mantiene Curating, activa `automationPaused` y exige Retry manual.
- Curation e implementación comparten `maxConcurrency`; `automationEnabled` solo controla implementación.

### Aceptación v0.3

- [ ] User Request se edita en Draft y se rechaza desde Curating en Core, SQL y API.
- [ ] Draft → Ready se rechaza y las transiciones del nuevo workflow están cubiertas.
- [ ] Dos claims concurrentes de curation producen exactamente un Run.
- [ ] Los resultados Ready y Blocked son atómicos e incrementan Task.version una vez.
- [ ] Resolver la última Question devuelve a Curating y habilita un nuevo attempt de curation.
- [ ] Conflictos, heartbeat vencido y JSON inválido no aplican resultados parciales; pausa y Retry funcionan.
- [ ] El agente de curation no puede escribir el repositorio ni recibe secretos de AIWS/Git.
- [ ] Textos, imágenes y PDF son accesibles de forma segura para curation.
- [ ] El workflow local Curating → Ready sigue disponible por CLI.
- [ ] Web, CLI, OpenAPI, SQL, skill y documentación reflejan v0.3.

## 13. Extensión v0.4 — Cambios incrementales por ciclos

- Cada Task nace con Cycle 1 y un Task Message `initial_request` que proyecta `userRequest`.
- En Done, un mensaje crea exactamente un Cycle nuevo y mueve Done → Curating; Done → Ready deja de ser una transición pública.
- En Blocked, un mensaje añade contexto al Cycle vigente y no responde ni cierra Questions.
- Questions, Attachments, Runs, revisiones de spec y snapshots de respuestas pertenecen a un Cycle.
- `curatorSpec`, `prUrl` y `userRequest` continúan como proyecciones compatibles; el historial append-only vive en sus entidades v0.4.
- Una Delivery mantiene rama y PR a través de varios Runs y puede servir a varios Cycles.
- La timeline se pagina hacia atrás y entrega cada página en orden ascendente de renderizado.

### Aceptación v0.4

- [x] Dos mensajes concurrentes desde Done producen un único Cycle ganador.
- [x] Añadir contexto en Blocked conserva abiertas las Questions.
- [x] La última respuesta pendiente devuelve a Curating y las respuestas reabiertas conservan snapshots.
- [x] Questions históricas son de solo lectura y no afectan al Cycle actual.
- [x] Mensaje, Attachments, Cycle, TaskEvent y versión comparten transacción y compensación de blobs.
- [x] La migración crea Cycle 1 y preserva petición, spec, Questions, Attachments, Runs y Delivery previa.
- [x] API, CLI y Web exponen mensaje/timeline; la Web usa timeline central e inspector lateral sin WebSockets.

## 14. Recuperación y observabilidad fiable de Runs

- Task, timeline y Run activo se actualizan por polling hasta estado terminal; los logs NDJSON usan snapshots atómicos cada tres segundos.
- Cancelar devuelve la Task a Ready y el manager detiene el contenedor del Run conservando logs parciales.
- Implementation separa el trabajo del agente del checkpoint `publishing` y renueva credenciales Git después de Codex.
- Retry acepta `auto | full | publish_only`; auto reanuda publishing únicamente ante un checkpoint seguro y enlaza el nuevo attempt mediante `resumeFromRunId`.
- Un workspace ausente, sucio o divergente nunca se publica y requiere Retry completo.
- La reconciliación de heartbeat es periódica y detiene contenedores huérfanos, además de ejecutarse al arranque.
- El header muestra la disponibilidad del runner a partir de su última petición autenticada al Server. Tras 45 segundos sin actividad pasa a offline; antes de la primera señal es unknown.
- Una Task pausada en Curating o Ready puede reanudar manualmente la automatización con su versión vigente. Abrir un Cycle nuevo limpia la pausa heredada de Cycles anteriores.
- La Web no reinicia procesos ni recibe acceso al socket Docker; expone diagnóstico, comprobación manual y acciones de dominio seguras.

## 15. Catálogo vivo de modelos Codex

- Los perfiles nuevos eligen obligatoriamente un `model` y un `reasoningEffort` anunciados por
  `codex app-server model/list`; no existe entrada manual ni un catálogo estático.
- El catálogo depende del modo y referencia de credencial. Si no puede consultarse, Web y API
  impiden crear el perfil y permiten reintentar sin exponer credenciales.
- Los perfiles anteriores conservan `model=null` y `reasoningEffort=null`; la migración no inventa
  defaults y sus Runs mantienen el comportamiento automático anterior.
- Cada Run de un perfil nuevo pasa ambos valores a Codex. El proveedor aún puede rechazar después
  un modelo por cambios de permisos y ese rechazo sigue el flujo normal de Run fallido.

### Aceptación

- [x] API, CLI y Web consumen el mismo catálogo vivo y validan modelo/effort.
- [x] El runner pagina el protocolo, limita recursos/tiempo y revoca capacidades en todo resultado.
- [x] El secreto de control Server → runner es distinto del token del runner y nunca llega al agente.
- [x] Persistencia, OpenAPI, cliente generado, tests y documentación están sincronizados.

## 16. Extensión v0.5 — Notificaciones globales ntfy

- Existe un único canal global configurable desde Web con URL base, topic y token Bearer opcional.
- Cada `status_changed`, explícito o automático, crea como máximo una entrega persistente con
  `eventId` como identidad, dentro de la misma transacción que el TaskEvent.
- La indisponibilidad de ntfy nunca revierte ni bloquea una mutación del workflow.
- Un dispatcher dentro de Server publica lotes limitados, usa timeout, reintento exponencial
  indefinido e idempotencia mediante `sequence_id`.
- Desactivar o cambiar la configuración cancela la generación pendiente. Reactivar no hace
  backfill de eventos anteriores.
- El token se cifra con AES-256-GCM y nunca se devuelve por API, Web, OpenAPI, errores o logs.
- La notificación contiene únicamente nombres e IDs de Project/Task y la transición; el enlace
  abre el detalle de la Task.

### Aceptación v0.5

- [x] Una transición confirmada deja outbox aunque ntfy falle; un rollback no deja entrega.
- [x] Todas las rutas que emiten `status_changed` quedan cubiertas por el decorador transaccional.
- [x] Los settings admiten token preserve/replace/clear y exigen HTTPS cuando existe token.
- [x] API, cliente generado, Web, migración `0007`, configuración y documentación están sincronizados.
- [x] Reintentos, backoff, payload, Bearer, `sequence_id` y cancelación por generación están probados.

## 17. Hito 21 — Perfiles separados para Curation e Implementation

- Cada Project gestionado configura `curationAgentProfileId` e
  `implementationAgentProfileId` de forma independiente; ambos pueden contener el mismo ID.
- Draft → Curating exige un perfil de Curation habilitado.
- `automationEnabled=true` exige un perfil de Implementation habilitado. Curation puede funcionar
  con Implementation desactivada.
- Claim y Retry resuelven el perfil por `Run.kind`. No existe fallback entre campos.
- Un Run conserva `agentProfileId` como snapshot. Cambiar el Project no altera Runs existentes ni
  Runs queued.
- Cron y timezone solo gobiernan Implementation; `maxConcurrency` continúa compartido.

### Aceptación Hito 21

- [x] La migración `0008` copia el perfil v0.5 a ambos campos sin perder Projects ni Runs.
- [x] Core, SQLite y API validan cada campo y devuelven la ruta específica.
- [x] Curation e Implementation crean Runs con sus perfiles respectivos y Retry usa el vigente.
- [x] La Web ofrece dos selectores y permite guardar Curation sin activar Implementation.
- [x] OpenAPI, cliente generado, pruebas y documentación están sincronizados sin alias JSON legacy.

## 18. Hito 22 — Rama de referencia por Delivery y Git seguro

- Cada Project gestionado conserva una `defaultBranch` editable, inicializada con la rama por
  defecto del repositorio GitHub importado.
- Crear una Task gestionada permite seleccionar una rama remota existente. Si se omite, usa la
  `defaultBranch` vigente del Project.
- La selección se copia a `Delivery.baseBranch` al crear la Task y permanece inmutable. Cambiar el
  Project solo afecta a Tasks futuras.
- Curation, Implementation y la Pull Request usan el snapshot de Delivery. Publicar una PR con una
  base distinta se rechaza.
- Web obtiene las ramas mediante la GitHub App y ofrece una selección cerrada en Project y Task.
- El mirror actualiza `refs/remotes/origin/*`; nunca hace fetch sobre ramas locales asociadas a
  worktrees.

### Aceptación Hito 22

- [x] Una Task usa la rama elegida o, por defecto, la configurada en Project.
- [x] Una rama inexistente se rechaza antes de crear la Task o actualizar el Project.
- [x] La migración `0009` conserva Deliveries existentes copiando la rama del Project.
- [x] Una curation puede hacer fetch aunque la rama de Delivery siga checkout en otro worktree.
- [x] API, CLI, Web, OpenAPI, cliente generado, tests y documentación están sincronizados.

## 19. Hito 23 — Distribución independiente y CLI compartido

- AIWS publica imágenes multi-arquitectura separadas para Server, runner-manager y agente Codex.
- El bundle de producción usa exclusivamente imágenes GHCR, conserva los volúmenes y liga la API a
  loopback para situarla detrás de HTTPS.
- El CLI se publica como binario independiente para Linux, macOS y Windows. En Linux se instala
  atómicamente en `/usr/local/bin/aiws` y comparte configuración de sistema mediante el grupo
  explícito `aiws-agents`.
- La configuración persistente admite fichero de usuario, `/etc/aiws/config.json` y
  `AIWS_CONFIG_FILE`; flags y variables conservan precedencia superior. El token nunca se muestra.
- OpenClaw, Hermes, Codex y otros agentes se instalan y actualizan fuera de AIWS. Su único contrato
  es disponer de `aiws` en `PATH`, configuración legible y conectividad HTTP.
- La skill `aiws-workflow` es portable y opcional: exige JSON y versiones esperadas, pero no instala
  binarios ni gestiona credenciales.
- La distribución v0.5.1 usa AGPL-3.0-only. No añade usuarios, scopes, overlays de sandbox ni
  funcionalidades de producto.

### Aceptación Hito 23

- [x] Las tres imágenes publicables declaran `linux/amd64` y `linux/arm64`, tags exacto/minor/major/
  latest, metadatos OCI, SBOM y procedencia.
- [x] El bundle no contiene `build:` y puede arrancar sin Bun ni checkout.
- [x] Los cinco targets del CLI, archivos comprimidos, checksums e instalador verificable forman el
  contrato de release.
- [x] Configuración de usuario/sistema, precedencia, permisos, redacción y actualización atómica
  están implementadas y probadas.
- [x] No cambian rutas HTTP, DTOs ni SQLite; OpenAPI solo cambia versión y licencia.

## 20. Hito 24 — Azure DevOps Services gestionado

- Azure DevOps Services cloud se conecta mediante Microsoft Entra OAuth delegado multitenant
  `organizations`, Authorization Code con PKCE, state aleatorio de un solo uso, `.default` y
  `offline_access`.
- Se admiten únicamente cuentas Entra work/school. Azure DevOps Server, cuentas Microsoft
  personales, PAT y service principals quedan fuera de alcance.
- `Connection` es una unión discriminada GitHub/Azure DevOps. Azure conserva organización y
  refresh token cifrado; ningún access token se persiste.
- La selección de organización ocurre tras el callback a partir de un snapshot cifrado de 15
  minutos. Completar o reautorizar una organización es idempotente.
- Repositorios, ramas, importación, curation, implementation, push y draft pull requests usan una
  seam común resuelta por `Connection.provider`.
- Azure REST 7.1 usa UUID remoto, `projectName/repositoryName`, normaliza `refs/heads/*`, expone
  `protected=null` y limita la descripción de PR a 4.000 caracteres preservando el Task ID.
- GitHub mantiene su comportamiento y usa credenciales Git basic; Azure usa bearer mediante
  `http.extraHeader` sin secretos en URL, argumentos, refs, errores o logs.

### Aceptación Hito 24

- [x] Migración `0010` conserva Connections GitHub y aplica unicidad Azure por organización.
- [x] OAuth prueba PKCE/state, expiración, selección, cifrado, refresh rotado e `invalid_grant`.
- [x] GitHub y Azure cumplen el mismo contrato operativo de repositorios, ramas, Git y PR.
- [x] API, CLI, Web, OpenAPI, cliente generado y versión pública están sincronizados en v0.6.0.
- [x] Todos los gates pasan sin depender de la red real de Microsoft o Azure DevOps.

## 21. Hito 25 — Project Readiness

- Un operador puede comprobar un Project gestionado sin crear Task, Cycle, Delivery o Run.
- El informe es efímero, ordenado y seguro; no se persiste como configuración ni historial.
- El modo estándar valida Project, Connection, repositorio, Base Branch, credenciales Git
  efímeras, Agent Profiles y estado del runner.
- El modo profundo añade imagen, workspace, red, contenedor, toolchain y autenticación/modelo.
- El probe profundo vive únicamente en runner-manager tras una operación interna acotada.
- GitHub y Azure DevOps comparten el mismo contrato de comprobación.

### Aceptación Hito 25

- [x] API, CLI y Web muestran el mismo informe `pass|warning|fail|skipped`.
- [x] `aiws project doctor` usa modo estándar y `--deep` solicita explícitamente el probe profundo.
- [x] El informe nunca contiene secretos, rutas físicas ni IDs de contenedor.
- [x] Timeout, error y cancelación limpian todos los recursos efímeros.
- [x] Existen playbooks protegidos para validar Connections reales de GitHub y Azure.
- [x] OpenAPI, cliente generado, tests y documentación están sincronizados sin migración SQL.

El smoke local, tests, contrato, build y E2E pasan. El smoke Docker y los providers reales requieren
el gate operativo protegido y no se contabilizan como ejecutados en este entorno.

## 22. Hito 26 — Aprobación Ready configurable

- Cada Project define `readyPolicy=curator_decides|manual_approval_required`; el valor por defecto
  conserva el comportamiento existente.
- Cada Run de Curation captura la política efectiva al crearse.
- Con aprobación manual, un resultado de curation correcto guarda título/spec y revisión, termina
  con `outcome=approval_required`, mantiene la Task en Curating y activa
  `readyApprovalPending=true`.
- Una Task pendiente no puede recibir otro claim de Curation. La transición explícita
  Curating → Ready por Web o CLI consume la aprobación y sube la versión exactamente una vez.
- Questions nuevas/reabiertas, contexto que invalida el resultado preparado y un Cycle nuevo
  limpian el flag. Cambiar la política del Project no reinterpreta Tasks ni Runs existentes.

### Aceptación Hito 26

- [x] Migración forward-only y backfill conservador.
- [x] Snapshot de política y resultado obsoleto/concurrente probados.
- [x] Mutación, revisión y eventos se confirman en una transacción con una subida de versión.
- [x] API, CLI, Web, SQL, OpenAPI, cliente y timeline sincronizados.

## 23. Hito 27 — Verification Contract por Project

- El contrato es opcional, versionado, append-only y propiedad del Project.
- Cada revisión ordena hasta 20 comandos con `name`, `executable`, `args`, `required` y
  `timeoutSeconds`; no admite shell, entorno personalizado ni working directory alternativo.
- Reemplazar o desactivar exige la revisión esperada. La desactivación crea historia y no borra
  revisiones.
- Cada Run de Implementation captura la revisión activa al claim; cambiar después el Project no
  reinterpreta el Run.
- La ausencia de contrato queda representada como revisión nula y permite continuar.

### Aceptación Hito 27

- [x] Crear, reemplazar, desactivar y resolver conflictos de revisión.
- [x] Rechazar argv, nombres duplicados y límites inválidos.
- [x] Conservar revisiones históricas y el snapshot de Runs queued.
- [x] API, CLI, Web, SQL, OpenAPI, cliente y documentación sincronizados.

## 24. Hito 28 — Verification Results y Run provenance

- El runner ejecuta el contrato capturado sobre el commit local antes de publicar, mediante argv y
  sin shell.
- Cada comando produce evidencia inmutable y acotada. Un fallo required termina
  `verification_failed`; uno opcional permite publicar con warning.
- El waiver exige versión de Task y motivo, crea un nuevo attempt enlazado y reutiliza únicamente un
  workspace limpio cuyo `HEAD` coincide con el Run fallido.
- Cada Run conserva un registro immutable de provenance con configuración efectiva, versiones,
  hashes y referencias seguras usadas para producir la entrega.

### Aceptación Hito 28

- [x] Pass/fail/timeout/spawn/cancel, truncado y redacción.
- [x] Fallo required pausa y devuelve Ready; opcional permite publicar.
- [x] Waiver valida workspace, commit, versión y enlace entre attempts.
- [x] Provenance no contiene secretos ni rutas físicas de Attachments.
- [x] API, CLI, Web, SQL, OpenAPI, cliente y documentación sincronizados.

## 25. Hito 29 — Necesita atención

- La bandeja es una proyección global read-only, paginada y determinista.
- Deduplica síntomas relacionados bajo una causa primaria y excluye Tasks y Projects archivados.
- Cada item explica qué requiere intervención, por qué y cuál es la siguiente acción existente.
- La indisponibilidad del runner es un único item global.
- No introduce prioridad, asignación, acknowledgement ni estado nuevo de Task.

### Aceptación Hito 29

- [x] Razones, precedencia, orden y paginación están probados.
- [x] La desaparición de la causa elimina el item sin mutación adicional.
- [x] API, CLI, Web, OpenAPI, cliente y documentación están sincronizados.

## 26. Hito 30 — Delivery Projection

- Delivery conserva la última observación externa de PR y checks, separada de Task.status.
- El refresh es explícito y manual; GitHub y Azure implementan la misma seam.
- Un error seguro conserva la última observación y marca su staleness.
- No hay polling, webhook, merge ni transición automática de Task.

### Aceptación Hito 30

- [x] PR draft/open/closed/merged y checks pending/passed/failed/unknown.
- [x] Paridad GitHub/Azure, permisos, reautorización, rate limit y error stale.
- [x] Task Done e identidad de Delivery permanecen inmutables durante refresh.
- [x] API, CLI, Web, SQL, OpenAPI, cliente y documentación sincronizados.

## 27. Hito 31 — Trazabilidad de Spec y métricas

- Task Detail compara revisiones inmutables de Spec sin inventar causalidad.
- Las métricas se derivan localmente por Project y rango UTC desde las fuentes existentes.
- La salida incluye cobertura y staleness de Delivery.
- No se añade dashboard, telemetría externa, coste/tokens, presupuesto ni límite automático.

### Aceptación Hito 31

- [x] Rangos vacíos/parciales, Projects archivados, límites UTC, retries y Cycles.
- [x] Métricas deterministas sin mutar las fuentes.
- [x] Diff visible antes de Ready junto a Questions y aprobación explícita.
- [x] API, CLI, OpenAPI, cliente y documentación sincronizados.
