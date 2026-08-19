# 轻打卡 v6 · 语音改造 交接文档

> 接手日期：2026-08-05
> 项目：/Users/derekfly3/Documents/轻打卡v6（纯静态网页，部署在 Netlify）
> 给谁看：任何接手排查"试听没声音"问题的 AI / 工程师

---

## 1. 任务背景

**用户原始诉求**：把项目里女声 Web Speech TTS（系统默认机械女声）换成**好听 + 年轻 + 性感**的女声。

**项目性质**：纯静态网页（模拟 App），不是 React Native / Flutter 那种原生 App。用浏览器跑，部署到 Netlify。原始语音方案：浏览器原生 `window.speechSynthesis`（Web Speech API），根据用户系统里装的中文女声自动选。

**为什么 Web Speech 不行**：
1. 用户设备的 iOS Safari/微信内置 WebView 没有微软神经女声（晓晓/晓梦），只能用 Tingting/美佳（经典机械合成）
2. 之前调过 pitch/rate 缓解，但用户反馈"还是很机械"

**最终方案**：用云端神经 TTS（MiniMax `female-yujie` 御姐音色）预生成 46 个 mp3 替换 Web Speech。

---

## 2. 当前部署状态

| 项 | 值 |
|---|---|
| Netlify production URL | `https://qingdaka-workbuddy-v6.netlify.app` |
| Netlify siteId | `c592b655-be54-49cc-8d2f-c8171e11f116` |
| Service Worker version | `v28-voice-m4a-yujie`（**用户可能还是 v25–v27，需硬刷**） |
| 本地 dev server | `python3 serve.py 12000 --lan`（PID 7767，端口 12000） |
| 部署 CLI | `netlify` 已登录（用户 `Zonglin Xie`） |

---

## 3. 已做的改动（清单）

### 3.1 新增文件

**`assets/voice/*.mp3`** — 46 个 mp3 文件，总 4.7M
- 5 鼓励语（encourage-1~5）
- 6 静态（switch-side / countdown-3 / countdown-start / finish-done / finish-stretch / finish-early）
- 5 热身（warmup-3221/1368/0257/1428/1167）
- 20 训练动作（work-3013/0276/0710/0659/1373/3239/0292/0404/1677/1459/0291/2287/0576/0579/0585/0603/0588/0596/0599/0017）
- 10 拉伸（stretch-1271/1365/1377/1403/1424/1576/quad-stand/0643/0794/0669）

**生成参数**：所有 mp3 用同一个 voice_id `female-yujie`（御姐音色），speed 0.95，emotion happy（鼓励/倒计时/完成）或 neutral（动作名/拉伸）。**生成后再用 ffmpeg 转码**成 44100Hz/立体声/128kbps CBR（**关键**：原始生成的是 32kHz/单声道，iOS WebView 拒收）。

**`assets/voice-samples/A-御姐音色.mp3`** — 试听样本（御姐音色参考）

**`scripts/extract-voice-scripts.js`** — 从 `app.js` 提取所有要合成的句子到 `voice-scripts.json`

**`scripts/transcode-ios.sh`** — 遍历 `assets/voice/*.mp3`，全部用 ffmpeg 转成 44100Hz/立体声/128kbps CBR

### 3.2 改动文件

**`app.js`**：
- **~666 行起** 加 `VOICE_BASE = 'assets/voice/'` + `VOICE_FILES` 字典（46 个 key→filename）
- 加 `ensureVoiceAudio()` + `playVoiceMp3(key)` 函数
  - **关键**：每次 `new Audio()`，**不复用**单例（iOS 上单例切换 src 会卡）
  - 加 `playsinline` / `webkit-playsinline`
  - 失败时 `showToast` 弹错误名 + `console.warn`
- `speak(text, opts)` 函数改造：
  - 优先 `opts.mp3Key` 查 `VOICE_FILES` 播 mp3
  - 找不到回退 Web Speech（兜底）
