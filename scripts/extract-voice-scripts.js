#!/usr/bin/env node
/**
 * 从 app.js 里精确提取所有"会被 speak() 播放"的句子，输出 voice-scripts.json
 * 输出格式：[{ key, text, type }, ...]
 *   - key: mp3 文件名（不含后缀），用动作 id 或语义名
 *   - text: 要合成的文本
 *   - type: 'static' / 'warmup' / 'work' / 'stretch'
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app.js');
const OUT = path.join(__dirname, '..', 'voice-scripts.json');
const src = fs.readFileSync(APP, 'utf8');

/** 平衡括号地抽取一个 { ... } 对象文本，起始于 start 指向的 { */
function grabObject(src, start) {
  let depth = 0, j = start;
  while (j < src.length) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
    j++;
  }
  return null;
}

/** 在 src 里从 after 位置开始，匹配所有顶层 {...} 对象的起始索引列表 */
function findTopLevelObjects(src, after) {
  const idxs = [];
  let i = after, inStr = false, strCh = '', inComment = false, inLineComment = false, depth = 0;
  while (i < src.length) {
    const c = src[i], next = src[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; i++; continue; }
    if (inComment) { if (c === '*' && next === '/') { inComment = false; i += 2; continue; } i++; continue; }
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === strCh) inStr = false;
      i++; continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i += 2; continue; }
    if (c === '/' && next === '*') { inComment = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; i++; continue; }
    if (c === '{' && depth === 0) idxs.push(i);
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return idxs;
}

/** 从对象文本里抽几个字段 */
function pickField(objText, key) {
  const re = new RegExp("(?:^|[,{])\\s*" + key + "\\s*:\\s*'([^']*)'", 'm');
  const m = objText.match(re);
  return m ? m[1] : null;
}

/** 抽 ENCOURAGE 数组（简单文本匹配，5 条全是 '...'） */
function extractEncourage(src) {
  const m = src.match(/var ENCOURAGE\s*=\s*\[([^\]]+)\]/);
  if (!m) return [];
  return (m[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
}

const items = [];

// 1) 静态短句
const encourage = extractEncourage(src);
encourage.forEach((t, i) => items.push({ key: 'encourage-' + (i + 1), text: t, type: 'encourage' }));

items.push({ key: 'switch-side', text: '换另一侧', type: 'static' });
items.push({ key: 'countdown-3', text: '3，2，1', type: 'static' });
items.push({ key: 'countdown-start', text: '3，2，1，开始', type: 'static' });
items.push({ key: 'finish-done', text: '训练完成，干得漂亮！记得补充蛋白质。', type: 'static' });
items.push({ key: 'finish-stretch', text: '拉伸完成，放松一下。', type: 'static' });
items.push({ key: 'finish-early', text: '本次已结束，已经按实际完成量记录。', type: 'static' });

// 2) 动作集合：bodyweightMoves / dumbbellMoves / gymMoves / warmupMoves
// 用文本锚点找每个数组的起始位置
const moveArrays = [
  { name: 'bodyweight', marker: 'var bodyweightMoves' },
  { name: 'dumbbell',   marker: 'var dumbbellMoves'   },
  { name: 'gym',        marker: 'var gymMoves'        },
  { name: 'warmup',     marker: 'var warmupMoves'     }
];

for (const arr of moveArrays) {
  const i = src.indexOf(arr.marker);
  if (i === -1) { console.error('missing:', arr.marker); continue; }
  // 找到 marker 后第一个 [ 然后是第一个 {
  const j = src.indexOf('[', i);
  if (j === -1) continue;
  // 数组的结束：平衡 []
  let depth = 0, k = j;
  while (k < src.length) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (depth === 0) break; }
    k++;
  }
  const arrBody = src.slice(j, k + 1);
  // 在数组里找所有顶层对象
  const objIdxs = findTopLevelObjects(arrBody, 0);
  for (const oi of objIdxs) {
    const objText = grabObject(arrBody, oi);
    if (!objText) continue;
    const id = pickField(objText, 'id') || pickField(objText, 'mediaId');
    const name = pickField(objText, 'name');
    const cue = pickField(objText, 'cue');
    const target = pickField(objText, 'target');
    if (!name) continue;
    if (arr.name === 'warmup') {
      items.push({ key: 'warmup-' + (id || name), text: '热身，' + name + '。', type: 'warmup', moveId: id });
    } else if (arr.name === 'stretch') {
      items.push({ key: 'stretch-' + (id || name), text: '拉伸，' + name + '，拉到' + (target || '目标肌群') + '。', type: 'stretch', moveId: id });
    } else {
      // bodyweight / dumbbell / gym 都属于 work
      const cueFirst = cue ? cue.split('。')[0] : '';
      const text = cueFirst
        ? '接下来，' + name + '。' + cueFirst + '。'
        : '接下来，' + name + '。';
      items.push({ key: 'work-' + (id || name), text: text, type: 'work', moveId: id });
    }
  }
}

// 3) 拉伸：STRETCH 字典（'xxxx':{name, sec, target, cue, ...}）+ stretchSets.stretch 的 ID 列表
// 找出 var STRETCH = { ... } 字典范围
{
  const i = src.indexOf('var STRETCH');
  if (i === -1) console.error('missing: var STRETCH');
  else {
    const j = src.indexOf('{', i);
    let depth = 0, k = j;
    while (k < src.length) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) break; }
      k++;
    }
    const dictBody = src.slice(j, k + 1);
    // STRETCH 是 { 'id': { ... }, 'id': { ... } } 形式；
    // 直接在字符串外找所有 " 'key': {" 模式，再 grabObject 拿值对象
    const stretchDict = {};
    const keyRe = /'([A-Za-z0-9_-]+)'\s*:\s*\{/g;
    let m;
    while ((m = keyRe.exec(dictBody)) !== null) {
      const id = m[1];
      const braceStart = m.index + m[0].length - 1; // 指向 {
      const objText = grabObject(dictBody, braceStart);
      if (!objText) continue;
      const name = pickField(objText, 'name');
      const target = pickField(objText, 'target');
      if (name) stretchDict[id] = { name: name, target: target || '目标肌群' };
    }
    // 直接把 STRETCH 字典里所有条目都生成（不同 routine 列表会用不同顺序，但每条都可能被播）
    for (const id of Object.keys(stretchDict)) {
      const s = stretchDict[id];
      items.push({
        key: 'stretch-' + id,
        text: '拉伸，' + s.name + '，拉到' + s.target + '。',
        type: 'stretch',
        moveId: id
      });
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(items, null, 2) + '\n', 'utf8');
console.log('extracted', items.length, 'items ->', OUT);
console.log('  by type:');
const byType = {};
items.forEach(i => { byType[i.type] = (byType[i.type] || 0) + 1; });
Object.keys(byType).forEach(k => console.log('    ', k, ':', byType[k]));
