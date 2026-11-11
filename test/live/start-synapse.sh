#!/bin/bash
# Start a throwaway Synapse in Docker for the live tests (npm run test:live)
# and create the test users: bot, peer, alice and admin (a server admin), all
# with the password pass1234.
#
# Stop it with: docker rm -f nrmc-synapse-test
# Environment: SYNAPSE_PORT (default 18008), SYNAPSE_IMAGE.
set -euo pipefail

NAME=nrmc-synapse-test
PORT=${SYNAPSE_PORT:-18008}
IMAGE=${SYNAPSE_IMAGE:-matrixdotorg/synapse:latest}
DATA=$(mktemp -d)

docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run --rm -v "$DATA:/data" -e SYNAPSE_SERVER_NAME=localhost -e SYNAPSE_REPORT_STATS=no \
    -e UID="$(id -u)" -e GID="$(id -g)" "$IMAGE" generate >/dev/null

# No rate limits, and let any user publish rooms to the directory.
cat >> "$DATA/homeserver.yaml" <<'EOF'
rc_message: {per_second: 1000, burst_count: 1000}
rc_login: {address: {per_second: 1000, burst_count: 1000}, account: {per_second: 1000, burst_count: 1000}, failed_attempts: {per_second: 1000, burst_count: 1000}}
rc_joins: {local: {per_second: 1000, burst_count: 1000}}
rc_invites: {per_room: {per_second: 1000, burst_count: 1000}, per_user: {per_second: 1000, burst_count: 1000}}
room_list_publication_rules:
  - action: allow
EOF

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8008" -v "$DATA:/data" \
    -e UID="$(id -u)" -e GID="$(id -g)" "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$PORT/_matrix/client/versions" >/dev/null && break
    sleep 1
done

for user in bot peer alice admin; do
    admin=--no-admin
    [ "$user" = admin ] && admin=--admin
    docker exec "$NAME" register_new_matrix_user -c /data/homeserver.yaml -u "$user" -p pass1234 $admin http://localhost:8008 >/dev/null
done

echo "Synapse is running at http://127.0.0.1:$PORT (data in $DATA)"
