#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/profile-env.sh"

# Use an enrolled fingerprint on a disposable emulator. Authentication stays in
# Android's genuine BiometricPrompt and SecureStore paths.
serial=${MAESTRO_DEVICE:-${ANDROID_SERIAL:-}}
if [[ -z "$serial" || "$serial" != emulator-* ]]; then
    echo 'Set MAESTRO_DEVICE to a disposable Android emulator serial.' >&2
    exit 2
fi
if [[ -n "${CRYPTEX_E2E_PROTECTED_DEVICE:-}" && "$serial" == "$CRYPTEX_E2E_PROTECTED_DEVICE" ]]; then
    echo "Refusing to touch protected emulator $serial." >&2
    exit 2
fi
if [[ $# -lt 1 ]]; then
    echo 'Usage: MAESTRO_DEVICE=emulator-N run-biometric-flow.sh <maestro test arguments>' >&2
    exit 2
fi
adb -s "$serial" get-state >/dev/null
if ! adb -s "$serial" shell dumpsys fingerprint | rg -q '"count"\s*:\s*[1-9][0-9]*'; then
    echo "Enroll a genuine emulator fingerprint on $serial before running this suite." >&2
    exit 2
fi
finger_id=${CRYPTEX_E2E_FINGER_ID:-1}
if [[ ! "$finger_id" =~ ^[0-9]+$ ]]; then
    echo 'CRYPTEX_E2E_FINGER_ID must be a numeric enrolled fingerprint ID.' >&2
    exit 2
fi
(
    while true; do
        adb -s "$serial" emu finger touch "$finger_id" >/dev/null 2>&1 || exit
        sleep 1
    done
) &
finger_pid=$!
trap 'kill "$finger_pid" 2>/dev/null || true; wait "$finger_pid" 2>/dev/null || true' EXIT INT TERM
maestro --device "$serial" test "${maestro_profile_args[@]}" "$@"
