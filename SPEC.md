# SPEC · 轻打卡：轻活动习惯与作息

更新：2026-11-05。本文是新版产品与验收契约，不是实现完成证明。新版已于 2026-11-05 获授权发布；运行与验证状态见 [docs/VALIDATION.md](docs/VALIDATION.md)，依据见 [docs/RESEARCH.md](docs/RESEARCH.md)。

## 1. 产品原则

1. **容易开始，也能放心停止。** 用日常事件承接一个小行动；允许学习、暂停、提前结束和休息，不追次数、连胜或补课。
2. **先处理症状。** 急症先求助，痛风发作、疑似发作或不适先停止；不通过换姿势继续，也不把安全勾选解释为医疗评估。
3. **只记事实。** 活动计时、主动填写的起床时间、收尾标记和主观感受分别保存；未记录不等于未做到，不生成睡眠分数或推算睡眠时长。
4. **自主选择，不自动加量。** 1／3／5 分钟是含休息的产品安排，不是专业机构核定的运动剂量；不按记录自动加时、加速或加重。
5. **本地、最少数据、从零开始。** 纯静态 PWA，无账号、业务后端、云同步或分析追踪；不设置蛋白／饮水目标，不收集体重或个人病史。不提供旧数据迁移、兼容导入或旧数据导出，保留新版备份与恢复。
6. **诚实表达能力。** 不是治疗或康复工具，不承诺减重、改善疾病或养成习惯；来源引用、自动化通过、专业校对和真机通过是不同的证据。

## 2. 用户流程

| 页面 | 核心行为 |
| --- | --- |
| 今天 | 选择活动或晚间收尾作为重点；处理未完成回合；记录实际起床、收尾、活动间隙与休息；可补充活动后的恢复感受 |
| 动一点 | 先看动作与示意，自选时长和坐／站模式；每次开始或恢复前确认身体与环境；随时暂停、跳过、结束或因不适停止 |
| 作息 | 设置可不填的起床锚点和收尾计划时间；提供简短安静收尾提示，可次日补记；不把计划时间当成入睡截止时间 |
| 回顾 | 近 7 天记录概览、实际活动与感受、作息更正、误记删除、新版备份恢复及离线更新状态 |

长期缺少活动或存在关节、平衡、呼吸方面顾虑时先咨询专业人员。站姿仅供站立和走路无痛且稳定时主动选择；坐姿也需合适、稳定、无轮的椅子及安全环境。

胸痛、严重呼吸困难、晕厥等提示立即停止并寻求当地急救，不以完成记录为前提。关节突发肿痛加重或伴发热等需及时医疗评估。持续睡眠困难、憋醒、被观察到呼吸停止或明显日间困倦应提示专业评估，不用作息打卡代替治疗。

iPhone 提醒由用户在系统「时钟」「提醒事项」中设置。应用不创建系统闹钟、不承诺后台准点通知；晚间收尾不要求睡前打开屏幕。当前音频能力仅为可关闭的回合提示音，无语音指导。

## 3. 回合与计时

`courseId` 为 `minute`／`gentle`／`steady`；`mode` 为 `seated`／`standing`。一份计划保持同一种模式，阶段为 `prepare → (move → rest) × 回合数 → settle`。

| 课程 | 准备 | 每回合活动／休息 | 回合数 | 收尾 | 流程总时长 | 计划活动上限 |
| --- | --- | --- | --- | --- | --- | --- |
| `minute` | 15 秒 | 20／15 秒 | 1 | 10 秒 | 60 秒 | 20 秒 |
| `gentle` | 20 秒 | 20／15 秒 | 4 | 20 秒 | 180 秒 | 80 秒 |
| `steady` | 25 秒 | 20／15 秒 | 7 | 30 秒 | 300 秒 | 140 秒 |

坐姿内容为轻柔动臂、小幅开胸、轻抬膝、温和转头；站姿为放松肩膀和室内慢走。文字、示意与注意事项对应同一动作；示意不代表必须达到的角度或幅度。

