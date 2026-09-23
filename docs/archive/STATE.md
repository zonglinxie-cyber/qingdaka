# 轻打卡 v6 · 删除专场（移除拍照识图）执行报告

## 1. 本轮删除清单 + 净行数

净：**+7 增 / −1225 删 = 净 −1218 行**；另删 5 个 `.pyc` 缓存。

### 删除的整文件（8 个文本文件，−655 行）

| 文件 | −行 |
|---|---|
| netlify/functions/protein-photo.js | 255 |
| relay_http.py | 99 |
| relay_protein_photo.py | 120 |
| relay_routing.py | 60 |
| test_relay.py | 32 |
| api/protein-photo.py | 65 |
| vercel.json | 23 |
| _redirects | 1 |

### 改动的文件（11 个，净 −563 行）

| 文件 | 前 → 后 | Δ |
|---|---|---|
| app.js | 3214 → 2874 | −340 |
| index.html | 462 → 395 | −67 |
| styles.css | 529 → 465 | −64 |
| test.html | 346 → 330 | −16 |
| serve.py | 150 → 91 | −59 |
| netlify.toml | 47 → 40 | −7 |
| scripts/check-dist.mjs | 61 → 56 | −5 |
| .github/workflows/ci.yml | 73 → 70 | −3 |
| package.json | 13 → 12 | −1 |
| scripts/build-dist.mjs | 38 → 37 | −1 |
| scripts/e2e-test.mjs | 160 → 160 | 0（仅内容） |

### 二进制缓存（5 个 .pyc，均被 gitignore）

`api/__pycache__/protein-photo.cpython-314.pyc`、`netlify/functions/__pycache__/protein-photo.cpython-314.pyc`、`__pycache__/relay_http.cpython-314.pyc`、`__pycache__/relay_protein_photo.cpython-314.pyc`、`__pycache__/relay_routing.cpython-314.pyc`。

### 本轮唯一新增

+1 行（含在 app.js 的 −340 之外不计入净行，见下）：`STATE.md` 本文件本身。`sw.js` 版本号 `v40-birddog` → `v41-birddog`（防手机旧缓存继续跑识图代码）。

## 2. 当前剩余部署路径

最后 **2 条**：

1. **Netlify** —— 当前生产，`qingdaka-workbuddy-v6.netlify.app`。原含 Function relay，现已退化为纯静态：`netlify.toml` 只剩 headers + `npm run build` → `dist`。
2. **GitHub Pages** —— 静态镜像，`zonglinxie-cyber.github.io/qingdaka`。原「拍照」靠 FC relay，识图删除后无外部依赖。

已随 relay 移除：阿里云 FC（`proteinto-relay-…fcapp.run`，403 已欠费死，唯一用途就是 relay 后端）、Vercel（`vercel.json` + `api/` 适配层）。

## 3. 和文档说法对不上的地方

1. `HANDOVER.md` 第 4 / 178 / 234 / 262 行写项目路径 `/Users/derekfly3/Active/轻打卡v6`，**已过时**，实际是 `/Users/derekfly3/Documents/轻打卡v6`。
2. 指令事实表写 `vercel.json` 21 行，实际 **23 行**。
3. 指令事实表写 styles.css 只有「4 处 photo 相关样式」，实际 **64 行**（`.btn-photo` / `.key-gate` / `.snap-*` / `.ai-*` / `@keyframes spin` / `.key-warn`）。
4. 指令事实表写 app.js「1946–2302 整节 ~356 行」，实际识图相关内容（含顶部常量、我的页 Key 设置、清空数据、测试钩子）净删 **340 行**。
5. `sw.js` 版本号原为 `v40-birddog`，已 +1 → `v41-birddog`。
6. `netlify/functions/__pycache__/protein-photo.cpython-314.pyc`：JS functions 目录里混进一个 Python relay 字节码缓存，属历史杂散文件。

## 4. 发现但没有动的问题（仅登记）

1. `README.md` 仍大段描述已删的拍照识别 / relay / `test_relay.py` / 三条部署表（约 5、13、20–21、32、68、80、93、96、107–138 行）。
2. `code-review.md` 第 3、5 行仍引用 relay 与 `python3 test_relay.py`。
3. `scripts/dev.sh` 第 2 行注释仍写「静态 + 拍照 relay」。
4. `.netlifyignore` 第 15、23、24 行仍列已删文件的排除项 `test_relay.py` / `vercel.json` / `api/`。
5. `.netlify/` 本地缓存仍含旧 function 产物：`protein-photo.zip`、`manifest.json`、带 `/api/protein-photo` redirect 的 `netlify.toml`；gitignore 忽略，下次 `netlify build` 会重生成。
6. `serve.py` 第 7 行 `import sys` 是既有未使用导入（非本轮删除造成，未顺手清）。
7. `sw.js` 第 126 行注释「不拦截 POST（如拍照识别请求）」已过时（识图删除后应用内不再发 POST）。
8. `scripts/check-dist.mjs` 的 `forbiddenFiles` 仍保留 `vercel.json`（防泄露防御条目，无害惰性残留；按指令字面只删 4 个 relay 文件，未删它）。
9. 本机 8899 端口被一个非本项目残留进程占用（对 `index.html` 返回 200、对 `app.js`/`test.html` 返回 404），导致按默认端口裸跑 `npm run test:e2e` 会误打到它；进程归属查不到，未处理。