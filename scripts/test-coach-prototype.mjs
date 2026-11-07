#!/usr/bin/env node
// 独立原型验证；不构建、不截图、不写报告文件、不连接个人浏览器/profile。
// node scripts/test-coach-prototype.mjs（默认 channel=chrome，可用 PLAYWRIGHT_CHANNEL 覆盖）
// 页面时间使用 Playwright clock；110s 总预算为外层 120s 超时预留清理时间。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIR = process.env.COACH_DIR || 'gentle-coach';
// 不同原型的肢体支点不同，姿态断言跟着原型走，不把某一人形的坐标写死。
const POSE = {
  'gentle-coach': { rest: 'rotate(0.000 166 277)', farRest: 'rotate(0.000 162 270)', lifted: 'rotate(-9.000 166 277)' },
  'coach-anatomy': { rest: 'rotate(0.000 196 212)', farRest: 'rotate(0.000 210 206)', lifted: 'rotate(16.000 196 212)' }
}[DIR];
const FILE_URL = new URL(`../docs/prototypes/${DIR}/index.html`, import.meta.url).href;
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL?.trim() || 'chrome';
const NOW = new Date('2026-11-06T04:00:00Z');
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 320, height: 560 }];
const contexts = new Set();
const results = [];
const cases = [];
let browser, server, base, cleanupPromise;
let serverOutput = '', lastAction = '', stopping = false;

async function localServer() {
  server = spawn('python3', ['-u', 'serve.py', '0', '--host', '127.0.0.1', '--directory', '.'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(url);
    };
    const timer = setTimeout(() => finish(new Error('serve.py 启动超时：' + serverOutput)), 10000);
    server.once('error', error => finish(error));
    server.once('exit', (code, signal) => finish(new Error(`serve.py 提前退出 (${code ?? signal})：${serverOutput}`)));
    server.stderr.on('data', chunk => { serverOutput += String(chunk); });
    server.stdout.on('data', chunk => {
      serverOutput += String(chunk);
      const match = serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) finish(null, match[0]);
    });
  });
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGINT');
  const force = setTimeout(() => server.kill('SIGKILL'), 2500);
  try { await exited; } finally { clearTimeout(force); }
}

function cleanup() {
  cleanupPromise ??= Promise.all([
    stopServer(),
    (async () => {
      await Promise.allSettled([...contexts].map(context => context.close()));
      if (browser) await browser.close();
    })()
  ]);
  return cleanupPromise;
}
function stop(reason, code = 1) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  console.error('\n' + reason);
  void cleanup().catch(error => console.error('清理失败：' + error.message));
}
const onInterrupt = () => stop('收到 SIGINT，清理临时 context、Chrome 与 Python 服务。', 130);
const onTerminate = () => stop('收到 SIGTERM，清理临时 context、Chrome 与 Python 服务。', 143);
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);
const watchdog = setTimeout(() => stop('达到 110 秒总预算；未完成项目不计通过。'), 110000);

