import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { getTenantId, readSettingsMap, getGlobalSeoKeywords, saveSetting } from './shared'
import { safeError } from '../../utils/safeLogger'
import { errorMessage } from '../../utils/errors'
import { purgeCacheAll } from '../../middleware/cache'
import {
  validateCaseSlug, suggestCaseSlug, autoCaseSeo, CASE_SLUG_MAX,
} from '../../utils/cases'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { getPageSettings, serializePageSettings, type PageMode } from '../../utils/pageSettings'
import { renderCasesList, renderCaseForm } from '../../templates/adminCases'
import { getAiSettings } from '../../utils/aiSettings'
import { generateAiPageContent } from '../../utils/aiPageContent'

/**
 * 成功案例后台路由。
 *
 * 案例是独立内容类型，内容直接存在 cases 表，不经过 AI 内容存储层。
 * 全部读写都带 tenant_id；slug 在租户内唯一。
 */
export const adminCaseRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

type CaseInput = {
  client_name: string
  slug: string
  industry: string
  service_name: string
  region: string
  summary: string
  challenge: string
  solution: string
  results: string
  testimonial: string
  content: string
  cover_image_url: string
  project_url: string
  sort_order: number
  is_featured: number
  is_active: number
  seo_title: string
  seo_description: string
  seo_keywords: string
}

function readCaseInput(body: Record<string, unknown>): CaseInput {
  const text = (key: string, max: number) => String(body[key] ?? '').trim().slice(0, max)
  const flag = (key: string) => (body[key] ? 1 : 0)
  const parsedOrder = Number.parseInt(String(body.sort_order ?? '0'), 10)
  return {
    client_name: text('client_name', 120),
    slug: text('slug', CASE_SLUG_MAX).toLowerCase(),
    industry: text('industry', 60),
    service_name: text('service_name', 80),
    region: text('region', 60),
    summary: text('summary', 300),
    challenge: text('challenge', 2000),
    solution: text('solution', 3000),
    results: text('results', 1500),
    testimonial: text('testimonial', 600),
    content: String(body.content ?? '').trim().slice(0, 16000),
    cover_image_url: text('cover_image_url', 500),
    project_url: text('project_url', 500),
    sort_order: Number.isFinite(parsedOrder) ? parsedOrder : 0,
    is_featured: flag('is_featured'),
    is_active: flag('is_active'),
    seo_title: text('seo_title', 120),
    seo_description: text('seo_description', 300),
    seo_keywords: text('seo_keywords', 300),
  }
}

/** 表单校验：返回错误信息，或 null 表示通过。 */
function validateCaseInput(input: CaseInput): string | null {
  if (!input.client_name) return '请填写客户名称'
  return validateCaseSlug(input.slug)
}

async function siteNameOf(env: Bindings, tenantId: number): Promise<string> {
  const settings = await readSettingsMap(env, tenantId)
  return String(settings.site_name || env.SITE_NAME || '网站内容平台')
}

const CASE_FIELDS = 'client_name, slug, industry, service_name, region, summary, challenge, solution, results, testimonial, content, cover_image_url, project_url, sort_order, is_featured, is_active, seo_title, seo_description, seo_keywords'

function caseValues(input: CaseInput): Array<string | number> {
  return [
    input.client_name, input.slug, input.industry, input.service_name, input.region,
    input.summary, input.challenge, input.solution, input.results, input.testimonial,
    input.content, input.cover_image_url, input.project_url, input.sort_order,
    input.is_featured, input.is_active, input.seo_title, input.seo_description, input.seo_keywords,
  ]
}

async function listRedirect(c: any, message: string) {
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cases?message=' + encodeURIComponent(message))
}

// ---- 列表 ----
adminCaseRoutes.get('/cases', async (c) => {
  const tenantId = getTenantId(c)
  let rows: any[] = []
  try {
    rows = (await c.env.DB.prepare(
      'SELECT * FROM cases WHERE tenant_id = ? ORDER BY is_featured DESC, sort_order, id',
    ).bind(tenantId).all()).results as any[]
  } catch (e) {
    safeError('D1 cases list failed', e)
    return c.html(renderCasesList([], { error: '读取案例失败：' + errorMessage(e, '未知错误') }))
  }
  // 案例页的页面级设置（标题/副标题/模式/留言表单）直接在本页编辑：
  // 之前它只存在于「页面 → 前台页面 → 成功案例」，站长在案例管理里找不到，
  // 会以为"前台成功案例设置错了/改不了"。
  const settings = await readSettingsMap(c.env, tenantId)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("csrfToken") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  const page = getPageSettings(settings).cases
  return c.html(renderCasesList(rows as any, {
    message: c.req.query('message') || '',
    error: c.req.query('error') || '',
    saved: c.req.query('saved') === '1',
    page,
  }, siteName, cspNonce, csrfToken))
})

