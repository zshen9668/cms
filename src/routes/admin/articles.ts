import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, getGlobalSeoKeywords, getArticleAiKeywords, escapeStatus, escapeForPreview, escapeHtml, loadArticleAndCity, getTenantId, getContactMethods, permanentlyDeleteMediaObject, getAiRouteStatus, aiEmptyResultMessage, errorMessage } from './shared'
import { safeError } from '../../utils/safeLogger'
import { captureVersion } from '../../plugins/versioning'
import { purgeCacheAll } from '../../middleware/cache'
import { notifyPublishedUrl, notifyDeletedUrl } from '../../utils/seo'
import { generateInterpretationCard } from '../../utils/interpretationCard'
import { buildWechatHtml } from '../../utils/wechatFormat'
import { PLATFORMS, PLATFORM_LIST, type PlatformKey } from '../../utils/socialPlatforms'
import { generateSocialContent, buildPlainCopyText, buildRichCopyHtml } from '../../utils/socialFormat'
import { syncPublishedArticleToDomesticPlatforms } from '../../utils/socialSync'
import { resolveSiteUrl } from '../../utils/siteUrl'
import { autoArticleSeo } from '../../utils/autoSeo'
import { getPageContact } from '../../utils/pageContacts'
import { generateAiPageContent } from '../../utils/aiPageContent'
import { statusAfterAiDraft } from '../../services/newsPipeline'
import { buildFaqJsonFromBody, hasFaqEditorFields } from '../../utils/articleSchema'
import { validateImageFile } from '../../utils/pageImages'
import { removePageContact, deleteArticleD1Relations } from '../../utils/resourceCleanup'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { renderLayout } from '../../templates/layout'
import { renderArticlePage } from '../../templates/public'
import {
  renderLoginPage, renderSetupPage, renderRecoverPage, renderDashboard, renderArticlesList, renderArticleForm, renderArticleAiPreview,
  renderKeywordsList, renderKeywordForm, renderMessagesList, renderNewsSourcesList,
  renderSeoPage, renderGeoPage, renderSocialDistributionPage, renderSocialSettingsPage, renderSettingsPage, renderCityForm, renderServiceForm, renderCollectionLogsList,
  renderSystemPage, renderAiSettingsPage, renderAiPromptsPage, renderAdminLayout, renderWechatEditor, renderSocialHub, renderSocialEditor, renderMediaPage, renderPageSettingsPage, renderSubprojectsList, renderSubprojectForm,
} from '../../templates/admin'

export const adminArticlesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminArticlesRoutes.get('/articles', async (c) => {
  const tenantId = getTenantId(c)
  const statusFilter = c.req.query('status')
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  if (statusFilter === 'review_logs') {
    let rows: Array<{ id: number; title: string; action: string; operator: string; note: string; created_at: string }> = []
    try {
      const result = await c.env.DB.prepare(
        `SELECT r.id, a.title, r.action, r.operator, r.note, r.created_at
         FROM review_logs r
         LEFT JOIN articles a ON a.id = r.article_id
         WHERE r.tenant_id = ?
         ORDER BY r.created_at DESC, r.id DESC LIMIT 100`
      ).bind(tenantId).all() as any
      rows = (result.results || []).map((r: any) => ({
        id: Number(r.id),
        title: String(r.title || ''),
        action: String(r.action || ''),
        operator: String(r.operator || ''),
        note: String(r.note || ''),
        created_at: String(r.created_at || ''),
      }))
    } catch (e) {
      safeError('review logs read failed', e)
    }
    const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderArticlesList(rows as any, statusFilter, siteName, cspNonce, csrfToken))
  }

  const where = statusFilter ? `WHERE a.status = ? AND a.tenant_id = ?` : 'WHERE a.tenant_id = ?'
  const stmt = c.env.DB.prepare(`SELECT a.id, a.title, a.category, a.city_id, a.status, a.source_name, a.ai_generated, a.credibility_score, a.reject_reason, a.created_at, ci.name as city_name FROM articles a LEFT JOIN cities ci ON ci.id = a.city_id ${where} ORDER BY a.created_at DESC LIMIT 100`)
  const rows = (statusFilter ? await stmt.bind(statusFilter, tenantId).all() : await stmt.bind(tenantId).all()).results

  return c.html(renderArticlesList(rows as any, statusFilter, siteName, cspNonce, csrfToken))
})

adminArticlesRoutes.get('/articles/new', async (c) => {
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderArticleForm(undefined, String(c.req.query('error') || '').trim(), siteName, cspNonce, csrfToken))
})