// 在原型脚本执行前审计 API；存储调用仍走原生实现，不能靠“阻止写入”制造通过。
// 只有 SW 注册被阻止（同时记录为失败），以免缺陷启动后台服务。
function installHarness({ speech }) {
  const audit = { storage: [], registrations: [], speech: { calls: [], cancels: 0, active: [], utterances: [], fail: false } };
  Object.defineProperty(window, '__coachTest', { value: audit });
  const descriptor = (object, name) => {
    for (let current = object; current; current = Object.getPrototypeOf(current)) {
      const found = Object.getOwnPropertyDescriptor(current, name);
      if (found) return found;
    }
  };
  const record = (kind, name) => audit.storage.push(kind + ':' + name);
  const storageGet = Storage.prototype.getItem;
  const storageKey = Storage.prototype.key;
  const storageLength = Object.getOwnPropertyDescriptor(Storage.prototype, 'length').get;
  const nativeStores = {};
  for (const name of ['localStorage', 'sessionStorage']) {
    try { nativeStores[name] = window[name]; } catch { /* file:// 在部分浏览器禁止存储。 */ }
  }
  const snapshot = () => Object.fromEntries(Object.entries(nativeStores).map(([name, store]) => {
    const values = {};
    for (let index = 0; index < storageLength.call(store); index += 1) {
      const key = storageKey.call(store, index);
      values[key] = storageGet.call(store, key);
    }
    return [name, values];
  }));
  const originalCookie = descriptor(document, 'cookie');
  const cookie = () => {
    try { return originalCookie.get.call(document); } catch { return null; }
  };
  audit.before = { stores: snapshot(), cookie: cookie() };
  audit.snapshot = () => ({ stores: snapshot(), cookie: cookie() });
  function watchAccess(object, name) {
    const original = descriptor(object, name);
    if (!original?.get) return;
    Object.defineProperty(object, name, {
      configurable: true,
      get() { record('access', name); return original.get.call(this); }
    });
  }
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) watchAccess(window, name);
  watchAccess(navigator, 'storage');
  for (const method of ['getItem', 'key', 'setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      record(['getItem', 'key'].includes(method) ? 'read' : 'write', method);
      return original.apply(this, args);
    };
  }
  if (originalCookie) Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { record('read', 'cookie'); return originalCookie.get.call(this); },
    set(value) { record('write', 'cookie'); return originalCookie.set.call(this, value); }
  });
  if (navigator.serviceWorker) navigator.serviceWorker.register = function (url) {
    audit.registrations.push(String(url));
    return Promise.reject(new Error('原型不得注册 Service Worker'));
  };

  // 不调用系统 TTS，也不依赖机器安装了哪种声音。远端中文排在本机中文前，验证筛选。
  const local = { name: 'Mock 本机中文', lang: 'zh-CN', localService: true, default: false, voiceURI: 'mock-local-zh' };
  const other = { name: 'Mock English', lang: 'en-US', localService: true, default: true, voiceURI: 'mock-en' };
  const remote = { name: 'Mock 远端中文（不可使用）', lang: 'zh-CN', localService: false, default: false, voiceURI: 'mock-remote-zh' };
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: speech === 'missing-utterance' ? undefined : class { constructor(text) { this.text = text; } }
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: speech === 'missing-api' ? undefined : {
      getVoices: () => speech === 'empty' ? [] : speech === 'remote-only' ? [other, remote] : [other, remote, local],
      cancel() {
        audit.speech.cancels += 1;
        const active = audit.speech.active.splice(0);
        for (const utterance of active) utterance.onerror?.({ error: 'canceled' });
      },
      speak(utterance) {
        audit.speech.calls.push({ text: utterance.text, voice: utterance.voice, lang: utterance.lang, rate: utterance.rate });
        audit.speech.utterances.push(utterance);
        if (audit.speech.fail) throw new Error('Mock TTS failure');
        audit.speech.active.push(utterance);
      }
    }
  });
}

