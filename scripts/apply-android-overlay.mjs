import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = path.join(root, 'android', 'app', 'src', 'main');
if (!fs.existsSync(androidRoot)) throw new Error('No existe android/. Ejecuta primero: npx cap add android');

const javaTarget = path.join(androidRoot, 'java', 'com', 'enma', 'cycle');
fs.mkdirSync(javaTarget, { recursive: true });
for (const file of ['EnmaWidgetProvider.java', 'EnmaWidgetPlugin.java']) {
  fs.copyFileSync(path.join(root, 'native', 'android', 'java', file), path.join(javaTarget, file));
}

copyDir(path.join(root, 'native', 'android', 'res'), path.join(androidRoot, 'res'));

const mainActivityPath = path.join(javaTarget, 'MainActivity.java');
let mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
if (!mainActivity.includes('registerPlugin(EnmaWidgetPlugin.class)')) {
  if (!mainActivity.includes('import android.os.Bundle;')) {
    mainActivity = mainActivity.replace(/(package\s+com\.enma\.cycle;\s*)/, '$1\nimport android.os.Bundle;\n');
  }
  mainActivity = mainActivity.replace(
    /public class MainActivity extends BridgeActivity\s*\{[\s\S]*?\}/m,
    `public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(EnmaWidgetPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}`
  );
  fs.writeFileSync(mainActivityPath, mainActivity);
}

const manifestPath = path.join(androidRoot, 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('EnmaWidgetProvider')) {
  const receiver = `\n        <receiver\n            android:name=".EnmaWidgetProvider"\n            android:exported="false">\n            <intent-filter>\n                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />\n            </intent-filter>\n            <meta-data\n                android:name="android.appwidget.provider"\n                android:resource="@xml/enma_widget_info" />\n        </receiver>\n`;
  manifest = manifest.replace('</application>', `${receiver}    </application>`);
}
fs.writeFileSync(manifestPath, manifest);
console.log('Overlay Android de Enma aplicado correctamente.');

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
