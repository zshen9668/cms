/** 后台 AI 域模板：模型通道设置与提示词管理。 */
import { escapeHtml } from './layout'
import { EXTERNAL_AI_PRESETS } from '../utils/aiSettings'
import {
  DEFAULT_AI_GLOBAL_PROMPT,
  DEFAULT_AI_PROMPTS,
  AI_PROMPT_SPECS,
  AI_TITLE_GENERATION_GUIDES,
  buildWhiteLabelAiGlobalPrompt,
  buildWhiteLabelAiTaskPrompt,
  buildWhiteLabelAiTitleGuide,
  promptTextStats,
  validateAiPromptVariables,
  type AiPromptKey,
  type AiPromptSettings,
} from '../utils/aiPrompts'
import { renderAdminLayout } from './adminLayout'
import type { SiteProfile } from '../utils/siteProfile'
export function renderAiSettingsPage(settings: {
  enabled: boolean
  provider: 'workers_ai' | 'openai_compatible'
  model: string
  temperature: number
  maxTokens: number
  externalBaseUrl: string
  externalModel: string
  externalTimeoutMs: number
  fallbackEnabled: boolean
  webSearchEnabled: boolean
  externalApiKeyConfigured?: boolean
  saved?: boolean
  test?: string
  testModel?: string
  testProvider?: string
  testResponse?: string
  testMessage?: string
  testTask?: string
  testQuality?: string
  siteName?: string, cspNonce?: string, csrfToken?: string
  industry_prompt?: string
  industry_prompt_count?: number
  industry_prompt_error?: string
}): string {
  const modelOptions = [
    { id: '@cf/meta/llama-3.1-8b-instruct-fast', label: 'Llama 3.1 8B Fast（当前默认）', note: '速度快，适合批量新闻/城市/服务/文章生成' },
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B Fast', note: '更强的长文本理解与生成能力，资源消耗更高' },
    { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', note: '新一代多模态模型，可用于较复杂内容生成' },
    { id: '@cf/meta/llama-3.1-8b-instruct-fp8', label: 'Llama 3.1 8B FP8', note: '标准 Cloudflare 托管版本' },
  ]
  const isKnownModel = modelOptions.some((m) => m.id === settings.model)
  const activeTestModel = settings.testModel || (settings.provider === 'workers_ai' ? settings.model : settings.externalModel)
  return renderAdminLayout({
    title: 'AI 设置', active: '/admin/ai-settings', siteName: settings.siteName, cspNonce: settings.cspNonce, csrfToken: settings.csrfToken,
    body: `
    <div class="section-title"><h2>🤖 AI 设置</h2></div>
    <p style="color:var(--muted);font-size:13px;max-width:900px">
      这里统一控制全站 AI。默认继续使用 Cloudflare Workers AI；也可以切换到任意兼容 OpenAI Chat Completions 接口的第三方模型 API。
      新闻采集、城市/服务页面、文章正文/SEO、关键词落地页和多平台文案都会通过同一个 AI 路由。
    </p>
    ${settings.saved ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">AI 设置已保存，新的生成请求会立即使用新配置。</div>' : ''}
    ${settings.industry_prompt === 'ok' ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px"><strong>✅ 行业化提示词已自动生成</strong><br><small>基于当前站点画像，已生成 ${settings.industry_prompt_count || 0} 段行业化补充提示词并写入全部任务。</small></div>` : ''}
    ${settings.industry_prompt === 'error' ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px"><strong>❌ 行业化提示词生成失败</strong><br><small>${escapeHtml(settings.industry_prompt_error || '未知错误')}</small></div>` : ''}
    ${settings.test === 'ok' ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px"><strong>AI 测试正常</strong><br><small>任务：${escapeHtml(settings.testTask === 'city' ? '城市页真实内容' : settings.testTask === 'article' ? '文章真实内容' : '基础连通性')}；通道：${escapeHtml(settings.testProvider === 'openai_compatible' ? '外部 OpenAI-compatible API' : 'Workers AI')}；模型：${escapeHtml(activeTestModel || settings.model)}</small><div style="margin-top:6px">${escapeHtml(settings.testQuality || '')}</div><pre style="white-space:pre-wrap;max-height:300px;overflow:auto;color:var(--text)">${escapeHtml(settings.testResponse || '')}</pre></div>` : ''}
    ${settings.test === 'disabled' ? '<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px"><strong>AI 当前已关闭</strong><br><small>请先打开“启用 AI 内容生成”，保存后再测试。</small></div>' : ''}
    ${settings.test === 'empty' ? '<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px"><strong>AI 调用成功，但没有解析到返回文本</strong></div>' : ''}
    ${settings.test === 'error' ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px"><strong>AI 测试失败</strong><br><small>${escapeHtml(settings.testMessage || '未知错误')}</small></div>` : ''}

    <form class="admin-form" method="post" action="/admin/ai-settings">
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">① AI 总开关</h3>
        <label style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" name="ai_enabled" ${settings.enabled ? 'checked' : ''} />
          <span>启用 AI 内容生成</span>
        </label>
        <p style="color:var(--muted);font-size:12px">关闭后不会删除已有内容；定时新闻任务和手动 AI 生成都不会调用模型。</p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">② AI 通道</h3>
        <label>主要 AI 提供方</label>
        <select name="ai_provider" id="aiProvider">
          <option value="workers_ai" ${settings.provider === 'workers_ai' ? 'selected' : ''}>Cloudflare Workers AI（现有）</option>
          <option value="openai_compatible" ${settings.provider === 'openai_compatible' ? 'selected' : ''}>第三方 OpenAI-compatible API</option>
        </select>
        <p style="color:var(--muted);font-size:12px;line-height:1.8">
          第三方 API 只需要一个 HTTPS API Base URL + 模型名；API Key 不保存在 D1，也不会写进 Git。
          Cloudflare Worker 使用标准 \`fetch()\` 调用外部 API。
        </p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">③ Workers AI 模型</h3>
        <label>Workers AI 模型</label>
        <select name="ai_model">
          ${modelOptions.map((m) => `<option value="${escapeHtml(m.id)}" ${settings.model === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
        <p style="color:var(--muted);font-size:12px;margin-bottom:8px">${escapeHtml((isKnownModel ? modelOptions.find((m) => m.id === settings.model)?.note : '当前为自定义模型ID') || '')}</p>
        <label>自定义 Workers AI 模型 ID（可选）</label>
        <input name="ai_custom_model" placeholder="@cf/..." value="${isKnownModel ? '' : escapeHtml(settings.model)}" />
        <p style="color:var(--muted);font-size:12px">仅接受 Cloudflare Workers AI 模型 ID（例如 \`@cf/...\` 或 \`@hf/...\`）。</p>
      </div>

      <div class="card" id="externalAiCard" style="margin-bottom:16px">
        <h3 style="margin-top:0">④ 第三方 AI API</h3>
        <p style="color:var(--muted);font-size:12px;line-height:1.8">
          当前实现使用 OpenAI-compatible 的 \`/chat/completions\` 格式。可接入提供该兼容接口的模型服务；例如服务商通常会提供类似 \`https://example.com/v1\` 的 Base URL。
        </p>
        <label>预设(免费层,一键填入下方地址与模型)</label>
        <select id="externalPreset">
          <option value="">自定义</option>
          ${EXTERNAL_AI_PRESETS.map((p) => `<option value="${p.id}" data-base="${escapeHtml(p.baseUrl)}" data-model="${escapeHtml(p.model)}">${escapeHtml(p.label)}</option>`).join('')}
        </select>
        <label>API Base URL</label>
        <input name="ai_external_base_url" maxlength="500" value="${escapeHtml(settings.externalBaseUrl || '')}" placeholder="https://api.example.com/v1" autocomplete="off" />
        <label>模型名称</label>
        <input name="ai_external_model" maxlength="180" value="${escapeHtml(settings.externalModel || '')}" placeholder="例如 provider-model-name" autocomplete="off" />
        <label>请求超时（毫秒）</label>
        <input type="number" name="ai_external_timeout_ms" min="5000" max="60000" step="1000" value="${settings.externalTimeoutMs}" />
        <label style="display:flex;align-items:center;gap:10px;margin-top:10px">
          <input type="checkbox" name="ai_fallback_enabled" ${settings.fallbackEnabled ? 'checked' : ''} />
          <span>主通道失败时，最多自动调用 1 次备用通道</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;margin-top:8px">
          <input type="checkbox" name="ai_web_search_enabled" ${settings.webSearchEnabled ? 'checked' : ''} />
          <span>启用联网增强（需模型支持 OpenAI tools 调用，推荐 Perplexity/Google Gemini 等）</span>
        </label>
        <p style="color:var(--muted);font-size:12px">
          外部 API Key 固定使用 Cloudflare Secret 名称 <code>EXTERNAL_AI_API_KEY</code>。不要填在这里。
          未配置这个 Secret 时，外部通道测试会直接提示缺少 Key。
        </p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">⑤ 外部 AI API Key</h3>
        <p style="color:var(--muted);font-size:12px;line-height:1.8">仅在选择“第三方 OpenAI-compatible API”时使用。保存后加密存储在 D1，后台不会回显原始 Key；不填写不会删除已有 Key。</p>
        <label>API Key</label>
        <input name="external_ai_api_key" type="password" autocomplete="new-password" placeholder="留空保持不变" />
        <p style="font-size:12px;color:var(--muted)">当前状态：<strong>${settings.externalApiKeyConfigured ? "已配置" : "未配置"}</strong></p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">⑥ 生成参数</h3>
        <label>Temperature（随机性）</label>
        <input type="number" name="ai_temperature" min="0" max="5" step="0.1" value="${settings.temperature}" />
        <p style="color:var(--muted);font-size:12px">行业 SEO 内容通常建议 0.4–0.8；外部服务是否支持该范围由服务商接口决定。</p>
        <label>最大输出长度（Token）</label>
        <input type="number" name="ai_max_tokens" min="256" max="32768" step="256" value="${settings.maxTokens}" />
        <p style="color:var(--muted);font-size:12px">控制单次输出长度。越大，单次请求产生的处理和第三方模型费用也可能越高。</p>
      </div>

      <button class="btn" type="submit">保存 AI 设置</button>
    </form>

    <div class="card" style="margin-top:16px;max-width:900px">
      <h3 style="margin-top:0">AI 诊断测试</h3>
      <p style="color:var(--muted);font-size:12px;line-height:1.8">基础连通性只能证明模型能返回文本。为避免“AI测试成功但文章无法保存”，这里增加真实内容任务测试：城市页/文章会走与正式生成相同的 JSON/HTML/长度质量链路，但不会写入业务数据。</p>
      <form method="post" action="/admin/ai-settings/test" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div><label>测试任务</label><select name="test_task"><option value="connectivity">基础连通性</option><option value="city">城市页真实内容</option><option value="article">文章真实内容</option></select></div>
        <button class="btn secondary" type="submit">🧪 运行诊断</button>
      </form>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 0">推荐：模型或提示词修改后，至少运行一次“城市页真实内容”或“文章真实内容”。</p>
    </div>

    <div class="card" style="margin-top:16px;max-width:900px">
      <h3 style="margin-top:0">当前配置</h3>
      <table><tbody>
        <tr><th style="text-align:left">状态</th><td>${settings.enabled ? '已启用' : '已停用'}</td></tr>
        <tr><th style="text-align:left">主要通道</th><td>${settings.provider === 'workers_ai' ? 'Cloudflare Workers AI' : '第三方 OpenAI-compatible API'}</td></tr>
        <tr><th style="text-align:left">Workers AI 模型</th><td><code>${escapeHtml(settings.model)}</code></td></tr>
        <tr><th style="text-align:left">外部 Base URL</th><td><code>${escapeHtml(settings.externalBaseUrl || '未配置')}</code></td></tr>
        <tr><th style="text-align:left">外部模型</th><td><code>${escapeHtml(settings.externalModel || '未配置')}</code></td></tr>
        <tr><th style="text-align:left">备用通道</th><td>${settings.fallbackEnabled ? '启用（最多 1 次）' : '关闭'}</td></tr>
        <tr><th style="text-align:left">最大输出</th><td>${settings.maxTokens} Token</td></tr>
      </tbody></table>
    </div>

    <script>
    (function(){
      var provider = document.getElementById('aiProvider');
      var card = document.getElementById('externalAiCard');
      function sync(){
        var external = provider && provider.value === 'openai_compatible';
        if(card) card.style.opacity = external ? '1' : '0.72';
      }
      if(provider){ provider.addEventListener('change', sync); sync(); }
      var preset = document.getElementById('externalPreset');
      if(preset){
        preset.addEventListener('change', function(){
          var opt = preset.options[preset.selectedIndex];
          if(!opt || !opt.value) return;
          var base = document.querySelector('input[name="ai_external_base_url"]');
          var model = document.querySelector('input[name="ai_external_model"]');
          if(base) base.value = opt.getAttribute('data-base') || '';
          if(model) model.value = opt.getAttribute('data-model') || '';
          if(provider){ provider.value = 'openai_compatible'; sync(); }
        });
      }
    })();
    </script>
  `,
  })
}

export function renderAiPromptsPage(
  settings: AiPromptSettings,
  saved = '',
  test: { status?: string; key?: string; provider?: string; model?: string; response?: string; error?: string; genKey?: string; genText?: string; genCount?: number } = {},
  siteProfile?: SiteProfile,
  siteName?: string, cspNonce?: string, csrfToken?: string,
): string {
  const profile = siteProfile || { siteName: '', topic: '', industry: '', description: '', targetCustomers: '', serviceFeatures: '', applicationScenarios: '', primaryServices: [], primaryKeywords: [], industryKeywords: [], siteKeywords: [], newsCategories: [] }
  const items: Array<{ key: 'global' | AiPromptKey; title: string; desc: string; defaultPrompt: string }> = [
    { key: 'global', title: '全局规则', desc: '统一控制品牌语气、事实边界、单页单主题、3-5 个页面主题词和禁止堆词。', defaultPrompt: buildWhiteLabelAiGlobalPrompt(profile) },
    { key: 'news', title: '新闻解读', desc: '外部新闻只作事实资料，生成独立解读并控制 SEO 字段。', defaultPrompt: buildWhiteLabelAiTaskPrompt('news', profile) },
    { key: 'city', title: '城市页面', desc: '围绕城市企业行业需求，不把全站候选词批量复制到城市页。', defaultPrompt: buildWhiteLabelAiTaskPrompt('city', profile) },
    { key: 'service', title: '服务页面', desc: '只讲当前服务；城市组合词只在城市×服务落地页中使用。', defaultPrompt: buildWhiteLabelAiTaskPrompt('service', profile) },
    { key: 'article', title: '文章生成', desc: '围绕标题和摘要的一个主问题写原创内容，关键词只作主题提示。', defaultPrompt: buildWhiteLabelAiTaskPrompt('article', profile) },
    { key: 'keyword', title: '关键词候选', desc: '发现候选词，不直接等于页面 SEO；候选最多 12 个，页面仍固定 3-5 个。', defaultPrompt: buildWhiteLabelAiTaskPrompt('keyword', profile) },
    { key: 'landing', title: '城市×服务', desc: '仅服务有正机会分的城市×服务落地页，聚焦单一组合搜索意图。', defaultPrompt: buildWhiteLabelAiTaskPrompt('landing', profile) },
    { key: 'page', title: '普通页面', desc: '首页、关于、联系等页面优先清晰信息与转化，不制造无关 SEO 词。', defaultPrompt: buildWhiteLabelAiTaskPrompt('page', profile) },
  ]
  const valueFor = (key: 'global' | AiPromptKey) => settings[key] || ''
  const customized = items.filter((item) => valueFor(item.key)).length
  return renderAdminLayout({
    title: 'AI 提示词管理',
    active: '/admin/ai-prompts', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>🧠 AI 提示词</h2><a href="/admin/ai-settings">模型与参数 →</a></div>
    <p class="admin-help">系统按「默认写作底线 → 你的补充规则 → 当前页面资料 → 当前 AI 通道」组合。默认规则不会被补充提示词删除，所以一句“写得专业一点”不会把 JSON 结构、流程和 SEO 规则一起覆盖掉。</p>
    ${test.status === 'ok' ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px"><strong>「${escapeHtml(test.key || '')}」提示词测试成功</strong><div style="margin-top:6px;font-size:12px;color:var(--muted)">通道：${escapeHtml(test.provider === 'openai_compatible' ? '外部 OpenAI-compatible API' : 'Workers AI')}；模型：${escapeHtml(test.model || '')}</div><div style="margin-top:8px;color:var(--text);white-space:pre-wrap;max-height:360px;overflow:auto">${escapeHtml(test.response || '')}</div><small style="display:block;margin-top:8px;color:var(--muted)">测试不会写入业务数据；用于检查当前生效提示词能否得到文本/指定结构。</small></div>` : ''}
    ${test.status === 'disabled' ? '<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px"><strong>AI 当前已关闭</strong><div style="margin-top:6px">请先在「AI 设置」开启 AI 内容生成，再测试提示词。</div></div>' : ''}
    ${test.status === 'error' ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px"><strong>提示词测试失败</strong><div style="margin-top:6px">${escapeHtml(test.error || '未知错误')}</div></div>` : ''}
    ${saved === 'all' ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px"><strong>已统一识别并保存 ${test.genCount || 0} 个任务的行业化提示词</strong><div style="margin-top:6px;font-size:12px">下面每个卡片都可以继续人工微调后单独保存。</div></div>` : ''}
    ${test.genKey ? `<div class="card" style="border-left:4px solid #16a34a;margin-bottom:16px"><strong>🎯 已为「${escapeHtml(test.genKey)}」生成行业化提示词</strong><div style="margin:6px 0;font-size:12px;color:var(--muted)">已回填到下方对应输入框，请人工微调后再点该卡片右下角「保存」。</div><pre style="white-space:pre-wrap;max-height:240px;overflow:auto;background:#f8fafc;padding:10px;border-radius:8px;font-size:12px;line-height:1.7;margin:0">${escapeHtml(test.genText || '')}</pre></div>` : ''}

    <div class="card ai-prompt-unify">
      <div class="ai-prompt-unify-copy">
        <strong>🎯 统一识别并生成提示词</strong>
        <p>AI 读取站点行业、主题、核心服务与已有关键词，<strong>一次性</strong>为全部 ${items.length} 个任务生成行业化补充提示词并直接保存。不需要逐个任务点生成。</p>
      </div>
      <div class="ai-prompt-unify-actions">
        <form method="post" action="/admin/ai-prompts/generate-for-industry" style="margin:0">
          <input type="hidden" name="prompt_key" value="all" />
          <button class="btn" type="submit" onclick="return confirm('将基于当前站点行业画像，为全部 ${items.length} 个任务生成行业化提示词并直接保存（会覆盖现有自定义内容）。继续？')">一键识别并生成全部</button>
        </form>
        <form method="post" action="/admin/settings/generate-industry-keywords" style="margin:0">
          <button class="btn secondary" type="submit">🏷️ 识别行业关键词</button>
        </form>
      </div>
      <p class="ai-prompt-unify-note">建议顺序：先在「系统设置」完善行业、主题与核心服务 → 点「识别行业关键词」→ 再点「一键识别并生成全部」→ 最后人工微调个别任务。</p>
    </div>

    <div class="card ai-prompt-baseline">
      <div class="ai-prompt-baseline-head">
        <strong>统一 AI 质检底线</strong>
        <span class="badge">自定义 ${customized}/${items.length}</span>
        <span class="badge">默认 ${items.length - customized}/${items.length}</span>
      </div>
      <p>一页一主题；标题 8-45 字；最终 3-5 个主题词且正文有证据；内容要有真实信息、结构和执行/风险说明；不得编造事实或堆关键词。所有任务共用这条底线，无需在每个提示词里重复。</p>
    </div>
    <div class="ai-prompt-grid">
      ${items.map((item) => {
        const current = valueFor(item.key)
        const spec = AI_PROMPT_SPECS[item.key]
        const check = validateAiPromptVariables(item.key, current || item.defaultPrompt)
        const stats = promptTextStats(current || item.defaultPrompt)
        const saveMark = saved === item.key
        const resetMark = saved === item.key + '-reset'
        return `
        <section class="card ai-prompt-card ${item.key === 'global' ? 'ai-prompt-card-global' : ''}">
          <div class="ai-prompt-heading">
            <div><h3>${escapeHtml(spec.title)}</h3><p>${escapeHtml(spec.description)}</p><p style="margin:4px 0 0;color:var(--muted);font-size:12px">作用：${escapeHtml(spec.purpose)}</p></div>
            <span class="badge">${current ? '已自定义' : '系统默认'}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;font-size:12px">
            <span class="badge">约 ${stats.chars} 字符</span>
            <span class="badge">约 ${stats.lines} 行</span>
            <span class="badge">输出：${escapeHtml(spec.output)}</span>
            ${check.unknown.length ? `<span class="badge" style="background:#fff1f0;color:#cf1322">未知变量：${escapeHtml(check.unknown.join('、'))}</span>` : '<span class="badge" style="background:#f6ffed;color:#389e0d">变量检查正常</span>'}
          </div>
          ${saveMark || resetMark ? `<p class="ai-prompt-saved">${resetMark ? '已恢复默认。' : '已保存，自下一次生成立即生效。'}</p>` : ''}
          <form class="admin-form" method="post" action="/admin/ai-prompts/save">
            <input type="hidden" name="prompt_key" value="${escapeHtml(item.key)}" />
            <label>自定义补充提示词 <span class="admin-field-hint">留空使用系统默认；填写内容会叠加在系统默认规则之后</span></label>
            <textarea id="aiPrompt_${item.key}" name="prompt" rows="${item.key === 'global' ? 14 : 11}" maxlength="20000" placeholder="教 AI 怎么写：角色、读者、主搜索意图、结构、语气、需要强调的业务场景、禁止事项、质量标准。不要重复整套系统规则。">${escapeHtml(current)}</textarea>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
              <span style="font-size:12px;color:var(--muted);padding-top:5px">插入变量：</span>
              ${spec.variables.map((v) => `<button type="button" class="btn secondary prompt-var-btn" data-target="aiPrompt_${item.key}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}
            </div>
            <div class="ai-prompt-footer">
              <span>允许变量：${spec.variables.map((v) => `<code>${escapeHtml(v)}</code>`).join('、')}</span>
              <div class="admin-actions"><button class="btn" type="submit">保存</button></div>
            </div>
          </form>
          <details class="ai-prompt-default">
            <summary>标题生成教法</summary>
            <pre>${escapeHtml(AI_TITLE_GENERATION_GUIDES[item.key])}</pre>
          </details>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
            <form method="post" action="/admin/ai-prompts/test">
              <input type="hidden" name="prompt_key" value="${escapeHtml(item.key)}" />
              <button class="btn secondary" type="submit">🧪 测试当前生效提示词</button>
            </form>
            <form method="post" action="/admin/ai-prompts/generate-for-industry">
              <input type="hidden" name="prompt_key" value="${escapeHtml(item.key)}" />
              <button class="btn secondary" type="submit" onclick="return confirm('基于当前站点行业画像，为「${escapeHtml(spec.title)}」生成一段行业化提示词并回填到输入框（不自动保存，需你确认后点保存）。继续？')">🎯 按当前行业生成</button>
            </form>
            <form method="post" action="/admin/ai-prompts/reset" class="ai-prompt-reset">
              <input type="hidden" name="prompt_key" value="${escapeHtml(item.key)}" />
              <button class="btn secondary" type="submit" onclick="return confirm('确认恢复系统默认提示词？当前自定义内容会被清空。')">恢复默认</button>
            </form>
          </div>
          <details class="ai-prompt-default">
            <summary>查看系统默认</summary>
            <pre>${escapeHtml(item.defaultPrompt)}</pre>
          </details>
          <details class="ai-prompt-default">
            <summary>查看本任务测试变量</summary>
            <pre>${escapeHtml(JSON.stringify(spec.sampleVariables, null, 2))}</pre>
          </details>
        </section>`
      }).join('')}
    </div>
    <script>
    document.querySelectorAll('.prompt-var-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        const target = document.getElementById(btn.getAttribute('data-target') || '');
        if (!target) return;
        const value = btn.getAttribute('data-value') || '';
        const start = target.selectionStart == null ? target.value.length : target.selectionStart;
        const end = target.selectionEnd == null ? target.value.length : target.selectionEnd;
        target.value = target.value.slice(0, start) + value + target.value.slice(end);
        target.focus();
        const pos = start + value.length;
        target.setSelectionRange(pos, pos);
      });
    });
    </script>
  `,
  })
}