const ui = page => page.evaluate(() => {
  const byId = id => document.getElementById(id);
  return {
    mode: byId('coach').dataset.mode, playing: byId('coach').dataset.playing,
    seconds: Number(byId('timeNumber').textContent), timeText: byId('timeNumber').textContent,
    stage: document.querySelector('[data-stage][aria-current="step"]')?.dataset.stage,
    caption: byId('timeCaption').textContent, label: byId('stageLabel').textContent,
    cue: byId('cue').textContent, detail: byId('cueDetail').textContent,
    figureTitle: byId('figureTitle').textContent, status: byId('status').textContent,
    pose: ['nearThigh', 'nearShin', 'farThigh', 'farShin'].map(id => byId(id).getAttribute('transform')),
    shadows: ['nearShadow', 'farShadow'].map(id => byId(id).getAttribute('opacity')),
    selected: [...document.querySelectorAll('[data-frame][aria-pressed="true"]')].map(button => button.dataset.frame),
    complete: [...document.querySelectorAll('[data-stage].complete')].map(item => item.dataset.stage),
    // SVG 没有 HTMLElement.hidden 的反射语义，不能把 JS expando 当作真实隐藏。
    hidden: Object.fromEntries(['keyframes', 'roundTrack', 'timeBlock', 'endButton', 'motionButton', 'figure', 'restOverlay'].map(id => [id, getComputedStyle(byId(id)).display === 'none'])),
    figureAriaHidden: byId('figure').getAttribute('aria-hidden') === 'true',
    primary: byId('primaryLabel').textContent, motionPressed: byId('motionButton').getAttribute('aria-pressed'),
    sound: byId('soundButton').getAttribute('aria-pressed')
  };
});
const speechState = page => page.evaluate(() => ({
  calls: window.__coachTest.speech.calls,
  cancels: window.__coachTest.speech.cancels,
  active: window.__coachTest.speech.active.length
}));
const auditState = page => page.evaluate(() => ({
  accesses: window.__coachTest.storage,
  registrations: window.__coachTest.registrations,
  before: window.__coachTest.before,
  after: window.__coachTest.snapshot()
}));
async function click(page, selector) {
  lastAction = '点击 ' + selector;
  await page.locator(selector).click();
}
async function advance(page, ms) {
  lastAction = `clock.runFor(${ms})：逐帧推进，不跳过 rAF`;
  await page.clock.runFor(ms);
}
async function matches(page, expected) {
  const actual = await ui(page);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `UI.${key}`);
  return actual;
}
async function until(label, read, predicate) {
  const deadline = Date.now() + 2500;
  let value;
  do {
    if (stopping) throw new Error('测试已中止');
    value = await read();
    if (predicate(value)) return value;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail(`${label}：${JSON.stringify(value)}`);
}
async function frozen(page, ms = 60000) {
  const before = await ui(page);
  await advance(page, ms);
  assert.deepEqual(await ui(page), before, '暂停/静态期间计时、姿态、阴影、文案和阶段应完全冻结');
  return before;
}
function flatPose(state) {
  for (const transform of state.pose) assert.match(transform, /^rotate\(0\.000 /, '双脚应回到静态起始姿态');
}
async function learning(page) {
  const state = await matches(page, { mode: 'learn', playing: 'false', selected: ['0'], primary: '预览一个轻回合' });
  flatPose(state);
  for (const id of ['timeBlock', 'roundTrack', 'endButton', 'restOverlay']) assert.equal(state.hidden[id], true, id);
  for (const id of ['figure', 'motionButton', 'keyframes']) assert.equal(state.hidden[id], false, id);
  return state;
}
async function stage(page, name, seconds) {
  const state = await matches(page, { mode: 'round', playing: 'true', stage: name, seconds });
  assert.equal(state.timeText.length, 2, '计时应为两位数字');
  assert.equal(state.hidden.keyframes, true);
  for (const id of ['roundTrack', 'timeBlock', 'endButton']) assert.equal(state.hidden[id], false, id);
  if (name !== 'rest') assert.equal(state.hidden.figure, false);
  assert.equal(state.hidden.restOverlay, name !== 'rest');
  assert.equal(state.caption, ({ prepare: '准备', move: '演示', rest: '休息' })[name] + ' · 秒');
  assert.deepEqual(state.complete, ({ prepare: [], move: ['prepare'], rest: ['prepare', 'move'] })[name]);
  return state;
}
async function naturalRound(page) {
  await click(page, '#primaryButton');
  await stage(page, 'prepare', 5);
  await advance(page, 4800);
  await stage(page, 'prepare', 1);
  await advance(page, 400);
  await stage(page, 'move', 20);
  await advance(page, 19500);
  await stage(page, 'move', 1);
  await advance(page, 500);
  flatPose(await stage(page, 'rest', 10));
  await advance(page, 9500);
  await stage(page, 'rest', 1);
  await advance(page, 500);
  const ended = await learning(page);
  assert.match(ended.status, /预览结束.*没有生成锻炼记录/);
  await frozen(page);
}

test('休息阶段：人物应退出显示/辅助技术，而不只是被休息遮罩覆盖', async page => {
  await click(page, '#primaryButton');
  await advance(page, 25200);
  await stage(page, 'rest', 10);
  const figure = await page.locator('#figure').evaluate(element => ({
    hiddenProperty: element.hidden, hiddenAttribute: element.hasAttribute('hidden'),
    display: getComputedStyle(element).display, ariaHidden: element.getAttribute('aria-hidden')
  }));
  assert.ok(figure.display === 'none' || figure.ariaHidden === 'true',
    '休息人物仍暴露给辅助技术；检查 prototype.js 的 SVG .hidden 赋值：' + JSON.stringify(figure));
});

async function withPrototype(work, { viewport = VIEWPORTS[0], reducedMotion = 'no-preference', speech = 'local', file = false } = {}) {
  if (stopping) throw new Error('测试已中止');
  const context = await browser.newContext({
    viewport, reducedMotion, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    isMobile: true, hasTouch: true, acceptDownloads: false, serviceWorkers: 'block'
  });
  contexts.add(context);
  context.setDefaultTimeout(2500);
  context.setDefaultNavigationTimeout(8000);
  const evidence = { pageErrors: [], consoleErrors: [], httpErrors: [], requestFailures: [], unexpectedRequests: [], websockets: [], workers: [] };
  const requests = [];
  const url = file ? FILE_URL : base + `/docs/prototypes/${DIR}/index.html`;
  const allowed = new Set(['index.html', 'prototype.js', 'prototype.css'].map(name => new URL(name, url).href));
  let page, timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void context.close().catch(() => {});
  }, 18000);
  try {
    if (stopping) throw new Error('创建 context 时测试已中止');
    await context.addInitScript(installHarness, { speech });
    await context.route('**/*', route => allowed.has(route.request().url()) ? route.continue() : route.abort('blockedbyclient'));
    context.on('request', request => {
      requests.push(request.url());
      if (!allowed.has(request.url())) evidence.unexpectedRequests.push(request.url());
    });
    context.on('serviceworker', worker => evidence.workers.push(worker.url()));
    context.on('page', tab => {
      tab.on('pageerror', error => evidence.pageErrors.push(error.stack || error.message));
      tab.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
      tab.on('response', response => { if (response.status() >= 400) evidence.httpErrors.push(`${response.status()} ${response.url()}`); });
      tab.on('requestfailed', request => evidence.requestFailures.push(`${request.url()} ${request.failure()?.errorText}`));
      tab.on('websocket', socket => evidence.websockets.push(socket.url()));
    });
    page = await context.newPage();
    await page.clock.install({ time: new Date(NOW.getTime() - 1000) });
    await page.clock.pauseAt(NOW);
    lastAction = '打开 ' + url;
    const response = await page.goto(url, { waitUntil: 'load' });
    if (!file) assert.equal(response.status(), 200, 'HTTP 原型应正常加载');
    await learning(page);
    const note = await work(page, context, requests);
    const audit = await auditState(page);
    assert.deepEqual(audit.accesses, [], '原型不得读取或写入 Web Storage、IndexedDB、Cache、cookie 或 navigator.storage');
    assert.deepEqual(audit.after, audit.before, '存储快照必须不变');
    assert.deepEqual(await context.cookies(), [], '临时 context 不应产生 cookie');
    assert.deepEqual(audit.registrations, [], '不得尝试注册 SW（即使 context 已禁止 SW）');
    assert.equal(context.serviceWorkers().length, 0);
    for (const [kind, entries] of Object.entries(evidence)) assert.deepEqual(entries, [], kind);
    for (const resource of allowed) assert.ok(requests.includes(resource), '必须实际加载 ' + resource);
    return note;
  } catch (error) {
    console.error('  最后操作：' + lastAction);
    if (timedOut) console.error('  本项目达到 18 秒上限，临时 context 已关闭。');
    if (page && !page.isClosed()) {
      try {
        console.error('  UI：' + JSON.stringify(await ui(page)));
        console.error('  存储/SW 审计：' + JSON.stringify(await auditState(page)));
      } catch { /* 保留原始错误，不用诊断错误覆盖它。 */ }
    }
    for (const [kind, entries] of Object.entries(evidence)) if (entries.length) console.error(`  ${kind}: ${JSON.stringify(entries)}`);
    throw error;
  } finally {
    clearTimeout(timer);
    try { await context.close(); } finally { contexts.delete(context); }
  }
}
function test(name, work, options) { cases.push([name, () => withPrototype(work, options)]); }