adminArticlesRoutes.post('/articles/image-upload-page', async (c) => {
  const body = await c.req.parseBody()
  const file = body.file instanceof File ? body.file : null
  if (!file || !file.name) return c.html('<h3>请选择图片</h3><p><a href="javascript:history.back()">返回</a></p>', 400)
  let actualType: string
  try { actualType = await validateImageFile(file, true) } catch (e) { return c.html('<h3>' + escapeHtml(String((e as any)?.message || '图片格式无效')) + '</h3><p><a href="javascript:history.back()">返回</a></p>', 400) }
  const ext = actualType === 'image/jpeg' ? 'jpg' : actualType.split('/')[1]
  const objectKey = 'media/articles/' + crypto.randomUUID() + '.' + ext
  const object = await c.env.R2_MEDIA.put(objectKey, file.stream(), { httpMetadata: { contentType: actualType, contentDisposition: 'inline' }, customMetadata: { purpose: 'article-image', originalName: file.name } })
  await c.env.DB.prepare('INSERT INTO media_assets (object_key, original_name, content_type, size, etag) VALUES (?, ?, ?, ?, ?)').bind(objectKey, file.name, actualType, file.size, object?.etag || null).run()
  const url = '/media/' + objectKey.slice('media/'.length)
  const snippet = '<p><img src="' + url + '" alt="' + escapeHtml(file.name.replace(/\.[^.]+$/, '').slice(0, 120)) + '" /></p>'
  return c.html('<main style="font:16px system-ui;max-width:760px;margin:40px auto;padding:20px"><h2>图片上传成功</h2><p>图片地址：</p><input style="width:100%;padding:10px" value="' + escapeHtml(url) + '" readonly onclick="this.select()" /><p>正文配图 HTML：</p><textarea style="width:100%;height:100px" onclick="this.select()">' + escapeHtml(snippet) + '</textarea><p><button onclick="navigator.clipboard.writeText(document.querySelector(\'input\').value)">复制图片地址</button> <button onclick="navigator.clipboard.writeText(document.querySelector(\'textarea\').value)">复制配图HTML</button></p><p><a href="javascript:history.back()">返回文章编辑</a>　<a href="/admin/media">打开媒体库</a></p></main>')
})

adminArticlesRoutes.post('/articles/ai-preview', async (c) => {
  const b = await c.req.parseBody()
  const title = String(b.title || '').trim()
  const target = String(b.article_id || '').trim() ? '/admin/articles/' + encodeURIComponent(String(b.article_id || '').trim()) + '/edit' : '/admin/articles/new'
  if (!title) return c.redirect(target + '?error=' + encodeURIComponent('请先填写文章标题，再生成 AI 正文预览。'))
  const summary = String(b.summary || '').trim()
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c))
  const routeStatus = await getAiRouteStatus(c.env)
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  if (!routeStatus.ok) return c.redirect(target + '?error=' + encodeURIComponent(routeStatus.message))
  let ai: Awaited<ReturnType<typeof generateAiPageContent>>
  try { ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'article', title, summary, keywords: getArticleAiKeywords(title, summary) }, routeStatus.settings) } catch (e) { safeError('AI article preview generation failed', e); return c.redirect(target + '?error=' + encodeURIComponent(errorMessage(e, 'AI文章预览生成失败').slice(0, 220))) }
  if (!ai) return c.redirect(target + '?error=' + encodeURIComponent(aiEmptyResultMessage('AI文章生成', routeStatus.settings).slice(0, 220)))
  return c.html(renderArticleAiPreview({ articleId: String(b.article_id || '').trim(), title, slug: String(b.slug || '').trim(), category: String(b.category || '').trim(), summary, seoTitle: autoArticleSeo({ title, summary: ai.summary || summary, content: ai.content }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords).seo_title, seoDescription: autoArticleSeo({ title, summary: ai.summary || summary, content: ai.content }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords).seo_description, seoKeywords: autoArticleSeo({ title, summary: ai.summary || summary, content: ai.content }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords).seo_keywords, aiTitle: ai.title, aiSummary: ai.summary, aiContent: ai.content, siteName, cspNonce, csrfToken }))
})

