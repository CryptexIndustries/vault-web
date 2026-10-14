#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/profile-env.sh"

if [[ -z "${MAESTRO_DEVICE:-}" ]]; then
    echo "Set MAESTRO_DEVICE to the Android emulator ID." >&2
    exit 2
fi

if [[ -n "${CRYPTEX_E2E_PROTECTED_DEVICE:-}" && "$MAESTRO_DEVICE" == "$CRYPTEX_E2E_PROTECTED_DEVICE" ]]; then
    echo "Refusing to touch protected device $MAESTRO_DEVICE." >&2
    exit 2
fi

cd "$(dirname "$0")/.."
mkdir -p e2e/results

maestro --device "$MAESTRO_DEVICE" test "${maestro_profile_args[@]}" --format junit \
    --output e2e/results/provider-auto-lock-prepare.xml \
    e2e/flows/provider-auto-lock-prepare.yaml

# Keep the fixture foregrounded; do not resume the vault before requesting.
sleep 67

maestro --device "$MAESTRO_DEVICE" test "${maestro_profile_args[@]}" --format junit \
    --output e2e/results/provider-auto-lock-verify.xml \
    e2e/flows/provider-auto-lock-verify.yaml

maestro --device "$MAESTRO_DEVICE" test "${maestro_profile_args[@]}" --format junit \
    --output e2e/results/provider-auto-lock-fresh-request.xml \
    e2e/flows/provider-auto-lock-fresh-request.yaml