async function fits(page, label) {
  lastAction = '布局/可达性：' + label;
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth
  }));
  assert.ok(overflow.root <= overflow.viewport + 1 && overflow.body <= overflow.viewport + 1,
    `${label} 横向溢出：${JSON.stringify(overflow)}`);
  const controls = page.locator('button:visible, summary:visible');
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    await control.click({ trial: true });
    await control.focus();
    const geometry = await control.evaluate(element => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        name: element.id || element.textContent.trim(), x: r.left, right: r.right, top: r.top, bottom: r.bottom,
        width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollX,
        hit: element === hit || element.contains(hit), focused: document.activeElement === element
      };
    });
    assert.ok(geometry.x >= -1 && geometry.right <= geometry.viewportWidth + 1 && Math.abs(geometry.scrollX) <= 1,
      `${label} 控件横向被裁切：${JSON.stringify(geometry)}`);
    assert.ok(geometry.top >= -1 && geometry.bottom <= geometry.viewportHeight + 1 && geometry.hit,
      `${label} 滚动后控件仍不可达/被遮挡：${JSON.stringify(geometry)}`);
    assert.ok(geometry.width >= 44 && geometry.height >= 44 && geometry.focused,
      `${label} 触控尺寸或焦点异常：${JSON.stringify(geometry)}`);
  }
}

test('HTML 基本结构、资源独立性与默认静态学习', async page => {
  const structure = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    return {
      doctype: document.doctype?.name, lang: document.documentElement.lang, charset: document.characterSet,
      title: document.title, viewport: document.querySelector('meta[name="viewport"]')?.content,
      mains: document.querySelectorAll('main').length, headings: document.querySelectorAll('h1').length,
      duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
      brokenAria: [...document.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls]')].flatMap(element =>
        ['aria-labelledby', 'aria-describedby', 'aria-controls'].flatMap(name => (element.getAttribute(name) || '').split(/\s+/).filter(id => id && !document.getElementById(id)))),
      badButtons: [...document.querySelectorAll('button')].filter(button => button.type !== 'button' || !(button.getAttribute('aria-label') || button.textContent).trim()).map(button => button.id),
      scripts: [...document.scripts].map(script => script.getAttribute('src')),
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => ({ href: link.getAttribute('href'), loaded: Boolean(link.sheet) })),
      maxWidth: getComputedStyle(document.getElementById('coach')).maxWidth,
      live: document.getElementById('status').getAttribute('aria-live'),
      figureRole: document.getElementById('figure').getAttribute('role'),
      manifests: document.querySelectorAll('link[rel="manifest"]').length,
      controller: Boolean(navigator.serviceWorker?.controller)
    };
  });
  assert.equal(structure.doctype, 'html');
  assert.equal(structure.lang, 'zh-CN');
  assert.equal(structure.charset, 'UTF-8');
  assert.match(structure.title, /轻打卡.*样例/);
  assert.match(structure.viewport, /width=device-width/);
  assert.equal(structure.mains, 1);
  assert.equal(structure.headings, 1);
  for (const field of ['duplicates', 'brokenAria', 'badButtons']) assert.deepEqual(structure[field], [], field);
  assert.deepEqual(structure.scripts, ['./prototype.js']);
  assert.deepEqual(structure.styles, [{ href: './prototype.css', loaded: true }]);
  assert.equal(structure.maxWidth, '460px', 'CSS 必须生效');
  assert.equal(structure.live, 'polite');
  assert.equal(structure.figureRole, 'img');
  assert.equal(structure.manifests, 0);
  assert.equal(structure.controller, false);
  await frozen(page);
  assert.equal((await speechState(page)).calls.length, 0, '默认不自动播音');
});

