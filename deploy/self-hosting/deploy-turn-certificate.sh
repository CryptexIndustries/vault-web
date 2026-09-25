#!/bin/sh
# Install this root-owned file in Certbot's renewal-hooks/deploy directory.
# Only the dedicated TURN lineage is copied; other certificates are ignored.
set -eu

[ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/cryptex-turn" ] || exit 0
[ "$(id -u)" -eq 0 ] || { echo "Run this hook as root." >&2; exit 1; }

certificate_dir=/etc/cryptex-turn/tls
# The guide creates this root-owned directory with coturn's numeric group.
certificate_group=$(stat -c '%g' "$certificate_dir")
# Copy both files successfully before replacing either live file. Renaming each
# staged file also prevents coturn from reading a partially written PEM file.
staging_dir=$(mktemp -d "$certificate_dir/.renewal.XXXXXX")
cleanup() {
    rm -f "$staging_dir/fullchain.pem" "$staging_dir/privkey.pem"
    rmdir "$staging_dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
install -o root -g "$certificate_group" -m 0640 \
    "$RENEWED_LINEAGE/fullchain.pem" "$staging_dir/fullchain.pem"
install -o root -g "$certificate_group" -m 0640 \
    "$RENEWED_LINEAGE/privkey.pem" "$staging_dir/privkey.pem"
mv -f "$staging_dir/fullchain.pem" "$certificate_dir/fullchain.pem"
mv -f "$staging_dir/privkey.pem" "$certificate_dir/privkey.pem"

# Reload certificates without restarting coturn or closing existing connections.
# On initial issuance coturn is not running yet, so no signal is needed.
# Keep this assignment separate so a Docker failure makes the hook fail too.
container_ids=$(docker ps -q \
    --filter label=com.docker.compose.project=cryptex-self-hosted \
    --filter label=com.docker.compose.service=coturn)
for container_id in $container_ids; do
    docker kill --signal=SIGUSR2 "$container_id" >/dev/null
done
