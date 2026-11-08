(function(){
'use strict';

// 轻打卡 · 个人科学跟练版交互主逻辑
// 零限制、零记账、零免责弹窗；科学周循环与 3D 肌肉解剖跟练

var content = window.QDK_CONTENT;
var sessionEngine = window.QDK_SESSION;

var PREFS_KEY = 'qingdaka-coach-prefs';
var defaultPrefs = {
  nextCycle: 'A',
  selectedPlan: 'A',
  level: 'starter',
  voiceMode: 'speech' // 'speech' (精炼教练语音) | 'whistle' (极简节拍哨音) | 'mute' (静音)
};

function loadPrefs(){
  try {
    var raw = localStorage.getItem(PREFS_KEY);
    if(raw){
      var parsed = JSON.parse(raw);
      if(parsed && typeof parsed === 'object'){
        var p = Object.assign({}, defaultPrefs, parsed);
        if(!p.voiceMode){
          p.voiceMode = (p.voice === false) ? 'mute' : 'speech';
        }
        return p;
      }
    }
  } catch(e){}
  return Object.assign({}, defaultPrefs);
}

function savePrefs(prefs){
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch(e){}
}

var currentPrefs = loadPrefs();
var currentSession = null;
var activePlanSteps = [];
var encouragePlayed = {};

// DOM 元素引用
var btnVoiceToggle = document.getElementById('btnVoiceToggle');
var offlineBadge = document.getElementById('offlineBadge');
var cycleCardsContainer = document.getElementById('cycleCards');
var scenePillsContainer = document.getElementById('scenePills');

var planBadgeEl = document.getElementById('planBadge');
var planTitleEl = document.getElementById('planTitle');
var planTaglineEl = document.getElementById('planTagline');
var planGearEl = document.getElementById('planGear');
var levelSegmentedEl = document.getElementById('levelSegmented');
var planSummaryTextEl = document.getElementById('planSummaryText');
var btnStartWorkout = document.getElementById('btnStartWorkout');
var exerciseGroupsContainer = document.getElementById('exerciseGroups');

// 教学弹层
var learnDialog = document.getElementById('learnDialog');
var btnLearnClose = document.getElementById('btnLearnClose');
var btnLearnDismiss = document.getElementById('btnLearnDismiss');
var btnPractice30 = document.getElementById('btnPractice30');
var learnTitle = document.getElementById('learnTitle');
var learnGif = document.getElementById('learnGif');
var learnMediaBadge = document.getElementById('learnMediaBadge');
var learnPrimary = document.getElementById('learnPrimary');
var learnSecondary = document.getElementById('learnSecondary');
var learnBenefit = document.getElementById('learnBenefit');
var learnSteps = document.getElementById('learnSteps');
var learnCue = document.getElementById('learnCue');
var learnMistake = document.getElementById('learnMistake');
var currentLearnMove = null;

// 播放器弹层
var playerDialog = document.getElementById('player');
var btnPlayerExit = document.getElementById('btnPlayerExit');
var btnPlayerVoice = document.getElementById('btnPlayerVoice');
var playerProgressTrack = document.querySelector('.player-progress-track');
var playerProgressFill = document.getElementById('playerProgressFill');
var playerProgressText = document.getElementById('playerProgressText');
var playerRoundBadge = document.getElementById('playerRoundBadge');
var playerClock = document.getElementById('playerClock');
var playerImg = document.getElementById('playerImg');
var playerNextBadge = document.getElementById('playerNextBadge');
var playerSwitchBadge = document.getElementById('playerSwitchBadge');
var playerStepKind = document.getElementById('playerStepKind');
var playerStepName = document.getElementById('playerStepName');
var playerShortCue = document.getElementById('playerShortCue');
var btnPlayerToggle = document.getElementById('btnPlayerToggle');
var btnPlayerSkip = document.getElementById('btnPlayerSkip');
var btnPlayerEnd = document.getElementById('btnPlayerEnd');

// 完成弹层
var doneDialog = document.getElementById('doneDialog');
var doneSummary = document.getElementById('doneSummary');
var doneCycleUpdate = document.getElementById('doneCycleUpdate');
var btnDoneFinish = document.getElementById('btnDoneFinish');

// 音频与屏幕常亮
var playerAudio = document.getElementById('playerAudio');
var sharedAudioCtx = null;
var wakeLockSentinel = null;

// 语音合成（Web Speech API）
var speechSynth = window.speechSynthesis;
var chineseVoice = null;

function pickChineseVoice(){
  if(!speechSynth || typeof speechSynth.getVoices !== 'function'){ return; }
  try {
    var voices = speechSynth.getVoices() || [];
    for(var i = 0; i < voices.length; i++){
      var v = voices[i];
      if(v.lang && (v.lang === 'zh-CN' || v.lang === 'zh-HK' || v.lang.indexOf('zh') === 0)){
        if(v.name.indexOf('Siri') >= 0 || v.name.indexOf('Tingting') >= 0 || v.name.indexOf('Xiaoxiao') >= 0){
          chineseVoice = v;
          return;
        }
        if(!chineseVoice){ chineseVoice = v; }
      }
    }
  } catch(e){}
}
if(speechSynth){
  pickChineseVoice();
  if(typeof speechSynth.onvoiceschanged !== 'undefined'){
    speechSynth.onvoiceschanged = pickChineseVoice;
  }
}

function requestWakeLock(){
  try {
    if(navigator.wakeLock && !document.hidden && !wakeLockSentinel){
      navigator.wakeLock.request('screen').then(function(lock){
        wakeLockSentinel = lock;
        lock.addEventListener('release', function(){ wakeLockSentinel = null; });
        if(!currentSession || currentSession.get().phase !== 'running'){ releaseWakeLock(); }
      }).catch(function(){});
    }
  } catch(e){}
}

function releaseWakeLock(){
  if(wakeLockSentinel){
    try { wakeLockSentinel.release().catch(function(){}); } catch(e){}
    wakeLockSentinel = null;
  }
}

function unlockAudio(){
  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(AudioCtx && !sharedAudioCtx){ sharedAudioCtx = new AudioCtx(); }
    if(sharedAudioCtx && sharedAudioCtx.state === 'suspended'){
      sharedAudioCtx.resume().catch(function(){});
    }
  } catch(e){}
  if(speechSynth && speechSynth.paused){
    try { speechSynth.resume(); } catch(e){}
  }
}

function stopVoice(){
  if(playerAudio){
    try { playerAudio.pause(); } catch(e){}
  }
  if(speechSynth && speechSynth.speaking){
    try { speechSynth.cancel(); } catch(e){}
  }
}

function speakText(text){
  if(currentPrefs.voiceMode !== 'speech' || !text || !speechSynth){ return; }
  try {
    speechSynth.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    if(chineseVoice){ utterance.voice = chineseVoice; }
    utterance.lang = 'zh-CN';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    speechSynth.speak(utterance);
  } catch(e){}
}

function playWhistle(type){
  if(currentPrefs.voiceMode === 'mute'){ return; }
  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx){ return; }
    if(!sharedAudioCtx){ sharedAudioCtx = new AudioCtx(); }
    if(sharedAudioCtx.state === 'suspended'){ sharedAudioCtx.resume().catch(function(){}); }
    var now = sharedAudioCtx.currentTime;
    var osc = sharedAudioCtx.createOscillator();
    var gain = sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);

    if(type === 'start'){
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1174, now + 0.08);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if(type === 'switch'){
      osc.frequency.setValueAtTime(659, now);
      osc.frequency.setValueAtTime(987, now + 0.08);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.24);
    } else if(type === 'count'){
      osc.frequency.setValueAtTime(587, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if(type === 'done'){
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.setValueAtTime(659, now + 0.1);
      osc.frequency.setValueAtTime(784, now + 0.2);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch(e){}
}

function notifyCue(step, eventType){
  var mode = currentPrefs.voiceMode;
  if(mode === 'mute'){ return; }

  if(mode === 'whistle'){
    if(eventType === 'step'){ playWhistle('start'); }
    else if(eventType === 'halfway'){ playWhistle('switch'); }
    else if(eventType === 'count3'){ playWhistle('count'); }
    else if(eventType === 'done'){ playWhistle('done'); }
    return;
  }

  // 模式为 'speech'（精炼教练语音）
  if(eventType === 'step'){
    if(step.kind === 'countdown'){
      speakText('准备开始');
    } else if(step.kind === 'rest' || step.kind === 'roundBreak'){
      var nextTxt = step.nextMove ? ('，下一动作：' + step.nextMove.name) : '';
      speakText('休息' + nextTxt);
    } else {
      var shortPrompt = step.shortCue ? ('。' + step.shortCue.split('，')[0]) : '';
      speakText(step.name + shortPrompt);
    }
  } else if(eventType === 'halfway'){
    playWhistle('switch');
    speakText('换另一侧');
  } else if(eventType === 'count3'){
    playWhistle('count');
    speakText('三、二、一');
  } else if(eventType === 'done'){
    playWhistle('done');
    speakText('跟练完成！');
  }
}

// 顶栏声音三态按钮更新
function updateVoiceButtons(){
  var mode = currentPrefs.voiceMode;
  var icons = { speech: '🗣️', whistle: '🔔', mute: '🔇' };
  var labels = { speech: '教练语音', whistle: '节拍哨音', mute: '静音' };

  if(btnVoiceToggle){
    btnVoiceToggle.className = 'btn-voice voice-' + mode;
    btnVoiceToggle.querySelector('.voice-icon').textContent = icons[mode] || '🗣️';
    btnVoiceToggle.querySelector('.voice-text').textContent = labels[mode] || '教练语音';
  }
  if(btnPlayerVoice){
    btnPlayerVoice.textContent = icons[mode] || '🗣️';
    btnPlayerVoice.title = labels[mode] || '声音模式';
  }
}

function cycleVoiceMode(){
  var modes = ['speech', 'whistle', 'mute'];
  var idx = modes.indexOf(currentPrefs.voiceMode);
  var nextMode = modes[(idx + 1) % modes.length];
  currentPrefs.voiceMode = nextMode;
  currentPrefs.voice = (nextMode !== 'mute');
  savePrefs(currentPrefs);
  updateVoiceButtons();
  unlockAudio();

  if(nextMode === 'speech'){
    speakText('教练语音');
  } else if(nextMode === 'whistle'){
    playWhistle('start');
  } else {
    stopVoice();
  }
}

// 渲染周循环卡片与场景胶囊
function renderCycleNav(){
  cycleCardsContainer.innerHTML = '';
  content.cycleOrder.forEach(function(pid){
    var plan = content.plans[pid];
    var isNext = (pid === currentPrefs.nextCycle);
    var isSelected = (pid === currentPrefs.selectedPlan);

    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'cycle-card' + (isSelected ? ' active' : '');
    card.dataset.plan = pid;

    var letter = document.createElement('span');
    letter.className = 'cycle-card-letter';
    letter.textContent = pid;

    var name = document.createElement('span');
    name.className = 'cycle-card-name';
    name.textContent = plan.name.replace(/^计划\s*[A-Z]\s*·\s*/, '');

    var sub = document.createElement('span');
    sub.className = 'cycle-card-sub';
    sub.textContent = plan.badge;

    card.appendChild(letter);
    card.appendChild(name);
    card.appendChild(sub);

    if(isNext){
      var recBadge = document.createElement('span');
      recBadge.className = 'badge-recommend';
      recBadge.textContent = '本次推荐';
      card.appendChild(recBadge);
    }

    card.addEventListener('click', function(){
      currentPrefs.selectedPlan = pid;
      savePrefs(currentPrefs);
      renderAll();
    });

    cycleCardsContainer.appendChild(card);
  });

  scenePillsContainer.innerHTML = '';
  ['stretch', 'gym'].forEach(function(pid){
    var plan = content.plans[pid];
    var isSelected = (pid === currentPrefs.selectedPlan);

    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'scene-pill' + (isSelected ? ' active' : '');
    pill.dataset.plan = pid;

    var title = document.createElement('span');
    title.className = 'scene-pill-title';
    title.textContent = plan.name;

    var sub = document.createElement('span');
    sub.className = 'scene-pill-sub';
    sub.textContent = plan.badge;

    pill.appendChild(title);
    pill.appendChild(sub);

    pill.addEventListener('click', function(){
      currentPrefs.selectedPlan = pid;
      savePrefs(currentPrefs);
      renderAll();
    });

    scenePillsContainer.appendChild(pill);
  });
}

// 渲染控制台
function renderConsole(){
  var plan = content.plans[currentPrefs.selectedPlan] || content.plans.A;
  var lvl = content.levels[currentPrefs.level] || content.levels.starter;

  planBadgeEl.textContent = plan.badge;
  planTitleEl.textContent = plan.name;
  planTaglineEl.textContent = plan.desc;
  planGearEl.textContent = '备物：' + plan.gear;

  // 更新分段器激活态
  var buttons = levelSegmentedEl.querySelectorAll('.level-btn');
  buttons.forEach(function(btn){
    var isAct = (btn.dataset.level === currentPrefs.level);
    btn.classList.toggle('active', isAct);
    btn.setAttribute('aria-checked', isAct ? 'true' : 'false');
  });

  // 计算步骤总时长
  activePlanSteps = content.buildSessionPlan(currentPrefs.selectedPlan, currentPrefs.level);
  var totalSec = 0;
  activePlanSteps.forEach(function(s){ totalSec += s.seconds; });
  var totalMin = Math.max(1, Math.round(totalSec / 60));
  var roundText = (plan.id === 'stretch') ? '1 轮直连' : (lvl.rounds + ' 轮');

  planSummaryTextEl.textContent = '预计 ' + totalMin + ' 分钟 · ' + roundText + ' · 共 ' + activePlanSteps.length + ' 节';
}

// 渲染动作分组列表
function renderExerciseList(){
  exerciseGroupsContainer.innerHTML = '';
  var plan = content.plans[currentPrefs.selectedPlan] || content.plans.A;
  var lvl = content.levels[currentPrefs.level] || content.levels.starter;

  // 1. 热身组（拉伸课无热身）
  if(plan.id !== 'stretch'){
    var warmupCard = document.createElement('div');
    warmupCard.className = 'exercise-group-card';
    warmupCard.innerHTML = '<div class="group-header"><span class="group-title">热身激活</span><span class="group-count">5 项 · 每项 ' + lvl.warmupSec + ' 秒</span></div>';
    var warmupList = document.createElement('div');
    warmupList.className = 'exercise-item-list';

    content.warmupMoves.forEach(function(m){
      warmupList.appendChild(createExerciseItem(m, lvl.warmupSec + '秒'));
    });
    warmupCard.appendChild(warmupList);
    exerciseGroupsContainer.appendChild(warmupCard);
  }

  // 2. 正式抗阻组（或久坐拉伸组）
  var mainCard = document.createElement('div');
  mainCard.className = 'exercise-group-card';
  var groupTitle = (plan.id === 'stretch') ? '拉伸松解' : '正式抗阻';
  var secDesc = (plan.id === 'stretch') ? (lvl.stretchSec + ' 秒') : (lvl.workSec + ' 秒 / 动作 · ' + lvl.rounds + ' 轮');
  mainCard.innerHTML = '<div class="group-header"><span class="group-title">' + groupTitle + '</span><span class="group-count">' + plan.moves.length + ' 项 · ' + secDesc + '</span></div>';

  var mainList = document.createElement('div');
  mainList.className = 'exercise-item-list';
  plan.moves.forEach(function(mid){
    var m = content.movesDict[mid];
    var durationLabel = (plan.id === 'stretch') ? (lvl.stretchSec + '秒') : (lvl.workSec + '秒');
    mainList.appendChild(createExerciseItem(m, durationLabel));
  });
  mainCard.appendChild(mainList);
  exerciseGroupsContainer.appendChild(mainCard);

  // 3. 练后拉伸组（若有）
  if(plan.cooldown && plan.cooldown.length > 0){
    var coolCard = document.createElement('div');
    coolCard.className = 'exercise-group-card';
    coolCard.innerHTML = '<div class="group-header"><span class="group-title">练后拉伸</span><span class="group-count">' + plan.cooldown.length + ' 项 · 每项 ' + lvl.stretchSec + ' 秒</span></div>';

    var coolList = document.createElement('div');
    coolList.className = 'exercise-item-list';
    plan.cooldown.forEach(function(cid){
      var m = content.movesDict[cid];
      coolList.appendChild(createExerciseItem(m, lvl.stretchSec + '秒'));
    });
    coolCard.appendChild(coolList);
    exerciseGroupsContainer.appendChild(coolCard);
  }
}

function createExerciseItem(move, durText){
  var item = document.createElement('div');
  item.className = 'exercise-item';
  item.dataset.moveId = move.id;

  var thumbBox = document.createElement('div');
  thumbBox.className = 'item-thumb-box';
  var thumb = document.createElement('img');
  thumb.className = 'item-thumb';
  thumb.src = move.poster;
  thumb.alt = move.name;
  thumb.width = 52;
  thumb.height = 52;
  thumb.loading = 'lazy';
  thumbBox.appendChild(thumb);

  var contentCol = document.createElement('div');
  contentCol.className = 'item-content';

  var titleRow = document.createElement('div');
  titleRow.className = 'item-title-row';
  var title = document.createElement('span');
  title.className = 'item-title';
  title.textContent = move.name;
  titleRow.appendChild(title);

  if(move.mediaLabel){
    var labelBadge = document.createElement('span');
    labelBadge.className = 'item-media-label';
    labelBadge.textContent = move.mediaLabel;
    titleRow.appendChild(labelBadge);
  }

  var metaRow = document.createElement('div');
  metaRow.className = 'item-meta-row';
  var muscleTag = document.createElement('span');
  muscleTag.className = 'muscle-tag';
  muscleTag.textContent = '主练：' + move.primary.split('、')[0];
  var secSpan = document.createElement('span');
  secSpan.className = 'item-sec';
  secSpan.textContent = durText;

  metaRow.appendChild(muscleTag);
  metaRow.appendChild(secSpan);

  contentCol.appendChild(titleRow);
  contentCol.appendChild(metaRow);

  item.appendChild(thumbBox);
  item.appendChild(contentCol);

  item.addEventListener('click', function(){
    openLearnDialog(move);
  });

  return item;
}

// 打开动作教学弹层
function openLearnDialog(move){
  currentLearnMove = move;
  learnTitle.textContent = move.name;
  learnGif.src = move.gif;
  learnGif.alt = move.name;
  learnMediaBadge.textContent = move.mediaLabel || '动作示范';
  learnMediaBadge.hidden = !move.mediaLabel;

  learnPrimary.textContent = move.primary;
  learnSecondary.textContent = move.secondary;
  learnBenefit.textContent = move.benefit;

  learnSteps.innerHTML = '';
  move.steps.forEach(function(s){
    var li = document.createElement('li');
    li.textContent = s;
    learnSteps.appendChild(li);
  });

  learnCue.textContent = move.cue;
  learnMistake.textContent = move.mistake;

  if(typeof learnDialog.showModal === 'function'){
    learnDialog.showModal();
  } else {
    learnDialog.setAttribute('open', '');
  }
}

function closeLearnDialog(){
  if(typeof learnDialog.close === 'function'){
    learnDialog.close();
  } else {
    learnDialog.removeAttribute('open');
  }
  learnGif.src = '';
}

// 启动播放器
function startSessionWithPlan(steps, planId){
  unlockAudio();
  encouragePlayed = {};

  if(currentSession){
    currentSession.destroy();
  }

  var totalSteps = steps.length;
  currentSession = sessionEngine.create({
    plan: steps,
    onStep: function(step, idx){
      updatePlayerView(step, idx, totalSteps);
      notifyCue(step, 'step');
    },
    onHalfway: function(step){
      playerImg.classList.add('mirror');
      playerSwitchBadge.hidden = false;
      notifyCue(step, 'halfway');
    },
    onCountdown3: function(step){
      notifyCue(step, 'count3');
    },
    onChange: function(state){
      playerClock.textContent = Math.ceil(state.left);
      var currentStep = steps[state.stepIndex];
      if(currentStep && currentStep.seconds > 0 && playerProgressFill){
        var pct = Math.max(0, Math.min(100, (state.left / currentStep.seconds) * 100));
        playerProgressFill.style.width = pct + '%';
      }
    },
    onFinish: function(state, reason){
      if(reason !== 'early'){
        if(planId === 'practice'){
          notifyCue(null, 'done');
          exitPlayerDirectly();
        } else {
          finishWorkoutNaturally(planId);
        }
      }
    }
  });

  if(typeof playerDialog.showModal === 'function'){
    playerDialog.showModal();
  } else {
    playerDialog.setAttribute('open', '');
  }

  currentSession.start();
  requestWakeLock();
  btnPlayerToggle.textContent = '暂停';
}

function updatePlayerView(step, idx, totalSteps){
  playerProgressText.textContent = '第 ' + (idx + 1) + ' / ' + totalSteps + ' 节';
  if(step.round && step.totalRounds > 1){
    playerRoundBadge.hidden = false;
    playerRoundBadge.textContent = '第 ' + step.round + ' / ' + step.totalRounds + ' 轮';
  } else {
    playerRoundBadge.hidden = true;
  }

  playerClock.textContent = Math.ceil(step.seconds);
  if(playerProgressFill){
    playerProgressFill.style.width = '100%';
  }

  var kindLabels = {
    countdown: '倒数准备',
    warmup: '热身激活',
    work: '正式抗阻',
    rest: '动作间休息',
    roundBreak: '轮间休息',
    stretch: '拉伸放松'
  };
  playerStepKind.textContent = kindLabels[step.kind] || '跟练';
  playerStepName.textContent = step.name;
  playerShortCue.textContent = step.shortCue;

  // 动图与角标展示（下一动作满屏大图预判）
  playerImg.classList.remove('mirror');
  if(step.kind === 'countdown' || step.kind === 'rest' || step.kind === 'roundBreak'){
    var upcoming = step.nextMove;
    if(upcoming){
      playerImg.src = upcoming.gif;
      playerImg.alt = upcoming.name;
      playerNextBadge.textContent = '下一动作预告 · ' + upcoming.name;
      playerNextBadge.hidden = false;
    } else {
      playerImg.src = step.gif;
      playerImg.alt = step.name;
      playerNextBadge.hidden = true;
    }
  } else {
    playerImg.src = step.gif;
    playerImg.alt = step.name;
    playerNextBadge.hidden = true;
  }

  playerSwitchBadge.hidden = true;
}

function finishWorkoutNaturally(planId){
  releaseWakeLock();
  if(currentSession){
    currentSession.destroy();
    currentSession = null;
  }

  if(typeof playerDialog.close === 'function'){
    if(playerDialog.open){ playerDialog.close(); }
  } else {
    playerDialog.removeAttribute('open');
  }

  notifyCue(null, 'done');

  var plan = content.plans[planId] || content.plans.A;
  doneSummary.textContent = '本次完成了 ' + plan.name + '（' + (content.levels[currentPrefs.level] ? content.levels[currentPrefs.level].name : '入门档') + '）';

  // 若刚完成的是 A/B/C 周循环课，推进下一课
  var cycleIdx = content.cycleOrder.indexOf(planId);
  if(cycleIdx >= 0){
    var nextIdx = (cycleIdx + 1) % content.cycleOrder.length;
    var nextPlanId = content.cycleOrder[nextIdx];
    currentPrefs.nextCycle = nextPlanId;
    currentPrefs.selectedPlan = nextPlanId;
    savePrefs(currentPrefs);

    var nextPlan = content.plans[nextPlanId];
    doneCycleUpdate.hidden = false;
    doneCycleUpdate.innerHTML = '下次跟练推荐已自动推进为：<strong>' + nextPlan.name + '</strong>';
  } else {
    doneCycleUpdate.hidden = true;
  }

  if(typeof doneDialog.showModal === 'function'){
    doneDialog.showModal();
  } else {
    doneDialog.setAttribute('open', '');
  }

  renderAll();
}

function exitPlayerDirectly(){
  stopVoice();
  releaseWakeLock();
  if(playerImg){
    playerImg.classList.remove('mirror');
  }
  if(currentSession){
    currentSession.destroy();
    currentSession = null;
  }
  if(typeof playerDialog.close === 'function'){
    if(playerDialog.open){ playerDialog.close(); }
  } else {
    playerDialog.removeAttribute('open');
  }
}

// 统一渲染入口
function renderAll(){
  updateVoiceButtons();
  renderCycleNav();
  renderConsole();
  renderExerciseList();
}

// 事件绑定
btnVoiceToggle.addEventListener('click', cycleVoiceMode);
btnPlayerVoice.addEventListener('click', cycleVoiceMode);

levelSegmentedEl.addEventListener('click', function(e){
  var btn = e.target.closest('.level-btn');
  if(!btn){ return; }
  currentPrefs.level = btn.dataset.level;
  savePrefs(currentPrefs);
  renderConsole();
  renderExerciseList();
});

btnStartWorkout.addEventListener('click', function(){
  var steps = content.buildSessionPlan(currentPrefs.selectedPlan, currentPrefs.level);
  startSessionWithPlan(steps, currentPrefs.selectedPlan);
});

btnLearnClose.addEventListener('click', closeLearnDialog);
btnLearnDismiss.addEventListener('click', closeLearnDialog);

btnPractice30.addEventListener('click', function(){
  if(!currentLearnMove){ return; }
  var move = currentLearnMove;
  closeLearnDialog();
  var singleSteps = [
    {
      id: 'practice-' + move.id,
      kind: 'work',
      seconds: 30,
      moveId: move.id,
      name: move.name + ' · 单练体验',
      shortCue: move.shortCue,
      cue: move.cue,
      gif: move.gif,
      poster: move.poster,
      voice: move.voice,
      primary: move.primary,
      secondary: move.secondary,
      sideMode: move.sideMode,
      mediaLabel: move.mediaLabel
    }
  ];
  startSessionWithPlan(singleSteps, 'practice');
});

btnPlayerToggle.addEventListener('click', function(){
  if(!currentSession){ return; }
  var st = currentSession.get();
  if(st.phase === 'running'){
    currentSession.pause();
    stopVoice();
    releaseWakeLock();
    btnPlayerToggle.textContent = '继续';
  } else if(st.phase === 'paused' || st.phase === 'ready'){
    unlockAudio();
    currentSession.start();
    requestWakeLock();
    btnPlayerToggle.textContent = '暂停';
  }
});

btnPlayerSkip.addEventListener('click', function(){
  if(!currentSession){ return; }
  stopVoice();
  currentSession.next();
});

btnPlayerExit.addEventListener('click', exitPlayerDirectly);
btnPlayerEnd.addEventListener('click', exitPlayerDirectly);
playerDialog.addEventListener('cancel', function(e){
  e.preventDefault();
  exitPlayerDirectly();
});

btnDoneFinish.addEventListener('click', function(){
  stopVoice();
  if(typeof doneDialog.close === 'function'){
    doneDialog.close();
  } else {
    doneDialog.removeAttribute('open');
  }
  renderAll();
});

// 切后台自动暂停
document.addEventListener('visibilitychange', function(){
  if(document.hidden && currentSession){
    var st = currentSession.get();
    if(st.phase === 'running'){
      currentSession.pause();
      stopVoice();
      releaseWakeLock();
      btnPlayerToggle.textContent = '继续';
    }
  }
});

// Service Worker 离线状态与强制接管更新
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').then(function(reg){
      reg.update().catch(function(){});
      if(reg.waiting){
        reg.waiting.postMessage({type: 'ACTIVATE_UPDATE'});
      }
      reg.addEventListener('updatefound', function(){
        var newWorker = reg.installing;
        if(newWorker){
          newWorker.addEventListener('statechange', function(){
            if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
              newWorker.postMessage({type: 'ACTIVATE_UPDATE'});
            }
          });
        }
      });
      if(offlineBadge){ offlineBadge.textContent = '离线就绪'; }
    }).catch(function(){
      if(offlineBadge){ offlineBadge.textContent = '本机运行'; }
    });

    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      if(!hadController){
        return;
      }
      if(!reloading){
        reloading = true;
        window.location.reload();
      }
    });
  });
}

// 页面初始化
renderAll();

})();
