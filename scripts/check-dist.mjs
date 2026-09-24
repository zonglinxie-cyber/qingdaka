import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
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
  'package-lock.json',
  'docs/archive/HANDOVER.md'
];
const CUE_KEYS = [
  'encourage-1','encourage-2','encourage-3','encourage-4','encourage-5',
  'switch-side','countdown-3','countdown-start',
  'finish-done','finish-stretch','finish-early'
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

const manifestKeys = voiceManifest.map((entry) => entry && entry.key).filter(Boolean);
assert.deepEqual([...new Set(manifestKeys)].sort(), manifestKeys.slice().sort(), '语音清单有重复 key');
for (const key of manifestKeys) {
  if (!/^[a-z0-9-]+$/i.test(key) || !m4aNames.has(`${key}.m4a`)) {
    throw new Error(`Voice manifest entry has no m4a asset: ${JSON.stringify(key)}`);
  }
}
assert.equal(m4aNames.size, manifestKeys.length, '发布包包含未登记的语音');

const app = await readFile(resolve(outputDir, 'app.js'), 'utf8');
assert.equal(app.includes('var VOICE_FILES'), false, 'app.js 不应再抄一份语音表');
assert.equal(app.includes('playVoiceViaWebAudio'), false, '语音地质层应已删除');
assert.equal(app.includes('indexedDB'), false, '不应再双写 IndexedDB');
assert.equal(app.includes('function mealTargets'), false, '四餐门槛应已删除');

const context = { window: {} };
vm.runInNewContext(await readFile(resolve(outputDir, 'content.js'), 'utf8'), context);
const content = context.window.QDK_CONTENT;
const liveVoice = new Set(CUE_KEYS);
const missing = [];
const mediaFiles = new Set();

function addMedia(move) {
  if (!move || move.noMedia) return;
  if (move.frames && move.frames.length) {
    move.frames.forEach((file) => mediaFiles.add(file));
    return;
  }
  const stem = content.mediaStem(move);
  mediaFiles.add(stem + '-poster.png');
  if (!move.hold) mediaFiles.add(stem + '.gif');
}

const groups = Object.entries(content.routines).map(([name, moves]) => [name === 'stretch' ? 'stretch-' : 'work-', moves]);
groups.push(['warmup-', content.warmupMoves], ...Object.values(content.stretchSets).map((moves) => ['stretch-', moves]));
// 预录语音念的就是动作名（mmx 没登录就不能重录），所以名字一旦改得和录音不一致，
// 跟练时耳朵听到的和屏幕上读到的就是两个动作。这里把「名字必须出现在录音稿里」变成硬门槛。
const spokenText = new Map(voiceManifest.map((entry) => [entry.key, entry.text || '']));
const renamed = [];
for (const [prefix, moves] of groups) {
  for (const move of moves) {
    addMedia(move);
    const key = content.voiceKey(prefix, move);
    if (!key) continue;
    liveVoice.add(key);
    if (!manifestKeys.includes(key)) missing.push(key);
    const spoken = spokenText.get(key);
    const asr = content.ASSET_ALIAS[move.id];
    const spokenName = (asr && asr.voiceName) || move.name;
    if (spoken && !spoken.includes(spokenName)) {
      renamed.push(key + ' 屏幕上是「' + move.name + '」，录音里是「' + spoken.slice(0, 24) + '」');
    }
  }
}

assert.deepEqual(renamed, [], '动作名与预录语音对不上：' + renamed.join('；'));

assert.deepEqual(missing.sort(), [], '活课程缺预录语音，且未标 SILENT_VOICE：' + missing.join(', '));
for (const key of liveVoice) {
  assert.ok(manifestKeys.includes(key), '预录清单缺少活课程语音：' + key);
}

for (const file of mediaFiles) {
  assert.ok(await exists('assets/exercise-guides/' + file), '动作缺少素材：' + file);
}

async function listFiles(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await listFiles(path, acc);
    else if (!entry.name.startsWith('.') && entry.name !== 'SOURCE_LICENSE.txt') acc.push(path);
  }
  return acc;
}
const guideRoot = resolve(outputDir, 'assets/exercise-guides');
const extras = [];
for (const path of await listFiles(guideRoot)) {
  const rel = relative(guideRoot, path).split(sep).join('/');
  if (!mediaFiles.has(rel)) extras.push(rel);
}
assert.deepEqual(extras.sort(), [], '发布包含未引用示范：' + extras.join(', '));

const pending = JSON.parse(await readFile(resolve('voice-pending.json'), 'utf8'));
assert.deepEqual(pending, [], 'voice-pending.json 应为空；缺预录的动作写 content.js 的 SILENT_VOICE');

console.log(`Deploy artifact verified: ${voiceManifest.length} m4a voice files; sensitive source files excluded`);
console.log(`Content verified: 活课程语音与素材已求交；${Object.keys(content.SILENT_VOICE).length} 个动作明确无预录`);
