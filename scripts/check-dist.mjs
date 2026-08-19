import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve(process.cwd(), 'dist');
const requiredFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'voice-scripts.json'
];
const forbiddenFiles = [
  'HANDOVER.md',
  'README.md',
  'test.html',
  'serve.py',
  'package.json',
  'package-lock.json'
];

async function exists(relativeName) {
  try {
    await access(resolve(outputDir, relativeName), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

for (const relativeName of requiredFiles) {
  if (!(await exists(relativeName))) throw new Error(`Deploy artifact missing ${relativeName}`);
}
for (const relativeName of forbiddenFiles) {
  if (await exists(relativeName)) throw new Error(`Sensitive or non-runtime file leaked into dist: ${relativeName}`);
}

const voiceManifest = JSON.parse(await readFile(resolve(outputDir, 'voice-scripts.json'), 'utf8'));
const voiceEntries = await readdir(resolve(outputDir, 'assets/voice'));
const m4aNames = new Set(voiceEntries.filter((name) => name.endsWith('.m4a')));
const mp3Names = voiceEntries.filter((name) => name.endsWith('.mp3'));
if (mp3Names.length) throw new Error(`Deprecated mp3 files leaked into dist: ${mp3Names.join(', ')}`);

for (const entry of voiceManifest) {
  const key = entry && typeof entry.key === 'string' ? entry.key : '';
  if (!/^[a-z0-9-]+$/i.test(key) || !m4aNames.has(`${key}.m4a`)) {
    throw new Error(`Voice manifest entry has no m4a asset: ${JSON.stringify(key)}`);
  }
}

console.log(`Deploy artifact verified: ${voiceManifest.length} m4a voice files; sensitive source files excluded`);
