#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/profile-env.sh"
serial=${MAESTRO_DEVICE:-${ANDROID_SERIAL:-}}
if [[ -z "$serial" || "$serial" != emulator-* ]]; then
    echo 'Set MAESTRO_DEVICE to a disposable Android emulator serial.' >&2
    exit 2
fi
if [[ -n "${CRYPTEX_E2E_PROTECTED_DEVICE:-}" && "$serial" == "$CRYPTEX_E2E_PROTECTED_DEVICE" ]]; then
    echo "Refusing to touch protected emulator $serial." >&2
    exit 2
fi
if adb -s "$serial" shell dumpsys fingerprint | rg -q '"count"\s*:\s*[1-9][0-9]*'; then
    echo "Fingerprint already enrolled on $serial."
    exit 0
fi
pin=${CRYPTEX_E2E_DEVICE_PIN:-123456}
if [[ ! "$pin" =~ ^[0-9]{6,}$ ]]; then
    echo 'CRYPTEX_E2E_DEVICE_PIN must have at least six digits.' >&2
    exit 2
fi
# Preserve an existing PIN. Fail rather than replacing an unknown credential.
if ! adb -s "$serial" shell locksettings verify --old "$pin" >/dev/null 2>&1; then
    adb -s "$serial" shell locksettings set-pin "$pin"
fi
adb -s "$serial" shell settings put secure show_ime_with_hard_keyboard 1
adb -s "$serial" shell svc power stayon true
adb -s "$serial" shell am start -a android.settings.FINGERPRINT_ENROLL
(
    for attempt in $(seq 1 90); do
        adb -s "$serial" emu finger touch 1 >/dev/null 2>&1 || exit
        sleep 1
    done
) &
finger_pid=$!
trap 'kill "$finger_pid" 2>/dev/null || true; wait "$finger_pid" 2>/dev/null || true' EXIT INT TERM
maestro --device "$serial" test "${maestro_profile_args[@]}" -e "CRYPTEX_E2E_DEVICE_PIN=$pin" \
    "$(dirname "$0")/flows/setup-emulator-fingerprint.yaml"
adb -s "$serial" shell dumpsys fingerprint | rg -q '"count"\s*:\s*[1-9][0-9]*'