// 案例页页面级设置：与「前台页面 → 成功案例」写同一份 page_settings_json，
// 两处入口等价，改哪边都生效。
adminCaseRoutes.post('/cases/page-settings', async (c) => {
  const tenantId = getTenantId(c)
  const b = await c.req.parseBody()
  const settings = await readSettingsMap(c.env, tenantId)
  const pages = getPageSettings(settings)
  const current = pages.cases
  const modeRaw = String(b.mode || '')
  const mode: PageMode = modeRaw === 'external' || modeRaw === 'hidden' ? modeRaw : 'internal'
  const externalUrl = String(b.external_url || '').trim().slice(0, 500)
  if (mode === 'external' && !/^https?:\/\//i.test(externalUrl)) {
    return c.redirect('/admin/cases?error=' + encodeURIComponent('选择「外站链接」时必须填写以 http(s):// 开头的完整地址。'))
  }
  pages.cases = {
    ...current,
    mode,
    externalUrl: mode === 'external' ? externalUrl : '',
    titleZh: String(b.title_zh || '').trim().slice(0, 200),
    subtitleZh: String(b.subtitle_zh || '').trim().slice(0, 500),
    showForm: ['on', '1', 'true', 'yes'].includes(String(b.show_form || '').trim().toLowerCase()),
  }
  await saveSetting(c.env, 'page_settings_json', serializePageSettings(pages), tenantId)
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/cases?saved=1')
})

// ---- 新增 ----
adminCaseRoutes.get('/cases/new', async (c) => {
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("csrfToken") || ""

  return c.html(renderCaseForm(null, {
    error: c.req.query('error') || '',
  }, siteName, cspNonce))
})

// AI 生成正文（新增案例时预填，保存前可再编辑）
adminCaseRoutes.post('/cases/ai-content', async (c) => {
  const tenantId = getTenantId(c)
  const body = await c.req.parseBody() as Record<string, unknown>
  const clientName = String(body.client_name || '').trim()
  const industry = String(body.industry || '').trim()
  const serviceName = String(body.service_name || '').trim()
  const region = String(body.region || '').trim()
  const summary = String(body.summary || '').trim()
  const challenge = String(body.challenge || '').trim()
  const solution = String(body.solution || '').trim()
  const results = String(body.results || '').trim()
  const testimonial = String(body.testimonial || '').trim()

  const aiSettings = await getAiSettings(c.env, tenantId)
  if (!aiSettings.enabled) {
    return c.html(renderCaseForm(null, {
      error: '',
      aiError: 'AI 功能当前已停用，请先到「AI 通道」启用。',
      aiContent: body.content ? String(body.content) : '',
      aiSummary: summary,
    }), 400)
  }

  const facts = [
    clientName ? '客户：' + clientName : '',
    industry ? '行业：' + industry : '',
    serviceName ? '采用服务：' + serviceName : '',
    region ? '服务地区：' + region : '',
    summary ? '摘要：' + summary : '',
    challenge ? '项目挑战：' + challenge : '',
    solution ? '解决方案：' + solution : '',
    results ? '成果数据：' + results.replace(/\s*\n\s*/g, '；') : '',
    testimonial ? '客户评价：' + testimonial : '',
  ].filter(Boolean).join('\n')

  if (!facts) {
    return c.html(renderCaseForm(null, {
      error: '',
      aiError: '案例信息太少，请先填写客户名称、项目挑战或成果数据，再让 AI 扩写。',
      aiContent: body.content ? String(body.content) : '',
      aiSummary: summary,
    }), 400)
  }

  let generated
  try {
    generated = await generateAiPageContent(c.env, tenantId, {
      type: 'page',
      pageLabel: String(clientName || '成功案例') + '成功案例',
      pagePath: '/case/' + String(body.slug || ''),
      title: String(clientName || '') + '成功案例',
      summary,
      sourceContent: facts,
    }, aiSettings)
  } catch (e) {
    safeError('case AI content generation failed', e)
    return c.html(renderCaseForm(null, {
      error: '',
      aiError: 'AI 生成案例正文失败：' + errorMessage(e, '未知错误').slice(0, 300),
      aiContent: body.content ? String(body.content) : '',
      aiSummary: summary,
    }), 400)
  }

  if (!generated?.content) {
    return c.html(renderCaseForm(null, {
      error: '',
      aiError: 'AI 没有返回可用的案例正文，请检查 AI 通道设置或补充更多案例信息后重试。',
      aiContent: body.content ? String(body.content) : '',
      aiSummary: summary,
    }), 400)
  }

  return c.html(renderCaseForm(null, {
    error: '',
    aiNotice: 'AI 已生成案例正文，可在下方「案例正文」中查看和继续修改，然后保存。',
    aiContent: generated.content,
    aiSummary: generated.summary || summary,
  }))
})

