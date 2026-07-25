# 07 — Seguridad, almacenamiento y configuración

## 1. Modelo de despliegue

- Una única instancia.
- Un único administrador Web.
- Uno o varios agentes pueden compartir el token CLI en v0.1.
- Servidor y agentes trabajan sobre la misma máquina o mounts con rutas idénticas.
- Se recomienda exponer mediante Tailscale, Cloudflare Tunnel o reverse proxy HTTPS.

## 2. Variables de entorno

### Requeridas en producción

| Variable | Formato |
| --- | --- |
| `AIWS_PUBLIC_URL` | URL HTTPS sin slash final |
| `AIWS_ALLOWED_REPO_ROOTS` | Array JSON de rutas absolutas |
| `AIWS_ADMIN_USERNAME` | 1–120 chars |
| `AIWS_ADMIN_PASSWORD_HASH` | Argon2id PHC string |
| `AIWS_SESSION_SECRET` | Base64 de al menos 32 bytes aleatorios |
| `AIWS_API_TOKEN_HASH` | `sha256:<64 hex>` |
| `AIWS_RUNNER_CONTROL_SECRET` | string aleatorio de al menos 32 caracteres |
| `AIWS_NOTIFICATION_ENCRYPTION_KEY` | Base64 de 32 bytes; requerida al guardar token ntfy |

Ejemplo:

```env
AIWS_PUBLIC_URL=https://aiws.example.com
AIWS_ALLOWED_REPO_ROOTS=["/srv/repos/personal","/srv/repos/work"]
AIWS_ADMIN_USERNAME=admin
AIWS_ADMIN_PASSWORD_HASH=$argon2id$v=19$...
AIWS_SESSION_SECRET=...
AIWS_API_TOKEN_HASH=sha256:...
```

### Con defaults

| Variable | Default | Validación |
| --- | --- | --- |
| `AIWS_ENV` | `production` | `development|test|production` |
| `AIWS_HOST` | `0.0.0.0` | IP/hostname |
| `AIWS_PORT` | `3000` | 1–65535 |
| `AIWS_DATA_DIR` | `/data` | ruta absoluta |
| `AIWS_LOG_LEVEL` | `info` | `debug|info|warn|error` |
| `AIWS_MAX_ATTACHMENTS_PER_TASK` | `10` | 1–10 |
| `AIWS_MAX_ATTACHMENT_BYTES` | `26214400` | 1–26214400 |
| `AIWS_HTTP_BODY_LIMIT_BYTES` | `1048576` | >= 1 MiB |
| `AIWS_LOGIN_ATTEMPTS` | `5` | 1–100 |
| `AIWS_LOGIN_WINDOW_SECONDS` | `900` | >= 60 |
| `AIWS_SESSION_TTL_SECONDS` | `43200` | 900–604800 |
| `AIWS_ORPHAN_TTL_SECONDS` | `86400` | >= 3600 |
| `AIWS_GRACEFUL_SHUTDOWN_MS` | `10000` | 1000–60000 |
| `AIWS_TRUST_PROXY` | `false` | boolean |

El límite SQL absoluto por Attachment es 25 MiB. La configuración puede reducirlo, no aumentarlo en v0.1.

Config inválida impide arrancar y muestra únicamente el nombre/razón, nunca el valor secreto.

## 3. Generación de secretos

El binario Server incluye comandos offline:

```bash
aiws-server hash-password
aiws-server generate-session-secret
aiws-server generate-api-token
aiws-server generate-runner-token
aiws-server generate-runner-control-secret
aiws-server generate-notification-encryption-key
aiws-server generate-connection-encryption-key
```

Reglas:

- `hash-password` lee sin echo desde TTY o stdin y devuelve Argon2id.
- `generate-session-secret` devuelve base64.
- `generate-api-token` muestra una única vez el token y su hash SHA-256.
- `generate-runner-token` muestra el token system y su hash SHA-256.
- `generate-runner-control-secret` genera el secreto independiente del canal Server → manager.
- No escriben ficheros automáticamente.
- `generate-notification-encryption-key` devuelve una clave AES-256 en Base64.
- `generate-connection-encryption-key` devuelve la clave AES-256 usada por OAuth gestionado.

## 4. Password y login

