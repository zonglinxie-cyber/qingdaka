// 仅在已配置 MiniMax CLI 登录后运行；全部生成成功后再写入清单。不改 app.js。
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
if(jobs.some(j=>!/^[a-z]+-[a-z0-9-]+$/.test(j.key) || typeof j.text!=='string')){throw Error('请先检查待生成语音清单');}
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
  const next=old.concat(jobs);
  for(const job of jobs){copyFileSync(join(stage,job.key+'.m4a'),join(root,'assets/voice',job.key+'.m4a'));}
  writeFileSync(manifestPath,JSON.stringify(next,null,2)+'\n');
  writeFileSync(join(root,'voice-pending.json'),'[]\n');
  console.log(`语音清单更新完成，共 ${next.length} 段。请试听后构建发布。`);
}finally{rmSync(stage,{recursive:true,force:true});}
