# AIWS deployment bundle v0.5.1

This bundle installs the AIWS stack from GHCR without Bun or a source checkout. It does not install
or configure external agents.

1. Set `AIWS_IMAGE_NAMESPACE` to the documented GHCR owner and export any non-default values used
   by `init-secrets.sh`.
2. Run `./init-secrets.sh`, then review `.env`.
3. Pull every image with `docker compose --profile images pull`.
4. Start the persistent services with `docker compose up -d`.
5. Wait for `docker compose ps` to report AIWS healthy.

The API binds only to `127.0.0.1`; place it behind an HTTPS reverse proxy. Detailed installation,
upgrade, backup and recovery procedures are in `OPERATIONS.md`.
