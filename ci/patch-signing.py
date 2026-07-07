#!/usr/bin/env python3
# Tambahkan signingConfig (kunci tetap) ke build.gradle Android hasil Capacitor,
# supaya tiap build ditandatangani kunci yang sama → APK baru bisa nimpa yang lama.
import io, sys

path = "android/app/build.gradle"
with io.open(path, "r", encoding="utf-8") as f:
    t = f.read()

if "signingConfigs" in t:
    print("signingConfigs sudah ada, skip.")
    sys.exit(0)

signing = """    signingConfigs {
        release {
            storeFile file('release.keystore')
            storePassword 'acservice123'
            keyAlias 'acservice'
            keyPassword 'acservice123'
            storeType 'PKCS12'
        }
    }
"""

# 1) sisipkan signingConfigs tepat setelah 'android {'
t = t.replace("android {\n", "android {\n" + signing, 1)
# 2) pakai signingConfig itu di buildTypes.release (sebelum minifyEnabled)
t = t.replace("minifyEnabled false",
              "signingConfig signingConfigs.release\n            minifyEnabled false", 1)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(t)
print("build.gradle dipatch: signingConfig release ditambahkan.")
