#!/usr/bin/env bash
# Creates the draft GitHub release for the component tag being built, such as
# web-v1.2.3. The notes are RELEASE_INTRO, the "## 1.2.3" section of the
# component's CHANGELOG.md, RELEASE_OUTRO, and a compare link to the previous
# tag of the same component.
#
# Usage: draft-release.sh <title> <changelog> [asset...]
# Runs in GitHub Actions with GH_TOKEN set.
set -euo pipefail

title="$1"
changelog="$2"
shift 2

tag="${GITHUB_REF_NAME}"
prefix="${tag%%-v[0-9]*}-v"
version="${tag#"${prefix}"}"

# The lines under "## <version>", up to the next version.
section="$(awk -v v="${version}" '$1 == "##" { if (found) exit; found = $2 == v; next } found' "${changelog}" | sed '/./,$!d')"
if [[ -z "${section//[[:space:]]/}" ]]; then
    echo "${changelog} has no entries under ## ${version}" >&2
    exit 1
fi

tags="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/git/matching-refs/tags/${prefix}" --jq '.[].ref | ltrimstr("refs/tags/")')"
# Compare against the previous final release. sort -V would also put
# 1.2.3-rc1 after 1.2.3.
previous="$({ grep -E "^${prefix}[0-9]+\.[0-9]+\.[0-9]+$" <<<"${tags}" || true; echo "${tag}"; } |
    sort -uV | grep -Fx -B1 -- "${tag}" | grep -Fxv -- "${tag}" || true)"

notes="$(mktemp)"
{
    if [[ -n "${RELEASE_INTRO:-}" ]]; then printf '%s\n\n' "${RELEASE_INTRO}"; fi
    printf '%s\n' "${section}"
    if [[ -n "${RELEASE_OUTRO:-}" ]]; then printf '\n%s\n' "${RELEASE_OUTRO}"; fi
    if [[ -n "${previous}" ]]; then
        printf '\n**Full Changelog**: %s/%s/compare/%s...%s\n' "${GITHUB_SERVER_URL}" "${GITHUB_REPOSITORY}" "${previous}" "${tag}"
    fi
} > "${notes}"

prerelease=()
if [[ "${version}" == *-* ]]; then prerelease=(--prerelease); fi
gh release create "${tag}" \
    --repo "${GITHUB_REPOSITORY}" \
    --draft "${prerelease[@]}" \
    --verify-tag \
    --title "${title}" \
    --notes-file "${notes}" \
    -- "$@"
