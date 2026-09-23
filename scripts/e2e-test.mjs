#!/usr/bin/env node
// 每次使用临时浏览器数据；默认自动启动仅本机、随机端口的静态服务。
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const RUN_UNIT_PAGE = process.env.TEST_UNIT_PAGE !== '0';
let server, browser;
async function localServer(){
  server = spawn('python3', ['-u', 'serve.py', '0', '--directory', RUN_UNIT_PAGE ? '.' : 'dist'], {stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Error('本地服务启动超时')), 15000);
    const fail = err => {clearTimeout(timer); reject(err);};
    server.on('error', fail);
    server.on('exit', code => fail(Error('本地服务退出：' + code)));
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if(match){ clearTimeout(timer); resolve(match[0]); }
    });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
  });
}
async function verifyServer(base){
  const response = await new Promise((resolve,reject) => {
    const req = http.get(base + '/index.html', res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({status:res.statusCode,body}));
    });
    req.on('error',reject); req.setTimeout(10000, () => req.destroy(Error('服务响应超时')));
  });
  assert.ok(response.status === 200 && response.body.includes('<title>轻打卡'), base + ' 上不是本项目，请检查 TEST_BASE_URL');
}
async function textIs(page, id, expected){
  await page.waitForFunction(({id,expected}) => document.getElementById(id)?.textContent === expected, {id,expected});
}
/* 窄屏播放器要整屏放得下：内容重叠、被裁切或偷偷滚动都算回归 */
async function stageFits(page){
  const r = await page.evaluate(() => {
    const st = document.querySelector('.pl-stage'), sr = st.getBoundingClientRect();
    const vis = [...st.children].filter(e => !e.hidden && e.offsetParent !== null)
      .map(e => { const b = e.getBoundingClientRect(); return [e.id, b.top, b.bottom]; });
    let overlap = false;
    for(let i=0;i<vis.length;i++) for(let j=i+1;j<vis.length;j++){
      const pair = [vis[i][0],vis[j][0]].sort().join('|');
      if(pair === 'plClock|plMv') continue;
      if(vis[i][1] < vis[j][2]-1 && vis[j][1] < vis[i][2]-1) overlap = true;
    }
    return { overlap, scrolls: st.scrollHeight > st.clientHeight+1,
      clipped: vis.some(v => v[1] < sr.top-1 || v[2] > sr.bottom+1) };
  });
  assert.deepEqual(r, {overlap:false, scrolls:false, clipped:false}, '窄屏播放器排版溢出');
}
async function download(page, selector){
  if(selector === '#btnExport'){ await openDetails(page,'backupDetails'); }
  if(selector === '#btnArchiveExport'){ await openDetails(page,'archiveDetails'); }
  const ready = page.waitForEvent('download'); await page.click(selector);
  return readFile(await (await ready).path(), 'utf8');
}
async function openDetails(page,id){
  if(await page.locator('#'+id).getAttribute('open') === null){ await page.click('#'+id+' > summary'); }
}
async function importBackup(page, data){
  await openDetails(page,'backupDetails');
  await page.setInputFiles('#importFile', {name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await textIs(page,'dlgTitle','核对备份内容');
  await page.click('#dlgOk'); await textIs(page,'toastText','备份已导入并保存');
}
async function unitPage(context, base){
  const page = await context.newPage();
  try{
    await page.goto(base + '/test.html');
    await page.waitForFunction(() => /全部通过|有失败|无法/.test(document.getElementById('summary')?.textContent || ''));
    const summary = await page.textContent('#summary');
    assert.ok(summary.includes('全部通过'), summary + '\n' + await page.locator('.t.bad').allTextContents());
    return summary.trim();
  }finally{await page.close();}
}
async function bodyweightFlow(browser, base){
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try{
    const page = await context.newPage(), errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.clock.install();
    await page.goto(base + '/index.html');
    await page.click('[data-page="training"]');
    await page.locator('.sequence-move').nth(2).click();
    assert.match(await page.locator('#mdMedia').getAttribute('src'), /chair-stand-steps\.svg$/);
    assert.equal(await page.locator('#mdMediaNote').isVisible(),false,'自制分步示意自己带着说明，不再重复一行');
    await page.click('#moveClose');
    await page.locator('.sequence-move',{hasText:'跪姿平板'}).click();
    assert.equal(await page.textContent('#mdMediaNote'),'示范为腿伸直版','示范是别的变体时详情也要标出来');
    await page.click('#moveClose');
    await page.locator('.sequence-move',{hasText:'臀桥'}).click();
    assert.equal(await page.locator('#mdMediaNote').isVisible(),false,'示范与做法一致时不多出一行说明');
    await page.click('#moveClose');
    await page.click('#btnStart');
    assert.equal(await page.textContent('#plPhase'),'准备开始');
    assert.equal(await page.textContent('#plMv'),'原地踏步激活','倒数时就该看到第一个动作');
    assert.equal(await page.locator('#plDemoWrap').isHidden(),false,'倒数时示范不能空着');
    await textIs(page,'plPhase','热身');
    assert.equal(await page.textContent('#plRound'),'1 / 5','热身要显示第几个');
    assert.equal(await page.textContent('#plCue'),'按自己稳住的高度抬膝，手臂自然摆。','热身也是一句口令');
    for(let i=0;i<5;i++) await page.click('#plSkip');
    await textIs(page,'plMv','臀桥');
    assert.equal(await page.locator('#plNext').textContent(),'接下来 · 死虫');
    assert.equal(await page.locator('#plLog').isVisible(),false);
    assert.equal(await page.locator('#plPause').textContent(),'暂停');
    assert.equal(await page.locator('#plCue').textContent(),'脚跟推地抬髋，顶端夹臀，不要拱腰。');
    await page.clock.fastForward(21000);
    await page.click('#plPause');
    const paused = await page.textContent('#plClock');
    await page.clock.fastForward(5000);
    assert.equal(await page.textContent('#plClock'),paused,'暂停时计时停止');
    await page.click('#plPause');
    await textIs(page,'plPhase','训练中');
    await page.click('#plSkip'); await page.click('#plSkip');
    await textIs(page,'plMv','死虫');
    assert.equal(await page.textContent('#plCue'),'对侧手脚慢慢伸出，腰背贴稳垫面，左右交替。','一句口令不能重复换边提示');
    await page.click('#plSkip'); await page.click('#plSkip');
    await textIs(page,'plMv','扶椅坐站（先徒手）');
    await page.waitForFunction(() => document.getElementById('plDemo').getAttribute('src')?.endsWith('chair-stand-steps.svg'));
    await textIs(page,'plBadge','分步示意');
    assert.equal(await page.locator('#plLog').isVisible(),true,'可记档位的动作要能记');
    assert.equal(await page.locator('#plLogLevels button.on').count(),0,'没点过的难度不能默认选中');
    assert.match(await page.textContent('#plLogFor'),/扶椅坐站/);
    await page.click('#plSkip');
    await textIs(page,'plMv','休息一下');
    assert.match(await page.textContent('#plNext'),/^接下来 · /,'休息时只说一次下一个动作');
    await page.click('#plSkip'); await page.click('#plSkip');
    await textIs(page,'plMv','坐姿毛巾划船');
    assert.equal(await page.locator('#plInstructions li').count(),3);
    assert.equal(await page.locator('#plDemoWrap').isVisible(),false,'无媒体动作不能残留上一张示范');
    await page.click('#plPrev');
    await textIs(page,'plMv','休息一下');
    assert.equal(await page.textContent('#plCue'),'恢复呼吸，照着下面的步骤摆好起始位。','下一个动作没有示范时不能说「照着示范」');
    assert.equal(await page.locator('#plInstructions li').count(),3,'休息页也要摆出下一个无媒体动作的文字步骤');
    await page.click('#plSkip');
    await textIs(page,'plMv','坐姿毛巾划船');
    await page.click('#plPrev'); await page.click('#plPrev');
    await textIs(page,'plMv','靠墙俯卧撑');
    await page.waitForFunction(() => document.getElementById('plDemo').getAttribute('src')?.endsWith('0659.gif'));
    assert.equal(await page.locator('#plInstructions').isVisible(),false,'返回有图动作后隐藏文字步骤');
    await page.click('#plSkip'); await page.click('#plSkip');
    await page.click('#plExit');
    await textIs(page,'btnStart','继续跟练');
    await page.click('#btnStart');
    await page.click('#plEnd'); await page.click('#dlgOk');
    await page.waitForSelector('#plDone.show');
    const recorded = await page.evaluate(() => JSON.parse(localStorage.getItem('workbuddy-v5')).logs.filter(l => l.type === 'training'));
    assert.equal(recorded.length,1);
    assert.equal(recorded[0].routine,'bodyweight');
    assert.ok(recorded[0].workSeconds >= 20 && recorded[0].workSeconds < recorded[0].plannedSeconds);
    assert.equal(recorded[0].completedMoves,1);
    assert.equal(recorded[0].lifts,undefined,'隐藏的难度选择不能自动生成训练重量记录');
    await page.click('#plDoneBtn');
    await page.click('[data-ready="yellow"]');
    await textIs(page,'routineDose','每个 20 秒 · 1 轮');
    assert.match(await page.textContent('#routineGear'),/稳固椅子/);
    await page.click('[data-ready="red"]');
    await page.waitForFunction(() => document.getElementById('btnStart').disabled);
    assert.equal(await page.locator('#readyHint').isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
  const missing = await browser.newContext({viewport:{width:320,height:667},serviceWorkers:'block'});
  try{
    const page = await missing.newPage();
    await page.route('**/3013.gif', route => route.abort());
    await page.goto(base + '/index.html');
    await page.click('[data-page="training"]');
    const openMove = name => page.evaluate(n => {
      [...document.querySelectorAll('.sequence-move')].find(e => e.textContent.indexOf(n) >= 0).click();
    }, name);
    await openMove('臀桥');
    await page.waitForFunction(() => document.getElementById('mdMedia').hidden);
    assert.equal(await page.textContent('#mdMediaNote'),'示范暂不可用 · 照着下面的文字步骤','示范取不到时详情不留大方框空图');
    assert.equal(await page.locator('#mdSteps .step').count(),3,'示范不可用时文字步骤仍在同一屏');
    await page.evaluate(() => document.getElementById('moveClose').click());
    await openMove('靠墙俯卧撑');
    await page.waitForFunction(() => document.getElementById('mdMedia').naturalWidth > 0);
    assert.equal(await page.locator('#mdMedia').isVisible(),true,'换一个有图的动作要恢复示范');
    assert.equal(await page.locator('#mdMediaNote').isVisible(),false,'上一屏的说明不能残留');
    await page.evaluate(() => document.getElementById('moveClose').click());
    await page.click('#btnStart');
    await textIs(page,'plPhase','热身');
    for(let i=0;i<5;i++) await page.click('#plSkip');
    await page.waitForSelector('#plInstructions:not([hidden])');
    assert.match(await page.locator('#plInstructions').textContent(),/示范暂不可用/);
    assert.equal(await page.locator('#plInstructions li').count(),3);
    assert.equal(await page.locator('#plDemoWrap').isVisible(),false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    const pause = await page.locator('#plPause').boundingBox();
    assert.ok(pause.y >= 0 && pause.y + pause.height <= 667,'小屏幕暂停按钮应始终可见');
    await stageFits(page);
    await page.click('#plSkip'); await page.click('#plSkip');
    await page.click('#plSkip'); await page.click('#plSkip');
    await textIs(page,'plMv','扶椅坐站（先徒手）');
    assert.equal(await page.locator('#plLog').isVisible(),true,'这一屏要同时容下难度面板');
    await stageFits(page);
  }finally{await missing.close();}
  const full = await browser.newContext({viewport:{width:375,height:667},reducedMotion:'reduce'});
  try{
    const page = await full.newPage();
    await page.clock.install();
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.click('[data-page="training"]'); await page.locator('.sequence-move').nth(2).click();
    await page.waitForFunction(async () => !!(await caches.match(new URL('assets/exercise-guides/chair-stand-steps.svg',document.baseURI).href)));
    await page.click('#moveClose'); await page.click('#btnStart');
    await textIs(page,'plPhase','热身');
    await page.clock.fastForward(31000);
    await textIs(page,'plMv','踝关节绕环');
    const before = Number(await page.textContent('#plClock'));
    await page.clock.runFor(3000);
    assert.ok(Number(await page.textContent('#plClock')) < before,'自然换动作后仍需持续计时');
    for(let i=0;i<4;i++) await page.clock.fastForward((Number(await page.textContent('#plClock'))+1)*1000);
    await textIs(page,'plMv','臀桥');
    await page.waitForFunction(() => document.getElementById('plDemo').getAttribute('src')?.endsWith('3013-poster.png'));
    await textIs(page,'plBadge','静态参考');
    for(let i=0;i<17;i++) await page.clock.fastForward((Number(await page.textContent('#plClock'))+1)*1000);
    await page.waitForSelector('#plDone.show');
    const logs = await page.evaluate(() => JSON.parse(localStorage.getItem('workbuddy-v5')).logs.filter(l => l.type === 'training'));
    assert.equal(logs.length,1); assert.equal(logs[0].status,'completed');
    assert.equal(logs[0].completedMoves,6); assert.equal(logs[0].workSeconds,240);
    assert.equal(logs[0].actualSeconds,logs[0].plannedSeconds);
    await textIs(page,'plDoneBtn','回到训练'); await page.click('#plDoneBtn');
    assert.equal(await page.locator('#page-training').evaluate(el => el.classList.contains('active')),true);
    await full.setOffline(true); await page.reload();
    await page.click('[data-page="training"]'); await page.locator('.sequence-move').nth(2).click();
    await page.waitForFunction(() => document.getElementById('mdMedia').complete && document.getElementById('mdMedia').naturalWidth > 0);
  }finally{await full.close();}
  const other = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try{
    const page = await other.newPage();
    await page.goto(base + '/index.html');
    await page.click('[data-page="training"]');
    await openDetails(page,'trainingOptions');
    await page.click('[data-routine="core"]');
    await textIs(page,'routineGear','备好垫子、靠墙的椅子和两只轻哑铃（或水瓶）；上下地面困难时用墙面斜板替代跪姿。');
    await page.locator('.sequence-move',{hasText:'扶椅坐站'}).click();
    assert.match(await page.locator('#mdMedia').getAttribute('src'),/chair-stand-steps\.svg$/,'腰腹稳定课不能用持铃示范');
    assert.match(await page.textContent('#mdArea'),/无需负重/);
    await page.click('#moveClose');
    await page.locator('.sequence-move',{hasText:'轻负重行走'}).click();
    assert.match(await page.textContent('#mdArea'),/哑铃或水瓶/,'课表里要持重的动作，备物提示里必须已经说过');
    await page.click('#moveClose');
    await page.click('[data-routine="dumbbell"]');
    assert.equal(await page.locator('#routineMoves .sequence-move').count(),5,'哑铃课同样平铺当日顺序');
    await page.locator('.sequence-move',{hasText:'扶凳箱式深蹲'}).click();
    assert.match(await page.locator('#mdMedia').getAttribute('src'),/0291\.(gif|poster\.png)$/,'哑铃课保留原示范');
    await page.click('#moveClose');
    await page.click('[data-routine="stretch"]');
    assert.equal(await page.locator('#routineMoves .sequence-move').count(),9,'拉伸课同样平铺当日顺序');
    await page.locator('.sequence-move',{hasText:'扶墙小腿拉伸'}).click();
    assert.match(await page.textContent('#mdArea'),/全程约 28 秒，左右各一半/,'单侧拉伸的详情要说清左右各一半');
    await page.click('#moveClose');
    await page.locator('.sequence-move',{hasText:'胸前侧拉伸'}).click();
    assert.match(await page.textContent('#mdArea'),/保持约 28 秒/,'双侧拉伸的详情不写换侧');
    await page.click('#moveClose');
    await page.click('#btnStart');
    await textIs(page,'plPhase','拉伸');
    assert.equal(await page.textContent('#plRound'),'全身拉伸 1 / 9','拉伸要显示第几个');
    assert.equal(await page.textContent('#plCue'),'后腿跟贴地、膝伸直，前倾到发紧。过半会提示换侧。','单侧拉伸要说明过半会提示换侧');
    assert.equal(await page.locator('#plLog').isVisible(),false,'拉伸没有档位，不出记录面板');
    await page.click('#plSkip'); await page.click('#plSkip');
    await textIs(page,'plMv','扶墙股四头拉伸');
    assert.equal(await page.locator('#plDemoWrap').isVisible(),false,'无示范的拉伸不占位');
    assert.equal(await page.locator('#plInstructions li').count(),3,'无示范时用分步填住示范区');
    assert.notEqual((await page.locator('#plInstructions li').first().textContent()).trim(),await page.textContent('#plCue'),'分步不能只是重复单行口令');
    assert.equal(await page.textContent('#plCue'),'扶墙抓同侧脚背拉向臀部。过半会提示换侧。');
    assert.equal(await page.textContent('#plNext'),'接下来 · 坐姿臀部拉伸');
  }finally{await other.close();}
  // 单侧动作过半提示换侧：拉伸说拉伸的话，双侧动作不打扰
  const side = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try{
    const page = await side.newPage();
    await page.clock.install();
    await page.goto(base + '/index.html');
    await page.click('[data-page="training"]');
    await openDetails(page,'trainingOptions');
    await page.click('[data-routine="stretch"]');
    await page.click('#btnStart');
    await page.clock.runFor(4000);
    await textIs(page,'plPhase','拉伸');
    assert.equal(await page.textContent('#plBadge'),'拉伸 · 站姿·扶墙','拉伸角标要写明姿势');
    await page.clock.runFor(15000);
    assert.equal(await page.textContent('#plCue'),'现在换侧另一侧同样轻拉到发紧就好。','单侧拉伸过半要提示换侧');
    assert.equal(await page.textContent('#plBadge'),'换另一侧');
    await page.click('#plSkip');
    await textIs(page,'plMv','仰卧抬腿拉伸');
    assert.equal(await page.textContent('#plCue'),'抱一条腿往胸口靠，膝可微屈。过半会提示换侧。','换侧提示不能留到下一个动作');
    for(let i=0;i<3;i++) await page.click('#plSkip');
    await textIs(page,'plMv','胸前侧拉伸');
    assert.equal(await page.textContent('#plCue'),'示范举着短杠；你双手身后交握即可。','双侧动作不加换侧提示');
    await page.clock.runFor(15000);
    assert.equal(await page.textContent('#plCue'),'示范举着短杠；你双手身后交握即可。','双侧动作过半也不出换侧提示');
  }finally{await side.close();}
  // 320 窄屏 + 难度档位面板：口令两行时示范必须自己缩，不能压到上下两块
  const tight = await browser.newContext({viewport:{width:320,height:667},serviceWorkers:'block'});
  try{
    const page = await tight.newPage();
    await page.goto(base + '/index.html');
    await page.click('[data-page="training"]');
    await openDetails(page,'trainingOptions');
    await page.click('[data-routine="core"]');
    await page.click('#btnStart');
    await page.waitForTimeout(3600);
    for(let i=0;i<5;i++) await page.click('#plSkip');
    await textIs(page,'plMv','墙面斜板支撑');
    assert.match(await page.textContent('#plCue'),/能说短句/);
    assert.equal(await page.locator('#plLog').isVisible(),true);
    await stageFits(page);
  }finally{await tight.close();}
  console.log('✓ 徒手清单、分步示意、暂停继续、缺图提示、小屏幕和实际完成记录通过');
  console.log('✓ 整套自动跟练、减少动画偏好与新示意图离线重开通过');
  console.log('✓ 扶椅坐站在腰腹稳定课也用分步示意，居家哑铃仍用原持铃示范');
  console.log('✓ 热身与拉伸同样是示范优先、一句口令');
}
try{
  const base = (process.env.TEST_BASE_URL || await localServer()).replace(/\/$/,'');
  await verifyServer(base);
  browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined});
  await bodyweightFlow(browser,base);
  const context = await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => /已就绪|可离线/.test(document.getElementById('offlineStatus')?.textContent || ''));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.notEqual(await page.locator('#btnUpdateApp').getAttribute('hidden'),null,'首次安装完成后不应残留无效的更新按钮');
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  console.log('✓ 应用及离线资源已加载');
  assert.equal(await page.locator('#tDone').isVisible(),false,'空状态不应显示今天已记');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.ok(csp.includes("media-src 'self' blob: data:") && csp.includes("connect-src 'self'"));

  await page.click('#quickProtein');
  await page.fill('#recordGrams','25'); await openDetails(page,'proteinExtras'); await page.fill('#recordFood','回归测试鸡胸肉');
  await page.selectOption('#recordMeal','lunch'); await page.click('#dlgOk');
  await textIs(page,'pToday','25');
  assert.match(await page.textContent('#todayLogs'), /回归测试鸡胸肉/);
  await page.click('#quickProtein'); await page.fill('#recordGrams','2');
  await page.locator('#proteinExtras > summary').press('Enter');
  assert.notEqual(await page.locator('#proteinExtras').getAttribute('open'),null,'回车应展开选填内容');
  assert.equal(await page.locator('#dialogModal').isVisible(),true,'展开详情不能意外提交记录');
  await page.click('#dlgCancel'); await textIs(page,'pToday','25');
  await page.click('#quickWater'); await textIs(page,'wToday','350');
  await page.click('#toastUndo'); await textIs(page,'wToday','0');
  await page.dblclick('#quickWater'); await textIs(page,'wToday','700');
  await page.reload(); await textIs(page,'wToday','700'); await textIs(page,'pToday','25');
  await page.click('#quickProtein'); await page.click('.food-picker summary');
  assert.match(await page.locator('#quickFoods button').first().textContent(), /≈/);
  await page.locator('#quickFoods button').first().click();
  await page.waitForFunction(() => Number(document.getElementById('pToday').textContent) > 25);
  await page.click('#toastUndo'); await textIs(page,'pToday','25');

  await page.click('[data-page="training"]');
  assert.equal(await page.locator('#routineMoves').isVisible(),true,'当日顺序直接展示');
  assert.equal(await page.locator('.sequence-move').count(),6);
  assert.equal(await page.locator('#routineMoves .sequence-move').count(),6,'不重复显示动作库');
  await openDetails(page,'trainingOptions'); await page.click('[data-routine="dumbbell"]');
  assert.equal(await page.locator('#routineMoves .sequence-move').count(),5);
  await page.click('[data-preset="starter"]'); await textIs(page,'durHint','12.1 分钟');
  await page.click('#trainingOptions > summary');
  await page.click('#btnPlan'); await textIs(page,'planTotal','12.1');
  assert.match(await page.textContent('#planBody'), /休息/);
  await page.click('#planCancel');
  await page.click('[data-ready="red"]'); await page.waitForFunction(()=>document.getElementById('btnStart').disabled);
  assert.equal(await page.locator('#readyHint').isVisible(),true,'身体不适提示不能折叠隐藏');
  await page.click('[data-ready="green"]'); await page.waitForFunction(()=>!document.getElementById('btnStart').disabled);
  await page.click('#btnStart'); await page.waitForSelector('#player.open');
  assert.equal(await page.locator('#planModal').isVisible(),false,'开始跟练无需二次确认安排');
  await page.click('#plExit'); await textIs(page,'btnStart','继续跟练');
  await page.click('#btnStart'); await page.click('#plEnd'); await page.click('#dlgOk');
  await page.waitForSelector('#plDone.show'); await page.click('#plDoneBtn');
  await page.click('[data-page="data"]');
  assert.match(await page.textContent('#proteinCoverage'), /未记录不代表/);
  assert.match(await page.textContent('#archiveSummary'), /3 条记录/);
  const archive = JSON.parse(await download(page,'#btnArchiveExport'));
  assert.equal(archive.kind,'qingdaka-monthly-archive'); assert.equal(archive.logs.length,3);
  await page.click('[data-page="me"]');
  assert.match(await page.textContent('#backupStatus'), /还未导出/);
  const backup = JSON.parse(await download(page,'#btnExport'));
  assert.equal(backup.logs.length,3); assert.equal(backup.v,5);
  await page.waitForFunction(() => document.getElementById('backupStatus').textContent.includes('上次导出'));
  await page.click('#btnClear'); await page.click('#dlgOk');
  await textIs(page,'dlgTitle','再次确认'); await page.click('#dlgOk');
  await textIs(page,'toastText','本机数据已清空');
  await page.reload(); await textIs(page,'pToday','0'); await textIs(page,'wToday','0');
  await page.click('[data-page="me"]'); await importBackup(page,backup);
  await page.click('[data-page="today"]'); await textIs(page,'pToday','25'); await textIs(page,'wToday','700');

  // 超出旧上限的备份，localStorage 中仍完整保留，并可继续记入。
  const large = {...backup, weights:[{ts:Date.now()-7*86400000,kg:80},{ts:Date.now(),kg:79.5}], logs:Array.from({length:3101},(_,i) => ({id:'history-'+i,type:'water',ts:Date.now()-40*86400000+i,ml:350}))};
  await page.click('[data-page="me"]'); await importBackup(page,large);
  await page.click('[data-page="today"]'); await page.click('#quickWater'); await textIs(page,'wToday','350');
  await page.reload(); await textIs(page,'wToday','350');
  await page.click('[data-page="me"]');
  assert.equal(JSON.parse(await download(page,'#btnExport')).logs.length,3102);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('workbuddy-v5')).logs.length), 3102);
  await page.click('[data-page="data"]'); await openDetails(page,'weightHistory');
  await page.setViewportSize({width:320,height:720});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'有体重记录的图表在320px下不应溢出');
  await page.setViewportSize({width:390,height:844});

  // 先注册应用 SW，再开测试页，专门防止测试页污染首页缓存。
  if(RUN_UNIT_PAGE){ console.log(await unitPage(context,base)); }
  else {
    for(const name of ['HANDOVER.md','serve.py','test.html']){
      assert.equal((await context.request.get(base + '/' + name)).status(),404,'非运行时文件应不可访问：'+name);
    }
  }
  await context.setOffline(true);
  await page.reload(); await textIs(page,'wToday','350');
  const ranged = await page.evaluate(async () => {
    const res = await fetch('./assets/voice/countdown-3.m4a',{headers:{Range:'bytes=0-31'}});
    return {status:res.status,bytes:(await res.arrayBuffer()).byteLength,range:res.headers.get('Content-Range'),accept:res.headers.get('Accept-Ranges')};
  });
  assert.equal(ranged.status,206); assert.equal(ranged.bytes,32);
  assert.match(ranged.range,/^bytes 0-31\/\d+$/); assert.equal(ranged.accept,'bytes');
  await context.setOffline(false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),false,'手机页面不应横向溢出');
  assert.deepEqual(errors,[],'页面不应出现 JS 异常');

  // 独立临时上下文模拟损坏数据，导出必须逐字保留原文，不能下载一份空白默认状态。
  const damaged = await browser.newContext();
  damaged.setDefaultTimeout(15000);
  await damaged.addInitScript(() => { if(!localStorage.getItem('workbuddy-v5')) localStorage.setItem('workbuddy-v5','{damaged original'); });
  const rescue = await damaged.newPage();
  const rescueErrors = [];
  rescue.on('pageerror', err => rescueErrors.push(err.message));
  await rescue.goto(base + '/index.html');
  await rescue.waitForFunction(() => document.getElementById('toastText').textContent.includes('读取异常'));
  await rescue.click('[data-page="me"]');
  await rescue.waitForFunction(() => document.getElementById('page-me')?.classList.contains('active'), {timeout:5000});
  assert.deepEqual(rescueErrors, [], '只读模式下切换页面不应抛异常');
  assert.equal(await download(rescue,'#btnExport'),'{damaged original');
  await damaged.close();
  console.log('✅ 快捷记录、撤销、时长、月度导出、完整备份恢复、3102 条记录持久保存通过');
  console.log('✅ 损坏数据原文导出通过');
  console.log('✅ CSP、离线重开与 m4a Range 缓存通过');
}finally{
  if(browser) await browser.close();
  if(server) server.kill('SIGINT');
}
