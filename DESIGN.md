# dsh-workflow-console — 设计文档

> 项目根: `C:\Users\chen\.dsh\workspace\dsh-workflow-console`（独立第三方插件,不属于 deepseek-harness monorepo）
> 规范来源: GitHub `deepseek-ai/deepseek-harness`(master) 官方文档,版本 0.1.0-rc.6
> 本机约束: **只读 GitHub 官方仓库,** 不修改本机 `.dsh` profile;插件作为独立包开发,发布后经 `dsh plugin add` / bundle 装配

---

## 1. 定位

**Workflow Console** 是 DeepSeek Harness(dsh) 的侧边栏「工作流速控条」插件:
把散落在设置/命令里的 agent 运行状态与操作,汇聚成一条可实时观察、一键操作的驾驶舱。

分两阶段:
- **A(本文件主推)**: 会话/工作流速控条 — 状态观察 + 一键操作
- **C(后续阶段)**: 可视化工作流编排器 — 图→dsh workflow 脚本代码生成器

本文档 A 为主,C 保留路线图。

---

## 2. 产品形态

一个挂载到 dsh Web UI **侧边栏(sidebar)** 的会话级面板,包含:

| 区块 | 功能 | 后端服务 | 说明 |
|------|------|---------|------|
| **Plan/Execute** | 一键切换 规划↔执行 模式 | `ctx.planMode` | `set(agent, active)` → `committed/queued/cancelled/noop`;高亮当前态 |
| **Goal** | 显示/暂停/恢复/完成当前目标 | `ctx.goals` | `get()/create/edit/pause/resume/complete/block/clear`,对比-交换(GAS)守卫 |
| **Token 占用** | 实时显示上下文占用 + 容量 | `ctx.tokenMeter` | `measure()` + `contextPressure/projectedTokens/contextWindow` projection |
| **工作流触发** | 一键跑预置 workflow | `ctx.workflowEngine` | `start({meta, script, args})` → `WorkflowRun` |
| **会话进度** | 当前轮次/步骤/工具活动 | `session/event` + `agent/assistant-stream` | 从持久事件 + 实时流渲染 |

---

## 3. 架构与挂载点（官方契约）

### 3.1 核心决策: UI 插件的标准姿势

来自 `docs/cookbook/extension-cookbook.zh.md`「UI(GUI)」映射:

> 监听 `agent/assistant-stream` 的实时 chunk + `session/event` 的持久 settlement、边界与工具活动;输入 → `followup()`。

- **实时渲染**: `ctx.on('agent/assistant-stream', ({frame}) => ...)` — chunk 级 token/step 进度
- **持久状态**: `ctx.on('session/event', (session, event) => ...)` — turn/step/user/assistant/tool 边界
- **输入回驱动**: `ctx.agents.get(id)?.followup(createUserMessage({...}))` 或 `steer()`

### 3.2 manifest 双声明（dsh 插件标准,来自 dph-taskboard 真实范式 + contributing.md）

```jsonc
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // 后端挂载: 声明 dsh.bundle
  "client": {                                     // 前端注入: 声明 dsh.client
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-ui-layout",
      "@deepseek-ai/dsh-client-locale"
    ]
  }
}
```

`cordis.patch.yml`:
```yaml
- insert:
    - id: workflow-console
      name: "dsh-workflow-console"   # 需引号,@ 是 YAML 保留字符
```

### 3.3 挂载槽位

- **后端**: 在 `cordis.patch.yml` 插入插件 id → Cordis 挂 `apply(ctx)`, `inject` 声明的服务就绪后加载
- **前端**: 依赖 `dsh-client-ui-layout`(提供 `ctx.layout` + `sidebar` slot + `LayoutController`)。
  - `ctx.layout.toggleSidebar()/openDetails()/closeDetails()` 切换面板
  - UI 面板注册进 `sidebar` slot(参考 layout 源码 `ctx.slots.register({ name:'root', children:{ sidebar:{kind:'single',scope:'root'}, ... } })`)
