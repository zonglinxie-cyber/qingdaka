#!/usr/bin/env node
// 只测试新版公开 UI/API。所有状态、下载和 SW 均位于临时 context；不使用个人 profile。
// TEST_UNIT_PAGE 仅保留为服务目录开关，不再打开旧单元测试页面，也不自动构建 dist。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIRECTORY = process.env.TEST_UNIT_PAGE === '0' ? 'dist' : '.';
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL?.trim() || 'chrome';
const KEY = 'qingdaka-habits-v1';
const WRITE_LOCK = KEY + ':write';
const SESSION_LOCK = 'qingdaka-habits:active-session';
const NOW = new Date('2026-11-05T04:00:00Z');
const TODAY = '2026-11-05';
const YESTERDAY = '2026-11-04';
const SETTINGS = { onboarded: true, focus: 'move', anchor: 'work', wakeTime: '07:40', windDownTime: '22:30', sound: false, motion: true };
const results = [];
const contexts = new Set();
let server, browser, base, serverOutput = '', lastAction = '', stopping = false, cleanupPromise;

async function localServer() {
  // 让操作系统分配端口，避免先探测后绑定的竞争；始终只监听 loopback。
  server = spawn('python3', ['-u', 'serve.py', '0', '--host', '127.0.0.1', '--directory', DIRECTORY], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolveServer, reject) => {
    let settled = false;
    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolveServer(url);
    };
    const timer = setTimeout(() => finish(new Error('serve.py 启动超时：' + serverOutput)), 15000);
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
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise(resolveExit => server.once('exit', resolveExit));
  server.kill('SIGINT');
  const force = setTimeout(() => server.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(force); }
}

function cleanup() {
  cleanupPromise ??= (async () => {
    try {
      await Promise.allSettled([...contexts].map(context => context.close()));
      if (browser) await browser.close();
    } finally { await stopServer(); }
  })();
  return cleanupPromise;
}

function stop(reason, code = 1) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  console.error('\n' + reason);
  void cleanup().catch(error => console.error('清理失败：', error.message));
}
const onInterrupt = () => stop('收到 SIGINT，关闭临时浏览器和 serve.py。', 130);
const onTerminate = () => stop('收到 SIGTERM，关闭临时浏览器和 serve.py。', 143);
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);
// 为外层 180 秒超时预留清理时间；关闭浏览器会中止仍在等待的 Playwright 操作。
const watchdog = setTimeout(() => stop('E2E 超过 165 秒，已中止；未完成的检查不算通过。'), 165000);

async function until(label, read, predicate = Boolean, timeout = 7000) {
  const end = Date.now() + timeout;
  let value;
  do {
    if (stopping) throw new Error('测试已中止：' + label);
    value = await read();
    if (predicate(value)) return value;
    // 用 Node 实时时钟轮询异步存储；页面计时被冻结时，不依赖页面的 setTimeout/rAF。
    await delay(25);
  } while (Date.now() < end);
  assert.fail(`${label}：等待超时，最后结果 ${JSON.stringify(value)}`);
}
const rawState = page => page.evaluate(key => localStorage.getItem(key), KEY);
const state = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const stateWhen = (page, label, predicate) => until(label, () => state(page), value => value && predicate(value));
const text = (page, selector) => page.locator(selector).innerText();
const textIs = (page, selector, expected) => until(`${selector} 应为 ${expected}`, () => text(page, selector), value => value === expected);
const visible = (page, selector) => page.locator(selector).waitFor({ state: 'visible' });
const hidden = (page, selector) => page.locator(selector).waitFor({ state: 'hidden' });
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 0.01, `${label}：期望 ${expected}，实际 ${actual}`);
}
async function click(page, selector) {
  lastAction = `点击 ${selector}`;
  await page.locator(selector).click();
}
async function nav(page, name) {
  await click(page, `.bottom-nav [data-page="${name}"]`);
  await visible(page, `#page-${name}`);
}
async function closeDialog(page, id) {
  await click(page, `[data-close="${id}"]`);
  await hidden(page, '#' + id);
}
async function openDetails(details) {
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
}
async function imageLoaded(page, selector) {
  await visible(page, selector);
  await until(`${selector} 应完成解码而非破图`, () => page.locator(selector).evaluate(image => ({
    src: image.getAttribute('src'), complete: image.complete, width: image.naturalWidth, height: image.naturalHeight
  })), value => value.complete && value.width > 0 && value.height > 0);
}

function observe(page, evidence) {
  page.on('pageerror', error => evidence.pageErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) evidence.httpErrors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => evidence.requestsFailed.push(`${request.url()} ${request.failure()?.errorText}`));
}

async function openApp(page, { storageFault = false, url = base + '/index.html' } = {}) {
  lastAction = `打开 ${url}`;
  const response = await page.goto(url, { waitUntil: 'load' });
  assert.equal(response?.status(), 200, 'index.html 必须可访问；dist 模式需要已生成的新版产物');
  const runtime = await page.evaluate(() => ({
    title: document.title,
    content: typeof window.QDK_CONTENT?.buildPlan,
    store: typeof window.QDK_STORE?.get,
    session: typeof window.QDK_SESSION?.create,
    scripts: [...document.scripts].map(script => script.getAttribute('src'))
  }));
  assert.match(runtime.title, /轻打卡/);
  assert.ok(runtime.content === 'function' && runtime.store === 'function' && runtime.session === 'function',
    '新版模块未正确加载，请检查 index.html 的 script src 与浏览器错误：' + JSON.stringify(runtime));
  if (storageFault) await visible(page, '#storageAlert');
  else {
    await until('应用完成首次设置初始化', () => page.locator('#setupDialog').isVisible());
    const initial = await page.evaluate(() => window.QDK_STORE.get());
    assert.equal(initial.version, 1);
    assert.equal(initial.settings.onboarded, false);
    assert.deepEqual(initial.sessions, []);
    assert.equal(initial.activeSession, null);
  }
}

async function withApp(work, { viewport = { width: 390, height: 844 }, serviceWorkers = 'block', clock = true, init, storageFault = false } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', acceptDownloads: true });
  contexts.add(context);
  context.setDefaultTimeout(7000);
  context.setDefaultNavigationTimeout(15000);
  const evidence = { pageErrors: [], consoleErrors: [], httpErrors: [], requestsFailed: [] };
  context.on('page', page => observe(page, evidence));
  let page;
  try {
    if (init) await context.addInitScript(init.fn, init.arg);
    page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(15000);
    if (clock) {
      await page.clock.install({ time: new Date(NOW.getTime() - 1000) });
      // 尚无应用计时器时冻结；之后只用 runFor，逐个执行 200ms tick，不跳过后台时间。
      await page.clock.pauseAt(NOW);
    }
    await openApp(page, { storageFault });
    const note = await work(page, context, evidence);
    assert.deepEqual(evidence.pageErrors, [], '基础流程不得产生未捕获 pageerror');
    return note;
  } catch (error) {
    let ui;
    try {
      const currentPage = page && !page.isClosed() ? page : context.pages().filter(tab => tab.url().startsWith(base + '/')).at(-1);
      ui = await currentPage?.evaluate(() => ({
        url: location.href,
        openDialogs: [...document.querySelectorAll('dialog[open]')].map(dialog => dialog.id),
        phase: document.querySelector('#playerPhase')?.textContent,
        clock: document.querySelector('#playerClock')?.textContent,
        storageAlert: !document.querySelector('#storageAlert')?.hidden,
        finishError: document.querySelector('#finishError')?.hidden === false ? document.querySelector('#finishError').textContent : null
      }));
    } catch { /* 页面关闭时仍保留原断言及已收集的错误。 */ }
    console.error('  最后操作：' + lastAction);
    console.error('  现场：' + JSON.stringify(ui));
    for (const [kind, entries] of Object.entries(evidence)) {
      if (entries.length) console.error(`  ${kind}:\n    ` + entries.slice(0, 8).join('\n    '));
    }
    throw error;
  } finally {
    try { await context.close(); } finally { contexts.delete(context); }
  }
}

