#!/usr/bin/env node
/**
 * 无头跑 test.html：等待 #summary 出现「全部通过」或失败退出码 1。
 * 需已启动：python3 serve.py 8899
 */
import http from 'node:http';
import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:8899';
const TEST_URL = `${BASE.replace(/\/$/, '')}/test.html`;

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

await waitForServer(TEST_URL);

const browser = await chromium.launch();
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

const summary = (await page.textContent('#summary')) || '';
const html = await page.content();
const bad = (html.match(/class="t bad"/g) || []).length;
await browser.close();

if (summary.includes('全部通过')) {
  console.log(summary.trim());
  process.exit(0);
}

console.error(summary.trim());
if (bad) console.error(`失败用例 ${bad} 个（见 .t.bad）`);
process.exit(1);
