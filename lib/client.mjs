// dsh-workflow-console — Client 端 (前端) 自包含模块
// 遵循官方 dsh-client-ui-sidebar 的 window.__ModuleLoader__.load 形态。
// 订阅公共事件(session/event + agent/assistant-stream)自行渲染五个区块,
// 不硬依赖 host 服务(解耦, 前端可独立加载)。
//
// 挂载: 注册进 sidebar.footer.action 子槽(footer 动作位, 可多插件共位),
//       加一个独立 console 区块。用轻量原生 DOM 渲染, 不依赖 dsh-client-ui-primitives,
//       保证能装载。
// ---------------------------------------------------------------------------

window.__ModuleLoader__.load({
  id: 'dsh-workflow-console',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // slot/布局/会话服务
    const _runtime = require('@deepseek-ai/dsh-client-runtime')
    const _locale = require('@deepseek-ai/dsh-client-locale')

    // ---------------- 简版五区块面板 ----------------
    const CSS = `
      .dwc-panel{margin:4px 2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2, #333);
        border-radius:10px;background:var(--dsw-specific-sidebar-fill, transparent);
        color:var(--dsw-alias-label-primary, inherit);font-size:13px;line-height:1.5}
      .dwc-row{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:3px 0}
      .dwc-badge{padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}
      .dwc-badge.on{background:#2f7d32;color:#fff}
      .dwc-badge.off{background:#555;color:#ddd}
      .dwc-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;
        color:var(--dsw-alias-label-primary,inherit);border-radius:6px;padding:2px 8px;font-size:12px}
      .dwc-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#333)}
      .dwc-btn:disabled{opacity:.5;cursor:default}
      .dwc-bar{height:6px;border-radius:3px;background:#333;overflow:hidden;margin:3px 0}
      .dwc-bar>i{display:block;height:100%;background:#4a90d9;transition:width .3s}
      .dwc-sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
        color:var(--dsw-alias-label-secondary,#999);margin:6px 0 2px}
      .dwc-mono{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
    `
    function ensureCss() {
      if (document.querySelector('style[data-plugin-css="dwc"]')) return
      const el = document.createElement('style')
      el.dataset.plugin = 'dsh-workflow-console'
      el.dataset.pluginCss = 'dwc'
      el.textContent = CSS
      document.head.appendChild(el)
    }

    // 状态累加
    function makeState() {
      return {
        plan: { active: false },
        goal: null,
        token: { pressure: null, projected: null, window: null },
        workflow: { running: false, phase: '' },
        session: { step: 0, tool: 0, lastTool: '' },
      }
    }
    let state = makeState()
    let rootEl = null

    function el(tag, cls, text) {
      const n = document.createElement(tag)
      if (cls) n.className = cls
      if (text != null) n.textContent = text
      return n
    }

    // ---- 渲染面板 ----
    function renderPanel() {
      if (!rootEl) return
      rootEl.replaceChildren()

      const planOn = state.plan.active
      const goal = state.goal
      const tk = state.token
      const wf = state.workflow
      const sess = state.session
      const pct = tk.window && tk.projected != null
        ? Math.min(100, Math.round((tk.projected / tk.window) * 100))
        : null

      // 1) Plan
      rootEl.appendChild(el('div', 'dwc-sec', 'Plan'))
      const planRow = el('div', 'dwc-row')
      const planBadge = el('span', 'dwc-badge ' + (planOn ? 'on' : 'off'), planOn ? 'EXEC' : 'PLAN')
      const planBtn = el('button', 'dwc-btn', planOn ? '↹ 切到执行' : '↹ 切到规划')
      planBtn.onclick = () => togglePlan()
      planRow.append(planBadge, planBtn)
      rootEl.appendChild(planRow)

      // 2) Goal
      rootEl.appendChild(el('div', 'dwc-sec', 'Goal'))
      const goalRow = el('div', 'dwc-row')
      goalRow.appendChild(el('span', '', goal ? `#${goal.id ?? ''} ${goal.phase ?? 'active'}` : '（无目标）'))
      const goalBtn = el('button', 'dwc-btn', goal ? '✓ 完成' : '＋ 建目标')
      goalBtn.onclick = () => goalAction()
      goalRow.appendChild(goalBtn)
      rootEl.appendChild(goalRow)

      // 3) Token
      rootEl.appendChild(el('div', 'dwc-sec', 'Context'))
      const tkRow = el('div', 'dwc-row')
      tkRow.appendChild(el('span', 'dwc-mono', pct != null ? `${pct}%` : '—'))
      const tkVal = tk.projected != null ? `${(tk.projected / 1000).toFixed(1)}k` : ''
      const tkCap = tk.window != null ? `/ ${(tk.window / 1000).toFixed(0)}k` : ''
      tkRow.appendChild(el('span', 'dwc-mono', tkVal + tkCap))
      rootEl.appendChild(tkRow)
      const bar = el('div', 'dwc-bar')
      const fill = el('i')
      fill.style.width = (pct ?? 0) + '%'
      bar.appendChild(fill)
      rootEl.appendChild(bar)

      // 4) Workflow
      rootEl.appendChild(el('div', 'dwc-sec', 'Workflow'))
      const wfRow = el('div', 'dwc-row')
      wfRow.appendChild(el('span', '', wf.running ? `▶ ${wf.phase || 'running'}` : '空闲'))
      const wfBtn = el('button', 'dwc-btn', wf.running ? '◼ 停止' : '▶ 运行')
      wfBtn.onclick = () => wfAction()
      wfRow.appendChild(wfBtn)
      rootEl.appendChild(wfRow)

      // 5) Session 进度
      rootEl.appendChild(el('div', 'dwc-sec', 'Session'))
      const sessRow = el('div', 'dwc-row')
      sessRow.appendChild(el('span', 'dwc-mono', `steps ${sess.step} · tools ${sess.tool}`))
      const refreshBtn = el('button', 'dwc-btn', '刷新')
      refreshBtn.onclick = () => refresh()
      sessRow.appendChild(refreshBtn)
      rootEl.appendChild(sessRow)
    }

    function refresh() {
      renderPanel()
    }

    // ---- 操作（通过 runtime 触发）----
    // 真实 dsh 操作走 agent.followup/steer 或 planMode/goals service。
    // 第一版: 用 agent.steer 发送旧指令来切换,并依赖后端命令(如 /console)兜底。
    function currentAgent() {
      try { return _runtime.getAgent?.() ?? null } catch { return null }
    }
    function togglePlan() {
      // 规划/执行切换: 后端注册了 /conslegacy 命令 + planMode 服务;这里走 steer 发送 /plan 或 /plan off
      const agent = currentAgent()
      if (!agent || typeof agent.steer !== 'function') return
      state.plan.active = !state.plan.active
      agent.steer({ text: state.plan.active ? '/plan' : '/plan off', source: { kind: 'user' } })
      renderPanel()
    }
    function goalAction() {
      const agent = currentAgent()
      if (!agent || typeof agent.steer !== 'function') return
      agent.steer({ text: state.goal ? '/goal complete' : '/goal <describe your objective here>', source: { kind: 'user' } })
    }
    function wfAction() {
      const agent = currentAgent()
      if (!agent || typeof agent.steer !== 'function') return
      agent.steer({ text: '/workflow run my-demo', source: { kind: 'user' } })
    }

    // ---- 订阅公共事件 ----
    const inject = ['slots', 'layout', 'sessions', 'locale']
    function apply(ctx) {
      ensureCss()

      // 监听持久会话事件: 步/工具/轮次
      ctx.on('session/event', (_session, event) => {
        const t = event?.type
        if (t === 'step/start' || t === 'step/end') state.session.step++
        if (t === 'tool/call') {
          state.session.tool++
          state.session.lastTool = event.data?.name || ''
        }
        if (t === 'plan/mode') state.plan = { active: !!event.data?.active }
        if (t === 'goal/change') state.goal = event.data
        renderPanel()
      })

      // 监听实时流: 状态/工作流
      ctx.on('agent/assistant-stream', ({ frame }) => {
        if (frame?.type === 'chunk' && frame.chunk?.type === 'text-delta') {
          // 实时 token 可在此累加(简化: 用后端 snapshot)
        }
      })
      ctx.on('workflow/start', (info) => { state.workflow.running = true; state.workflow.phase = ''; renderPanel() })
      ctx.on('workflow/end', (info) => { state.workflow.running = false; renderPanel() })
      ctx.on('workflow/phase', (info) => { if (info) state.workflow.phase = info.phase ?? ''; renderPanel() })

      // 挂到 footer 动作槽(可多插件共位);渲染一个紧凑按钮,点击展开面板
      ctx.effect(() => ctx.slots.register({
        name: 'sidebar.footer.action',
        children: {
          'sidebar.footer.action': { kind: 'list', scope: 'root' },
        },
        inject: () => ({}),
      }, ConsoleFooter), 'workflow-console: footer registration')

      // 也直接在 body 侧挂一个浮动面板(第一版保证可见)
      ctx.effect(() => {
        rootEl = el('div', 'dwc-panel')
        rootEl.style.position = 'fixed'
        rootEl.style.right = '12px'
        rootEl.style.bottom = '12px'
        rootEl.style.zIndex = '999'
        rootEl.style.width = '220px'
        renderPanel()
        document.body.appendChild(rootEl)
        return () => { rootEl?.remove(); rootEl = null }
      })
    }

    // footer 组件(占位按钮) — 官方 slots 注册需要组件;用函数组件形式
    function ConsoleFooter(props) {
      return null
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

//# sourceMappingURL=client.mjs.map