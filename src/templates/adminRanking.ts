/** 后台「排名追踪」域模板：SERP 排位雷达列表 + 单条编辑（移植自 seo-main 关键词排位雷达）。 */
import { escapeHtml } from './layout'
import { renderAdminLayout } from './adminLayout'

export interface RankTrackRow {
  id: number
  keywordId: number
  keyword: string
  searchEngine: string
  currentRank: number
  previousRank: number
  searchVolume: number
  difficulty: string
  intent: string
  targetUrl: string
  note: string
  lastCheckedAt: string
}

export interface RankHistoryPoint {
  date: string
  rank: number
}

const ENGINES = ['百度', 'Google', 'Bing'] as const
const INTENTS = ['信息查询', '商业调研', '交易购买', '品牌导航'] as const

function rankBadge(rank: number): string {
  if (rank >= 1 && rank <= 3) return '<span class="badge" style="background:#e7f7ee;color:#1a8a4e">TOP3</span>'
  if (rank >= 4 && rank <= 10) return '<span class="badge" style="background:#fff7e6;color:#ad6800">TOP10</span>'
  if (rank >= 11 && rank <= 100) return '<span class="badge">' + rank + ' 名</span>'
  return '<span class="badge" style="background:#fdeaea;color:#e5484d">未进前100</span>'
}

function deltaHtml(current: number, previous: number): string {
  const change = previous - current // 排名数字变小 = 上升
  if (!previous || previous === current) return '<span style="color:var(--muted)">—</span>'
  if (change > 0) return '<span style="color:#1a8a4e">↑ ' + change + '</span>'
  return '<span style="color:#e5484d">↓ ' + Math.abs(change) + '</span>'
}

export function renderRankingPage(opts: {
  rows: RankTrackRow[]
  total: number
  top3: number
  top10: number
  unranked: number
  message?: string
  siteName?: string, cspNonce?: string, csrfToken?: string
}): string {
  const { rows, total, top3, top10, unranked } = opts
  return renderAdminLayout({
    title: '排名追踪', active: '/admin/rankings', siteName: opts.siteName, cspNonce: opts.cspNonce, csrfToken: opts.csrfToken,
    body: `
    <div class="section-title"><h2>SERP 排名追踪</h2>
      <div class="admin-actions">
        <form method="post" action="/admin/rankings" style="display:inline"><button class="btn" type="submit">＋ 添加关键词</button></form>
      </div>
    </div>
    ${opts.message ? '<div class="card" style="border-left:4px solid #1a8a4e;margin-bottom:16px">' + escapeHtml(opts.message) + '</div>' : ''}
    <p class="admin-help">记录每个关键词在目标搜索引擎上的实际排名（排名数字越小越好）。当前排名通常来自人工从搜索结果页回填，或结合站点真实收录情况定期核对；本模块不提供虚构的自动抓取结果。</p>
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="card"><strong>跟踪词数</strong><div style="font-size:26px;margin-top:6px">${total}</div></div>
      <div class="card"><strong>TOP3</strong><div style="font-size:26px;margin-top:6px;color:#1a8a4e">${top3}</div></div>
      <div class="card"><strong>TOP10</strong><div style="font-size:26px;margin-top:6px;color:#ad6800">${top10}</div></div>
      <div class="card"><strong>未进前100</strong><div style="font-size:26px;margin-top:6px;color:#e5484d">${unranked}</div></div>
    </div>
    <div class="admin-table-wrap">
      <table>
        <thead><tr><th>关键词</th><th>引擎</th><th>当前排名</th><th>变化</th><th>搜索量</th><th>难度</th><th>意图</th><th>最近核对</th><th>操作</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((k) => `<tr>
            <td><strong>${escapeHtml(k.keyword)}</strong>${k.note ? '<br><small style="color:var(--muted)">' + escapeHtml(k.note) + '</small>' : ''}</td>
            <td>${escapeHtml(k.searchEngine)}</td>
            <td>${rankBadge(k.currentRank)}</td>
            <td>${deltaHtml(k.currentRank, k.previousRank)}</td>
            <td>${k.searchVolume || 0}</td>
            <td>${escapeHtml(k.difficulty)}</td>
            <td>${escapeHtml(k.intent)}</td>
            <td style="font-size:12px;color:var(--muted)">${escapeHtml(k.lastCheckedAt || '—')}</td>
            <td><a href="/admin/rankings/${k.id}/edit">编辑</a> &nbsp; <form style="display:inline" method="post" action="/admin/rankings/${k.id}/delete" onsubmit="return confirm('确认停止跟踪并删除历史快照？')"><button class="btn secondary" type="submit">删除</button></form></td>
          </tr>`).join('') : '<tr><td colspan="9" style="color:var(--muted)">尚未跟踪任何关键词，点右上角「添加关键词」开始。</td></tr>'}
        </tbody>
      </table>
    </div>`,
  })
}

