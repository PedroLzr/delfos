#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exists=$(docker compose exec -T postgres psql -U delfos -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='delfos_test'")
if [ "$exists" != '1' ]; then
  docker compose exec -T postgres createdb -U delfos delfos_test
fi
docker compose exec -T backend node --input-type=module < backend/test/integration.mjs
