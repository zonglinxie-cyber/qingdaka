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
  assert.match(version, /^coach-[a-f0-9]{20}$/, '版本必须来自发布内容 hash');
  assert.equal(version, releaseVersion(files), '发布包内容与版本 hash 不符');
  assert.deepEqual(precache, precacheFiles(files), '预缓存必须精确覆盖所有核心文件、icons 和动图');
  assert.deepEqual(Object.keys(hashes).sort(), precache.slice().sort(), '完整性清单与预缓存不符');
  for (const file of precache) {
    assert.equal(hashes[file], sha256(files.get(file.slice(2))), `SW 文件校验值不符：${file}`);
  }
  assert.ok(sw.includes("'qingdaka-habits:' + encodeURIComponent(SCOPE.href) + ':'"), '缓存必须隔离 registration.scope');
  const precached = new Set(precache);

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

  // 语法解析检查
  for (const [name, data] of files) {
    if (name.endsWith('.js')) {
      new vm.Script(data.toString('utf8'), { filename: name });
    }
  }

  const manifest = JSON.parse(text('manifest.webmanifest'));
  assert.equal(manifest.name, '轻打卡 · 科学跟练');
  assert.equal(manifest.short_name, '轻打卡');
  assert.equal(manifest.id, './index.html', '不得改变已有 PWA 身份');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest 缺少图标');
  for (const icon of manifest.icons) { localResource(icon.src, 'manifest.webmanifest'); }

  const html = text('index.html');
  assert.ok(html.includes("img-src 'self' data: blob:;"), 'CSP 必须允许 img-src data: blob:');
  assert.ok(!html.includes('playerAudio'), '首页不得残留已移除的 playerAudio 元素');
  assert.ok(!html.includes('store.js'), '首页不得加载已废弃的 store.js');

  const scripts = [];
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const attr = name => tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']', 'i'))?.[1];
    const kind = match[1].toLowerCase();
    if (kind === 'script' && attr('src')) { scripts.push(localResource(attr('src'))); }
    if (kind === 'link' && attr('href')) { localResource(attr('href')); }
  }
  assert.deepEqual(scripts, ['content.js', 'session.js', 'app.js'], '必须按顺序加载 content.js, session.js, app.js');

  const css = text('styles.css');
  assert.ok(!/@import\b/i.test(css), '样式不得依赖外部 CSS');

  // content.js 深度课程校验
  const context = vm.createContext({ window: {} });
  vm.runInContext(text('content.js'), context, { timeout: 1000, filename: 'content.js' });
  const content = context.window.QDK_CONTENT;
  assert.ok(content && typeof content.buildSessionPlan === 'function', '缺少 QDK_CONTENT.buildSessionPlan');
  assert.deepEqual([...content.cycleOrder], ['A', 'B', 'C'], '周循环顺序必须为 A -> B -> C');
  assert.deepEqual(Object.keys(content.plans).sort(), ['A', 'B', 'C', 'gym', 'stretch'].sort(), '课程计划必须精确包含 A, B, C, gym, stretch');
  assert.deepEqual(Object.keys(content.levels).sort(), ['recovery', 'standard', 'starter', 'steady'].sort(), '强度档位必须精确包含 4 档');

  // 动作与媒体精确校验
  const referencedAssets = new Set();

  const moves = Object.values(content.movesDict);
  assert.equal(moves.length, 31, '动作清单必须精确为 31 个');
  for (const m of moves) {
    assert.ok(m.id && m.name && m.gif && m.poster && m.primary && m.secondary && m.benefit, `动作元数据不全：${m.id}`);
    assert.ok(Array.isArray(m.steps) && m.steps.length === 3, `动作步骤必须为 3 步拆解：${m.id}`);
    assert.ok(m.shortCue && m.shortCue.length <= 32, `动作口令过长：${m.id} (${m.shortCue})`);
    assert.ok(!m.mistake.startsWith('常见错误：'), `避坑提醒不要重复带常见错误前缀：${m.id}`);
    assert.equal('voice' in m, false, `动作元数据不得残留预录语音字段：${m.id}`);

    assert.ok(files.has(m.gif), `动图不存在：${m.gif}`);
    assert.ok(precached.has('./' + m.gif), `动图未预缓存：${m.gif}`);
    referencedAssets.add(m.gif);

    assert.ok(files.has(m.poster), `海报图不存在：${m.poster}`);
    assert.ok(precached.has('./' + m.poster), `海报图未预缓存：${m.poster}`);
    referencedAssets.add(m.poster);
  }

  // 校验 5 套课程 × 4 档强度的全部跟练步序列
  for (const pid of Object.keys(content.plans)) {
    for (const lid of content.levelOrder) {
      const steps = content.buildSessionPlan(pid, lid);
      assert.ok(Array.isArray(steps) && steps.length > 0, `课程生成步骤为空：${pid} ${lid}`);
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        assert.ok(s.id && s.kind && s.seconds > 0, `步字段不全：${pid} ${lid} #${i}`);
        assert.ok(['countdown', 'warmup', 'work', 'rest', 'roundBreak', 'stretch'].includes(s.kind), `未知步阶段：${s.kind}`);
        assert.ok(files.has(s.gif), `步动图不存在：${s.gif}`);
        assert.ok(files.has(s.poster), `步海报图不存在：${s.poster}`);
        if (s.kind === 'rest' || s.kind === 'roundBreak' || s.kind === 'countdown') {
          assert.ok(s.nextMove && s.nextMove.name && s.nextMove.gif, `休息步缺少下一动作引用：${s.id}`);
        }
      }
    }
  }

  // 双向精确匹配：发布包中的 exercise-guides 媒体文件不得含有未引用的孤儿文件
  for (const name of files.keys()) {
    if (name.startsWith('assets/exercise-guides/')) {
      assert.ok(referencedAssets.has(name), `发布包中存在未被引用的孤儿媒体文件：${name}`);
    }
  }

  return { plans: 5, moves: moves.length };
}

async function main() {
  const artifactDir = resolve(PROJECT_ROOT, 'dist');
  const files = await readArtifact(artifactDir);
  const result = await checkArtifact(files);
  console.log(`Artifact check passed: ${artifactDir} (${files.size} files; ${result.plans} plans; ${result.moves} moves)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
