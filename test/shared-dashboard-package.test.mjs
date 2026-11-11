import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = () => execFileSync(process.execPath, ['tools/package-online-dashboard.mjs'], { cwd: root, stdio: 'pipe' });
test('package is deterministic, copies canonical assets exactly, and excludes local API/auth code', async () => {
  build();
  const manifestPath = new URL('../public/shared/manifest.json', import.meta.url);
  const first = await readFile(manifestPath, 'utf8');build();
  assert.equal(await readFile(manifestPath, 'utf8'), first);
  const manifest = JSON.parse(first);
  for (const entry of manifest.files) {
    const bytes = await readFile(new URL('../public/shared/' + entry.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    if (!['dashboard-fragment.html','settings-fragment.html','batch-fragment.html','camera-fragment.html','control-fragment.html','log-fragment.html'].includes(entry.path)) assert.deepEqual(bytes, await readFile(new URL('../' + entry.source, import.meta.url)));
  }
  const js = await readdir(new URL('../public/shared/js/', import.meta.url));
  assert.deepEqual(js.sort(), ['app.js', 'cameraView.js', 'dashboard.js', 'dashboardAdapters.js', 'modal.js']);
  const fragment = await readFile(new URL('../public/shared/dashboard-fragment.html', import.meta.url), 'utf8');
  assert.ok(fragment.includes('id="environmentChart"'));
  assert.ok(!/<script|authSession|espApi|notificationPairing/.test(fragment));
  assert.ok(!/https?:\/\//.test(fragment));
});
test('packaging refuses unreviewed output files instead of publishing or deleting them', async () => {
  const unexpected = new URL('../public/shared/unexpected-test-file.txt', import.meta.url);
  await writeFile(unexpected, 'synthetic-only');
  try { assert.throws(build);assert.equal(await readFile(unexpected, 'utf8'), 'synthetic-only'); }
  finally { await unlink(unexpected); }
});
