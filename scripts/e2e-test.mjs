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
try{
  const base = (process.env.TEST_BASE_URL || await localServer()).replace(/\/$/,'');
  await verifyServer(base);
  browser = await chromium.launch();
  const context = await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => /已就绪|可离线/.test(document.getElementById('offlineStatus')?.textContent || ''));
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
  assert.equal(await page.locator('#moveList').isVisible(),false,'动作列表默认收起');
  await openDetails(page,'trainingOptions'); await page.click('[data-routine="dumbbell"]');
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

  // 超出旧上限的备份，真实 IndexedDB + localStorage 中仍完整保留，并可继续记入。
  const large = {...backup, weights:[{ts:Date.now()-7*86400000,kg:80},{ts:Date.now(),kg:79.5}], logs:Array.from({length:3101},(_,i) => ({id:'history-'+i,type:'water',ts:Date.now()-40*86400000+i,ml:350}))};
  await page.click('[data-page="me"]'); await importBackup(page,large);
  await page.click('[data-page="today"]'); await page.click('#quickWater'); await textIs(page,'wToday','350');
  await page.reload(); await textIs(page,'wToday','350');
  await page.click('[data-page="me"]');
  assert.equal(JSON.parse(await download(page,'#btnExport')).logs.length,3102);
  const copies = await page.evaluate(async () => {
    const request = indexedDB.open('qingdaka-v6',1);
    const db = await new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=reject;});
    const read = db.transaction('kv').objectStore('kv').get('state');
    const state = await new Promise((resolve,reject) => {read.onsuccess=()=>resolve(read.result);read.onerror=reject;});
    db.close(); return [JSON.parse(localStorage.getItem('workbuddy-v5')).logs.length,state.logs.length];
  });
  assert.deepEqual(copies,[3102,3102]);
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
  const rescue = await damaged.newPage(); await rescue.goto(base + '/index.html');
  await rescue.waitForFunction(() => document.getElementById('toastText').textContent.includes('读取异常'));
  await rescue.click('[data-page="me"]');
  assert.equal(await download(rescue,'#btnExport'),'{damaged original');
  await damaged.close();
  console.log('✅ 快捷记录、撤销、时长、月度导出、完整备份恢复、3102 条记录持久保存通过');
  console.log('✅ 损坏数据原文导出通过');
  console.log('✅ CSP、离线重开与 m4a Range 缓存通过');
}finally{
  if(browser) await browser.close();
  if(server) server.kill('SIGINT');
}
