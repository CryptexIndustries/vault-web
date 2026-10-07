#!/usr/bin/env bash
# Source once before invoking Maestro; the registry owns both profile identities.
profile_values="$(node -e 'const {getProfile}=require(process.argv[1]); const p=getProfile(process.argv[2]); console.log([p.applicationId,p.scheme,p.displayName].join("\n"))' "$(dirname "${BASH_SOURCE[0]}")/../config/profiles.cjs" "${CRYPTEX_APP_PROFILE:-production}")"
mapfile -t profile_identity <<<"$profile_values"
export CRYPTEX_APP_ID="${profile_identity[0]}"
export CRYPTEX_APP_SCHEME="${profile_identity[1]}"
export CRYPTEX_APP_NAME="${profile_identity[2]}"
maestro_profile_args=(-e "CRYPTEX_APP_ID=$CRYPTEX_APP_ID" -e "CRYPTEX_APP_SCHEME=$CRYPTEX_APP_SCHEME" -e "CRYPTEX_APP_NAME=$CRYPTEX_APP_NAME")