- `speakEncourage()` 改用 `mp3Key: 'encourage-' + 随机 1~5`
- `announceStep(step)` 改用 `work-{id}` / `warmup-{id}` / `stretch-{id}` 查 mp3
- 静态调用点（`switch-side` / `countdown-3` / `countdown-start` / 完成）改用 mp3Key
- 试听按钮（`btnVoicePreview`）改播 `encourage-1` mp3
- `VOICE_PREFERRED` 数组简化到只剩 `['Tingting','婷婷']`（一个占位，实际用 mp3）

**`sw.js`**：
- VERSION 从 `v24-gym-text` 升到 `v27-voice-full-yujie`
- 加 `VOICE_KEYS` 列表（46 个）+ `VOICE_FILES` 数组（46 个相对路径）
- install 阶段把 46 个 mp3 全部预缓存（`files.concat(ASSET_FILES, VOICE_FILES)`）

### 3.3 部署

最近 3 次部署：
1. `v25-voice-yujie`：初次部署 46 个 mp3（32kHz 单声道）→ 用户反映微信里 NotSupportedError
2. `v26-voice-mini`：误改，删了 43 个 mp3 留 3 个（**已被回滚**）
3. `v27-voice-full-yujie`：回滚 46 个 mp3 + ffmpeg 转码 44.1kHz/立体声

---

## 4. 关键代码引用

### 4.1 playVoiceMp3（`app.js` ~690 行）

```js
function playVoiceMp3(key){
  var fn = VOICE_FILES[key];
  if(!fn){ return false; }
  var url = VOICE_BASE + fn;
  if('speechSynthesis' in window){ try{ window.speechSynthesis.cancel(); }catch(e){} }
  var a;
  try { a = new Audio(); } catch(e){ return false; }
  a.preload = 'auto';
  a.setAttribute('playsinline','');
  a.setAttribute('webkit-playsinline','');
  a.src = url;
  try {
    var p = a.play();
    if(p && p.catch){
      p.catch(function(err){
        var msg = (err && err.name) ? ('音频播放失败：' + err.name) : '音频播放失败';
        try{ showToast && showToast(msg, 'error'); }catch(e){}
        console.warn('[voice] play failed', err, url);
      });
    }
    return true;
  } catch(e){
    try{ showToast && showToast('音频播放出错', 'error'); }catch(_){}
    return false;
  }
}
```

### 4.2 speak（`app.js` ~720 行）

```js
function speak(text, opts){
  if(!voiceEnabled()){ return; }
  opts = opts || {};
  if(opts.mp3Key && playVoiceMp3(opts.mp3Key)){ return; }  // 优先 mp3
  if(!('speechSynthesis' in window)){ return; }
  // ... 兜底 Web Speech ...
}
```

---

## 5. ⚠️ 当前未解决的问题（核心）

### 5.1 用户反馈
- **设备**：iPhone（5G 网络，60% 电量，从截图看是 iOS 16+）
- **浏览器**：**微信内置浏览器**（不是 Safari，从截图的微信导航栏看出来）
- **症状**：进入「我的 → 语音音色」→ 点「试听」按钮 → 弹出 toast：**"音频播放失败：NotSupportedError"**
- **持续性**：v25（32kHz）、v27（44.1kHz 立体声）**都报同样错**

### 5.2 已尝试的修复
| # | 方案 | 结果 |
|---|---|---|
| 1 | Web Speech 调 pitch=1.10/rate=0.95 | 用户说"还是很机械" |
| 2 | 加 4 个候选音色让用户选 | 用户嫌多，简化到 1 个 |
| 3 | 云端 TTS 预生成 46 个 mp3 | 32kHz 单声道 → NotSupportedError |
| 4 | ffmpeg 转码 44.1kHz/立体声 | **未验证是否解决**（用户说"还是不行"后直接要交接文档） |
| 5 | new Audio() 加 playsinline + 失败 toast | **未在用户环境验证** |

### 5.3 已排除的原因
- ✅ mp3 文件本身能下载（curl 测 200 OK）
- ✅ Netlify 部署正常
- ✅ mp3 格式已转成 iOS 标准（44100Hz/立体声/CBR）
- ✅ HTTPS 部署（无 mixed content）

