# 04 — Contrato API

## 1. Convenciones

- Base path: `/api/v1`.
- OpenAPI: 3.1.
- JSON: camelCase.
- Content type normal: `application/json`.
- Fechas: UTC RFC 3339.
- IDs: strings completos.
- Toda respuesta incluye `X-Request-Id`.
- Task aggregate responses incluyen `ETag: "<version>"`.

## 2. Autenticación

La API acepta uno de estos mecanismos:

### Web

Cookie de sesión `aiws_session`.

Las mutaciones autenticadas por cookie requieren un `Origin` exactamente igual al origin de `AIWS_PUBLIC_URL`.

### CLI/agentes

```http
Authorization: Bearer <token>
```

No se aceptan tokens en query string.

### Rutas públicas

Únicamente:

```http
GET /health
```

## 3. Actor

- Cookie válida → `actorType=web`.
- Bearer válido → `actorType=cli`.
- Automatismos internos → `actorType=system`.

## 4. Errores

Envelope:

```json
{
  "error": {
    "code": "version_conflict",
    "message": "Task version does not match.",
    "details": {
      "expectedVersion": 4,
      "currentVersion": 5
    },
    "requestId": "req_01K0..."
  }
}
```

### Códigos

| HTTP | Code | Uso |
| ---: | --- | --- |
| 400 | `bad_request` | JSON/multipart mal formado |
| 401 | `unauthorized` | Credenciales ausentes/incorrectas |
| 403 | `forbidden` | Origin o acción no permitida |
| 404 | `not_found` | Recurso inexistente/no visible |
| 409 | `version_conflict` | expectedVersion incorrecta |
| 409 | `invalid_transition` | transición/precondición de estado |
| 409 | `project_has_active_tasks` | archivado de Project |
| 413 | `attachment_too_large` | upload supera límite |
| 415 | `unsupported_media_type` | fichero no admitido |
| 422 | `validation_error` | input semánticamente inválido |
| 422 | `attachment_limit_reached` | máximo por Task |
| 500 | `internal_error` | error inesperado |
| 500 | `storage_error` | fallo de almacenamiento |

Los detalles de validación:

```json
{
  "fields": [
    {
      "path": "options[0].label",
      "message": "Required"
    }
  ]
}
```

## 5. Concurrencia

Todas las mutaciones del agregado Task requieren:

```http
If-Match: "7"
```

Se acepta con o sin comillas, pero la documentación y clientes generan comillas.

Si falta:

```http
428 Precondition Required
```

```json
{
  "error": {
    "code": "expected_version_required",
    "message": "If-Match is required.",
    "requestId": "req_..."
  }
}
```

Si no coincide:

```http
409 Conflict
```

La respuesta exitosa devuelve la nueva versión en body y ETag.

## 6. Pagination

Listados:

```json
{
  "items": [],
  "nextCursor": null
}
```

Reglas:

- `limit`: default 50, mínimo 1, máximo 200.
- `cursor`: opaco.
- Keyset pagination.
- Un cursor solo es válido con los mismos filtros, sort y order.
- Cursor inválido → 422 `validation_error`.

## 7. Health y auth

### GET /health

No toca datos de usuario.

200:

```json
{
  "status": "ok",
  "version": "0.6.0"
}
```

Si SQLite no está disponible, 503:

```json
{
  "status": "unhealthy",
  "version": "0.6.0"
}
```

### POST /auth/login

```json
{
  "username": "admin",
  "password": "..."
}
```

- 204 y cookie al acertar.
- 401 al fallar.
- Respuesta idéntica para usuario/password incorrectos.

### POST /auth/logout

- 204.
- Invalida cookie.

### GET /auth/session

```json
{
  "authenticated": true,
  "username": "admin"
}
```

## 8. Projects

### GET /projects

Query:

- `archived`: `false` default.
- `gitProvider`.
- `accountScope`.
- `limit`.
- `cursor`.

Orden: `updatedAt desc`, `id desc`.

### POST /projects

