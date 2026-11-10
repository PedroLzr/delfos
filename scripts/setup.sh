#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo '.env ya existe; no se ha modificado.'
  exit 0
fi
umask 077
password=$(openssl rand -hex 32)
sed "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$password/" .env.example > .env
echo '.env creado con una contraseña aleatoria. Configura PUBLIC_ORIGIN para tu VPS.'
