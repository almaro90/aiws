# 08 — Estrategia de pruebas

## 1. Gates obligatorios

```bash
bun run format:check
bun run lint
bun run typecheck
bun test
bun run test:e2e
bun run contract:check
bun run build
bun run smoke
```

`smoke` ejecuta tanto la aceptación del contenedor Server como el bundle completo desde un
directorio vacío, incluyendo health, runner-manager, migraciones, reinicio y persistencia.

Todos deben existir en root y devolver código no cero al fallar.

## 2. Pirámide

### Unit

- Domain/value objects.
- Use cases con ports fake.
- Schemas Zod.
- Cursor encode/decode.
- CLI parsing/output mapping.

### Integration

- Repositories contra SQLite temporal real.
- Migraciones desde DB vacía.
- Hono `app.request`.
- Auth/cookies/bearer.
- Blob storage en directorio temporal.
- CLI contra Server efímero.

### Smoke

- Docker.
- Health.
- Login.
- Vertical slice Project → Task → Ready → Implementing → Done.
- Upload/download.

Playwright se limita a Chromium y a los flujos UI críticos; no se exige una matriz multi-browser.

## 3. Reglas

- Tests deterministas.
- Clock e IDs inyectables.
- Cada test usa DB/directorio aislado.
- No depende de red externa.
- No usa repos reales del usuario.
- Para validación Git, crea un repositorio temporal con `git init`.
- Los snapshots no sustituyen assertions de dominio.

## 4. Domain matrix

### Projects

- [ ] Crea con datos válidos.
- [ ] Rechaza name vacío/largo.
- [ ] Rechaza provider/scope inválido.
- [ ] Rechaza path relativo.
- [ ] Rechaza path fuera de roots.
- [ ] Rechaza symlink que escape.
- [ ] Rechaza directorio no Git.
- [ ] Rechaza path duplicado.
- [ ] Actualiza cada campo.
- [ ] No actualiza archivado.
- [ ] No archiva con Tasks activas.
- [ ] Archive/unarchive repetido es idempotente.

### Task creation/update

- [ ] Crea version 1, Draft y spec vacía.
- [ ] Genera título desde primera línea.
- [ ] Normaliza whitespace del título generado.
- [ ] Trunca título generado.
- [ ] Rechaza Project archivado/inexistente.
- [ ] User Request cambia en Draft y se rechaza desde Curating en Core/API.
- [ ] Trigger SQLite permite Draft e impide cualquier cambio posterior.
- [ ] Actualizar title incrementa una vez.
- [ ] Actualizar spec emite hash/length, no contenido.
- [ ] PR URL acepta HTTP/HTTPS.
- [ ] PR URL rechaza otros schemes.
- [ ] Clear PR URL funciona.
- [ ] Spec vacía se rechaza en Ready/Implementing/Done.

### Transitions

- [ ] Draft → Curating válido; en managed exige Curation Agent Profile habilitado.
- [ ] Draft → Ready se rechaza.
- [ ] Curating → Ready exige spec no vacía y cero Questions abiertas.
- [ ] Ready → Implementing.
- [ ] Implementing → Done.
- [ ] Done → Ready se rechaza; un Message crea Cycle y vuelve a Curating.
- [ ] Cualquier transición no listada falla.
- [ ] `from` incorrecto falla.
- [ ] Done no requiere PR.
- [ ] Reason se registra.
- [ ] Cada transición incrementa una vez.

### Questions

- [ ] Text sin options válido.
- [ ] Text con options inválido.
- [ ] Choices con menos de 2 inválido.
- [ ] Más de 20 inválido.
- [ ] Labels vacíos/duplicación de IDs inválidos.
- [ ] Create cambia Curating/Ready/Implementing a Blocked y Draft lo rechaza.
- [ ] Create en Done falla.
- [ ] Create en Blocked no crea evento status redundante.
- [ ] Answer text requiere texto.
- [ ] Single requiere exactamente una opción o Other.
- [ ] Multiple requiere una o más o Other.
- [ ] IDs ajenos fallan.
- [ ] allowOther false rechaza texto como única respuesta.
- [ ] Answer cambia a Answered.
- [ ] Dismiss cambia a Dismissed.
- [ ] Resolver con otras open mantiene Blocked.
- [ ] Resolver la última cambia Blocked → Curating.
- [ ] Reopen cambia a Open y Task → Blocked.
- [ ] Reopen conserva respuesta anterior.
- [ ] Update solo antes de primera respuesta.
- [ ] Question no se elimina.

