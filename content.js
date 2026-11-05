(function(){
'use strict';

// 仅提供通用内容；不读取个人资料、存储、网络、计时器或旧媒体资源。
var GUIDE_PATH = './assets/habit-guides/';
var defaultCourseId = 'gentle';
var defaultMode = 'seated';
var mediaNote = '原创分步示意，非专业视频；不表示精确关节角度或必须达到的幅度。';

var safety = {
  positioning:'这是轻量活动习惯提示，不是治疗、康复或健身处方，也不承诺减重或改善某种疾病。',
  beforeStarting:'长期没有运动，或有慢性病、关节问题、容易气短、平衡困难时，开始前先与医生或相关健康专业人员讨论适合的活动和强度。坐姿也不代表人人安全。',
  effort:'从小幅、慢速开始，保持自然呼吸，不憋气、不追求出汗、疲劳或次数。觉得费力就停，不必等倒计时结束。',
  stop:'出现疼痛、头晕、恶心、异常气短或站立不稳，立即停止，在安全处休息；不要硬撑或自行换成另一种模式继续。症状不缓解或反复出现时寻求医疗帮助。',
  emergency:'胸痛或胸部压迫感、严重呼吸困难、晕厥或接近晕厥时，立即停止并呼叫当地急救服务，不要继续活动或自行驾车。',
  gout:'痛风发作或疑似发作时不开始或继续课程。休息并抬高患肢，不给患处施压，按既有医疗建议处理并及时联系医生；不要自动改做坐姿活动。',
  jointUrgent:'关节突然疼痛、肿胀且疼痛加重，或伴发热、寒战、恶心、不能进食，应尽快寻求紧急医疗评估，不能只当作普通痛风或活动后的不适。',
  seated:'选择无轮、无旋转、承重适合且稳定不晃的椅子，放在平整防滑地面；椅子不合适就不开始。坐稳、双脚平放、膝自然弯曲，手臂活动不受扶手阻挡；不要坐在椅沿。',
  standing:'只有站立、走路无痛且稳定时才选择站姿。清理平整防滑的短路线，穿合脚防滑鞋，旁边可有牢固台面；若疼痛、不稳或必须用力扶住才能站立，就不做站姿课程。',
  timing:'计时只是提示，不是最低完成要求。准备没好就暂停，休息可以延长，随时结束；停止后不补做、不补时。准备、休息和收尾不计入活动秒数。',
  illustration:mediaNote
};

var courses = [
  {
    id:'minute', name:'1 分钟 · 试着开始', minutes:1,
    description:'一个轻活动回合，含准备、休息与收尾。可以主动选它，也可以提前结束；短一点不是失败。'
  },
  {
    id:'gentle', name:'3 分钟 · 轻活动回合', minutes:3,
    description:'默认选项。四个短回合，每回合后休息；只练习给日常留一点活动时间，不要求全部做完。'
  },
  {
    id:'steady', name:'5 分钟 · 自选多一点', minutes:5,
    description:'仅供主动选择，不是进阶目标，不随打卡自动升级。沿用相同的慢速、小幅回合，增加回合而不加快动作。'
  }
];

var modes = [
  {
    id:'seated', name:'坐姿轻活动',
    description:'全程保持坐姿，可先不计时看图学习；坐姿不是疼痛时的默认替代方案。',
    equipment:safety.seated,
    caution:safety.beforeStarting + safety.gout,
    image:GUIDE_PATH + 'seated-ready.svg'
  },
  {
    id:'standing', name:'站姿轻活动',
    description:'仅在无痛、站稳和走稳时，做室内短距离慢走与肩膀放松；不含快速转脚或原地高抬腿。',
    equipment:safety.standing,
    caution:safety.standing + safety.gout,
    image:GUIDE_PATH + 'standing-ready.svg'
  }
];

var moves = [
  {
    id:'seated-arms', mode:'seated', name:'坐姿轻柔动臂',
    cue:'手臂低低打开，再慢慢放回。',
    steps:[
      '坐稳在合适的无轮椅上，双脚平放，手自然放在大腿旁。',
      '双臂向身体两侧稍稍打开，手低于肩，肘自然微弯。',
      '慢慢放回，舒适才再做；不甩手，不憋气，也不追次数。'
    ],
    image:GUIDE_PATH + 'seated-arms.svg',
    imageAlt:'正视两格示意：坐稳、双脚平放；手臂低于肩向两侧小幅打开，再放回。',
    caution:'肩、手臂或背部不适就停止，不强拉或抬高手臂。椅子需稳定、承重适合；痛风发作时不跟练。'
  },
  {
    id:'seated-chest', mode:'seated', name:'坐姿小幅开胸',
    cue:'肩轻轻向后下，胸口微微打开。',
    steps:[
      '双脚平放，坐稳后上身自然立起，略离靠背；不要挪到椅沿。',
      '双臂低低向侧打开，肩轻轻向后下，胸口略向前上；不要顶腰。',
      '舒适时停约 5 秒，再放松；自然呼吸，不必保持整个回合。'
    ],
    image:GUIDE_PATH + 'seated-chest.svg',
    imageAlt:'正视两格示意：自然坐直；双臂低低打开，肩轻向后下，胸口小幅打开。',
    caution:'只是舒适的小幅展开，不追求拉伸感；肩背疼痛就停止。不能稳定坐直时不做；痛风发作时不跟练。'
  },
  {
    id:'seated-knee', mode:'seated', name:'坐姿轻抬膝',
    cue:'一脚轻轻离地，放稳后换脚。',
    steps:[
      '坐稳，上身自然立起，双脚平放，双手轻扶座面两侧。',
      '保持膝弯曲，慢慢抬一条腿，脚稍离地即可，不向后仰。',
      '控制着放回脚，落稳后再换另一侧；不要求抬高或凑次数。'
    ],
    image:GUIDE_PATH + 'seated-knee.svg',
    imageAlt:'侧视两格示意：双脚平放并轻扶座面；一侧膝略抬、脚稍离地，另一脚仍在地上。',
    caution:'脚、踝、膝、髋或腰不适就停止；手腕不适时不要靠手硬撑。痛风发作不做，也不自动换动作。'
  },
  {
    id:'seated-neck', mode:'seated', name:'坐姿温和转头',
    cue:'慢慢看向一侧，回正再换边。',
    steps:[
      '坐稳，双脚平放，肩自然放下，眼睛先看前方。',
      '头缓慢向一侧转到舒适的小幅度，肩和身体保持朝前。',
      '舒适时停约 5 秒，慢慢回正再换边；不必在回合内做完两侧。'
    ],
    image:GUIDE_PATH + 'seated-neck.svg',
    imageAlt:'正视两格示意：头朝前、肩放松；头小幅看向一侧，身体仍朝前。',
    caution:'颈部疼痛、眩晕或其他不适就停止；不用手扳头、不绕颈、不追求转到肩上。痛风发作时不跟练。'
  },
  {
    id:'standing-shoulders', mode:'standing', name:'站姿放松肩膀',
    cue:'肩轻轻向后下，再回到自然位。',
    steps:[
      '只有站立无痛且稳定才做，双脚自然分开，手臂垂在身侧。',
      '肩膀轻轻向后下移动一点，再回到自然位，保持正常呼吸。',
      '舒适才重复，不耸高、不大幅绕肩、不挺腰；觉得累就结束。'
    ],
    image:GUIDE_PATH + 'standing-shoulders.svg',
    imageAlt:'正视两格示意：双脚站稳、手臂垂下；肩轻轻向后下放松，双脚位置不变。',
    caution:'站立疼痛、不稳、头晕或肩部不适就停止，不靠用力扶物硬撑；痛风发作时不跟练。'
  },
  {
    id:'standing-walk', mode:'standing', name:'室内慢走',
    cue:'小步慢走，没路就停，不急转。',
    steps:[
      '确认走路无痛且稳定，选平整、防滑、无障碍的室内短直路。',
      '看前方，小步慢走，手臂自然放松，不提速、不刻意抬高膝。',
      '到路线末端先停稳；空间不够就结束本回合，不原地拧脚转身。'
    ],
    image:GUIDE_PATH + 'standing-walk.svg',
    imageAlt:'侧视两格示意：在平整短路上站稳；向前迈小步，步幅小，不跑跳或急转。',
    caution:'脚、踝、膝或其他部位疼痛、走路不稳时不做；不要边走边看屏幕。痛风发作时休息，不自动改做坐姿。'
  }
];

var supportSteps = {
  seated:{
    prepare:{
      name:'坐稳再开始', cue:'椅子稳，脚放平；没准备好就暂停。',
      steps:[
        '先看安全提示；发作、疼痛或不适时不开始，长期不活动或有慢性病先讨论适合的活动。',
        '确认椅子无轮、承重适合、稳定不晃，双脚能平放；不要坐在椅沿。',
        '将屏幕放在容易看见的位置，先看懂动作；准备不足就暂停，不赶倒计时。'
      ],
      image:GUIDE_PATH + 'seated-ready.svg',
      imageAlt:'侧视两格示意：检查无轮稳固椅；坐稳，双脚平放，双手自然放在腿上。',
      caution:safety.beforeStarting + safety.seated + safety.gout
    },
    rest:{
      name:'坐姿休息', cue:'停下动作，坐稳，自然呼吸。',
      steps:[
        '停止动作，坐稳，双脚平放，手舒适地放在腿上。',
        '自然呼吸，不憋气、不刻意深吸，也不趁休息补次数。',
        '需要更久就暂停；有疼痛或不适就结束，不换动作硬撑。'
      ],
      image:GUIDE_PATH + 'seated-pause.svg',
      imageAlt:'侧视两格示意：停止动作、双脚平放；保持舒适坐姿自然呼吸，可延长休息。',
      caution:safety.stop
    },
    settle:{
      name:'坐姿收尾', cue:'今天到这里，不必加做。',
      steps:[
        '停止动作，保持舒适坐姿，让呼吸自然进行。',
        '留意身体感受；有异常就按安全提示处理，不把不适当成完成目标。',
        '可以只记录做了多少和感受，提前结束也如实记录；下次仍能选 1 分钟。'
      ],
      image:GUIDE_PATH + 'seated-pause.svg',
      imageAlt:'侧视分步示意：双脚平放，坐稳停止活动，自然呼吸，不再加做动作。',
      caution:safety.stop
    }
  },
  standing:{
    prepare:{
      name:'站稳再开始', cue:'无痛站稳，路线清空，再开始。',
      steps:[
        '先看安全提示；只有站立和走路无痛且稳定才做，发作或不适时不开始。',
        '清理平整防滑的短路线，穿合脚防滑鞋，确认旁边台面牢固。',
        '把屏幕放好，先看懂动作；不要边走边看，没准备好就暂停。'
      ],
      image:GUIDE_PATH + 'standing-ready.svg',
      imageAlt:'正视两格示意：清理地面并确认牢固台面；双脚自然分开，站稳后再开始。',
      caution:safety.beforeStarting + safety.standing + safety.gout
    },
    rest:{
      name:'站姿停一停', cue:'停稳休息，不舒服就结束。',
      steps:[
        '停止动作并站稳，手臂自然放松，旁边可有牢固台面。',
        '只有站立仍舒适稳定才原地休息，自然呼吸，不原地踏步补时。',
        '累了、痛了或不稳就结束，在安全处休息；不要为了倒计时继续站。'
      ],
      image:GUIDE_PATH + 'standing-pause.svg',
      imageAlt:'正视两格示意：停止动作、双脚站稳；舒适时放松休息，不适就结束而不硬撑。',
      caution:safety.standing + safety.stop
    },
    settle:{
      name:'站姿收尾', cue:'停下放松，今天不用再加量。',
      steps:[
        '停止活动，只有站立仍舒适稳定才留在原地收尾，不必等计时结束。',
        '自然呼吸；累了就在安全处休息，有异常按安全提示处理。',
        '可以记录实际完成和感受，不补做；5 分钟始终只是可选项。'
      ],
      image:GUIDE_PATH + 'standing-pause.svg',
      imageAlt:'正视分步示意：结束活动、自然放松；站立不适时结束课程并在安全处休息。',
      caution:safety.standing + safety.stop
    }
  }
};

// 回合长度是本项目的习惯提示设计，不是来源机构核定的运动剂量。
var schedules = {
  minute:{prepare:15, move:20, rest:15, settle:10, rounds:1},
  gentle:{prepare:20, move:20, rest:15, settle:20, rounds:4},
  steady:{prepare:25, move:20, rest:15, settle:30, rounds:7}
};
var sequences = {
  seated:['seated-arms', 'seated-chest', 'seated-knee', 'seated-neck'],
  standing:['standing-shoulders', 'standing-walk']
};
var moveById = {};
moves.forEach(function(move){ moveById[move.id] = move; });

function makeStep(courseId, mode, kind, seconds, source, index){
  var step = {
    id:courseId + '-' + mode + '-' + kind + '-' + index,
    kind:kind,
    name:source.name,
    seconds:seconds,
    activeSeconds:kind === 'move' ? seconds : 0,
    cue:source.cue,
    steps:source.steps.slice(),
    image:source.image,
    imageAlt:source.imageAlt,
    caution:source.caution,
    mediaNote:mediaNote,
    mode:mode
  };
  if(kind === 'move'){ step.moveId = source.id; }
  return step;
}

function buildPlan(courseId, mode){
  if(courseId === undefined){ courseId = defaultCourseId; }
  if(mode === undefined){ mode = defaultMode; }
  if(!Object.prototype.hasOwnProperty.call(schedules, courseId)){
    throw new RangeError('未知课程：请选择 minute、gentle 或 steady。');
  }
  if(!Object.prototype.hasOwnProperty.call(sequences, mode)){
    throw new RangeError('未知模式：请选择 seated 或 standing，不自动切换模式。');
  }
  var timing = schedules[courseId];
  var support = supportSteps[mode];
  var sequence = sequences[mode];
  var plan = [];
  function append(kind, seconds, source){
    plan.push(makeStep(courseId, mode, kind, seconds, source, plan.length + 1));
  }
  append('prepare', timing.prepare, support.prepare);
  for(var round = 0; round < timing.rounds; round++){
    append('move', timing.move, moveById[sequence[round % sequence.length]]);
    append('rest', timing.rest, support.rest);
  }
  append('settle', timing.settle, support.settle);
  return plan;
}

// 这是计划中的活动上限，不是实际完成时间；暂停、跳过或提前结束需由 UI 如实计时。
function activeSeconds(plan){
  return plan.reduce(function(total, step){
    return total + (step.kind === 'move' ? step.seconds : 0);
  }, 0);
}

var habits = {
  title:'先让开始变容易',
  description:'在身体适合活动的前提下，一点活动也有意义；不需要先完成一整套。',
  tips:[
    '选一个稳定的日常提示，例如结束一段工作后；写下何时、在哪里、准备做什么。',
    '默认可以看 3 分钟，也能主动改选 1 分钟。只看图学习或今天休息，都不需要补偿。',
    '只记录实际完成的活动和感受，准备与休息不冒充活动时间；不靠连续打卡自动增加时长。',
    '计划被打断很常见，下次从可行的小目标重新开始；不补课、不惩罚，不必升级到 5 分钟。'
  ]
};

var sleep = {
  title:'给睡眠留出安静时间',
  description:'睡眠习惯与活动习惯分别选择一个小改变；这套课程不是失眠或睡眠呼吸暂停的治疗。',
  tips:[
    '尽量每天在相近的时间上床和起床，工作日与周末的差异尽量不超过约 1 小时。',
    '睡前约 1 小时留给安静活动，减少明亮屏幕和强光；不用为了完成课程推迟睡觉。',
    '睡前避免大餐和酒精，留意咖啡因；其影响可能持续长达 8 小时。',
    '卧室尽量安静、凉爽、昏暗，并给自己留够睡眠时间。',
    '适合时在白天安排轻活动；若临睡前活动让你更清醒，就换到更早，而不是加量催眠。'
  ],
  seekHelp:'经常大声打鼾、睡眠中呼吸停停续续或憋醒，或白天总是很困，应就医评估睡眠呼吸暂停；不能只靠活动或作息提示处理。困倦影响警觉时不要驾驶。持续睡不好或影响白天生活也应咨询医生。'
};

var sources = [
  {
    title:'WHO · Physical activity',
    url:'https://www.who.int/news-room/fact-sheets/detail/physical-activity',
    note:'任何量的活动优于完全不动，减少久坐。此原则不表示本课程足以达到长期活动建议，也不覆盖疼痛或发作时的停止要求。'
  },
  {
    title:'NIDDK · Staying Active at Any Size',
    url:'https://www.niddk.nih.gov/health-information/weight-management/staying-active-at-any-size',
    note:'长期不活动后慢慢开始，按感受调整；慢性病、关节或平衡问题先咨询。支持短时间活动、步行和坐姿动臂的一般思路，未核定本项目回合。'
  },
  {
    title:'NHS · Sitting exercises',
    url:'https://www.nhs.uk/live-well/exercise/sitting-exercises/',
    note:'已重新读取：稳定无轮椅、双脚平放；参考开胸、坐姿交替抬膝和温和转头。这里采用小幅与可随时停止的提示，没有照搬原页的组数或次数。'
  },
  {
    title:'NHS · Gout',
    url:'https://www.nhs.uk/conditions/gout/',
    note:'发作时休息并抬高患肢，不给关节施压；本课程不自动改为坐姿继续。关节肿痛加重或伴发热等需及时评估。'
  },
  {
    title:'NHLBI · Healthy Sleep Habits',
    url:'https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits',
    note:'规律作息、睡前安静时间、减少强光、留意咖啡因与卧室环境；提供习惯提示而非失眠治疗。'
  },
  {
    title:'NHS · Sleep apnoea',
    url:'https://www.nhs.uk/conditions/sleep-apnoea/',
    note:'呼吸暂停、憋醒和持续日间困倦需就医评估；生活习惯不能替代诊断与治疗。'
  },
  {
    title:'NICE PH49 · Behaviour change: individual approaches',
    url:'https://www.nice.org.uk/guidance/ph49/chapter/1-Recommendations',
    note:'参考建议 7、8、10：小目标与行动计划、如实记录、考虑个体需要、为中断准备应对计划。未验证或背书本项目的具体课程。'
  }
];

window.QDK_CONTENT = {
  courses:courses,
  modes:modes,
  defaultCourseId:defaultCourseId,
  defaultMode:defaultMode,
  buildPlan:buildPlan,
  activeSeconds:activeSeconds,
  moves:moves,
  safety:safety,
  habits:habits,
  sleep:sleep,
  sources:sources,
  mediaNote:mediaNote
};
})();
