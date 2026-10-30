import { escapeHtml } from './layout'
import { renderAdminLayout } from './admin'
import { AI_QA_MAX_CONTEXT_CEILING, AI_QA_MAX_QUESTION_CHARS, type AiQaSettings } from '../utils/aiQa'

export type AiQaLogRow = {
  id: number
  channel: string
  locale: string
  question: string
  answer: string
  sources: Array<{ title: string; path: string; type: string }>
  model: string
  latencyMs: number
  status: string
  error: string
  created_at: string
}

export type WecomStatus = {
  configured: boolean
  callbackConfigured: boolean
  hasCorpId: boolean
  hasAgentId: boolean
  hasSecret: boolean
  hasToken: boolean
  hasAesKey: boolean
  callbackUrl: string
  lastError: string
}

/** 一段会话（按 session_key 聚合的多轮问答），后台「聊天管理」按它渲染。 */
export type AiQaConversation = {
  sessionKey: string
  title: string
  channel: string
  locale: string
  turns: Array<{
    question: string
    answer: string
    sources: Array<{ title: string; path: string; type: string }>
    status: string
    createdAt: string
  }>
  lastAt: string
  firstAt: string
}

const CHANNEL_LABEL: Record<string, string> = { web: '前台网站', wecom: '企业微信' }
const STATUS_LABEL: Record<string, string> = {
  answered: '已回答', processed: '已回复', rejected: '已拒绝', error: '失败', ignored: '已忽略',
}

function statusChip(status: string): string {
  const color = status === 'answered' || status === 'processed'
    ? '#1a8a4e'
    : status === 'error'
      ? '#e5484d'
      : 'var(--muted)'
  return '<span class="badge" style="border-color:' + color + ';color:' + color + '">' + escapeHtml(STATUS_LABEL[status] || status) + '</span>'
}

function sourceLinks(sources: AiQaLogRow['sources']): string {
  if (!sources.length) return '<span style="color:var(--muted);font-size:12px">无站内依据（纯模型回答）</span>'
  return sources.map((s) =>
    '<a href="' + escapeHtml(s.path) + '" target="_blank" rel="noopener" style="font-size:12px;margin-right:8px">' +
    escapeHtml(s.title) + '</a>',
  ).join('')
}

/** 密钥配置清单：一眼看出还缺哪一项，不用去系统密钥页逐个对照。 */
function secretChecklist(wecom: WecomStatus): string {
  const items: Array<[string, boolean]> = [
    ['企业 ID（CorpID）', wecom.hasCorpId],
    ['应用 AgentId', wecom.hasAgentId],
    ['应用 Secret', wecom.hasSecret],
    ['接收消息 Token', wecom.hasToken],
    ['接收消息 EncodingAESKey', wecom.hasAesKey],
  ]
  return '<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.9">' +
    items.map(([label, ok]) =>
      '<li>' + (ok ? '✅' : '⬜') + ' ' + escapeHtml(label) +
      (ok ? '' : ' <span style="color:var(--muted)">（未配置）</span>') + '</li>',
    ).join('') +
    '</ul>'
}

