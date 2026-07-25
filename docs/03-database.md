# 03 — SQLite y migraciones

## 1. Fuente de verdad

`docs/database/0001_initial.sql` define el esquema inicial esperado.

Durante la implementación se copiará a `packages/sqlite/migrations/0001_initial.sql`. Cualquier cambio posterior crea una migración nueva; no se reescribe una migración publicada.

## 2. Apertura de la base de datos

Ruta:

```text
${AIWS_DATA_DIR}/aiws.sqlite
```

Configuración obligatoria en cada conexión:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

El servidor usa una única instancia `Database` durante su vida.

## 3. Migraciones

El runner:

1. Crea `schema_migrations` si no existe.
2. Carga ficheros `NNNN_name.sql` ordenados por nombre.
3. Calcula SHA-256 de cada fichero.
4. Verifica que el checksum de migraciones ya aplicadas coincide.
5. Ejecuta cada pendiente en una transacción.
6. Inserta versión, nombre, checksum y fecha.
7. Aborta el arranque ante cualquier error o checksum divergente.

No existe rollback automático de producción. Las correcciones se realizan con migraciones forward-only.

## 4. Tipos

- IDs: `TEXT`.
- Enums: `TEXT` con CHECK.
- Boolean: `INTEGER` 0/1.
- Fechas: `TEXT` UTC RFC 3339.
- JSON: `TEXT` validado con `json_valid`.
- Tamaños/versiones: `INTEGER`.

Las tablas usan `STRICT`.

## 5. Tablas

### projects

Inventario del repositorio.

`repository_path` es canonical y único incluso si el Project está archivado.

### tasks

Raíz del agregado.

`user_request` está protegida además mediante trigger de inmutabilidad.

`version` comienza en 1 y se incrementa por Core, nunca mediante trigger.

### questions

Las opciones se almacenan en `options_json`:

```json
[
  {
    "id": "opt_01K0...",
    "label": "Producción",
    "position": 0
  }
]
```

La selección se almacena en `selected_option_ids_json`:

```json
["opt_01K0..."]
```

Core valida pertenencia, cardinalidad y reglas por tipo.

### attachments

`storage_key` es una clave relativa interna, nunca una ruta recibida ni expuesta:

```text
attachments/tsk_01K0.../att_01K0...
```

### task_events

Append-only desde la aplicación. No se ofrecen endpoints de edición o borrado.

## 6. Índices y consultas objetivo

| Índice | Consulta |
| --- | --- |
| `idx_projects_active_updated` | Listado normal de Projects |
| `idx_projects_provider_scope` | Filtros provider/scope |
| `idx_tasks_active_updated` | Listado general |
| `idx_tasks_active_status_created` | Colas Curating/Ready |
| `idx_tasks_project_active_status` | Tasks de un Project |
| `idx_tasks_archived_at` | Archivo |
| `idx_questions_task_status` | Preguntas abiertas/agregado |
| `idx_attachments_task_created` | Adjuntos de Task |
| `idx_task_events_task_created` | Actividad paginada |

Los listados ordenan siempre por el campo seleccionado y `id` como desempate.

## 7. Transacciones de Task

Patrón:

```sql
BEGIN IMMEDIATE;

-- Leer/validar agregado.
-- Mutar entidad hija si procede.

UPDATE tasks
SET version = version + 1,
    updated_at = :now
WHERE id = :task_id
  AND version = :expected_version
  AND archived_at IS NULL;

-- Debe afectar exactamente una fila.
-- Insertar TaskEvents con task_version = expected + 1 en metadata.

COMMIT;
```

Ante cero filas:

```sql
ROLLBACK;
```

y Core devuelve `version_conflict` o `not_found` después de una lectura de desambiguación.

## 8. Pagination

Cursores opacos base64url de un JSON:

```json
{
  "v": 1,
  "sort": "updated_at",
  "order": "desc",
  "value": "2026-07-21T18:32:15.123Z",
  "id": "tsk_01K0..."
}
```

El servidor:

- Valida versión, sort y order.
- Rechaza un cursor usado con filtros/sort incompatibles.
- Usa keyset pagination, no `OFFSET`.
- Solicita `limit + 1` para determinar `nextCursor`.

