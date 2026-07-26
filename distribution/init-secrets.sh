#!/bin/sh
set -e

umask 077

if [ -e .env ]; then
  echo "Refusing to overwrite .env." >&2
  exit 1
fi

: "${AIWS_IMAGE_NAMESPACE:?Set AIWS_IMAGE_NAMESPACE, for example ghcr.io/almaro90}"

require_non_empty() {
  variable_name="$1"
  variable_value="$2"
  if [ -z "${variable_value}" ]; then
    printf 'Required environment variable %s is missing or empty.\n' "${variable_name}" >&2
    exit 1
  fi
}

require_non_empty AIWS_PUBLIC_URL "${AIWS_PUBLIC_URL}"
require_non_empty AIWS_ALLOWED_REPO_ROOTS "${AIWS_ALLOWED_REPO_ROOTS}"
require_non_empty AIWS_REPO_ROOT "${AIWS_REPO_ROOT}"
require_non_empty AIWS_ADMIN_USERNAME "${AIWS_ADMIN_USERNAME}"

set -u

AIWS_VERSION="${AIWS_VERSION:-0.8.0}"
AIWS_SERVER_IMAGE="${AIWS_IMAGE_NAMESPACE}/aiws:${AIWS_VERSION}"

github_count=0
azure_count=0
for value in "${AIWS_GITHUB_APP_ID:-}" "${AIWS_GITHUB_APP_SLUG:-}" "${AIWS_GITHUB_PRIVATE_KEY_BASE64:-}"; do
  [ -z "${value}" ] || github_count=$((github_count + 1))
done
for value in "${AIWS_AZURE_DEVOPS_CLIENT_ID:-}" "${AIWS_AZURE_DEVOPS_CLIENT_SECRET:-}" "${AIWS_CONNECTION_ENCRYPTION_KEY:-}"; do
  [ -z "${value}" ] || azure_count=$((azure_count + 1))
done
if [ "${github_count}" -ne 0 ] && [ "${github_count}" -ne 3 ]; then
  echo "GitHub requires AIWS_GITHUB_APP_ID, AIWS_GITHUB_APP_SLUG and AIWS_GITHUB_PRIVATE_KEY_BASE64 together." >&2
  exit 1
fi
if [ "${azure_count}" -ne 0 ] && [ "${azure_count}" -ne 3 ]; then
  echo "Azure DevOps requires AIWS_AZURE_DEVOPS_CLIENT_ID, AIWS_AZURE_DEVOPS_CLIENT_SECRET and AIWS_CONNECTION_ENCRYPTION_KEY together." >&2
  exit 1
fi

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
  printf 'AIWS_PUBLIC_URL=%s\n' "${AIWS_PUBLIC_URL}"
  printf 'AIWS_ALLOWED_REPO_ROOTS=%s\n' "${AIWS_ALLOWED_REPO_ROOTS}"
  printf 'AIWS_ADMIN_USERNAME=%s\n' "${AIWS_ADMIN_USERNAME}"
  printf "AIWS_ADMIN_PASSWORD_HASH='%s'\n" "${password_hash}"
  printf 'AIWS_SESSION_SECRET=%s\n' "${session_secret}"
  printf 'AIWS_NOTIFICATION_ENCRYPTION_KEY=%s\n' "${notification_secret}"
  printf 'AIWS_API_TOKEN_HASH=%s\n' "${api_token_hash}"
  printf 'AIWS_RUNNER_TOKEN=%s\n' "${runner_token}"
  printf 'AIWS_RUNNER_TOKEN_HASH=%s\n' "${runner_token_hash}"
  printf 'AIWS_RUNNER_CONTROL_SECRET=%s\n' "${runner_control_secret}"
  if [ "${github_count}" -eq 3 ]; then
    printf 'AIWS_GITHUB_APP_ID=%s\n' "${AIWS_GITHUB_APP_ID}"
    printf 'AIWS_GITHUB_APP_SLUG=%s\n' "${AIWS_GITHUB_APP_SLUG}"
    printf 'AIWS_GITHUB_PRIVATE_KEY_BASE64=%s\n' "${AIWS_GITHUB_PRIVATE_KEY_BASE64}"
  fi
  if [ "${azure_count}" -eq 3 ]; then
    printf 'AIWS_AZURE_DEVOPS_CLIENT_ID=%s\n' "${AIWS_AZURE_DEVOPS_CLIENT_ID}"
    printf 'AIWS_AZURE_DEVOPS_CLIENT_SECRET=%s\n' "${AIWS_AZURE_DEVOPS_CLIENT_SECRET}"
    printf 'AIWS_CONNECTION_ENCRYPTION_KEY=%s\n' "${AIWS_CONNECTION_ENCRYPTION_KEY}"
  fi
  printf 'AIWS_REPO_ROOT=%s\n' "${AIWS_REPO_ROOT}"
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
