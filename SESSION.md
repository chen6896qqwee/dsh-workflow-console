# dsh-workflow-console — 会话存档

> 存档时间: 2026-09-06
> 上一轮任务: 开发 DeepSeek Harness 侧边栏「工作流速控条」插件
> 会话在「保存进度」处被打断,此文件补齐。下次续做先读本文件 + DESIGN.md。

---

## 当前状态: ✅ 产物可用,项目实质已完成

**结论先行: 项目已能运行,不用再补 tsdown。** 上一轮卡在「要不要装 tsdown 编译官方 TSX 方案」,这是过度工程——手写自包含版才是真能跑的东西。

## 已验证的产物

| 文件 | 作用 | 验证结果 |
|------|------|---------|
| `lib/index.mjs` (151 行) | 后端 Host 插件: 事件聚合快照服务 | ✅ `node --check` 通过;`import` 加载成功,`name=workflow-console`、`inject=[]`、`apply` 为 function。全服务可探(`ctx.get`),缺提供方也加载不崩 |
| `lib/client.mjs` | 前端 Client 插件: 手写自包含版,`window.__ModuleLoader__.load` 形态 + 原生 DOM 自绘五区块 | ✅ `node --check` 通过。不依赖 tsdown / TSX / primitives,订阅 `session/event` + `agent/assistant-stream` 自渲染 |
| `cordis.patch.yml` | bundle patch: `file:///C:/.../lib/index.mjs` 直连本地开发 | ✅ 指向后端入口,无需安装到 profile |
| `package.json` | `dsh.bundle`(patch) + `dsh.client`(platform/inject) 双声明 | ✅ 齐全 |

## 踩坑与决策记录

1. **tsc 产不出官方 client 形态**: dsh web 客户端期待 `window.__ModuleLoader__.load({id, factory})`。tsc 只做模块编译,产不出这个。官方用 tsdown 的 `clientBundle` preset。
2. **上一轮绕开了 tsdown**: 直接手写 `lib/client.mjs`,自包含、零额外构建工具,确定能加载。避开了一整套打包链路。
3. **`src/` 里那套 TSX 是死代码**(`index.ts`/`locales.ts`/`contract.ts`/`ConsolePanel.tsx`): 理想化官方姿势,依赖 `shell.overlay` slot + tsdown,当前无配套构建,编译不起来。**别被误导去补 tsdown 或认为缺东西——实际产物是 `lib/` 下的 mjs。**
4. **编码坑**: 项目文件在 PowerShell/GBK 下 Get-Content 显示乱码(`鈥?`等),但文件实际是 UTF-8 有效内容(`node` 读取正常)。只是终端显示问题,不是文件损坏。

## 剩余可做(可选,非阻塞)

- [ ] 真机验证: 在 dsh 环境 `dsh plugin add` / bundle 挂载后,点开侧边栏确认面板渲染、事件刷新
- [ ] 清理: 把 `src/` 标注为「参考设计」或删除,避免误导后续(已在本文件说明,代码未动)
- [ ] 发布 checklist (DESIGN.md §7): 校验 npm 发布需要 peer devDep、仓库 topic 等

## 2026-09-06 冒烟验证结果(自动可测部分已全绿)

**后端加载冒烟 ✅** `dsh --profile dwc-test --patch <插件的cordis.patch.yml> "say ok"` → `exit=0`、输出 `ok`。证明:
- 插件 patch 装配被 dsh 识别(dump-config 里有 `workflow-console` 条目)
- `lib/index.mjs` 被 loader require 并执行 apply 而不崩

**前端 UI 全真机冒烟 ⚠️ 未自动完成**,原因与依赖:
- 前端 client 插件被发现机制 = `package.json 的 dsh.client` 声明 + `exports["./client"]`(对标 dshmarket)。后端 `--patch` 只装配了后端 `index.mjs`;前端 `client.mjs` 需要插件**在 web profile 的依赖树里**才会被 client-runner 扫到 `exports["./client"]`。
- 也就是说: `--patch file://` 方式验证了后端,但**前端要装进 profile 依赖 + patch insert** 才会被 web 前端加载。
- 完整浏览器冒烟需要: 运行中的 dsh web(端口 3080)+ 浏览器交互,属人工/长流程,未能在此自动完成。

**待办(真机,需人工/单独长流程)**:
1. 把插件加进 web profile 依赖树(`pnpm --profile web add <本地路径或发布后的包名>`),让 `exports["./client"]` 可被解析
2. 在 web profile 的 `cordis.patch.yml` insert 插件 id(后端) —— 注意 DESIGN 约束: 本机 .dsh profile 只读,需用测试副本或用 `--patch` 叠加而非改 live web profile
3. 启动 `dsh web` → 浏览器看侧边栏/悬浮面板是否渲染、事件是否刷新

**注意**: 若按默认 dshmarket 方式(装进 bundles),`--patch file://` 与 bundle 装法是两种装配;当前后端用 patch 已验证,前端要走 bundle/依赖装法。二者可独立验证。

## 下一步建议

1. 后端已验证可用,可直接发布或继续;前端 UI 需真机确认(见上待办)。
2. 建议用 dshmarket 同款方式: 装进 web profile 依赖 → patch insert → 跑 `dsh web` 人工看面板。
3. 若只求发布: 按 DESIGN §7 checklist 走,后端已验证增加信心,前端在发布后用 `dsh plugin add` 装真实包验证。