### Attachments

- [ ] Acepta cada formato permitido.
- [ ] Rechaza magic bytes incorrectos.
- [ ] Rechaza text con NUL/UTF-8 inválido.
- [ ] Rechaza HTML/SVG/archive/executable.
- [ ] Rechaza vacío.
- [ ] Rechaza > límite durante streaming.
- [ ] Rechaza attachment 11.
- [ ] Calcula SHA-256 correcto.
- [ ] Storage key no contiene nombre original.
- [ ] Upload incrementa version una vez.
- [ ] Download devuelve bytes idénticos.
- [ ] Delete incrementa version y elimina metadata/blob.
- [ ] Fallo DB después de quarantine restaura blob.
- [ ] Conflicto después de stage limpia temporal.
- [ ] Cleanup elimina huérfanos antiguos y conserva recientes.

### Archive

- [ ] Task archive conserva hijos.
- [ ] Task archivada es read-only.
- [ ] Unarchive conserva estado e incrementa version.
- [ ] List default excluye archivadas.
- [ ] Project archive exige Tasks archivadas.

## 5. Concurrency matrix

### Claim

Preparar Task Ready version 4.

Ejecutar dos transiciones concurrentes con expected 4:

- [ ] Exactamente una devuelve éxito/version 5.
- [ ] Exactamente una devuelve version_conflict.
- [ ] Estado final Implementing.
- [ ] Un único status event.

### Spec update

- [ ] Dos updates expected 4: solo uno vence.
- [ ] La perdedora no sobrescribe contenido.

### Question/Attachment

- [ ] Create question y upload con misma versión: uno vence.
- [ ] No quedan eventos ni blobs de la operación perdedora.

## 6. SQLite/migrations

- [ ] DB vacía migra a 0001.
- [ ] Segundo arranque no reaplica.
- [ ] Checksum divergente bloquea arranque.
- [ ] Migración fallida hace rollback.
- [ ] Foreign keys están ON.
- [ ] WAL está activo.
- [ ] Trigger User Request funciona.
- [ ] Todos los CHECK principales rechazan filas inválidas.
- [ ] Índices esperados existen.

## 7. API matrix

Para cada endpoint:

- [ ] Auth ausente.
- [ ] Bearer inválido.
- [ ] Cookie válida.
- [ ] Bearer válido.
- [ ] Input válido.
- [ ] Input inválido.
- [ ] Not found.
- [ ] Error envelope/request ID.

Mutaciones Task:

- [ ] If-Match ausente → 428.
- [ ] If-Match inválido → 422.
- [ ] Mismatch → 409.
- [ ] ETag nuevo en éxito.

Cookie:

- [ ] Origin correcto.
- [ ] Origin ausente/incorrecto en mutación → 403.
- [ ] Bearer no exige Origin.

OpenAPI:

- [ ] Todas las rutas reales aparecen.
- [ ] Todos los operationId son únicos.
- [ ] Snapshot coincide tras normalización.
- [ ] Tipos API Client se regeneran sin diff.

## 8. Pagination

Con al menos 250 filas:

- [ ] Primera página 50.
- [ ] Cursor continúa sin duplicados.
- [ ] No omite items.
- [ ] Empates usan ID.
- [ ] Asc/desc.
- [ ] Cursor incompatible con sort/filtros falla.
- [ ] Limit 1/200 válido; 0/201 inválido.
- [ ] Nuevos registros entre páginas no rompen el cursor de forma insegura.

## 9. CLI matrix

