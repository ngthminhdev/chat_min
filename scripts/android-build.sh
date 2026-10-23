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
npx tauri android build --apk --target aarch64 --debug
APK=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
echo "APK: $APK"
[ "$1" = "--no-install" ] && exit 0
adb install -r "$APK"
adb shell am start -n com.chatmin.app/.MainActivity
