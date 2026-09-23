#!/usr/bin/env node
// 从实际课程生成缺失语音任务。已标 SILENT_VOICE 的动作不算缺口。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'content.js'),'utf8'), context);
const content = context.window.QDK_CONTENT;
const manifest = JSON.parse(fs.readFileSync(path.join(root,'voice-scripts.json'),'utf8'));
const known = new Set(manifest.map(entry=>entry.key));
const jobs = new Map();
for(const [routine,moves] of Object.entries(content.routines)){
  const prefix = routine==='stretch'?'stretch-':'work-';
  for(const move of moves){
    const key = content.voiceKey(prefix, move);
    if(!key || known.has(key) || jobs.has(key)) continue;
    jobs.set(key,{key,moveId:move.id,type:routine==='stretch'?'stretch':'work',text:'接下来，'+move.name+'。'+(move.cue||'保持动作稳定。')});
  }
}
const out=path.join(root,'voice-pending.json');
fs.writeFileSync(out,JSON.stringify([...jobs.values()],null,2)+'\n');
console.log(`待生成语音 ${jobs.size} 段 → ${out}`);
