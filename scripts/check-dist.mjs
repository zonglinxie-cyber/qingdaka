import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const outputDir = resolve(process.cwd(), 'dist');
const requiredFiles = [
  'index.html',
  'app.js',
  'content.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'voice-scripts.json'
];
const forbiddenFiles = [
  'HANDOVER.md',
  'README.md',
  'FROZEN.md',
  'SPEC.md',
  'BACKLOG.md',
  'STATE.md',
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

// 校验实际课程、运行时语音映射和素材；未录制动作必须出现在待办清单里。
const app = await readFile(resolve(outputDir, 'app.js'), 'utf8');
const mapping = app.match(/var VOICE_FILES = (\{[\s\S]*?\n\});/);
assert.ok(mapping, '缺少运行时语音映射');
const voices = vm.runInNewContext('(' + mapping[1] + ')');
assert.deepEqual(Object.keys(voices).sort(), voiceManifest.map(entry => entry.key).sort(), '语音清单与运行时映射不同步');
assert.equal(m4aNames.size, voiceManifest.length, '发布包包含未登记的语音');
for (const [key, filename] of Object.entries(voices)) assert.equal(filename, key + '.m4a');
const context = {window:{}};
vm.runInNewContext(await readFile(resolve(outputDir, 'content.js'), 'utf8'), context);
const content = context.window.QDK_CONTENT, missing = new Set();
const groups = Object.entries(content.routines).map(([name, moves]) => [name === 'stretch' ? 'stretch-' : 'work-', moves]);
groups.push(['warmup-', content.warmupMoves], ...Object.values(content.stretchSets).map(moves => ['stretch-', moves]));
for (const [prefix, moves] of groups) for (const move of moves) {
  if (![move.voiceId, move.id, move.mediaId].some(id => id && voices[prefix + id])) missing.add(prefix + move.id);
  if (move.noMedia) continue;
  const media = move.frames || [(move.mediaId || move.id) + '-poster.png', ...(move.hold ? [] : [(move.mediaId || move.id) + '.gif'])];
  for (const file of media) assert.ok(await exists('assets/exercise-guides/' + file), '动作缺少素材：' + move.name + ' / ' + file);
}
const pending = JSON.parse(await readFile(resolve('voice-pending.json'), 'utf8'));
assert.deepEqual([...missing].sort(), pending.map(entry => entry.key).sort(), '新增语音缺口未登记，运行 voice:prepare 检查');

console.log(`Deploy artifact verified: ${voiceManifest.length} m4a voice files; sensitive source files excluded`);
console.log(`Content verified: 课程素材齐全；${missing.size} 段语音待生成，当前使用系统语音回退`);