- [ ] Help/version sin red.
- [ ] Config flags > env > defaults.
- [ ] Falta token → exit 3.
- [ ] Cada HTTP mapping produce exit correcto.
- [ ] `--json` no emite decoración.
- [ ] Success stdout/error stderr.
- [ ] stdin funciona.
- [ ] Flags mutuamente excluyentes fallan exit 2.
- [ ] Download atómico.
- [ ] Existing output sin force falla.
- [ ] Binary stdout incompatible con json.
- [ ] Delete attachment json exige yes.
- [ ] Create con attachment fallido devuelve exit 9.
- [ ] Token se redacta en errores.
- [ ] Azure lista organizaciones y completa por IDs completos con body exacto.
- [ ] Project update combina perfiles/automatización y limpia perfiles/schedule.
- [ ] Pares set/clear y enable/disable fallan exit 2; concurrencia acepta solo 1..16.
- [ ] `doctor` sano conserva orden y JSON estable.
- [ ] `doctor` cubre token ausente, auth inválida, unhealthy, respuesta inválida, red y timeout.
- [ ] Version mismatch, runner offline/unknown y reautorización son warnings con exit 0.
- [ ] Perfiles ausentes/deshabilitados se resumen sin exponer referencias ni secretos.
- [ ] `doctor --json` fallido escribe stdout estructurado y deja stderr vacío.

## 10. Web verification

Se permiten tests unitarios/componentes solo para lógica crítica:

- [ ] Question form por tipo.
- [ ] Conflict banner conserva draft local.
- [ ] Markdown sanitizer.
- [ ] Query serialization de filtros.
- [ ] API error mapping.
- [ ] Route guard de sesión.

Playwright cubre en Chromium desktop y mobile:

- [ ] Shell y listados responsive sin overflow horizontal.
- [ ] Controles de los tres tipos de Question y navegación por teclado.
- [ ] Recursos archivados en modo read-only salvo restauración.
- [ ] Conflicto de versión conserva el borrador local.
- [ ] Dialogs destructivos gestionan foco y Escape.

El resto se cubre con typecheck, build y checklist manual.

## 11. Security tests

- [ ] Path traversal repo.
- [ ] Prefix confusion `/srv/repos-a` vs `/srv/repos`.
- [ ] Symlink escape.
- [ ] Filename `../../x`.
- [ ] Header injection en filename.
- [ ] SVG renombrado PNG.
- [ ] HTML Markdown/raw HTML.
- [ ] Cookie flags producción.
- [ ] Login rate limit.
- [ ] Logs no contienen secretos ni bodies sensibles.
- [ ] CORS no habilitado.

## 12. Docker smoke

Desde checkout limpio:

1. Build image.
2. Crear secrets test.
3. Crear repo Git temporal y mount.
4. Arrancar Compose.
5. Esperar health.
6. Crear Project vía CLI.
7. Crear Task + txt attachment.
8. Escribir spec.
9. Transition Ready.
10. Claim.
11. Set PR URL.
12. Done.
13. Reiniciar container.
14. Verificar datos y bytes.

Done:

- [ ] Todo el flujo retorna 0.
- [ ] Health pasa.
- [ ] Persistencia pasa.
- [ ] Container corre non-root.

## 13. Matriz v0.3 managed curation

- [ ] Claim concurrente de Curating tiene exactamente un ganador.
- [ ] Ready aplica spec/título/estado/eventos y una versión en una transacción.
- [ ] Blocked crea entre 1 y 10 Questions y sube una versión.
- [ ] Última respuesta devuelve a Curating y el siguiente attempt es de curation.
- [ ] Conflicto descarta toda la salida estructurada.
- [ ] Fallo, heartbeat y JSON inválido pausan Curating; Retry crea el siguiente attempt del mismo kind.
- [ ] Curation e implementation comparten maxConcurrency.
- [ ] Repo y Attachments son read-only; el agente no recibe token AIWS, Git ni socket Docker.
- [ ] Adjuntos textuales, imágenes y PDF se materializan para el curator.

## 14. Matriz v0.4 cycles

