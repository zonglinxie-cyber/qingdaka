# FROZEN · 轻打卡 v6 · `v6-frozen`

> 冻结日期：2026-08-19
> 本文件在打 tag 时写死，之后**只读**。

## 能做什么

见 `SPEC.md` 第 3 节。一句话：记蛋白、记水、记体重、跟着做力量训练、看 7 天/4 周回顾，数据本地存、可导出导入。

## 明确不做什么

见 `SPEC.md` 第 4 节。最重要的一条：**不做拍照识别，不做任何需要后端的功能。**

## 已知缺陷

冻结不代表没问题，代表问题被记录下来并接受了。

1. **`.github/workflows/ci.yml` 被 `.gitignore` 忽略**（`.gitignore:12-13`，原因写在注释里：本机 GitHub token 没有 `workflow` scope，推不上去）。文件只在本地，从未在 GitHub 上运行过——这套 CI 只能手动本地跑。
2. `npm run test:e2e` 默认打 `127.0.0.1:8899`；该端口若被别的项目占用，测试会误打过去并失败，且报错信息看不出是端口问题。需手动 `TEST_BASE_URL=` 换端口。
3. GitHub Pages 镜像站（`zonglinxie-cyber.github.io/qingdaka`）无人维护，可能与 Netlify 生产版本不同步。
4. **Pages 直接服务仓库根目录，且仓库公开**：`HANDOVER.md` / `README.md` / `serve.py` 等在公网可读（已验证 HTTP 200）。`check-dist.mjs` 只防住了 Netlify 那条路，Pages 绕过了它。已确认无 API Key 泄漏，但 `HANDOVER.md:28` 的 Netlify siteId 是公开的。
5. `HANDOVER.md` 是 2026-08-05 语音改造的历史记录，其中「当前部署状态」表（Service Worker 版本 `v28`）已过期，仅作历史查阅。
6. 阿里云 FC 函数 `proteinto-relay-abwamgsilr` 已因欠费停服，代码里已无任何引用，但云上资源尚未销毁。

## 冻结时的验证结果

```
npm run build && npm run check:dist   → 46 m4a voice files; sensitive source files excluded
npm run test:e2e                      → ✅ 127/127 通过；CSP 与离线 m4a Range 缓存通过
dist 冒烟                              → ✅ 发布产物加载且非运行时文件不可访问
```

## 怎么回到这里

```bash
git checkout v6-frozen
python3 serve.py 8899
# http://127.0.0.1:8899/index.html
```

## 冻结后的规矩

- 主线只接 bug fix。
- 新功能开分支。分支合不回来 → 这想法不成立，进 `BACKLOG.md` 或丢弃。
- 新想法一律进 `BACKLOG.md`，不进当前版本。
- 改动守恒继续生效：任何一轮净新增行数 ≤ 0，确需新增必须同时指出删掉哪部分。