- Password verificada con Argon2id.
- Mensaje y tiempo comparables para username inexistente/password incorrecta.
- Rate limit en memoria por IP y global.
- Después del límite: 429 con `Retry-After`.
- No se registra username/password en logs de fallo.

El rate limit se reinicia al reiniciar; es aceptable en v0.1.

## 5. Sesión Web

Cookie:

```text
aiws_session
```

Atributos producción:

- `HttpOnly`.
- `Secure`.
- `SameSite=Strict`.
- `Path=/`.
- `Max-Age=AIWS_SESSION_TTL_SECONDS`.

La sesión es un payload mínimo autenticado con HMAC-SHA-256:

```json
{
  "sub": "admin",
  "iat": 0,
  "exp": 0,
  "nonce": "..."
}
```

No contiene password, token API ni datos de Tasks.

Logout borra la cookie. Rotar `AIWS_SESSION_SECRET` invalida todas las sesiones.

En development con `AIWS_PUBLIC_URL=http://localhost...`, Secure puede deshabilitarse automáticamente. En production, HTTP se rechaza.

## 6. Token CLI

- Mínimo 32 bytes aleatorios.
- Se almacena externamente solo su SHA-256.
- Comparación constante.
- Bearer token únicamente.
- No query params, cookies ni localStorage.
- No endpoint para recuperar/rotar token en v0.1.

Rotación:

1. Generar token/hash.
2. Actualizar secret de despliegue.
3. Reiniciar Server.
4. Actualizar agentes.

## 7. Origin, CORS y headers

- Same-origin Web.
- CORS deshabilitado por defecto.
- Mutaciones con cookie requieren `Origin` igual a `AIWS_PUBLIC_URL`.
- Bearer no requiere Origin.

Headers mínimos:

```text
Content-Security-Policy
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Permissions-Policy
```

CSP no permite `unsafe-eval`. Raw HTML de Markdown está deshabilitado y la salida se sanea.

## 8. Repository roots

Proceso:

1. Parsear `AIWS_ALLOWED_REPO_ROOTS`.
2. `realpath` de cada root al arrancar.
3. Al crear/actualizar Project, exigir ruta absoluta.
4. Resolver `realpath(repositoryPath)`.
5. Comprobar pertenencia por segmentos, no por prefijo de string.
6. Rechazar escape mediante symlink.
7. Ejecutar Git sin shell interpolation:

```text
git -C <canonical-path> rev-parse --is-inside-work-tree
```

Se usa API de spawn con array de argumentos.

Las rutas montadas en Docker deben conservar el mismo path dentro/fuera:

```yaml
volumes:
  - /srv/repos:/srv/repos:ro
```

Así el path devuelto por AIWS es válido para agentes del host y para validación del Server.

## 9. Formatos de Attachment

### Imágenes

| Extensiones | MIME |
| --- | --- |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.webp` | `image/webp` |
| `.gif` | `image/gif` |

### Documentos

| Extensión | MIME |
| --- | --- |
| `.pdf` | `application/pdf` |

### Texto

| Extensiones | MIME normalizado |
| --- | --- |
| `.txt`, `.log` | `text/plain` |
| `.md`, `.markdown` | `text/markdown` |
| `.json`, `.jsonl` | `application/json` |
| `.csv` | `text/csv` |
| `.tsv` | `text/tab-separated-values` |
| `.xml` | `application/xml` |
| `.yaml`, `.yml` | `application/yaml` |

No permitidos:

- Ejecutables.
- HTML/SVG.
- Office.
- Archives/ZIP.
- Audio/vídeo.
- Symlinks/directorios.
- Ficheros vacíos.

## 10. Validación de fichero

No confiar en MIME del cliente.

### Binarios

Validar magic bytes:

- PNG.
- JPEG.
- WebP.
- GIF.
- PDF.

### Texto

- UTF-8 válido.
- Sin byte NUL.
- Extensión permitida.
- Normalizar MIME por extensión.

No se exige que JSON/YAML/XML sean sintácticamente válidos; son adjuntos opacos.

Si extensión, MIME declarado y contenido no son compatibles: 415.

## 11. Storage layout

```text
/data/
  aiws.sqlite
  aiws.sqlite-wal
  aiws.sqlite-shm
  attachments/
    tsk_01K0.../
      att_01K0...
  tmp/
    uploads/
    quarantine/