adminArticlesRoutes.post('/articles/ai-publish', async (c) => {
  const b = await c.req.parseBody()
  const id = String(b.article_id || '').trim(), title = String(b.title || '').trim()
  if (!title) return c.text('请先填写文章标题。', 400)
  const summary = String(b.summary || '').trim(), category = String(b.category || '').trim(), requestedSlug = String(b.slug || '').trim()
  let ai: Awaited<ReturnType<typeof generateAiPageContent>>
  try { ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'article', title, summary, keywords: getArticleAiKeywords(title, summary) }) } catch (e) { safeError('AI article generation failed', e); return c.text(errorMessage(e, 'AI文章生成失败'), 503) }
  if (!ai) return c.text('AI 未返回满足质量门槛的文章内容，请检查「AI设置」中的开关和模型。', 503)
  const finalSummary = ai.summary || summary
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c))
  const seo = autoArticleSeo({ title, summary: finalSummary, content: ai.content }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords)
  const cardSvg = await generateInterpretationCard(c.env, { title, summary: finalSummary }, getTenantId(c))
  if (id) {
    const tenantId = getTenantId(c)
    const existing = await c.env.DB.prepare('SELECT id FROM articles WHERE id=? AND tenant_id=?').bind(id, tenantId).first()
    if (!existing) return c.notFound()
    await c.env.DB.prepare("UPDATE articles SET title=?, category=?, summary=?, content=?, status='pending_review', ai_generated=1, seo_title=?, seo_description=?, seo_keywords=?, card_svg=?, published_at=NULL, updated_at=datetime('now') WHERE id=? AND tenant_id=?").bind(title, category, finalSummary, ai.content, seo.seo_title, seo.seo_description, seo.seo_keywords, cardSvg, id, tenantId).run()
    await c.env.DB.prepare("INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)").bind(id, 'ai_generate', 'AI', 'AI生成正文 + SEO 完成，进入人工审核，暂不公开').run()
  } else {
    const slug = requestedSlug || ('article-' + Date.now())
    const tenantId = getTenantId(c)
    const inserted = await c.env.DB.prepare("INSERT INTO articles (title, slug, category, summary, content, status, ai_generated, seo_title, seo_description, seo_keywords, card_svg, published_at, tenant_id) VALUES (?, ?, ?, ?, ?, 'pending_review', 1, ?, ?, ?, ?, NULL, ?) RETURNING id").bind(title, slug, category, finalSummary, ai.content, seo.seo_title, seo.seo_description, seo.seo_keywords, cardSvg, tenantId).first() as any
    if (!inserted?.id) return c.text('文章写入成功但未取得文章ID，请重试。', 500)
    await c.env.DB.prepare("INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)").bind(inserted.id, 'pending_review', 'AI', 'AI生成正文 + SEO 完成，进入人工审核，暂不公开').run()
  }
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/articles?status=pending_review')
})

adminArticlesRoutes.post('/articles/:id/ai-optimize', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c)
  const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
  if (!article) return c.notFound()
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c))
  try {
    const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'article', title: String(article.title || ''), summary: String(article.summary || ''), keywords: getArticleAiKeywords(String(article.title || ''), String(article.summary || '')), sourceContent: String(article.content || '').slice(0, 6000) })
    if (!ai) return c.redirect('/admin/articles/' + id + '/edit?error=' + encodeURIComponent('AI优化未得到可保存内容，请到「AI设置」执行 Workers AI 测试后再重试'))
    const sourceUrl = String(article.source_url || '').trim(), sourceLink = sourceUrl ? '<p><strong>原文章链接：</strong><a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="nofollow noopener">' + escapeHtml(sourceUrl) + '</a></p>' : ''
    const content = String(ai.content || '').trim() + sourceLink
    const seo = autoArticleSeo({ title: ai.title || article.title, summary: ai.summary || article.summary, content: ai.content }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords)
    const wasPublished = String(article.status || '') === 'published'
    await c.env.DB.prepare('UPDATE articles SET title=?, summary=?, content=?, seo_title=?, seo_description=?, seo_keywords=?, status=CASE WHEN status=\'published\' THEN \'pending_review\' ELSE status END, updated_at=datetime(\'now\') WHERE id=? AND tenant_id=?').bind(String(ai.title || article.title).trim(), String(ai.summary || article.summary).trim(), content, seo.seo_title, seo.seo_description, seo.seo_keywords, id, tenantId).run()
    await c.env.DB.prepare('INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)').bind(id, 'ai_optimize', 'AI自动', wasPublished ? 'AI优化已使原公开文章撤回待审核；原文章链接已保留。' : 'AI优化现有文章；原文章链接已保留。').run()
    if (wasPublished) { const updatedSiteUrl = await resolveSiteUrl(c); notifyDeletedUrl(c.env, updatedSiteUrl + '/article/' + encodeURIComponent(String(article.slug || id)), updatedSiteUrl, c.executionCtx) }
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/articles/' + id + '/edit?ai=1')
  } catch (e) { safeError('AI article optimize failed', e); return c.redirect('/admin/articles/' + id + '/edit?error=' + encodeURIComponent(errorMessage(e, 'AI优化失败'))) }
})

