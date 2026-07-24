#!/bin/sh
set -eu

umask 077

if [ -e .env ]; then
  echo "Refusing to overwrite .env." >&2
  exit 1
fi

: "${AIWS_IMAGE_NAMESPACE:?Set AIWS_IMAGE_NAMESPACE, for example ghcr.io/almaro90}"
AIWS_VERSION="${AIWS_VERSION:-0.5.1}"
AIWS_SERVER_IMAGE="${AIWS_IMAGE_NAMESPACE}/aiws:${AIWS_VERSION}"

if [ -t 0 ] && [ -t 1 ]; then
  password_hash="$(docker run --rm -it "${AIWS_SERVER_IMAGE}" hash-password | tr -d '\r')"
else
  password_hash="$(docker run --rm -i "${AIWS_SERVER_IMAGE}" hash-password)"
fi

session_secret="$(docker run --rm "${AIWS_SERVER_IMAGE}" generate-session-secret)"
notification_key="$(docker run --rm "${AIWS_SERVER_IMAGE}" generate-notification-encryption-key)"
api_credentials="$(docker run --rm "${AIWS_SERVER_IMAGE}" generate-api-token)"
runner_credentials="$(docker run --rm "${AIWS_SERVER_IMAGE}" generate-runner-token)"
runner_control="$(docker run --rm "${AIWS_SERVER_IMAGE}" generate-runner-control-secret)"

api_token="$(printf '%s\n' "${api_credentials}" | sed -n 's/^AIWS_API_TOKEN=//p')"
api_token_hash="$(printf '%s\n' "${api_credentials}" | sed -n 's/^AIWS_API_TOKEN_HASH=//p')"
runner_token="$(printf '%s\n' "${runner_credentials}" | sed -n 's/^AIWS_RUNNER_TOKEN=//p')"
runner_token_hash="$(printf '%s\n' "${runner_credentials}" | sed -n 's/^AIWS_RUNNER_TOKEN_HASH=//p')"
runner_control_secret="$(printf '%s\n' "${runner_control}" | sed -n 's/^AIWS_RUNNER_CONTROL_SECRET=//p')"
notification_secret="$(printf '%s\n' "${notification_key}" | sed -n 's/^AIWS_NOTIFICATION_ENCRYPTION_KEY=//p')"

{
  printf 'AIWS_VERSION=%s\n' "${AIWS_VERSION}"
  printf 'AIWS_IMAGE_NAMESPACE=%s\n' "${AIWS_IMAGE_NAMESPACE}"
  printf 'AIWS_ENV=production\n'
  printf 'AIWS_PUBLIC_URL=%s\n' "${AIWS_PUBLIC_URL:-https://aiws.example.com}"
  printf 'AIWS_ALLOWED_REPO_ROOTS=%s\n' "${AIWS_ALLOWED_REPO_ROOTS:-[\"/srv/repos\"]}"
  printf 'AIWS_ADMIN_USERNAME=%s\n' "${AIWS_ADMIN_USERNAME:-admin}"
  printf "AIWS_ADMIN_PASSWORD_HASH='%s'\n" "${password_hash}"
  printf 'AIWS_SESSION_SECRET=%s\n' "${session_secret}"
  printf 'AIWS_NOTIFICATION_ENCRYPTION_KEY=%s\n' "${notification_secret}"
  printf 'AIWS_API_TOKEN_HASH=%s\n' "${api_token_hash}"
  printf 'AIWS_RUNNER_TOKEN=%s\n' "${runner_token}"
  printf 'AIWS_RUNNER_TOKEN_HASH=%s\n' "${runner_token_hash}"
  printf 'AIWS_RUNNER_CONTROL_SECRET=%s\n' "${runner_control_secret}"
  printf 'AIWS_GITHUB_APP_ID=%s\n' "${AIWS_GITHUB_APP_ID:-replace-with-github-app-id}"
  printf 'AIWS_GITHUB_APP_SLUG=%s\n' "${AIWS_GITHUB_APP_SLUG:-replace-with-github-app-slug}"
  printf 'AIWS_GITHUB_PRIVATE_KEY_BASE64=%s\n' "${AIWS_GITHUB_PRIVATE_KEY_BASE64:-replace-with-base64-pem-private-key}"
  printf 'AIWS_REPO_ROOT=%s\n' "${AIWS_REPO_ROOT:-/srv/repos}"
  printf 'AIWS_PORT=%s\n' "${AIWS_PORT:-3000}"
  printf 'AIWS_DOCKER_NETWORK=%s\n' "${AIWS_DOCKER_NETWORK:-aiws-runtime}"
  printf 'AIWS_REPOSITORIES_VOLUME=%s\n' "${AIWS_REPOSITORIES_VOLUME:-aiws-repositories}"
  printf 'AIWS_WORKSPACES_VOLUME=%s\n' "${AIWS_WORKSPACES_VOLUME:-aiws-workspaces}"
  printf 'AIWS_CODEX_AUTH_VOLUME=%s\n' "${AIWS_CODEX_AUTH_VOLUME:-aiws-codex-auth}"
} >.env

printf '%s\n' "${api_token}" >aiws-api-token
chmod 0600 .env aiws-api-token

echo "Created .env and aiws-api-token with mode 0600."
echo "Install the CLI, run 'aiws config set --system --url URL --token-stdin < aiws-api-token', then securely remove aiws-api-token."