async function fillSettings(page, settings = SETTINGS) {
  await page.locator('#focusInput').selectOption(settings.focus);
  await page.locator('#anchorInput').selectOption(settings.anchor);
  await page.locator('#wakeInput').fill(settings.wakeTime);
  await page.locator('#windInput').fill(settings.windDownTime);
  await page.locator('#soundInput').setChecked(settings.sound);
  await click(page, '#setupForm button[type="submit"]');
  await hidden(page, '#setupDialog');
  const saved = await stateWhen(page, '设置写入成功', value => value.settings.onboarded);
  assert.deepEqual(saved.settings, settings);
}
async function settingsFields(page, expected) {
  for (const [id, key] of [['focusInput', 'focus'], ['anchorInput', 'anchor'], ['wakeInput', 'wakeTime'], ['windInput', 'windDownTime']]) {
    assert.equal(await page.locator('#' + id).inputValue(), expected[key], id + ' 应回填已保存的设置');
  }
  assert.equal(await page.locator('#soundInput').isChecked(), expected.sound);
}
async function safetyGate(page) {
  await visible(page, '#safetyDialog');
  assert.equal(await page.locator('#equipmentCheck').isChecked(), false, '每次进入 safe gate 都必须重新主动勾选');
  assert.equal(await page.locator('#safetyBegin').isDisabled(), true, '默认未确认，不可开始');
  assert.equal(await page.locator('#player').isVisible(), false);
}
async function approve(page) {
  await page.locator('#equipmentCheck').check();
  assert.equal(await page.locator('#safetyBegin').isEnabled(), true);
  await click(page, '#safetyBegin');
  await visible(page, '#player');
  await stateWhen(page, '播放器已开始并保存 running', value => value.activeSession?.phase === 'running');
  await imageLoaded(page, '#playerImage');
}
async function startCourse(page, courseId = 'minute', mode = 'seated') {
  await nav(page, 'move');
  await click(page, `[data-course="${courseId}"]`);
  await click(page, `[data-mode="${mode}"]`);
  await click(page, '#moveStart');
  await safetyGate(page);
  await approve(page);
}
async function currentPlan(page, courseId, mode) {
  return page.evaluate(({ courseId, mode }) => window.QDK_CONTENT.buildPlan(courseId, mode), { courseId, mode });
}

async function runNatural(page, courseId, mode) {
  const expected = courseId === 'minute' ? { elapsed: 60, active: 20 } : { elapsed: 180, active: 80 };
  const plan = await currentPlan(page, courseId, mode);
  assert.equal(plan.reduce((sum, step) => sum + step.seconds, 0), expected.elapsed, '1/3 分钟必须是真正的总流程长度');
  assert.equal(plan.filter(step => step.kind === 'move').reduce((sum, step) => sum + step.seconds, 0), expected.active);
  await startCourse(page, courseId, mode);
  let elapsed = 0, active = 0;
  for (const [index, step] of plan.entries()) {
    await imageLoaded(page, '#playerImage');
    assert.equal(await text(page, '#playerTitle'), step.name);
    assert.equal(await page.locator('#playerImage').getAttribute('src'), step.image);
    lastAction = `${courseId}/${mode} 第 ${index + 1} 段 ${step.kind}，runFor(${step.seconds * 1000})`;
    // runFor 会执行所有中间 tick；fastForward 大跨度会被引擎当成后台挂起，绝不能替代。
    await page.clock.runFor(step.seconds * 1000);
    elapsed += step.seconds;
    if (step.kind === 'move') active += step.seconds;
    const done = index === plan.length - 1;
    const saved = await stateWhen(page, '自然切段的 checkpoint', value => done
      ? value.activeSession?.phase === 'done'
      : value.activeSession?.stepIndex === index + 1 && value.activeSession.phase === 'running');
    near(saved.activeSession.elapsedSeconds, elapsed, step.kind + ' 后流程秒数');
    near(saved.activeSession.activeSeconds, active, step.kind + ' 后活动秒数（准备/休息/收尾不加活动秒）');
  }
  await visible(page, '#finishDialog');
  await hidden(page, '#player');
  const saved = await state(page);
  near(saved.activeSession.elapsedSeconds, expected.elapsed, '自然结束总秒数');
  near(saved.activeSession.activeSeconds, expected.active, '自然结束实际活动秒数');
  assert.equal(saved.sessions.length, 0, 'done 只保留待保存状态，不应提前生成历史记录');
  assert.match(await text(page, '#finishSummary'), /准备、休息与收尾没有算作活动/);
  assert.equal(await page.locator('[data-feedback][aria-pressed="true"]').count(), 0, '感受不得代选');
  return saved.activeSession;
}

async function saveFinish(page, feedback = 'okay') {
  const before = await state(page);
  assert.equal(before.activeSession?.phase, 'done');
  const id = before.activeSession.id;
  await click(page, `[data-feedback="${feedback}"]`);
  await click(page, '#saveSession');
  const after = await stateWhen(page, '完成反馈保存一次', value => !value.activeSession && value.sessions.some(item => item.id === id));
  await hidden(page, '#finishDialog');
  assert.equal(after.sessions.length, before.sessions.length + 1);
  assert.equal(after.sessions.find(item => item.id === id).feedback, feedback);
  return after.sessions.find(item => item.id === id);
}

async function learnAll(page) {
  await nav(page, 'move');
  await click(page, '[data-course="steady"]');
  const seen = [];
  for (const mode of ['seated', 'standing']) {
    await click(page, `[data-mode="${mode}"]`);
    const moves = await page.evaluate(mode => window.QDK_CONTENT.moves.filter(move => move.mode === mode), mode);
    assert.equal(await page.locator('#learningList [data-learn]').count(), moves.length);
    assert.match(await text(page, '#modeGear'), mode === 'seated' ? /无轮.*承重.*稳定/ : /无痛.*稳定/);
    for (const move of moves) {
      await click(page, `[data-learn="${move.id}"]`);
      await visible(page, '#learnDialog');
      await imageLoaded(page, '#learnImage');
      assert.equal(await text(page, '#learnTitle'), move.name);
      assert.equal(await page.locator('#learnImage').getAttribute('src'), move.image);
      assert.equal(await page.locator('#learnImage').getAttribute('alt'), move.imageAlt);
      assert.deepEqual(await page.locator('#learnSteps li').allTextContents(), move.steps);
      assert.equal(await text(page, '#learnCaution'), move.caution);
      assert.match(move.image, /^\.\/assets\/habit-guides\/[^/]+\.svg$/);
      seen.push(move.id);
      await closeDialog(page, 'learnDialog');
    }
  }
  assert.deepEqual(seen.sort(), ['seated-arms', 'seated-chest', 'seated-knee', 'seated-neck', 'standing-shoulders', 'standing-walk']);
  assert.equal((await state(page)).activeSession, null, '学习图不应启动计时');
  return seen.length;
}

async function recordDay(page, date, wakeTime, windDown) {
  await page.locator('#recordDate').fill(date);
  await page.locator('#actualWake').fill(wakeTime);
  await page.locator('#actualWind').setChecked(windDown);
  await click(page, '#recordForm button[type="submit"]');
  await hidden(page, '#recordDialog');
  return stateWhen(page, '保存指定日期的实际记录', value => value.days[date]?.wakeTime === (wakeTime || undefined) && value.days[date]?.windDown === windDown);
}

async function download(page, selector) {
  const event = page.waitForEvent('download');
  await click(page, selector);
  const file = await event;
  assert.equal(await file.failure(), null, '浏览器下载不能失败');
  assert.match(file.suggestedFilename(), /\.json$/);
  const path = await file.path();
  assert.ok(path, '下载应落入临时浏览器目录');
  return { name: file.suggestedFilename(), raw: await readFile(path, 'utf8') };
}
async function importDialog(page, backup) {
  await nav(page, 'review');
  await openDetails(page.locator('#backupDetails'));
  // 通过实际按钮打开文件选择器，而不是直接调用 store.importData 绕过确认。
  const event = page.waitForEvent('filechooser');
  await click(page, '#importBackup');
  await (await event).setFiles({ name: 'e2e-habits-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await visible(page, '#messageDialog');
  assert.match(await text(page, '#messageTitle'), /核对.*恢复/);
  assert.match(await text(page, '#messageBody'), /覆盖.*不合并/);
  assert.match(await text(page, '#messageConfirm'), /确认覆盖/);
}
function portableState(value) {
  const { revision, updatedAt, ...data } = value;
  return data;
}

const lockState = page => page.evaluate(() => navigator.locks.query());
const pendingWrites = (page, count = 1) => until(`应有 ${count} 个真实写锁请求排队`, () => lockState(page), locks => locks.pending.filter(lock => lock.name === WRITE_LOCK).length === count);
const lockReleased = (page, name) => until(name + ' 应已释放', () => lockState(page), locks => ![...locks.held, ...locks.pending].some(lock => lock.name === name));

async function withWriteLock(page, work) {
  // 持有浏览器真实锁，不替换 store.transact；句柄只保留测试自己的释放函数。
  const control = await page.evaluateHandle(name => {
    const control = { held: false };
    const gate = new Promise(resolveGate => { control.release = resolveGate; });
    control.done = navigator.locks.request(name, async lock => {
      if (!lock) throw new Error('E2E 无法持有写锁');
      control.held = true;
      await gate;
      control.held = false;
    });
    return control;
  }, WRITE_LOCK);
  let released = false;
  const release = async () => {
    if (released || page.isClosed()) return;
    released = true;
    await control.evaluate(async control => { control.release(); await control.done; });
  };
  try {
    await until('测试夹具已占用真实写锁', () => control.evaluate(control => control.held));
    return await work(release);
  } finally {
    try { await release(); } finally { await control.dispose(); }
  }
}

async function withWriteFailure(page, work) {
  const restore = await page.evaluateHandle(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('E2E checkpoint quota exhausted', 'QuotaExceededError');
      return original.call(this, name, value);
    };
    return () => { Storage.prototype.setItem = original; };
  }, KEY);
  try { return await work(); }
  finally {
    try { if (!page.isClosed()) await restore.evaluate(fn => fn()); }
    finally { await restore.dispose(); }
  }
}