adminArticlesRoutes.post('/articles/new', async (c) => {
  const b = await c.req.parseBody(), slug = String(b.slug || '').trim() || `article-${Date.now()}`
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c))
  let requestedStatus = ['draft', 'pending_review', 'published'].includes(String(b.status || '')) ? String(b.status) : 'draft'
  if (String(b.from_ai_preview || '') === '1' && requestedStatus === 'published') requestedStatus = 'pending_review'
  let articleContent = String(b.content || '').trim(), aiDraftGenerated = false
  if (!articleContent) { aiDraftGenerated = true; try { const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'article', title: String(b.title || ''), summary: String(b.summary || ''), keywords: getArticleAiKeywords(String(b.title || ''), String(b.summary || '')) }); if (!ai?.content) return c.redirect('/admin/articles/new?error=' + encodeURIComponent('正文为空且 AI 未生成有效内容，请先在「AI设置」测试 AI 通道，或填写正文后保存。')); articleContent = ai.content } catch (e) { safeError('new article AI draft generation failed', e); return c.redirect('/admin/articles/new?error=' + encodeURIComponent(errorMessage(e, '正文为空，AI 生成失败；请检查「AI设置」或先填写正文。').slice(0, 220))) } }
  const finalStatus = (aiDraftGenerated || String(b.from_ai_preview || '') === '1') ? statusAfterAiDraft(requestedStatus) : requestedStatus
  const generatedSeo = autoArticleSeo({ title: String(b.title || ''), summary: String(b.summary || ''), content: articleContent }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords)
  const seoTitle = generatedSeo.seo_title, seoDescription = generatedSeo.seo_description, seoKeywords = generatedSeo.seo_keywords
  let cardSvg: string | null = null
  if (finalStatus === 'published') cardSvg = await generateInterpretationCard(c.env, { title: String(b.title), summary: String(b.summary || '') }, getTenantId(c))
  const newArticleTenantId = getTenantId(c)
  const faqJson = buildFaqJsonFromBody(b)
  await c.env.DB.prepare(`INSERT INTO articles (title, slug, category, summary, content, status, seo_title, seo_description, seo_keywords, card_svg, cover_image, faq_json, published_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END, ?)`).bind(b.title, slug, b.category || '', b.summary || '', articleContent, finalStatus, seoTitle, seoDescription, seoKeywords, cardSvg, String(b.cover_image || '').trim().slice(0, 500), faqJson, finalStatus, newArticleTenantId).run()
  const created = await c.env.DB.prepare('SELECT id FROM articles WHERE slug=? AND tenant_id=?').bind(slug, newArticleTenantId).first() as any
  if (created?.id) { await captureVersion(c.env, newArticleTenantId, Number(created.id)); if (aiDraftGenerated) { await c.env.DB.prepare('INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)').bind(created.id, 'ai_generate', 'AI', '空正文由 AI 辅助补齐，已进入人工审核；不能因表单选择直接公开。').run() } if (finalStatus === 'published') { const publishedSiteUrl = await resolveSiteUrl(c); notifyPublishedUrl(c.env, publishedSiteUrl + '/article/' + encodeURIComponent(slug), publishedSiteUrl, c.executionCtx); c.executionCtx.waitUntil(syncPublishedArticleToDomesticPlatforms(c.env, Number(created.id)).catch((e) => safeError('new published article platform sync failed', e))) } }
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/articles')
})

adminArticlesRoutes.get('/articles/:id/edit', async (c) => {
  const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), getTenantId(c)).first()
  if (!article) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  const pageContact = getPageContact(settings, 'article:' + String((article as any).id), getContactMethods(settings))
  const error = String(c.req.query('error') || '').trim()
  return c.html(renderArticleForm(article, error, siteName, cspNonce, csrfToken))
})

