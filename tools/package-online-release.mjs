// Produces a Hosting-only release. Does not deploy or read account credentials.
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const release = path.join(root, 'dist/myhatchai');
const site = path.join(release, 'site');
execFileSync(process.execPath, ['tools/package-online-dashboard.mjs'], { cwd: root, stdio: 'pipe' });
const shared = JSON.parse(await readFile(path.join(root, 'public/shared/manifest.json'), 'utf8'));
const frontend = ['manifest.webmanifest', 'online-login.html', 'online-login.js', 'online-dashboard.js', 'supabase-auth.js',
  'native-push/client.js', 'native-push/modal.js', 'native-push/service-worker.js',
  'camera-api.js', 'telemetry-api.js', 'incubator-read.js', 'online-api-settings.js', 'cloud-notification-settings.js'];
// Dormant FCM assets only: this dashboard never registers the service worker.
// Do not bring the old site's notification page or enrollment scripts here.
const messaging = ['firebase-config.js', 'push-settings.js', 'firebase-messaging-sw.js'];
const files = [...frontend, ...messaging, ...shared.files.map(entry => 'shared/' + entry.path)];
const allowed = new Set(files);
async function checkDirectory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Refusing linked release output.');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await checkDirectory(path.join(directory, entry.name), relative + '/');
    else if (!allowed.has(relative)) throw new Error('Unexpected release file; review before publishing.');
  }
}
// Refuse linked parents even when they point back into the workspace.
for (const directory of [path.join(root, 'dist'), release, site]) {
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Refusing linked release directory.');
}
await checkDirectory(site);
const api = await readFile(path.join(root, 'public/online-api-settings.js'), 'utf8');
if (!api.includes("export const onlineApiUrl = 'https://hatchai.kurtzidrickguno-robles.workers.dev';")) throw new Error('Production API origin requires review.');
const entries = [];
for (const name of files.sort()) {
  const source = path.join(root, 'public', name);
  if ((await lstat(source)).isSymbolicLink()) throw new Error('Refusing linked release source.');
  const bytes = await readFile(source);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (/\.(?:html|js|css)$/.test(name) && /sb_secret_|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|["']service_role["']/.test(bytes.toString('utf8'))) {
    throw new Error('Forbidden private credential marker in a release source; details suppressed.');
  }
  await mkdir(path.dirname(path.join(site, name)), { recursive: true });
  await writeFile(path.join(site, name), bytes);
  entries.push({ path: name, bytes: bytes.length, sha256: hash });
}
const config = await readFile(path.join(root, 'firebase.online.json'));
const hosting = JSON.parse(config).hosting;
if (hosting.site !== 'myhatchai' || hosting.public !== 'dist/myhatchai/site') throw new Error('Refusing an ambiguous Hosting target.');
const manifest = { project: 'hatchai-8d34c', hostingSite: 'myhatchai', origin: 'https://myhatchai.web.app', entry: '/online-login.html', worker: 'https://hatchai.kurtzidrickguno-robles.workers.dev',
  hostingConfigSha256: createHash('sha256').update(config).digest('hex'), files: entries };
await writeFile(path.join(release, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared myhatchai Hosting-only release: ${entries.length} public files, ${entries.reduce((sum, entry) => sum + entry.bytes, 0)} bytes. No deployment performed.`);
