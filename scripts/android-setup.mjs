// Patches the generated Android project (gen/android) after `tauri android init`:
//  * release signing from env (ANDROID_KEYSTORE_B64 / _PASSWORD / ANDROID_KEY_ALIAS)
//  * cleartext HTTP to the in-app 127.0.0.1 audio server
//  * keep audio playing in background (wake lock / foreground permissions)
import fs from "node:fs";
import path from "node:path";

const root = "src-tauri/gen/android";
const gradle = path.join(root, "app/build.gradle.kts");
let g = fs.readFileSync(gradle, "utf8");

// cleartext for http://127.0.0.1
g = g.replace(/manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"false"/g, 'manifestPlaceholders["usesCleartextTraffic"] = "true"');

const b64 = process.env.ANDROID_KEYSTORE_B64;
if (b64) {
  const ks = path.resolve(root, "app/release.jks");
  fs.writeFileSync(ks, Buffer.from(b64, "base64"));
  fs.writeFileSync(
    path.join(root, "keystore.properties"),
    `password=${process.env.ANDROID_KEYSTORE_PASSWORD}\nkeyAlias=${process.env.ANDROID_KEY_ALIAS || "muzicus"}\nstoreFile=${ks.replace(/\\/g, "/")}\n`,
  );
  if (!g.includes("import java.io.FileInputStream")) {
    g = "import java.io.FileInputStream\n" + (g.includes("import java.util.Properties") ? "" : "import java.util.Properties\n") + g;
  }
  g = g.replace(
    /(\n\s*buildTypes\s*\{)/,
    `
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }$1`,
  );
  g = g.replace(/(getByName\("release"\)\s*\{)/, `$1\n            signingConfig = signingConfigs.getByName("release")`);
  console.log("signing configured");
} else {
  console.log("no keystore — APK will be unsigned");
}
fs.writeFileSync(gradle, g);

// manifest permissions
const manifest = path.join(root, "app/src/main/AndroidManifest.xml");
let m = fs.readFileSync(manifest, "utf8");
for (const p of ["android.permission.WAKE_LOCK", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK", "android.permission.POST_NOTIFICATIONS"]) {
  if (!m.includes(p)) m = m.replace(/<application/, `<uses-permission android:name="${p}" />\n    <application`);
}
fs.writeFileSync(manifest, m);
console.log("android project patched");
