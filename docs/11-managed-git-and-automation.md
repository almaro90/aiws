# Git gestionado, curation y automatización Codex — v0.6

## Flujo

1. El administrador conecta GitHub o Azure DevOps desde **Automation**.
2. AIWS valida el callback del provider y guarda solo la identidad de la Connection y las
   credenciales cifradas estrictamente necesarias.
3. El administrador elige un repositorio y AIWS crea un Project `managed` cuya ruta apunta a un mirror persistente bajo `/repositories`.
4. Un Agent Profile referencia el nombre de una variable de entorno o el volumen de sesión ChatGPT; SQLite no contiene secretos.
5. El Project selecciona perfiles independientes de Curation e Implementation y configura
   activación de Implementation, cron, timezone y concurrencia compartida.
6. El runner prioriza Runs queued y después reclama una Task Curating o Ready respetando la concurrencia compartida.
7. El manager crea un worktree bajo el volumen `aiws-workspaces` y arranca un contenedor agente por Run.
8. Codex delega el sandbox en el contenedor agente ya restringido (`--dangerously-bypass-approvals-and-sandbox` evita un segundo sandbox `bwrap`). Después, el manager hace commit, push y crea un draft PR con credenciales efímeras del provider.
9. Curation aplica salida Ready/Blocked sin rama. Implementation publica PR y termina Done. Un fallo mantiene la fase de negocio correspondiente y activa `automationPaused=true` hasta Retry manual.

## Fronteras de seguridad

- `server`: posee SQLite, logs y credenciales permanentes cifradas/de configuración; solo entrega
  credenciales Git de corta vida al actor `system`.
- `runner-manager`: posee el socket Docker, prepara Git y recibe una capacidad aleatoria por Run para el proxy OpenAI.
- `agent`: solo monta el subdirectorio de su Run dentro del volumen de workspaces, root filesystem read-only, sin capabilities, con límites de CPU/memoria/PIDs y sin socket Docker.
- La API key real permanece en el manager. El agente recibe una capacidad revocable y usa el proxy interno como base URL.
- GitHub usa `GIT_ASKPASS` y Azure un header bearer por entorno; los secretos no aparecen en clone
  URLs ni argumentos persistidos.
- Los logs se redactan, limitan a 5 MB, se guardan bajo `/data/run-logs` y se sirven solo por endpoint autenticado.
- Los callbacks son públicos porque las cookies `SameSite=Strict` no cruzan el redirect; validan un
  `state` de un solo uso y con expiración emitido desde una sesión autenticada.

## Recuperación

El runner envía heartbeat cada 30 segundos y reconcilia periódicamente Runs activos sin heartbeat durante cinco minutos, además de hacerlo al arrancar. Cada Run obsoleto falla de forma terminal, devuelve la Task a Ready, pausa su automatización y detiene su contenedor huérfano. No se reintenta automáticamente.

## Autenticación Codex

Antes de crear un perfil, Web o CLI consulta `codex app-server model/list` dentro de un contenedor
efímero con la misma frontera de autenticación. El Server solo transmite modo y referencia al
runner-manager mediante el canal de control interno; no resuelve ni devuelve secretos.

### API key

Crear un perfil con `authMode=api_key` y `credentialReference=OPENAI_API_KEY`; definir esa variable solo en `runner-manager`. El valor nunca cruza la frontera del manager.

### Sesión ChatGPT

Inicializar una vez el volumen dedicado desde una terminal confiable:

```bash
docker run --rm --user root \
  -v aiws-codex-auth:/codex-home \
  aiws-agent:0.6.0 chown -R 1000:1000 /codex-home

docker run --rm -it \
  -v aiws-codex-auth:/codex-home \
  -e CODEX_HOME=/codex-home \
  aiws-agent:0.6.0 codex login --device-auth
```

Crear después un perfil `chatgpt_session`. Cada despliegue debe usar un volumen distinto por frontera de confianza; no compartirlo entre organizaciones.

## Operación

- `AIWS_RUNNER_TOKEN_HASH` autentica al runner contra la API; `AIWS_RUNNER_TOKEN` contiene el valor sin hash únicamente en el manager.
- `AIWS_RUNNER_RECONCILE_MS` controla la reconciliación periódica y usa 60000 ms por defecto.
- `AIWS_GITHUB_APP_ID`, `AIWS_GITHUB_APP_SLUG` y `AIWS_GITHUB_PRIVATE_KEY_BASE64` deben configurarse juntos.
- La callback de GitHub App es `${AIWS_PUBLIC_URL}/api/v1/connections/github/callback`.
- `AIWS_AZURE_DEVOPS_CLIENT_ID`, `AIWS_AZURE_DEVOPS_CLIENT_SECRET` y
  `AIWS_CONNECTION_ENCRYPTION_KEY` deben configurarse juntos; su callback es
  `${AIWS_PUBLIC_URL}/api/v1/connections/azure-devops/callback`.