adminArticlesRoutes.post('/articles/:id/edit', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c), b = await c.req.parseBody()
  const existing = await c.env.DB.prepare('SELECT status, card_svg, slug, faq_json FROM articles WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!existing) return c.notFound()
  let status: 'draft' | 'pending_review' | 'published' = ['draft', 'pending_review', 'published'].includes(String(b.status || '')) ? String(b.status) as 'draft' | 'pending_review' | 'published' : (['draft', 'pending_review', 'published'].includes(String(existing.status || '')) ? String(existing.status) as 'draft' | 'pending_review' | 'published' : 'draft')
  let aiDraftGenerated = false
  let slug = String(b.slug || existing.slug || '').trim().replace(/^\/+|\/+$/g, '')
  if (!slug) slug = 'article-' + id
  const sameSlug = await c.env.DB.prepare('SELECT id FROM articles WHERE slug=? AND tenant_id=? AND id<>? LIMIT 1').bind(slug, tenantId, id).first()
  if (sameSlug) slug = slug + '-' + id
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c))
  if (String(b.from_ai_preview || '') === '1' && status === 'published') status = 'pending_review'
  let articleContent = String(b.content || '').trim()
  if (!articleContent) { aiDraftGenerated = true; try { const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'article', title: String(b.title || ''), summary: String(b.summary || ''), keywords: getArticleAiKeywords(String(b.title || ''), String(b.summary || '')) }); if (!ai?.content) return c.redirect('/admin/articles/' + encodeURIComponent(id) + '/edit?error=' + encodeURIComponent('正文为空且 AI 未生成有效内容，请先在「AI设置」测试 AI 通道，或填写正文后保存。')); articleContent = ai.content; status = statusAfterAiDraft(status) } catch (e) { safeError('edit article AI draft generation failed', e); return c.redirect('/admin/articles/' + encodeURIComponent(id) + '/edit?error=' + encodeURIComponent(errorMessage(e, '正文为空，AI 生成失败；请检查「AI设置」或先填写正文。').slice(0, 220))) } }
  let cardSvg = existing?.card_svg || null
  if (status === 'published' && !cardSvg) cardSvg = await generateInterpretationCard(c.env, { title: String(b.title), summary: String(b.summary || '') }, getTenantId(c))
  const generatedSeo = autoArticleSeo({ title: String(b.title || ''), summary: String(b.summary || ''), content: articleContent }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords)
  const seoTitle = generatedSeo.seo_title, seoDescription = generatedSeo.seo_description, seoKeywords = generatedSeo.seo_keywords
  const wasPublished = String(existing.status || '') === 'published', oldSlug = String(existing.slug || '').trim()
  // AI 预览/AI 发布等入口的表单里没有 FAQ 编辑器。用隐藏标记 faq_editor 区分
  // 「用户清空了问答」和「这个入口根本没有 FAQ 字段」——后者必须保留数据库里已有的问答。
  const hasFaqFields = hasFaqEditorFields(b)
  const faqJson = hasFaqFields ? buildFaqJsonFromBody(b) : String(existing.faq_json || '')
  await c.env.DB.prepare(`UPDATE articles SET title=?, slug=?, category=?, summary=?, content=?, status=?, seo_title=?, seo_description=?, seo_keywords=?, card_svg=?, cover_image=?, faq_json=?, updated_at=datetime('now'), published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN datetime('now') ELSE published_at END WHERE id=?`).bind(b.title, slug, b.category || '', b.summary || '', articleContent, status, seoTitle, seoDescription, seoKeywords, cardSvg, String(b.cover_image || '').trim().slice(0, 500), faqJson, status, id).run()
  await captureVersion(c.env, getTenantId(c), Number(id))
  if (aiDraftGenerated) await c.env.DB.prepare('INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)').bind(id, 'ai_generate', 'AI', '空正文由 AI 辅助补齐，已进入人工审核；请人工确认后再发布。').run()
  const changedSiteUrl = await resolveSiteUrl(c), changedArticleUrl = changedSiteUrl + '/article/' + encodeURIComponent(slug)
  if (wasPublished && oldSlug && oldSlug !== slug) notifyDeletedUrl(c.env, changedSiteUrl + '/article/' + encodeURIComponent(oldSlug), changedSiteUrl, c.executionCtx)
  if (status === 'published') notifyPublishedUrl(c.env, changedArticleUrl, changedSiteUrl, c.executionCtx)
  else if (wasPublished && oldSlug === slug) notifyDeletedUrl(c.env, changedArticleUrl, changedSiteUrl, c.executionCtx)
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/articles')
})

