# 轻打卡 · 部署与运行说明

## 本地运行

### 方式一：`serve.py`（推荐，含拍照 relay，默认 8899）

```bash
python3 serve.py        # http://127.0.0.1:8899/index.html（仅本机）
python3 serve.py --lan    # 0.0.0.0，手机同 Wi‑Fi 可访问
./scripts/dev.sh          # 同上，等价 python3 serve.py
```

- 多线程静态文件 + **POST `/api/protein-photo`**（转发 DashScope OpenAI 兼容接口）。
- 浏览器里的 Key 走请求头 `X-DashScope-Key`，**服务端不写入磁盘、不记日志**。
- 国际区 Key 可设：`DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1 python3 serve.py`

Relay 自测（无 Key 应 401）：

```bash
python3 test_relay.py
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8899/api/protein-photo
```

### 方式二：`npx serve`（仅静态预览，**无**拍照 POST）

不要用裸 `python -m http.server`（不支持 POST，也没有 `serve.json` 的缓存/压缩）。

```bash
npx serve .
```

默认 http://localhost:3000。要看拍照识别请改用上面的 `serve.py`，或在托管平台单独部署 relay（见下）。

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
- 手机浏览器打开后 → **添加到主屏幕**；数据仍在手机本地，**我的** 里填通义 Key。
- 更新代码后在本目录执行：`netlify deploy --prod --dir . --functions netlify/functions --no-build`

临时方案（电脑必须开着）：`cloudflared tunnel --url http://127.0.0.1:8899`，用手机打开终端里出现的 `https://….trycloudflare.com`（每次链接可能变）。

### 单元测试

浏览器打开 `test.html`（须通过 HTTP，不能 `file://`）：

```
http://localhost:8899/test.html
```

（若用 `npx serve`，端口以终端输出为准，一般为 3000。）

### CI（GitHub Actions）

推送/PR 时自动跑：

- `python3 test_relay.py`
- 启动 `serve.py` 后用 Playwright 打开 `test.html`

本地复现：

```bash
npm ci
npx playwright install chromium
python3 serve.py 8899 &
npm run test:e2e
```

## 生产部署

PWA 安装与 Service Worker 在生产环境**必须 HTTPS**。推荐免费静态托管：

- **GitHub Pages** — 把本目录推到仓库，Settings → Pages 开启即可（自带 HTTPS）。
- **Cloudflare Pages / Netlify / Vercel** — 拖拽上传或连接仓库，自带 HTTPS + 压缩 + CDN。

`serve.json` 的缓存策略：
- `sw.js` / `index.html` / `app.js` / `styles.css` → `no-cache`（每次校验，保证更新及时）
- `assets/**` 和 `icons/**` → `immutable` 一年（动图/图标不变，长期缓存省流量）

## 拍照识别（relay）

`app.js` 中 `QWEN_RELAY = './api/protein-photo'`（同源 POST）。

| 场景 | 做法 |
|------|------|
| 本地开发 | `python3 serve.py` 或 `./scripts/dev.sh` |
| **Netlify** | 连接仓库，使用根目录 `netlify.toml`（静态 + Function，`/api/protein-photo` 已 redirect） |
| **Vercel** | 导入项目，根目录 `vercel.json` + `api/protein-photo.py` |
| GitHub Pages 等纯静态 | 无 POST：需 Netlify/Vercel 或 VPS 跑 `serve.py` |
| 单机/VPS | `serve.py --lan` + Nginx/Caddy HTTPS 反代 |

**上游**：`{DASHSCOPE_BASE_URL}/chat/completions`，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`。  
请求体为 OpenAI 格式（`model` + `messages`，含 `image_url` data URI），响应原样返回（前端读 `choices[0].message.content`）。

**安全**：仅校验 Key 格式并转发；限制 body ≤ 12MB；超时 50s。勿在 relay 中打印 Header/Body。

## 文件结构

```
index.html            页面结构（无内联脚本/样式）
styles.css            全部样式（含暗色模式、reduced-motion）
app.js                全部逻辑（IIFE 包裹，无全局污染）
sw.js                 Service Worker（离线缓存 + 运行时缓存裁剪）
serve.py              本地静态 + /api/protein-photo relay
relay_protein_photo.py  DashScope 转发核心
relay_http.py         HTTP 校验（serve / Serverless 共用）
api/protein-photo.py    Vercel Serverless 入口
netlify/functions/      Netlify Function 入口（protein-photo.js）
netlify.toml / vercel.json  托管配置
mobile-qr.png          # --lan 时可选生成（pip install qrcode[pil]）
test_relay.py         relay 单元测试（无网络）
manifest.webmanifest  PWA 清单
test.html             单元测试页
serve.json            部署缓存/压缩配置
assets/               动作示范动图与姿势图
icons/                应用图标
```
