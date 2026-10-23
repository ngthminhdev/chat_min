#!/bin/sh
# Debug APK for arm64 + install on the connected phone.
#   scripts/android-build.sh            build + adb install + launch
#   scripts/android-build.sh --no-install
# tdlib-rs links TDLib statically and needs the NDK's libc++_static/libc++abi. Only those two
# files go on the link path: pointing -L at the whole sysroot dir makes the linker pick Bionic's
# static libc.a over libc.so (getauxval → SIGSEGV at startup).
set -e
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}"
export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home}"
SYS="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/sysroot/usr/lib/aarch64-linux-android"
LIBS="src-tauri/target/ndk-libs"
mkdir -p "$LIBS"
cp -f "$SYS/libc++_static.a" "$SYS/libc++abi.a" "$LIBS/"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-L $PWD/$LIBS -C link-arg=-lc++abi"
echo "RUSTFLAGS=$CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS"
# `tauri android init` regenerates gen/android (gitignored): keep the webview below the status
# bar instead of Android 15's forced edge-to-edge (the title bar would sit under the clock).
T=src-tauri/gen/android/app/src/main/res/values/themes.xml
# targetSdk 36+ ignores that opt-out, so the generated project targets 35
sed -i '' 's/^\([[:space:]]*\)targetSdk = 3[6-9]$/\1targetSdk = 35/' src-tauri/gen/android/app/build.gradle.kts
M=src-tauri/gen/android/app/src/main/java/com/chatmin/app/MainActivity.kt
cp scripts/android/MainActivity.kt "$M"
cp scripts/android/GoogleAuthPlugin.kt src-tauri/gen/android/app/src/main/java/com/chatmin/app/GoogleAuthPlugin.kt
# launcher icons: `tauri android init` leaves its placeholder; ours live in src-tauri/icons/android
cp -R src-tauri/icons/android/. src-tauri/gen/android/app/src/main/res/
# status-bar notification icon (notify.rs `.icon("ic_stat_chatmin")`)
cp -R scripts/android/res/. src-tauri/gen/android/app/src/main/res/
python3 - <<'PY'
from pathlib import Path
p = Path('src-tauri/gen/android/app/build.gradle.kts')
source = p.read_text()
dependency = '    implementation("com.google.android.gms:play-services-auth:22.0.0")'
if 'com.google.android.gms:play-services-auth:' not in source:
    p.write_text(source.replace('dependencies {', 'dependencies {\n' + dependency, 1))
manifest = Path('src-tauri/gen/android/app/src/main/AndroidManifest.xml')
source = manifest.read_text()
permission = '    <uses-permission android:name="android.permission.RECORD_AUDIO" />'
if 'android.permission.RECORD_AUDIO' not in source:
    manifest.write_text(source.replace('    <uses-permission android:name="android.permission.INTERNET" />', '    <uses-permission android:name="android.permission.INTERNET" />\n' + permission, 1))
PY
sed -i '' '/enableEdgeToEdge/d' "$M"
grep -q statusBarColor "$T" || sed -i '' 's|<!-- Customize your theme here. -->|&\n        <item name="android:statusBarColor">#141821</item>\n        <item name="android:navigationBarColor">#141821</item>\n        <item name="android:windowLightStatusBar">false</item>|' "$T"
grep -q windowOptOutEdgeToEdgeEnforcement "$T" || sed -i '' 's|<!-- Customize your theme here. -->|&\n        <item name="android:windowOptOutEdgeToEdgeEnforcement" tools:targetApi="35">true</item>|' "$T"
npx tauri android build --apk --target aarch64 --debug
APK=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
echo "APK: $APK"
[ "$1" = "--no-install" ] && exit 0
adb install -r "$APK"
adb shell am start -n com.chatmin.app/.MainActivity