- **Web Chat 业务节点**(如需对话内嵌): 注册 `ConversationNodeDefinition` + keyed renderer

---

## 4. 服务 API（来自 capability-seams 官方定义）

### 4.1 `ctx.planMode` — core 角色,稳定可用
- `set(agent, active)` → `'committed' | 'queued' | 'cancelled' | 'noop'`
- `get(agent)` → `{ active, pending? }`
- 事件: `plan/mode`(持久);`session/event` 可观察 commit
- 部署方提供 `section` 引导段;dsh 自带 `dsh-plan-mode`

### 4.2 `ctx.goals` — core 角色
- `get()` → 分离的 `GoalView`
- 动词: `create / edit / pause / resume / complete / block / clear`
- `GoalRef { id, revision }` 对比-交换守卫,拒绝过期 ref
- 事件: `goal/change`(持久快照);`goal/changed`(scoped 通知)
- 同会话单目标;激活(continuation)进程本地,不持久

### 4.3 `ctx.tokenMeter` — core 角色
- `measure(session, requestHeader?)` → 不可变快照(`totalTokens` 请求+响应压力, `surfaceTokens` 表层)
- `estimateMessage(msg)` → 单条消息定价(固定启发式: 4字符/token)
- projection: `tokenUsage`(uncachedInput/output/cacheRead/cacheWrite) · `contextPressure`(pressureTokens/projectedTokens/contextWindow) · `contextBreakdown`(system/tools/message)
- UI 占用 = `projectedTokens / contextWindow`(注明: 估算值,非计费)

### 4.4 `ctx.workflowEngine` — seam 角色
- `start({ meta, script, args?, subagentProvider?, maxTotalAgents?, parent, signal? })` → `WorkflowRun`
- `WorkflowRun`: `{ id, meta, result, cancel(reason?), dispose() }`
- `WorkflowResult`: `{ value, stopReason, error?, agentsStarted }`
- 事件(只读): `workflow/start|end|phase|log|agent-start|agent-end`
- 引擎: `workflow-worker-thread`;`agent()` 通过 `ctx.subagents` 扇出
- **C 关键**: workflow = **模型写的编排脚本**(`parallel()/pipeline()` + 子agent),非节点图 → C 是「图→脚本生成器」

### 4.5 `ctx.agents` / `ctx.sessions` — 前端驱动
- `ctx.agents.get(sessionId)` → `AgentHandle`:`followup()/steer()/inject()/cancel()/dispose()`
- `ctx.sessions` → 持久的 `session/event` 流

---

## 5. 前端实现骨架

依赖注入:`dsh-client-runtime`(defineStore/hooks) + `dsh-client-ui-layout`(layout service + slots) + `dsh-client-locale`

```
src/client/
  index.ts        # apply(ctx): 注册 UI,订阅事件
  components/
    ConsolePanel.tsx    # 侧边栏面板容器(Plan/Goal/Token/Workflow 区块)
    PlanMode.tsx        # Plan↔Execute 切换
    GoalCard.tsx        # 目标状态 + 操作按钮
    TokenMeter.tsx      # 占用条 + 容量
    WorkflowLauncher.tsx# 预置工作流一键触发
  store.ts        # zustand 面板状态(参考 Grok AgentView: per-session 绑定)
lib/
  index.js        # 后端 apply: 注册 service / 事件监听 (编译产物)
  client.js       # 前端入口 (编译产物)
cordis.patch.yml
package.json
```

### 事件→UI 映射(借鉴 Codex 事件流驱动)