adminArticlesRoutes.post('/articles/:id/publish', async (c) => {
  const id = String(c.req.param('id') || '').trim(), tenantId = getTenantId(c)
  const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
  if (!article) return c.notFound()
  const title = String(article.title || '').trim()
  if (!title) return c.redirect('/admin/articles/' + encodeURIComponent(id) + '/edit?error=' + encodeURIComponent('文章标题不能为空，无法生成前台页面。'))
  const content = String(article.content || '').trim()
  if (!content || content === '<p>请补充文章正文后再发布。</p>') return c.redirect('/admin/articles/' + encodeURIComponent(id) + '/edit?error=' + encodeURIComponent('文章正文为空：请先使用 AI 预览/辅助写作或人工编辑，完成审核后再发布。'))
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c)), seo = autoArticleSeo({ title, summary: String(article.summary || ''), content }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords)
  let slug = String(article.slug || '').trim().replace(/^\/+|\/+$/g, '')
  if (!slug) slug = 'article-' + id
  const sameSlug = await c.env.DB.prepare('SELECT id FROM articles WHERE slug=? AND tenant_id=? AND id<>? LIMIT 1').bind(slug, tenantId, id).first()
  if (sameSlug) slug = slug + '-' + id
  let cardSvg = String(article.card_svg || '').trim() || null
  if (!cardSvg) try { cardSvg = await generateInterpretationCard(c.env, { title, summary: String(article.summary || '') }, getTenantId(c)) } catch (e) { safeError('article interpretation card generation failed', e) }
  await c.env.DB.prepare(`UPDATE articles SET slug=?, content=?, status='published', seo_title=?, seo_description=?, seo_keywords=?, card_svg=?, published_at=COALESCE(published_at, datetime('now')), updated_at=datetime('now'), reviewed_by='admin', reviewed_at=datetime('now'), reject_reason=NULL WHERE id=? AND tenant_id=?`).bind(slug, content, seo.seo_title, seo.seo_description, seo.seo_keywords, cardSvg, id, tenantId).run()
  await c.env.DB.prepare('INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)').bind(id, 'publish', '管理员', '生成/补齐前台文章页面并发布').run()
  const publishedSiteUrl = await resolveSiteUrl(c); notifyPublishedUrl(c.env, publishedSiteUrl + '/article/' + encodeURIComponent(slug), publishedSiteUrl, c.executionCtx); c.executionCtx.waitUntil(syncPublishedArticleToDomesticPlatforms(c.env, Number(id)).catch((e) => safeError('published article platform sync failed', e)))
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/article/' + encodeURIComponent(slug), 302)
})

adminArticlesRoutes.post('/articles/:id/content/delete', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c)
  const article = await c.env.DB.prepare('SELECT id, slug, cover_image FROM articles WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!article) return c.notFound()
  const deletedSiteUrl = await resolveSiteUrl(c)
  if (String(article.slug || '').trim()) notifyDeletedUrl(c.env, deletedSiteUrl + '/article/' + encodeURIComponent(String(article.slug).trim()), deletedSiteUrl, c.executionCtx)
  await deleteArticleD1Relations(c.env, id)
  await removePageContact(c.env, ['article:' + id])
  const cover = String(article.cover_image || '').trim()
  if (cover.startsWith('/media/')) await permanentlyDeleteMediaObject(c, 'media/' + cover.slice('/media/'.length))
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/articles')
})

adminArticlesRoutes.post('/articles/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  const article = await c.env.DB.prepare('SELECT id, slug, cover_image FROM articles WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!article) return c.notFound()
  const deletedSiteUrl = await resolveSiteUrl(c)
  if (String(article.slug || '').trim()) notifyDeletedUrl(c.env, deletedSiteUrl + '/article/' + encodeURIComponent(String(article.slug).trim()), deletedSiteUrl, c.executionCtx)
  await deleteArticleD1Relations(c.env, id)
  await removePageContact(c.env, ['article:' + id])
  const cover = String(article.cover_image || '').trim()
  if (cover.startsWith('/media/')) await permanentlyDeleteMediaObject(c, 'media/' + cover.slice('/media/'.length))
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/articles')
})

adminArticlesRoutes.get('/articles/:id/preview', async (c) => {
  const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), getTenantId(c)).first()
  if (!article) return c.notFound()
  const art = article as any, siteUrl = await resolveSiteUrl(c), locale = c.get('locale')
  const banner = `<div class="container" style="max-width:820px;margin-top:16px"><p style="background:#fff7e6;color:#ad6800;border:1px solid #ffe7ba;border-radius:8px;padding:10px 14px;font-size:13px">🔍 预览模式 · 当前状态：${escapeStatus(art.status)}，此页面不会被搜索引擎收录，也不在公开导航中出现。</p></div>`
  const body = banner + renderArticlePage(art, locale)
  return c.html(renderLayout({ title: `[预览] ${art.title}`, siteUrl, siteName: c.env.SITE_NAME || '网站内容平台', canonical: `${siteUrl}/article/${art.slug}` }, body))
})

