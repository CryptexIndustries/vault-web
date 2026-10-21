#!/usr/bin/env bash
# Builds the cryptex-agent release tarball, the same way in CI and locally:
#
#   services/cmd/cryptex-agent/package.sh VERSION ARCH OUTDIR
#
# VERSION has no leading v (0.1.0, 0.1.0-rc1); ARCH is a GOARCH (amd64 or
# arm64). Writes OUTDIR/cryptex-agent-VERSION-linux-ARCH.tar.gz with one
# folder of the same name: cryptex-agent, cryptex-agent.service, README.md
# and LICENSE.
set -euo pipefail

if [ "$#" -ne 3 ]; then
	echo "usage: $0 VERSION ARCH OUTDIR" >&2
	exit 2
fi
version=$1
arch=$2
outdir=$3

if ! [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
	echo "VERSION must look like 0.1.0 or 0.1.0-rc1, without a leading v" >&2
	exit 2
fi
case $arch in
amd64 | arm64) ;;
*)
	echo "ARCH must be amd64 or arm64" >&2
	exit 2
	;;
esac

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
services=$(cd "$here/../.." && pwd)
repo=$(cd "$services/.." && pwd)
mkdir -p "$outdir"
outdir=$(cd "$outdir" && pwd)

name=cryptex-agent-$version-linux-$arch
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/$name"

# Static, so one tarball runs on any distribution.
(cd "$services" && CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath \
	-ldflags="-s -w -X main.version=$version" \
	-o "$stage/$name/cryptex-agent" ./cmd/cryptex-agent)
cp "$here/cryptex-agent.service" "$here/README.md" "$stage/$name/"
cp "$repo/LICENSE.md" "$stage/$name/LICENSE"
chmod 0755 "$stage/$name/cryptex-agent"
chmod 0644 "$stage/$name/cryptex-agent.service" "$stage/$name/README.md" "$stage/$name/LICENSE"

# Fixed owner, order and timestamps so rebuilding a tag gives the same
# archive layout.
mtime=${SOURCE_DATE_EPOCH:-$(date +%s)}
tar -C "$stage" --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$mtime" -cf - "$name" |
	gzip -9n >"$outdir/$name.tar.gz"
echo "$outdir/$name.tar.gz"