async function simulateVisibility(page, isHidden) {
  lastAction = `模拟 document.hidden=${isHidden} 并派发 visibilitychange`;
  await page.evaluate(isHidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => isHidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, isHidden);
}
async function restoreVisibility(page) {
  if (!page.isClosed()) await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function playerFits(page, label) {
  const report = await page.locator('#player').evaluate(player => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { id: element.id || element.className, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const buttons = [...player.querySelectorAll('button')].map(button => {
      const r = rect(button), style = getComputedStyle(button);
      // 圆角外的矩形角点本来就不属于按钮；采样中心和四边中点，完整边界另行断言。
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const points = [[cx, cy], [r.x + 2, cy], [r.right - 2, cy], [cx, r.y + 2], [cx, r.bottom - 2]];
      const hits = points.map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return { x, y, target: hit?.id || hit?.className || hit?.tagName, inside: button.contains(hit) };
      });
      return { ...r, visible: style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0,
        borderRadius: style.borderRadius, hits, reachable: hits.every(hit => hit.inside) };
    });
    const overlap = (a, b) => a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;
    const overlaps = [];
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
      if (overlap(buttons[i], buttons[j])) overlaps.push([buttons[i].id, buttons[j].id]);
    }
    const blocks = [...player.children].map(rect);
    const blockOverlaps = [];
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      if (overlap(blocks[i], blocks[j])) blockOverlaps.push([blocks[i].id, blocks[j].id]);
    }
    return { buttons, overlaps, blockOverlaps, width: innerWidth, height: innerHeight,
      scrolls: player.scrollHeight > player.clientHeight + 1 || player.scrollWidth > player.clientWidth + 1,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.deepEqual(report.buttons.map(button => button.id).sort(), ['playerClose', 'playerDiscomfort', 'playerEnd', 'playerPause', 'playerSkip']);
  for (const button of report.buttons) {
    assert.ok(button.visible && button.reachable && button.width > 0 && button.height > 0 && button.x >= -1 && button.y >= -1 && button.right <= report.width + 1 && button.bottom <= report.height + 1,
      `${label} 按钮必须不滚动就完整可见、可点：${JSON.stringify(button)}`);
  }
  assert.deepEqual(report.overlaps, [], label + ' 播放器按钮不得重叠');
  assert.deepEqual(report.blockOverlaps, [], label + ' 播放器内容不得压住控制区');
  assert.equal(report.scrolls, false, label + ' 播放器不应需要滚动才能找按钮');
  assert.equal(report.horizontalOverflow, false, label + ' 页面不得横向溢出');
}

