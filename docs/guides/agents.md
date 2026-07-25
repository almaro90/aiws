# Configuración de agentes

AIWS puede ejecutar Codex mediante el runner gestionado y también aceptar agentes externos por el
CLI HTTP. AIWS no instala OpenClaw, Hermes, Codex ni sus sandboxes.

## Runner y autenticación Codex

El bundle genera `AIWS_RUNNER_TOKEN`, su hash y un `AIWS_RUNNER_CONTROL_SECRET` independiente. El
manager conserva el socket Docker y las credenciales; cada contenedor agent recibe solo capacidades
temporales, un worktree aislado y los recursos necesarios para su Run.

Hay dos modos de Agent Profile:

- `api_key`: define la API key únicamente en el entorno de `runner-manager` y registra como
  `credentialReference` el nombre de la variable, por ejemplo `OPENAI_API_KEY`.
- `chatgpt_session`: inicializa el volumen `aiws-codex-auth` con `codex login --device-auth`; el
  perfil usa la referencia interna `CODEX_SESSION`.

Para una sesión ChatGPT:

```bash
docker run --rm --user root -v aiws-codex-auth:/codex-home \
  ghcr.io/almaro90/aiws-agent:0.6.0 chown -R 1000:1000 /codex-home
docker run --rm -it -v aiws-codex-auth:/codex-home -e CODEX_HOME=/codex-home \
  ghcr.io/almaro90/aiws-agent:0.6.0 codex login --device-auth
```

En Web, abre **Automation**, consulta el catálogo vivo y crea el Agent Profile con modelo y
reasoning effort cerrados. Después asigna en cada Project gestionado perfiles independientes de
Curation e Implementation desde Web o `aiws project update`. Pueden apuntar al mismo perfil; no
existe fallback implícito.

## Agentes externos y CLI compartido

Instala el CLI en el host con `install-aiws.sh`. Para compartir la credencial administrativa:

```bash
sudo aiws config set --system \
  --url https://aiws.example.com \
  --token-stdin < ./aiws-api-token
sudo usermod -aG aiws-agents USUARIO_DEL_AGENTE
sudo systemctl restart SERVICIO_DEL_AGENTE
sudo -u USUARIO_DEL_AGENTE aiws --json task list
```

`/etc/aiws/config.json` pertenece a `root:aiws-agents` y usa modo `0640`. Solo añade al grupo
usuarios de servicio confiables: el bearer compartido tiene autoridad administrativa completa. Un
agente en contenedor o sandbox necesita el binario, configuración legible y conectividad HTTP
dentro de esa frontera. Puede usar configuración personal o `AIWS_CONFIG_FILE` sin modificar la
configuración del sistema.

## Skill `aiws-workflow`

La skill portable está en `skills/aiws-workflow/SKILL.md`. Hermes descarga únicamente ese fichero,
por lo que es autocontenida. Enseña a usar `--json`, IDs completos, `expectedVersion`, Questions,
Messages, Runs y Activity; no instala el CLI ni crea o lee credenciales.

Ejemplos:

```bash
hermes skills install \
  https://raw.githubusercontent.com/almaro90/aiws/v0.6.0/skills/aiws-workflow/SKILL.md

git clone --depth 1 --branch v0.6.0 https://github.com/almaro90/aiws.git /tmp/aiws-v0.6.0
openclaw skills install /tmp/aiws-v0.6.0/skills/aiws-workflow \
  --as aiws-workflow --global
```

Para Codex, copia el directorio `skills/aiws-workflow` bajo
`${CODEX_HOME:-$HOME/.codex}/skills/aiws-workflow` y abre una sesión nueva.

Nunca entregues a la skill private keys, client secrets, tokens ni valores de API keys. La creación
de aplicaciones GitHub/Entra corresponde al operador y se explica en
[GitHub y Azure DevOps](managed-git-providers.md).
