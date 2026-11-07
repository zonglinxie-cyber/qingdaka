(function(){
'use strict';
var content = window.QDK_CONTENT, store = window.QDK_STORE;
var $ = function(id){ return document.getElementById(id); };
var S = null, readOnly = false, pageName = 'today', courseId = 'minute', mode = 'seated';
var engine = null, sessionMeta = null, plan = [], pendingFinish = null, finishReason = 'early', feedback = 'unknown';
var sessionRelease = null, sessionLockPending = false, starting = false, saving = false, startEpoch = 0;
var checkpointQueue = Promise.resolve(), lastCheckpoint = 0, lastStep = -1, lastPhase = '', checkpointFailed = false;
var registration = null, updateRequested = false, wakeLock = null, audioContext = null, lastBeepStep = -1;
var toastTimer, historyLimit = 20, activeDate = dateKey(), messageAction = null, messageCancelAction = null, recoveryId = null, safetyResume = false;
var anchors = {lunch:'午饭收好餐具后',work:'工作告一段落后',home:'回家换好衣服后'};
var feedbackNames = {easy:'轻松',okay:'合适',hard:'太吃力',discomfort:'疼痛或不适',unknown:'未记感受'};
var recoveryNames = {good:'之后没有新不适',tired:'之后仍有疲劳',pain:'之后有疼痛或不适',unknown:'恢复未记录'};
var phaseNames = {prepare:'先准备好',move:'轻活动回合',rest:'这一段，休息',settle:'慢慢收尾'};
function dateKey(value){ var d = value == null ? new Date() : new Date(value); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function recentDates(n){ var out = []; for(var i=n-1;i>=0;i--){var d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-i);out.push(dateKey(d));} return out; }
function text(id,value){ $(id).textContent = value; }
function esc(value){ return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
function secondsLabel(value){ var s = Math.max(0,Math.floor(value + 0.000001));return s >= 60 ? Math.floor(s/60)+' 分 '+s%60+' 秒' : s+' 秒'; }
function course(id){ return content.courses.find(function(c){return c.id === id;}); }
function courseName(id){ var c=course(id);return c ? c.name : '历史轻活动'; }
function dayRecord(){return S && S.days[dateKey()] || {};}
function toast(message){ clearTimeout(toastTimer); text('toast',message);$('toast').hidden=false;toastTimer=setTimeout(function(){$('toast').hidden=true;},4200); }
function openDialog(id){ if(!$(id).open){$(id).showModal();} document.body.classList.add('modal-open'); }
function closeDialog(id){ if(id==='safetyDialog'){startEpoch++;} if($(id).open){$(id).close();} if(!document.querySelector('dialog[open]')){document.body.classList.remove('modal-open');} }
function message(title,body,action,label,onCancel){ text('messageTitle',title);text('messageBody',body);messageAction=action||null;messageCancelAction=onCancel||null;text('messageConfirm',label||'知道了');$('messageCancel').hidden=!action;openDialog('messageDialog'); }
function report(error){ console.error('[轻打卡]',error);toast(error && error.code==='LOCK_UNAVAILABLE' ? '浏览器暂不支持安全保存，请使用新版 Safari。原记录没有改变。' : '没有保存成功，请重试或先导出备份。原记录没有被覆盖。'); }
async function mutate(fn,success){ if(readOnly || !S){message('当前记录受保护','请先导出原文，再导入一份有效备份，或确认清空新版数据。');return false;}try{S=await store.transact(fn);if(success){toast(success);}return true;}catch(e){report(e);return false;} }
function editDay(draft,key,fn){ if(!draft.days[key]){draft.days[key]={};}fn(draft.days[key]);draft.days[key].updatedAt=Date.now(); }
function goPage(name){ if(['today','move','rhythm','review'].indexOf(name)<0){name='today';}pageName=name;document.querySelectorAll('.page').forEach(function(p){p.hidden=p.id!=='page-'+name;});document.querySelectorAll('.bottom-nav [data-page]').forEach(function(b){if(b.dataset.page===name){b.setAttribute('aria-current','page');}else{b.removeAttribute('aria-current');}});history.replaceState(null,'','#'+name);window.scrollTo(0,0);if(name==='review'){probeOffline();} }
function renderToday(){
  if(!S){return;}var day=dayRecord(),today=dateKey(),todaySessions=S.sessions.filter(function(s){return s.date===today && s.activeSeconds>0;}),sleepFirst=S.settings.focus==='sleep';
  text('todayDate',new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'}));
  text('todayLead',day.rest ? '今天选择休息，不需要补做。身体状态变化时，重新确认再活动。' : '不用一下改变所有习惯。先找到一个能重复的小动作。');
  text('heroTitle',sleepFirst?'今晚，慢慢收尾。':'先动 1 分钟。');text('heroDescription',sleepFirst?'选一个收尾动作就好。不考核几点睡着，也不需要临睡前打开手机。':'含准备和休息，不追次数，不必出汗。坐稳后试一个小回合。');
  text('heroNumber',sleepFirst?'☾':'1');text('heroUnit',sleepFirst?'只选一个小动作':'分钟 · 含休息');
  text('anchorLine',sleepFirst?(S.settings.windDownTime ? S.settings.windDownTime+' 开始收尾，不是入睡截止时间。':'先从调暗灯、放下手机开始。'):(anchors[S.settings.anchor]||'生活告一段落后')+'，给自己一点活动时间。');
  text('todayStart',sleepFirst?'看看今晚怎么收尾 ↗':(todaySessions.length?'今天已经开始过了 · 不必加做':'开始我的小回合 ↗'));
  text('todayActivity',todaySessions.length?'今天已记录 '+todaySessions.length+' 次轻活动 · 实际活动 '+secondsLabel(todaySessions.reduce(function(a,s){return a+s.activeSeconds;},0)):(day.rest?'今天记了休息。照顾身体也是安排的一部分。':'先开始，不追求每天都做到。'));
  text('wakeSummary',(S.settings.wakeTime?'锚点 '+S.settings.wakeTime+'。':'尚未设置锚点。')+(day.wakeTime?'今天记录 '+day.wakeTime+' 起床。':'记实际时间，不评分。'));
  text('windSummary',(S.settings.windDownTime?S.settings.windDownTime+' 开始收尾。':'选一个现实的收尾时间。')+(day.windDown?'今天已记下。':'第二天也可以补记。'));
  text('breakSummary',day.breaks?'今天记录了 '+day.breaks+' 次活动间隙。':'没记录，不代表没做到。');
  $('resumeCard').hidden=!S.activeSession;text('resumeTitle',S.activeSession && S.activeSession.phase==='done'?'上次活动还没保存感受':'上次的小回合可以接着来');
  var dates=recentDates(7),prev=S.sessions.slice().reverse().find(function(s){return s.date<today&&dates.includes(s.date)&&s.activeSeconds>0&&s.recovery==='unknown';});
  recoveryId=prev?prev.id:null;$('recoveryCard').hidden=!prev;
  text('wakeTarget',S.settings.wakeTime||'尚未设置');text('windTarget',S.settings.windDownTime||'尚未设置');
}
function renderMove(){
  var c=course(courseId);text('courseDescription',c.description);var m=content.modes.find(function(v){return v.id===mode;});text('modeGear',m.equipment);
  document.querySelectorAll('[data-course]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.course===courseId));});document.querySelectorAll('[data-mode]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  var p=content.buildPlan(courseId,mode),ids=[];p.forEach(function(st){if(st.moveId&&!ids.includes(st.moveId)){ids.push(st.moveId);}});
  $('learningList').innerHTML=ids.map(function(id){var m=content.moves.find(function(x){return x.id===id;});return '<button class="learn-button" data-learn="'+esc(id)+'"><img src="'+esc(m.image)+'" alt="" width="76" height="66"><span><strong>'+esc(m.name)+'</strong><small>'+esc(m.cue)+'</small></span><span class="arrow" aria-hidden="true">↗</span></button>';}).join('');
  text('moveSafety',content.safety.stop+' '+content.safety.gout);
}
function renderReview(){
  if(!S){return;}var dates=recentDates(7),week=S.sessions.filter(function(s){return dates.includes(s.date)&&s.activeSeconds>0;}),wake=dates.filter(function(d){return S.days[d]&&S.days[d].wakeTime;}).length,wind=dates.filter(function(d){return S.days[d]&&S.days[d].windDown;}).length;
  $('reviewStats').innerHTML='<div class="stat"><strong>'+week.length+'</strong><small>近 7 天活动记录</small></div><div class="stat"><strong>'+wake+'</strong><small>有起床记录的天数</small></div><div class="stat"><strong>'+wind+'</strong><small>有收尾记录的天数</small></div>';
  $('weekGrid').innerHTML=dates.map(function(d){var r=S.days[d]||{},has=week.some(function(s){return s.date===d;}),label=has?'●':'';if(r.windDown){label+='☾';}if(r.rest){label+='休';}return '<div class="week-day'+(label?' has-record':'')+'"><time datetime="'+d+'">'+Number(d.slice(8))+'日</time><span aria-label="'+esc(d+' '+(has?'有轻活动记录 ':'')+(r.windDown?'有收尾记录 ':'')+(r.rest?'休息':'')+(!label?'未记录':''))+'">'+(label||'·')+'</span></div>';}).join('');
  var last=S.sessions[S.sessions.length-1],advice='下一次保持原样就好。记录少的时候，先找一个更方便的触发点，不急着增加时间。';
  if(last&&(last.feedback==='discomfort'||last.recovery==='pain')){advice='上次记了疼痛或不适：先暂停常规跟练，处理症状并咨询适合的活动。不要靠换姿势硬撑。';}else if(last&&(last.feedback==='hard'||last.recovery==='tired')){advice='上次有些吃力或疲劳。可以先休息，恢复后仍从最短版本开始，不补量。';}
  text('reviewAdvice',advice);
  var sessions=S.sessions.slice().reverse().slice(0,historyLimit);
  $('sessionHistory').innerHTML=sessions.length?sessions.map(function(s){return '<article class="history-item"><div><strong>'+esc(courseName(s.courseId))+'</strong><p>'+esc((s.mode==='seated'?'坐姿':'站姿')+' · '+(s.status==='completed'?'走完流程':s.status==='partial'?'部分参与':'提前结束'))+'</p><p>实际活动 '+secondsLabel(s.activeSeconds)+' · 流程 '+secondsLabel(s.elapsedSeconds)+'</p><p>'+esc(feedbackNames[s.feedback])+' · '+esc(recoveryNames[s.recovery])+'</p><button data-delete-session="'+esc(s.id)+'">删除误记</button></div><time datetime="'+esc(s.date)+'">'+esc(s.date.slice(5))+'</time></article>';}).join(''):'<p class="empty">还没有活动记录。先看懂一个动作，再试一个短回合就好。</p>';
  $('historyMore').hidden=S.sessions.length<=historyLimit;
  var dayKeys=Object.keys(S.days).sort().reverse();
  $('rhythmHistory').innerHTML=dayKeys.slice(0,31).map(function(d){var r=S.days[d];return '<div class="history-item"><div><strong>'+esc(d)+'</strong><p>'+esc((r.wakeTime?'起床 '+r.wakeTime:'起床未记录')+' · '+(r.windDown?'已做收尾':'收尾未记录')+(r.rest?' · 休息':''))+'</p></div><button data-edit-day="'+esc(d)+'">更正</button></div>';}).join('')||'<p class="muted">这里显示自己填写的事实，不推算睡眠时长或睡眠质量。</p>';
}
function renderAll(){renderToday();renderReview();}
function setup(){if(!S){return;}var v=S.settings;$('focusInput').value=v.focus==='sleep'?'sleep':'move';$('anchorInput').value=anchors[v.anchor]?v.anchor:'lunch';$('wakeInput').value=v.wakeTime;$('windInput').value=v.windDownTime;$('soundInput').checked=v.sound;openDialog('setupDialog');}
function recordDialog(key){key=key||dateKey();$('recordDate').max=dateKey();$('recordDate').value=key;fillRecord(key);openDialog('recordDialog');}
function fillRecord(key){var d=S&&S.days[key]||{};$('actualWake').value=d.wakeTime||'';$('actualWind').checked=!!d.windDown;}
function safety(resume){if(!S||readOnly){report(new Error('数据不可写'));return;}if(S.activeSession&&!resume){toast('先处理上次的活动，再开始新的回合。');goPage('today');return;}safetyResume=!!resume;$('equipmentCheck').checked=false;$('safetyBegin').disabled=true;var targetMode=resume&&S.activeSession?S.activeSession.mode:mode;text('equipmentCheckText',targetMode==='seated'?'我已看懂动作，确认椅子稳固、承重适合、无轮，双脚能平放。':'我已看懂动作，站立和走路无痛且稳定，路线平整无障碍。');openDialog('safetyDialog');}
function rest(reason){
  startEpoch++;
  if(engine&&engine.get().phase!=='done'){feedback='discomfort';engine.pause();engine.finish();}
  closeDialog('safetyDialog');
  if(reason==='emergency'){message('先停止，立即寻求急救',content.safety.emergency+' 若在中国大陆可拨打 120。不要等待完成问卷或训练记录。');}
  else if(reason==='joint'){message('今天先照顾身体',content.safety.gout+' '+content.safety.jointUrgent);}
  else{message('不确定时，不必急着开始',content.safety.beforeStarting+' 今天可以休息，不需要补做。');}
  // 求助信息先显示，记录不能成为急症处理的等待条件。
  var key=dateKey();if(S&&!readOnly){store.transact(function(d){editDay(d,key,function(r){r.rest=true;});}).catch(function(e){console.error('[休息标记未保存]',e);});}
}
async function acquireSession(){
  if(sessionRelease){return true;}if(sessionLockPending){return false;}if(!navigator.locks){message('需要支持安全恢复的浏览器','请更新 iPhone 系统并使用 Safari 或主屏应用。当前不能安全防止两处同时跟练，因此不启动计时；仍可查看动作和导出记录。');return false;}
  sessionLockPending=true;
  return new Promise(function(resolve){navigator.locks.request('qingdaka-habits:active-session',{ifAvailable:true},async function(lock){sessionLockPending=false;if(!lock){toast('另一个页面正在处理这次活动，请先在那里暂停并收起。');resolve(false);return;}await new Promise(function(release){sessionRelease=release;resolve(true);});}).catch(function(e){sessionLockPending=false;report(e);resolve(false);});});
}
function releaseSession(){if(sessionRelease){sessionRelease();sessionRelease=null;}}
function clearLocalSession(){if(engine){engine.destroy();}engine=null;sessionMeta=null;pendingFinish=null;releaseWake();releaseSession();}
function makeSnapshot(state){return {id:sessionMeta.id,courseId:sessionMeta.courseId,mode:sessionMeta.mode,startedAt:sessionMeta.startedAt,phase:state.phase,stepIndex:state.stepIndex,left:state.left,elapsedSeconds:state.elapsedSeconds,activeSeconds:state.activeSeconds,updatedAt:Math.max(sessionMeta.startedAt,state.updatedAt*1000),planKey:state.planKey};}
function checkpoint(state,force){
  if(!sessionMeta){return Promise.resolve(true);}var changed=state.stepIndex!==lastStep||state.phase!==lastPhase;
  if(!force&&!changed&&Date.now()-lastCheckpoint<3000){return checkpointQueue;}
  lastCheckpoint=Date.now();lastStep=state.stepIndex;lastPhase=state.phase;var snap=makeSnapshot(state);
  checkpointQueue=checkpointQueue.then(async function(){try{S=await store.transact(function(d){if(!d.activeSession||d.activeSession.id!==snap.id){throw new Error('会话已在另一处被处理');}d.activeSession=snap;});checkpointFailed=false;text('playerSaved','进度已保存在本机 · 切后台会暂停');return true;}catch(e){if(!checkpointFailed){checkpointFailed=true;if(engine){engine.pause();}report(e);}text('playerSaved','进度尚未保存，已暂停；请重试或结束并保存。');return false;}});
  return checkpointQueue;
}
function initEngine(snapshot){
  plan=content.buildPlan(sessionMeta.courseId,sessionMeta.mode);lastStep=-1;lastPhase='';lastBeepStep=-1;lastCheckpoint=0;pendingFinish=null;feedback='unknown';
  var resumeSnapshot=snapshot?Object.assign({},snapshot,{updatedAt:snapshot.updatedAt/1000}):null;
  engine=window.QDK_SESSION.create({plan:plan,snapshot:resumeSnapshot,onChange:function(s){renderPlayer(s);checkpoint(s,false);if(s.phase==='paused'){releaseWake();}if(s.phase==='running'&&s.stepIndex!==lastBeepStep){lastBeepStep=s.stepIndex;beep();}},onFinish:function(s,reason){finishReason=reason;pendingFinish=s;releaseWake();checkpoint(s,true);showFinish();}});
}
async function begin(){
  if(starting){return;}starting=true;var epoch=++startEpoch;$('safetyBegin').disabled=true;
  try{
    if(!await acquireSession()){return;}S=await store.load();
    if(epoch!==startEpoch||document.hidden||!$('safetyDialog').open){releaseSession();return;}
    if(safetyResume){
      if(!S.activeSession){releaseSession();toast('上次活动已经处理过了。');closeDialog('safetyDialog');return;}
      sessionMeta=Object.assign({},S.activeSession);initEngine(S.activeSession);
      if(engine.get().planKey!==S.activeSession.planKey){pendingFinish=Object.assign({},S.activeSession,{phase:'done',left:0,updatedAt:S.activeSession.updatedAt/1000});finishReason='early';closeDialog('safetyDialog');message('课程已更新','不会把旧进度套进新安排。已做的部分可以如实保存。',showFinish,'保存已做部分',clearLocalSession);return;}
    }else{
      if(S.activeSession){releaseSession();toast('已有未处理活动，请先回到今天继续。');closeDialog('safetyDialog');goPage('today');return;}
      sessionMeta={id:uid(),courseId:courseId,mode:mode,startedAt:Date.now()};initEngine();var snap=makeSnapshot(engine.get());
      S=await store.transact(function(d){if(d.activeSession){throw new Error('已有活动');}d.activeSession=snap;});
    }
    if(epoch!==startEpoch||document.hidden||!$('safetyDialog').open){clearLocalSession();goPage('today');return;}
    closeDialog('safetyDialog');openDialog('player');renderPlayer(engine.get());unlockAudio();engine.start();requestWake();
  }catch(e){if(engine){engine.destroy();engine=null;}sessionMeta=null;releaseSession();report(e);}finally{starting=false;$('safetyBegin').disabled=!$('equipmentCheck').checked;}
}
function renderPlayer(s){
  if(!plan.length){return;}var step=plan[s.stepIndex],next=plan[s.stepIndex+1];
  text('playerPhase',s.phase==='paused'?'已暂停 · 休息多久都可以':phaseNames[step.kind]);text('playerTitle',step.name);text('playerClock',Math.ceil(s.left));
  text('playerProgress',(s.stepIndex+1)+' / '+plan.length+' 段');text('playerCue',step.cue);text('playerNext',next?'接下来 · '+next.name:'这是最后一段，不需要加做。');text('playerPause',s.phase==='running'?'暂停':'继续');
  var image=$('playerImage');if(image.getAttribute('src')!==step.image){image.hidden=false;image.src=step.image;image.alt=step.imageAlt||step.name;}
}
function showFinish(){
  if(!pendingFinish&&engine){pendingFinish=engine.get();}if(!pendingFinish){return;}closeDialog('player');
  text('finishTitle',pendingFinish.activeSeconds>0?'今天有一个小开始。':'今天先熟悉一下，也可以。');
  text('finishSummary','实际活动 '+secondsLabel(pendingFinish.activeSeconds)+' · 流程共 '+secondsLabel(pendingFinish.elapsedSeconds)+'。准备、休息与收尾没有算作活动。');
  $('finishError').hidden=true;text('saveSession','保存实际记录');setFeedback(feedback);openDialog('finishDialog');
}
function setFeedback(value){feedback=value;document.querySelectorAll('[data-feedback]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.feedback===value));});$('finishSafety').hidden=value!=='discomfort';text('finishSafety',content.safety.emergency+' 若在中国大陆可拨打 120，不要等待保存记录。'+content.safety.stop+' '+content.safety.jointUrgent);}
async function saveFinished(){
  if(saving||!pendingFinish||!sessionMeta){return;}saving=true;$('saveSession').disabled=true;
  try{
    await checkpointQueue;var snap=pendingFinish,meta=sessionMeta,total=plan.reduce(function(n,s){return n+s.seconds;},0);
    try{total=JSON.parse(snap.planKey).reduce(function(n,row){return n+Number(row[2]);},0);}catch(_){}
    var complete=finishReason==='natural'&&snap.elapsedSeconds>=total-.01;
    var record={id:meta.id,date:dateKey(meta.startedAt),startedAt:meta.startedAt,endedAt:Math.max(Date.now(),meta.startedAt),courseId:meta.courseId,mode:meta.mode,plannedSeconds:total,activeSeconds:Math.max(0,snap.activeSeconds),elapsedSeconds:Math.max(snap.activeSeconds,snap.elapsedSeconds),status:complete?'completed':(finishReason==='partial'||finishReason==='skipped'?'partial':'stopped'),feedback:feedback,recovery:'unknown'};
    S=await store.transact(function(d){if(d.sessions.some(function(s){return s.id===record.id;})){if(d.activeSession&&d.activeSession.id===record.id){d.activeSession=null;}return;}if(!d.activeSession||d.activeSession.id!==record.id){throw new Error('活动已在其他页面处理');}d.sessions.push(record);d.activeSession=null;if(feedback==='discomfort'){editDay(d,dateKey(),function(r){r.rest=true;});}});
    if(engine){engine.destroy();}engine=null;pendingFinish=null;sessionMeta=null;releaseSession();closeDialog('finishDialog');goPage('today');renderAll();toast(record.activeSeconds>0?'已按实际记录。不自动增加下一次的量。':'已记下这次尝试，没有算作活动完成。');
  }catch(e){console.error(e);text('finishError','尚未保存成功。当前内容仍保留，请重试；不要清理浏览器数据。');$('finishError').hidden=false;text('saveSession','重试保存');}finally{saving=false;$('saveSession').disabled=false;}
}
async function collapsePlayer(){
  startEpoch++;if(!engine){return;}var current=engine;current.pause();
  if(current.get().phase==='done'){return;}
  if(!await checkpoint(current.get(),true)){toast('暂未保存，进度仍保留在此页；请重试，不要刷新。');return;}
  if(engine!==current||pendingFinish){return;}
  closeDialog('player');clearLocalSession();goPage('today');renderAll();toast('已暂停并保留进度，离开期间不会计时。');
}
async function deferFinish(){
  if(saving){return;}closeDialog('finishDialog');goPage('today');
  if(pendingFinish&&sessionMeta){var kept=pendingFinish;if(await checkpoint(kept,true)){if(pendingFinish===kept){clearLocalSession();}}else{toast('尚未保存，先保留这个页面，身体要紧；稍后可继续处理。');}}
}
async function resume(){
  if(pendingFinish&&sessionMeta){showFinish();return;}
  if(!S||!S.activeSession){return;}if(S.activeSession.phase!=='done'){safety(true);return;}
  if(!await acquireSession()){return;}try{S=await store.load();if(!S.activeSession){releaseSession();return;}sessionMeta=Object.assign({},S.activeSession);initEngine(S.activeSession);pendingFinish=Object.assign({},S.activeSession,{updatedAt:S.activeSession.updatedAt/1000});var total=plan.reduce(function(n,s){return n+s.seconds;},0);finishReason=pendingFinish.elapsedSeconds>=total-.01?'natural':'early';showFinish();}catch(e){releaseSession();report(e);}
}
function unlockAudio(){if(!S||!S.settings.sound){return;}try{if(!audioContext){var C=window.AudioContext||window.webkitAudioContext;if(C){audioContext=new C();}}if(audioContext){audioContext.resume().catch(function(){});}}catch(_){} }
function beep(){if(!S||!S.settings.sound||!audioContext||audioContext.state!=='running'){return;}try{var o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=580;g.gain.setValueAtTime(.055,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.16);o.connect(g);g.connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+.17);}catch(_){} }
async function requestWake(){try{if(navigator.wakeLock&&!document.hidden){wakeLock=await navigator.wakeLock.request('screen');if(!engine||engine.get().phase!=='running'){releaseWake();}}}catch(_){} }
function releaseWake(){if(wakeLock){wakeLock.release().catch(function(){});wakeLock=null;}}
function download(value,name){var blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},60000);toast('已发起导出，请确认文件已保存到浏览器之外。');}
function buildHelp(){
  var sections=[['从小活动开始',content.safety.beforeStarting],['不舒服就停止',content.safety.stop],['需要紧急帮助时',content.safety.emergency+' 在中国大陆可拨打 120。'],['关节发作时',content.safety.gout+' '+content.safety.jointUrgent],['睡眠问题不只靠自律','大声打鼾、憋醒、被观察到停呼吸或白天明显困倦，请考虑睡眠／呼吸门诊评估。不能等减重成功才检查。长期失眠应寻求专业帮助；一般睡眠习惯支持不等于失眠治疗。'],['小回合不是运动处方','少量活动比完全不动好。每周 150 分钟是长期公共健康参考，不是起步欠账。1／3／5 分钟包含休息，不会自动换算成达标的中等强度运动。'],['信息与隐私','无需账号，无云同步，无分析追踪，不上传记录。浏览器本地存储仍可能被清理。只保留你主动填写的作息与活动，不收集体重、年龄或诊断。']];
  $('helpContent').innerHTML=sections.map(function(s){return '<h3>'+esc(s[0])+'</h3><p>'+esc(s[1])+'</p>';}).join('');
  $('sourceList').innerHTML=content.sources.map(function(s){return '<li><a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+'</a><small>'+esc(s.note||'')+'</small></li>';}).join('');
}
function hasUnsaved(){return !!(starting||saving||engine||pendingFinish||(S&&S.activeSession)||document.querySelector('dialog[open]'));}
function probeOffline(){
  $('updateApp').hidden=!(registration&&registration.waiting);
  if(!registration||!registration.active){text('offlineStatus',location.protocol==='http:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'?'局域网 HTTP 不支持完整离线安装，请使用固定 HTTPS 地址。':'离线资源准备中，请先保持联网。');return;}
  var ch=new MessageChannel(),timer=setTimeout(function(){ch.port1.close();text('offlineStatus','暂未确认完整离线状态，请联网重新检查。');},4000);
  ch.port1.onmessage=function(e){clearTimeout(timer);ch.port1.close();var d=e.data||{};text('offlineStatus',d.ready&&d.courseReady?'核心页面与全部轻活动示意已离线就绪。':'资源还未完整准备好，先保持联网使用。');text('appVersion',d.version?'当前离线版本：'+d.version:'');};registration.active.postMessage({type:'OFFLINE_STATUS'},[ch.port2]);
}
async function initOffline(){
  if(!('serviceWorker' in navigator)){text('offlineStatus','当前环境不支持离线安装，请保持联网使用。');return;}
  try{registration=await navigator.serviceWorker.register('./sw.js');registration.addEventListener('updatefound',function(){var installing=registration.installing;if(installing){installing.addEventListener('statechange',function(){if(installing.state==='installed'||installing.state==='redundant'){probeOffline();}});}});await navigator.serviceWorker.ready;probeOffline();registration.update().catch(function(){});}catch(_){text('offlineStatus','本次未启用离线功能。请使用 Safari 打开固定 HTTPS 地址。');}
}

// 所有动态内容均来自已校验状态或固定内容；用户文字只以 textContent 或转义后显示。
document.addEventListener('click',function(e){var button=e.target.closest('button');if(!button){return;}if(button.dataset.page){goPage(button.dataset.page);}if(button.dataset.close){closeDialog(button.dataset.close);}if(button.hasAttribute('data-settings')){setup();}if(button.hasAttribute('data-help')){openDialog('helpDialog');}
  if(button.dataset.course){courseId=button.dataset.course;renderMove();}if(button.dataset.mode){mode=button.dataset.mode;renderMove();}
  if(button.dataset.learn){var m=content.moves.find(function(v){return v.id===button.dataset.learn;});if(m){text('learnTitle',m.name);$('learnImage').src=m.image;$('learnImage').alt=m.imageAlt;text('learnCaution',m.caution);$('learnSteps').innerHTML=m.steps.map(function(s){return '<li>'+esc(s)+'</li>';}).join('');openDialog('learnDialog');}}
  if(button.dataset.feedback){setFeedback(button.dataset.feedback);}
  if(button.dataset.recovery&&recoveryId){var id=recoveryId,val=button.dataset.recovery;mutate(function(d){var s=d.sessions.find(function(x){return x.id===id;});if(s){s.recovery=val;}},'已记下。下一次不必加量。');if(val==='pain'){message('先处理不适，不急着继续',content.safety.stop+' '+content.safety.jointUrgent);}}
  if(button.dataset.editDay){recordDialog(button.dataset.editDay);}
  if(button.dataset.deleteSession){var sessionId=button.dataset.deleteSession;message('删除这条误记？','只删除选中的活动，不影响其他日期。',function(){return mutate(function(d){d.sessions=d.sessions.filter(function(s){return s.id!==sessionId;});},'已删除这条记录。');},'确认删除');}
});
document.querySelectorAll('dialog').forEach(function(d){d.addEventListener('close',function(){if(!document.querySelector('dialog[open]')){document.body.classList.remove('modal-open');}});});
$('messageConfirm').addEventListener('click',async function(){var action=messageAction;messageAction=null;messageCancelAction=null;closeDialog('messageDialog');if(action){try{await action();}catch(e){report(e);}}});
function cancelMessage(){var action=messageCancelAction;messageAction=null;messageCancelAction=null;closeDialog('messageDialog');if(action){action();}}
$('messageCancel').addEventListener('click',cancelMessage);$('messageDialog').addEventListener('cancel',function(e){e.preventDefault();cancelMessage();});
$('safetyDialog').addEventListener('cancel',function(){startEpoch++;});
$('openSettings').addEventListener('click',setup);
$('setupForm').addEventListener('submit',async function(e){e.preventDefault();var settings={onboarded:true,wakeTime:$('wakeInput').value,windDownTime:$('windInput').value,anchor:$('anchorInput').value,focus:$('focusInput').value,sound:$('soundInput').checked,motion:true};if(await mutate(function(d){d.settings=settings;},'节奏已保存。时间只是计划，提醒请在 iPhone 系统里设置。')){closeDialog('setupDialog');}});
$('todayStart').addEventListener('click',function(){if(!S){return;}if(S.settings.focus==='sleep'){openDialog('windDialog');return;}if(S.sessions.some(function(s){return s.date===dateKey()&&s.activeSeconds>0;})){goPage('review');return;}courseId='minute';mode='seated';renderMove();safety(false);});
$('moveStart').addEventListener('click',function(){safety(false);});$('equipmentCheck').addEventListener('change',function(){$('safetyBegin').disabled=!this.checked;});$('safetyBegin').addEventListener('click',begin);
$('safetyEmergency').addEventListener('click',function(){rest('emergency');});$('safetyJoint').addEventListener('click',function(){rest('joint');});$('safetyUnsure').addEventListener('click',function(){rest('unsure');});
$('resumeSession').addEventListener('click',resume);
$('discardSession').addEventListener('click',function(){message('放弃上次未完成的活动？','这段进度将不写入历史。不是清空以往记录，也没有需要补做的量。',async function(){if(!await acquireSession()){return;}try{var id=S.activeSession&&S.activeSession.id;await mutate(function(d){if(d.activeSession&&d.activeSession.id===id){d.activeSession=null;}},'已放下这次进度，下一次从小回合开始。');}finally{releaseSession();}},'确认放弃');});
['recordWake','rhythmWake','editRhythmRecord'].forEach(function(id){$(id).addEventListener('click',function(){recordDialog();});});
$('recordDate').addEventListener('change',function(){fillRecord(this.value);});
$('recordForm').addEventListener('submit',async function(e){e.preventDefault();var key=$('recordDate').value,wake=$('actualWake').value,wind=$('actualWind').checked;if(!key||key>dateKey()){toast('请选择今天或以前的实际日期。');return;}if(await mutate(function(d){editDay(d,key,function(r){if(wake){r.wakeTime=wake;}else{delete r.wakeTime;}r.windDown=wind;});},'已按你填写的时间记录。')){closeDialog('recordDialog');}});
['openWindDown','rhythmWind'].forEach(function(id){$(id).addEventListener('click',function(){openDialog('windDialog');});});
$('markWindDown').addEventListener('click',async function(){var key=dateKey();if(await mutate(function(d){editDay(d,key,function(r){r.windDown=true;});},'已记下。可以放下手机了。')){closeDialog('windDialog');}});
$('windBackfill').addEventListener('click',function(){closeDialog('windDialog');var d=new Date();d.setDate(d.getDate()-1);recordDialog(dateKey(d));});
$('recordBreak').addEventListener('click',function(){var key=dateKey();message('记一次刚才的活动间隙？','只记录你已经做过的事，不会换算成训练时长。',function(){return mutate(function(d){editDay(d,key,function(r){r.breaks=(r.breaks||0)+1;});},'这次活动间隙已记下。');},'确认记下');});
$('restToday').addEventListener('click',function(){var key=dateKey();message(dayRecord().rest?'撤销今天的休息标记？':'今天给自己留一点休息。','这是安排，不是失败。若有发作或不适，请按医疗建议处理，不追补活动。',function(){return mutate(function(d){editDay(d,key,function(r){r.rest=!r.rest;});},'今天的安排已更新。');},dayRecord().rest?'撤销标记':'记下休息');});
$('playerPause').addEventListener('click',async function(){if(!engine){return;}var current=engine,epoch=++startEpoch;if(current.get().phase==='running'){current.pause();await checkpoint(current.get(),true);}else{if(!await checkpoint(current.get(),true)){return;}if(epoch!==startEpoch||document.hidden||engine!==current||!$('player').open){return;}unlockAudio();current.start();requestWake();}});
$('playerSkip').addEventListener('click',function(){if(engine){engine.next();}});
$('playerEnd').addEventListener('click',function(){if(engine){engine.pause();engine.finish();}});
$('playerDiscomfort').addEventListener('click',function(){if(engine){feedback='discomfort';engine.pause();engine.finish();}});
$('playerClose').addEventListener('click',collapsePlayer);$('player').addEventListener('cancel',function(e){e.preventDefault();collapsePlayer();});
$('finishDialog').addEventListener('cancel',function(e){e.preventDefault();deferFinish();});$('saveSession').addEventListener('click',saveFinished);
var later=document.createElement('button');later.id='finishLater';later.className='text-button wide';later.textContent='先离开，稍后再处理';later.addEventListener('click',deferFinish);$('finishDialog').appendChild(later);
$('playerImage').addEventListener('error',function(){this.hidden=true;var s=engine&&plan[engine.get().stepIndex];if(s){text('playerCue',s.steps.join('；'));}text('playerSaved','示意暂不可用。请先暂停，按文字学习或联网重开。');if(engine){engine.pause();}});
$('historyMore').addEventListener('click',function(){historyLimit+=20;renderReview();});
$('exportBackup').addEventListener('click',async function(){try{download(await store.exportData(),'轻打卡-习惯备份-'+dateKey()+'.json');}catch(e){report(e);}});
$('exportRaw').addEventListener('click',function(){try{var raw=store.exportRaw();if(raw!==null){download(raw,'轻打卡-原始记录-'+dateKey()+'.json');}else{toast('没有可导出的原文。');}}catch(e){report(e);}});

$('importBackup').addEventListener('click',function(){if(S&&S.activeSession){toast('先处理未完成活动，再导入。');return;}$('backupFile').click();});
$('backupFile').addEventListener('change',async function(){var file=this.files[0];this.value='';if(!file){return;}if(file.size>20*1024*1024){message('文件太大','请选择小于 20 MB 的本应用完整备份。');return;}try{var object=JSON.parse(await file.text());if(object.format!=='qingdaka-habits'||!object.state||!Array.isArray(object.state.sessions)||!object.state.days){throw new Error('不是新版完整备份');}message('核对后再恢复','文件包含 '+object.state.sessions.length+' 条活动、'+Object.keys(object.state.days).length+' 天作息记录。导入会覆盖现有记录，不合并。建议先导出现有备份。',async function(){if(!await acquireSession()){return;}try{S=await store.load().catch(function(){return null;});if(S&&S.activeSession){throw new Error('有未处理活动');}S=await store.importData(object);readOnly=false;$('storageAlert').hidden=true;renderAll();toast('备份已完整恢复。');}finally{releaseSession();}},'确认覆盖并恢复');}catch(e){message('无法读取这份备份','请选择本应用导出的完整新版备份。文件无效时不会修改现有记录。');}});
$('resetData').addEventListener('click',function(){if(S&&S.activeSession){toast('先处理未完成活动，再清空。');return;}message('清空新版全部记录？','不可撤销。建议先导出备份，并确认文件已经保存在浏览器之外。',async function(){if(!await acquireSession()){return;}try{S=await store.load().catch(function(){return null;});if(S&&S.activeSession){throw new Error('有未处理活动');}S=await store.reset();readOnly=false;$('storageAlert').hidden=true;renderAll();toast('新版数据已清空。');setup();}finally{releaseSession();}},'确认清空新版数据');});
$('updateApp').addEventListener('click',function(){if(hasUnsaved()){toast('请先保存或放弃未完成活动、关闭表单，再更新。');return;}message('更新已下载的版本？','记录保留在本机，页面将重新打开。',async function(){if(hasUnsaved()){toast('还有未完成内容，请先处理。');return;}await checkpointQueue;if(registration&&registration.waiting){updateRequested=true;registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});}},'现在更新');});
if('serviceWorker' in navigator){navigator.serviceWorker.addEventListener('controllerchange',function(){if(updateRequested&&!hasUnsaved()){location.reload();}else{if(updateRequested){toast('新版本已就绪。先保存当前内容，下次打开再使用新版。');updateRequested=false;}probeOffline();}});}
document.addEventListener('visibilitychange',function(){if(document.hidden){startEpoch++;if(engine&&engine.get().phase==='running'){engine.pause();checkpoint(engine.get(),true);}releaseWake();}else{if(activeDate!==dateKey()){activeDate=dateKey();renderAll();}probeOffline();}});
window.addEventListener('pagehide',function(){startEpoch++;if(engine){engine.pause();checkpoint(engine.get(),true);}releaseWake();});
window.addEventListener('beforeunload',function(e){if(checkpointFailed||(pendingFinish&&saving)){e.preventDefault();e.returnValue='';}});
async function init(){
  buildHelp();renderMove();
  try{S=await store.load();}catch(e){readOnly=true;$('storageAlert').hidden=false;goPage('review');console.error('[轻打卡] 原文受保护',e);}
  store.subscribe(function(state,error){if(error){readOnly=true;$('storageAlert').hidden=false;return;}S=state;readOnly=false;$('storageAlert').hidden=true;renderAll();});

  renderAll();goPage(readOnly?'review':S&&S.activeSession?'today':location.hash.slice(1)||'today');if(S&&!S.settings.onboarded&&!S.activeSession){setup();}
  initOffline();
}
init().catch(function(e){console.error(e);$('storageAlert').hidden=false;});
})();
