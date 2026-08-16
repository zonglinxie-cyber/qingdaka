#!/usr/bin/env node
/**
 * 无头跑 test.html：等待 #summary 出现「全部通过」或失败退出码 1。
 * 需已启动：python3 serve.py 8899
 */
import http from 'node:http';
import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:8899';
const TEST_URL = `${BASE.replace(/\/$/, '')}/test.html`;
const APP_URL = `${BASE.replace(/\/$/, '')}/index.html`;
const RUN_UNIT_PAGE = process.env.TEST_UNIT_PAGE !== '0';

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      function retry() {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`服务未就绪: ${url}`));
          return;
        }
        setTimeout(tick, 250);
      }
    };
    tick();
  });
}

await waitForServer(RUN_UNIT_PAGE ? TEST_URL : APP_URL);

const browser = await chromium.launch();
let summary = '';
if (RUN_UNIT_PAGE) {
  const page = await browser.newPage();
  page.on('pageerror', (err) => {
    console.error('[pageerror]', err);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[console]', msg.text());
    }
  });

  await page.goto(TEST_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('summary');
    if (!el) return false;
    const t = el.textContent || '';
    return t.includes('全部通过') || t.includes('有失败') || t.includes('无法');
  }, { timeout: 20000 });

  summary = (await page.textContent('#summary')) || '';
  const html = await page.content();
  const bad = (html.match(/class="t bad"/g) || []).length;
  if (!summary.includes('全部通过')) {
    await browser.close();
    console.error(summary.trim());
    if (bad) console.error(`失败用例 ${bad} 个（见 .t.bad）`);
    process.exit(1);
  }
}

// 单元页的绿灯不代表 SW/CSP 可用：在真实应用页验证 CSP，并验证已缓存语音
// 在断网 + Range 请求下仍返回标准 206。这是 m4a 离线回归的最小可复现检查。
const appPage = await browser.newPage();
try {
  await appPage.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });
  await appPage.evaluate(() => navigator.serviceWorker.ready);
  await appPage.reload({ waitUntil: 'load', timeout: 30000 });
  await appPage.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 20000 });

  const csp = await appPage.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return meta ? meta.getAttribute('content') || '' : '';
  });
  if (!csp.includes("media-src 'self' blob: data:") || !csp.includes("connect-src 'self'")) {
    throw new Error('CSP 缺少 m4a 或同源 relay 所需指令');
  }

  await appPage.click('[data-page="data"]');
  await appPage.waitForSelector('#stProteinDays');
  const dataOk = await appPage.evaluate(() => !!(
    document.getElementById('stWalk') &&
    document.getElementById('stWeight') &&
    document.getElementById('stProteinDays') &&
    document.getElementById('stWeek')
  ));
  if (!dataOk) throw new Error('数据页缺统计节点');
  await appPage.click('[data-page="me"]');
  await appPage.waitForSelector('#btnSetHeight');
  await appPage.click('[data-page="today"]');
  await appPage.waitForSelector('#mealGrid .meal-cell');
  const todayOk = await appPage.evaluate(() => (
    document.querySelectorAll('#mealGrid .meal-cell').length === 4 &&
    document.querySelectorAll('[data-walk]').length === 3 &&
    !!document.getElementById('fiberRow') &&
    !!document.getElementById('startHint')
  ));
  if (!todayOk) throw new Error('今天页缺四餐/走路/纤维/起步提示');
  const beforeProtein = await appPage.textContent('#pToday');
  await appPage.click('#quickFoods button');
  await appPage.waitForFunction((prev) => {
    const el = document.getElementById('pToday');
    return el && el.textContent !== prev;
  }, beforeProtein, { timeout: 5000 });

  if (!RUN_UNIT_PAGE) {
    const protectedPaths = await appPage.evaluate(async () => Promise.all(
      ['HANDOVER.md', 'serve.py', 'relay_routing.py', 'test.html'].map(async (name) => {
        const response = await fetch(`./${name}`);
        return [name, response.status];
      })
    ));
    const leaked = protectedPaths.filter(([, status]) => status !== 404);
    if (leaked.length) throw new Error(`部署产物泄露非运行时文件：${JSON.stringify(leaked)}`);
  }

  const fullVoice = await appPage.evaluate(async () => {
    const response = await fetch('./assets/voice/countdown-3.m4a');
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  });
  if (fullVoice.status !== 200 || fullVoice.bytes === 0) {
    throw new Error(`在线语音缓存失败：HTTP ${fullVoice.status} / ${fullVoice.bytes} bytes`);
  }

  await appPage.context().setOffline(true);
  let rangedVoice;
  try {
    rangedVoice = await appPage.evaluate(async () => {
      const response = await fetch('./assets/voice/countdown-3.m4a', { headers: { Range: 'bytes=0-31' } });
      return {
        status: response.status,
        bytes: (await response.arrayBuffer()).byteLength,
        range: response.headers.get('Content-Range'),
        acceptRanges: response.headers.get('Accept-Ranges')
      };
    });
  } finally {
    await appPage.context().setOffline(false);
  }
  if (rangedVoice.status !== 206 || rangedVoice.bytes !== 32 || !/^bytes 0-31\/\d+$/.test(rangedVoice.range || '') || rangedVoice.acceptRanges !== 'bytes') {
    throw new Error(`离线 Range 语音失败：${JSON.stringify(rangedVoice)}`);
  }
} finally {
  await browser.close();
}

if (RUN_UNIT_PAGE) console.log(summary.trim());
else console.log('✅ 发布产物加载且非运行时文件不可访问');
console.log('✅ CSP 与离线 m4a Range 缓存通过');
