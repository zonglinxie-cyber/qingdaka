#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIRECTORY = process.env.TEST_UNIT_PAGE === '0' ? 'dist' : '.';
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL?.trim() || 'chrome';

let server, browser, base, serverOutput = '', stopping = false, cleanupPromise;
const contexts = new Set();
let testsPassed = 0;

async function localServer() {
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

async function cleanup() {
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
  clearTimeout(watchdog);
  process.exitCode = code;
  console.error('\n' + reason);
  void cleanup().catch(error => console.error('清理失败：', error.message));
}

process.once('SIGINT', () => stop('收到 SIGINT，关闭浏览器和服务器。', 130));
process.once('SIGTERM', () => stop('收到 SIGTERM，关闭浏览器和服务器。', 143));
const watchdog = setTimeout(() => stop('E2E 测试超过 120 秒，已超时中止。'), 120000);

async function newPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  contexts.add(context);
  const page = await context.newPage();
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  return { page, context };
}

function testCheck(name, promiseFn) {
  return promiseFn().then(() => {
    testsPassed++;
    console.log(`✓ ${name}`);
  }).catch(err => {
    console.error(`✗ ${name} 失败：`, err);
    throw err;
  });
}

async function main() {
  console.log(`启动测试服务器 (目录: ${DIRECTORY})...`);
  base = await localServer();
  console.log(`服务器就绪：${base}，启动浏览器 (渠道: ${CHANNEL})...`);

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  };
  if (CHANNEL !== 'chromium') {
    launchOptions.channel = CHANNEL;
  }
  browser = await chromium.launch(launchOptions);

  // 1. 首屏周循环卡片与场景胶囊切换
  await testCheck('首屏 A/B/C 计划与场景课正常渲染及切换', async () => {
    const { page, context } = await newPage();
    try {
      const brandTitle = await page.locator('.brand-title').innerText();
      assert.equal(brandTitle, '轻打卡');

      // 默认推荐卡 A
      const recCard = page.locator('.cycle-card .badge-recommend');
      assert.equal(await recCard.count(), 1);
      assert.equal(await recCard.innerText(), '本次推荐');

      // 点击计划 B 卡片
      await page.click('.cycle-card[data-plan="B"]');
      await page.locator('#planTitle:has-text("计划 B · 哑铃塑形")').waitFor();
      assert.ok(await page.locator('.cycle-card[data-plan="B"].active').isVisible());

      // 点击计划 C 卡片
      await page.click('.cycle-card[data-plan="C"]');
      await page.locator('#planTitle:has-text("计划 C · 核心体态")').waitFor();

      // 点击久坐拉伸胶囊
      await page.click('.scene-pill[data-plan="stretch"]');
      await page.locator('#planTitle:has-text("久坐全身拉伸")').waitFor();
    } finally {
      await context.close();
      contexts.delete(context);
    }
  });

  // 2. 4 档强度分段切换与时长重算
  await testCheck('4 档强度分段切换实时计算时长与轮数', async () => {
    const { page, context } = await newPage();
    try {
      await page.click('.cycle-card[data-plan="A"]');

      // 恢复档
      await page.click('.level-btn[data-level="recovery"]');
      let summary = await page.locator('#planSummaryText').innerText();
      assert.match(summary, /预计\s*(?:7|8|9|10)\s*分钟/);
      assert.match(summary, /1\s*轮/);

      // 入门档
      await page.click('.level-btn[data-level="starter"]');
      summary = await page.locator('#planSummaryText').innerText();
      assert.match(summary, /预计\s*(?:9|10|11|12|13)\s*分钟/);

      // 标准档
      await page.click('.level-btn[data-level="standard"]');
      summary = await page.locator('#planSummaryText').innerText();
      assert.match(summary, /预计\s*(?:16|17|18|19|20)\s*分钟/);
      assert.match(summary, /2\s*轮/);

      // 进阶档
      await page.click('.level-btn[data-level="steady"]');
      summary = await page.locator('#planSummaryText').innerText();
      assert.match(summary, /预计\s*(?:23|24|25|26|27)\s*分钟/);
      assert.match(summary, /3\s*轮/);
    } finally {
      await context.close();
      contexts.delete(context);
    }
  });

  // 3. 动作教学弹层与 3D 肌肉动图解码
  await testCheck('动作教学弹层打开、3D 肌肉 .gif 正常解码与避坑提醒', async () => {
    const { page, context } = await newPage();
    try {
      await page.click('.cycle-card[data-plan="A"]');

      // 点击第一个动作
      await page.click('.exercise-item[data-move-id="0291"]');
      await page.locator('#learnDialog').waitFor({ state: 'visible' });

      assert.equal(await page.locator('#learnTitle').innerText(), '扶凳箱式深蹲');
      assert.match(await page.locator('#learnPrimary').innerText(), /股四头肌/);

      // 验证 3D .gif 图片正常解码 (naturalWidth > 0)
      await page.waitForFunction(() => {
        const img = document.getElementById('learnGif');
        return img && img.complete && img.naturalWidth > 0;
      }, { timeout: 7000 });
      const decoded = await page.evaluate(() => {
        const img = document.getElementById('learnGif');
        return img && img.naturalWidth > 0 && img.naturalHeight > 0;
      });
      assert.ok(decoded, '3D 肌肉解剖 .gif 必须成功解码并正常显示尺寸');

      // 验证 3 步拆解与避坑提醒
      assert.equal(await page.locator('#learnSteps li').count(), 3);
      const mistake = await page.locator('#learnMistake').innerText();
      assert.ok(mistake.length > 5);
      assert.ok(!mistake.startsWith('常见错误：'));

      // 关闭弹层
      await page.click('#btnLearnDismiss');
      await page.locator('#learnDialog').waitFor({ state: 'hidden' });
    } finally {
      await context.close();
      contexts.delete(context);
    }
  });

  // 4. 单练体验 30 秒（提前结束与跳过完成均不弹问卷、不推进周循环）
  await testCheck('从教学弹层启动单练体验 30 秒，退出与完成均不误推计划书签', async () => {
    const { page, context } = await newPage();
    try {
      await page.click('.exercise-item[data-move-id="0291"]');
      await page.locator('#learnDialog').waitFor({ state: 'visible' });

      // 点击单练体验 30 秒
      await page.click('#btnPractice30');
      await page.locator('#player').waitFor({ state: 'visible' });

      assert.match(await page.locator('#playerStepName').innerText(), /单练体验/);
      assert.equal(await page.locator('#playerClock').innerText(), '30');

      // 跳过单练最后一步触发完成，验证直接干净回到主页、不弹完成卡、不改 A 推荐
      await page.click('#btnPlayerSkip');
      await page.locator('#player').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#doneDialog').isVisible(), false);
      assert.ok(await page.locator('.cycle-card[data-plan="A"] .badge-recommend').isVisible());
    } finally {
      await context.close();
      contexts.delete(context);
    }
  });

  // 5. 点「开始跟练」零弹窗直接进入播放器、暂停/继续/真实换边提示
  await testCheck('点「开始跟练」零弹窗进入播放器、单侧动作过半真实弹出换边提示', async () => {
    const { page, context } = await newPage();
    try {
      // 将恢复档正式动作时长调为 1.2 秒以便真实计时验证过半换边
      await page.evaluate(() => {
        window.QDK_CONTENT.levels.recovery.workSec = 1.2;
      });
      await page.click('.level-btn[data-level="recovery"]');

      // 首页直接点击开始跟练
      await page.click('#btnStartWorkout');
      await page.locator('#player').waitFor({ state: 'visible' });

      // 首步为 3 秒倒数准备，下一动作角标可见
      assert.ok(await page.locator('#playerNextBadge').isVisible());
      assert.equal(await page.locator('#playerStepKind').innerText(), '倒数准备');

      // 暂停与继续按钮
      assert.equal(await page.locator('#btnPlayerToggle').innerText(), '暂停');
      await page.click('#btnPlayerToggle');
      assert.equal(await page.locator('#btnPlayerToggle').innerText(), '继续');
      await page.click('#btnPlayerToggle');
      assert.equal(await page.locator('#btnPlayerToggle').innerText(), '暂停');

      // 跳到计划 A 中的单侧动作「侧卧髋外展」(0710, sideMode === 'half')
      for (let guard = 0; guard < 20; guard++) {
        const name = await page.locator('#playerStepName').innerText();
        if (name.includes('侧卧髋外展')) break;
        await page.click('#btnPlayerSkip');
      }
      assert.match(await page.locator('#playerStepName').innerText(), /侧卧髋外展/);
      assert.equal(await page.locator('#playerSwitchBadge').isVisible(), false);

      // 等待过半（>0.6s），真实触发 app.js 的 onHalfway 显示换侧徽章
      await page.locator('#playerSwitchBadge').waitFor({ state: 'visible', timeout: 3000 });

      // 提前退出不推进书签
      await page.click('#btnPlayerExit');
      await page.locator('#player').waitFor({ state: 'hidden' });
      assert.ok(await page.locator('.cycle-card[data-plan="A"] .badge-recommend').isVisible());
    } finally {
      await context.close();
      contexts.delete(context);
    }
  });

  // 6. 走完跟练触发完成卡并自动推进 A → B 书签
  await testCheck('真实走完计划 A 跟练弹出完成卡，周循环书签推进 A → B 并持久化', async () => {
    const { page, context } = await newPage();
    try {
      await page.click('.cycle-card[data-plan="A"]');
      await page.click('.level-btn[data-level="recovery"]');
      await page.click('#btnStartWorkout');
      await page.locator('#player').waitFor({ state: 'visible' });

      // 逐节跳过直至最后一节结束（触发 partial/skipped 完成流转）
      for (let guard = 0; guard < 30; guard++) {
        if (!(await page.locator('#player').isVisible())) break;
        await page.click('#btnPlayerSkip');
      }

      await page.locator('#doneDialog').waitFor({ state: 'visible' });
      assert.match(await page.locator('#doneSummary').innerText(), /计划 A/);
      assert.match(await page.locator('#doneCycleUpdate').innerText(), /计划 B/);

      await page.click('#btnDoneFinish');
      await page.locator('#doneDialog').waitFor({ state: 'hidden' });

      // 刷新页面，验证书签已持久化推进到 B
      await page.reload();
      const recCard = page.locator('.cycle-card[data-plan="B"] .badge-recommend');
      assert.ok(await recCard.isVisible(), '计划 B 上应有「本次推荐」徽章');
      assert.ok(await page.locator('.cycle-card[data-plan="B"].active').isVisible(), '计划 B 应处于当前选中状态');
    } finally {
      await context.close();
      contexts.delete(context);
    }
  });

  // 7. 手机尺寸 320×560 和 390×844 无横向滚动条且播放器不遮挡
  await testCheck('320×560 与 390×844 双尺寸无横向滚动条、播放器控件一屏完整可见', async () => {
    for (const vp of [{ width: 320, height: 560 }, { width: 390, height: 844 }]) {
      const { page, context } = await newPage(vp);
      try {
        // 主页检查无横向滚动
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(scrollWidth <= vp.width, `视口 ${vp.width}x${vp.height} 下主页出现横向溢出: scrollWidth=${scrollWidth}`);

        // 打开播放器
        await page.click('#btnStartWorkout');
        await page.locator('#player').waitFor({ state: 'visible' });

        // 检查播放器各关键元素均在屏幕视口内可见
        const playerBBox = await page.locator('#player').boundingBox();
        assert.ok(playerBBox.height <= vp.height, `播放器高度 ${playerBBox.height} 超过屏幕高度 ${vp.height}`);

        const btnToggleBox = await page.locator('#btnPlayerToggle').boundingBox();
        assert.ok(btnToggleBox.y + btnToggleBox.height <= vp.height, `底部控制按钮超出视口底部: y=${btnToggleBox.y}`);

        const imgBox = await page.locator('#playerImg').boundingBox();
        assert.ok(imgBox.y > 0 && imgBox.height > 50, '3D 动图必须在视口内完整可见');

        const cueBox = await page.locator('#playerShortCue').boundingBox();
        assert.ok(cueBox.y > imgBox.y, '口令区必须位于动图下方');
        assert.ok(cueBox.y + cueBox.height <= btnToggleBox.y, '口令区不得被底部控制栏遮挡');

        await page.click('#btnPlayerEnd');
        await page.locator('#player').waitFor({ state: 'hidden' });
      } finally {
        await context.close();
        contexts.delete(context);
      }
    }
  });

  clearTimeout(watchdog);
  console.log(`\n全部 ${testsPassed} 项 E2E 检查全部通过！`);
  await cleanup();
}

main().catch(err => {
  stop(`E2E 执行中断：${err.message}`, 1);
});