### 5.4 未排查的方向（接手的人重点查）

| 方向 | 说明 |
|---|---|
| **A. iOS 微信 WebView 的 `<audio>.play()` 限制** | 微信 iOS 用 WKWebView + 微信 X5 bridge，可能对 autoplay / media source 有特殊限制。NotSupportedError 在 iOS WebKit 通常是 source 不被识别 |
| **B. Service Worker 缓存是否提供正确 Content-Type** | SW 拦截后 `Response` 默认没有 `Content-Type: audio/mpeg`，iOS WebView 可能因此拒收。建议在 SW 拦截时强制 set header |
| **C. m4a/aac 替代 mp3** | iOS 原生更友好 AAC 格式，可以试 `ffmpeg -i in.mp3 -c:a aac -b:a 128k out.m4a` |
| **D. SW network-only 兜底** | 临时绕过 SW 缓存测试：`fetch(req, {cache: 'no-store'})` 强制网络 |
| **E. 跨域 / crossOrigin 属性** | 同源应该不需要，但加 `a.crossOrigin = 'anonymous'` 试试 |
| **F. 用户是否真的硬刷了** | 让用户 iOS Safari → 设置 → Safari → 清除历史记录与网站数据，**彻底**清掉 v25/v26 的 SW |
| **G. 微信里用 `<a href="...mp3" download>` 让用户点下载** | 兜底方案，让用户先确认 mp3 在微信里能下载 |
| **H. AudioContext 解锁** | 微信 WebView 首次播放需要 user gesture chain 完整，但用户是点击按钮应该满足 |

### 5.5 关键用户限制
- **用户明确说"我没办法连同一 WI-FI"** → 不能用 `192.168.1.108:12000` 内网方案
- **用户可能不愿用 Safari**（截图是微信）→ 需要给出**微信内可用**的方案
- 用户要"1 个音色（御姐）+ 46 个 mp3 全部" → **不要再动音色数和 mp3 数量**

---

## 6. 关键文件清单

```
/Users/derekfly3/Documents/轻打卡v6/
├── app.js                          # 主逻辑；speak/playVoiceMp3/VOICE_FILES
├── sw.js                           # Service Worker，VERSION=v27
├── index.html                      # 主页面
├── styles.css
├── netlify.toml                    # Netlify 配置
├── serve.py                        # 本地 dev server (PID 7767, port 12000)
├── HANDOVER.md                     # ← 本文档
├── assets/
│   ├── voice/                      # 46 个 mp3，4.7M
│   │   ├── encourage-1.mp3 ... encourage-5.mp3
│   │   ├── switch-side.mp3
│   │   ├── countdown-3.mp3
│   │   ├── countdown-start.mp3
│   │   ├── finish-done.mp3
│   │   ├── finish-stretch.mp3
│   │   ├── finish-early.mp3
│   │   ├── warmup-3221.mp3, warmup-1368.mp3, warmup-0257.mp3,
│   │   │   warmup-1428.mp3, warmup-1167.mp3
│   │   ├── work-3013.mp3 ... (20 个 work-*.mp3)
│   │   └── stretch-1271.mp3 ... (10 个 stretch-*.mp3)
│   ├── voice-samples/
│   │   └── A-御姐音色.mp3          # 试听样本（参考用）
│   └── exercise-guides/            # 原动作图片
└── scripts/
    ├── extract-voice-scripts.js    # 提取 app.js 里要合成的句子
    └── transcode-ios.sh            # mp3 转 iOS 兼容（44100Hz/立体声）
```

---

## 7. 调试 / 复现步骤

### 7.1 直链测试 mp3

```bash
# 测 44.1kHz 立体声 mp3 是否真在 CDN 上
curl -I https://qingdaka-workbuddy-v6.netlify.app/assets/voice/encourage-1.mp3
# 期望：HTTP 200，Content-Type: audio/mpeg，Content-Length ~49KB

# 测本地服务
curl -I http://127.0.0.1:12000/assets/voice/encourage-1.mp3
```

### 7.2 让用户用 Safari 调试