for (const viewport of VIEWPORTS) test(`${viewport.width}×${viewport.height}：各阶段无横向溢出，按钮滚动可达`, async page => {
  assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), viewport);
  await fits(page, '学习');
  await click(page, '#about summary');
  await fits(page, '说明展开');
  await click(page, '#about summary');
  await click(page, '#motionButton');
  await advance(page, 2400);
  await fits(page, '学习动画');
  await click(page, '#primaryButton');
  await fits(page, '准备');
  await advance(page, 5200);
  await fits(page, '演示');
  await click(page, '#primaryButton');
  await fits(page, '暂停');
  await click(page, '#primaryButton');
  await advance(page, 20000);
  await matches(page, { stage: 'rest', playing: 'true' });
  await fits(page, '休息');
  await click(page, '#endButton');
  await learning(page);
  await fits(page, '返回学习');
  return '允许纵向滚动；未要求所有按钮首屏可见';
}, { viewport });

test('学习动画：双侧动作、暂停冻结、恢复与 Escape', async page => {
  await click(page, '#motionButton');
  await matches(page, { mode: 'learn', playing: 'true', motionPressed: 'true', selected: [] });
  await advance(page, 2400);
  const near = await ui(page);
  assert.notEqual(near.pose[0], POSE.rest);
  assert.equal(near.pose[2], POSE.farRest);
  await click(page, '#motionButton');
  await matches(page, { playing: 'false', motionPressed: 'false' });
  await frozen(page);
  await click(page, '#motionButton');
  assert.deepEqual((await ui(page)).pose, near.pose, '恢复瞬间不能重置姿态');
  await advance(page, 6000);
  const far = await ui(page);
  assert.equal(far.pose[0], POSE.rest);
  assert.notEqual(far.pose[2], POSE.farRest);
  await page.keyboard.press('Escape');
  await matches(page, { mode: 'learn', playing: 'false' });
  await frozen(page);
});

test('静态关键帧：选中状态、提示、姿态与停止正在播放的动画', async page => {
  const expected = [
    ['起始姿势', '坐稳，双脚平放。', POSE.rest],
    ['一侧轻抬', '一脚轻轻离地。', POSE.lifted],
    ['放回，再换侧', '慢慢放回，落稳再换侧。', POSE.rest]
  ];
  for (const index of [1, 2, 0]) {
    await click(page, '#motionButton');
    await advance(page, 1800);
    await click(page, `[data-frame="${index}"]`);
    const [label, cue, pose] = expected[index];
    const state = await matches(page, { mode: 'learn', playing: 'false', selected: [String(index)], label, cue });
    assert.equal(state.pose[0], pose);
    assert.equal(state.pose[2], POSE.farRest);
    assert.equal(state.figureTitle, '坐姿轻抬膝：' + label);
    await frozen(page);
  }
});

test('完整轻回合：5 秒准备 / 20 秒演示 / 10 秒休息自然结束，并取消语音', async page => {
  await click(page, '#soundButton');
  await naturalRound(page);
  const sound = await speechState(page);
  assert.deepEqual(sound.calls.slice(1).map(call => call.text), ['先坐稳，双脚平放。', '一脚轻轻离地，放稳后换脚。', '停下来，自然呼吸。']);
  assert.equal(sound.active, 0, '自然结束应取消尚未完成的语音');
});

