# Bundle de despliegue AIWS v0.6.1

Este bundle instala el stack desde GHCR sin Bun ni checkout. No instala agentes externos.

1. Define `AIWS_IMAGE_NAMESPACE` y las cuatro variables obligatorias
   `AIWS_PUBLIC_URL`, `AIWS_ALLOWED_REPO_ROOTS`, `AIWS_REPO_ROOT` y
   `AIWS_ADMIN_USERNAME` antes de ejecutar `init-secrets.sh`.
2. Ejecuta `./init-secrets.sh` y revisa `.env`.
3. Descarga las imágenes con `docker compose --profile images pull`.
4. Arranca con `docker compose up -d`.
5. Espera a que `docker compose ps` muestre AIWS healthy.

La API liga solo `127.0.0.1`; sitúala detrás de HTTPS. Consulta:

- [Instalación y operación](guides/installation.md).
- [Configuración de agentes](guides/agents.md).
- [GitHub y Azure DevOps](guides/managed-git-providers.md).
- [Projects y Tasks](guides/projects-and-tasks.md).
- [Referencia operativa compacta](OPERATIONS.md).
