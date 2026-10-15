#!/bin/sh
# JeduAI APK hand-build (no Gradle needed):
# aapt2 compile/link -> javac -> d8 -> package -> zipalign -> apksigner
set -e
BT=/home/z/android-build/bt/android-14
PLAT=/home/z/android-build/plat/android-34/android.jar
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
rm -rf build out
mkdir -p build/gen build/classes out

echo "[1/7] aapt2 compile"
"$BT/aapt2" compile --dir res -o build/res.zip

echo "[2/7] aapt2 link"
"$BT/aapt2" link -o build/base.apk -I "$PLAT" \
  --manifest AndroidManifest.xml --java build/gen build/res.zip

echo "[3/7] javac (ECJ — Debian javac emits MethodParameters w/ null names that crash d8)"
rm -rf build/classes && mkdir -p build/classes
java -jar /home/z/android-build/ecj.jar -source 8 -target 8 -nowarn \
  -classpath "$PLAT" -d build/classes \
  build/gen/app/jeduai/R.java java/app/jeduai/MainActivity.java

echo "[4/7] d8 dex"
"$BT/d8" --release --lib "$PLAT" --min-api 24 --output build \
  build/classes/app/jeduai/*.class

echo "[5/7] package"
(cd build && zip -q -j base.apk classes.dex)

echo "[6/7] zipalign"
"$BT/zipalign" -f 4 build/base.apk build/aligned.apk

echo "[7/7] sign"
if [ ! -f "$ROOT/jeduai.keystore" ]; then
  keytool -genkeypair -keystore "$ROOT/jeduai.keystore" -alias jeduai \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass jeduai-mobile-2024 -keypass jeduai-mobile-2024 \
    -dname "CN=JeduAI, OU=Mobile, O=JeduAI, C=IN"
fi
"$BT/apksigner" sign --ks "$ROOT/jeduai.keystore" --ks-key-alias jeduai \
  --ks-pass pass:jeduai-mobile-2024 --key-pass pass:jeduai-mobile-2024 \
  --out out/JeduAI.apk build/aligned.apk

"$BT/apksigner" verify --print-certs out/JeduAI.apk
echo "--- badging ---"
"$BT/aapt2" dump badging out/JeduAI.apk | sed -n '1,10p'
echo "--- size ---"
ls -la out/JeduAI.apk
echo "BUILD OK"
