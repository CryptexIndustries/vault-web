#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/profile-env.sh"

: "${MAESTRO_DEVICE:?Set MAESTRO_DEVICE to the headed Android emulator serial.}"

if [[ -n "${CRYPTEX_E2E_PROTECTED_DEVICE:-}" && "$MAESTRO_DEVICE" == "$CRYPTEX_E2E_PROTECTED_DEVICE" ]]; then
  echo "Refusing to touch protected device $MAESTRO_DEVICE." >&2
  exit 2
fi

results_dir="$(dirname "$0")/results"
flows_dir="$(dirname "$0")/flows"
phases=(
  accessibility-fallback-01-setup-browser.yaml
  accessibility-fallback-02-browser-native-unmatched.yaml
  accessibility-fallback-03-remember-app.yaml
  accessibility-fallback-04-exact-app.yaml
  accessibility-fallback-05-totp-registration.yaml
  accessibility-fallback-06-save-update.yaml
  accessibility-fallback-07-update-lock.yaml
  accessibility-fallback-08-unlock-result.yaml
  accessibility-fallback-09-native-cancel.yaml
  accessibility-fallback-10-native-cancel-result.yaml
  accessibility-fallback-11-frame-cancel.yaml
  accessibility-fallback-12-frame-cancel-result.yaml
  accessibility-fallback-13-frame-fill-result.yaml
  accessibility-fallback-14-warm-otp.yaml
  accessibility-fallback-15-warm-otp-result.yaml
)
actions=(fill fill fill fill save save fill none fill none fill fill none fill none)
focus_points=(
  "486 613"
  "540 207"
  "540 207"
  "540 443"
  "540 561"
  "540 561"
  "540 207"
  "0 0"
  "540 207"
  "0 0"
  "540 613"
  "540 613"
  "0 0"
  "540 443"
  "0 0"
)
if (( ${#actions[@]} != ${#phases[@]} || ${#focus_points[@]} != ${#phases[@]} )); then
  echo "Accessibility phases, actions, and focus points must have equal counts." >&2
  exit 1
fi
start_phase="${ACCESSIBILITY_E2E_START_PHASE:-1}"
end_phase="${ACCESSIBILITY_E2E_END_PHASE:-${#phases[@]}}"
if [[ ! "$start_phase" =~ ^[0-9]+$ || ! "$end_phase" =~ ^[0-9]+$ ]] ||
  (( start_phase < 1 || end_phase > ${#phases[@]} || start_phase > end_phase )); then
  echo "Choose an accessibility phase range between 1 and ${#phases[@]}." >&2
  exit 1
fi
if (( start_phase > 1 )); then
  echo "Resuming at phase $start_phase; this requires state left by the preceding phases." >&2
fi
read -r display_width display_height < <(
  adb -s "$MAESTRO_DEVICE" shell wm size |
    sed -n 's/.*size: \([0-9][0-9]*\)x\([0-9][0-9]*\).*/\1 \2/p' |
    tail -n 1
)

if [[ -z "${display_width:-}" || -z "${display_height:-}" ]]; then
  echo "Unable to read the emulator display size." >&2
  exit 1
fi

scale_x() {
  echo $(( $1 * display_width / 1080 ))
}

scale_y() {
  echo $(( $1 * display_height / 2400 ))
}

wait_for_overlay() {
  local title_pattern="$1"
  local state
  for _ in $(seq 1 80); do
    state="$(adb -s "$MAESTRO_DEVICE" shell dumpsys accessibility 2>/dev/null || true)"
    if grep -q "title=${title_pattern}.*type=TYPE_ACCESSIBILITY_OVERLAY" <<<"$state"; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for the Cryptex Vault accessibility overlay." >&2
  return 1
}

focus_until_overlay() {
  local focus_x="$1"
  local focus_y="$2"
  local state
  sleep 1
  for _ in $(seq 1 30); do
    state="$(adb -s "$MAESTRO_DEVICE" shell dumpsys accessibility 2>/dev/null || true)"
    if grep -q 'title=null.*type=TYPE_ACCESSIBILITY_OVERLAY' <<<"$state"; then
      return 0
    fi
    adb -s "$MAESTRO_DEVICE" shell input tap \
      "$(scale_x "$focus_x")" "$(scale_y "$focus_y")"
    for _ in $(seq 1 8); do
      state="$(adb -s "$MAESTRO_DEVICE" shell dumpsys accessibility 2>/dev/null || true)"
      if grep -q 'title=null.*type=TYPE_ACCESSIBILITY_OVERLAY' <<<"$state"; then
        return 0
      fi
      sleep 0.25
    done
  done
  echo "Timed out waiting for the Cryptex Vault accessibility action." >&2
  return 1
}

wait_for_foreground_package() {
  local expected_package="$1"
  local state
  for _ in $(seq 1 120); do
    state="$(adb -s "$MAESTRO_DEVICE" shell dumpsys window 2>/dev/null || true)"
    if grep -q "mFocusedApp=.*${expected_package}" <<<"$state"; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for ${expected_package}." >&2
  return 1
}

complete_exact_app_fill() {
  wait_for_foreground_package "$CRYPTEX_APP_ID"
  wait_for_ui_text 'Choose a login'
  wait_for_ui_text 'Fixture Login'
  tap_ui_text 'Fixture Login'
  assert_review_of_fixture_login
  tap_ui_text 'Fill once'
  wait_for_foreground_package com.cryptex.autofillfixture
}

complete_browser_fill() {
  local ui
  wait_for_foreground_package "$CRYPTEX_APP_ID"
  wait_for_ui_text 'Choose a login'
  ui="$(read_ui_xml)"
  # A scheme-less browser address requires looking outside destination matches.
  if ! grep -q 'text="Fixture Login"' <<<"$ui"; then
    wait_for_ui_text 'Show all \([0-9]+\)'
    tap_ui_text 'Show all \([0-9]+\)'
  fi
  wait_for_ui_text 'Fixture Login'
  tap_ui_text 'Fixture Login'
  assert_review_of_fixture_login
  tap_ui_text 'Fill once'
  wait_for_foreground_package com.android.chrome
}

complete_unmatched_app_fill() {
  wait_for_foreground_package "$CRYPTEX_APP_ID"
  # The keyboard can move the picker, so use its visible labels instead of coordinates.
  tap_ui_text 'Show all \([0-9]+\)'
  tap_ui_text 'Fixture Login'
  assert_review_of_fixture_login
  tap_ui_text 'Fill and associate app'
  tap_ui_text 'Add this exact app package'
  tap_ui_text 'Save association and fill'
  wait_for_foreground_package com.cryptex.autofillfixture
}

complete_locked_app_fill() {
  wait_for_foreground_package "$CRYPTEX_APP_ID"
  sleep 1
  adb -s "$MAESTRO_DEVICE" shell input tap "$(scale_x 540)" "$(scale_y 1100)"
  adb -s "$MAESTRO_DEVICE" shell input text CorrectHorseBatteryStaple42
  adb -s "$MAESTRO_DEVICE" shell input tap "$(scale_x 540)" "$(scale_y 1310)"
  # The unlock activity and picker share a package, so foreground-package
  # readiness alone cannot show that the pending request has refreshed.
  wait_for_ui_text 'Choose a login'
  wait_for_ui_text 'Fixture Login'
  tap_ui_text 'Fixture Login'
  assert_review_of_fixture_login
  tap_ui_text 'Fill once'
  wait_for_foreground_package com.cryptex.autofillfixture
}

cancel_current_request() {
  wait_for_foreground_package "$CRYPTEX_APP_ID"
  adb -s "$MAESTRO_DEVICE" shell input keyevent KEYCODE_BACK
}

assert_login_picker() {
  wait_for_foreground_package "$CRYPTEX_APP_ID"
  maestro test "${maestro_profile_args[@]}" --device "$MAESTRO_DEVICE" "$flows_dir/accessibility-fallback-picker-check.yaml"
}

read_ui_xml() {
  if ! adb -s "$MAESTRO_DEVICE" shell uiautomator dump /sdcard/cryptex-accessibility-picker.xml >/dev/null; then
    return 1
  fi
  adb -s "$MAESTRO_DEVICE" shell cat /sdcard/cryptex-accessibility-picker.xml
}

wait_for_ui_text() {
  local pattern="$1" ui
  for _ in $(seq 1 12); do
    ui="$(read_ui_xml || true)"
    if grep -Eq "text=\"${pattern}\"" <<<"$ui"; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for the '${pattern}' control." >&2
  return 1
}

tap_ui_text() {
  local pattern="$1" ui row_bounds left top right bottom
  ui="$(read_ui_xml)"
  row_bounds="$(
    grep -Eo "text=\"${pattern}\"[^>]*" <<<"$ui" |
      sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' |
      head -n 1 || true
  )"
  if [[ -z "$row_bounds" ]]; then
    echo "Could not identify the '${pattern}' control in the current screen." >&2
    return 1
  fi
  read -r left top right bottom <<<"$row_bounds"
  adb -s "$MAESTRO_DEVICE" shell input tap \
    "$(( (left + right) / 2 ))" "$(( (top + bottom) / 2 ))"
}

assert_review_of_fixture_login() {
  local ui
  ui="$(read_ui_xml)"
  if ! grep -q 'text="Review destination"' <<<"$ui" ||
    ! grep -q 'text="Fixture Login"' <<<"$ui" ||
    ! grep -q 'text="fixture@example.test"' <<<"$ui"; then
    echo "Fixture Login was not selected for destination review." >&2
    return 1
  fi
}

complete_totp_only_fill() {
  wait_for_foreground_package "$CRYPTEX_APP_ID"
  tap_ui_text 'Fixture Login'
  assert_review_of_fixture_login
  tap_ui_text 'Fill once'
  wait_for_foreground_package com.cryptex.autofillfixture
}

mkdir -p "$results_dir"
for phase_index in "${!phases[@]}"; do
  phase_number=$(( phase_index + 1 ))
  if (( phase_number < start_phase || phase_number > end_phase )); then
    continue
  fi
  printf -v report '%s/autofill-accessibility-%02d.xml' "$results_dir" "$phase_number"
  maestro test "${maestro_profile_args[@]}" \
    --device "$MAESTRO_DEVICE" \
    --format junit \
    --output "$report" \
    "$flows_dir/${phases[phase_index]}"

  action="${actions[phase_index]}"
  if [[ "$action" == none ]]; then
    continue
  fi

  read -r focus_x focus_y <<<"${focus_points[phase_index]}"
  echo "[accessibility driver] action $phase_number/${#actions[@]}: $action"
  focus_until_overlay "$focus_x" "$focus_y"
  echo "[accessibility driver] action $phase_number: button detected"
  adb -s "$MAESTRO_DEVICE" shell input tap "$(scale_x 918)" "$(scale_y 288)"
  wait_for_overlay "$CRYPTEX_APP_NAME"
  echo "[accessibility driver] action $phase_number: dialog detected"
  sleep 0.5
  if [[ "$action" == "fill" ]]; then
    choice_y=1180
  else
    choice_y=1400
  fi
  adb -s "$MAESTRO_DEVICE" shell input tap "$(scale_x 540)" "$(scale_y "$choice_y")"
  echo "[accessibility driver] action $phase_number: choice pressed"
  if [[ "$phase_number" == 4 ]]; then
    assert_login_picker
  fi
  if [[ "$phase_number" == 11 ]]; then
    maestro test "${maestro_profile_args[@]}" --device "$MAESTRO_DEVICE" "$flows_dir/accessibility-fallback-frame-warning-check.yaml"
  fi
  case "$phase_number" in
    1) complete_browser_fill ;;
    2) complete_unmatched_app_fill ;;
    3|4) complete_exact_app_fill ;;
    14) complete_totp_only_fill ;;
    5|6) wait_for_foreground_package "$CRYPTEX_APP_ID" ;;
    7) complete_locked_app_fill ;;
    9) cancel_current_request; wait_for_foreground_package com.cryptex.autofillfixture ;;
    11) cancel_current_request; wait_for_foreground_package com.android.chrome ;;
    12) complete_browser_fill ;;
    *) sleep 1 ;;
  esac
done