adminArticlesRoutes.get('/articles/:id/wechat', async (c) => {
  const tenantId = getTenantId(c)
  const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), tenantId).first() as any
  if (!article) return c.notFound()
  let cityName = '全国'
  if (article.city_id) { const city = await c.env.DB.prepare('SELECT name FROM cities WHERE id = ? AND tenant_id = ?').bind(article.city_id, tenantId).first() as any; if (city) cityName = city.name }
  const wechatHtml = buildWechatHtml({ ...article, cityName })
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("csrfToken") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderWechatEditor(article, cityName, wechatHtml, siteName, cspNonce, csrfToken))
})

adminArticlesRoutes.post('/articles/:id/wechat', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c), b = await c.req.parseBody()
  const scheduledAt = String(b.wechat_scheduled_at || '').trim(), status = scheduledAt ? 'scheduled' : 'ready'
  await c.env.DB.prepare(`UPDATE articles SET wechat_title = ?, wechat_summary = ?, wechat_cover_url = ?, wechat_scheduled_at = ?, wechat_status = ?, wechat_synced_at = datetime('now') WHERE id = ? AND tenant_id = ?`).bind(String(b.wechat_title || '') || null, String(b.wechat_summary || '') || null, String(b.wechat_cover_url || '') || null, scheduledAt || null, status, id, tenantId).run()
  return c.redirect(`/admin/articles/${id}/wechat`)
})

adminArticlesRoutes.post('/articles/:id/wechat/mark-copied', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare("UPDATE articles SET wechat_status = 'copied' WHERE id = ? AND tenant_id = ?").bind(id, getTenantId(c)).run()
  return c.json({ ok: true })
})

adminArticlesRoutes.get('/articles/:id/social', async (c) => {
  const { article } = await loadArticleAndCity(c.env, c.req.param('id'), getTenantId(c))
  if (!article) return c.notFound()
  const rows = (await c.env.DB.prepare('SELECT * FROM social_posts WHERE article_id = ?').bind(article.id).all()).results as any[]
  const posts: Record<string, any> = {}
  for (const r of rows) posts[r.platform] = r
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderSocialHub(article, PLATFORM_LIST, posts, siteName, cspNonce, csrfToken))
})

adminArticlesRoutes.get('/articles/:id/social/:platform', async (c) => {
  const platform = c.req.param('platform') as PlatformKey
  const config = PLATFORMS[platform]
  if (!config) return c.notFound()
  const { article } = await loadArticleAndCity(c.env, c.req.param('id'), getTenantId(c))
  if (!article) return c.notFound()
  const post = await c.env.DB.prepare('SELECT * FROM social_posts WHERE article_id = ? AND platform = ?').bind(article.id, platform).first() as any
  let copyPayload = ''
  if (post) { const data = { title: post.title || '', content: post.content || '', hashtags: post.hashtags ? String(post.hashtags).split(',').map((s: string) => s.trim()).filter(Boolean) : [] }; copyPayload = config.copyMode === 'richtext' ? buildRichCopyHtml(data) : escapeForPreview(buildPlainCopyText(config, data)) }
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderSocialEditor(article, config, post, copyPayload, siteName, cspNonce, csrfToken))
})

adminArticlesRoutes.post('/articles/:id/social/:platform/generate', async (c) => {
  const platform = c.req.param('platform') as PlatformKey
  if (!PLATFORMS[platform]) return c.notFound()
  const { article, cityName } = await loadArticleAndCity(c.env, c.req.param('id'), getTenantId(c))
  if (!article) return c.notFound()
  const data = await generateSocialContent(c.env, platform, { title: article.title, summary: article.summary, content: article.content, seo_keywords: article.seo_keywords, cityName }, getTenantId(c))
  await c.env.DB.prepare(`INSERT INTO social_posts (article_id, platform, title, content, hashtags, ai_generated, status, synced_at) VALUES (?, ?, ?, ?, ?, 1, 'ready', datetime('now')) ON CONFLICT(article_id, platform) DO UPDATE SET title = excluded.title, content = excluded.content, hashtags = excluded.hashtags, ai_generated = 1, status = 'ready', synced_at = datetime('now')`).bind(article.id, platform, data.title, data.content, data.hashtags.join(',')).run()
  return c.redirect(`/admin/articles/${article.id}/social/${platform}`)
})