```json
{
  "name": "UpRetina Webinars",
  "description": "Landing y gestión",
  "repositoryPath": "/srv/repos/work/upretina-webinars",
  "gitProvider": "azure_devops",
  "accountScope": "work"
}
```

201 con Project.

### GET /projects/{projectId}

200 con Project o 404.

### PATCH /projects/{projectId}

Campos opcionales:

```json
{
  "name": "Nuevo nombre",
  "description": "...",
  "repositoryPath": "/srv/repos/work/new",
  "gitProvider": "github",
  "accountScope": "work"
}
```

Debe incluir al menos uno.

### POST /projects/{projectId}/archive

- 200 con Project.
- 409 si existen Tasks activas.

### POST /projects/{projectId}/unarchive

- 200 con Project.

Operaciones idempotentes de archive/unarchive: repetirlas devuelve 200 sin cambios.

## 9. Tasks

### GET /tasks

Filtros:

- `projectId`.
- `status`, repetible.
- `accountScope`.
- `gitProvider`.
- `archived=false`.
- `sort=updatedAt|createdAt`.
- `order=asc|desc`.
- `limit`.
- `cursor`.

Defaults:

```text
archived=false
sort=updatedAt
order=desc
limit=50
```

Devuelve `TaskSummary`, no spec/questions/attachments.

### POST /tasks

```json
{
  "projectId": "prj_...",
  "title": null,
  "userRequest": "Al exportar asistentes desaparece el teléfono."
}
```

- `title` puede omitirse o ser null.
- 201 con Task aggregate.
- Task version inicial 1.
- Emite `task_created`.

Los adjuntos se suben después mediante el endpoint correspondiente.

### GET /tasks/{taskId}

Devuelve el agregado completo:

```json
{
  "id": "tsk_...",
  "version": 4,
  "title": "...",
  "userRequest": "...",
  "curatorSpec": "# Summary\n...",
  "status": "blocked",
  "prUrl": null,
  "project": {},
  "questions": [],
  "attachments": [],
  "createdAt": "...",
  "updatedAt": "...",
  "archivedAt": null
}
```

Questions: `createdAt asc, id asc`.  
Attachments: `createdAt asc, id asc`.

### PATCH /tasks/{taskId}

Requiere If-Match.

```json
{
  "title": "Exportación sin teléfono",
  "curatorSpec": "# Summary\n...",
  "prUrl": "https://github.com/org/repo/pull/42"
}
```

Semántica:

- Campos ausentes no cambian.
- `prUrl: null` elimina la URL.
- `userRequest` puede enviarse, pero solo se acepta mientras la Task siga Draft.
- Al menos un campo.
- Spec vacía rechazada si status es Ready, Implementing o Done.

### POST /tasks/{taskId}/transition

Requiere If-Match.

```json
{
  "from": "ready",
  "to": "implementing",
  "reason": "Comienza la implementación"
}
```

- `from` obligatorio.
- `reason` opcional, máximo 2 000 caracteres.
- Solo transiciones explícitas permitidas.

### POST /tasks/{taskId}/archive

Requiere If-Match. Body opcional:

```json
{
  "reason": "Duplicada"
}
```

### POST /tasks/{taskId}/unarchive

Requiere If-Match.

## 10. Questions

### GET /tasks/{taskId}/questions

Devuelve todas, no paginado en v0.1.

### POST /tasks/{taskId}/questions

Requiere If-Match.

```json
{
  "text": "¿En qué entorno ocurre?",
  "type": "single_choice",
  "options": [
    { "label": "Producción" },
    { "label": "Pruebas" },
    { "label": "Ambos" }
  ],
  "allowOther": true
}
```

Los IDs y posiciones de opciones los asigna Server.

Respuesta: agregado Task actualizado.

### GET /tasks/{taskId}/questions/{questionId}

Devuelve Question.

### PATCH /tasks/{taskId}/questions/{questionId}

Requiere If-Match. Reemplaza la definición completa editable:

```json
{
  "text": "¿En qué entorno ocurre?",
  "type": "single_choice",
  "options": [
    { "label": "Producción" },
    { "label": "Pruebas" }
  ],
  "allowOther": true
}
```

