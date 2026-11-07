(function(){
'use strict';

// 轻打卡 · 个人科学跟练版
// 科学训练体系：每周3练 A→B→C 循环 + 2节场景课（久坐拉伸 / 健身器械）
// 100% 3D 肌肉解剖动图 + 预录女声口令，零记账、零门槛、科学清晰

var GUIDES_PATH = 'assets/exercise-guides/';
var VOICE_PATH = 'assets/voice/';

var movesDict = {
  // === 热身动作（5项）===
  '3221': {
    id: '3221',
    name: '原地踏步激活',
    gif: GUIDES_PATH + '3221.gif',
    poster: GUIDES_PATH + '3221-poster.png',
    voice: VOICE_PATH + 'warmup-3221.m4a',
    primary: '全身、髋屈肌',
    secondary: '核心稳定肌、小腿',
    benefit: '提升全身心率与体温，润滑髋膝关节。',
    sideMode: 'none',
    shortCue: '按自己稳住的高度抬膝，手臂自然摆动。',
    steps: [
      '站立挺胸，腹部自然微收，目光平视前方',
      '双腿交替抬膝至舒适高度，前脚掌轻柔着地',
      '双臂自然前后摆动，配合顺畅呼吸'
    ],
    cue: '站直，交替抬膝到舒适高度，手臂自然摆动。按自己能稳住的高度即可。呼吸：匀速呼吸，不憋气。',
    mistake: '膝盖猛烈砸地、身体过度后仰或屏住呼吸。',
    mediaLabel: '全身激活'
  },
  '1167': {
    id: '1167',
    name: '动态扩胸',
    gif: GUIDES_PATH + '1167.gif',
    poster: GUIDES_PATH + '1167-poster.png',
    voice: VOICE_PATH + 'warmup-1167.m4a',
    primary: '胸大肌、肩前束',
    secondary: '菱形肌、斜方肌中部',
    benefit: '舒展胸前肌群，活动肩关节与胸椎，改善含胸。',
    sideMode: 'none',
    shortCue: '双臂向两侧打开再合回，展开胸腔不憋气。',
    steps: [
      '站姿挺拔，双臂屈肘平抬在胸前',
      '双臂向身体两侧水平打开，同时展开胸腔',
      '平稳合回胸前，动作连贯不生硬'
    ],
    cue: '双臂向两侧打开再合回，肩胸展开；也可以前后摆动。打开肩胸，动作连贯。呼吸：展开时吸气，合拢时呼气。',
    mistake: '耸肩发力，或挺腰借力导致肋骨严重外翻。',
    mediaLabel: '胸肩展开'
  },
  '1428': {
    id: '1428',
    name: '腕关节绕环',
    gif: GUIDES_PATH + '1428.gif',
    poster: GUIDES_PATH + '1428-poster.png',
    voice: VOICE_PATH + 'warmup-1428.m4a',
    primary: '腕屈肌、腕伸肌',
    secondary: '前臂肌群',
    benefit: '润滑手腕关节囊，预防支撑与握持不适。',
    sideMode: 'none',
    shortCue: '抬前臂转手腕画圈，顺逆各数圈。',
    steps: [
      '抬起前臂屈肘置于胸前，双手自然放松',
      '以手腕为轴顺时针平滑旋转画圈',
      '旋转数圈后换逆时针方向绕环'
    ],
    cue: '示范是抬起前臂、单个手腕画圈；也可以双手十指交叉一起转。活动手腕与前臂。呼吸：平稳自然呼吸。',
    mistake: '用力甩动手掌，或速度过快产生关节弹响。',
    mediaLabel: '腕部润滑'
  },
  '0257': {
    id: '0257',
    name: '膝关节绕环',
    gif: GUIDES_PATH + '0257.gif',
    poster: GUIDES_PATH + '0257-poster.png',
    voice: VOICE_PATH + 'warmup-0257.m4a',
    primary: '股四头肌、腘绳肌腱',
    secondary: '小腿三头肌',
    benefit: '温和润滑膝关节与半月板周围滑液。',
    sideMode: 'none',
    shortCue: '双膝微屈扶膝轻画圈，幅度小而顺。',
    steps: [
      '双脚并拢，双膝微屈，双手轻扶膝盖上缘',
      '以膝盖画小圆圈，顺时针缓慢旋转',
      '旋转数圈后换反方向平稳画圈'
    ],
    cue: '双脚并拢微屈，双手扶膝轻画圈；幅度以舒适为准，不顺滑就缩小范围。呼吸：平稳呼吸。',
    mistake: '大幅度扭转膝关节，或手掌用力下压膝盖。',
    mediaLabel: '膝部润滑'
  },
  '1368': {
    id: '1368',
    name: '踝关节绕环',
    gif: GUIDES_PATH + '1368.gif',
    poster: GUIDES_PATH + '1368-poster.png',
    voice: VOICE_PATH + 'warmup-1368.m4a',
    primary: '足踝稳定肌',
    secondary: '小腿肌群',
    benefit: '活动踝关节韧带与关节囊，提升下肢稳定。',
    sideMode: 'half',
    shortCue: '单脚站稳，另一脚脚尖点地画圆圈。',
    steps: [
      '单脚站稳（可轻扶稳固物体），重心稳定',
      '另一脚脚尖轻点地面，以脚踝为轴平稳画圆',
      '过半提示时换另一侧脚画圈'
    ],
    cue: '单脚站稳（可扶墙），另一脚脚尖画圈，顺逆各几次后换脚。过半语音报换另一侧。呼吸：均匀自然呼吸。',
    mistake: '重心摇晃失去平衡，或脚踝动作生硬扭扯。',
    mediaLabel: '脚尖画圈'
  },

  // === 正式动作（19项）===
  '0291': {
    id: '0291',
    name: '扶凳箱式深蹲',
    gif: GUIDES_PATH + '0291.gif',
    poster: GUIDES_PATH + '0291-poster.png',
    voice: VOICE_PATH + 'work-0291.m4a',
    primary: '股四头肌、臀大肌',
    secondary: '腘绳肌、躯干稳定肌',
    benefit: '强化下肢起身与深蹲核心肌群，椅子托底护膝。',
    sideMode: 'none',
    shortCue: '臀部后坐轻触椅面，脚跟推地站起，膝朝脚尖。',
    steps: [
      '身后放稳固椅子，双脚与肩同宽，脚尖微向外',
      '臀部向后下方坐像坐进椅子，膝盖沿脚尖方向，轻触椅面',
      '脚跟发力推地平稳站起，顶端自然夹臀'
    ],
    cue: '椅子越高越简单；下蹲幅度以膝盖无锐痛为准，全程背部中立。先徒手练熟再加哑铃。呼吸：下坐吸气，起身呼气。',
    mistake: '膝盖内扣、脚跟离地，或下坐时猛摔进椅子。',
    mediaLabel: '椅子托底护膝'
  },
  '3013': {
    id: '3013',
    name: '臀桥',
    gif: GUIDES_PATH + '3013.gif',
    poster: GUIDES_PATH + '3013-poster.png',
    voice: VOICE_PATH + 'work-3013.m4a',
    primary: '臀大肌',
    secondary: '腘绳肌、腹壁稳定肌',
    benefit: '在零膝关节冲击下强化臀部与后侧链力量。',
    sideMode: 'none',
    shortCue: '脚跟推地抬髋，顶端夹臀，不要拱腰。',
    steps: [
      '仰卧屈膝，双脚踩实与髋同宽，双臂自然置于体侧',
      '收紧腹部，脚跟向下推地将髋部抬起',
      '到肩—髋—膝接近直线后顶端夹臀，慢慢回位'
    ],
    cue: '肋骨不要外翻；顶端夹臀，不要用腰向上拱。脚跟踩稳成一直线。呼吸：抬髋呼气，下放吸气。',
    mistake: '抬得过高导致腰部过伸反拱，或双膝过度外翻内扣。',
    mediaLabel: '不伤膝强化后侧'
  },
  '0659': {
    id: '0659',
    name: '靠墙俯卧撑',
    gif: GUIDES_PATH + '0659.gif',
    poster: GUIDES_PATH + '0659-poster.png',
    voice: VOICE_PATH + 'work-0659.m4a',
    primary: '胸大肌、肱三头肌',
    secondary: '前三角肌、腹壁稳定肌',
    benefit: '以安全站姿构建上肢推力，对肩颈腕极度友好。',
    sideMode: 'none',
    shortCue: '身体保持直线，屈肘靠近墙，再缓慢推回。',
    steps: [
      '面对墙站立双手略宽于肩按墙，脚退半步',
      '身体保持一条直线，屈肘使胸口靠近墙',
      '手掌推墙发力，回到起始位置'
    ],
    cue: '脚离墙越远越难；先选能稳定控制的位置。躯干成一直线。呼吸：推墙呼气，靠近吸气。',
    mistake: '只移动头部碰墙，或塌腰、耸肩。',
    mediaLabel: '站姿安全推力'
  },
  '0276': {
    id: '0276',
    name: '死虫',
    gif: GUIDES_PATH + '0276.gif',
    poster: GUIDES_PATH + '0276-poster.png',
    voice: VOICE_PATH + 'work-0276.m4a',
    primary: '腹直肌、腹横肌',
    secondary: '髋屈肌、前锯肌',
    benefit: '仰卧位贴地训练深层核心，最安全护腰的抗伸展练习。',
    sideMode: 'alternate',
    shortCue: '对侧手脚缓慢伸出，腰背贴稳垫面，左右交替。',
    steps: [
      '腰背自然贴稳垫面，髋膝屈曲约90度，双手指向天花板',
      '一侧手臂与对侧腿缓慢远离身体伸出',
      '腰背始终不离垫面，平稳收回后换对侧'
    ],
    cue: '范围由腰背能否保持稳定决定；宁可短一点。腰背贴垫宁短勿晃。呼吸：手脚伸出呼气，回位吸气。',
    mistake: '手脚下放过低导致腰背拱起离开垫面。',
    mediaLabel: '腰背贴垫最护腰'
  },
  '0710': {
    id: '0710',
    name: '侧卧髋外展',
    gif: GUIDES_PATH + '0710.gif',
    poster: GUIDES_PATH + '0710-poster.png',
    voice: VOICE_PATH + 'work-0710.m4a',
    primary: '臀中肌',
    secondary: '臀小肌、腹斜肌',
    benefit: '强化骨盆侧向稳定肌，稳固骨盆、保护膝关节。',
    sideMode: 'half',
    shortCue: '侧卧勾脚尖抬腿，骨盆不翻转，过半换另一侧。',
    steps: [
      '侧卧在垫上，下侧腿微屈支撑，躯干保持稳定',
      '上侧腿伸直、脚尖朝正前，小幅平稳抬起',
      '顶端停顿一下控制放下，过半换另一侧'
    ],
    cue: '先做一侧，过半语音报换另一侧；骨盆不要向后翻。呼吸：抬腿呼气，放下吸气。',
    mistake: '腿抬太高导致骨盆向后翻转、脚尖转向天花板。',
    mediaLabel: '稳骨盆护膝'
  },
  '1373': {
    id: '1373',
    name: '扶墙提踵',
    gif: GUIDES_PATH + '1373.gif',
    poster: GUIDES_PATH + '1373-poster.png',
    voice: VOICE_PATH + 'work-1373.m4a',
    primary: '腓肠肌、比目鱼肌',
    secondary: '足踝稳定肌',
    benefit: '激活下肢静脉回流泵，改善循环，增强踝关节稳定。',
    sideMode: 'none',
    shortCue: '手扶墙脚跟垂直提至最高，停顿后慢慢落地。',
    steps: [
      '双脚平行站立，轻扶稳固墙面或椅背保持平衡',
      '脚跟垂直向上提起，重心保持在大脚趾根部附近',
      '在顶端短暂停顿感受小腿收缩，再缓慢受控落地'
    ],
    cue: '保持脚踝正直垂直；脚踝红肿不适时不要做。呼吸：上提呼气，落地吸气。',
    mistake: '脚踝向外撇翻、靠身体弹跳快速震动完成。',
    mediaLabel: '下肢静脉泵'
  },
  '0292': {
    id: '0292',
    name: '扶椅单臂哑铃划船',
    gif: GUIDES_PATH + '0292.gif',
    poster: GUIDES_PATH + '0292-poster.png',
    voice: VOICE_PATH + 'work-0292.m4a',
    primary: '背阔肌、菱形肌',
    secondary: '肱二头肌、后三角肌',
    benefit: '强化上肢水平拉力，纠正圆肩含胸，提升背部支撑力。',
    sideMode: 'half',
    shortCue: '扶椅站稳，肘贴身拉向髋部，背部夹紧，过半换边。',
    steps: [
      '将稳固椅子靠墙，一手扶稳椅面，双脚前后错步站稳',
      '背部保持平直中立，持铃手自然下垂',
      '肘部贴近身体拉向髋侧，顶端夹背，再缓慢放下'
    ],
    cue: '示范图是膝盖跪凳的三点划船；家里请扶椅、两脚着地更稳。先做一侧，过半换边。呼吸：上拉呼气，下放吸气。',
    mistake: '耸肩、弓背，或用转动躯干把重量甩起来。',
    mediaLabel: '图例跪凳 · 居家扶椅更稳'
  },
  '1459': {
    id: '1459',
    name: '哑铃罗马尼亚硬拉',
    gif: GUIDES_PATH + '1459.gif',
    poster: GUIDES_PATH + '1459-poster.png',
    voice: VOICE_PATH + 'work-1459.m4a',
    primary: '臀大肌、腘绳肌',
    secondary: '竖脊肌、腹壁稳定肌',
    benefit: '强化髋铰链发力模式，加强后侧链，日常弯腰护腰。',
    sideMode: 'none',
    shortCue: '髋向后推，膝微屈背平直，大腿后侧发紧后夹臀站起。',
    steps: [
      '双脚与髋同宽，双膝微屈，哑铃贴近大腿前侧',
      '髋部主动向后送，躯干随之向前倾斜',
      '背部保持中立，到大腿后侧有拉伸感后夹臀站起'
    ],
    cue: '动作是“髋向后”，不是深蹲；幅度由背部能否保持中立决定，不必触地。呼吸：站起呼气，前倾吸气。',
    mistake: '弓背、哑铃远离身体，或为了下得更低而失去控制。',
    mediaLabel: '髋铰链护腰'
  },
  '0404': {
    id: '0404',
    name: '坐姿中立握哑铃推举',
    gif: GUIDES_PATH + '0404.gif',
    poster: GUIDES_PATH + '0404-poster.png',
    voice: VOICE_PATH + 'work-0404.m4a',
    primary: '三角肌前中束',
    secondary: '肱三头肌、上背稳定肌',
    benefit: '强化上肢垂直推力，掌心相对握法显著减轻肩峰压力。',
    sideMode: 'none',
    shortCue: '坐稳靠背，掌心相对推起哑铃，沉肩不耸肩。',
    steps: [
      '坐在靠墙的稳定椅上，双脚踩稳，背部贴实靠背',
      '掌心相对，将哑铃停在肩部旁侧',
      '垂直向上推举至手臂接近伸直，再控制回到肩旁'
    ],
    cue: '掌心相对更护肩；肋骨收住不要后仰顶腰。肩部锐痛立即停止。呼吸：上推呼气，回落吸气。',
    mistake: '腰部大幅后弓离开靠背、耸肩，或头顶撞击哑铃。',
    mediaLabel: '掌心相对更护肩'
  },
  '1677': {
    id: '1677',
    name: '坐姿哑铃弯举',
    gif: GUIDES_PATH + '1677.gif',
    poster: GUIDES_PATH + '1677-poster.png',
    voice: VOICE_PATH + 'work-1677.m4a',
    primary: '肱二头肌',
    secondary: '肱肌、前臂屈肌',
    benefit: '孤立强化上臂前侧力量，提升日常拎提抱物能力。',
    sideMode: 'none',
    shortCue: '大臂贴紧身体，屈肘上举哑铃，顶端微停慢下放。',
    steps: [
      '坐稳靠背，双脚着地，手臂自然垂在身体两侧',
      '上臂保持固定安静，屈肘缓慢抬起哑铃',
      '到充分收缩位置后停顿一下，再缓慢受控下放'
    ],
    cue: '大臂始终保持安静，重量要允许肩膀和躯干不借力。呼吸：抬起呼气，下放吸气。',
    mistake: '身体前后摆动借力，或把肘部向前送缩短行程。',
    mediaLabel: '孤立发力'
  },
  'wall-plank': {
    id: 'wall-plank',
    name: '墙面斜板支撑',
    gif: GUIDES_PATH + 'generated/wall-plank-anatomy.png',
    poster: GUIDES_PATH + 'generated/wall-plank-anatomy.png',
    voice: null,
    primary: '腹横肌、前锯肌',
    secondary: '腹直肌、肩胛稳定肌',
    benefit: '以无冲击斜板姿态激活深层腹横肌，建立抗塌腰核心张力。',
    sideMode: 'none',
    shortCue: '双手撑墙身体呈直线，收紧腹部，平稳呼吸不塌腰。',
    steps: [
      '面对平整墙面站立，双手撑墙略宽于肩',
      '双脚向后小步移动，让身体从头到脚呈一直线',
      '轻轻收紧腹部保持平稳呼吸，时间到后走近墙面'
    ],
    cue: '按静态姿势撑住，双脚踩稳，不做推起动作。墙越近越轻松，全程能说短句。呼吸：深长均匀呼吸。',
    mistake: '塌腰、耸肩或屏住呼吸憋气。',
    mediaLabel: '3D肌肉解剖图'
  },
  '2133': {
    id: '2133',
    name: '轻负重行走 / 原地持重',
    gif: GUIDES_PATH + '2133.gif',
    poster: GUIDES_PATH + '2133-poster.png',
    voice: null,
    primary: '腹壁稳定肌、竖脊肌',
    secondary: '前臂抓握肌、臀中肌',
    benefit: '训练躯干抗侧屈与抗旋转能力，提升提物行走稳定性。',
    sideMode: 'none',
    shortCue: '双手持轻物挺拔站立，慢走或原地交替踏步。',
    steps: [
      '选两只同重量轻哑铃或水瓶垂在体侧，双肩自然下沉',
      '站立挺拔，肋骨与骨盆自然叠放，腹部收紧',
      '空间安全则平稳慢走；空间不足则原地交替踏步'
    ],
    cue: '图是双手持铃慢走。重量宁轻勿重；空间不够就原地踏步。肩膀放松，不侧弯。呼吸：平稳呼吸。',
    mistake: '为了追求负重而耸肩、身体侧弯，或在狭窄空间勉强行走。',
    mediaLabel: '抗侧屈核心稳定'
  },
  'bird-dog': {
    id: 'bird-dog',
    name: '鸟狗式',
    gif: GUIDES_PATH + 'bird-dog.gif',
    poster: GUIDES_PATH + 'bird-dog-poster.png',
    voice: null,
    primary: '多裂肌、竖脊肌',
    secondary: '腹壁肌群、臀大肌、后三角肌',
    benefit: '经典的躯干抗旋转与腰盆协调训练，增强下背部稳定。',
    sideMode: 'alternate',
    shortCue: '四点跪姿对侧手脚伸平，骨盆水平不晃，左右交替。',
    steps: [
      '四点跪姿于垫上，手腕在肩下方，膝在髋下方',
      '先伸一只手或一条腿，稳定后再做对侧手脚伸展',
      '身体不晃、腰不塌，平稳停留后回到原位换对侧'
    ],
    cue: '图是对侧手脚一起伸。家里先只伸一手或一腿；腹部较大可手撑稳固沙发座面。呼吸：伸展呼气，回位吸气。',
    mistake: '抬得过高导致腰部塌陷旋转，或为了跟图超出幅度。',
    mediaLabel: '示范为对侧同伸'
  },
  '2287': {
    id: '2287',
    name: '腿举机',
    gif: GUIDES_PATH + '2287.gif',
    poster: GUIDES_PATH + '2287-poster.png',
    voice: VOICE_PATH + 'work-2287.m4a',
    primary: '股四头肌、臀大肌',
    secondary: '腘绳肌、小腿肌群',
    benefit: '全靠背支撑下安全承载下肢负荷，强化腿臀复合力量。',
    sideMode: 'none',
    shortCue: '背贴靠垫双脚踩板，下放屈膝推起不锁死膝盖。',
    steps: [
      '坐稳靠背，双脚与髋同宽踩在踏板中部，膝朝脚尖',
      '膝盖朝脚尖方向，缓慢屈膝下放踏板',
      '脚跟推踏板蹬起，顶端保持微屈不锁死膝盖'
    ],
    cue: '示范图更接近斜蹬/哈克。用你能坐稳腰贴靠背的那台。下放以腰背贴稳为准。呼吸：蹬起呼气，下放吸气。',
    mistake: '下放过深导致骨盆后倾离开靠垫，或猛蹬超伸锁死膝盖。',
    mediaLabel: '靠背支撑'
  },
  '0576': {
    id: '0576',
    name: '坐姿推胸机',
    gif: GUIDES_PATH + '0576.gif',
    poster: GUIDES_PATH + '0576-poster.png',
    voice: VOICE_PATH + 'work-0576.m4a',
    primary: '胸大肌',
    secondary: '肱三头肌、前三角肌',
    benefit: '固定安全轨迹强化上肢水平推力，改善胸部力量。',
    sideMode: 'none',
    shortCue: '调好座椅握把平胸口，挺胸推起慢回放。',
    steps: [
      '调好座椅高度，握把与胸同高，背部紧贴靠背',
      '双手握把，肘部略低于肩，核心收紧',
      '向前推至手臂接近伸直，再缓慢受控回放至胸侧'
    ],
    cue: '重量宁轻勿重；推起时肩胛贴稳靠背、不耸肩。呼吸：推起呼气，回放吸气。',
    mistake: '重量过大导致耸肩、弓背，或回放过快撞击配重。',
    mediaLabel: '固定轨迹安全推胸'
  },
  '0579': {
    id: '0579',
    name: '高位下拉机',
    gif: GUIDES_PATH + '0579.gif',
    poster: GUIDES_PATH + '0579-poster.png',
    voice: VOICE_PATH + 'work-0579.m4a',
    primary: '背阔肌',
    secondary: '肱二头肌、菱形肌',
    benefit: '强化上肢垂直拉力，对冲圆肩驼背，雕塑背部线条。',
    sideMode: 'none',
    shortCue: '大腿固定握宽于肩，沉肩引杠至上胸，慢放回。',
    steps: [
      '坐下固定大腿，握把略宽于肩，躯干微后倾',
      '肩胛骨先主动下沉，再把握把平稳拉向上胸',
      '受控回放至手臂伸直，感受背阔肌舒展'
    ],
    cue: '与推胸一推一拉相互平衡；用背带动手臂，不靠体重后甩猛拉。呼吸：下拉呼气，回放吸气。',
    mistake: '身体大幅后仰借力、耸肩，或拉到颈后。',
    mediaLabel: '改善含胸圆肩'
  },
  '0588': {
    id: '0588',
    name: '坐姿划船机',
    gif: GUIDES_PATH + '0588.gif',
    poster: GUIDES_PATH + '0588-poster.png',
    voice: VOICE_PATH + 'work-0588.m4a',
    primary: '背阔肌、菱形肌',
    secondary: '肱二头肌、后三角肌',
    benefit: '强化上肢水平拉力，改善含胸驼背与上背无力。',
    sideMode: 'none',
    shortCue: '胸抵靠垫或脚踩稳，肘贴身拉向腹部，夹紧后背。',
    steps: [
      '坐稳，胸口贴住靠垫或双脚踩实踏板',
      '双手握把，背部保持中立不弓背',
      '肘部贴近身体向后拉，肩胛向中间夹，再缓慢放回'
    ],
    cue: '先挺胸再拉；拉到底时停顿一下，夹紧后背。呼吸：后拉呼气，放回吸气。',
    mistake: '弓背、耸肩，或用腰部反甩把重量拉回。',
    mediaLabel: '上背拉力平衡'
  },
  '0603': {
    id: '0603',
    name: '坐姿推肩机',
    gif: GUIDES_PATH + '0603.gif',
    poster: GUIDES_PATH + '0603-poster.png',
    voice: VOICE_PATH + 'work-0603.m4a',
    primary: '三角肌前中束',
    secondary: '肱三头肌、上背稳定肌',
    benefit: '固定轨道保护下强化肩部力量，安全提升头顶取物能力。',
    sideMode: 'none',
    shortCue: '坐稳靠背握把与肩同高，沉肩向上推起，慢放下。',
    steps: [
      '调节座椅高度使握把与肩同高，背部紧贴靠背',
      '双手握把，核心收紧，沉肩不耸肩',
      '向上推起至手臂接近伸直，再缓慢受控下放至耳旁'
    ],
    cue: '坐稳靠背，下放时肘部不过度后扯，肩部锐痛立即停止。呼吸：上推呼气，下放吸气。',
    mistake: '腰部过度反拱脱离靠背、借惯性猛冲撞击配重。',
    mediaLabel: '真推肩机解剖图'
  },
  '0599': {
    id: '0599',
    name: '坐姿腿弯举机',
    gif: GUIDES_PATH + '0599.gif',
    poster: GUIDES_PATH + '0599-poster.png',
    voice: VOICE_PATH + 'work-0599.m4a',
    primary: '腘绳肌',
    secondary: '腓肠肌',
    benefit: '孤立强化大腿后侧腘绳肌，平衡腿部前后力量、保护膝关节。',
    sideMode: 'none',
    shortCue: '坐稳压板固定大腿，小腿下压向后弯，顶端慢放。',
    steps: [
      '调好靠背与大腿压板，踝垫置于跟腱上方',
      '双手扶稳把手，大腿紧贴座垫',
      '屈膝把踝垫向下向后压到底，顶端短暂停顿后缓慢放回'
    ],
    cue: '练大腿后侧，和腿举前后平衡。动作慢而稳，骨盆不离开座垫。呼吸：下压呼气，回放吸气。',
    mistake: '借惯性猛压、骨盆弹起离开座垫，或回放过快。',
    mediaLabel: '平衡腿部保护膝盖'
  },

  // === 练后与久坐拉伸（8项）===
  '1377': {
    id: '1377',
    name: '扶墙小腿拉伸',
    gif: GUIDES_PATH + '1377.gif',
    poster: GUIDES_PATH + '1377-poster.png',
    voice: VOICE_PATH + 'stretch-1377.m4a',
    primary: '腓肠肌、比目鱼肌',
    secondary: '跟腱',
    benefit: '放松小腿后侧肌肉，缓解走路与久坐后的下肢沉重感。',
    sideMode: 'half',
    shortCue: '后腿跟贴地、膝伸直，身体前倾到发紧，过半换边。',
    steps: [
      '双手扶墙，一腿在前一腿在后错步站立',
      '后腿脚跟紧贴地面、膝关节伸直',
      '身体前倾直到小腿后侧有舒展拉伸感，过半换腿'
    ],
    cue: '双手扶墙，一腿在前一腿在后，后脚跟贴地、膝伸直，身体前倾直到小腿后侧有拉伸感，过半换腿。',
    mistake: '后脚跟离地悬空，或脚尖外八字导致拉伸偏离。',
    mediaLabel: '扶墙小腿拉伸'
  },
  '1576': {
    id: '1576',
    name: '仰卧抬腿拉伸',
    gif: GUIDES_PATH + '1576.gif',
    poster: GUIDES_PATH + '1576-poster.png',
    voice: VOICE_PATH + 'stretch-1576.m4a',
    primary: '腘绳肌',
    secondary: '小腿后侧肌群',
    benefit: '仰卧舒展大腿后侧，减轻下背部紧张感。',
    sideMode: 'half',
    shortCue: '抱一条腿往胸口靠，膝可微屈，过半换另一侧。',
    steps: [
      '平躺在垫上，一腿伸直放平在地面',
      '另一腿抬起，双手抱大腿后侧轻柔拉向胸口',
      '膝盖可微屈，感受大腿后侧舒展，过半换腿'
    ],
    cue: '平躺，一腿伸直放地，另一腿抬起、双手抱大腿后侧往胸口靠，膝可微屈，换腿。',
    mistake: '强求伸直过度拉扯膝盖，或头部抬起脱离垫面。',
    mediaLabel: '大腿后侧舒展'
  },
  '1424': {
    id: '1424',
    name: '坐姿 4 字臀部拉伸',
    gif: GUIDES_PATH + '1424.gif',
    poster: GUIDES_PATH + '1424-poster.png',
    voice: VOICE_PATH + 'stretch-1424.m4a',
    primary: '臀大肌、梨状肌',
    secondary: '髋外旋肌群',
    benefit: '坐姿放松臀部深层肌群，对冲久坐造成的臀腿僵硬。',
    sideMode: 'half',
    shortCue: '坐稳跷4字，身体轻轻前倾，过半换另一侧。',
    steps: [
      '坐在稳固椅子前部，双脚平放踏实',
      '将一侧脚踝放到对侧膝盖上搭成“4”字',
      '保持挺胸，上身平直轻轻前倾，感受臀部拉伸，过半换侧'
    ],
    cue: '坐稳，一脚踝放到另一膝上成“4”字，挺胸轻轻前倾，感受臀部拉伸，换边。',
    mistake: '弓背低头，或手掌用力猛压抬起的一侧膝盖。',
    mediaLabel: '坐姿臀部松解'
  },
  '1365': {
    id: '1365',
    name: '上背撑开拉伸',
    gif: GUIDES_PATH + '1365.gif',
    poster: GUIDES_PATH + '1365-poster.png',
    voice: VOICE_PATH + 'stretch-1365.m4a',
    primary: '菱形肌、斜方肌中下部',
    secondary: '背阔肌',
    benefit: '撑开肩胛骨之间肌肉，缓解上背与肩胛骨缝酸紧。',
    sideMode: 'none',
    shortCue: '双手胸前交握向前推、含胸撑开上背。',
    steps: [
      '双脚站稳或坐直，双手在胸前十指交握',
      '双臂向前推展，下巴微收，背部微含',
      '把上背像扇面一样充分撑开，保持自然深呼吸'
    ],
    cue: '双手在胸前交握向前推、含胸，把上背撑开；或一臂横抱胸前轻压。',
    mistake: '耸肩靠近耳朵，或腰椎过度反折。',
    mediaLabel: '上背撑开'
  },
  '0669': {
    id: '0669',
    name: '肩后拉伸',
    gif: GUIDES_PATH + '0669.gif',
    poster: GUIDES_PATH + '0669-poster.png',
    voice: VOICE_PATH + 'stretch-0669.m4a',
    primary: '三角肌后束',
    secondary: '冈下肌、小圆肌',
    benefit: '放松肩关节后侧肌群，改善肩后侧紧绷与活动度。',
    sideMode: 'half',
    shortCue: '一臂横过胸前，另一手轻压靠近身体，过半换边。',
    steps: [
      '站直或坐直，一侧手臂水平横穿胸前',
      '另一手轻扶手肘外侧，轻柔向身体靠拢压紧',
      '感受肩后侧温和舒展，肩膀保持下沉，过半换边'
    ],
    cue: '一臂横过胸前，另一手轻压肘部靠近身体，肩别耸起，换边。',
    mistake: '耸肩挤压脖子，或用力猛掰肘部。',
    mediaLabel: '肩后侧放松'
  },
  '0643': {
    id: '0643',
    name: '过头三头拉伸',
    gif: GUIDES_PATH + '0643.gif',
    poster: GUIDES_PATH + '0643-poster.png',
    voice: VOICE_PATH + 'stretch-0643.m4a',
    primary: '肱三头肌',
    secondary: '背阔肌上部',
    benefit: '舒展上臂后侧与背阔肌上束，恢复上肢柔韧。',
    sideMode: 'half',
    shortCue: '一臂上举屈肘摸背，上臂后侧发紧即可，过半换边。',
    steps: [
      '站姿挺拔，一侧手臂向上举起屈肘，手心轻贴上背',
      '另一手轻扶抬起侧的肘尖，向下向内轻缓施加拉力',
      '上臂后侧有舒展拉紧感即可，肋骨不外翻，过半换边'
    ],
    cue: '一臂上举屈肘、手放到背上，感到上臂后侧被拉长就够；另一手在肘尖上轻轻下压。肋骨别外翻，换边。',
    mistake: '手臂过头压迫颈椎前倾，或腰椎过度反拱。',
    mediaLabel: '上臂后侧舒展'
  },
  '0794': {
    id: '0794',
    name: '站姿侧腰拉伸',
    gif: GUIDES_PATH + '0794.gif',
    poster: GUIDES_PATH + '0794-poster.png',
    voice: VOICE_PATH + 'stretch-0794.m4a',
    primary: '侧腰（腹斜肌）',
    secondary: '背阔肌、腰方肌',
    benefit: '拉伸身体侧链与肋间隙，舒展呼吸肌群与侧腰。',
    sideMode: 'half',
    shortCue: '一臂上举向对侧轻弯，感受侧腰拉伸，过半换边。',
    steps: [
      '双脚与肩同宽站稳，一臂向上举过头顶',
      '身体缓慢向对侧轻弯倾斜，感受侧腰到背部舒展',
      '平稳呼吸不憋气，过半换另一侧'
    ],
    cue: '一臂上举，身体向对侧轻弯，感受侧腰到背的拉伸，换边。呼吸：平稳深长呼吸。',
    mistake: '身体过度前倾或旋转，骨盆大幅外撇。',
    mediaLabel: '侧腰与背阔'
  },
  '1403': {
    id: '1403',
    name: '颈侧拉伸',
    gif: GUIDES_PATH + '1403.gif',
    poster: GUIDES_PATH + '1403-poster.png',
    voice: VOICE_PATH + 'stretch-1403.m4a',
    primary: '上斜方肌、颈侧肌群',
    secondary: '胸锁乳突肌',
    benefit: '缓解久坐低头看屏幕造成的肩颈两侧酸胀紧绷。',
    sideMode: 'half',
    shortCue: '头轻偏向一侧，肩放松下沉别用力掰，过半换边。',
    steps: [
      '端坐或站直，双肩主动自然下沉放松',
      '头缓慢偏向一侧肩膀，对侧手臂自然下垂沉肩',
      '同侧手可轻搭头顶辅助借重力，切勿硬拉，过半换边'
    ],
    cue: '头轻偏向一侧，对侧手可轻扶头，肩放松下沉，不要用力掰，换边。呼吸：深缓呼吸。',
    mistake: '用手死力硬掰颈部，或对侧肩膀跟着耸起。',
    mediaLabel: '颈侧肩颈放松'
  }
};

// 5 节固定热身（按科学顺序：全身激活 → 胸肩展开 → 腕关节 → 膝关节 → 踝关节）
var warmupMoves = [
  movesDict['3221'],
  movesDict['1167'],
  movesDict['1428'],
  movesDict['0257'],
  movesDict['1368']
];

// 五套核心课程（A/B/C 周循环 + 久坐拉伸 + 健身房固定器械）
var plans = {
  A: {
    id: 'A',
    name: '计划 A · 徒手根基',
    badge: '周循环第 1 练',
    tagline: '徒手臀腿与核心根基',
    desc: '徒手大肌群与核心稳定，椅子托底保护膝踝，零跑跳冲击。',
    gear: '靠墙稳固椅 + 垫子（纯徒手零器械）',
    moves: ['0291', '3013', '0659', '0276', '0710', '1373'],
    cooldown: ['1377', '1576', '1424', '0643', '0794']
  },
  B: {
    id: 'B',
    name: '计划 B · 哑铃塑形',
    badge: '周循环第 2 练',
    tagline: '居家哑铃推拉塑形',
    desc: '一对哑铃平衡推拉肌力，对冲久坐圆肩驼背，雕塑全身线条。',
    gear: '一对哑铃 + 靠墙稳固椅',
    moves: ['0291', '0292', '1459', '0404', '1677'],
    cooldown: ['0794', '1365', '0669', '0643', '1576']
  },
  C: {
    id: 'C',
    name: '计划 C · 核心体态',
    badge: '周循环第 3 练',
    tagline: '躯干稳定与体态强化',
    desc: '强化深层抗伸展与抗旋转核心，改善骨盆体态，提升脊柱稳定性。',
    gear: '两只水瓶/轻哑铃 + 垫子',
    moves: ['wall-plank', '2133', '3013', 'bird-dog', '0276'],
    cooldown: ['1424', '0794', '1365', '0669', '1403']
  },
  stretch: {
    id: 'stretch',
    name: '久坐全身拉伸',
    badge: '随时放松',
    tagline: '舒缓肩颈腰背与腿部紧绷',
    desc: '无需热身，直接通过 8 节经典解剖拉伸全面松解全身紧绷。',
    gear: '墙面或椅子 + 垫子（无热身，直接拉伸）',
    isScene: true,
    moves: ['1377', '1576', '1424', '1365', '0669', '0643', '0794', '1403'],
    cooldown: []
  },
  gym: {
    id: 'gym',
    name: '健身房固定器械',
    badge: '健身房课',
    tagline: '固定器械全身均衡抗阻',
    desc: '主流固定器械全坐姿靠背支撑，安全承载负荷，推拉腿全面覆盖。',
    gear: '固定器械（全坐姿靠背）',
    isScene: true,
    moves: ['2287', '0576', '0579', '0588', '0603', '0599'],
    cooldown: ['1365', '0669', '0794', '1576']
  }
};

var cycleOrder = ['A', 'B', 'C'];

// 四档科学强度（一键切换容量）
var levels = {
  recovery: {
    id: 'recovery',
    name: '恢复档',
    desc: '1 轮 · 每项 25 秒 / 休 25 秒 · 约 8~9 分钟',
    rounds: 1,
    workSec: 25,
    restSec: 25,
    warmupSec: 12,
    stretchSec: 20,
    roundBreakSec: 40
  },
  starter: {
    id: 'starter',
    name: '入门档',
    desc: '1 轮 · 每项 40 秒 / 休 25 秒 · 约 11~13 分钟',
    rounds: 1,
    workSec: 40,
    restSec: 25,
    warmupSec: 15,
    stretchSec: 26,
    roundBreakSec: 40
  },
  standard: {
    id: 'standard',
    name: '标准档',
    desc: '2 轮 · 每项 45 秒 / 休 20 秒 · 约 17~20 分钟',
    rounds: 2,
    workSec: 45,
    restSec: 20,
    warmupSec: 15,
    stretchSec: 26,
    roundBreakSec: 40
  },
  steady: {
    id: 'steady',
    name: '进阶档',
    desc: '3 轮 · 每项 50 秒 / 休 15 秒 · 约 23~27 分钟',
    rounds: 3,
    workSec: 50,
    restSec: 15,
    warmupSec: 15,
    stretchSec: 30,
    roundBreakSec: 45
  }
};

var levelOrder = ['recovery', 'starter', 'standard', 'steady'];

/**
 * 组装扁平有序的跟练步骤序列
 * @param {string} planId
 * @param {string} levelId
 * @returns {Array<Object>}
 */
function buildSessionPlan(planId, levelId){
  var plan = plans[planId] || plans.A;
  var lvl = levels[levelId] || levels.starter;
  var steps = [];

  if(planId === 'stretch'){
    // 拉伸课：无热身，3秒倒数后直接串联拉伸动作
    var firstStretch = movesDict[plan.moves[0]];
    steps.push({
      id: 'countdown-start',
      kind: 'countdown',
      seconds: 3,
      name: '准备拉伸',
      shortCue: '深呼吸，准备开始第一节拉伸',
      gif: firstStretch.gif,
      poster: firstStretch.poster,
      voice: VOICE_PATH + 'countdown-start.m4a',
      primary: firstStretch.primary,
      secondary: firstStretch.secondary,
      sideMode: 'none',
      mediaLabel: '下一动作 · ' + firstStretch.name,
      nextMove: firstStretch
    });

    for(var s = 0; s < plan.moves.length; s++){
      var sm = movesDict[plan.moves[s]];
      steps.push({
        id: 'stretch-' + sm.id,
        kind: 'stretch',
        seconds: lvl.stretchSec,
        moveId: sm.id,
        name: sm.name,
        shortCue: sm.shortCue,
        cue: sm.cue,
        gif: sm.gif,
        poster: sm.poster,
        voice: sm.voice,
        primary: sm.primary,
        secondary: sm.secondary,
        sideMode: sm.sideMode,
        mediaLabel: sm.mediaLabel
      });
    }

    return steps;
  }

  // 抗阻课（A/B/C/gym）：3秒倒数预展第1个热身 → 5节热身 → 轮次正式动作与休息 → 练后拉伸
  var firstWarmup = warmupMoves[0];
  steps.push({
    id: 'countdown-start',
    kind: 'countdown',
    seconds: 3,
    name: '准备跟练',
    shortCue: '深呼吸，准备开始热身',
    gif: firstWarmup.gif,
    poster: firstWarmup.poster,
    voice: VOICE_PATH + 'countdown-start.m4a',
    primary: firstWarmup.primary,
    secondary: firstWarmup.secondary,
    sideMode: 'none',
    mediaLabel: '下一动作 · ' + firstWarmup.name,
    nextMove: firstWarmup
  });

  // 5 节热身
  for(var w = 0; w < warmupMoves.length; w++){
    var wm = warmupMoves[w];
    steps.push({
      id: 'warmup-' + wm.id,
      kind: 'warmup',
      seconds: lvl.warmupSec,
      moveId: wm.id,
      name: wm.name,
      shortCue: wm.shortCue,
      cue: wm.cue,
      gif: wm.gif,
      poster: wm.poster,
      voice: wm.voice,
      primary: wm.primary,
      secondary: wm.secondary,
      sideMode: wm.sideMode,
      mediaLabel: wm.mediaLabel
    });
  }

  // 正式抗阻段 (work + rest/roundBreak)
  for(var r = 1; r <= lvl.rounds; r++){
    for(var m = 0; m < plan.moves.length; m++){
      var move = movesDict[plan.moves[m]];
      var isLastMoveInRound = (m === plan.moves.length - 1);
      var isLastRound = (r === lvl.rounds);

      // 正式动作
      steps.push({
        id: 'work-' + move.id + '-r' + r,
        kind: 'work',
        seconds: lvl.workSec,
        round: r,
        totalRounds: lvl.rounds,
        moveIndex: m + 1,
        totalMoves: plan.moves.length,
        moveId: move.id,
        name: move.name,
        shortCue: move.shortCue,
        cue: move.cue,
        gif: move.gif,
        poster: move.poster,
        voice: move.voice,
        primary: move.primary,
        secondary: move.secondary,
        sideMode: move.sideMode,
        mediaLabel: move.mediaLabel
      });

      // 休息步
      if(isLastMoveInRound && isLastRound){
        // 最后一轮最后一个动作之后不插多余休息，直接进入拉伸
      } else if(isLastMoveInRound){
        // 轮间大休息
        var nextRoundFirstMove = movesDict[plan.moves[0]];
        steps.push({
          id: 'round-break-r' + r,
          kind: 'roundBreak',
          seconds: lvl.roundBreakSec,
          round: r,
          totalRounds: lvl.rounds,
          name: '轮间休息',
          shortCue: '平稳调整呼吸，准备第 ' + (r + 1) + ' 轮',
          gif: nextRoundFirstMove.gif,
          poster: nextRoundFirstMove.poster,
          voice: null,
          primary: nextRoundFirstMove.primary,
          secondary: nextRoundFirstMove.secondary,
          sideMode: 'none',
          mediaLabel: '下一动作 · ' + nextRoundFirstMove.name,
          nextMove: nextRoundFirstMove
        });
      } else {
        // 普通动作间休息
        var nextMoveInRound = movesDict[plan.moves[m + 1]];
        steps.push({
          id: 'rest-r' + r + '-' + m,
          kind: 'rest',
          seconds: lvl.restSec,
          round: r,
          totalRounds: lvl.rounds,
          name: '休息',
          shortCue: '调整呼吸，下一动作 · ' + nextMoveInRound.name,
          gif: nextMoveInRound.gif,
          poster: nextMoveInRound.poster,
          voice: null,
          primary: nextMoveInRound.primary,
          secondary: nextMoveInRound.secondary,
          sideMode: 'none',
          mediaLabel: '下一动作 · ' + nextMoveInRound.name,
          nextMove: nextMoveInRound
        });
      }
    }
  }

  // 练后拉伸
  for(var c = 0; c < plan.cooldown.length; c++){
    var cm = movesDict[plan.cooldown[c]];
    steps.push({
      id: 'stretch-' + cm.id,
      kind: 'stretch',
      seconds: lvl.stretchSec,
      moveId: cm.id,
      name: cm.name,
      shortCue: cm.shortCue,
      cue: cm.cue,
      gif: cm.gif,
      poster: cm.poster,
      voice: cm.voice,
      primary: cm.primary,
      secondary: cm.secondary,
      sideMode: cm.sideMode,
      mediaLabel: cm.mediaLabel
    });
  }

  return steps;
}

window.QDK_CONTENT = {
  movesDict: movesDict,
  warmupMoves: warmupMoves,
  plans: plans,
  cycleOrder: cycleOrder,
  levels: levels,
  levelOrder: levelOrder,
  buildSessionPlan: buildSessionPlan
};

})();