adminCaseRoutes.post('/cases/new', async (c) => {
  const tenantId = getTenantId(c)
  const body = await c.req.parseBody() as Record<string, unknown>
  const input = readCaseInput(body)
  const problem = validateCaseInput(input)
  if (problem) return c.html(renderCaseForm(null, { error: problem }), 400)

  try {
    const duplicate = await c.env.DB.prepare(
      'SELECT id FROM cases WHERE tenant_id = ? AND slug = ? LIMIT 1',
    ).bind(tenantId, input.slug).first()
    if (duplicate) return c.html(renderCaseForm(null, { error: '已经有一个案例使用这个网址标识（' + input.slug + '），请换一个。' }), 400)

    // SEO 三要素留空时按客户名/行业/服务/地区自动补全，保证案例一建立就是可收录状态。
    if (!input.seo_title || !input.seo_description || !input.seo_keywords) {
      const seo = autoCaseSeo(
        { clientName: input.client_name, industry: input.industry, serviceName: input.service_name, region: input.region, summary: input.summary },
        await siteNameOf(c.env, tenantId),
        await getGlobalSeoKeywords(c.env, tenantId),
      )
      if (!input.seo_title) input.seo_title = seo.seo_title
      if (!input.seo_description) input.seo_description = seo.seo_description
      if (!input.seo_keywords) input.seo_keywords = seo.seo_keywords
    }

    await c.env.DB.prepare(
      `INSERT INTO cases (tenant_id, ${CASE_FIELDS}) VALUES (?, ${CASE_FIELDS.split(',').map(() => '?').join(', ')})`,
    ).bind(tenantId, ...caseValues(input)).run()
  } catch (e) {
    safeError('case insert failed', e)
    return c.html(renderCaseForm(null, { error: '保存失败：' + errorMessage(e, '请检查网址标识是否重复') }), 400)
  }
  return listRedirect(c, '案例已创建，前台 /case 立即可访问。')
})

// ---- 编辑 ----
adminCaseRoutes.get('/cases/:id/edit', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT * FROM cases WHERE id = ? AND tenant_id = ?',
  ).bind(c.req.param('id'), getTenantId(c)).first() as any
  if (!row) return c.notFound()
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("csrfToken") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderCaseForm(row, {
    error: c.req.query('error') || '',
    aiError: c.req.query('ai_error') || '',
    aiNotice: c.req.query('ai_generated') === '1' ? 'AI 已生成案例正文并保存，可在下方「案例正文」中查看和继续修改。' : '',
  }, siteName, cspNonce, csrfToken))
})

