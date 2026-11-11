#!/usr/bin/env bash
set -euo pipefail
# An absolute path lets profile-env.sh require its config by path.
source "$(cd "$(dirname "$0")" && pwd)/profile-env.sh"

# Use an enrolled biometric on a disposable emulator or Simulator. Authentication
# stays in the platform's genuine prompt and SecureStore paths.
serial=${MAESTRO_DEVICE:-${ANDROID_SERIAL:-}}
if [[ "$serial" =~ ^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$ ]]; then
    platform=ios
elif [[ "$serial" == emulator-* ]]; then
    platform=android
else
    echo 'Set MAESTRO_DEVICE to a disposable Android emulator serial or iOS Simulator UDID.' >&2
    exit 2
fi
if [[ -n "${CRYPTEX_E2E_PROTECTED_DEVICE:-}" && "$serial" == "$CRYPTEX_E2E_PROTECTED_DEVICE" ]]; then
    echo "Refusing to touch protected emulator $serial." >&2
    exit 2
fi
if [[ $# -lt 1 ]]; then
    echo 'Usage: MAESTRO_DEVICE=<emulator serial or Simulator UDID> run-biometric-flow.sh <maestro test arguments>' >&2
    exit 2
fi
if [[ "$platform" == ios ]]; then
    xcrun simctl spawn "$serial" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
    xcrun simctl spawn "$serial" notifyutil -p com.apple.BiometricKit.enrollmentChanged
    supply_biometric() {
        xcrun simctl spawn "$serial" notifyutil -p com.apple.BiometricKit_Sim.pearl.match
    }
else
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
    supply_biometric() {
        adb -s "$serial" emu finger touch "$finger_id"
    }
fi
(
    while true; do
        supply_biometric >/dev/null 2>&1 || exit
        sleep 1
    done
) &
finger_pid=$!
trap 'kill "$finger_pid" 2>/dev/null || true; wait "$finger_pid" 2>/dev/null || true' EXIT INT TERM
maestro --device "$serial" test "${maestro_profile_args[@]}" "$@"
