#!/usr/bin/env bash
set -euo pipefail
adb wait-for-device
adb reverse tcp:18081 tcp:18081
adb install -r admin-android/app/build/outputs/apk/debug/app-debug.apk
adb install -r admin-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# The short-lived CI-only credential is passed at runtime, never compiled into APK.
operator="$(cat "$RUNNER_TEMP/ventry-admin-token")"
adb shell am instrument -w -e origin http://127.0.0.1:18081 -e operator "$operator" \
    dev.ventry.admin.staging.test/androidx.test.runner.AndroidJUnitRunner | tee "$RUNNER_TEMP/ventry-admin-instrumentation.txt"
grep -Eq 'OK \(2 tests\)' "$RUNNER_TEMP/ventry-admin-instrumentation.txt"
echo VENTRY_ADMIN_REAL_API_EMULATOR_PASS