for (const [name, ms] of [['prepare', 1600], ['move', 7400], ['rest', 27400]]) test(`${name}：暂停计时/姿态冻结、手动恢复、结束返回学习`, async page => {
  await click(page, '#primaryButton');
  await advance(page, ms);
  await matches(page, { mode: 'round', stage: name, playing: 'true' });
  await click(page, '#primaryButton');
  await matches(page, { playing: 'false', primary: '继续预览' });
  const paused = await frozen(page);
  await click(page, '#primaryButton');
  const resumed = await matches(page, { playing: 'true', stage: name, seconds: paused.seconds });
  assert.deepEqual(resumed.pose, paused.pose);
  await advance(page, 1100);
  const next = await ui(page);
  assert.equal(next.stage, name);
  assert.ok(next.seconds < paused.seconds && next.seconds >= paused.seconds - 2, '只累计恢复后约 1 秒，不补暂停的 60 秒');
  await click(page, '#endButton');
  const ended = await learning(page);
  assert.match(ended.status, /已结束预览.*没有保存/);
  await frozen(page);
  await click(page, '#primaryButton');
  await stage(page, 'prepare', 5);
});

// 确定性合成生命周期事件；不声称这是 OS 锁屏、真实标签页后台节流或 iPhone 验证。
for (const event of ['blur', 'visibilitychange', 'pagehide']) test(`${event}（事件模拟）：离页暂停、语音取消、回来不恢复/不补时`, async page => {
  await click(page, '#soundButton');
  await click(page, '#primaryButton');
  await advance(page, 7400);
  const before = await ui(page);
  const soundBefore = await speechState(page);
  lastAction = '模拟离页 ' + event;
  await page.evaluate(name => {
    if (name === 'visibilitychange') {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event(name));
    } else if (name === 'pagehide') window.dispatchEvent(new PageTransitionEvent(name, { persisted: true }));
    else window.dispatchEvent(new Event(name));
  }, event);
  const paused = await matches(page, { mode: 'round', playing: 'false', stage: 'move', seconds: before.seconds });
  assert.deepEqual(paused.pose, before.pose);
  const canceled = await speechState(page);
  assert.ok(canceled.cancels > soundBefore.cancels);
  assert.equal(canceled.active, 0);
  await frozen(page);
  await page.evaluate(name => {
    if (name === 'visibilitychange') {
      delete document.hidden;
      delete document.visibilityState;
      document.dispatchEvent(new Event(name));
    } else if (name === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    else window.dispatchEvent(new Event('focus'));
  }, event);
  assert.deepEqual(await ui(page), paused, '回到前台不得自动恢复');
  await frozen(page, 30000);
  assert.equal((await speechState(page)).calls.length, canceled.calls.length, '回来不得自动恢复语音');
  await click(page, '#primaryButton');
  await advance(page, 1100);
  const resumed = await ui(page);
  assert.equal(resumed.stage, 'move');
  assert.equal(resumed.playing, 'true');
  assert.ok(resumed.seconds < paused.seconds && resumed.seconds >= paused.seconds - 2);
});

test('rAF 长间隔：跳过 60 秒后主动暂停，不把未看见的时间补成完成', async page => {
  await click(page, '#soundButton');
  await click(page, '#primaryButton');
  await advance(page, 7400);
  const before = await ui(page);
  lastAction = 'clock.fastForward(60000)：模拟没有收到离页事件的长停顿';
  await page.clock.fastForward(60000);
  const paused = await matches(page, { mode: 'round', stage: 'move', playing: 'false', seconds: before.seconds });
  assert.deepEqual(paused.pose, before.pose);
  assert.match(paused.status, /播放中断.*不补后台时间/);
  assert.equal((await speechState(page)).active, 0);
  await frozen(page);
  await click(page, '#primaryButton');
  await advance(page, 1100);
  assert.equal((await ui(page)).stage, 'move');
  assert.ok((await ui(page)).seconds >= before.seconds - 2);
});

test('减少动态默认静态：学习和 round；用户仍能分别主动开启动画', async page => {
  assert.match((await ui(page)).status, /减少动态/);
  await frozen(page);
  await click(page, '#motionButton');
  await advance(page, 2400);
  const optedIn = await matches(page, { playing: 'true' });
  assert.notEqual(optedIn.pose[0], 'rotate(0.000 166 277)');
  await click(page, '#primaryButton');
  await stage(page, 'prepare', 5);
  await advance(page, 5200);
  const start = await stage(page, 'move', 20);
  flatPose(start);
  assert.match(start.label, /静态.*减少动态/);
  assert.equal(start.hidden.motionButton, false);
  await advance(page, 2400);
  const still = await ui(page);
  assert.deepEqual(still.pose, start.pose);
  assert.ok(still.seconds < start.seconds, '减少动态不能停掉正常计时');
  await fits(page, '减少动态 round 的主动播放按钮');
  await click(page, '#motionButton');
  await advance(page, 2400);
  const moving = await matches(page, { playing: 'true', motionPressed: 'true' });
  assert.notDeepEqual(moving.pose, still.pose);
  await click(page, '#primaryButton');
  await frozen(page);
  await click(page, '#endButton');
  await learning(page);
}, { reducedMotion: 'reduce' });