- `elapsedSeconds` 是可信运行片段的流程累计，包含准备、休息与收尾；不是起止时间戳相减。
- `activeSeconds` 只在 `kind === 'move'` 时累计，且不大于 `elapsedSeconds`。不计暂停、后台、跳过的剩余时间或未做部分；只看图、记休息和记活动间隙不产生活动秒数。
- 计时反映应用运行，不验证身体是否实际运动，也不折算热量或中等强度运动达标量。
- 状态为 `ready`／`running`／`paused`／`done`。开始必须主动触发；跳过或提前结束只保留已经累计的时间，不冒充自然完成。
- 页面隐藏时暂停；计时间隔超过 2 秒、时钟回拨或无效时也暂停，整段异常间隔不补计。
- 步骤／状态变化、暂停及运行中约每 3 秒保存 checkpoint。恢复有效的未完成快照一律先为 `paused`，`done` 保持待保存；恢复本身不启动计时。强制关闭可能丢失最近未落盘片段。
- `planKey` 是有序 `[id, kind, seconds]` 数组的 JSON 签名；计划不匹配时不把旧 checkpoint 套入新步骤，可保留已经做过的部分。保存失败保留待保存状态，重试不重复追加记录。

## 4. 模块 API

以下列出新版使用的接口；接口存在不表示整页集成已经验收。

| 模块 | API 与职责 |
| --- | --- |
| `QDK_CONTENT` | `courses`、`modes`、`moves`、`safety`、`habits`、`sleep`、`sources`、`mediaNote`；`buildPlan(courseId, mode)` 返回步骤，未知选择抛错；`activeSeconds(plan)` 返回计划活动上限，不是实绩 |
| `QDK_SESSION` | `create({plan, snapshot?, now?, schedule?, cancel?, onChange?, onFinish?})` 返回 `start()`、`pause()`、`next()`、`finish()`、`get()`、`destroy()`；只负责计时，创建／恢复不自动开跑，不读写存储 |
| `QDK_STORE` | 异步 `load()`、`transact(mutator)`、`exportData()`、`importData(object)`、`reset()`；同步 `get()` 返回独立状态副本，`subscribe(fn)` 返回取消订阅函数，`exportRaw()` 导出新版原文用于救援 |
| `app.js` | 组织页面、安全确认、单回合锁、checkpoint、感受与恢复记录、提示音、导入确认及更新提示 |
| `sw.js` | `OFFLINE_STATUS` 返回 `ready`、`courseReady`、`version`；收到 `ACTIVATE_UPDATE` 后在资源完整的前提下激活已下载更新 |

`content.buildPlan()` 的无参默认值为 `gentle`／`seated`；当前首页与初始 UI 选择为 `minute`／`seated`。显式选择由 UI 传入，不把两者混为同一个默认行为。

计时模块 `now()`／调度参数以毫秒为单位，快照中的 `left`、累计时间及 `updatedAt` 以秒为单位。持久化层的时间戳统一为毫秒，由 `app.js` 在 checkpoint 边界转换。销毁计时器不结算时间，需要保存最后一段时先暂停。

## 5. 新版数据契约

唯一业务数据键为 `qingdaka-habits-v1`，值是一份 JSON：

```json
{
  "version": 1,
  "revision": 0,
  "updatedAt": 0,
  "settings": {
    "onboarded": false,
    "wakeTime": "",
    "windDownTime": "",
    "anchor": "lunch",
    "focus": "move",
    "sound": true,
    "motion": true
  },
  "days": {},
  "sessions": [],
  "activeSession": null
}
```