- `docker compose --profile build build` construye server, runner manager e imagen agente; `docker compose up -d` arranca los servicios persistentes.
- El estado observable está disponible en Web, `aiws run ...` y los endpoints `/tasks/{taskId}/runs` y `/runs/{runId}/logs`.

## Límites conocidos

- GitHub admite GitHub.com, no GitHub Enterprise Server. Azure admite Azure DevOps Services en
  `dev.azure.com`, no Azure DevOps Server. GitLab no es un provider gestionado.
- Cron admite cinco campos y la semántica básica documentada por Core; no macros como `@daily`.
- No se sincroniza el estado posterior del pull request.

## Curation gestionada

Entrar en Curating siempre habilita curation en un Project managed, aunque
`automationEnabled=false` o el cron no coincida. Requiere `curationAgentProfileId` habilitado.
Implementation usa `implementationAgentProfileId`; ambos campos pueden apuntar al mismo perfil,
pero no existe fallback implícito. El agente inspecciona `AGENTS.md`, codebase, petición, spec
previa, respuestas y Attachments en mounts read-only y devuelve exclusivamente JSON validado. El
manager aplica la salida con la versión que capturó el Run; un conflicto descarta íntegramente
título, spec y Questions.

Cada Run captura el perfil resuelto según su kind. Editar el Project solo afecta claims y retries
posteriores; los Runs ya creados, incluidos los queued, continúan con su `agentProfileId`.

## Deliveries v0.4

La rama pertenece a Delivery, no al Run. Curation usa en detached el mismo ref que implementation y recibe Messages y Spec Revisions de todos los Cycles. Los retries reutilizan rama. Si existe PR, publishing actualiza título/cuerpo sin enviar `draft`, conservando su estado. La resolución remota fallida mantiene el Run failed, pausa automatización y exige Retry manual.

La pausa bloquea nuevos claims del Cycle vigente. Puede limpiarse mediante Retry del Run fallido o
mediante Resume manual versionado cuando la Task está Curating o Ready y no hay Run activo. Abrir
un Cycle desde Done limpia siempre cualquier pausa anterior. Server considera el runner online
cuando ha recibido actividad system autenticada durante los últimos 45 segundos; Web y CLI muestran
esa señal, pero no controlan Docker.

Codex y publishing son checkpoints separados. El manager publica snapshots de logs cada tres segundos y consulta cancelación con la misma frecuencia. Tras terminar Codex, persiste `executionStage=publishing`, solicita una credencial Git nueva y solo entonces hace commit/push/PR. Retry `auto` usa `publish_only` cuando el checkpoint es seguro; verifica que el workspace existe, está limpio, deriva del `baseSha` y contiene un commit distinto. Cualquier divergencia falla de forma segura y requiere `full`.

## Rama de referencia

Al importar, `Project.defaultBranch` toma el valor de GitHub y puede cambiarse desde el listado
remoto. Cada Task gestionada crea una Delivery y copia la rama elegida. Esa base no sigue cambios
posteriores del Project.

El mirror trae ramas a `refs/remotes/origin/*` usando un refmap explícito y con
`remote.origin.mirror=false`. De este modo el fetch puede avanzar aunque `refs/heads/<delivery>`
esté checkout en un worktree de otro Run. Curation usa primero la rama remota de Delivery si ya
existe y, si no, su Base Branch; Implementation crea o reanuda la rama de trabajo desde la misma
base. La PR siempre usa `Delivery.baseBranch`.

## Azure DevOps Services

Azure DevOps es un provider gestionado con la misma ruta operativa que GitHub. La autorización
inicial usa Microsoft Entra delegado; tras el callback el administrador selecciona una organización
work/school. Cada organización produce una Connection y puede reautorizarse sin cambiar su ID.

Repositorios y refs se consultan con REST 7.1. AIWS conserva el UUID remoto, muestra
`Project/Repository`, normaliza `refs/heads/` y no inventa protección de rama. El runner usa bearer
en `http.extraHeader`; publishing crea o actualiza un draft PR activo y conserva el footer Task al
limitar la descripción.

Límites: solo `dev.azure.com`; sin Azure DevOps Server, MSA, PAT, service principals, webhooks,
Boards, Pipelines, reviewers, merge ni sincronización posterior del PR.
