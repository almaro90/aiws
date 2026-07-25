# Instalación y operación

Esta guía instala AIWS v0.6.0 desde el bundle publicado. No requiere Bun ni un checkout y no
instala agentes externos.

## Requisitos y frontera HTTPS

- Docker Engine con Docker Compose.
- Un host Linux y un directorio absoluto para repositorios locales, por ejemplo `/srv/repos`.
- Un reverse proxy o túnel que termine HTTPS.

AIWS escucha en `127.0.0.1:3000`; no publiques ese puerto directamente. `AIWS_PUBLIC_URL` debe ser
la URL HTTPS externa exacta, sin slash final. Los callbacks de providers se derivan de ella.

## Instalar

1. Descarga `aiws-deployment-v0.6.0.tar.gz` desde la release, verifica su entrada en
   `SHA256SUMS` y extráelo en un directorio vacío.
2. Exporta el namespace y los valores no predeterminados:

   ```bash
   export AIWS_IMAGE_NAMESPACE=ghcr.io/almaro90
   export AIWS_PUBLIC_URL=https://aiws.example.com
   export AIWS_ALLOWED_REPO_ROOTS='["/srv/repos"]'
   export AIWS_REPO_ROOT=/srv/repos
   ```

3. Si vas a usar un provider gestionado, exporta su bloque completo antes del siguiente paso.
   Consulta [GitHub y Azure DevOps](managed-git-providers.md). Sin esos bloques, AIWS arranca con
   Projects locales.
4. Ejecuta y revisa:

   ```bash
   ./init-secrets.sh
   chmod 0600 .env aiws-api-token
   docker compose --profile images pull
   docker compose up -d
   docker compose ps
   curl --fail http://127.0.0.1:3000/api/v1/health
   ```

La respuesta de health debe ser `{"status":"ok","version":"0.6.0"}`. Conserva `.env` como secreto.
Configura el CLI con `aiws config set --system --url ... --token-stdin < aiws-api-token` y elimina
la copia temporal del token cuando ya no sea necesaria.

`init-secrets.sh` no escribe placeholders activos: omite un provider sin variables, lo activa si
recibe las tres y rechaza cualquier bloque parcial.

## Operación diaria

```bash
docker compose ps
curl --fail http://127.0.0.1:3000/api/v1/health
aiws --json runner status
aiws --json doctor
docker compose logs --tail 100 aiws runner-manager
```

Los logs no deben contener contraseñas, tokens, cookies, specs completas ni bytes de Attachments.
Los servicios persistentes son `aiws` y `runner-manager`; la imagen agent se inicia por Run.

## Backup y recuperación

SQLite puede estar en WAL. Detén ambos servicios y copia volúmenes completos, nunca solo
`aiws.sqlite`:

```bash
docker compose stop runner-manager aiws
mkdir -p backup
docker run --rm -v aiws_aiws-data:/source:ro -v "$PWD/backup:/backup" alpine \
  tar -C /source -czf /backup/aiws-data.tar.gz .
docker run --rm -v aiws-repositories:/source:ro -v "$PWD/backup:/backup" alpine \
  tar -C /source -czf /backup/aiws-repositories.tar.gz .
docker compose start aiws runner-manager
```

Guarda `.env` por separado y de forma cifrada. Los roots de repositorios del host no forman parte
del backup de AIWS. Para recuperar, restaura `.env` y volúmenes con los servicios detenidos, usa la
misma versión, arranca y verifica health, Tasks y un Attachment.

## Actualizar

1. Haz un backup consistente.
2. Cambia `AIWS_VERSION` en `.env` al tag exacto.
3. Ejecuta `docker compose --profile images pull` y `docker compose up -d`.
4. Verifica health, `aiws --json runner status`, una Task y un Attachment.

Las migraciones son automáticas, forward-only y verificadas por checksum. El CLI se actualiza por
separado; el instalador conserva `/etc/aiws/config.json` y la configuración de usuario.

Continúa con [configuración de agentes](agents.md) o [Projects y Tasks](projects-and-tasks.md).