for (const mode of ['learn', 'round']) test(`${mode} 运行时切换减少动态：立即暂停，关闭偏好不自动恢复`, async page => {
  await click(page, '#soundButton');
  await click(page, mode === 'learn' ? '#motionButton' : '#primaryButton');
  await advance(page, mode === 'learn' ? 2400 : 7400);
  const before = await ui(page);
  lastAction = 'emulateMedia(reducedMotion=reduce)';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await until('减少动态 change 事件应暂停', () => ui(page), state => state.playing === 'false');
  flatPose(await matches(page, { mode, playing: 'false', seconds: before.seconds }));
  assert.equal((await speechState(page)).active, 0);
  await frozen(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // 给真实媒体查询事件一次调度机会，再推进模拟时钟。
  await delay(50);
  await frozen(page, 10000);
  await matches(page, { playing: 'false' });
  await click(page, '#motionButton');
  await advance(page, mode === 'learn' ? 1600 : 2400);
  const angle = Number((await ui(page)).pose[0].match(/rotate\(([-\d.]+)/)[1]);
  assert.ok(Math.abs(angle) > 0.1, '主动开启后应出现实际姿态变化，而不是 -0.000 舍入差异');
});

test('本机中文语音 mock：筛选、暂停/结束/关闭取消、过期错误不污染新语音', async page => {
  await click(page, '#soundButton');
  const enabled = await speechState(page);
  assert.equal(enabled.calls.length, 1);
  assert.equal(enabled.calls[0].voice.voiceURI, 'mock-local-zh');
  assert.equal(enabled.calls[0].voice.localService, true);
  assert.equal(enabled.calls[0].lang, 'zh-CN');
  assert.equal(enabled.calls[0].rate, 0.88);
  await click(page, '#motionButton');
  const playing = await speechState(page);
  await click(page, '#motionButton');
  const paused = await speechState(page);
  assert.ok(paused.cancels > playing.cancels);
  assert.equal(paused.active, 0);
  await frozen(page);
  assert.equal((await speechState(page)).calls.length, paused.calls.length);
  await click(page, '#primaryButton');
  await advance(page, 5200);
  const speaking = await speechState(page);
  await page.evaluate(() => window.__coachTest.speech.utterances[0].onerror({ error: 'network' }));
  await matches(page, { sound: 'true' });
  assert.equal((await speechState(page)).active, speaking.active);
  await click(page, '#primaryButton');
  assert.equal((await speechState(page)).active, 0);
  await click(page, '#primaryButton');
  assert.equal((await speechState(page)).active, 1);
  const beforeEnd = await speechState(page);
  await click(page, '#endButton');
  const ended = await speechState(page);
  assert.ok(ended.cancels > beforeEnd.cancels);
  assert.equal(ended.active, 0);
  await learning(page);
  await click(page, '#motionButton');
  assert.equal((await speechState(page)).active, 1);
  await click(page, '#soundButton');
  await matches(page, { sound: 'false', playing: 'true' });
  assert.equal((await speechState(page)).active, 0);
});

for (const speech of ['empty', 'remote-only', 'missing-api', 'missing-utterance']) test(`语音降级 ${speech}：保留文字，动画与预览仍可用`, async page => {
  await click(page, '#soundButton');
  const state = await matches(page, { sound: 'false' });
  assert.match(state.status, /没有可用的本机中文语音.*文字提示仍可用/);
  await click(page, '#motionButton');
  await advance(page, 2400);
  assert.notEqual((await ui(page)).pose[0], 'rotate(0.000 166 277)');
  await click(page, '#primaryButton');
  await advance(page, 5200);
  const move = await stage(page, 'move', 20);
  assert.ok(move.cue.length > 0 && move.detail.length > 0);
  await click(page, '#primaryButton');
  await frozen(page);
  await click(page, '#endButton');
  await learning(page);
  assert.deepEqual((await speechState(page)).calls, []);
}, { speech });

test('语音播放异常：同步抛错/当前 utterance.onerror 降级，可重试', async page => {
  await page.evaluate(() => { window.__coachTest.speech.fail = true; });
  await click(page, '#soundButton');
  assert.match((await matches(page, { sound: 'false' })).status, /无法播放口令.*文字提示/);
  await page.evaluate(() => { window.__coachTest.speech.fail = false; });
  await click(page, '#soundButton');
  await matches(page, { sound: 'true' });
  await page.evaluate(() => {
    const utterance = window.__coachTest.speech.active.pop();
    utterance.onerror({ error: 'synthesis-failed' });
  });
  assert.match((await matches(page, { sound: 'false' })).status, /语音未能播放.*文字提示仍可用/);
  await click(page, '#soundButton');
  await matches(page, { sound: 'true' });
  await click(page, '#primaryButton');
  await advance(page, 5200);
  await stage(page, 'move', 20);
});

test('离线：已打开页面的学习/预览/暂停/恢复/结束，不追加请求或持久化', async (page, context, requests) => {
  const initialRequests = [...requests];
  await context.setOffline(true);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  await click(page, '[data-frame="1"]');
  await frozen(page);
  await click(page, '#motionButton');
  await advance(page, 2400);
  await click(page, '#motionButton');
  await frozen(page);
  await click(page, '#soundButton');
  await click(page, '#primaryButton');
  await stage(page, 'prepare', 5);
  await advance(page, 7400);
  await matches(page, { stage: 'move', playing: 'true', seconds: 18 });
  await click(page, '#primaryButton');
  const paused = await frozen(page);
  await click(page, '#primaryButton');
  await advance(page, 1100);
  await matches(page, { stage: 'move', playing: 'true', seconds: paused.seconds - 1 });
  await click(page, '#endButton');
  await learning(page);
  assert.deepEqual(requests, initialRequests, '离线交互不得产生新的网络请求');
  return '仅已打开页面；不验证、不声称离线冷启动支持';
});

test('file:// 直接打开：资源加载、静态帧、动画暂停和预览交互', async page => {
  assert.equal(new URL(page.url()).protocol, 'file:');
  assert.equal(await page.locator('#coach').evaluate(element => getComputedStyle(element).maxWidth), '460px');
  await click(page, '[data-frame="1"]');
  const keyframe = await frozen(page);
  await click(page, '#motionButton');
  await advance(page, 1000);
  assert.notDeepEqual((await ui(page)).pose, keyframe.pose);
  await click(page, '#motionButton');
  await frozen(page);
  await click(page, '#primaryButton');
  await stage(page, 'prepare', 5);
  await advance(page, 5200);
  await stage(page, 'move', 20);
  await click(page, '#primaryButton');
  await frozen(page);
  await click(page, '#primaryButton');
  await advance(page, 1100);
  await stage(page, 'move', 19);
  await click(page, '#endButton');
  await learning(page);
}, { file: true });

const started = Date.now();
try {
  base = await localServer();
  if (stopping) throw new Error('服务启动期间测试中止');
  browser = await chromium.launch({
    headless: true, timeout: 15000, handleSIGINT: false, handleSIGTERM: false,
    ...(CHANNEL === 'chromium' || CHANNEL === 'bundled' ? {} : { channel: CHANNEL })
  });
  if (stopping) { await browser.close(); throw new Error('浏览器启动期间测试中止'); }
  console.log(`Gentle coach：${base}；${CHANNEL} ${browser.version()}；${cases.length} 项；仅临时 context；无截图/文件报告。`);
  for (const [name, work] of cases) {
    if (stopping) break;
    const since = Date.now();
    try {
      const note = await work();
      results.push({ name, passed: true });
      console.log(`PASS ${name}${note ? ' — ' + note : ''} (${Date.now() - since}ms)`);
    } catch (error) {
      results.push({ name, passed: false, error });
      process.exitCode = 1;
      console.error(`FAIL ${name}\n${error.stack || error}`);
    }
  }
} catch (error) {
  process.exitCode = 1;
  console.error('运行器失败：' + (error.stack || error));
  if (serverOutput) console.error(serverOutput.trim());
} finally {
  let cleaned = false;
  try { await cleanup(); cleaned = true; }
  catch (error) { process.exitCode = 1; console.error('清理失败：' + (error.stack || error)); }
  clearTimeout(watchdog);
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
  const passed = results.filter(result => result.passed).length;
  const failed = results.filter(result => !result.passed);
  const remaining = cases.filter(([name]) => !results.some(result => result.name === name));
  console.log(`\n摘要：${passed}/${cases.length} 通过，${failed.length} 失败，${remaining.length} 未运行；${((Date.now() - started) / 1000).toFixed(1)} 秒。`);
  for (const failure of failed) {
    const lines = failure.error.stack?.split('\n') || [];
    const location = lines.find(line => /test-coach-prototype\.mjs:\d+:\d+/.test(line))?.trim();
    const source = lines.find(line => /prototype\.js:\d+:\d+/.test(line))?.trim();
    console.error(`失败行：${failure.name} — ${failure.error.message.split('\n')[0]}${source ? '\n  原型：' + source : ''}${location ? '\n  测试：' + location : ''}`);
  }
  for (const [name] of remaining) console.error('未运行：' + name);
  if (cleaned) console.log('临时 context、测试 Chrome 和 Python 服务已关闭；未生成截图或修改原型/应用。');
  if (failed.length || remaining.length) process.exitCode ||= 1;
}