## 9. Integridad no delegada a SQLite

Core debe validar:

- Reglas de estados.
- Ready requirements.
- Que Blocked tenga Questions abiertas.
- Que option IDs seleccionadas pertenezcan a la Question.
- Límites de Attachments.
- Project sin Tasks activas al archivar.
- URLs.
- Longitudes Unicode/bytes detalladas.
- Concurrencia y eventos.

## 11. Migración v0.3

`0003_managed_curation.sql` reconstruye las tablas STRICT afectadas, conserva filas e IDs existentes, añade Curating, `Run.kind/outcome`, branch nullable e intentos por kind. El trigger permite cambiar `user_request` solo si OLD y NEW siguen Draft; cualquier cambio posterior aborta en SQLite.

## 10. Backups

Backups automatizados están fuera del MVP.

La documentación operativa debe advertir que no se copie únicamente `aiws.sqlite` mientras el servidor escribe en WAL. Para un backup manual consistente:

1. Detener AIWS de forma limpia.
2. Copiar el directorio `/data` completo.
3. Reiniciar AIWS.

## 12. Migración v0.4

`0004_task_cycles.sql` crea Cycle 1 por Task, proyecta `user_request` a Task Message, conserva la spec como revisión, asocia Questions/Attachments/Runs al Cycle y reconstruye una Delivery desde la rama/PR disponible. Añade índices de timeline y elimina la unicidad global de `runs.branch_name`, porque varios attempts de una Delivery comparten rama.

## 13. Migración de recuperación de Runs

`0005_run_recovery.sql` añade `execution_stage` y `resume_from_run_id`. El backfill conserva `agent` como opción segura y clasifica como `publishing` los Runs de implementación terminales con `base_sha`, logs y diagnóstico Git/GitHub compatible con una publicación interrumpida.

## 14. Migración del catálogo de modelos

`0006_agent_model_catalog.sql` añade `agent_profiles.reasoning_effort` nullable y limitado a 120
caracteres. Las filas existentes conservan null tanto en modelo como en effort; solo la creación
posterior exige valores validados contra el catálogo vivo.

## 15. Migración de notificaciones

`0007_global_notifications.sql` crea `notification_settings` singleton y
`notification_outbox`. El índice `idx_notification_outbox_due(next_attempt_at, event_id)` sirve el
polling. `event_id` es PK y FK al TaskEvent para identidad e idempotencia.

El token se divide en ciphertext, IV y authentication tag AES-256-GCM. La outbox conserva solo
snapshots seguros, intento, próximo intento y un error saneado de hasta 500 caracteres.

## 16. Migración de perfiles separados

`0008_separate_agent_profiles.sql` renombra `projects.agent_profile_id` a
`implementation_agent_profile_id`, añade `curation_agent_profile_id` con la misma foreign key y
copia el valor anterior. Así una instalación v0.5 conserva el comportamiento de usar el mismo
perfil para ambas fases. La tabla `runs` no cambia: `runs.agent_profile_id` sigue siendo el snapshot
histórico capturado al crear cada attempt.

## 17. Migración de rama de referencia

`0009_delivery_base_branch.sql` añade `deliveries.base_branch` con límite de 255 caracteres. El
backfill recorre Delivery → Task → Project y copia `projects.default_branch`; las Deliveries de
Projects locales permanecen null. Las nuevas Tasks gestionadas escriben Delivery y su snapshot
dentro de la misma Unit of Work.

## 18. Migración Azure DevOps

`0010_azure_devops_provider.sql` reconstruye `connections` preservando instalaciones GitHub,
admite la unión GitHub/Azure, añade estado de reautorización y guarda refresh tokens Azure como
AES-256-GCM ciphertext/IV/tag. Índices parciales garantizan una instalación GitHub y una
organización Azure únicas.

`azure_oauth_authorizations` guarda state hasheado, verifier y snapshot cifrados, expiración y
marcas de consumo/completado. La reconstrucción desactiva foreign keys solo durante la transacción,
usa `legacy_alter_table` para conservar las referencias existentes y ejecuta
`foreign_key_check` antes de confirmar.