| UI 更新 | 监听事件 |
|--------|---------|
| 轮次/步骤进度 | `session/event`: turn/* step/* |
| Token 实时 | `agent/assistant-stream` chunk + `session/event` assistant settlement |
| 工具活动 | `session/event`: tool/call, tool/result |
| Plan 态 | `session/event`: plan/mode |
| Goal 态 | `ctx.on('goal/changed')` |
| 工作流 | `workflow/start|end|phase|agent-*` |

---

## 6. 后端服务(可选,供跨插件复用)

提供 `ctx.workflowConcole` 聚合服务(借鉴 Cordis 命名: `Service` 子类 + declaration merging):

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { workflowConcole: WorkflowConsoleService }
}
class WorkflowConsoleService extends Service {
  static inject = ['planMode','goals','tokenMeter','workflowEngine','agents']
  constructor(ctx){ super(ctx,'workflowConcole') }
  getSnapshot(agentId) { /* 聚合 plan/goal/token/step 为一个只读快照 */ }
}
```

> 注: 单一职责插件通常无需自建服务(A 直接在前端聚合各 service 数据即可);服务仅当有跨插件复用需求时提供。命名后缀用 `Service`/`Console`,避免与官方 `Controller`/`Runtime` 冲突。

---

## 7. 发布 checklist（来自 contributing.md + adding-a-package）

- [ ] `package.json` 含 `dsh.bundle`(patch) + `dsh.client`(platform/inject) —— 双声明,缺 dsh.bundle 必拒
- [ ] `cordis.patch.yml` 就位,name 加引号
- [ ] 真实可用代码(非占位/README-only),仓库满 1 天
- [ ] 描述属实(会被核对): 写了几个区块就得有
- [ ] 依赖 peer 范围带显式 prerelease 分支(避免静默排除 rc 构建)
- [ ] 建议发布 npm(pnpm 预构建免 allowBuilds)
- [ ] 仓库加 `dsh-plugin` topic
- [ ] 若要上 awesome 列表: 提 PR 加 `data/plugins/<owner>__<repo>.yml`(单文件单条)

---

## 8. C 阶段路线图：可视化工作流编排器

**可行性结论**(来自 `dsh-workflow` README): workflow 是「模型写的编排脚本」,支持 `parallel()/pipeline()` 扇出子agent,`agent()` 调用经 `ctx.subagents`;**无断点/无持久化恢复**。

因此 C = **图→脚本代码生成器**:

```
[节点图(工具/技能/子agent)] --compiler--> [dsh workflow script] --workflowEngine.start--> [WorkflowRun]
```

- **前端**: React Flow 画布,节点=工具/技能/子agent,连线=数据流/顺序
- **编译器**: 图 → `parallel()/pipeline()` 编排脚本(借鉴 Grove Action/Effect 单向流做状态机)
- **执行**: 复用 `ctx.workflowEngine` + `workflow-worker-thread`
- **风险**: 工作流不可序列化/无恢复;rc 版本 API 可能变动 → 建议 A 落地后再做,且先验证脚本运行时上限

---

## 9. 参考文档索引(GitHub,只读)

| 文档 | 路径(master) | 用途 |
|------|-------------|------|
| 架构 | `docs/architecture.zh.md` | 挂载点、轮次流程、能力归属表 |
| 扩展实操 | `docs/cookbook/extension-cookbook.zh.md` | UI 插件骨架、功能→机制映射 |
| Cordis 入门 | `docs/cordis-primer.md` | 五原语、事件模式、loader |
| 能力图 | `docs/capability-seams.zh.md` | 全部 ctx 服务清单(角色/实现/消费方) |
| 打包 | `docs/cookbook/adding-a-package.md` | package.json / exports / README 规范 |
| 收录 | `awesome-dsh-plugin/contributing.md` | 发布到 awesome 列表的规则 |
| 对标 | openai/codex · xai-org/grok-build · anthropics/claude-agent-sdk | 事件流/状态机/hooks 借鉴 |

**对标提炼**:
- Codex: App Server 事件流驱动 UI(Item/Turn/Thread) → A 前端按事件流刷新
- Grok: Elm Action/Effect 单向流 + 每会话 AgentView → A/C 状态机
- Claude SDK: 可拦截 hooks + compact_boundary → C 的分步 pre/post 校验;A 的 token 占用反映 compaction