- [x] Dos mensajes concurrentes desde Done crean un solo Cycle ganador.
- [x] Contexto en Blocked no responde ni cierra Questions.
- [x] Solo Questions del Cycle activo afectan el retorno a Curating.
- [x] Respuestas reabiertas conservan snapshots append-only.
- [x] Migración backfill y nuevos índices se aplican desde una base vacía.
- [x] Runs reintentados pueden compartir la rama de Delivery.
- [ ] Playwright cubre composer, timeline paginada y layout móvil.

## 15. Recuperación de Runs

- [x] Retry auto reanuda publishing y full reinicia agent.
- [x] Un workspace ausente, sucio o divergente rechaza publish_only.
- [x] Los snapshots conservan comienzo, cola, redacción y diagnóstico final dentro de 5 MB.
- [x] La migración 0005 y su índice coinciden con el contrato SQL.
- [x] Playwright cubre crecimiento de logs, cancelación y Retry en desktop/mobile.
- [x] Docker smoke verifica detención real, reconciliación periódica y publicación sin repetir Codex.

## 16. Catálogo de modelos

- [x] JSON-RPC inicializa, pagina y normaliza `model/list`.
- [x] Catálogo malformado, timeout y salida prematura fallan de forma cerrada.
- [x] Secreto interno incorrecto y credencial ausente no exponen valores.
- [x] API valida modelo y effort; runner pasa argumentos exactos.
- [x] SQLite conserva effort y perfiles legacy nulos.
- [x] CLI exige ambos flags y Web aplica defaults/selección dependiente sin entrada manual.

## 17. Estado y recuperación operativa

- [x] Monitor prueba unknown, online y offline con reloj determinista.
- [x] API prueba señal system autenticada, Resume correcto y conflicto de versión.
- [x] Core/SQLite prueba que Resume limpia la pausa y habilita un nuevo claim.
- [x] Un Cycle nuevo no hereda `automationPaused` de un fallo anterior.
- [x] CLI y Playwright cubren estado global y reanudación desde el detalle.

## 18. Notificaciones ntfy

- [x] Migración vacía y desde `0006`, snapshot SQL e índice due.
- [x] Outbox solo tras activación, rollback atómico y snapshot seguro.
- [x] AES-256-GCM, token enmascarado y fallo con clave ausente/incorrecta.
- [x] Payload exacto, Bearer, prioridad 3, click y `sequence_id=eventId`.
- [x] Respuesta 2xx elimina; 4xx/5xx/red/timeout conservan con backoff saneado.
- [x] Cambio de configuración elimina la generación pendiente y no hace backfill.
- [x] Auth, Origin, PATCH preserve/replace/clear, test 204/503 y cliente generado.
- [x] Web cubre configuración accesible y responsive dentro del E2E crítico.

## 19. Perfiles separados por fase

- [x] Migración v0.5 → `0008` copia el perfil a ambos campos y conserva Runs.
- [x] Draft → Curating falla sin perfil curator o con perfil curator deshabilitado.
- [x] Activar Implementation falla sin perfil implementador o con perfil deshabilitado.
- [x] Curation funciona con Implementation desactivada y dos perfiles distintos se capturan por kind.
- [x] Retry selecciona el perfil vigente del kind y un Run queued conserva su snapshot.
- [x] El mismo perfil en ambos campos preserva el comportamiento anterior.
- [x] Concurrencia conjunta y cron exclusivo de Implementation mantienen sus regresiones.
- [x] API rechaza el alias legacy y Web cubre guardado independiente y activación deshabilitada.

## 20. Rama de referencia y fetch seguro

- [x] Core prueba snapshot explícito y rechazo en Project local.
- [x] API prueba listado, actualización, creación y rama inexistente.
- [x] Migración `0009` prueba snapshot SQL y backfill.
- [x] Runner reproduce una rama checkout en otro worktree y completa el fetch/curation.
- [x] GitHub adapter prueba el mapeo de ramas con token de instalación.
- [x] CLI y Web consumen el contrato generado.

## 21. Distribución v0.5.1

