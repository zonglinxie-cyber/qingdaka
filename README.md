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

- 生产站点（Netlify）：**https://qingdaka-workbuddy-v6.netlify.app/index.html**
- 手机浏览器打开后 → **添加到主屏幕**。
- 更新代码后：`npm run build && netlify deploy --prod --dir dist --no-build`

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
python3 serve.py 8899 &
npm run test:e2e
```

> `npm run test:e2e` 默认打 `127.0.0.1:8899`。如果那个端口上蹲着别的项目的服务，测试会误打过去并失败——换端口跑：
> `TEST_BASE_URL=http://127.0.0.1:8951 npm run test:e2e`

发布产物会先构建到 `dist/`，只包含运行时必需的前端文件、`assets/`、`icons/` 与 `voice-scripts.json`。交接文档、测试和本地脚本不会进入公开站点：

```bash
npm run build
npm run check:dist
python3 serve.py 8900 --directory dist
TEST_BASE_URL=http://127.0.0.1:8900 TEST_UNIT_PAGE=0 npm run test:e2e
```

## 生产部署

PWA 安装与 Service Worker 在生产环境**必须 HTTPS**。当前两条路径：

| 路径 | 地址 | 说明 |
|---|---|---|
| **Netlify** | https://qingdaka-workbuddy-v6.netlify.app/ | 当前生产。连接仓库，用根目录 `netlify.toml`（`npm run build` → `dist/`） |
| **GitHub Pages** | https://zonglinxie-cyber.github.io/qingdaka/ | 静态镜像 |

Netlify 发布目录必须是 `dist/`，**不要把项目根目录直接作为发布目录**，否则交接文档、测试和本地脚本会暴露在公网。更新代码后：

```bash
npm run build
netlify deploy --prod --dir dist --no-build
```

`serve.json` 的缓存策略：
- `sw.js` / `index.html` / `app.js` / `styles.css` → `no-cache`（每次校验，保证更新及时）
- `assets/**` 和 `icons/**` → `immutable` 一年（动图/图标不变，长期缓存省流量）

改了 `app.js` / `styles.css` / 语音资源后，记得把 `sw.js` 顶部的 `VERSION` 加一，否则用户手机上会继续跑旧缓存。

## 文件结构

```
index.html            页面结构（无内联脚本/样式）
styles.css            全部样式（含暗色模式、reduced-motion）
app.js                全部逻辑（IIFE 包裹，无全局污染）
sw.js                 Service Worker（离线缓存 + 运行时缓存裁剪）
serve.py              本地静态文件服务器
manifest.webmanifest  PWA 清单
test.html             单元测试页
serve.json            npx serve 的缓存/压缩配置
netlify.toml          Netlify 托管配置（headers + build）
mobile-qr.png         --lan 时可选生成（pip install qrcode[pil]）
scripts/              构建、校验、开发辅助脚本
assets/               动作示范动图、姿势图、语音 m4a
icons/                应用图标
```
