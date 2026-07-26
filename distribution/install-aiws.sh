#!/bin/sh
set -eu

REPOSITORY="${AIWS_GITHUB_REPOSITORY:-__AIWS_GITHUB_REPOSITORY__}"
VERSION="${AIWS_VERSION:-0.8.0}"
BASE_URL="${AIWS_RELEASE_BASE_URL:-https://github.com/${REPOSITORY}/releases/download/v${VERSION}}"

if [ "$(uname -s)" != "Linux" ]; then
  echo "This installer supports Linux only." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64 | amd64) target="linux-x64" ;;
  aarch64 | arm64) target="linux-arm64" ;;
  *)
    echo "Unsupported Linux architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT HUP INT TERM
asset="aiws-${target}.tar.gz"

curl --fail --location --proto '=https' --tlsv1.2 \
  --output "${work_dir}/${asset}" "${BASE_URL}/${asset}"
curl --fail --location --proto '=https' --tlsv1.2 \
  --output "${work_dir}/SHA256SUMS" "${BASE_URL}/SHA256SUMS"

(
  cd "${work_dir}"
  checksum_line="$(grep "  ${asset}\$" SHA256SUMS || true)"
  if [ -z "${checksum_line}" ]; then
    echo "Release checksum is missing for ${asset}." >&2
    exit 1
  fi
  printf '%s\n' "${checksum_line}" | sha256sum --check -
  mkdir extracted
  tar -xzf "${asset}" -C extracted
)

if ! getent group aiws-agents >/dev/null 2>&1; then
  groupadd --system aiws-agents
fi

install -d -o root -g aiws-agents -m 0750 /etc/aiws
install -o root -g root -m 0755 "${work_dir}/extracted/aiws" \
  "/usr/local/bin/.aiws.$$.tmp"
mv -f "/usr/local/bin/.aiws.$$.tmp" /usr/local/bin/aiws

/usr/local/bin/aiws --version
echo "Installed AIWS CLI. Existing configuration was preserved."
