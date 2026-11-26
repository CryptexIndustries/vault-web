#!/usr/bin/env bash
# Writes the source archive addons.mozilla.org reviewers rebuild the Firefox
# add-on from: the extension, the workspace code it imports and the install
# files at HEAD, under cryptex-vault-source/ with BUILD-INSTRUCTIONS.md.
#
# Usage: extension/scripts/source-archive.sh <output.zip>
set -euo pipefail

output="$(realpath -m "$1")"
cd "$(git rev-parse --show-toplevel)"

staging="$(mktemp -d)"
trap 'rm -rf "${staging}"' EXIT

git archive --prefix=cryptex-vault-source/ HEAD -- \
    extension web packages patches scripts/install-lefthook.mjs \
    LICENSE.md .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json \
    ':(exclude,glob)**/tests/**' ':(exclude,glob)**/e2e/**' ':(exclude,glob)**/*.test.*' \
    ':(exclude,glob)**/.env*' ':(exclude,glob)**/*Dockerfile' \
    ':(exclude)extension/docs' ':(exclude)extension/amo' ':(exclude)web/docs' \
    ':(exclude)web/public/images' ':(exclude)web/threat-model.md' |
    tar -x -C "${staging}"

sed -e "s/@VERSION@/$(jq -r .version extension/manifest.json)/" -e "s/@COMMIT@/$(git rev-parse HEAD)/" \
    extension/amo/BUILD-INSTRUCTIONS.md > "${staging}/cryptex-vault-source/BUILD-INSTRUCTIONS.md"

rm -f "${output}"
(cd "${staging}" && zip -X -q -r "${output}" cryptex-vault-source)
