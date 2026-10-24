#!/bin/bash
set -eu
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
node24="${HOME}/.nvm/versions/node/v24.22.0/bin/node"
if [[ ! -x "$node24" ]]; then
    node24="$(command -v node || true)"
fi
if [[ -z "$node24" || "$("$node24" -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
    echo 'Se requiere Node.js 24 instalado; no se cambia el Node global.' >&2
    exit 1
fi
cd -- "$root"
exec "$node24" "$root/api/scripts/entorno-web.cjs" "${@:-estado}"