const cases = [
  ['首次设置 / 新版启动 / 无蛋白入口', '全新临时浏览器打开首页 → 填写并保存首次设置 → 逐个打开四个导航。', () => withApp(async page => {
    assert.equal(await page.locator('#wakeInput').inputValue(), '');
    assert.equal(await page.locator('#windInput').inputValue(), '');
    assert.equal(await page.locator('#soundInput').isChecked(), true);
    assert.deepEqual(await page.locator('.bottom-nav [data-page]').evaluateAll(buttons => buttons.map(button => button.dataset.page)), ['today', 'move', 'rhythm', 'review']);
    await fillSettings(page);
    for (const name of ['today', 'move', 'rhythm', 'review']) {
      await nav(page, name);
      const entries = await page.locator('button:visible, a:visible, input:visible, select:visible').evaluateAll(elements => elements.map(element => [element.textContent, element.id, element.getAttribute('aria-label'), element.getAttribute('data-page')].join(' ')).join('\n'));
      assert.doesNotMatch(entries, /蛋白|protein|营养打卡/i, '新版不得残留蛋白入口');
    }
    await page.reload();
    await until('刷新后设置仍存在', () => state(page), value => value?.settings.onboarded);
    assert.equal(await page.locator('#setupDialog').isVisible(), false, '首次设置不能每次刷新重新弹出');
    assert.deepEqual((await state(page)).settings, SETTINGS);
  })],
  ['今日最短回合 / safe gate 默认不勾', '选择 5 分钟站姿 → 今天 → 开始 → 未勾选尝试键盘提交 → 勾选后关闭并重开 → 开始。', () => withApp(async page => {
    await fillSettings(page);
    await nav(page, 'move');
    await click(page, '[data-course="steady"]');
    await click(page, '[data-mode="standing"]');
    await nav(page, 'today');
    await click(page, '#todayStart');
    await safetyGate(page);
    assert.match(await text(page, '#equipmentCheckText'), /椅子.*稳固/);
    await page.locator('#equipmentCheck').focus();
    await page.keyboard.press('Enter');
    await page.clock.runFor(3000);
    assert.equal((await state(page)).activeSession, null, '未勾选时不能创建活动');
    assert.deepEqual((await state(page)).sessions, []);
    await page.locator('#equipmentCheck').check();
    await closeDialog(page, 'safetyDialog');
    await click(page, '#todayStart');
    await safetyGate(page);
    await approve(page);
    const current = (await state(page)).activeSession;
    assert.equal(current.courseId, 'minute', '今天入口始终从最短回合开始，不继承 5 分钟');
    assert.equal(current.mode, 'seated');
    assert.equal(JSON.parse(current.planKey).reduce((sum, row) => sum + row[2], 0), 60);
  })],
  ['痛风 / 急症 / 不确定拦截', '分别从坐姿和站姿的安全确认中选择关节发作、急症、不确定；不允许自动换动作启动。', () => withApp(async page => {
    await fillSettings(page);
    for (const [mode, button, title, body] of [
      ['standing', 'safetyJoint', /先照顾身体/, /痛风.*不开始.*紧急医疗评估/],
      ['seated', 'safetyEmergency', /立即寻求急救/, /急救.*120/],
      ['standing', 'safetyUnsure', /不必急着开始/, /医生.*休息/]
    ]) {
      await nav(page, 'move');
      await click(page, `[data-mode="${mode}"]`);
      await click(page, '#moveStart');
      await safetyGate(page);
      await page.locator('#equipmentCheck').check();
      await click(page, '#' + button);
      await visible(page, '#messageDialog');
      assert.match(await text(page, '#messageTitle'), title);
      assert.match(await text(page, '#messageBody'), body);
      await page.clock.runFor(5000);
      const saved = await stateWhen(page, '安全拦截的休息标记最终保存', value => value.days[TODAY]?.rest === true);
      assert.equal(saved.activeSession, null, button + ' 不得启动计时');
      assert.deepEqual(saved.sessions, []);
      assert.equal(saved.days[TODAY].rest, true);
      assert.equal(await page.locator('#player').isVisible(), false);
      assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'), 'true', '拦截不能自动换成另一姿势');
      await click(page, '#messageConfirm');
    }
  })],
  ['写锁占用时急症立即提示', '占用新版写锁 → 安全确认选择急症 → 不释放锁就检查急救弹窗 → 释放后再核对休息记录。', () => withApp(async page => {
    await fillSettings(page);
    await click(page, '#todayStart');
    await safetyGate(page);
    await withWriteLock(page, async release => {
      const before = await rawState(page);
      await click(page, '#safetyEmergency');
      // 不用等待弹窗或释放锁：点击返回时急救信息就必须已显示。
      assert.equal(await page.locator('#messageDialog').isVisible(), true, '急救提示不能 await 被占用的写锁');
      assert.match(await text(page, '#messageTitle'), /立即寻求急救/);
      assert.match(await text(page, '#messageBody'), /急救.*120/);
      assert.equal(await page.locator('#safetyDialog').isVisible(), false);
      assert.equal(await page.locator('#player').isVisible(), false);
      await pendingWrites(page);
      assert.equal(await rawState(page), before, '此时写锁尚未释放，不能伪造写入成功');
      assert.equal((await state(page)).activeSession, null);
      await release();
      const saved = await stateWhen(page, '释放写锁后休息标记落盘', value => value.days[TODAY]?.rest === true);
      assert.deepEqual(saved.sessions, []);
      assert.equal(saved.activeSession, null);
      assert.equal(await page.locator('#messageDialog').isVisible(), true, '写盘完成不能把急救提示收走');
    });
  })],
  ['checkpoint 失败收起不能假成功', '运行至活动段 → 留下 1 秒尚未保存的活动 → 注入写入失败 → 收起必须保留播放器 → 恢复存储后重试并继续原进度。', () => withApp(async (page, context, evidence) => {
    await fillSettings(page);
    await startCourse(page);
    await page.clock.runFor(20000);
    await click(page, '#playerPause');
    const durable = (await stateWhen(page, '建立已保存的暂停基线', value => value.activeSession?.phase === 'paused')).activeSession;
    near(durable.activeSeconds, 5, '已保存活动基线');
    await click(page, '#playerPause');
    await stateWhen(page, '明确继续原回合', value => value.activeSession?.phase === 'running');
    await page.clock.runFor(1000);
    const before = await rawState(page);
    await withWriteFailure(page, async () => {
      await click(page, '#playerClose');
      await textIs(page, '#toast', '暂未保存，进度仍保留在此页；请重试，不要刷新。');
      assert.equal(await page.locator('#player').isVisible(), true, 'checkpoint 失败不能收起后谎报已保留');
      assert.match(await text(page, '#playerSaved'), /尚未保存.*已暂停/);
      assert.equal(await text(page, '#playerPause'), '继续');
      assert.equal(await rawState(page), before, '失败不能改动最后一份可恢复原文');
      assert.equal((await lockState(page)).held.filter(lock => lock.name === SESSION_LOCK).length, 1, '未保存的 engine 仍由此页持有');
      const clock = await text(page, '#playerClock');
      await page.clock.runFor(5000);
      assert.equal(await text(page, '#playerClock'), clock, '错误后不能继续在后台计时');
      assert.ok(evidence.consoleErrors.some(message => /Save failed|QDKStoreError/.test(message)));
    });
    await click(page, '#playerClose');
    await hidden(page, '#player');
    await visible(page, '#resumeCard');
    const kept = (await stateWhen(page, '重试收起保存内存中尚未落盘的进度', value => value.activeSession?.phase === 'paused')).activeSession;
    assert.equal(kept.id, durable.id);
    near(kept.elapsedSeconds, 21, '失败期间仍保留实际流程秒数');
    near(kept.activeSeconds, 6, '不能退回最后 checkpoint 丢掉刚才的 1 秒');
    await lockReleased(page, SESSION_LOCK);
    await click(page, '#resumeSession');
    await safetyGate(page);
    await approve(page);
    await page.clock.runFor(1000);
    await click(page, '#playerEnd');
    await stateWhen(page, '原回合提前结束', value => value.activeSession?.phase === 'done');
    const record = await saveFinish(page);
    assert.equal(record.id, durable.id);
    assert.equal(record.status, 'stopped');
    near(record.activeSeconds, 7, '重试后 engine 可以继续且不丢活动秒');
    near(record.elapsedSeconds, 22, '错误暂停的等待时间不计入流程');
  })],
  ...[false, true].map(returnBeforeRelease => [
    `后台 pending 开始/继续不重启（${returnBeforeRelease ? '先返回前台再解锁' : '保持隐藏再解锁'}）`,
    '占用写锁使开始/继续处于 pending → hidden 事件 → 可选先回前台 → 解锁 → 检查旧请求不启动，只有新点击才可开始。',
    () => withApp(async page => {
      await fillSettings(page);
      try {
        await click(page, '#todayStart');
        await safetyGate(page);
        await page.locator('#equipmentCheck').check();
        await withWriteLock(page, async release => {
          await click(page, '#safetyBegin');
          await pendingWrites(page);
          assert.equal((await state(page)).activeSession, null, '开始仍等待首次写入');
          await simulateVisibility(page, true);
          if (returnBeforeRelease) await simulateVisibility(page, false);
          await release();
          await lockReleased(page, SESSION_LOCK);
          await until('旧的开始请求已退出 finally', () => page.locator('#safetyBegin').isEnabled());
        });
        assert.equal(await page.locator('#player').isVisible(), false, '后台 pending 开始不得晚到后打开播放器');
        let kept = (await state(page)).activeSession;
        assert.ok(kept && ['ready', 'paused'].includes(kept.phase), '首次写入可保留未运行的进度，不能标为 running');
        near(kept.elapsedSeconds, 0, 'pending 开始无流程计时');
        await page.clock.runFor(5000);
        await simulateVisibility(page, false);
        await page.clock.runFor(5000);
        assert.deepEqual((await state(page)).activeSession, kept, '返回前台也不得自动消费旧开始意图');
        assert.equal(await page.locator('#player').isVisible(), false);
        if (await page.locator('#safetyDialog').isVisible()) await closeDialog(page, 'safetyDialog');
        await visible(page, '#resumeCard');
        await click(page, '#resumeSession');
        await safetyGate(page);
        await approve(page);
        await page.clock.runFor(20000);
        await click(page, '#playerPause');
        kept = (await stateWhen(page, '为 pending 继续建立暂停基线', value => value.activeSession?.phase === 'paused')).activeSession;
        const clock = await text(page, '#playerClock');
        await withWriteLock(page, async release => {
          await click(page, '#playerPause');
          await pendingWrites(page);
          await simulateVisibility(page, true);
          if (returnBeforeRelease) await simulateVisibility(page, false);
          await release();
          await lockReleased(page, WRITE_LOCK);
        });
        await page.clock.runFor(5000);
        await simulateVisibility(page, false);
        await page.clock.runFor(5000);
        const after = (await state(page)).activeSession;
        assert.equal(after.phase, 'paused', '异步继续不得在隐藏或 epoch 过期后重启');
        assert.equal(await text(page, '#playerPause'), '继续');
        assert.equal(await text(page, '#playerClock'), clock);
        near(after.activeSeconds, kept.activeSeconds, 'pending 继续不补活动秒');
        near(after.elapsedSeconds, kept.elapsedSeconds, 'pending 继续不补后台时间');
        await click(page, '#playerPause');
        await stateWhen(page, '返回前台后的新点击可以继续', value => value.activeSession?.phase === 'running');
        await page.clock.runFor(1000);
        await click(page, '#playerPause');
        const resumed = (await stateWhen(page, '新点击继续后可再次暂停', value => value.activeSession?.phase === 'paused')).activeSession;
        near(resumed.activeSeconds, kept.activeSeconds + 1, '只计入新点击后的活动');
      } finally { await restoreVisibility(page); }
    })
  ]),
  ['多标签 session lock / 并发 days 不丢', 'A 暂停仍占 session lock → B 恢复被拒 → A 收起后 B 接手 → 两标签写锁下并发写同一天不同字段和不同日期。', () => withApp(async (page, context) => {
    await fillSettings(page);
    await startCourse(page);
    await page.clock.runFor(20000);
    await click(page, '#playerPause');
    const first = (await stateWhen(page, 'A 暂停但仍拥有回合', value => value.activeSession?.phase === 'paused')).activeSession;
    const other = await context.newPage();
    await other.goto(base + '/index.html#move', { waitUntil: 'load' });
    await visible(other, '#resumeCard');
    assert.equal(new URL(other.url()).hash, '#today', '未完成活动优先回到今天，不能被旧 hash 藏住');
    await click(other, '#resumeSession');
    await safetyGate(other);
    await other.locator('#equipmentCheck').check();
    await click(other, '#safetyBegin');
    await textIs(other, '#toast', '另一个页面正在处理这次活动，请先在那里暂停并收起。');
    assert.equal(await other.locator('#player').isVisible(), false);
    assert.deepEqual((await state(other)).activeSession, first, 'B 不得覆盖 A 的暂停快照');
    assert.equal((await lockState(other)).held.filter(lock => lock.name === SESSION_LOCK).length, 1);
    await closeDialog(other, 'safetyDialog');
    await click(page, '#playerClose');
    await hidden(page, '#player');
    await lockReleased(page, SESSION_LOCK);
    await click(other, '#resumeSession');
    await safetyGate(other);
    await approve(other);
    assert.equal((await state(other)).activeSession.id, first.id, 'B 接手同一回合而非重复建档');
    await click(page, '#resumeSession');
    await safetyGate(page);
    await page.locator('#equipmentCheck').check();
    await click(page, '#safetyBegin');
    await textIs(page, '#toast', '另一个页面正在处理这次活动，请先在那里暂停并收起。');
    assert.equal(await page.locator('#player').isVisible(), false, '锁转交 B 后 A 也不能同时启动');
    await closeDialog(page, 'safetyDialog');
    await click(other, '#playerEnd');
    await stateWhen(other, 'B 结束接手的回合', value => value.activeSession?.phase === 'done');
    const record = await saveFinish(other);
    assert.equal(record.id, first.id);
    near(record.activeSeconds, 5, '跨标签不重复计时');
    await lockReleased(other, SESSION_LOCK);
    await click(page, '#recordWake');
    await page.locator('#recordDate').fill(TODAY);
    await page.locator('#actualWake').fill('07:12');
    await page.locator('#actualWind').check();
    await click(other, '#recordBreak');
    await withWriteLock(page, async release => {
      const before = await rawState(page);
      await Promise.all([click(page, '#recordForm button[type="submit"]'), click(other, '#messageConfirm')]);
      await pendingWrites(page, 2);
      assert.equal(await rawState(page), before);
      await release();
      await stateWhen(page, '同一天的不同字段均保留', value => value.days[TODAY]?.wakeTime === '07:12' && value.days[TODAY]?.windDown === true && value.days[TODAY]?.breaks === 1);
    });
    await hidden(page, '#recordDialog');
    for (const [tab, date, wake] of [[page, YESTERDAY, '08:20'], [other, '2026-11-03', '09:10']]) {
      await click(tab, '#recordWake');
      await tab.locator('#recordDate').fill(date);
      await tab.locator('#actualWake').fill(wake);
      await tab.locator('#actualWind').uncheck();
    }
    await withWriteLock(other, async release => {
      await Promise.all([click(page, '#recordForm button[type="submit"]'), click(other, '#recordForm button[type="submit"]')]);
      await pendingWrites(other, 2);
      await release();
      await stateWhen(page, '不同日期的并发写入均保留', value => value.days[YESTERDAY]?.wakeTime === '08:20' && value.days['2026-11-03']?.wakeTime === '09:10');
    });
    const final = await state(page);
    assert.equal(Object.keys(final.days).length, 3);
    assert.equal(final.days[TODAY].breaks, 1);
    assert.equal(final.days[TODAY].wakeTime, '07:12');
    assert.equal(final.days[TODAY].windDown, true);
    assert.equal(final.sessions.length, 1);
    assert.equal(final.activeSession, null);
    for (const tab of [page, other]) {
      const current = await until('storage 事件更新两标签的内存状态', () => tab.evaluate(() => window.QDK_STORE.get()), value => value.revision === final.revision);
      assert.deepEqual(current, final, '不只磁盘共享，两标签的 store 也要收到最新状态');
    }
  })],
  ['done 最后一步收起 / 稍后处理再恢复', '最后一刻点击收起触发自然 done → 写锁占用时先离开 → 刷新恢复 → 存储失败仍可先离开 → 重试仅保存一次。', () => withApp(async page => {
    await fillSettings(page);
    // 先注册同一截止时刻的 UI 点击，使 pause() 在最后一次引擎 tick 前结算自然 done。
    // 不调用引擎私有方法，避免漏掉 collapsePlayer 的完成回调重入路径。
    await page.evaluate(() => { setTimeout(() => document.getElementById('playerClose').click(), 60000); });
    const pending = await runNatural(page, 'minute', 'seated');
    await withWriteLock(page, async release => {
      await click(page, '#finishLater');
      assert.equal(await page.locator('#finishDialog').isVisible(), false, '先离开不能等待写锁');
      assert.equal(await page.locator('#page-today').isVisible(), true);
      await pendingWrites(page);
      assert.equal((await state(page)).activeSession.id, pending.id);
      assert.equal((await state(page)).sessions.length, 0, '稍后处理不能代用户保存感受');
      await release();
      await lockReleased(page, SESSION_LOCK);
    });
    await visible(page, '#resumeCard');
    await nav(page, 'move');
    await page.reload();
    await visible(page, '#resumeCard');
    assert.equal(new URL(page.url()).hash, '#today');
    await page.clock.runFor(5000);
    const kept = (await state(page)).activeSession;
    assert.equal(kept.id, pending.id);
    assert.equal(kept.phase, 'done');
    near(kept.elapsedSeconds, 60, '稍后处理期间不继续计时');
    await click(page, '#resumeSession');
    await visible(page, '#finishDialog');
    assert.equal(await page.locator('#safetyDialog').isVisible(), false);
    assert.equal(await page.locator('#player').isVisible(), false);
    await withWriteFailure(page, async () => {
      const before = await rawState(page);
      await click(page, '#finishLater');
      assert.equal(await page.locator('#finishDialog').isVisible(), false, '保存异常也不能困住需要先离开的用户');
      await textIs(page, '#toast', '尚未保存，先保留这个页面，身体要紧；稍后可继续处理。');
      assert.equal(await rawState(page), before);
      await visible(page, '#resumeCard');
      await click(page, '#resumeSession');
      await visible(page, '#finishDialog');
      assert.equal(await page.locator('#player').isVisible(), false, '内存中的 pendingFinish 只恢复反馈，不重开计时');
    });
    const record = await saveFinish(page, 'easy');
    assert.equal(record.id, pending.id, 'close 自然完成与稍后恢复都必须保留原 metadata');
    assert.equal(record.status, 'completed');
    near(record.activeSeconds, 20, '原活动秒数不丢失');
    near(record.elapsedSeconds, 60, '原流程秒数不丢失');
    await page.locator('#saveSession').dispatchEvent('click');
    await page.clock.runFor(1000);
    assert.equal((await state(page)).sessions.length, 1);
    assert.equal((await state(page)).activeSession, null);
  })],
  ['坐姿 / 站姿全部学习图', '动一点 → 5 分钟 → 两种姿势 → 逐个打开学习图并核对文字和图片解码。', () => withApp(async page => {
    await fillSettings(page);
    return `${await learnAll(page)} 个动作图与步骤`;
  })],
  ['设置持久化与恢复', '设置晚间优先、触发点和时间 → 刷新 → 设置回填 → 恢复活动优先。', () => withApp(async page => {
    await fillSettings(page);
    const changed = { ...SETTINGS, focus: 'sleep', anchor: 'home', wakeTime: '08:15', windDownTime: '23:10', sound: true };
    await click(page, '#openSettings');
    await fillSettings(page, changed);
    await page.reload();
    await textIs(page, '#heroTitle', '今晚，慢慢收尾。');
    assert.deepEqual((await state(page)).settings, changed);
    await click(page, '#todayStart');
    await visible(page, '#windDialog');
    assert.equal((await state(page)).activeSession, null);
    await closeDialog(page, 'windDialog');
    await click(page, '#openSettings');
    await settingsFields(page, changed);
    await fillSettings(page);
    await textIs(page, '#heroTitle', '先动 1 分钟。');
    await nav(page, 'rhythm');
    assert.equal(await text(page, '#wakeTarget'), SETTINGS.wakeTime);
    assert.equal(await text(page, '#windTarget'), SETTINGS.windDownTime);
  })],
  ['作息补记日期与更正', '晚间收尾 → 补记昨天 → 更改到另一历史日期 → 回顾中更正昨天的起床和收尾。', () => withApp(async page => {
    await fillSettings(page);
    await click(page, '#openWindDown');
    await click(page, '#windBackfill');
    assert.equal(await page.locator('#recordDate').inputValue(), YESTERDAY);
    assert.equal(await page.locator('#recordDate').getAttribute('max'), TODAY);
    let saved = await recordDay(page, YESTERDAY, '07:43', true);
    assert.equal(saved.days[TODAY], undefined, '补记昨天不能写到打开应用的今天');
    await click(page, '#recordWake');
    await page.locator('#recordDate').fill(YESTERDAY);
    assert.equal(await page.locator('#actualWake').inputValue(), '07:43');
    assert.equal(await page.locator('#actualWind').isChecked(), true);
    await page.locator('#recordDate').fill('2026-11-03');
    assert.equal(await page.locator('#actualWake').inputValue(), '', '切日期不能携带前一天的表单内容');
    assert.equal(await page.locator('#actualWind').isChecked(), false);
    await recordDay(page, '2026-11-03', '09:12', false);
    await nav(page, 'review');
    await openDetails(page.locator('details').filter({ has: page.locator('#rhythmHistory') }));
    await click(page, `[data-edit-day="${YESTERDAY}"]`);
    assert.equal(await page.locator('#recordDate').inputValue(), YESTERDAY);
    saved = await recordDay(page, YESTERDAY, '08:06', false);
    assert.equal(saved.days['2026-11-03'].wakeTime, '09:12');
    assert.equal(saved.days[TODAY], undefined);
    assert.equal(Object.keys(saved.days).length, 2, '更正覆盖当天，不制造重复日期');
    await click(page, `[data-edit-day="${YESTERDAY}"]`);
    await recordDay(page, YESTERDAY, '', true);
    assert.equal(Object.hasOwn((await state(page)).days[YESTERDAY], 'wakeTime'), false, '清空实际起床时间应能删除误记');
    await page.reload();
    saved = await state(page);
    assert.equal(saved.days[YESTERDAY].windDown, true);
    assert.deepEqual(saved.sessions, [], '作息记录不应变成活动');
  })],
  ['记录休息与活动间隙不等于运动', '今天需要休息 → 取消再确认 → 活动间隙确认 → 回顾检查运动数为零。', () => withApp(async page => {
    await fillSettings(page);
    const before = await rawState(page);
    await click(page, '#restToday');
    await click(page, '#messageCancel');
    assert.equal(await rawState(page), before, '取消不能写休息记录');
    await click(page, '#restToday');
    await click(page, '#messageConfirm');
    await stateWhen(page, '休息标记已保存', value => value.days[TODAY]?.rest);
    await click(page, '#recordBreak');
    await click(page, '#messageConfirm');
    const saved = await stateWhen(page, '活动间隙单独记录', value => value.days[TODAY]?.breaks === 1);
    assert.deepEqual(saved.sessions, []);
    assert.equal(saved.activeSession, null);
    assert.match(await text(page, '#todayActivity'), /休息/);
    await nav(page, 'review');
    assert.equal(await page.locator('#reviewStats .stat strong').first().innerText(), '0');
    const day = page.locator('#weekGrid .week-day').filter({ has: page.locator(`time[datetime="${TODAY}"]`) });
    assert.match(await day.innerText(), /休/);
    assert.doesNotMatch(await day.innerText(), /●/);
  })],
  ...[['minute', 'seated', 60, 20], ['gentle', 'standing', 180, 80]].map(([courseId, mode, elapsed, active]) => [
    `${elapsed / 60} 分钟自然走完 / done 反馈保存且不可重复`, `选择 ${courseId}/${mode} → 逐段自然计时 ${elapsed} 秒 → 选择感受 → 保存 → 重复点击保存 → 刷新。`,
    () => withApp(async page => {
      await fillSettings(page);
      const pending = await runNatural(page, courseId, mode);
      await click(page, '[data-feedback="discomfort"]');
      await visible(page, '#finishSafety');
      assert.match(await text(page, '#finishSafety'), /立即停止/);
      const record = await saveFinish(page, 'okay');
      assert.equal(record.id, pending.id);
      assert.equal(record.status, 'completed');
      assert.equal(record.plannedSeconds, elapsed);
      near(record.elapsedSeconds, elapsed, '保存的总秒数');
      near(record.activeSeconds, active, '保存的活动秒数');
      assert.equal(record.recovery, 'unknown');
      // 重复投递真实 UI 事件，验证已保存后的幂等防线；不调用闭包或引擎钩子。
      await page.locator('#saveSession').dispatchEvent('click');
      await page.locator('#saveSession').dispatchEvent('click');
      await page.clock.runFor(5000);
      assert.equal((await state(page)).sessions.filter(item => item.id === record.id).length, 1);
      await page.reload();
      assert.equal((await state(page)).sessions.length, 1);
      assert.equal((await state(page)).activeSession, null);
      assert.equal(await page.locator('#resumeCard').isVisible(), false);
      await nav(page, 'review');
      assert.equal(await page.locator('#sessionHistory .history-item').count(), 1);
      assert.match(await text(page, '#sessionHistory'), /走完流程.*实际活动/s);
      return `总流程 ${elapsed}s / 实际活动 ${active}s`;
    })
  ]),
  ['手动暂停 / skip 不补秒 / 刷新恢复 paused', '1 分钟坐姿自然运行 20 秒 → 暂停 → 等待 → 跳过剩余动作 → 刷新 → 重新确认 → 走完休息收尾。', () => withApp(async page => {
    await fillSettings(page);
    await startCourse(page);
    await page.clock.runFor(20000);
    await click(page, '#playerPause');
    const paused = (await stateWhen(page, '手动暂停保存', value => value.activeSession?.phase === 'paused')).activeSession;
    near(paused.elapsedSeconds, 20, '暂停前流程秒数');
    near(paused.activeSeconds, 5, '15 秒准备之后只活动了 5 秒');
    const clock = await text(page, '#playerClock');
    await page.clock.runFor(10000);
    assert.equal(await text(page, '#playerClock'), clock);
    assert.deepEqual((await state(page)).activeSession, paused, '暂停期间不可补时或产生后台进度');
    await click(page, '#playerSkip');
    const skipped = (await stateWhen(page, '跳过动作到休息段', value => value.activeSession?.stepIndex === 2)).activeSession;
    near(skipped.activeSeconds, paused.activeSeconds, 'skip 不增加活动秒数');
    near(skipped.elapsedSeconds, paused.elapsedSeconds, 'skip 不增加流程秒数');
    assert.equal(skipped.phase, 'paused');
    await page.reload();
    await visible(page, '#resumeCard');
    assert.equal(await page.locator('#player').isVisible(), false, '刷新不应自动启动播放器');
    await page.clock.runFor(10000);
    assert.deepEqual((await state(page)).activeSession, skipped, '刷新等待期间保持 paused 和原剩余时间');
    await click(page, '#resumeSession');
    await safetyGate(page);
    await approve(page);
    assert.equal((await state(page)).activeSession.id, paused.id, '恢复原回合而不是新建');
    assert.equal(await text(page, '#playerClock'), '15');
    await page.clock.runFor(15000);
    await imageLoaded(page, '#playerImage');
    await page.clock.runFor(10000);
    await visible(page, '#finishDialog');
    await stateWhen(page, '部分参与已结束', value => value.activeSession?.phase === 'done');
    const record = await saveFinish(page, 'easy');
    assert.equal(record.status, 'partial', '跳段后不得伪装自然完整完成');
    near(record.activeSeconds, 5, '部分参与实际活动');
    near(record.elapsedSeconds, 45, '15+5+15+10 秒实际经过时间');
  })],
  ['导出下载 / 导入覆盖确认 / 恢复设置和恢复反馈', '完成并导出新版备份 → 新增记录、改设置 → 导入先取消再确认 → 核对不是合并 → 导入昨日活动并记录恢复不适。', () => withApp(async page => {
    await fillSettings(page);
    await click(page, '#recordWake');
    await recordDay(page, YESTERDAY, '07:43', true);
    await runNatural(page, 'minute', 'seated');
    await saveFinish(page, 'easy');
    await nav(page, 'review');
    await openDetails(page.locator('#backupDetails'));
    const exported = await download(page, '#exportBackup');
    assert.match(exported.name, /习惯备份/);
    const backup = JSON.parse(exported.raw);
    assert.equal(backup.format, 'qingdaka-habits');
    assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
    assert.deepEqual(backup.state, await state(page));
    assert.equal(backup.state.activeSession, null);
    await startCourse(page);
    await click(page, '#playerEnd');
    await visible(page, '#finishDialog');
    await stateWhen(page, '提前结束待保存', value => value.activeSession?.phase === 'done');
    const extra = await saveFinish(page, 'hard');
    assert.equal(extra.status, 'stopped');
    near(extra.activeSeconds, 0, '立即结束不算活动');
    await click(page, '#recordWake');
    await recordDay(page, TODAY, '10:20', false);
    await click(page, '#openSettings');
    await fillSettings(page, { ...SETTINGS, focus: 'sleep', anchor: 'home', wakeTime: '10:00' });
    const before = await rawState(page);
    await importDialog(page, backup);
    assert.equal(await rawState(page), before, '核对弹窗出现时不能提前覆盖');
    await click(page, '#messageCancel');
    assert.equal(await rawState(page), before, '取消导入必须原文不变');
    await importDialog(page, backup);
    await click(page, '#messageConfirm');
    await textIs(page, '#toast', '备份已完整恢复。');
    const restored = await state(page);
    assert.deepEqual(portableState(restored), portableState(backup.state), '确认导入必须完整覆盖，不能合并或漏掉设置');
    assert.ok(restored.revision > JSON.parse(before).revision);
    assert.equal(restored.sessions.some(item => item.id === extra.id), false);
    assert.equal(restored.days[TODAY], undefined);
    await page.reload();
    assert.deepEqual(portableState(await state(page)), portableState(backup.state));
    await click(page, '#openSettings');
    await settingsFields(page, SETTINGS);
    await closeDialog(page, 'setupDialog');
    // 夹具由刚刚真实导出的新版备份派生，不依赖旧数据格式或私有 app 钩子。
    const previousDay = structuredClone(backup);
    for (const session of previousDay.state.sessions) {
      session.date = YESTERDAY;
      session.startedAt -= 86400000;
      session.endedAt -= 86400000;
    }
    await importDialog(page, previousDay);
    await click(page, '#messageConfirm');
    await textIs(page, '#toast', '备份已完整恢复。');
    await nav(page, 'today');
    await visible(page, '#recoveryCard');
    await click(page, '[data-recovery="pain"]');
    await stateWhen(page, '恢复不适已保存', value => value.sessions[0]?.recovery === 'pain');
    await visible(page, '#messageDialog');
    assert.match(await text(page, '#messageBody'), /停止.*紧急医疗评估/);
    await click(page, '#messageConfirm');
    await nav(page, 'review');
    assert.match(await text(page, '#reviewAdvice'), /疼痛或不适.*暂停/);
    assert.match(await text(page, '#sessionHistory'), /之后有疼痛或不适/);
  })],
  ['storage 损坏原文 / 错误可见', '在隔离 context 中放入损坏的新版 JSON → 打开 → 看到 storageAlert → 导出原文 → 尝试开始。', () => withApp(async page => {
    const fault = await page.evaluate(() => {
      try { window.QDK_STORE.get(); return null; } catch (error) { return { name: error.name, code: error.code }; }
    });
    assert.equal(fault?.code, 'INVALID_DATA', '检查真实 error.code，不读取虚构的 state.error');
    assert.equal(await page.locator('#setupDialog').isVisible(), false, '损坏数据不能被首次设置静默覆盖');
    assert.match(await text(page, '#storageAlert'), /无法安全读取.*原始数据/s);
    const downloaded = await download(page, '#exportRaw');
    assert.equal(downloaded.raw, '{损坏的新版原文\n  保留空格与换行');
    await nav(page, 'today');
    await click(page, '#todayStart');
    assert.equal(await page.locator('#player').isVisible(), false);
    assert.equal(await rawState(page), downloaded.raw);
  }, { storageFault: true, init: { fn: ({ origin, key, raw }) => {
    // 下载可能创建 about:blank / opaque document；只给本次服务的 HTTP 主文档放夹具。
    // 不捕获 setItem 或应用异常，合法目标上的真实错误仍交给 pageerror 断言。
    if (location.protocol !== 'http:' || location.origin !== origin || window.top !== window) return;
    localStorage.setItem(key, raw);
  }, arg: { origin: new URL(base).origin, key: KEY, raw: '{损坏的新版原文\n  保留空格与换行' } } })],
  ['storage 读取不可用 / error 通知', '完成设置 → 令新版 key 的 getItem 抛 SecurityError → 重读时 error 通知、storageAlert 明确报错且不能开始。', () => withApp(async page => {
    await fillSettings(page);
    const fault = await page.evaluate(async key => {
      const notices = [];
      const original = Storage.prototype.getItem;
      const before = original.call(localStorage, key);
      const unsubscribe = window.QDK_STORE.subscribe((state, error) => notices.push({ state, code: error?.code }));
      Storage.prototype.getItem = function (name) {
        if (name === key) throw new DOMException('E2E blocked storage read', 'SecurityError');
        return original.call(this, name);
      };
      let loadError, getError;
      try { await window.QDK_STORE.load(); } catch (error) { loadError = error.code; }
      try { window.QDK_STORE.get(); } catch (error) { getError = error.code; }
      unsubscribe();
      return { loadError, getError, notices, before, after: original.call(localStorage, key) };
    }, KEY);
    assert.equal(fault.loadError, 'STORAGE_UNAVAILABLE');
    assert.equal(fault.getError, 'STORAGE_UNAVAILABLE');
    assert.deepEqual(fault.notices, [{ state: null, code: 'STORAGE_UNAVAILABLE' }], '读取失败必须经 subscribe 第二个参数报告 error，不能当空数据成功');
    assert.equal(fault.after, fault.before, '读取失败不能清空或覆盖已存记录');
    assert.equal(await page.locator('#storageAlert').isVisible(), true);
    assert.equal(await page.locator('#setupDialog').isVisible(), false);
    await nav(page, 'today');
    await click(page, '#todayStart');
    assert.equal(await page.locator('#player').isVisible(), false);
  })],
  ['storage 保存失败 / done 保留并重试', '自然完成 1 分钟 → 注入 QuotaExceededError → 保存显示 finishError → 刷新恢复未保存 done → 重试成功一次。', () => withApp(async (page, context, evidence) => {
    await fillSettings(page);
    await runNatural(page, 'minute', 'seated');
    const before = await rawState(page);
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('E2E quota exhausted', 'QuotaExceededError');
        return original.call(this, name, value);
      };
    }, KEY);
    await click(page, '[data-feedback="okay"]');
    await click(page, '#saveSession');
    await visible(page, '#finishError');
    assert.match(await text(page, '#finishError'), /尚未保存成功.*仍保留/);
    assert.equal(await rawState(page), before, '失败后磁盘原文和待保存 done 都必须保留');
    assert.equal((await state(page)).sessions.length, 0);
    assert.equal(await page.locator('#finishDialog').isVisible(), true);
    assert.ok(evidence.consoleErrors.some(message => /Save failed|QDKStoreError/.test(message)), '实际存储异常应报告 error，而非伪报成功');
    // 注入只作用于当前文档；刷新恢复原生存储，不需要应用暴露测试钩子。
    await page.reload();
    await visible(page, '#resumeCard');
    assert.match(await text(page, '#resumeTitle'), /没保存感受/);
    await click(page, '#resumeSession');
    await visible(page, '#finishDialog');
    assert.equal(await page.locator('#player').isVisible(), false, '恢复 done 只保存反馈，不重新计时');
    const record = await saveFinish(page, 'okay');
    assert.equal(record.status, 'completed');
    near(record.activeSeconds, 20, '重试保存仍是原活动秒数');
    assert.equal((await state(page)).sessions.length, 1);
  })],
  ...[{ width: 320, height: 560 }, { width: 390, height: 844 }].map(viewport => [
    `${viewport.width}×${viewport.height} 播放器按钮可见不重叠`, '3 分钟坐姿和站姿逐段检查 running/paused；不滚动、不 force 点击、不隐藏内容来规避布局。',
    () => withApp(async page => {
      await fillSettings(page);
      let steps = 0;
      for (const mode of ['seated', 'standing']) {
        await startCourse(page, 'gentle', mode);
        const plan = await currentPlan(page, 'gentle', mode);
        for (const [index, step] of plan.entries()) {
          if (index > 0) {
            await click(page, '#playerPause');
            await textIs(page, '#playerPause', '暂停');
          }
          await imageLoaded(page, '#playerImage');
          await playerFits(page, `${mode}/${step.kind}/running`);
          await click(page, '#playerPause');
          await textIs(page, '#playerPause', '继续');
          await playerFits(page, `${mode}/${step.kind}/paused`);
          await click(page, '#playerSkip');
          await stateWhen(page, '逐段跳过保存', value => index === plan.length - 1
            ? value.activeSession?.phase === 'done'
            : value.activeSession?.stepIndex === index + 1 && value.activeSession.phase === 'paused');
          steps++;
        }
        const record = await saveFinish(page);
        near(record.activeSeconds, 0, '全部跳过不增加活动秒数');
        near(record.elapsedSeconds, 0, '全部跳过不增加流程秒数');
        assert.equal(record.status, 'partial');
      }
      return `${steps} 段 × running/paused`;
    }, { viewport })
  ]),
  ['离线全部图 / 明确源码或产物版本（独立 SW context）', '独立 allow context 首装 → 核对全图已预缓存 → 断网并禁用 HTTP cache → 新页面重开 → 所有 SVG 解码、学习和播放器。', () => offlineFlow()]
];

