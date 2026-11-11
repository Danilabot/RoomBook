#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077
temporary=$(mktemp .env.XXXXXXXX)
trap 'rm -f "$temporary"' EXIT
trap 'exit 1' HUP INT TERM

while IFS= read -r entry; do
  secret=$(openssl rand -hex 32)
  printf '%s=%s\n' "${entry%=}" "$secret"
done < .env.example > "$temporary"

if ! ln "$temporary" .env 2>/dev/null; then
  printf '%s\n' 'Cannot create .env. Any existing file was preserved.' >&2
  exit 1
fi
printf '%s\n' 'Created .env with mode 0600.'
