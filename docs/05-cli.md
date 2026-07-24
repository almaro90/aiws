# 05 — CLI

## 1. Objetivo

`aiws` es la interfaz principal para agentes externos y una interfaz equivalente para personas.

No accede directamente a Core, SQLite, repositorios ni almacenamiento de AIWS. Solo usa HTTP.

## 2. Configuración

Precedencia:

1. Flags globales.
2. `AIWS_API_URL` y `AIWS_API_TOKEN`.
3. Fichero indicado por `AIWS_CONFIG_FILE`.
4. `${XDG_CONFIG_HOME:-$HOME/.config}/aiws/config.json`.
5. `/etc/aiws/config.json`.
6. Default de URL.

| Flag | Variable | Default |
| --- | --- | --- |
| `--api-url` | `AIWS_API_URL` | `http://127.0.0.1:3000` |
| `--token` | `AIWS_API_TOKEN` | sin default |
| `--json` | — | false |

El token nunca aparece en logs ni mensajes de error.

El formato persistente inicial es:

```json
{
  "apiUrl": "http://127.0.0.1:3000",
  "token": "valor-secreto"
}
```

Comandos:

```bash
aiws config path [--system]
aiws config show
aiws config set [--system] [--url URL] [--token-stdin]
aiws config unset [--system] [--url] [--credential]
```

`config set` exige al menos URL o token. El token se recibe mediante stdin o TTY sin echo; no
existe flag que acepte su valor. `config show` siempre devuelve `"[REDACTED]"` cuando hay token.
Sin `--system`, la escritura es atómica y usa directorio `0700` y fichero `0600`. Con `--system`
exige root, grupo `aiws-agents`, directorio `0750`, fichero `0640` y propietario
`root:aiws-agents`. `unset` sin selector elimina el fichero completo.

## 3. Reglas globales

```bash
aiws [--api-url URL] [--token TOKEN] [--json] <command>
```

- `--json` produce JSON compacto y estable.
- En `--json` nunca existen prompts, spinners, colores ni texto decorativo.
- Success JSON va a stdout.
- Error JSON va a stderr.
- Los warnings humanos van a stderr.
- Los binarios descargados no se mezclan con JSON.
- `--help` y `--version` funcionan sin configuración ni red.
- Todos los IDs se exigen completos.

## 4. Textos y stdin

Los textos largos aceptan:

- `--request TEXT`.
- `--request-file PATH`.
- `--request-file -` para stdin.

Flags equivalentes para spec/answer.

Reglas:

- Los flags inline y file son mutuamente excluyentes.
- Solo un input de un comando puede consumir stdin.
- Error de lectura → exit 8.
- El contenido se envía sin modificar salvo normalización de CRLF a LF.

## 5. Projects

### Create

```bash
aiws project create \
  --name "UpRetina Webinars" \
  --description "Landing y gestión" \
  --repository-path /srv/repos/work/upretina-webinars \
  --git-provider azure_devops \
  --account-scope work
```

Flags requeridos:

- `--name`.
- `--repository-path`.
- `--git-provider`.
- `--account-scope`.

`--description` default `""`.

### List

```bash
aiws project list \
  [--git-provider github] \
  [--account-scope personal] \
  [--archived] \
  [--limit 50] \
  [--cursor CURSOR]
```

### Show

```bash
aiws project show PROJECT_ID
```

### Update

```bash
aiws project update PROJECT_ID \
  [--name NAME] \
  [--description TEXT] \
  [--repository-path PATH] \
  [--git-provider PROVIDER] \
  [--account-scope SCOPE]
```

Al menos un campo.

### Archive/unarchive

```bash
aiws project archive PROJECT_ID
aiws project unarchive PROJECT_ID
```

## 6. Tasks

### Create

```bash
aiws task create \
  --project PROJECT_ID \
  [--title TITLE] \
  (--request TEXT | --request-file PATH) \
  [--attach PATH]...
```

Con adjuntos:

1. Crea Task.
2. Usa su versión 1 para el primer upload.
3. Usa la versión devuelta para el siguiente.
4. Devuelve el agregado final.

Si la Task se crea pero falla un adjunto:

- No elimina la Task ni adjuntos previos.
- Devuelve exit 9.
- En JSON incluye `partial=true`, Task actual y error del fichero.

### List

```bash
aiws task list \
  [--project PROJECT_ID] \
  [--status STATUS]... \
  [--account-scope SCOPE] \
  [--git-provider PROVIDER] \
  [--archived] \
  [--sort updated-at|created-at] \
  [--order asc|desc] \
  [--limit 50] \
  [--cursor CURSOR]
```