adminArticlesRoutes.post('/articles/:id/social/:platform', async (c) => {
  const platform = c.req.param('platform') as PlatformKey
  if (!PLATFORMS[platform]) return c.notFound()
  const id = c.req.param('id'), tenantId = getTenantId(c), b = await c.req.parseBody()
  const scheduledAt = String(b.scheduled_at || '').trim()
  await c.env.DB.prepare(`UPDATE social_posts SET title = ?, content = ?, hashtags = ?, scheduled_at = ?, status = ?, synced_at = datetime('now') WHERE article_id = ? AND platform = ?`).bind(String(b.title || ''), String(b.content || ''), String(b.hashtags || ''), scheduledAt || null, scheduledAt ? 'scheduled' : 'ready', id, platform).run()
  return c.redirect(`/admin/articles/${id}/social/${platform}`)
})

adminArticlesRoutes.post('/articles/:id/social/:platform/mark-copied', async (c) => {
  const id = c.req.param('id'), platform = c.req.param('platform')
  await c.env.DB.prepare("UPDATE social_posts SET status = 'copied' WHERE article_id = ? AND platform = ?").bind(id, platform).run()
  return c.json({ ok: true })
})

adminArticlesRoutes.post('/articles/:id/approve', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c)
  const full = await c.env.DB.prepare('SELECT id, slug, title, summary, content, card_svg, status FROM articles WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!full) return c.notFound()
  if (String(full.status || '') !== 'pending_review') return c.redirect('/admin/articles?status=' + encodeURIComponent(String(full.status || 'draft')))
  const title = String(full.title || '').trim(), content = String(full.content || '').trim()
  if (!title || !content || content === '<p>请补充文章正文后再发布。</p>') return c.redirect('/admin/articles/' + encodeURIComponent(id) + '/edit?error=' + encodeURIComponent('文章内容不完整：请补充标题和正文后再审核发布。'))
  let slug = String(full.slug || '').trim().replace(/^\/+|\/+$/g, '')
  if (!slug) slug = 'article-' + id
  const sameSlug = await c.env.DB.prepare('SELECT id FROM articles WHERE slug=? AND tenant_id=? AND id<>? LIMIT 1').bind(slug, tenantId, id).first()
  if (sameSlug) slug = slug + '-' + id
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c)), seo = autoArticleSeo({ title, summary: String(full.summary || ''), content }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords)
  let cardSvg = String(full.card_svg || '').trim() || null
  if (!cardSvg) cardSvg = await generateInterpretationCard(c.env, { title, summary: String(full.summary || '') }, getTenantId(c))
  await c.env.DB.prepare(`UPDATE articles SET slug=?, status='published', seo_title=?, seo_description=?, seo_keywords=?, card_svg=?, published_at=COALESCE(published_at, datetime('now')), reviewed_by='admin', reviewed_at=datetime('now'), reject_reason=NULL, updated_at=datetime('now') WHERE id=? AND tenant_id=?`).bind(slug, seo.seo_title, seo.seo_description, seo.seo_keywords, cardSvg, id, tenantId).run()
  await c.env.DB.prepare('INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)').bind(id, 'approve', 'admin', '人工审核通过：补齐 slug / SEO 后正式发布').run()
  const publishedSiteUrl = await resolveSiteUrl(c), publicUrl = publishedSiteUrl + '/article/' + encodeURIComponent(slug)
  notifyPublishedUrl(c.env, publicUrl, publishedSiteUrl, c.executionCtx)
  c.executionCtx.waitUntil(syncPublishedArticleToDomesticPlatforms(c.env, Number(id)).catch((e) => safeError('approved article platform sync failed', e)))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/articles?status=published')
})

adminArticlesRoutes.post('/articles/:id/reject', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c), b = await c.req.parseBody()
  const reason = String(b.reason || '内容不符合发布标准')
  await c.env.DB.prepare(`UPDATE articles SET status='draft', reviewed_by='admin', reviewed_at=datetime('now'), reject_reason=? WHERE id=? AND tenant_id=?`).bind(reason, id, tenantId).run()
  await c.env.DB.prepare('INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)').bind(id, 'reject', 'admin', reason).run()
  return c.redirect('/admin/articles?status=pending_review')
})
