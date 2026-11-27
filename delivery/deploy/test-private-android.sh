#!/usr/bin/env bash
# CI-only; generated test master and public CA are never shipped in the APK.
set -euo pipefail
state="$1"
adb wait-for-device
adb reverse tcp:18443 tcp:18443
adb install -r admin-android/app/build/outputs/apk/debug/app-debug.apk
adb install -r admin-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
ca="$(openssl x509 -in "$state/tls/ca.pem" -outform DER | base64 -w0)"
key="$(cat "$state/secrets/admin-token")"
adb shell am instrument -w -e class dev.ventry.admin.PrivateTlsIntegrationTest -e ca "$ca" -e operator "$key" \
  dev.ventry.admin.staging.test/androidx.test.runner.AndroidJUnitRunner | tee "$RUNNER_TEMP/private-tls-test.txt"
grep -Eq 'OK \(1 test\)' "$RUNNER_TEMP/private-tls-test.txt"
echo VENTRY_ADMIN_PRIVATE_TLS_AND_HOSTNAME_PASS
