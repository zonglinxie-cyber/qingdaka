#!/usr/bin/env node
// 只截取独立样例，不启动服务、不连接真实 profile；GIF 合成使用本机 Python Pillow。
// COACH_DIR / COACH_PREFIX 可切换到其它原型页面。
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('docs/previews/', root);
const url = new URL(`docs/prototypes/${process.env.COACH_DIR || 'gentle-coach'}/index.html`, root).href;
const prefix = process.env.COACH_PREFIX || 'coach';
const now = new Date('2026-11-06T04:00:00Z');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const watchdog = setTimeout(() => {
  process.exitCode = 1;
  console.error('截图超过 70 秒，关闭临时浏览器。');
  void browser.close();
}, 70000);

async function openPage(scale) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: scale,
    locale: 'zh-CN', reducedMotion: 'no-preference', serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.goto(url);
  return { context, page, errors };
}

// 整页截图改用临时拉高视窗，避开 fullPage 在滤镜/粘性元素上的切片错位。
async function fullHeightShot(page, name) {
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const target = Math.min(Math.max(height, size.height), 1500);
  if (target > size.height) await page.setViewportSize({ width: size.width, height: target });
  // clock 已暂停，rAF 不会自己触发；推进少量时间只为让重排完成。
  await page.clock.runFor(50);
  await page.screenshot({ path: fileURLToPath(new URL(name, output)) });
  if (target > size.height) await page.setViewportSize(size);
}

try {
  const pageRun = await openPage(1);
  const { page } = pageRun;
  await fullHeightShot(page, prefix + '-learn.png');
  await page.locator('#primaryButton').click();
  await page.clock.runFor(8000);
  await fullHeightShot(page, prefix + '-round.png');
  await page.clock.runFor(18000);
  await page.screenshot({ path: fileURLToPath(new URL(prefix + '-rest.png', output)) });
  await page.setViewportSize({ width: 320, height: 560 });
  await page.reload();
  await page.locator('#primaryButton').click();
  await page.clock.runFor(8000);
  await page.screenshot({ path: fileURLToPath(new URL(prefix + '-small.png', output)) });
  const controls = await page.locator('.actions').boundingBox();
  if (!controls || controls.y < 0 || controls.y + controls.height > 560) throw new Error('320×560 的暂停/结束按钮不在可视范围');
  await pageRun.context.close();

  const detail = await openPage(2);
  await detail.page.locator('.stage').screenshot({ path: fileURLToPath(new URL(prefix + '-figure.png', output)) });
  await detail.page.locator('#primaryButton').click();
  await detail.page.clock.runFor(8000);
  await detail.page.locator('.stage').screenshot({ path: fileURLToPath(new URL(prefix + '-figure-lift.png', output)) });
  const errors = [...pageRun.errors, ...detail.errors];
  await detail.context.close();
  if (errors.length) throw new Error(errors.join('\n'));

  const motionContext = (await openPage(1)).context;
  const motion = motionContext.pages()[0];
  await motion.locator('#motionButton').click();
  const frames = [];
  // 截取浏览器真实动画的一次完整换侧循环，而不是另外制作一套演示效果。
  for (let frame = 0; frame < 72; frame += 1) {
    frames.push((await motion.screenshot()).toString('base64'));
    await motion.clock.runFor(frame % 3 === 0 ? 166 : 167);
  }
  await motionContext.close();
  const gif = fileURLToPath(new URL(prefix + '-motion.gif', output));
  const python = [
    'import sys, json, base64, io',
    'from PIL import Image',
    'images = [Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB") for data in json.load(sys.stdin)]',
    'palette = images[0].quantize(colors=128)',
    'frames = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]',
    'frames[0].save(sys.argv[1], save_all=True, append_images=frames[1:], duration=[160 if i % 3 == 0 else 170 for i in range(len(frames))], loop=0, optimize=True, disposal=2)',
    'print("GIF:", len(frames), "frames / 12 seconds")'
  ].join('\n');
  const result = spawnSync('python3', ['-c', python, gif], {
    input: JSON.stringify(frames), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  console.log(result.stdout.trim());
  console.log(`已截取 ${prefix}：学习/演示/休息、320×560 小屏、舞台特写；动图 ${Math.round((await stat(gif)).size / 1024)} KB。`);
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
