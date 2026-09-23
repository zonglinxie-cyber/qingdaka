# 轻打卡 · 部署与运行说明

纯静态网页（PWA），数据全部存在手机浏览器本地，无账号、无后端。

## 本地运行

### 方式一：`serve.py`（推荐，默认 8899）

```bash
python3 serve.py        # http://127.0.0.1:8899/index.html（仅本机）
python3 serve.py --lan  # 0.0.0.0，手机同 Wi‑Fi 可访问
./scripts/dev.sh        # 同上，等价 python3 serve.py
```

多线程静态文件服务，仅此而已。

### 方式二：`npx serve`

不要用裸 `python -m http.server`（没有 `serve.json` 的缓存/压缩配置）。

```bash
npx serve .
```

默认 http://localhost:3000。

### 手机同 Wi-Fi 扫码打开（无账号，不是登录）

1. 电脑在项目目录执行：`python3 serve.py --lan`（默认端口 **8899**，不是 8080）。
2. 终端会打印 `http://192.168.x.x:8899/index.html`；若已 `pip install 'qrcode[pil]'`，会额外生成 **`mobile-qr.png`**，用微信/相机扫这个图即可。
3. 也可手动运行：`python3 scripts/mobile_qr.py 8899`
4. 手机必须与电脑 **同一 Wi-Fi**；电脑休眠或关服务后手机打不开。
5. 数据仍在 **手机浏览器本机**，与电脑不自动同步；换机请用「我的 → 导出备份」。

旧二维码若写的是 `:8080` 或别的 IP，需要按当前 IP 和 **8899** 重新生成。

### 手机与电脑不在同一 Wi‑Fi（4G / 公司网 / 外出）

局域网二维码 **无效**。用 **HTTPS 公网地址**（电脑可关机）：

- 生产站点：**https://zonglinxie-cyber.github.io/qingdaka/**
- 手机浏览器打开后 → **添加到主屏幕**。
- 更新代码后运行 `npm run deploy`；构建自动按代码和素材生成缓存版本（只 `git push` main 不会更新生产站）。已安装用户在「我的」确认更新。

临时方案（电脑必须开着）：`cloudflared tunnel --url http://127.0.0.1:8899`，用手机打开终端里出现的 `https://….trycloudflare.com`（每次链接可能变）。

### 单元测试

浏览器打开 `test.html`（须通过 HTTP，不能 `file://`）：

```
http://localhost:8899/test.html
```

无头跑：

```bash
npm ci
npx playwright install chromium
npm run test:e2e
npm run test:reliability
```

`test:e2e` 自动启动随机端口的本机服务和临时浏览器，结束后清理；不读取日常浏览器记录。也可用 `TEST_BASE_URL=http://127.0.0.1:8951` 指定服务，测试会先确认是本项目。本机没装 Playwright 自带浏览器时，用 `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` 走系统 Chrome。

发布产物构建到 `dist/`，只含运行时前端文件、`assets/`、`icons/` 与 `voice-scripts.json`。交接文档、测试和本地脚本不会进公开站点：

```bash
npm run build
npm run check:dist
TEST_UNIT_PAGE=0 npm run test:e2e
```

## 生产部署

**唯一生产：GitHub Pages** —— https://zonglinxie-cyber.github.io/qingdaka/

站点发的是 `gh-pages` 分支上的 `dist/`，不是 `main` 仓库根目录。本机 GitHub token 没有 `workflow` 权限，所以没有 Actions 代构建。发布命令：

```bash
npm run deploy
```

- **只 `git push` main 不会更新生产站。**
- `build` 按发布文件的 SHA-256 生成 SW 版本，无需手动加版本号。应用核心文件和预录语音全部下载成功后才提供更新；正在跟练时先结束记录。
- 仓库仍公开，源码在 GitHub 上可读；Pages 上不再挂 `HANDOVER.md` / `serve.py` / `test.html`。别往仓库里放任何密钥。
- `serve.json` 只作用于本地 `npx serve`，生产用 Pages 自己的 `max-age=600`。

`serve.json` 的缓存策略：
- `sw.js` / `index.html` / `app.js` / `content.js` / `styles.css` → `no-cache`
- `assets/**` 和 `icons/**` → `immutable` 一年（动图/图标不变，长期缓存省流量）

## 文件结构

```
index.html            页面结构（无内联脚本/样式）
styles.css            全部样式（含暗色模式、reduced-motion）
app.js                页面、记录、训练、存储逻辑（IIFE）
content.js            动作、课程、档位、热身与拉伸内容
sw.js                 Service Worker（离线缓存 + 运行时缓存裁剪）
serve.py              本地静态文件服务器
manifest.webmanifest  PWA 清单
test.html             单元测试页
serve.json            npx serve 的缓存/压缩配置
mobile-qr.png         --lan 时可选生成（pip install qrcode[pil]）
scripts/              构建、校验、发布（deploy-pages）、开发辅助脚本
assets/               动作示范动图、姿势图、语音 m4a
icons/                应用图标
```

## 记录与离线更新

当前页面按日常操作重排：

- 「今天」默认只展示蛋白、喝水、跟练；体重、走路、饮食习惯在「更多记录」。
- 「记蛋白」默认只填克数；食物名、餐次可选，常用食物也从这个弹层记入。
- 「跟练」先显示当前课程与开始按钮，直接开始；课程/强度、动作示范按需展开，完整安排可单独查看。
- 默认「徒手基础」在训练页平铺今天的动作顺序、每个动作时长与轮数；跟练界面以示范为主，倒计时缩到一角，只留一句短口令、下一个动作和暂停。
- 「回顾」默认三个指标与蛋白图，其余历史分组展开；「我的」默认两个每日目标，其余设置按需展开。

- 写入操作排队，只写一份 `localStorage` JSON；失败保留原状态并提示，不假装成功。
- 日志不再有 3,000 条上限，体重记录不再静默截断。数据页可按月查看、翻页、导出；月度文件用于查阅，完整迁移仍用「我的 → 导出备份」。浏览器可用空间仍有限，需定期把备份保存在浏览器外。
- 导入先显示记录数量和日期范围，确认后覆盖；不完整或含无效记录的文件会被拒绝。旧 v4/v5 备份与历史拍照记录继续兼容。
- 「7天日均已记录蛋白」按 7 天计算，另列有记录天数，未记录不表示未摄入。
- 应用和当前课程预录音频完整下载后显示离线就绪；示范图按联网浏览缓存。更新保留已缓存示范，确认后才切换版本。

## 内容与语音维护

动作说明集中在 `content.js`。扶椅坐站在所有课程都用项目自制的分步示意图（`chair-stand-steps.svg`），持铃示范只留给居家哑铃课；墙面斜板支撑使用静态图；坐姿毛巾划船、站姿股四头拉伸撤下不匹配示范，保留文字指导。毛巾划船、墙面斜板、农夫行走、鸟狗式没有预录，跟练时静音。

生成新语音需本机 MiniMax CLI 登录与 ffmpeg；运行时没有 API Key 或外部模型请求。过期交接文档在 `docs/archive/`，不要当作当前规格。

```bash
npm run voice:prepare   # 对照实际课程生成 voice-pending.json
npm run voice:generate  # 已登录 mmx 时生成 female-yujie，试听后再发布
```

生成脚本仅在四段全部生成成功后更新清单，替换四段已退出课程的旧语音；`check:dist` 校验课程素材、语音映射和明确登记的缺口。命令准备完成不代表录音已生成或试听通过。
