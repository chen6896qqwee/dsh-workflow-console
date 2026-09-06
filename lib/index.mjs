// dsh-workflow-console — Host 端插件 (ESM, 可直接运行)
// DeepSeek Harness 侧边栏「工作流速控条」：聚合 plan/goal/token/workflow/session 状态，
// 监听会话事件，向客户端控制台面板暴露只读快照 + 工作流启动入口。
//
// 经 cordis.patch.yml (dsh.bundle) 挂载。声明 dsh.client 供 web 前端挂载控制台面板。
//
// 设计要点（来自 GitHub deepseek-ai/deepseek-harness 官方文档, rc.6）:
//   - 后端服务全部**可选探测**(ctx.get(service)), 缺提供方也能加载, 不崩
//   - 事件驱动的 UI 标准姿势: 监听持久 session/event + 实时 agent/assistant-stream
//   - ctx.planMode / ctx.goals / ctx.tokenMeter / ctx.workflowEngine / ctx.agents
// -----------------------------------------------------------------------------

export const name = 'workflow-console'
// 所有依赖都可选: 用 ctx.get() 探测, 缺提供方(如 workflow 引擎)仍能加载
export const inject = []

/**
 * 控制台快照 — 给前端的只读聚合。值全部拷贝, 非活引用。
 */
function emptySnapshot() {
  return {
    plan: { active: false },
    goal: null,
    token: null,
    workflow: { running: false },
    session: { stepCount: 0, toolCount: 0 },
    updatedAt: Date.now(),
  }
}

export function apply(ctx) {
  const perSession = new Map()

  function snapshotFor(sessionId) {
    if (!sessionId) return emptySnapshot()
    let s = perSession.get(sessionId)
    if (!s) {
      s = emptySnapshot()
      perSession.set(sessionId, s)
    }
    return s
  }

  function agentFor(sessionId) {
    try {
      return ctx.get('agents')?.get(sessionId)
    } catch {
      return null
    }
  }

  function refresh(sessionId) {
    const snap = snapshotFor(sessionId)
    snap.updatedAt = Date.now()

    // --- Plan 模式 ---
    const planMode = ctx.get('planMode')
    if (planMode && typeof planMode.get === 'function') {
      try {
        const agent = agentFor(sessionId)
        const p = agent ? planMode.get(agent) : undefined
        if (p) snap.plan = { active: !!p.active, pending: !!p.pending }
      } catch { /* keep last */ }
    }

    // --- Goal 目标 ---
    const goals = ctx.get('goals')
    if (goals && typeof goals.get === 'function') {
      try {
        const g = goals.get(sessionId)
        if (g && (g.id || g.phase)) {
          snap.goal = {
            id: g.id != null ? String(g.id) : undefined,
            phase: g.phase || undefined,
            rounds: g.rounds,
            blockedReason: g.blockedReason || undefined,
          }
        } else {
          snap.goal = null
        }
      } catch { /* keep last */ }
    }

    // --- Token 占用 ---
    const tokenMeter = ctx.get('tokenMeter')
    if (tokenMeter && typeof tokenMeter.measure === 'function') {
      try {
        const m = tokenMeter.measure(sessionId)
        if (m) {
          snap.token = {
            pressureTokens: m.pressureTokens ?? m.totalTokens,
            projectedTokens: m.projectedTokens,
            contextWindow: m.contextWindow,
          }
        }
      } catch { /* keep last */ }
    }
  }

  // --- 持久会话事件: step/tool/turn 边界 ---
  ctx.on('session/event', (session, event) => {
    const id = session && (session.id ?? String(session))
    const snap = snapshotFor(id)
    if (!event) return
    const t = event.type
    if (t === 'step/start' || t === 'step/end') snap.session.stepCount++
    if (t === 'tool/call') {
      snap.session.toolCount++
      snap.session.lastTool = event.data?.name ?? event.data?.identity?.name
    }
    if (t === 'turn/end' || t === 'turn/start') refresh(id)
    if (t === 'plan/mode') refresh(id)
    if (t === 'goal/change') refresh(id)
    snap.updatedAt = Date.now()
  })

  // --- 工作流启动 ---
  async function launchWorkflow(sessionId, meta, script, args) {
    const engine = ctx.get('workflowEngine')
    if (!engine || typeof engine.start !== 'function') {
      throw new Error('workflowEngine not available in this profile')
    }
    const run = engine.start({
      meta: { console: true, ...(meta || {}) },
      script,
      args: args || undefined,
      parent: agentFor(sessionId) || null,
    })
    const snap = snapshotFor(sessionId)
    snap.workflow = { running: true, runId: run?.id }

    // 只读生命周期事件 (observe-only)
    ctx.on('workflow/start', (info) => {
      if (info?.meta?.console) {
        snap.workflow.running = true
        snap.workflow.runId = info.id
      }
    })
    ctx.on('workflow/end', (info) => {
      if (snap.workflow.runId === info?.id) snap.workflow.running = false
    })
    ctx.on('workflow/phase', (info) => {
      if (snap.workflow.runId === info?.id) snap.workflow.phase = info?.phase
    })
    return run
  }

  // --- 用户命令 (无需模型轮次) ---
  const commands = ctx.get('commands')
  if (commands && typeof commands.register === 'function') {
    try {
      commands.register('console', 'Print the workflow-console snapshot for a session', async (sessionId) => {
        refresh(sessionId)
        return JSON.stringify(snapshotFor(sessionId), null, 2)
      })
    } catch { /* register optional */ }
  }

  // --- 暴露跨插件/客户端服务 ---
  ctx.effect(() => {
    ctx.reflect.provide('workflowConsole', {
      snapshot: (sessionId) => snapshotFor(sessionId),
      refresh: (sessionId) => refresh(sessionId),
      launch: (sessionId, meta, script, args) => launchWorkflow(sessionId, meta, script, args),
    })
  })
}

export default { name, inject, apply }