- [x] Configuración CLI prueba sistema → usuario → fichero explícito → env → flags por campo.
- [x] `config show`, errores inesperados y comandos de escritura no revelan el token.
- [x] La configuración de usuario se escribe atómicamente con directorio `0700` y fichero `0600`.
- [x] El instalador selecciona Linux x64/ARM64, verifica checksum antes de instalar y no modifica
  configuración ni stack.
- [x] El Compose de bundle no contiene builds, liga loopback y conserva todos los volúmenes.
- [x] El workflow compila cinco targets CLI y tres imágenes OCI amd64/arm64 con procedencia.
- [ ] La prueba de release protegida crea usuarios Unix reales, valida grupo/override y ejecuta el
  flujo JSON completo contra los assets publicados.
- [ ] La prueba de upgrade protegida restaura bundle y CLI conservando SQLite, Attachments y config.

Las dos últimas pruebas necesitan una GitHub Release y hosts Linux amd64/arm64; el workflow de
release es su gate operativo y no se simulan con privilegios dentro de la suite unitaria.

## 22. Azure DevOps gestionado

- [ ] Migración desde `0009`, unión discriminada y unicidad por organización.
- [ ] PKCE/state de un solo uso, expiración, selección inválida y organizaciones múltiples.
- [ ] AES-256-GCM sin plaintext, refresh rotado, exclusión concurrente e `invalid_grant`.
- [ ] Repositorios UUID, `project/repository`, ramas normalizadas y `protected=null`.
- [ ] PR draft nuevo, actualización de activo, lookup por refs y descripción de 4.000 caracteres.
- [ ] Registry ejecuta las mismas operaciones GitHub/Azure y falla cerrado si no está configurado.
- [ ] Runner prueba basic y bearer sin secretos en URL, argv, error o logs.
- [ ] API, CLI, Web, OpenAPI, build y Playwright usan upstreams simulados, nunca red Azure real.

## 23. Project Readiness

- [ ] Informe estándar estable con GitHub y Azure simulados.
- [ ] Project local/archivado, Connection revocada, repo/rama inaccesible, perfiles ausentes y
  runner offline producen checks seguros.
- [ ] Probe profundo cubre imagen, workspace, red, lifecycle, toolchain y modelos.
- [ ] Cada fallo ejecuta cleanup; timeout y excepción no filtran stderr.
- [ ] API cubre auth/input/404/503; CLI cubre `--deep`, JSON y exit 6.
- [ ] Web cubre confirmación y presentación accesible.
- [ ] Playbooks protegidos ejercitan providers reales sin registrar secretos.

## 24. Ready Policy

- [ ] Defaults y validación de ambas políticas en Core/SQLite/API.
- [ ] Curation automática y aprobación manual con exactamente una versión y una revisión.
- [ ] Claim excluido mientras `readyApprovalPending=true`.
- [ ] Resultado obsoleto, cambio de política durante Run, Retry, Questions y nuevo Cycle.
- [ ] CLI y Web consumen la transición existente y muestran la aprobación preparada.
## Aceptación Hito 27

Cubrir creación, reemplazo, desactivación, conflicto concurrente, argv inválido, nombres
duplicados, máximo de comandos, timeout, inmutabilidad histórica y snapshot de Run frente a cambios
posteriores del Project.
## Aceptación Hito 28

Cubrir pass/fail required y opcional, timeout, spawn error, cancelación, truncado/redacción,
atomicidad, snapshot exacto, workspace de waiver ausente/sucio/divergente y enlaces inequívocos para
full retry, publish-only y waiver.

## Aceptación Hitos 29–31

- Attention: precedencia, deduplicación, paginación, archivado y singleton runner.
- Delivery: paridad GitHub/Azure, estados mixtos, error seguro y conservación de evidencia stale.
- Métricas: rango vacío/parcial, Project archivado, límite de 366 días, retries, evidencia,
  cobertura y ausencia de escrituras.
- Spec: diff acotado y estable sobre revisiones inmutables, visible antes de Ready.
