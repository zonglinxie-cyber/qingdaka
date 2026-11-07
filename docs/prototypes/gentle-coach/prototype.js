(() => {
  'use strict';

  // 独立展示实验：不加载正式课程、存储或 Service Worker，也不保存预览状态。
  const $ = id => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const synth = window.speechSynthesis;
  const frames = [
    { label: '起始姿势', cue: '坐稳，双脚平放。', detail: '双手轻扶座面，上身自然立起。', near: 0 },
    { label: '一侧轻抬', cue: '一脚轻轻离地。', detail: '保持膝弯曲，不向后仰，不要求抬高。', near: -9 },
    { label: '放回，再换侧', cue: '慢慢放回，落稳再换侧。', detail: '双脚落稳，不赶节奏，也不凑次数。', near: 0 }
  ];
  const stages = [
    { id: 'prepare', seconds: 5, label: '准备', cue: '先看起始姿势。', detail: '这里只预览界面，不需要跟着做。', speech: '先坐稳，双脚平放。' },
    { id: 'move', seconds: 20, label: '演示', cue: '一脚轻轻离地，放稳后换脚。', detail: '小幅就好，不向后仰，不追次数。', speech: '一脚轻轻离地，放稳后换脚。' },
    { id: 'rest', seconds: 10, label: '休息', cue: '停下动作，自然呼吸。', detail: '需要更久，就暂停；随时可以结束。', speech: '停下来，自然呼吸。' }
  ];
  let mode = 'learn';
  let playing = false;
  let frame = 0;
  let stageIndex = 0;
  let elapsed = 0;
  let animationElapsed = 0;
  let lastTick = null;
  let request = null;
  let animate = !reducedMotion.matches;
  let sound = false;
  let voice = null;
  let speechGeneration = 0;
  let lastPhase = '';
  let lastSeconds = null;

  function status(message) { $('status').textContent = message; }
  function findVoice() {
    return synth?.getVoices().find(item => /^zh([-_]|$)/i.test(item.lang) && item.localService) || null;
  }
  function cancelSpeech() {
    speechGeneration += 1;
    synth?.cancel();
  }
  function speak(text) {
    cancelSpeech();
    if (!sound || !voice || typeof window.SpeechSynthesisUtterance !== 'function') return;
    const generation = speechGeneration;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.88;
    utterance.onerror = event => {
      if (generation !== speechGeneration || event.error === 'canceled' || event.error === 'interrupted') return;
      sound = false;
      renderSound();
      status('语音未能播放；文字提示仍可用。可以再次尝试开启口令。');
    };
    try { synth.speak(utterance); } catch {
      sound = false;
      renderSound();
      status('当前浏览器无法播放口令，已保留文字提示。');
    }
  }
  function renderSound() {
    $('soundButton').setAttribute('aria-pressed', String(sound));
    $('soundLabel').textContent = sound ? '口令开' : '口令关';
  }

  // 以髋部轻微转动大腿，小腿反向补偿，让脚离地而不是把整条腿向前踢。
  function pose(near, far) {
    $('nearThigh').setAttribute('transform', `rotate(${near.toFixed(3)} 166 277)`);
    $('nearShin').setAttribute('transform', `rotate(${(-near).toFixed(3)} 266 295)`);
    $('farThigh').setAttribute('transform', `rotate(${far.toFixed(3)} 162 270)`);
    $('farShin').setAttribute('transform', `rotate(${(-far).toFixed(3)} 241 286)`);
    $('nearShadow').setAttribute('opacity', near < -1 ? '.07' : '.15');
    $('farShadow').setAttribute('opacity', far < -1 ? '.06' : '.13');
  }
  function cue(main, detail) {
    $('cue').textContent = main;
    $('cueDetail').textContent = detail;
  }
  function renderFrame(index) {
    frame = index;
    const selected = frames[index];
    pose(selected.near, 0);
    cue(selected.cue, selected.detail);
    $('stageLabel').textContent = selected.label;
    $('figureTitle').textContent = '坐姿轻抬膝：' + selected.label;
    document.querySelectorAll('[data-frame]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.frame) === index));
    });
  }
  function ease(value) { return (1 - Math.cos(Math.PI * value)) / 2; }
  function lift(time) {
    if (time < 1 || time >= 4.8) return 0;
    if (time < 2.6) return -9 * ease((time - 1) / 1.6);
    if (time < 3.2) return -9;
    return -9 * (1 - ease((time - 3.2) / 1.6));
  }
  function renderAnimation() {
    const cycle = animationElapsed % 12;
    const half = cycle % 6;
    const angle = lift(half);
    pose(cycle < 6 ? angle : 0, cycle < 6 ? 0 : angle);
    const phase = half < 1 || half >= 4.8 ? '双脚落稳' : half >= 3.2 ? '慢慢放回' : cycle < 6 ? '一侧轻抬' : '另一侧轻抬';
    if (phase !== lastPhase) {
      lastPhase = phase;
      $('stageLabel').textContent = phase;
      $('figureTitle').textContent = '坐姿轻抬膝：' + phase;
    }
  }
  function renderControls() {
    $('coach').dataset.mode = mode;
    $('coach').dataset.playing = String(playing);
    const inRound = mode === 'round';
    $('keyframes').hidden = inRound;
    $('roundTrack').hidden = !inRound;
    $('timeBlock').hidden = !inRound;
    $('levelTag').hidden = inRound;
    $('endButton').hidden = !inRound;
    $('primaryLabel').textContent = inRound ? playing ? '暂停 / 休息' : '继续预览' : '预览一个轻回合';
    $('primaryArrow').textContent = inRound ? playing ? 'Ⅱ' : '▷' : '↗';
    $('motionButton').hidden = inRound && (stages[stageIndex].id !== 'move' || animate);
    $('motionButton').setAttribute('aria-pressed', String(playing && animate));
    $('motionLabel').textContent = inRound ? '改看连续动作' : playing ? '暂停演示' : '播放完整动作';
    $('motionIcon').textContent = !inRound && playing ? 'Ⅱ' : '▶';
    $('eyebrow').textContent = inRound ? '轻回合 ／ 展示预览' : '动作学习 ／ 01';
    $('subtitle').textContent = inRound ? '不计次数，不必等到倒计时结束。' : '先看明白，再慢慢开始。';
  }
  function renderTime() {
    const remaining = Math.max(0, Math.ceil(stages[stageIndex].seconds - elapsed));
    if (remaining === lastSeconds) return;
    lastSeconds = remaining;
    $('timeNumber').textContent = String(remaining).padStart(2, '0');
  }
  function stopClock() {
    if (request !== null) cancelAnimationFrame(request);
    request = null;
    lastTick = null;
  }
  function pause(message) {
    if (!playing) { cancelSpeech(); return; }
    playing = false;
    stopClock();
    cancelSpeech();
    renderControls();
    status(message || (mode === 'round' ? '已暂停 · 画面和计时都已停下，休息多久都可以。' : '演示已暂停，可切换下方分步查看。'));
  }
  function startClock() {
    if (playing) return;
    playing = true;
    lastTick = performance.now();
    renderControls();
    request = requestAnimationFrame(tick);
  }
  function showStage() {
    const stage = stages[stageIndex];
    elapsed = 0;
    animationElapsed = 0;
    lastSeconds = null;
    lastPhase = '';
    pose(0, 0);
    cue(stage.cue, stage.detail);
    $('stageLabel').textContent = stage.id === 'move' ? animate ? '双脚落稳' : '静态姿势 · 减少动态' : '起始姿势';
    $('figureTitle').textContent = '坐姿轻抬膝：准备姿势';
    $('timeCaption').textContent = stage.label + ' · 秒';
    $('restOverlay').hidden = stage.id !== 'rest';
    $('figure').toggleAttribute('hidden', stage.id === 'rest');
    $('restTitle').textContent = '现在，停一停';
    $('restNote').textContent = '不用补次数，也不用赶时间。';
    document.querySelectorAll('[data-stage]').forEach((item, index) => {
      item.classList.toggle('current', index === stageIndex);
      item.classList.toggle('complete', index < stageIndex);
      if (index === stageIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    renderTime();
    renderControls();
    status(stage.id === 'prepare' ? '正在预览准备阶段 · 请先只看，不跟做。' : stage.id === 'move' ? '演示速度仅供理解动作，不是训练目标。' : '休息阶段 · 动作已停止，随时可以结束。');
    speak(stage.speech);
  }
  function finish(message) {
    pause();
    mode = 'learn';
    animate = !reducedMotion.matches;
    animationElapsed = 0;
    lastPhase = '';
    $('restOverlay').hidden = true;
    $('figure').removeAttribute('hidden');
    renderFrame(0);
    renderControls();
    status(message || '预览结束 · 没有生成锻炼记录。可以重新查看动作。');
  }
  function tick(now) {
    request = null;
    if (!playing) return;
    const delta = Math.max(0, (now - lastTick) / 1000);
    lastTick = now;
    // 后台、设备锁屏或主线程长时间停顿都不能把未看见的时间补成已完成。
    if (delta > 1.5) { pause('播放中断，已暂停 · 不补后台时间，请主动继续。'); return; }
    if (mode === 'round') {
      elapsed += delta;
      if (elapsed >= stages[stageIndex].seconds) {
        if (stageIndex + 1 >= stages.length) { finish(); return; }
        stageIndex += 1;
        showStage();
      }
      renderTime();
      if (stages[stageIndex].id === 'move' && animate) {
        animationElapsed += delta;
        renderAnimation();
      }
    } else {
      animationElapsed += delta;
      renderAnimation();
    }
    request = requestAnimationFrame(tick);
  }

  $('motionButton').addEventListener('click', () => {
    if (mode === 'round') {
      animate = true;
      animationElapsed = 0;
      lastPhase = '';
      startClock();
      renderControls();
      status('已主动开启连续动作；仍可随时暂停。');
      return;
    }
    if (playing) { pause(); return; }
    animate = true;
    if (frame !== 0) animationElapsed = frame === 1 ? 2.6 : 4.8;
    frame = 0;
    document.querySelectorAll('[data-frame]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    cue('一脚轻轻离地，放稳后换脚。', '先只看动作；动画速度不是你的目标。');
    status('完整动作循环演示 · 不计时、不记录。');
    speak('一脚轻轻离地，放稳后换脚。');
    startClock();
  });
  document.querySelectorAll('[data-frame]').forEach(button => button.addEventListener('click', () => {
    pause();
    animationElapsed = 0;
    lastPhase = '';
    renderFrame(Number(button.dataset.frame));
    status('静态分步 · 看清楚，再决定是否播放。');
    speak(frames[frame].cue);
  }));
  $('primaryButton').addEventListener('click', () => {
    if (mode === 'learn') {
      pause();
      mode = 'round';
      stageIndex = 0;
      animate = !reducedMotion.matches;
      showStage();
      startClock();
      // 学习页可能已滚到按钮处；进入回合后必须重新看到完整人物和阶段。
      window.scrollTo(0, 0);
    } else if (playing) pause();
    else {
      status('继续预览 · 可以随时暂停或结束。');
      speak(stages[stageIndex].speech);
      startClock();
    }
  });
  $('endButton').addEventListener('click', () => finish('已结束预览 · 没有保存，也不需要补做。'));
  $('soundButton').addEventListener('click', () => {
    if (sound) {
      sound = false;
      cancelSpeech();
      renderSound();
      status('口令已关闭，文字提示保留。');
      return;
    }
    voice = findVoice();
    if (!synth || !voice || typeof window.SpeechSynthesisUtterance !== 'function') {
      status('当前没有可用的本机中文语音；文字提示仍可用，稍后可再试。');
      return;
    }
    sound = true;
    renderSound();
    status('口令已开启 · 使用本机中文语音，可随时关闭。');
    speak(mode === 'round' && !playing ? '已暂停，休息多久都可以。' : $('cue').textContent);
  });
  function onMotionChange(event) {
    if (!event.matches) return;
    pause('系统已开启减少动态效果，连续演示已暂停。');
    animate = false;
    pose(0, 0);
    lastPhase = '';
    if (mode === 'learn') renderFrame(0);
    else if (stages[stageIndex].id === 'move') $('stageLabel').textContent = '静态姿势 · 减少动态';
    renderControls();
  }
  reducedMotion.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause('已切到后台，预览已暂停；回来后请主动继续。');
  });
  window.addEventListener('pagehide', () => pause('离开页面，预览已暂停。'));
  window.addEventListener('blur', () => pause('窗口失去焦点，预览已暂停；请主动继续。'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') pause();
  });
  renderSound();
  renderFrame(0);
  renderControls();
  if (reducedMotion.matches) status('已尊重“减少动态效果” · 默认静态分步，播放需主动开启。');
})();
