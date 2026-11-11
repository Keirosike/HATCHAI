// Read-only pre-upload check. A manifest is an integrity check, not a signature.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const site = path.join(root, 'dist/myhatchai/site');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(path.join(root, 'dist/myhatchai/manifest.json'), 'utf8'));
if (manifest.project !== 'hatchai-8d34c' || manifest.worker !== 'https://hatchai.kurtzidrickguno-robles.workers.dev' ||
  manifest.hostingSite !== 'myhatchai' || manifest.origin !== 'https://myhatchai.web.app' ||
  manifest.files.length !== 46 || manifest.hostingConfigSha256 !== sha(await readFile(path.join(root, 'firebase.online.json')))) {
  throw new Error('Release metadata/configuration mismatch; rebuild and review.');
}
const config = JSON.parse(await readFile(path.join(root, 'firebase.online.json')));
if (config.hosting.site !== 'myhatchai' || config.hosting.public !== 'dist/myhatchai/site') throw new Error('Refusing ambiguous Hosting target.');
const paths = [];
async function inspect(directory, prefix = '') {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked release directory refused.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Linked release entry refused.');
    const name = prefix + entry.name;
    if (entry.isDirectory()) await inspect(path.join(directory, entry.name), name + '/');
    else paths.push(name);
  }
}
await inspect(site);
const expected = manifest.files.map(entry => entry.path).sort();
if (new Set(expected).size !== 46 || JSON.stringify(paths.sort()) !== JSON.stringify(expected)) throw new Error('Release contains missing or unreviewed files.');
for (const entry of manifest.files) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(entry.path) || entry.path.split('/').includes('..')) throw new Error('Invalid release path.');
  const bytes = await readFile(path.join(site, entry.path));
  const source = path.join(root, 'public', entry.path);
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256 || sha(await readFile(source)) !== entry.sha256) {
    throw new Error('Release/source integrity mismatch; rebuild and review.');
  }
}
console.log('PASS: myhatchai target verified; 46 public assets match manifest and source; no extra files.');
if (process.argv.includes('--check-original-site')) {
  const baseline = JSON.parse(await readFile(path.join(root, 'dist/hatchai-hosting-baseline/manifest.json'), 'utf8'));
  for (const entry of baseline.files) {
    const name = entry.path;
    const response = await fetch('https://hatchai-8d34c.web.app/' + name, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Existing Hosting asset could not be verified; do not deploy.');
    const reader = response.body?.getReader(); if (!reader) throw new Error('Existing Hosting asset could not be verified.');
    let size = 0; const chunks = [];
    while (true) { const part = await reader.read();if (part.done) break;size += part.value.length;
      if (size > 131072) { await reader.cancel();throw new Error('Existing Hosting asset exceeds preservation bounds.'); }chunks.push(part.value); }
    if (sha(Buffer.concat(chunks)) !== entry.sha256) {
      throw new Error('Existing Hosting changed since review; stop and refresh the preservation review before deployment.');
    }
  }
  console.log('PASS: original hatchai-8d34c Hosting assets are unchanged.');
}