CLI traduce:

- `updated-at` → API `updatedAt`.
- `created-at` → API `createdAt`.

Curator:

```bash
aiws task list --status curating --sort created-at --order asc --json
```

Implementador:

```bash
aiws task list --status ready --sort created-at --order asc --json
```

### Show

```bash
aiws task show TASK_ID
```

JSON devuelve el agregado API sin reestructurarlo.

### Update

```bash
aiws task update TASK_ID \
  --expected-version VERSION \
  [--title TITLE] \
  [--request TEXT | --request-file PATH] \
  [--spec TEXT | --spec-file PATH] \
  [--pr-url URL | --clear-pr-url]
```

Al menos un campo. `--pr-url` y `--clear-pr-url` son excluyentes.

`--request`/`--request-file` solo funcionan en Draft. Para entregar trabajo a cualquier curator:

```bash
aiws task transition TASK_ID --from draft --to curating --expected-version VERSION
```

Los Runs pueden filtrarse por propósito:

```bash
aiws run list --task TASK_ID --kind curation
aiws run list --task TASK_ID --kind implementation
```

Un Run fallido se reintenta con la versión vigente de la Task. `auto` reanuda publicación cuando hay checkpoint seguro; `full` vuelve a ejecutar Codex y `publish_only` exige checkpoint:

```bash
aiws run retry RUN_ID --expected-version VERSION --mode auto
```

La disponibilidad del manager y una pausa de Task se operan sin acceso directo a Docker:

```bash
aiws runner status
aiws task automation-resume TASK_ID --expected-version VERSION
```

`automation-resume` conserva la concurrencia optimista y solo es válido en Curating o Ready.

### Transition

```bash
aiws task transition TASK_ID \
  --from STATUS \
  --to STATUS \
  --expected-version VERSION \
  [--reason TEXT]
```

Ejemplos:

```bash
aiws task transition TASK_ID \
  --from ready \
  --to implementing \
  --expected-version 4

aiws task transition TASK_ID \
  --from implementing \
  --to done \
  --expected-version 5 \
  --reason "Implementación y tests terminados"
```

### Archive/unarchive

```bash
aiws task archive TASK_ID \
  --expected-version VERSION \
  [--reason TEXT]

aiws task unarchive TASK_ID \
  --expected-version VERSION
```

### Activity

```bash
aiws task activity TASK_ID [--limit 50] [--cursor CURSOR]
```

## 7. Questions

### Create text

```bash
aiws task question create TASK_ID \
  --expected-version VERSION \
  --type text \
  --text "¿Qué comportamiento esperabas?"
```

### Create choice

```bash
aiws task question create TASK_ID \
  --expected-version VERSION \
  --type single-choice \
  --text "¿En qué entorno ocurre?" \
  --option "Producción" \
  --option "Pruebas" \
  --option "Ambos" \
  --allow-other
```

CLI traduce:

- `single-choice` → `single_choice`.
- `multiple-choice` → `multiple_choice`.

### List/show

```bash
aiws task question list TASK_ID
aiws task question show TASK_ID QUESTION_ID
```

### Update

Reemplaza la definición completa:

```bash
aiws task question update TASK_ID QUESTION_ID \
  --expected-version VERSION \
  --type single-choice \
  --text "¿En qué entorno ocurre?" \
  --option "Producción" \
  --option "Pruebas" \
  --allow-other
```

### Answer text

```bash
aiws task question answer TASK_ID QUESTION_ID \
  --expected-version VERSION \
  (--text ANSWER | --text-file PATH)
```

### Answer choice

```bash
aiws task question answer TASK_ID QUESTION_ID \
  --expected-version VERSION \
  --option-id OPTION_ID \
  [--option-id OPTION_ID]... \
  [--text COMMENT | --text-file PATH]
```

Se responde por option ID, no por label o posición.

### Dismiss/reopen

```bash
aiws task question dismiss TASK_ID QUESTION_ID \
  --expected-version VERSION \
  [--reason TEXT]

aiws task question reopen TASK_ID QUESTION_ID \
  --expected-version VERSION \
  [--reason TEXT]
```

## 8. Attachments

### Add

```bash
aiws task attachment add TASK_ID PATH \
  --expected-version VERSION
```

Solo un fichero por llamada.

### List

```bash
aiws task attachment list TASK_ID
```

### Get