adminCaseRoutes.post('/cases/:id/edit', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const current = await c.env.DB.prepare(
    'SELECT * FROM cases WHERE id = ? AND tenant_id = ?',
  ).bind(id, tenantId).first() as any
  if (!current) return c.notFound()

  const body = await c.req.parseBody() as Record<string, unknown>
  const input = readCaseInput(body)
  const problem = validateCaseInput(input)
  if (problem) return c.html(renderCaseForm(current, { error: problem }), 400)

  try {
    const duplicate = await c.env.DB.prepare(
      'SELECT id FROM cases WHERE tenant_id = ? AND slug = ? AND id <> ? LIMIT 1',
    ).bind(tenantId, input.slug, id).first()
    if (duplicate) return c.html(renderCaseForm(current, { error: '已经有一个案例使用这个网址标识（' + input.slug + '），请换一个。' }), 400)

    if (!input.seo_title || !input.seo_description || !input.seo_keywords) {
      const seo = autoCaseSeo(
        { clientName: input.client_name, industry: input.industry, serviceName: input.service_name, region: input.region, summary: input.summary },
        await siteNameOf(c.env, tenantId),
        await getGlobalSeoKeywords(c.env, tenantId),
      )
      if (!input.seo_title) input.seo_title = seo.seo_title
      if (!input.seo_description) input.seo_description = seo.seo_description
      if (!input.seo_keywords) input.seo_keywords = seo.seo_keywords
    }

    await c.env.DB.prepare(
      `UPDATE cases SET ${CASE_FIELDS.split(',').map((f) => f.trim() + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
    ).bind(...caseValues(input), id, tenantId).run()
  } catch (e) {
    safeError('case update failed', e)
    return c.html(renderCaseForm(current, { error: '保存失败：' + errorMessage(e, '请检查网址标识是否重复') }), 400)
  }
  return listRedirect(c, '案例已保存。')
})

// ---- 删除 ----
adminCaseRoutes.post('/cases/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  try {
    await c.env.DB.prepare('DELETE FROM cases WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run()
  } catch (e) {
    safeError('case delete failed', e)
    return c.redirect('/admin/cases?error=' + encodeURIComponent('删除失败：' + errorMessage(e, '未知错误')))
  }
  return listRedirect(c, '案例已删除。')
})

// ---- 自动 SEO ----
adminCaseRoutes.post('/cases/:id/auto-seo', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const current = await c.env.DB.prepare(
    'SELECT * FROM cases WHERE id = ? AND tenant_id = ?',
  ).bind(id, tenantId).first() as any
  if (!current) return c.notFound()
  const seo = autoCaseSeo(
    {
      clientName: String(current.client_name || ''),
      industry: String(current.industry || ''),
      serviceName: String(current.service_name || ''),
      region: String(current.region || ''),
      summary: String(current.summary || ''),
    },
    await siteNameOf(c.env, tenantId),
    await getGlobalSeoKeywords(c.env, tenantId),
  )
  await c.env.DB.prepare(
    "UPDATE cases SET seo_title = ?, seo_description = ?, seo_keywords = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
  ).bind(seo.seo_title, seo.seo_description, seo.seo_keywords, id, tenantId).run()
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cases/' + encodeURIComponent(String(id)) + '/edit?ai_generated=0')
})

// ---- AI 生成正文 ----
adminCaseRoutes.post('/cases/:id/ai-content', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const current = await c.env.DB.prepare(
    'SELECT * FROM cases WHERE id = ? AND tenant_id = ?',
  ).bind(id, tenantId).first() as any
  if (!current) return c.notFound()

  const aiSettings = await getAiSettings(c.env, tenantId)
  if (!aiSettings.enabled) {
    return c.redirect('/admin/cases/' + encodeURIComponent(String(id)) + '/edit?ai_error=' + encodeURIComponent('AI 功能当前已停用，请先到「AI 通道」启用。'))
  }

  const editUrl = '/admin/cases/' + encodeURIComponent(String(id)) + '/edit'
  try {
    const facts = [
      current.client_name ? '客户：' + current.client_name : '',
      current.industry ? '行业：' + current.industry : '',
      current.service_name ? '采用服务：' + current.service_name : '',
      current.region ? '服务地区：' + current.region : '',
      current.summary ? '摘要：' + current.summary : '',
      current.challenge ? '项目挑战：' + current.challenge : '',
      current.solution ? '解决方案：' + current.solution : '',
      current.results ? '成果数据：' + String(current.results).replace(/\s*\n\s*/g, '；') : '',
      current.testimonial ? '客户评价：' + current.testimonial : '',
    ].filter(Boolean).join('\n')

    if (!facts) {
      return c.redirect(editUrl + '?ai_error=' + encodeURIComponent('案例信息太少，请先填写客户名称、项目挑战或成果数据，再让 AI 扩写。'))
    }

    const generated = await generateAiPageContent(c.env, tenantId, {
      type: 'page',
      pageLabel: String(current.client_name || '成功案例') + '成功案例',
      pagePath: '/case/' + String(current.slug || ''),
      title: String(current.client_name || '') + '成功案例',
      summary: String(current.summary || ''),
      sourceContent: facts,
    }, aiSettings)

    if (!generated?.content) {
      return c.redirect(editUrl + '?ai_error=' + encodeURIComponent('AI 没有返回可用的案例正文，请检查 AI 通道设置或补充更多案例信息后重试。'))
    }

    // 只回填正文；摘要为空时一并补上，避免前台卡片空白。
    if (!String(current.summary || '').trim() && generated.summary) {
      await c.env.DB.prepare(
        "UPDATE cases SET content = ?, summary = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
      ).bind(generated.content, String(generated.summary).slice(0, 300), id, tenantId).run()
    } else {
      await c.env.DB.prepare(
        "UPDATE cases SET content = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
      ).bind(generated.content, id, tenantId).run()
    }
  } catch (e) {
    safeError('case AI content generation failed', e)
    return c.redirect(editUrl + '?ai_error=' + encodeURIComponent(errorMessage(e, 'AI 生成案例正文失败').slice(0, 300)))
  }

  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect(editUrl + '?ai_generated=1')
})