- `revision` 与顶层 `updatedAt` 由 store 管理，调用方不得修改。写入成功后才更新已提交状态并通知订阅者。
- `settings`：时间为 `HH:MM` 或空字符串；UI 的 `anchor` 选项为 `lunch/work/home`，`focus` 为 `move/sleep`，store 对两者校验非空字符串。`motion` 是现有 schema 字段，不代表当前设置页提供动画开关。
- `days[YYYY-MM-DD]`：可含 `wakeTime`（实际起床，`HH:MM`）、`windDown`（布尔标记）、`breaks`（非负整数）、`rest`（布尔标记）、`updatedAt`（毫秒）；schema 另允许可选字符串 `note`，当前 UI 无备注输入。空白记录不自动推断为未活动或睡眠不足。
- `sessions[]`：必含 `id`、`date`、`startedAt`、`endedAt`、`courseId`、`mode`、`plannedSeconds`、`activeSeconds`、`elapsedSeconds`、`status`、`feedback`、`recovery`。`id` 唯一；时间戳为毫秒，时长为非负有限秒数，可有小数。`date` 按回合开始时的本地日期记录，结束不早于开始。
- `status`：`completed`（自然走完）、`partial`（跳过部分）、`stopped`（提前结束）；是否计为有活动还须检查 `activeSeconds > 0`。`feedback` 为 `easy/okay/hard/discomfort/unknown`，`recovery` 为 `good/tired/pain/unknown`，不选择时保留 `unknown`。
- `activeSession`：为 `null` 或包含 `id/courseId/mode/startedAt/phase/stepIndex/left/elapsedSeconds/activeSeconds/updatedAt/planKey` 的本机快照。store 校验字段与范围，session 再校验签名和进度是否匹配计划。

### 提交与恢复

所有业务写入走 `transact`。读写排队，优先使用 Web Locks；没有 Web Locks 时 store 可用空 IndexedDB 对象仓库作为比较并写入的互斥门，不存业务数据或数据镜像。没有可用安全机制则拒绝写入；冲突不静默合并、不自动重试覆盖。UI 启动回合另外要求 Web Locks，不能取得单回合锁时不启动计时。

字段、版本、日期、枚举及重复记录需通过校验，未知字段拒绝。损坏 JSON、未知版本、存储不可用或配额失败不以空状态覆盖原文，也不报告保存成功。提供新版原文导出，再由用户决定恢复或清空。

新版便携备份为 `{format: 'qingdaka-habits', exportedAt: ISO时间, state}`，`exportedAt` 带时区。导出副本的 `activeSession` 必须为 `null`，不删除本机 checkpoint；导入拒绝携带未完成回合的备份。上限 20 MiB（UTF-8 JSON），完整校验后明确确认覆盖，不合并；导入／清空前处理未完成活动。跨设备只通过用户主动保存与导入新版备份，不提供自动同步。

## 6. 离线与发布契约

生产包白名单为核心 HTML／CSS／JS、manifest、`.nojekyll`、允许的 `icons/` 图标和 `assets/habit-guides/` 自包含 SVG。文档、测试、开发脚本、依赖及其他资源不进入 `dist/`；白名单外的旧产物在成功重建时清除。

构建先校验再替换产物，按内容生成版本及文件 hash；SW 只在整套资源下载并验证完成后提供更新。缓存按 scope 隔离，失败更新不破坏可用版本；当前页面在用户确认且无未处理活动／表单后才切换。离线就绪是缓存状态，不是永久保存承诺。

GitHub Pages 发布使用 `gh-pages` 上的 `dist/`；本次已获用户授权发布。后续部署仍需用户授权，测试通过或文档更新本身不构成发布授权。

## 7. 验收条件

| 领域 | 必须观察到的结果 |
| --- | --- |
| 安全与选择 | 急症／不适／发作入口停止流程；坐站不自动互换；学习与停止入口清晰；不会鼓励忍痛或补量 |
| 内容与时长 | 六种课程／模式组合总时长精确为 60／180／300 秒；示意与步骤一致；只有 `move` 累计活动；没有自动加重或强制进阶 |
| 中断与保存 | 暂停、锁屏、切应用、刷新、进程回收后不补计；有效未完成快照先恢复为 `paused`；失败可重试，重复操作不重复记账 |
| 作息 | 手填实际时间、可补记更正；无睡眠分数或推算时长；不把网页计划误称为系统提醒 |
| 数据 | 新版导出→确认清空→导入可还原持久记录；无效文件／并发／配额失败保留原数据；不提供旧数据迁移或导出入口 |
| 离线与更新 | HTTPS 首装完整缓存、断网重开、资源缺失提示、失败更新保护与显式接受更新均可复现；发布包精确符合白名单 |
| 证据 | README 中的模块、源码 E2E、构建和产物 E2E 分别有实际结果；iPhone Safari／主屏真机、专业内容校对及实际使用验证另行记录，不相互替代 |

以上是待满足的门槛，不是“已通过”列表。下一步优先级见 [BACKLOG.md](BACKLOG.md)。