```bash
aiws task attachment get TASK_ID ATTACHMENT_ID \
  --output PATH
```

`--output -`:

- Envía bytes a stdout.
- No se puede combinar con `--json`.
- Es responsabilidad del caller tratar el stream correctamente.

Si PATH existe:

- Por defecto falla con exit 8.
- `--force` permite reemplazarlo atómicamente.

La descarga escribe a temporal y renombra al completar. Nunca deja un fichero de destino parcial.

### Delete

```bash
aiws task attachment delete TASK_ID ATTACHMENT_ID \
  --expected-version VERSION \
  --yes
```

- En modo humano, sin `--yes`, pide confirmación.
- Con `--json`, `--yes` es obligatorio y la ausencia devuelve exit 2.

## 9. Salida humana

Objetivos:

- Tablas compactas en listados.
- Detalle legible en show.
- Mostrar IDs completos.
- Mostrar version en Task.
- No truncar campos en `show`.
- Truncar solo columnas de listados y ofrecer `--json` para el valor completo.

No se considera contrato estable; la salida JSON sí.

## 10. Salida JSON

Success:

- Usa exactamente el body de la API cuando existe.
- Comandos 204 devuelven `{ "ok": true }`.
- No añade timestamps locales.

Error stderr:

```json
{
  "ok": false,
  "error": {
    "code": "version_conflict",
    "message": "Task version does not match.",
    "details": {},
    "requestId": "req_..."
  }
}
```

Error local:

```json
{
  "ok": false,
  "error": {
    "code": "file_read_error",
    "message": "Could not read input file.",
    "details": {
      "path": "./spec.md"
    },
    "requestId": null
  }
}
```

## 11. Exit codes

| Código | Significado |
| ---: | --- |
| 0 | Éxito |
| 2 | Uso/flags/input local inválido |
| 3 | Configuración o autenticación |
| 4 | Recurso no encontrado |
| 5 | Conflicto, versión o transición |
| 6 | Error API/server inesperado |
| 7 | Red, timeout o servidor inaccesible |
| 8 | Lectura/escritura local de fichero |
| 9 | Éxito parcial |

Mapping:

- HTTP 401/403 → 3.
- HTTP 404 → 4.
- HTTP 409/428 → 5.
- HTTP 400/413/415/422 → 2.
- HTTP 5xx → 6.

## 12. Timeouts

- Requests JSON: 30 segundos.
- Upload/download: 5 minutos.
- Se pueden sobrescribir con `AIWS_HTTP_TIMEOUT_MS` y `AIWS_TRANSFER_TIMEOUT_MS`.
- Timeout no se reintenta automáticamente en mutaciones.

## 13. Ciclos v0.4

```bash
aiws task message TASK_ID --expected-version VERSION --text "Cambio" --attach screenshot.png
aiws task message TASK_ID --expected-version VERSION --text-file context.md
aiws task timeline TASK_ID [--limit 50] [--cursor CURSOR]
```

El primer comando crea Cycle al partir de Done y añade contexto sin cerrar Questions al partir de Blocked. Texto y adjuntos se envían en un único multipart.

## 14. Modelos de Agent Profile

```bash
aiws agent-profile models \
  --auth-mode api_key \
  --credential-reference OPENAI_API_KEY

aiws agent-profile create \
  --name Codex \
  --auth-mode api_key \
  --credential-reference OPENAI_API_KEY \
  --model gpt-5-codex \
  --reasoning-effort high
```

`--model` y `--reasoning-effort` son obligatorios al crear y deben proceder del catálogo.

## 15. Ramas de referencia

```bash
aiws project branches PROJECT_ID
aiws project update PROJECT_ID --default-branch release/next
aiws task create --project PROJECT_ID --base-branch release/next --request "Implementar cambio"
```

Omitir `--base-branch` usa la rama configurada en el Project. El servidor valida la rama contra
GitHub; el CLI no accede al proveedor directamente.

## 16. Assets de release v0.5.1

GitHub Releases publica:

- `aiws-linux-x64.tar.gz` y `aiws-linux-arm64.tar.gz`.
- `aiws-darwin-x64.tar.gz` y `aiws-darwin-arm64.tar.gz`.
- `aiws-windows-x64.zip`.
- `SHA256SUMS`, `install-aiws.sh`, metadatos y procedencia.

Los archivos Unix contienen un ejecutable llamado `aiws`; Windows contiene `aiws.exe`. El
instalador compartido del VPS es solo Linux y no modifica Server ni Docker.
