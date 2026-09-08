(function(){
'use strict';
// 动作内容的唯一入口：课程、姿势、示范与提示在此维护。
var bodyweightMoves = [
  { id:'3013', name:'臀桥', area:'臀部与后侧链', sideMode:'none', equipment:'', steps:['仰卧屈膝，双脚与髋同宽','收紧腹部，脚跟推地抬髋','到肩—髋—膝接近直线后慢慢回位'], cue:'肋骨不要外翻；顶端夹臀，不要用腰向上拱。呼吸：抬髋时呼气，下放时吸气。', mistake:'常见错误：抬得越高越好，导致腰部过伸。' },
  { id:'0276', name:'死虫', area:'核心稳定', sideMode:'alternate', equipment:'', steps:['腰背自然贴稳垫面，髋膝约 90°','一侧手臂与对侧腿缓慢远离身体','腰背不离垫，回位后换侧'], cue:'范围由腰背能否保持稳定决定；宁可短一点。呼吸：手脚伸出时呼气，回位时吸气。', mistake:'常见错误：手脚下放过低，腰背拱起。' },
  { id:'0710', name:'侧卧髋外展', area:'臀中肌', sideMode:'half', equipment:'', steps:['侧卧，身体和下侧腿稳定','上侧腿伸直，脚尖朝正前方','小幅抬起，停一下，再控制放下'], cue:'先做右侧，过半换左侧；骨盆不要向后翻。呼吸：抬腿时呼气，放下时吸气。', mistake:'常见错误：腿抬太高、脚尖转向天花板。' },
  { id:'0659', name:'靠墙俯卧撑', area:'胸肩与上肢推力', sideMode:'none', equipment:'', steps:['面对墙站立，双手略宽于肩','身体保持一条直线，屈肘靠近墙','手掌推墙，回到起始位'], cue:'脚离墙越远越难；先选能稳定控制的位置。呼吸：推墙时呼气，靠近时吸气。', mistake:'常见错误：只移动头部，或塌腰、耸肩。' },
  { id:'1373', name:'扶墙提踵', area:'小腿与踝稳定', sideMode:'none', equipment:'', steps:['双脚平行，轻扶稳定物体','脚跟垂直上提，重心保持在大脚趾根部附近','停一下，再慢慢落地'], cue:'保持脚踝正直；急性足趾或踝关节红肿热痛时不要做。呼吸：上提时呼气，落地时吸气。', mistake:'常见错误：脚踝向外翻，靠弹跳完成。' },
  { id:'3239', name:'跪姿平板（可点肩）', area:'核心与肩稳定', sideMode:'alternate', equipment:'', steps:['膝盖着地、前臂撑地，头到膝保持直线','先稳住跪姿平板，能说话、不塌腰','稳了再轻点对侧肩；一晃就停在平板'], cue:'图是跪姿平板点肩。先撑住、能说话、不塌腰，稳了再轻点对侧肩；一晃就只撑住。呼吸：不要憋气。', mistake:'常见错误：塌腰，或猛地点肩扭腰。' }
];
var dumbbellMoves = [
  { id:'0291', name:'扶凳箱式深蹲', area:'大腿前侧与臀部', sideMode:'none', equipment:'哑铃', steps:['身后放一把稳固的椅子，双脚与髋同宽，哑铃垂于体侧（先徒手亦可）','臀部向后坐，像要坐进椅子里，膝盖朝脚尖方向','轻触椅面后脚跟推地站起，顶端夹臀'], cue:'椅子越高越简单；下蹲幅度以膝盖无锐痛为准，全程背部中立。先徒手练熟再加哑铃。呼吸：下坐时吸气，站起时呼气。', mistake:'常见错误：膝盖内扣、脚跟离地，或下坐时塌腰、上身过度前倾。' },
  { id:'1459', name:'哑铃罗马尼亚硬拉', area:'臀部与大腿后侧', sideMode:'none', equipment:'哑铃', steps:['双脚与髋同宽，膝盖微屈，哑铃贴近腿前','髋部向后送，躯干随之向前倾','背部保持中立，到大腿后侧有拉伸感后夹臀站起'], cue:'动作是"髋向后"，不是深蹲；幅度由背部能否保持中立决定，不必让哑铃碰地。呼吸：站起时呼气，前倾时吸气。', mistake:'常见错误：弓背、哑铃远离身体，或为了下得更低而失去控制。' },
  { id:'0292', name:'扶椅单臂哑铃划船', area:'背部与上肢拉力', sideMode:'half', equipment:'哑铃', steps:['将稳定椅靠墙，空手扶稳，双脚前后站立','背部保持中立，持铃手自然下垂','肘部贴近身体拉向髋侧，再缓慢放下'], cue:'示范图是膝盖跪凳的三点划船；家里请扶椅、两脚着地。先做右侧，过半换左侧。呼吸：上拉时呼气，下放时吸气。', mistake:'常见错误：耸肩、弓背，或用转动躯干把重量甩起来。' },
  { id:'0404', name:'坐姿中立握哑铃推举', area:'肩部与上肢推力', sideMode:'none', equipment:'哑铃', steps:['坐在靠墙的稳定椅上，双脚踩稳','掌心相对，将哑铃停在肩旁','向上推至手臂接近伸直，再控制回到肩旁'], cue:'肋骨收住、不要后仰；只有一只哑铃时，每次左右交替。肩部锐痛立即停止。呼吸：上推时呼气，回落时吸气。', mistake:'常见错误：腰部大幅后弓、耸肩，或在头顶撞击哑铃。' },
  { id:'1677', name:'坐姿哑铃弯举', area:'上臂前侧', sideMode:'none', equipment:'哑铃', steps:['坐稳，双脚着地，手臂自然垂在身体两侧','上臂保持安静，屈肘抬起哑铃','到可控位置后停一下，再缓慢下放'], cue:'两只可同时做；只有一只时左右交替。重量要允许肩膀和躯干保持安静。呼吸：抬起时呼气，下放时吸气。', mistake:'常见错误：身体前后摆动，或把肘部向前送来缩短动作。' }
];
/* ---- 健身房主流固定器械 · 全身均衡（3推3拉3腿）----
   顺序遵循 ACSM/NSCA：大肌群复合动作优先 → 推/拉交替 → 上/下肢交替，避免同肌群连做：
   腿举(腿·复合) → 推胸(推) → 下拉(拉) → 腿屈伸(腿) → 推肩(推) → 划船(拉) → 蝴蝶机(推) → 腿弯举(腿) → 辅助引体(拉)。
   动图同源 Kaggle 健身动图集。 */
var gymMoves = [
  { id:'2287', name:'腿举机', area:'大腿与臀部', sideMode:'none', equipment:'腿举机或哈克深蹲', steps:['坐稳靠背（或按健身房现有的腿举/哈克深蹲），双脚与髋同宽踩踏板中部','膝盖朝脚尖方向，缓慢屈膝下放','脚跟推踏板蹬起，顶端不锁死膝盖'], cue:'示范图更接近斜蹬/哈克。用你能坐稳、腰贴靠背的那台。下放以腰背贴稳为准。呼吸：蹬起时呼气，下放时吸气。', mistake:'常见错误：下放过深导致骨盆后倾、膝盖内扣，或猛蹬锁死膝盖。' },
  { id:'0576', name:'坐姿推胸机', area:'胸部与上肢推力', sideMode:'none', equipment:'坐姿推胸机', steps:['调好座椅高度，握把与胸同高，背部贴紧靠背','双手握把，肘部略低于肩，核心收紧','向前推至手臂接近伸直，再缓慢回放至胸侧'], cue:'重量宁轻勿重；推起时肩胛贴稳靠背、不耸肩。呼吸：推起时呼气，回放时吸气。', mistake:'常见错误：重量过大导致耸肩、弓背，或回放过快撞击配重。' },
  { id:'0579', name:'高位下拉机', area:'背部与上肢拉力', sideMode:'none', equipment:'高位下拉机', steps:['坐下固定大腿，握把略宽于肩，躯干微后倾','肩胛先下沉，再把握把拉向上胸','控制回放至手臂伸直，感受背阔拉伸'], cue:'与推胸一推一拉、相互平衡；用背带动手臂，不靠体重猛拉、不耸肩。呼吸：下拉时呼气，回放时吸气。', mistake:'常见错误：身体大幅后仰借力、耸肩，或拉到颈后。' },
  { id:'0588', name:'坐姿划船机', area:'上背与上肢拉力', sideMode:'none', equipment:'坐姿划船机', steps:['坐稳，胸口贴住靠垫，双脚踩实踏板','双手握把，背部保持中立不弓背','肘部贴近身体向后拉，肩胛向中间夹，再缓慢放回'], cue:'先挺胸再拉；拉到底时停顿一下。呼吸：后拉时呼气，放回时吸气。', mistake:'常见错误：弓背、耸肩，或用腰把重量甩回来。' },
  { id:'0404', name:'坐姿哑铃推举', area:'肩部与上肢推力', sideMode:'none', equipment:'哑铃（没有推肩机时用这个）', steps:['坐在有靠背的椅子上，双脚踩稳','掌心相对，哑铃停在肩旁','向上推至手臂接近伸直，再控制回到肩旁'], cue:'没有独立推肩机就用哑铃；图也是哑铃，不是推肩机。不要后仰顶腰。呼吸：上推时呼气，回落时吸气。', mistake:'常见错误：腰部大幅后弓、耸肩，或在头顶撞击哑铃。' },
  { id:'0599', name:'坐姿腿弯举机', area:'大腿后侧', sideMode:'none', equipment:'坐姿腿弯举机', steps:['调好靠背与踝垫，踝垫位于跟腱上方','双手扶稳把手，大腿贴紧座垫','屈膝把踝垫向下向后压，再缓慢放回'], cue:'练大腿后侧，和腿举前后平衡。动作慢而稳，骨盆不离开座垫。呼吸：下压时呼气，回放时吸气。', mistake:'常见错误：借惯性猛压、骨盆弹起，或回放过快。' }
];
var MOVE_META = {
  '3013':{ primary:'臀大肌', secondary:'腘绳肌、腹壁稳定肌', benefit:'提升髋伸力量，帮助起身与步行。', level:'起步' },
  '0276':{ primary:'腹横肌、腹直肌', secondary:'髋屈肌', benefit:'练习手脚活动时保持腰腹稳定。', level:'起步' },
  '0710':{ primary:'臀中肌', secondary:'臀小肌、腹斜肌', benefit:'帮助站立、走路时稳定骨盆。', level:'起步' },
  '0659':{ primary:'胸大肌、肱三头肌', secondary:'前三角肌、腹壁稳定肌', benefit:'补齐上肢推力，并练站姿躯干稳定。', level:'起步' },
  '1373':{ primary:'腓肠肌、比目鱼肌', secondary:'足踝稳定肌', benefit:'帮助走路推进与踝部稳定。', level:'起步' },
  '3239':{ primary:'腹横肌、腹直肌', secondary:'肩胛稳定肌、腹斜肌', benefit:'练习跪姿下抵抗塌腰；稳了再点肩。', level:'起步·先跪姿' },
  'towel-row':{ primary:'背阔肌、菱形肌', secondary:'肱二头肌、后三角肌', benefit:'补上肢拉力，改善含胸。', level:'起步' },
  '0292':{ primary:'背阔肌、菱形肌', secondary:'肱二头肌、后三角肌', benefit:'补齐上肢拉力，帮助提物与改善圆肩姿势。', level:'建立' },
  '0404':{ primary:'三角肌', secondary:'肱三头肌、上背稳定肌', benefit:'提升头顶拿取物品的上肢能力。', level:'建立' },
  '1677':{ primary:'肱二头肌', secondary:'肱肌、前臂', benefit:'提升提袋、抱物时的屈肘力量。', level:'建立' },
  '1459':{ primary:'臀大肌、腘绳肌', secondary:'竖脊肌、腹壁稳定肌', benefit:'强化髋铰链，帮助从地面附近安全取物。', level:'建立' },
  '0291':{ primary:'股四头肌、臀大肌', secondary:'腘绳肌、躯干稳定肌', benefit:'强化坐下、起身与上下楼所需的大肌群。', level:'建立' },
  '0576':{ primary:'胸大肌', secondary:'肱三头肌、前三角肌', benefit:'强化上肢水平推力，帮助推门、提举等日常力量。', level:'建立' },
  '0579':{ primary:'背阔肌', secondary:'肱二头肌、菱形肌', benefit:'强化上肢垂直拉力，帮助提拉与改善圆肩。', level:'建立' },
  '0588':{ primary:'背阔肌、菱形肌', secondary:'肱二头肌、后三角肌', benefit:'强化上肢水平拉力，改善含胸与上背无力。', level:'建立' },
  '2287':{ primary:'股四头肌、臀大肌', secondary:'腘绳肌、小腿', benefit:'强化下肢整体力量，帮助起身、上楼与搬物。', level:'建立' },
  '0599':{ primary:'腘绳肌', secondary:'腓肠肌', benefit:'强化大腿后侧，平衡腿部力量、保护膝关节。', level:'建立' },
  '0603':{ primary:'三角肌', secondary:'肱三头肌、上背稳定肌', benefit:'提升头顶取物的上肢力量与肩部稳定。', level:'建立' },
  '0585':{ primary:'股四头肌', secondary:'髋屈肌', benefit:'强化大腿前侧，与腿弯举平衡腿部力量。', level:'建立' },
  '0596':{ primary:'胸大肌', secondary:'前三角肌', benefit:'强化胸部与夹胸控制，改善上肢推力。', level:'建立' },
  '0017':{ primary:'背阔肌', secondary:'肱二头肌、上背稳定肌', benefit:'以辅助重量练引体，强化垂直拉力。', level:'建立' }
};
bodyweightMoves.concat(dumbbellMoves).concat(gymMoves).forEach(function(m){
  var meta = MOVE_META[m.id] || {};
  Object.keys(meta).forEach(function(k){ m[k] = meta[k]; });
});
var chairStandMove = Object.assign({}, dumbbellMoves.filter(function(m){ return m.id === '0291'; })[0], {
  id:'chair-stand', mediaId:'0291', voiceId:'0291', name:'扶椅坐站（先徒手）', area:'大腿、臀部与躯干稳定',
  sideMode:'none', equipment:'稳固椅子；图中哑铃仅为进阶',
  primary:'股四头肌、臀大肌', secondary:'腘绳肌、腹壁稳定肌',
  benefit:'强化起身、上下楼和日常活动所需的大肌群。',
  steps:['把稳固椅子靠墙，双脚踩稳，先不拿哑铃','臀部向后坐，轻触椅面；可用双手扶大腿或椅侧协助','脚跟推地站起，能稳定完成后再考虑轻负重'],
  cue:'先徒手；椅子越高越轻松。膝盖朝脚尖方向，膝或腰出现锐痛立即停止。',
  mistake:'常见错误：一开始就加重量、膝盖内扣，或借惯性猛坐猛起。', level:'起步·先徒手'
});
var birdDogMove = {
  id:'bird-dog',
  name:'鸟狗式分步', area:'核心与腰盆协调', sideMode:'alternate', equipment:'',
  primary:'多裂肌、竖脊肌', secondary:'腹壁、臀大肌、后三角肌',
  benefit:'练习四肢移动时保持腰盆稳定。',
  steps:['仅在能安全上下地面时做，四点跪姿起步','先只伸一只手或一条腿，稳定后再做对侧手脚','身体不晃、腰不塌，短暂停留后换侧'],
  cue:'图是对侧手脚一起伸。家里先只伸一只手或一条腿；腹部较大可把手撑在稳固沙发座面。',
  mistake:'常见错误：抬得过高、腰部旋转，或为了跟图而超出自己幅度。', level:'可选进阶'
};
var wallPlankMove = Object.assign({}, bodyweightMoves.filter(function(m){ return m.id === '0659'; })[0], {
  id:'wall-plank', frames:['generated/wall-plank-anatomy.png'], hold:true, name:'墙面斜板支撑', area:'站姿核心稳定', sideMode:'none',
  primary:'腹横肌、腹直肌', secondary:'腹斜肌、肩胛稳定肌',
  benefit:'练习抵抗塌腰，帮助站立和搬拿时保持躯干稳定。',
  steps:['面对墙站立，双手撑墙略宽于肩','双脚向后小步移动，让身体成一直线','轻轻收紧腹部，保持呼吸，时间到后走近墙面'],
  cue:'按静态姿势撑住，双脚踩稳，不做推起动作。墙越近越轻松，全程能说短句。若肩痛，走近一点。',
  mistake:'常见错误：塌腰、耸肩或屏住呼吸。', level:'起步'
});
var farmerCarryMove = {
  id:'farmer-carry', mediaId:'2133',
  name:'轻负重行走 / 原地持重', area:'站姿核心与全身稳定', sideMode:'none',
  equipment:'两只同重量轻哑铃或水瓶',
  primary:'腹壁稳定肌、竖脊肌', secondary:'前臂、斜方肌、臀中肌',
  benefit:'练习行走、提物时维持直立躯干和稳定呼吸。',
  steps:['选两只同重量轻物，先确认握得住且地面没有障碍','站高，肋骨和骨盆保持自然叠放，双手垂在体侧','空间安全就慢走；空间不足则原地交替抬脚，始终能说短句'],
  cue:'图是双手持铃慢走。重量宁轻勿重；空间不够就原地踏步。肩膀放松，不侧弯、不憋气。',
  mistake:'常见错误：为了追求重量而耸肩、身体侧弯，或在狭窄空间勉强行走。',
  level:'起步·轻负重'
};
var towelRowMove = {
  id:'towel-row', mediaId:'3165',
  name:'坐姿毛巾划船', area:'背部与上肢拉力', sideMode:'none',
  equipment:'长毛巾、稳固椅子', noMedia:true,
  primary:'背阔肌、菱形肌', secondary:'肱二头肌、后三角肌',
  benefit:'补上肢拉力，改善含胸。',
  steps:['坐在稳固椅子上，毛巾从脚底绕过，两手各抓一头','背部中立，肘贴身体，把毛巾拉向腰侧','停一下，再慢慢放回'],
  cue:'保持坐稳，毛巾绕过脚底。拉的是背，不要耸肩。呼吸：拉回时呼气，放回时吸气。',
  mistake:'常见错误：弓背、耸肩，或靠后仰借力。', level:'起步'
};
var coreMoves = [wallPlankMove, chairStandMove, farmerCarryMove, birdDogMove, bodyweightMoves[1]];
var routines = {
  bodyweight: [bodyweightMoves[0], bodyweightMoves[1], chairStandMove, bodyweightMoves[3], towelRowMove, bodyweightMoves[5]],
  dumbbell: dumbbellMoves,
  core: coreMoves,
  gym: gymMoves
};
var routineNames = { bodyweight:'徒手基础', dumbbell:'居家哑铃', core:'腰腹稳定', gym:'健身器械' };
var presets = {
  recovery:{warmup:45,work:20,rest:25,roundBreak:40,cooldown:45,rounds:1},
  starter:{warmup:60,work:40,rest:25,roundBreak:45,cooldown:60,rounds:1},
  standard:{warmup:60,work:45,rest:20,roundBreak:45,cooldown:60,rounds:2},
  steady:{warmup:75,work:50,rest:15,roundBreak:45,cooldown:75,rounds:3}
};
var presetNames = { recovery:'恢复档', starter:'入门档', standard:'标准档', steady:'进阶档' };

/* ---- 热身动作库（低冲击、站姿、大体重友好；动图同源 Kaggle 健身动图集）---- */
var warmupMoves = [
  { id:'3221', name:'原地踏步激活', sec:30, target:'全身 / 髋', position:'站姿', cue:'站直，交替抬膝到舒适高度，手臂自然摆动。图里膝盖抬得偏高，你按自己能稳住的高度即可。' },
  { id:'1368', name:'踝关节绕环', sec:20, target:'踝', position:'站姿', cue:'单脚站稳（可扶墙），另一脚脚尖画圈，顺逆各几次后换脚。' },
  { id:'0257', name:'膝关节绕环', sec:20, target:'膝', position:'站姿', cue:'双脚并拢微屈，双手扶膝轻画圈；幅度以舒适为准，不顺滑就缩小范围。' },
  { id:'1428', name:'腕关节绕环', sec:20, target:'腕 / 前臂', position:'站姿', cue:'双手十指交叉转动，或单腕画圈，活动手腕与前臂。' },
  { id:'1167', name:'动态扩胸', sec:25, target:'肩 / 胸', position:'站姿', cue:'双臂前后摆动、画圈，打开肩胸；动作连贯、不憋气。' }
];

/* ---- 拉伸字典（按编号；练后针对部位 + 独立拉伸组共用）---- */
var STRETCH = {
  '1377':{ name:'扶墙小腿拉伸', sec:28, target:'小腿', position:'站姿·扶墙', cue:'双手扶墙，一腿在前一腿在后，后脚跟贴地、膝伸直，身体前倾直到小腿后侧有拉伸感，换腿。' },
  '1576':{ name:'仰卧抬腿拉伸', sec:28, target:'大腿后侧', position:'仰卧', cue:'平躺，一腿伸直放地，另一腿抬起、双手抱大腿后侧往胸口靠，膝可微屈，换腿。' },
  'quad-stand':{ name:'扶墙股四头拉伸', sec:28, target:'大腿前侧', position:'站姿·扶墙', noMedia:true, cue:'扶墙站稳，一手抓同侧脚背拉向臀部，双膝并拢。抓不到就用毛巾套住脚背，换边。' },
  '1271':{ name:'胸前侧拉伸', sec:28, target:'胸 / 肩前侧', position:'站姿', cue:'图里用短杠举到脑后；家里双手在身后交握或握毛巾即可，挺胸、肩向后向下沉。' },
  '0643':{ name:'过头三头拉伸', sec:28, target:'上臂后侧', position:'站姿', cue:'一臂上举屈肘、手摸背，另一手轻压肘尖；肋骨别外翻，换边。' },
  '0794':{ name:'站姿侧拉伸', sec:28, target:'侧腰 / 背阔', position:'站姿', cue:'一臂上举，身体向对侧轻弯，感受侧腰到背的拉伸，换边。' },
  '1365':{ name:'上背拉伸', sec:28, target:'上背', position:'站姿', cue:'双手在胸前交握向前推、含胸，把上背撑开；或一臂横抱胸前轻压。' },
  '0669':{ name:'肩后拉伸', sec:28, target:'肩后侧', position:'站姿', cue:'一臂横过胸前，另一手轻压肘部靠近身体，肩别耸起，换边。' },
  '1424':{ name:'坐姿臀部拉伸', sec:28, target:'臀部', position:'坐姿', cue:'坐稳，一脚踝放到另一膝上成“4”字，挺胸轻轻前倾，感受臀部拉伸，换边。' },
  '1403':{ name:'颈侧拉伸', sec:28, target:'颈侧', position:'站姿', cue:'头轻偏向一侧，对侧手可轻扶头，肩放松下沉，不要用力掰，换边。' }
};
function sm(id){ return Object.assign({ id:id }, STRETCH[id]); }
var stretchSets = {
  bodyweight:[ '1377','1576','quad-stand','1271','0643','0794' ].map(sm),
  dumbbell:[ '0794','1365','0643','0669','1576','quad-stand' ].map(sm),
  core:[ '0794','0669','1271','0643','1424','quad-stand' ].map(sm),
  gym:[ '1271','0794','1365','0643','1576','quad-stand' ].map(sm),
  stretch:[ '1377','1576','quad-stand','1424','1271','0669','0643','0794','1403' ].map(sm)
};
routines.stretch = stretchSets.stretch;
routineNames.stretch = '拉伸';

window.QDK_CONTENT = {bodyweightMoves:bodyweightMoves, dumbbellMoves:dumbbellMoves, gymMoves:gymMoves, coreMoves:coreMoves, routines:routines, routineNames:routineNames, presets:presets, presetNames:presetNames, warmupMoves:warmupMoves, STRETCH:STRETCH, stretchSets:stretchSets};
})();