```

`storage_key`:

```text
attachments/<task-id>/<attachment-id>
```

- Solo IDs generados.
- Nunca nombre original.
- Nunca path absoluto en DB/API.

Permisos:

- `/data`: 0700.
- Ficheros: 0600.
- Proceso no root.

## 12. Escritura y borrado

### Upload

- Stream; no cargar 25 MiB completos en memoria.
- Cortar al superar el límite.
- Calcular SHA-256 mientras se escribe.
- `fsync` del temporal antes de mover.
- Rename atómico dentro del mismo filesystem.
- Limpiar ante error.

### Download

- Stream.
- Content-Disposition attachment.
- `nosniff`.
- Nombre RFC 5987.
- No interpretar Markdown/HTML.

### Delete

- Mover a cuarentena.
- Commit de DB.
- Purga best effort.
- Restaurar si DB falla.

## 13. Logs

JSON estructurado en producción:

```json
{
  "level": "info",
  "time": "...",
  "requestId": "req_...",
  "method": "GET",
  "path": "/api/v1/tasks/tsk_...",
  "status": 200,
  "durationMs": 12
}
```

No registrar:

- Authorization/Cookie.
- Password.
- User Request completo.
- Curator Spec completa.
- Answer text completo.
- Bytes.
- Query strings sensibles.

## 14. Docker Compose de referencia

```yaml
services:
  aiws:
    image: ghcr.io/example/aiws:0.6.1
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - aiws-data:/data
      - /srv/repos:/srv/repos:ro
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "/app/aiws-server", "healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  aiws-data:
```

El servidor escribe únicamente en `/data` y, si fuera necesario, `/tmp`.

## 15. Backups

Feature de backup fuera del MVP.

Procedimiento documentado:

```bash
docker compose stop aiws
# snapshot/copia consistente del volumen aiws-data
docker compose start aiws
```

Los repository roots no forman parte del backup de AIWS.
# Addendum v0.2 — runner y GitHub

- La clave privada de GitHub App reside solo en Server; los tokens de instalación son efímeros y runner-only.
- El token del runner se valida por hash SHA-256 y produce actor `system`, separado de Web y CLI.
- El manager posee el socket Docker; los agentes nunca lo montan.
- Cada agente se ejecuta sin capabilities, sin privilegios adicionales, con rootfs read-only y límites de recursos.
- Las API keys de OpenAI permanecen en el manager y se sustituyen dentro del agente por capacidades aleatorias revocables.
- Git usa `GIT_ASKPASS`; no se interpolan secretos en URL, argumentos persistidos o logs.
- Los logs JSONL se redactan, limitan, almacenan bajo `/data/run-logs` y requieren autenticación para lectura.
- Los repos gestionados viven en `/repositories`; los worktrees efímeros viven en el volumen `/workspaces`.

# Addendum v0.3 — frontera del curator

- El repositorio y los Attachments se montan read-only dentro del agente de curation.
- El manager descarga Attachments con su autoridad system; el agente no recibe token AIWS ni credenciales Git.
- Las imágenes se entregan a Codex mediante `--image`; los PDF se convierten con `pdftotext` y los textos permanecen disponibles directamente.
- `--output-schema` restringe la salida; solo el manager puede aplicarla y siempre comprueba la versión capturada.
- Un fallo técnico no degrada la Task a Draft ni Ready: permanece Curating y se pausa hasta Retry.

# Addendum v0.4 — mensajes

- Texto, nombres y MIME del composer siguen siendo no confiables y no se registran completos.
- Todos los blobs de un mensaje se validan y staged antes de la transacción; cualquier error revierte metadata, Cycle, evento y versión y compensa blobs ya movidos.
- `messageId`, `cycleId` y storage keys proceden exclusivamente de IDs del servidor.

# Addendum — control del catálogo Codex

- `AIWS_RUNNER_CONTROL_SECRET` tiene al menos 32 caracteres, se comparte solo entre Server y
  runner-manager y se compara en tiempo constante.
- El endpoint de control vive únicamente en la red Docker interna y no usa el token entregado a
  los agentes.
- Para API key, el contenedor de catálogo recibe una capacidad temporal revocable; para sesión
  ChatGPT monta el volumen de autenticación. El cleanup y la revocación ocurren también en timeout
  o salida prematura.
- El catálogo se cachea brevemente por `authMode` y `credentialReference`; respuestas y logs nunca
  contienen credenciales.

# Addendum — estado operativo

- `GET /system/runner` deriva disponibilidad solo de peticiones autenticadas con el token system;
  no devuelve token, credencial, argumentos ni logs.
- Server no monta el socket Docker. Web no puede arrancar, detener ni reiniciar contenedores.
- Reanudar una Task es una mutación de dominio autenticada, versionada y auditable; no concede
  autoridad de infraestructura.

# Addendum v0.5 — ntfy

- URL base solo HTTP/HTTPS, sin credenciales, query ni fragment.
- Un token Bearer solo puede persistirse y enviarse sobre HTTPS.
- SQLite contiene únicamente AES-256-GCM ciphertext, IV y tag; la clave procede de
  `AIWS_NOTIFICATION_ENCRYPTION_KEY`.
- Si existe ciphertext y falta la clave o no descifra, el arranque falla con un mensaje redactado.
- Requests ntfy no siguen redirects. Logs y errores no contienen token ni body de respuesta.
- Topics anónimos pueden ser públicos; la Web lo comunica antes de activar.

# Addendum — ramas GitHub

- Nombres, SHAs y flags de protección recibidos de GitHub se tratan como datos no confiables y se
  validan por longitud/forma antes de persistir o ejecutar Git.
- Los nombres se pasan como argumentos directos a Git; nunca se interpolan en un shell.
- El token de instalación se usa solo en el adapter GitHub y en `GIT_ASKPASS`; no aparece en URLs,
  refs, errores ni logs.
- Publishing compara la base solicitada con el snapshot de Delivery antes de llamar a GitHub.

# Addendum v0.5.1 — distribución y agentes externos

- Producción consume `ghcr.io/<owner>/aiws`, `aiws-runner-manager` y `aiws-agent` mediante tags
  inmutables; el Compose de desarrollo sigue construyendo desde checkout.
- El bundle liga `127.0.0.1:3000` y no incluye reverse proxy, OpenClaw, Hermes ni otros agentes.
- El instalador Linux verifica `SHA256SUMS` antes de instalar, reemplaza el CLI mediante rename y
  no toca Server, Docker ni los ficheros de configuración existentes.
- `/etc/aiws` pertenece a `root:aiws-agents` con modo `0750`; `config.json` usa `0640`. Solo los
  usuarios añadidos explícitamente al grupo pueden leer el bearer administrativo compartido.
- La configuración personal usa `0600` y prevalece sobre la del sistema. `AIWS_CONFIG_FILE`,
  variables y flags permiten overrides de mayor precedencia.
- Tras añadir un usuario de servicio a `aiws-agents` debe reiniciarse su servicio para renovar
  grupos suplementarios. Un usuario ajeno al grupo no recibe acceso.
- Sandboxes y contenedores de agentes quedan fuera del camino principal: el operador monta o copia
  el CLI y proporciona configuración accesible. AIWS no genera overlays ni imágenes derivadas.
- Los approvals y políticas de ejecución pertenecen al agente externo. AIWS mantiene un único
  bearer con autoridad administrativa completa; v0.5.1 no añade scopes ni identidades.

# Addendum v0.6 — Azure DevOps

- `AIWS_AZURE_DEVOPS_CLIENT_ID`, `AIWS_AZURE_DEVOPS_CLIENT_SECRET` y
  `AIWS_CONNECTION_ENCRYPTION_KEY` son opcionales pero atómicos. La clave codifica 32 bytes y es
  obligatoria al arrancar si SQLite contiene credenciales Connection cifradas.
- Entra usa tenant `organizations`, Authorization Code + PKCE, state aleatorio hasheado y
  `offline_access`; no se admiten MSA, PAT, service principals ni Azure DevOps Server.
- Verifier, snapshot y refresh token usan AES-256-GCM. Access tokens solo viven en una caché corta
  en memoria con margen de expiración y exclusión por Connection.
- Cada refresh token rotado se confirma atómicamente. `invalid_grant` marca
  `reauthorization_required`.
- Git Azure usa `--config-env=http.extraHeader=...`; los secretos no aparecen en URL, argv, refs,
  errores o logs.