Genera nuevos option IDs. Solo Open y nunca respondida.

### POST /tasks/{taskId}/questions/{questionId}/answer

Requiere If-Match.

```json
{
  "selectedOptionIds": ["opt_..."],
  "answerText": "Comentario opcional"
}
```

Para text:

```json
{
  "selectedOptionIds": [],
  "answerText": "Ocurre solo en producción."
}
```

Respuesta: agregado actualizado.

### POST /tasks/{taskId}/questions/{questionId}/dismiss

Requiere If-Match. Body opcional:

```json
{
  "reason": "Ya no aplica"
}
```

### POST /tasks/{taskId}/questions/{questionId}/reopen

Requiere If-Match. Body opcional:

```json
{
  "reason": "La respuesta necesita revisión"
}
```

## 11. Attachments

### GET /tasks/{taskId}/attachments

Lista metadata.

### POST /tasks/{taskId}/attachments

Requiere If-Match.

`multipart/form-data` con un único campo:

```text
file
```

No se aceptan varios ficheros por request. El cliente repite la operación para cada fichero, usando la nueva versión devuelta.

201 con:

```json
{
  "attachment": {},
  "taskVersion": 5
}
```

### GET /tasks/{taskId}/attachments/{attachmentId}

Metadata.

### GET /tasks/{taskId}/attachments/{attachmentId}/content

- Stream autenticado.
- `Content-Type` validado.
- `Content-Length`.
- `Content-Disposition: attachment; filename*=UTF-8''...`.
- `X-Content-Type-Options: nosniff`.
- ETag basado en SHA-256.

No requiere If-Match.

### DELETE /tasks/{taskId}/attachments/{attachmentId}

Requiere If-Match.

200:

```json
{
  "taskVersion": 6
}
```

## 12. Activity

### GET /tasks/{taskId}/activity

Query:

- `limit=50`.
- `cursor`.

Orden fijo `createdAt desc, id desc`.

```json
{
  "items": [
    {
      "id": "evt_...",
      "type": "status_changed",
      "actorType": "cli",
      "metadata": {
        "taskVersion": 4,
        "from": "ready",
        "to": "implementing",
        "automatic": false,
        "reason": "Comienza la implementación"
      },
      "createdAt": "..."
    }
  ],
  "nextCursor": null
}
```

## 13. OpenAPI

- Desarrollo: generado desde Hono/Zod.
- CI: normalizar y comparar con `docs/contracts/openapi.yaml`.
- Endpoint autenticado: `GET /api/v1/openapi.json`.
- Un cambio intencional requiere actualizar snapshot, cliente generado, docs y tests.

## 14. Addendum v0.3 — Curation gestionada

- `TaskStatus` añade `curating`; la transición pública válida es Draft → Curating → Ready.
- `GET /tasks/{taskId}/runs` acepta `kind=curation|implementation`.
- `Run` añade `kind`, `outcome` y branch nullable para curation.
- `POST /runs/{runId}/curation-result` es system-only y acepta una unión discriminada Ready/Blocked.
- El resultado se rechaza con 409 si la versión capturada ya no coincide y no deja cambios parciales.

## 15. Addendum v0.4 — mensajes y timeline

- `POST /tasks/{taskId}/messages` recibe multipart `text` y cero o más `file`, exige `If-Match` y acepta únicamente Done o Blocked.
- En Done crea Cycle y cambia a Curating; en Blocked añade contexto sin resolver Questions.
- `GET /tasks/{taskId}/timeline` pagina hacia atrás y devuelve cada página ascendente.
- El agregado expone `currentCycle` y `currentDelivery`; Question, Attachment y Run incluyen `cycleId`, y Attachment puede incluir `messageId`.

## 16. Recuperación y observabilidad de Runs

