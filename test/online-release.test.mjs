import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('../', import.meta.url));
// Release tests intentionally create an unexpected file. Isolate their output
// from the shared-package suite, which can run concurrently under node --test.
const scratchParent = path.resolve(workspace, 'dist/tests');
await mkdir(scratchParent, { recursive: true });
const root = await mkdtemp(path.join(scratchParent, 'hatchai-release-test-'));
await cp(path.join(workspace, 'data'), path.join(root, 'data'), { recursive: true });
await mkdir(path.join(root, 'tools'), { recursive: true });
await mkdir(path.join(root, 'public'), { recursive: true });
for (const name of ['package-online-dashboard.mjs', 'package-online-release.mjs', 'verify-online-release.mjs']) {
  await cp(path.join(workspace, 'tools', name), path.join(root, 'tools', name));
}
for (const name of ['online-login.html', 'online-login.js', 'online-dashboard.js', 'supabase-auth.js',
  'incubator-read.js', 'online-api-settings.js', 'cloud-notification-settings.js']) {
  await cp(path.join(workspace, 'public', name), path.join(root, 'public', name));
}
for (const name of ['firebase-config.js', 'push-settings.js', 'firebase-messaging-sw.js']) {
  await cp(path.join(workspace, 'public', name), path.join(root, 'public', name));
}
await cp(path.join(workspace, 'firebase.online.json'), path.join(root, 'firebase.online.json'));
after(async () => {
  if (path.dirname(path.resolve(root)) !== scratchParent || !path.basename(root).startsWith('hatchai-release-test-')) {
    throw new Error('Refusing cleanup outside the allocated test directory.');
  }
  await rm(root, { recursive: true });
});
const build = () => execFileSync(process.execPath, ['tools/package-online-release.mjs'], { cwd: root });
test('Hosting package is reproducible, public-only, and byte-identical to approved source assets', async () => {
  build();
  const manifestPath = path.join(root, 'dist/myhatchai/manifest.json');
  const first = await readFile(manifestPath, 'utf8'); build();assert.equal(await readFile(manifestPath, 'utf8'), first);
  const manifest = JSON.parse(first);
  assert.equal(manifest.files.length, 22);
  assert.equal(manifest.hostingSite, 'myhatchai');
  for (const entry of manifest.files) {
    assert.ok(!/(?:^|\/)(?:test|tools|backups|src|include|\.env|\.dev|node_modules)|\.(?:bin|elf|dpapi|map)$/.test(entry.path));
    const bytes = await readFile(path.join(root, 'dist/myhatchai/site', entry.path));
    const source = path.join(root, 'public', entry.path);
    assert.deepEqual(bytes, await readFile(source));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
  const js = await readdir(path.join(root, 'dist/myhatchai/site/shared/js'));
  assert.deepEqual(js.sort(), ['app.js', 'dashboard.js', 'dashboardAdapters.js']);
});
test('Hosting configuration is scoped to release with no Functions/Firestore or SPA fallthrough', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'firebase.online.json')));
  assert.deepEqual(Object.keys(config).sort(), ['emulators', 'hosting']);
  assert.equal(config.hosting.site, 'myhatchai');
  assert.equal(config.hosting.public, 'dist/myhatchai/site');
  assert.ok(config.hosting.redirects.some(rule => new RegExp(rule.regex).test('/') && rule.destination === '/online-login.html'));
  assert.equal(config.hosting.rewrites.length, 0);
  assert.ok(config.hosting.redirects.some(rule => new RegExp(rule.regex).test('/online') && rule.destination === '/online-login.html'));
  const csp = config.hosting.headers.find(rule => new RegExp(rule.regex).test('/online-login.html') && rule.headers.some(header => header.key === 'Content-Security-Policy')).headers[0].value;
  assert.ok(csp.includes('connect-src \'self\' https://dihufafcztqjuudjeqdm.supabase.co https://hatchai.kurtzidrickguno-robles.workers.dev;'));
  assert.ok(!csp.includes('127.0.0.1'));
});
test('pre-upload verification rejects an unreviewed development file', async () => {
  const verify = () => execFileSync(process.execPath, ['tools/verify-online-release.mjs'], { cwd: root, stdio: 'pipe' });
  verify();
  const extra = path.join(root, 'dist/myhatchai/site/unreviewed-test.txt');
  await writeFile(extra, 'synthetic-only');
  try { assert.throws(verify);assert.throws(() => execFileSync(process.execPath, ['tools/package-online-release.mjs'], { cwd: root, stdio: 'pipe' })); }
  finally { await unlink(extra); }
  verify();
});
test('packaging refuses the default Hosting site instead of silently replacing it', async () => {
  const file = path.join(root, 'firebase.online.json');
  const original = await readFile(file, 'utf8');
  const changed = JSON.parse(original);changed.hosting.site = 'hatchai-8d34c';
  await writeFile(file, JSON.stringify(changed));
  try {
    assert.throws(() => execFileSync(process.execPath, ['tools/package-online-release.mjs'], { cwd: root, stdio: 'pipe' }));
    assert.throws(() => execFileSync(process.execPath, ['tools/verify-online-release.mjs'], { cwd: root, stdio: 'pipe' }));
  } finally { await writeFile(file, original); }
  build();
});
