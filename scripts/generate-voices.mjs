// 仅在已配置 MiniMax CLI 登录后运行；所有生成完成后再更新应用清单。
import {readFileSync,writeFileSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
function run(command,args){
  const result=spawnSync(command,args,{cwd:root,encoding:'utf8'});
  if(result.error || result.status!==0){ throw Error(`${command} 未完成：${result.error?.code || '请检查本机登录、余额和网络'}`); }
  return result.stdout;
}
const jobs=JSON.parse(readFileSync(join(root,'voice-pending.json'),'utf8'));
if(!jobs.length){ console.log('没有待补语音'); process.exit(0); }
if(jobs.length>4 || jobs.some(j=>!/^work-[a-z0-9-]+$/.test(j.key) || typeof j.text!=='string')){throw Error('请先检查待生成语音清单');}
run('mmx',['auth','status','--non-interactive','--quiet','--output','json']);
const stage=mkdtempSync(join(tmpdir(),'qingdaka-voices-'));
try{
  for(const job of jobs){
    const textPath=join(stage,job.key+'.txt'), wav=join(stage,job.key+'.wav');
    writeFileSync(textPath,job.text);
    run('mmx',['speech','synthesize','--text-file',textPath,'--voice','female-yujie','--model','speech-2.8-hd','--speed','0.95','--format','wav','--sample-rate','44100','--channels','2','--out',wav,'--non-interactive','--quiet','--output','json']);
    run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',wav,'-c:a','aac','-b:a','128k','-ar','44100','-ac','2','-movflags','+faststart',join(stage,job.key+'.m4a')]);
    console.log('已生成 '+job.key);
  }
  const manifestPath=join(root,'voice-scripts.json');
  const old=JSON.parse(readFileSync(manifestPath,'utf8'));
  const retired=['work-0585','work-0603','work-0596','work-0017'].slice(0,jobs.length);
  if(retired.some(key=>!old.some(entry=>entry.key===key))){throw Error('闲置语音清单已变化，请检查后再替换');}
  const next=old.filter(entry=>!retired.includes(entry.key)).concat(jobs);
  const appPath=join(root,'app.js'), app=readFileSync(appPath,'utf8');
  const map=Object.fromEntries(next.map(entry=>[entry.key,entry.key+'.m4a']));
  const pattern=/var VOICE_FILES = \{[\s\S]*?\n\};/;
  if(!pattern.test(app)){throw Error('应用语音映射格式已变化，未更新清单');}
  for(const job of jobs){copyFileSync(join(stage,job.key+'.m4a'),join(root,'assets/voice',job.key+'.m4a'));}
  writeFileSync(appPath,app.replace(pattern, 'var VOICE_FILES = '+JSON.stringify(map,null,2)+';'));
  writeFileSync(manifestPath,JSON.stringify(next,null,2)+'\n');
  writeFileSync(join(root,'voice-pending.json'),'[]\n');
  console.log(`语音清单更新完成，仍为 ${next.length} 段。请试听后构建发布。`);
}finally{rmSync(stage,{recursive:true,force:true});}