- `Run` expone `executionStage=agent|publishing` y `resumeFromRunId` nullable.
- `POST /runs/{runId}/retry` acepta body opcional `{ "mode": "auto|full|publish_only" }`; omitirlo conserva `auto`.
- `PUT /runs/{runId}/logs` reemplaza atómicamente el snapshot NDJSON de hasta 5 MB y puede repetirse durante el Run.
- Cancelar conserva `If-Match`; la Task vuelve a Ready inmediatamente y el runner detiene el contenedor al observar el estado terminal.
- La transición pública Done → Ready se rechaza.

## 17. Catálogo de modelos

`POST /agent-profiles/model-catalog` recibe `{ authMode, credentialReference }` y devuelve
`{ models: [{ id, name, description, isDefault, defaultReasoningEffort,
supportedReasoningEfforts }] }`. Un runner, credencial o catálogo no disponible devuelve 503
`catalog_unavailable`. La respuesta nunca contiene la credencial.

`POST /agent-profiles` requiere además `model` y `reasoningEffort`. Un modelo desconocido o un
effort no soportado devuelve 422 `validation_error`.

## 18. Estado y reanudación de automatización

- `GET /system/runner` devuelve `{ status: "unknown|online|offline", lastSeenAt,
  offlineAfterSeconds }`. Solo refleja actividad system autenticada y nunca incluye secretos.
- `POST /tasks/{taskId}/automation/resume` exige `If-Match`, acepta únicamente una Task activa,
  pausada y en Curating o Ready, limpia `automationPaused` e incrementa la versión una vez.
- Una versión obsoleta devuelve 409; una Task no pausada, con Run activo o en otro estado se
  rechaza sin mutación.

## 19. Notificaciones globales

- `GET /notification-settings` devuelve `{ enabled, baseUrl, topic,
  accessTokenConfigured, updatedAt }`.
- `PATCH /notification-settings` acepta uno o más campos. `accessToken` ausente conserva, `null`
  elimina y un string no vacío reemplaza. El token nunca se devuelve.
- `POST /notification-settings/test` entrega de forma síncrona: 204 en éxito y 503
  `notification_unavailable` en fallo.

Las tres rutas requieren autenticación. Las mutaciones por cookie conservan la comprobación de
Origin y Bearer no la requiere.

## 20. Perfiles separados del Project

`Project` y `UpdateProjectRequest` exponen `curationAgentProfileId` e
`implementationAgentProfileId`, ambos `AgentProfileId | null`. `agentProfileId` deja de ser una
propiedad válida del Project y no existe alias legacy.

Draft → Curating señala `curationAgentProfileId` cuando falta o está deshabilitado. Activar
`automationEnabled` señala `implementationAgentProfileId`. `Run.agentProfileId` y
`RunAssignment.agentProfile` conservan su contrato como snapshot del perfil elegido por kind.

## 21. Ramas de referencia

- `GET /projects/{projectId}/branches` devuelve `{ name, sha, protected }[]` desde el provider
  gestionado; Azure puede devolver `protected=null`.
- `PATCH /projects/{projectId}` acepta `defaultBranch`; debe existir remotamente.
- `POST /tasks` acepta `baseBranch` opcional para Projects gestionados y rechaza el campo en
  Projects locales.
- `Delivery` expone `baseBranch`. Es un snapshot; no existe endpoint para editarlo.
- Publishing rechaza una base de PR distinta de `Delivery.baseBranch`.

## 22. Azure DevOps Services

- `GET /connections/azure-devops/authorize` inicia Entra OAuth con PKCE.
- El callback público `GET /connections/azure-devops/callback` consume state/código una sola vez y
  redirige a `/automation?azureAuthorizationId=...`.
- `GET /connections/azure-devops/authorizations/{authorizationId}/organizations` devuelve el
  snapshot temporal y `POST .../complete` selecciona exactamente una organización.
- `GET /connections/{connectionId}/reauthorize` devuelve la URL correspondiente al provider.
- `Connection` discrimina `github` con `installationId` y `azure_devops` con
  `organizationId/organizationName`; el estado incluye `reauthorization_required`.
- Repositorios, importación, ramas, credenciales system-only y pull requests mantienen endpoints
  provider-neutral. `RemoteBranch.protected` admite null.
