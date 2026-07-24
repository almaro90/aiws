# Operations

## Install

Create an empty directory, extract this bundle into it, configure the repository root and public
HTTPS URL, and run the steps in `README.md`. The named volumes preserve SQLite, attachments,
managed repositories, workspaces and Codex authentication independently of the Compose files.

Install the host CLI separately with the release `install-aiws.sh`. Configure the shared system
credential only after the Unix group exists:

```sh
aiws config set --system --url http://127.0.0.1:3000 --token-stdin < aiws-api-token
rm aiws-api-token
```

## Upgrade

1. Make a consistent backup.
2. Set `AIWS_VERSION` in `.env` to the new exact version.
3. Run `docker compose --profile images pull`.
4. Run `docker compose up -d`.
5. Check health and runner status. Migrations are forward-only and run before traffic is served.

The CLI has an independent lifecycle. Re-running its installer atomically replaces only
`/usr/local/bin/aiws`; `/etc/aiws/config.json` and user configuration are preserved.

## Backup

Stop both services before copying volumes:

```sh
docker compose stop runner-manager aiws
docker run --rm -v aiws_aiws-data:/source:ro -v "$PWD/backup:/backup" alpine \
  tar -C /source -czf /backup/aiws-data.tar.gz .
docker run --rm -v aiws-repositories:/source:ro -v "$PWD/backup:/backup" alpine \
  tar -C /source -czf /backup/aiws-repositories.tar.gz .
docker compose start aiws runner-manager
```

Also back up `.env` separately as a secret. Host repository roots are not AIWS data.

## Recovery

Deploy the same AIWS version into an empty directory, restore the named volumes while services are
stopped, restore `.env`, then start AIWS. Verify `/api/v1/health`, `aiws --json runner status`,
Tasks and one attachment before accepting traffic.

Do not copy only `aiws.sqlite` while AIWS is running: WAL state and attachments are part of the
consistent backup.