async function guideFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await guideFiles(resolve(directory, entry.name), name + '/'));
    else if (entry.isFile() && entry.name.endsWith('.svg')) files.push('./assets/habit-guides/' + name);
  }
  return files.sort();
}
async function offlineFlow() {
  const sw = await readFile(resolve(ROOT, DIRECTORY, 'sw.js'), 'utf8');
  const version = sw.match(/\/\* BUILD_VERSION_START \*\/\s*['"]([^'"]+)['"]/);
  assert.ok(version, 'sw.js 必须声明明确的 BUILD_VERSION');
  const expectedVersion = version[1];
  const complete = sw.match(/\/\* BUILD_COMPLETE_START \*\/\s*(true|false)/)?.[1];
  assert.equal(complete, DIRECTORY === 'dist' ? 'true' : 'false', '源码开发版与完整产物必须明确区分');
  assert.match(expectedVersion, DIRECTORY === 'dist' ? /^habits-[a-f0-9]{20}$/ : /^habits-dev-/);
  const guides = await guideFiles(resolve(ROOT, DIRECTORY, 'assets/habit-guides'));
  assert.ok(guides.length >= 10, '整套轻活动至少应包含当前 10 张坐姿/站姿示意图');
  return withApp(async (page, context) => {
    await fillSettings(page);
    await nav(page, 'review');
    await until('SW 接管当前页面', () => page.evaluate(() => !!navigator.serviceWorker.controller), Boolean, 20000);
    await until('完整离线状态明确就绪', () => text(page, '#offlineStatus'), value => /核心页面与全部轻活动示意已离线就绪/.test(value), 20000);
    await textIs(page, '#appVersion', '当前离线版本：' + expectedVersion);
    assert.equal(await page.locator('#updateApp').isVisible(), false, '首装不能显示无效的更新按钮');
    const core = ['./index.html', './styles.css', './app.js', './content.js', './store.js', './session.js', './manifest.webmanifest'];
    const cacheReport = await page.evaluate(async ({ version, files }) => {
      const names = await caches.keys();
      const name = names.find(value => value.startsWith('qingdaka-habits:') && value.endsWith(':' + version));
      if (!name) return { names, missing: files };
      const cache = await caches.open(name);
      const missing = [];
      for (const file of files) {
        const hit = await cache.match(new URL(file, location.href).href);
        if (!hit || hit.status !== 200) missing.push(file);
      }
      return { names, missing };
    }, { version: expectedVersion, files: [...core, ...guides] });
    assert.deepEqual(cacheReport.missing, [], '首次安装就必须预缓存全部图，而不是测试浏览过才凑齐：' + JSON.stringify(cacheReport));
    await context.setOffline(true);
    const networkState = { originalPageOnline: await page.evaluate(() => navigator.onLine) };
    const offline = await context.newPage();
    offline.setDefaultTimeout(7000);
    offline.setDefaultNavigationTimeout(15000);
    networkState.newPageOnline = await offline.evaluate(() => navigator.onLine);
    const cdp = await context.newCDPSession(offline);
    await cdp.send('Network.enable');
    networkState.afterCDPEnable = await offline.evaluate(() => navigator.onLine);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    networkState.afterCacheDisabled = await offline.evaluate(() => navigator.onLine);
    const swResponses = new Set();
    offline.on('response', response => {
      if (response.fromServiceWorker()) swResponses.add(new URL(response.url()).pathname);
    });
    await page.close();
    lastAction = '断网，新 tab 禁用 HTTP cache 后打开 /index.html#review';
    const response = await offline.goto(base + '/index.html#review', { waitUntil: 'load' });
    assert.equal(response?.status(), 200);
    assert.equal(response.fromServiceWorker(), true, '离线重开不能依赖 HTTP cache 假通过');
    networkState.afterNavigation = await offline.evaluate(() => navigator.onLine);
    assert.equal(networkState.originalPageOnline, false, '原 context 已设置离线');
    assert.equal(networkState.newPageOnline, false, '新 tab 在导航前同样继承离线设置');
    // Chrome 的 SW 导航后 onLine 可能回到 true，即使传输层仍是离线。
    // 不篡改 navigator：用未缓存请求的真实网络失败证明断网，防止缓存命中假通过。
    offline.on('requestfailed', request => {
      if (new URL(request.url()).pathname === '/__e2e_uncached_network_probe__') {
        networkState.uncachedFailure = request.failure()?.errorText;
      }
    });
    networkState.uncachedRequestRejected = await offline.evaluate(async () => {
      // 地址故意不在 SW 清单中；在线时即使服务器返回 404，fetch 也会 resolve。
      try { await fetch('./__e2e_uncached_network_probe__', { cache: 'no-store' }); return false; }
      catch { return true; }
    });
    assert.equal(networkState.uncachedRequestRejected, true, '必须真的断网，而不仅从 SW/HTTP cache 读到页面：' + JSON.stringify(networkState));
    await until('未缓存请求应报告真实断网错误', () => networkState.uncachedFailure);
    assert.match(networkState.uncachedFailure, /ERR_INTERNET_DISCONNECTED/, 'CSP、404 或其他错误不能代替断网证明');
    await until('离线重开后全图状态仍就绪', () => text(offline, '#offlineStatus'), value => /全部轻活动示意已离线就绪/.test(value));
    await textIs(offline, '#appVersion', '当前离线版本：' + expectedVersion);
    assert.deepEqual((await state(offline)).settings, SETTINGS, '离线重开保留本机设置');
    const fetched = await offline.evaluate(async files => Promise.all(files.map(async file => {
      const response = await fetch(file, { cache: 'no-store' });
      return { file, status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    })), [...core, ...guides]);
    for (const file of fetched) {
      assert.equal(file.status, 200, '离线资源 ' + file.file);
      assert.ok(file.bytes > 0, '离线资源不得为空：' + file.file);
    }
    const decoded = await offline.evaluate(async files => Promise.all(files.map(async file => {
      const image = new Image();
      image.src = file;
      try { await image.decode(); return { file, width: image.naturalWidth, height: image.naturalHeight }; }
      catch (error) { return { file, error: error.message }; }
    })), guides);
    for (const image of decoded) assert.ok(image.width > 0 && image.height > 0, '离线全图必须可解码：' + JSON.stringify(image));
    for (const file of [...core, ...guides]) {
      await until('资源由 SW 返回：' + file, () => swResponses.has(new URL(file, base + '/index.html').pathname));
    }
    await learnAll(offline);
    await startCourse(offline, 'minute', 'standing');
    await click(offline, '#playerPause');
    await stateWhen(offline, '断网仍可保存暂停进度', value => value.activeSession?.phase === 'paused');
    await imageLoaded(offline, '#playerImage');
    await click(offline, '#playerClose');
    await hidden(offline, '#player');
    await nav(offline, 'today');
    await visible(offline, '#resumeCard');
    return `${DIRECTORY === 'dist' ? '产物' : '源码'} ${expectedVersion}；${guides.length} 张 SVG 离线解码，核心资源确由 SW 返回`;
  }, { serviceWorkers: 'allow', clock: false });
}

async function runCase([name, reproduction, work]) {
  if (stopping) return false;
  const started = Date.now();
  lastAction = reproduction;
  try {
    const note = await work();
    results.push({ name, status: 'passed', ms: Date.now() - started });
    console.log(`✓ ${name}${note ? ' — ' + note : ''} (${Date.now() - started}ms)`);
    return true;
  } catch (error) {
    results.push({ name, status: 'failed', ms: Date.now() - started });
    process.exitCode = 1;
    console.error(`✗ ${name}\n  复现：${reproduction}\n  ${error.stack || error}`);
    return false;
  }
}

try {
  // 只读检查；绝不为了跑产物测试而改写应用或 dist。
  const html = await readFile(resolve(ROOT, DIRECTORY, 'index.html'), 'utf8').catch(error => {
    throw new Error(`${DIRECTORY}/index.html 不可读。${DIRECTORY === 'dist' ? '请由构建流程先生成新版 dist；E2E 不会代为构建。' : ''}`, { cause: error });
  });
  assert.match(html, /<title>轻打卡/);
  base = await localServer();
  if (stopping) throw new Error('服务启动期间测试被中止');
  console.log(`E2E：${DIRECTORY === 'dist' ? '产物 dist' : '源码 .'}；${base}；channel=${CHANNEL}；仅临时 context`);
  // chromium/bundled 可显式选择 Playwright 自带浏览器，其余值原样作为 channel。
  browser = await chromium.launch({ headless: true, ...(CHANNEL === 'chromium' || CHANNEL === 'bundled' ? {} : { channel: CHANNEL }) });
  if (stopping) {
    await browser.close();
    throw new Error('浏览器启动期间测试被中止');
  }
  const bootPassed = await runCase(cases[0]);
  if (bootPassed) {
    for (const test of cases.slice(1)) {
      if (stopping || results.filter(result => result.status === 'failed').length >= 3) break;
      await runCase(test);
    }
  } else {
    console.error('新版启动门槛未通过，后续流程标记为阻塞，不重复制造相同超时，也不移除断言。');
  }
} catch (error) {
  process.exitCode = 1;
  console.error('E2E 启动失败：', error.stack || error);
  if (serverOutput) console.error(serverOutput.trim());
} finally {
  try { await cleanup(); }
  catch (error) { process.exitCode = 1; console.error('清理失败：', error.stack || error); }
  clearTimeout(watchdog);
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
  const passed = results.filter(result => result.status === 'passed').length;
  const failed = results.filter(result => result.status === 'failed').length;
  const remaining = cases.filter(([name]) => !results.some(result => result.name === name));
  console.log(`\nE2E 摘要 [${DIRECTORY === 'dist' ? '产物 dist' : '源码 .'} / ${CHANNEL}]：${passed} 通过，${failed} 失败，${remaining.length} 阻塞/未运行。`);
  for (const [name] of remaining) console.log('  - 未运行：' + name);
  if (!failed && !remaining.length && !process.exitCode) console.log('✅ 全部新版流程通过；临时 context、下载与本地服务已清理。');
  else process.exitCode ||= 1;
}