iOS Safari → 设置 → 高级 → Web 检查器 → 打开 Safari 访问 URL → Mac Safari 菜单"开发"→ 选 iPhone → 看 console 日志（找 `[voice] play failed`）

### 7.3 完全重置 SW 缓存

让用户在 Safari 打开 URL → 设置 → Safari → 清除历史记录与网站数据
（注意：这会清掉所有网站数据，包括用户的训练记录 localStorage。**先告诉用户**）

### 7.4 重新合成所有 mp3（如果要换音色 / 调参数）

```bash
cd /Users/derekfly3/Documents/轻打卡v6

# 1. 提取要合成的句子
node scripts/extract-voice-scripts.js

# 2. 切成 5 批
python3 -c "
import json
items = json.load(open('voice-scripts.json'))
for i, j in enumerate(range(0, len(items), 10)):
    with open(f'voice-batch-{i+1}.json', 'w', encoding='utf-8') as f:
        json.dump(items[j:j+10], f, ensure_ascii=False, indent=2)
"

# 3. 跑 5 批 batch_synthesize_speech（每批改 voice_id/speed/emotion）
#    output: assets/voice/{key}.mp3

# 4. iOS 转码
bash scripts/transcode-ios.sh

# 5. 升 SW VERSION 重新部署
#    改 sw.js 的 VERSION = 'v28-...'
netlify deploy --prod --dir=. --message="..."
```

### 7.5 mp3 → m4a（如果接手的人想试 AAC 格式）

```bash
cd /Users/derekfly3/Documents/轻打卡v6/assets/voice
for f in *.mp3; do
  ffmpeg -y -i "$f" -c:a aac -b:a 128k "${f%.mp3}.m4a" -loglevel error
done
# 然后改 app.js 里 VOICE_FILES 的扩展名为 .m4a
```

---

## 8. 推荐接手顺序

1. **先看 5.4 节"未排查的方向"** — 5 个可能原因按概率排序
2. **优先试 B（SW Content-Type）+ C（m4a 替代）** — 最可能快速解决
3. **如果还不行试 E（crossOrigin）+ H（AudioContext）** — 深水区
4. **最后兜底：让用户用 Safari 打开** — 虽然用户说不想，但 NotSupportedError 在微信 WebView 上是已知坑

---

## 9. 关键决策记录（为什么这么做）

- **为什么选 female-yujie（御姐）**：用户要求"好听 + 年轻 + 性感"，御姐 = 20-30 岁的姐姐感，成熟但仍年轻，最"撩"。备选 female-shaonv（少女）太天真，wumei_yujie（妩媚御姐）太撩
- **为什么 46 个 mp3 全部覆盖**：用户原话"动作名这些都得要"，且每个动作名 + 第一句 cue 是固定文本（"接下来，臀桥。肋骨不要外翻..."），可以一次性预合成
- **为什么不用 Web Speech 实时合成**：用户设备/浏览器的系统 TTS 没有高质量神经女声，且微信 WebView 内 Web Speech 行为不可预期
- **为什么 ffmpeg 转码**：原始 32kHz/单声道是云端 TTS 默认输出，iOS WebView（特别是微信 X5）严格拒收
- **为什么 SW VERSION 升到 v27**：触发新 SW install 阶段预下载 46 个 mp3，避免 SW 拦截时的兼容问题
- **为什么 VOICE_PREFERRED 只剩 1 个**：用户原话"1 个音色"，实际全走 mp3，这只是兜底

---

## 10. 联系人

- 用户：Zonglin Xie（个人散户投资者，做轻打卡 v6 这个项目）
- 已尝试：5 轮方案，最后用户要交接文档
- 用户当前情绪：被这个弄烦了，希望快速解决。**接手时优先出可工作版本，不要再做大改动**

---

**TL;DR（2026-08-05 已修 v29）**：**真正根因是 CSP**：`default-src 'none'` 且缺少 `media-src`，浏览器直接禁止加载音频 → `NotSupportedError` / 没声音。已加 `media-src 'self' blob: data;`，并保留 m4a + Web Audio 兜底。请用户微信里**关掉页面再打开**后试听。
