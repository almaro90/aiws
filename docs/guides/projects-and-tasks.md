# Projects y Tasks

El onboarding puede hacerse por Web, CLI o combinando ambos. La autorización GitHub/Entra requiere
navegador; la selección posterior de organización Azure y la configuración de Agent Profiles del
Project también están disponibles en CLI. El workflow posterior es provider-neutral.

## Crear o importar un Project

| Objetivo | Web | CLI |
| --- | --- | --- |
| Local | **Projects → Nuevo → Registrar repositorio local** | `aiws --json project create --name APP --repository-path /srv/repos/app --git-provider github --account-scope work` |
| Gestionado | **Automation → Connection → repositorio → Importar** | `aiws --json connection repos CONNECTION_ID` y `aiws --json connection import CONNECTION_ID --repository-id REPO_ID --account-scope work` |
| Inspeccionar | **Projects → Project** | `aiws --json project show PROJECT_ID` |
| Ramas | Selector Web del Project | `aiws --json project branches PROJECT_ID` |

Un Project local apunta a un worktree ya existente bajo un root permitido. Un Project gestionado
mantiene mirror, Delivery y Runs. Tras importarlo, configura en Web o CLI sus perfiles y
automatización:

```bash
aiws --json project update PROJECT_ID \
  --curation-agent-profile CURATION_PROFILE_ID \
  --implementation-agent-profile IMPLEMENTATION_PROFILE_ID \
  --enable-automation \
  --schedule-cron "0 9 * * 1-5" \
  --schedule-timezone Europe/Madrid \
  --max-concurrency 2
```

Curation puede quedar configurada con Implementation desactivada. Server valida perfiles,
Projects locales y cron.

## Crear y enviar una Task

En Web: **Tasks → Nueva Task**, elige Project, User Request, Base Branch gestionada y Attachments.
La Task nace Draft; puedes corregir su petición hasta enviarla a Curating.

```bash
aiws --json task create \
  --project PROJECT_ID \
  --request-file ./request.md \
  --attach ./error.log
aiws --json task show TASK_ID
aiws --json task transition TASK_ID \
  --from draft --to curating --expected-version VERSION
```

Cada mutación exige la `version` actual y devuelve la siguiente. `userRequest` queda inmutable al
entrar en Curating. Ready nunca se asigna automáticamente.

## Questions y Curation

| Acción | Web | CLI |
| --- | --- | --- |
| Ver contexto | Timeline e inspector | `aiws --json task show TASK_ID` |
| Crear Question | **Añadir Question** | `aiws --json task question create TASK_ID --expected-version VERSION --type text --text "¿Qué esperabas?"` |
| Responder | Control text/radio/checkbox | `aiws --json task question answer TASK_ID QUESTION_ID --expected-version VERSION --text-file answer.md` |
| Guardar spec | Editor Curator Spec | `aiws --json task update TASK_ID --expected-version VERSION --spec-file spec.md` |
| Ready explícito | **Marcar Ready** | `aiws --json task transition TASK_ID --from curating --to ready --expected-version VERSION` |

Una Question abierta lleva la Task a Blocked. Resolver la última la devuelve a Curating, no a
Ready. En Projects gestionados, inspecciona Runs de Curation y no cures en paralelo:

```bash
aiws --json run list --task TASK_ID --kind curation
```

## Implementation y Runs

Un implementador externo reclama antes de tocar el repositorio:

```bash
aiws --json task list --status ready --sort created-at --order asc
aiws --json task transition TASK_ID \
  --from ready --to implementing --expected-version VERSION
```

Solo el ganador del claim continúa. Un Project gestionado crea Runs automáticamente según su
configuración. Web muestra el Run activo, logs, cancelación y Retry; el CLI ofrece:

```bash
aiws --json run list --task TASK_ID --kind implementation
aiws --json run show RUN_ID
aiws --json run retry RUN_ID --expected-version VERSION --mode auto
aiws --json runner status
```

`auto` reanuda publishing solo con checkpoint seguro; `full` repite Codex y `publish_only` exige
ese checkpoint. No reclames ni modifiques en paralelo trabajo que ya tenga un Run activo.

Un implementador externo puede registrar PR y completar:

```bash
aiws --json task update TASK_ID --expected-version VERSION \
  --pr-url https://example.com/org/repo/pull/123
aiws --json task transition TASK_ID \
  --from implementing --to done --expected-version VERSION \
  --reason "Implementación y verificaciones completadas"
```

Done no exige PR.

## Cycles, Messages y Activity

En Done, **Solicitar cambio** crea un Cycle y vuelve a Curating. En Blocked, **Añadir contexto**
mantiene abiertas las Questions. Equivalente CLI:

```bash
aiws --json task message TASK_ID \
  --expected-version VERSION \
  --text-file ./change.md \
  --attach ./screenshot.png
aiws --json task timeline TASK_ID
aiws --json task activity TASK_ID
```

Los Messages son incrementales e inmutables. La timeline agrupa Messages, Questions, Spec
Revisions, Runs y eventos por Cycle; Activity conserva las mutaciones auditables.

Para instalar y compartir el CLI consulta [configuración de agentes](agents.md).
