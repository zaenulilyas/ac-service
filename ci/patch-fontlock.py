#!/usr/bin/env python3
# Kunci ukuran teks WebView ke 100% (setTextZoom) supaya APK TIDAK ikut
# setting "Font Size" / "Display Size" sistem HP. Dipatch ke MainActivity.java
# hasil Capacitor (yang di-generate tiap build).
import io, glob, sys, re

paths = glob.glob("android/app/src/main/java/**/MainActivity.java", recursive=True)
if not paths:
    print("MainActivity.java tidak ketemu, skip.")
    sys.exit(0)

path = paths[0]
with io.open(path, "r", encoding="utf-8") as f:
    t = f.read()

if "setTextZoom" in t:
    print("setTextZoom sudah ada, skip.")
    sys.exit(0)

body = (
    "public class MainActivity extends BridgeActivity {\n"
    "    @Override\n"
    "    public void onStart() {\n"
    "        super.onStart();\n"
    "        try { getBridge().getWebView().getSettings().setTextZoom(100); } catch (Exception e) {}\n"
    "    }\n"
    "}\n"
)

# ganti deklarasi class kosong (dengan/atau tanpa spasi) jadi body yang ada override-nya
new_t = re.sub(
    r"public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}",
    body,
    t,
    count=1,
)

if new_t == t:
    print("Pola class MainActivity kosong tidak cocok — patch dilewati (cek manual).")
    sys.exit(0)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(new_t)
print("MainActivity dipatch: setTextZoom(100) — teks nggak ikut font-scale sistem.")