export function renderRankingFormPage(opts: {
  id?: number
  keyword: string
  keywordId: number
  searchEngine: string
  currentRank: number
  previousRank: number
  searchVolume: number
  difficulty: string
  intent: string
  targetUrl: string
  note: string
  history: RankHistoryPoint[]
  suggestionKeyword: string
  error?: string
  siteName?: string, cspNonce?: string, csrfToken?: string
}): string {
  const isNew = opts.id === undefined
  const historyPoints = opts.history.slice(0, 30)
  return renderAdminLayout({
    title: isNew ? '添加跟踪关键词' : '编辑跟踪关键词', active: '/admin/rankings', siteName: opts.siteName, cspNonce: opts.cspNonce, csrfToken: opts.csrfToken,
    body: `
    <div class="section-title"><h2>${isNew ? '添加' : '编辑'}排名跟踪</h2><a href="/admin/rankings">← 返回排名追踪</a></div>
    ${opts.error ? '<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">' + escapeHtml(opts.error) + '</div>' : ''}
    <form class="admin-form" method="post" action="${isNew ? '/admin/rankings' : '/admin/rankings/' + opts.id + '/edit'}">
      ${isNew ? '<label>关键词</label><input name="keyword" required maxlength="80" value="' + escapeHtml(opts.keyword) + '" placeholder="例如：某行业 办理" />' : '<label>关键词</label><input value="' + escapeHtml(opts.keyword) + '" disabled />'}
      <div class="grid grid-4" style="gap:12px">
        <div><label>搜索引擎</label>
          <select name="search_engine">${ENGINES.map((e) => '<option value="' + e + '"' + (e === opts.searchEngine ? ' selected' : '') + '>' + e + '</option>').join('')}</select>
        </div>
        <div><label>当前排名（1-100；0=未进前100）</label><input type="number" name="current_rank" min="0" max="100" value="${opts.currentRank}" /></div>
        <div><label>上次排名（0=无）</label><input type="number" name="previous_rank" min="0" max="100" value="${opts.previousRank}" /></div>
        <div><label>真实搜索量（可回填）</label><input type="number" name="search_volume" min="0" value="${opts.searchVolume}" /></div>
      </div>
      <div class="grid grid-2" style="gap:12px">
        <div><label>难度</label>
          <select name="difficulty">${['低', '中', '高'].map((d) => '<option value="' + d + '"' + (d === opts.difficulty ? ' selected' : '') + '>' + d + '</option>').join('')}</select>
        </div>
        <div><label>意图</label>
          <select name="intent">${INTENTS.map((i) => '<option value="' + i + '"' + (i === opts.intent ? ' selected' : '') + '>' + i + '</option>').join('')}</select>
        </div>
      </div>
      <label>目标 URL（期望排名的页面）</label>
      <input name="target_url" maxlength="500" value="${escapeHtml(opts.targetUrl)}" placeholder="例如：/city/hohhot/zaizhuan" />
      <label>备注</label>
      <input name="note" maxlength="200" value="${escapeHtml(opts.note)}" placeholder="例如：来自关键词矩阵同步，或人工录入" />
      ${isNew ? '<label>关联关键词矩阵（可选，选择后自动带入）</label><select name="keyword_id"><option value="0">不关联</option>' + (opts.suggestionKeyword ? '<option value="suggest">' + escapeHtml(opts.suggestionKeyword) + '（建议）</option>' : '') + '</select>' : ''}
      <button class="btn" type="submit">${isNew ? '保存并开始跟踪' : '保存排名（自动记录一条历史）'}</button>
    </form>
    ${isNew && opts.suggestionKeyword ? '<div class="card" style="margin-top:14px"><strong>关键词矩阵建议</strong><p class="admin-help">检测到统一 SEO 关键词矩阵中有与输入相近的词：「' + escapeHtml(opts.suggestionKeyword) + '」。保存时会自动关联该矩阵记录并继承其搜索量/难度/意图；也可不关联，作为独立人工跟踪词。</p></div>' : ''}
    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">最近排名走势（最近 ${historyPoints.length} 次）</h3>
      ${historyPoints.length
        ? '<div class="admin-table-wrap"><table><thead><tr><th>日期</th><th>排名</th></tr></thead><tbody>' +
          historyPoints.map((h) => '<tr><td>' + escapeHtml(h.date) + '</td><td>' + (h.rank ? rankBadge(h.rank) : '<span class="badge">未进前100</span>') + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<p class="admin-help">保存编辑后，这里会按日期追加排名快照（每次保存记一条）。</p>'}
    </div>`,
  })
}