export function renderAiQaPage(opts: {
  settings: AiQaSettings
  logs: AiQaLogRow[]
  wecom: WecomStatus
  /** 「联系渠道」里勾选了 AI 展示位的渠道：回答结尾会引导用户通过这些方式联系。 */
  aiChannels?: Array<{ type: string; label: string; value: string }>
  /** 按会话聚合的问答记录，用于「聊天管理」。 */
  conversations?: AiQaConversation[]
  /** 企业微信消息日志 */
  wecomLogs?: Array<{ id: number; direction: string; msg_type: string; from_user: string; question: string; answer: string; status: string; error: string; created_at: string }>
  message?: string
  error?: string
  testAnswer?: string
  testSources?: string[]
  siteName?: string, cspNonce?: string, csrfToken?: string
}): string {
  const { settings, logs, wecom, aiChannels = [], conversations = [], wecomLogs = [], message = '', error = '', testAnswer = '', testSources = [], siteName, cspNonce = '', csrfToken = '' } = opts

  const rows = logs.length
    ? logs.map((row) => `
      <tr>
        <td style="white-space:nowrap;color:var(--muted);font-size:12px">${escapeHtml(String(row.created_at || '').slice(5, 16))}</td>
        <td style="white-space:nowrap">${escapeHtml(CHANNEL_LABEL[row.channel] || row.channel)}</td>
        <td style="min-width:220px">${escapeHtml(row.question)}</td>
        <td style="min-width:320px;font-size:13px;line-height:1.7">
          ${escapeHtml(row.answer || '—')}
          ${row.error ? `<div style="color:#e5484d;margin-top:4px">${escapeHtml(row.error)}</div>` : ''}
        </td>
        <td style="min-width:180px">${sourceLinks(row.sources)}</td>
        <td style="white-space:nowrap;font-size:12px;color:var(--muted)">${row.latencyMs ? row.latencyMs + ' ms' : '—'}</td>
        <td>${statusChip(row.status)}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" style="color:var(--muted)">还没有问答记录。前台访客提问或企业微信成员发消息后会出现在这里。</td></tr>'

  return renderAdminLayout({
    title: '智能问答',
    active: '/admin/ai-qa', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <div>
        <h2>💬 智能问答</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:13px">前台问答组件与企业微信自动回复共用同一条链路：先从已发布的站内内容里检索依据，再让 AI 作答，并保留出处。</p>
      </div>
      <a href="/admin/ai-settings" style="color:var(--muted);font-size:13px">模型与参数 →</a>
    </div>
    ${message ? `<div class="card" style="border-left:4px solid #2f9e44;margin-bottom:16px">${escapeHtml(message)}</div>` : ''}
    ${error ? `<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">${escapeHtml(error)}</div>` : ''}

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">① 问答开关与提示词</h3>
      <form class="admin-form" method="post" action="/admin/ai-qa/save">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="ai_qa_enabled" value="1"${settings.enabled ? ' checked' : ''} style="width:auto" />
          启用智能问答（前台右下角问答组件 + POST /api/ai/ask）
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <input type="checkbox" name="ai_qa_wecom_auto_reply" value="1"${settings.wecomAutoReply ? ' checked' : ''} style="width:auto" />
          企业微信收到成员消息时自动回复
        </label>

        <label style="margin-top:14px">欢迎语（问答组件打开时显示）</label>
        <input name="ai_qa_welcome" value="${escapeHtml(settings.welcome)}" maxlength="300" />

        <label style="margin-top:14px">站内资料上限（字符，${800}–${AI_QA_MAX_CONTEXT_CEILING}）</label>
        <input type="number" name="ai_qa_max_context_chars" min="800" max="${AI_QA_MAX_CONTEXT_CEILING}" step="100" value="${settings.maxContextChars}" />
        <p style="color:var(--muted);font-size:12px;margin:6px 0 0">每次提问会先从文章/服务/城市/案例里检索依据，超过上限的部分会被截断。调大更全面，但会占用更多模型额度。</p>

        <label style="margin-top:14px">站点补充要求（可选，叠加在内置问答规则之后）</label>
        <textarea name="ai_qa_prompt" rows="5" maxlength="4000" placeholder="例如：报价统一引导到「联系我们」；不承诺具体办理时限。">${escapeHtml(settings.prompt)}</textarea>

        <button class="btn" type="submit" style="margin-top:12px">保存问答设置</button>
      </form>

      <form method="post" action="/admin/ai-qa/test" style="margin-top:18px;border-top:1px solid var(--border);padding-top:16px">
        <label>提问测试（会真实调用模型并写入问答记录）</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <input name="question" value="你们能提供哪些服务？" style="flex:1;min-width:260px" maxlength="${AI_QA_MAX_QUESTION_CHARS}" />
          <button class="btn secondary" type="submit">测试回答</button>
        </div>
      </form>
      ${testAnswer ? `
      <div class="card" style="margin-top:14px;background:var(--surface, #f6f7f9)">
        <strong style="font-size:13px">模型回答</strong>
        <p style="white-space:pre-wrap;font-size:13px;line-height:1.8;margin:8px 0 0">${escapeHtml(testAnswer)}</p>
        ${testSources.length ? `<p style="font-size:12px;color:var(--muted);margin:10px 0 0">命中站内依据：${testSources.map((s) => escapeHtml(s)).join('｜')}</p>` : '<p style="font-size:12px;color:var(--muted);margin:10px 0 0">没有命中任何站内依据——回答完全来自模型，建议先补齐服务/文章内容。</p>'}
      </div>` : ''}
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">② 回复渠道（企业微信 / 个人微信）</h3>
      <p class="admin-help">
        回答结尾引导用户联系时，只会引用下面这些渠道。渠道本身在
        <a href="/admin/modules">「导航与联系 → 联系渠道」</a>里维护，
        每个渠道可以单独勾选「AI」展示位——所以你可以只让 AI 引导企业微信、
        只引导个人微信，或者两者都引导。
      </p>
      ${aiChannels.length ? `
      <div class="ai-qa-channels">
        ${aiChannels.map((ch) => `<span class="ai-qa-channel"><strong>${escapeHtml(ch.label)}</strong>${escapeHtml(ch.value)}</span>`).join('')}
      </div>
      <p style="color:var(--muted);font-size:12px;margin:10px 0 0">以上渠道会出现在 AI 回答的结尾引导语中。</p>` : `
      <p style="color:#b45309;font-size:13px;margin:8px 0 0">
        当前没有任何渠道勾选「AI」展示位，AI 回答只会引导用户到「联系我们」页面留言。
        想让它直接给出企业微信或个人微信，请到「联系渠道」里勾上对应渠道的 AI 展示位。
      </p>`}
      <div class="admin-actions" style="margin-top:12px">
        <a class="btn secondary" href="/admin/modules">去配置联系渠道 →</a>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">③ 企业微信接入</h3>
      <p style="color:var(--muted);font-size:13px;margin-top:0">
        密钥在「系统密钥 → 企业微信」里填写。填完后把下面的回调地址配置到企业微信自建应用的「接收消息」里，
        成员在企业微信里发消息就会自动得到基于站内内容的回答。
      </p>
      ${secretChecklist(wecom)}
      <label style="margin-top:14px">回调 URL（Mode 选择"明文模式"以外的加密模式，Token / EncodingAESKey 需与系统密钥一致）</label>
      <input readonly value="${escapeHtml(wecom.callbackUrl)}" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace" />
      ${wecom.callbackConfigured ? '' : '<p style="color:#c92a2a;font-size:12px;margin:6px 0 0">还缺少 CorpID / Token / EncodingAESKey 中的至少一项，回调会返回 503。</p>'}
      ${wecom.lastError ? `<p style="color:#c92a2a;font-size:12px;margin:6px 0 0">最近一次失败：${escapeHtml(wecom.lastError)}</p>` : ''}

      <form method="post" action="/admin/ai-qa/wecom-test" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">
        <label>主动推送测试（填写企业微信成员账号 userid）</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <input name="to_user" placeholder="例如 zhangsan" style="flex:1;min-width:220px" />
          <button class="btn secondary" type="submit">发送测试消息</button>
        </div>
        <p style="color:var(--muted);font-size:12px;margin:6px 0 0">用于验证 CorpID / Secret / AgentId 三项是否正确，以及应用是否有发送消息权限。</p>
      </form>
      <a class="btn secondary" href="/admin/system-secrets" style="margin-top:12px;display:inline-block">前往系统密钥 →</a>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">④ 聊天管理（按会话）</h3>
      <p class="admin-help">
        同一段对话的多轮问答会归到一组。前台访客在聊天窗口里连续追问、企业微信成员连续发消息，
        都会各自形成一段会话；点开可以看到完整往来与 AI 引用的站内依据。
      </p>
      ${conversations.length ? `
      <div class="ai-qa-conv-list">
        ${conversations.map((conv) => `
        <details class="ai-qa-conv">
          <summary>
            <span class="ai-qa-conv-title">${escapeHtml(conv.title || '（无标题会话）')}</span>
            <span class="badge">${escapeHtml(CHANNEL_LABEL[conv.channel] || conv.channel)}</span>
            <span class="badge">${conv.turns.length} 轮</span>
            <span class="ai-qa-conv-time">${escapeHtml(conv.lastAt)}</span>
          </summary>
          <div class="ai-qa-conv-body">
            ${conv.turns.map((turn) => `
            <div class="ai-qa-conv-turn">
              <div class="ai-qa-conv-q"><span aria-hidden="true">🙋</span>${escapeHtml(turn.question)}</div>
              <div class="ai-qa-conv-a"><span aria-hidden="true">🤖</span><div>${turn.answer ? escapeHtml(turn.answer) : '<em style="color:var(--muted)">（未产生回答：' + escapeHtml(STATUS_LABEL[turn.status] || turn.status) + '）</em>'}
                ${turn.sources.length ? `<div class="ai-qa-conv-src">依据：${turn.sources.map((s) => `<a href="${escapeHtml(s.path)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`).join('、')}</div>` : ''}
              </div></div>
              <div class="ai-qa-conv-meta">${escapeHtml(turn.createdAt)}</div>
            </div>`).join('')}
          </div>
        </details>`).join('')}
      </div>` : '<p style="color:var(--muted);font-size:13px">还没有会话。前台访客在聊天窗口提问、或企业微信成员发消息后会出现在这里。</p>'}
    </div>

    <div class="card">
      <h3 style="margin-top:0">⑤ 最近问答记录</h3>
      <p style="color:var(--muted);font-size:13px;margin-top:0">IP 只保存哈希，不落明文。失败记录用于排查模型超时、密钥错误或未启用。</p>
      <div class="admin-table-wrap">
        <table>
          <thead><tr><th>时间</th><th>渠道</th><th>问题</th><th>回答</th><th>站内依据</th><th>耗时</th><th>状态</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <form method="post" action="/admin/ai-qa/clear-log" onsubmit="return confirm('清空本站的全部问答记录？此操作不可恢复。')" style="margin-top:12px">
        <button class="btn secondary" type="submit">清空问答记录</button>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">⑥ 企业微信日志</h3>
      <p style="color:var(--muted);font-size:13px;margin-top:0">记录成员发来的消息与机器人回复，用于排查「为什么机器人没回我」。</p>
      <div class="admin-table-wrap">
        <table>
          <thead><tr><th>时间</th><th>方向</th><th>类型</th><th>用户</th><th>消息</th><th>回复</th><th>状态</th></tr></thead>
          <tbody>
          ${wecomLogs.length ? wecomLogs.map((row) => `<tr>
            <td style="font-size:12px;color:var(--muted)">${escapeHtml(row.created_at || '')}</td>
            <td style="font-size:12px">${row.direction === 'in' ? '← 收到' : '→ 发送'}</td>
            <td style="font-size:12px">${escapeHtml(row.msg_type)}</td>
            <td style="font-size:12px">${escapeHtml(row.from_user)}</td>
            <td style="font-size:12px">${escapeHtml(row.question)}</td>
            <td style="font-size:12px">${escapeHtml(row.answer || '—')}</td>
            <td><span class="badge">${escapeHtml(row.status)}</span>${row.error ? `<div style="color:#e5484d;font-size:11px">${escapeHtml(row.error)}</div>` : ''}</td>
          </tr>`).join('') : `<tr><td colspan="7" style="color:var(--muted)">暂无企业微信日志。</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `,
  })
}
