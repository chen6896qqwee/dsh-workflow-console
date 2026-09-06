# dsh-workflow-console

DeepSeek Harness (dsh) 的侧边栏「工作流速控条」插件: 把会话的 **规划/执行模式、目标(Goal)、上下文 Token 占用、工作流运行态、会话进度** 汇聚成一条可实时观察、一键操作的驾驶舱面板。

面向 dsh **Web UI**(`dsh web`)。

## 功能

| 区块 | 作用 |
|------|------|
| **Plan / Execute** | 一键切换 规划↔执行 模式 |
| **Goal** | 查看 / 新建 / 完成当前目标 |
| **Context** | 实时显示上下文占用压力与 Token 估量(容量的 projectedTokens / contextWindow) |
| **Workflow** | 一键运行 / 停止预置工作流,显示当前阶段 |
| **Session** | 当前会话步骤数、工具调用数 |

面板为自包含轻量渲染: 订阅 dsh 公共事件(`session/event` + `agent/assistant-stream` + `workflow/*`)自行刷新,不硬依赖 host UI 组件库,失败时静默降级。

## 安装

```bash
# 用 dsh 的 plugin 命令把插件装进你的 profile
dsh plugin --profile <your-profile> add dsh-workflow-console
```

或在 profile 的 `cordis.patch.yml` 手动装配:

```yaml
- insert:
    - id: workflow-console
      name: "dsh-workflow-console"
```

## 依赖

- 后端(`lib/index.mjs`)通过 `ctx.get()` **可选探测**全部服务(`planMode` / `goals` / `tokenMeter` / `workflowEngine` / `agents` / `commands`),缺提供方也能加载,不崩。
- 前端(`lib/client.mjs`)运行时注入 dsh client 运行时(`@deepseek-ai/dsh-client-runtime` + `@deepseek-ai/dsh-client-locale`),由宿主提供。
- 唯一 peer 依赖: `@deepseek-ai/cordis`。

## 开发

`lib/` 下为可直接运行的产物(手写 ESM,无构建步骤):

- `lib/index.mjs` — 后端 Host 插件(事件聚合 / 快照服务 / workflow 探测)
- `lib/client.mjs` — 前端 Client 插件(`window.__ModuleLoader__.load` 形态,原生 DOM 自绘)

```bash
# 语法/加载自检
node --check lib/index.mjs
node --check lib/client.mjs

# 装配冒烟(用 dsh 加载器跑空任务,观察插件 apply 不崩)
dsh --profile <test-profile> --patch ./cordis.patch.yml "say ok"
```

## License

MIT