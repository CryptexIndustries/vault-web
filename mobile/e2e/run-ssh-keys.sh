#!/usr/bin/env bash
# SSH key items: generate, import an encrypted key, copy the public key, save
# the private key with a passphrase and check that the saved file decrypts.
set -euo pipefail
# An absolute path lets profile-env.sh require its config by path.
source "$(cd "$(dirname "$0")" && pwd)/profile-env.sh"

if [[ -z "${MAESTRO_DEVICE:-}" ]]; then
    echo "Set MAESTRO_DEVICE to the Android emulator ID." >&2
    exit 2
fi

if [[ -n "${CRYPTEX_E2E_PROTECTED_DEVICE:-}" && "$MAESTRO_DEVICE" == "$CRYPTEX_E2E_PROTECTED_DEVICE" ]]; then
    echo "Refusing to touch protected device $MAESTRO_DEVICE." >&2
    exit 2
fi

command -v ssh-keygen >/dev/null || {
    echo "ssh-keygen is required to check the saved private key." >&2
    exit 2
}

cd "$(dirname "$0")/.."
mkdir -p e2e/results

fixtures=../packages/vault-core/src/tests/fixtures/ssh
key_name=ed25519-aes256-ctr.key
captured=e2e-export.cryx
adb_device=(adb -s "$MAESTRO_DEVICE")
work="$(mktemp -d)"
trap 'rm -rf "$work"; "${adb_device[@]}" shell rm -f "/sdcard/Download/$key_name" >/dev/null 2>&1 || true' EXIT

# The capture fixture saves shared files into Downloads; remove an older
# capture so MediaStore doesn't give the new one a suffixed name.
"${adb_device[@]}" shell content query --uri content://media/external/file \
    --projection _id:_display_name:relative_path 2>/dev/null |
    sed -n "s/.*_id=\([0-9]*\), _display_name=$captured, relative_path=Download\/$/\1/p" |
    while read -r id; do
        "${adb_device[@]}" shell content delete --uri "content://media/external/file/$id" >/dev/null
    done
"${adb_device[@]}" shell rm -f "/sdcard/Download/$captured"

"${adb_device[@]}" push "$fixtures/$key_name" "/sdcard/Download/$key_name" >/dev/null
"${adb_device[@]}" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d "file:///sdcard/Download/$key_name" >/dev/null

maestro --device "$MAESTRO_DEVICE" test "${maestro_profile_args[@]}" \
    -e "EXPORTED_FILE=$key_name" --format junit \
    --output e2e/results/ssh-keys.xml "$@" e2e/flows/ssh-keys.yaml

"${adb_device[@]}" pull "/sdcard/Download/$captured" "$work/id_key" >/dev/null
chmod 600 "$work/id_key"
if ssh-keygen -y -P "" -f "$work/id_key" >/dev/null 2>&1; then
    echo "The saved private key is not encrypted." >&2
    exit 1
fi
actual="$(ssh-keygen -y -P "export horse" -f "$work/id_key" | cut -d" " -f1,2)"
expected="$(cut -d" " -f1,2 "$fixtures/$key_name.pub")"
if [[ "$actual" != "$expected" ]]; then
    echo "The saved private key does not match the imported key." >&2
    exit 1
fi
echo "Saved private key decrypts to the imported key."
