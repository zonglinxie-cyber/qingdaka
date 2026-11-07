import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  PROJECT_ROOT, REQUIRED_FILES, allowedFile, listFiles, precacheFiles,
  readBuildBlock, releaseVersion, sha256
} from './build-dist.mjs';

export async function readArtifact(root) {
  return new Map(await Promise.all((await listFiles(root)).map(async name => [name, await readFile(resolve(root, name))])));
}

export async function checkArtifact(files) {
  for (const name of REQUIRED_FILES) { assert.ok(files.has(name), `发布包缺少 ${name}`); }
  for (const name of files.keys()) { assert.ok(allowedFile(name), `非运行文件或旧资源泄漏：${name}`); }
  const text = name => files.get(name).toString('utf8');
  const sw = text('sw.js');
  const version = readBuildBlock(sw, 'VERSION');
  const precache = readBuildBlock(sw, 'PRECACHE');
  const hashes = readBuildBlock(sw, 'HASHES');
  assert.equal(readBuildBlock(sw, 'COMPLETE'), true, '发布 SW 未标记为完整包');
  assert.match(version, /^habits-[a-f0-9]{20}$/, '版本必须来自发布内容 hash');
  assert.equal(version, releaseVersion(files), '发布包内容与版本 hash 不符');
  assert.deepEqual(precache, precacheFiles(files), '预缓存必须精确覆盖所有核心文件、icons 和自制 SVG');
  assert.deepEqual(Object.keys(hashes).sort(), precache.slice().sort(), '完整性清单与预缓存不符');
  for (const file of precache) {
    assert.equal(hashes[file], sha256(files.get(file.slice(2))), `SW 文件校验值不符：${file}`);
  }
  assert.ok(sw.includes("'qingdaka-habits:' + encodeURIComponent(SCOPE.href) + ':'"), '缓存必须隔离 registration.scope');
  const precached = new Set(precache);
  const guides = [...files.keys()].filter(name => name.startsWith('assets/habit-guides/'));
  assert.ok(guides.length > 0, '缺少自制课程示范');

  function localResource(value, from = 'index.html') {
    assert.equal(typeof value, 'string', `${from} 的资源地址应是字符串`);
    assert.ok(value && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value), `不允许外部、绝对或空资源地址：${value}`);
    const base = 'https://artifact.invalid/app/';
    const url = new URL(value, new URL(from, base));
    assert.ok(url.href.startsWith(base) && !url.search && !url.hash, `资源必须是固定的包内路径：${value}`);
    const name = decodeURIComponent(url.pathname.slice('/app/'.length));
    assert.ok(files.has(name), `${from} 引用了不存在的资源：${name}`);
    assert.ok(precached.has('./' + name), `${from} 引用的资源没有预缓存：${name}`);
    return name;
  }

  const legacy = /assets\/(?:exercise-guides|voice(?:-samples)?)(?:\/|\b)|voice-scripts|\b(?:VOICE_FILES|playVoice\w*|voiceKey|speechSynthesis|SpeechSynthesisUtterance)\b|new\s+Audio\s*\(|<audio\b|protein|蛋白/i;
  for (const [name, data] of files) {
    if (!/\.(?:html|js|css|svg|webmanifest)$/.test(name)) { continue; }
    const source = data.toString('utf8');
    assert.ok(!legacy.test(source), `发布文件仍有旧蛋白或语音功能：${name}`);
    if (name.endsWith('.js')) { new vm.Script(source, { filename: name }); }
    if (name.endsWith('.svg')) {
      assert.match(source, /<svg\b/i, `不是 SVG：${name}`);
      assert.ok(!/<(?:script|foreignObject)\b|\bon\w+\s*=|<!ENTITY/i.test(source), `SVG 不得嵌入活动内容：${name}`);
      for (const match of source.matchAll(/(?:href|url)\s*(?:=\s*["']|\(\s*["']?)([^"')\s>]+)/gi)) {
        assert.ok(match[1].startsWith('#'), `SVG 必须自包含：${name} → ${match[1]}`);
      }
    }
  }

  const manifest = JSON.parse(text('manifest.webmanifest'));
  assert.equal(manifest.name, '轻打卡 · 动起来');
  assert.equal(manifest.short_name, '轻打卡');
  assert.equal(manifest.id, './index.html', '不得改变已有 PWA 身份');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#203f36');
  assert.equal(manifest.background_color, '#f5f4ee');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest 缺少图标');
  for (const icon of manifest.icons) { localResource(icon.src, 'manifest.webmanifest'); }

  const html = text('index.html');
  const scripts = [];
  for (const match of html.matchAll(/<(script|link|img)\b[^>]*>/gi)) {
    const tag = match[0];
    const attr = name => tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']', 'i'))?.[1];
    const kind = match[1].toLowerCase();
    if (kind === 'script' && attr('src')) { scripts.push(localResource(attr('src'))); }
    if (kind === 'img' && attr('src')) { localResource(attr('src')); }
    if (kind === 'link' && attr('href')) { localResource(attr('href')); }
  }
  for (const name of ['content.js', 'store.js', 'session.js', 'app.js']) {
    assert.ok(scripts.includes(name), `首页未加载 ${name}`);
  }
  assert.ok(scripts.indexOf('app.js') > Math.max(...['content.js', 'store.js', 'session.js'].map(name => scripts.indexOf(name))), 'app.js 必须在三个核心模块之后加载');
  const css = text('styles.css');
  assert.ok(!/@import\b/i.test(css), '样式不得依赖外部 CSS');
  for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) {
    if (!match[1].startsWith('data:') && !match[1].startsWith('#')) { localResource(match[1], 'styles.css'); }
  }

  const context = vm.createContext({ window: {} });
  vm.runInContext(text('content.js'), context, { timeout: 1000, filename: 'content.js' });
  const content = context.window.QDK_CONTENT;
  assert.ok(content && typeof content.buildPlan === 'function', '缺少 QDK_CONTENT.buildPlan(courseId, mode)');
  assert.ok(Array.isArray(content.courses) && Array.isArray(content.modes), '课程及模式必须是数组');
  assert.deepEqual(Array.from(content.courses, course => course.minutes).sort((a, b) => a - b), [1, 3, 5], '课程必须精确包含 1/3/5 分钟');
  assert.deepEqual(Array.from(content.modes, mode => mode.id).sort(), ['seated', 'standing'], '必须验证坐姿和站姿');
  assert.equal(new Set(content.courses.map(course => course.id)).size, 3, '课程 id 重复');
  const usedImages = new Set();
  function checkImage(image, label) {
    const name = localResource(image, 'content.js');
    assert.ok(name.startsWith('assets/habit-guides/') && name.endsWith('.svg'), `${label} 不使用自制 SVG`);
    usedImages.add(name);
  }
  function visitImages(value) {
    if (!value || typeof value !== 'object') { return; }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'image') { checkImage(item, '内容'); }
      else { visitImages(item); }
    }
  }
  visitImages(content);
  let plans = 0;
  for (const course of content.courses) {
    for (const mode of content.modes) {
      context.courseId = course.id;
      context.modeId = mode.id;
      const plan = vm.runInContext('window.QDK_CONTENT.buildPlan(courseId, modeId)', context, { timeout: 1000 });
      assert.ok(Array.isArray(plan) && plan.length > 0, `空课程：${course.id}/${mode.id}`);
      let total = 0;
      for (const step of plan) {
        assert.ok(Number.isInteger(step.seconds) && step.seconds > 0, `非法步骤时长：${step.id}`);
        assert.ok(['prepare', 'move', 'rest', 'settle'].includes(step.kind), `未知阶段：${step.id}`);
        assert.equal(step.mode, mode.id, `课程混入另一模式：${step.id}`);
        assert.equal(step.activeSeconds, step.kind === 'move' ? step.seconds : 0, `准备/休息/收尾不得冒充活动：${step.id}`);
        checkImage(step.image, step.id);
        total += step.seconds;
      }
      assert.equal(total, course.minutes * 60, `${course.id}/${mode.id} 总时长必须精确为 ${course.minutes * 60} 秒（含准备、休息、收尾）`);
      plans++;
    }
  }
  return { version, courses: content.courses.length, plans, guides: guides.length, usedImages: usedImages.size };
}

async function main() {
  if (process.argv.length > 2) { throw new Error('Usage: node scripts/check-dist.mjs'); }
  const files = await readArtifact(resolve(PROJECT_ROOT, 'dist'));
  const result = await checkArtifact(files);
  console.log(`Deploy artifact verified: ${result.version}; ${files.size} allowlisted files; ${result.guides} precached SVGs`);
  console.log(`Content verified: ${result.plans} plans; exact 60/180/300 seconds; no legacy pages, audio, documents or dependencies`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
