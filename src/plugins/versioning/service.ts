import type { Bindings } from '../../types'

export type ArticleVersionRow = {
  id: number
  article_id: number
  version_number: number
  title: string
  status: string
  created_at: string
  [key: string]: unknown
}

/** 读取指定文章全部版本(新→旧)，按当前租户隔离 */
export async function listVersions(env: Bindings, tenantId: number, articleId: number): Promise<ArticleVersionRow[]> {
  const t = Number(tenantId) || 1
  const { results } = await env.DB.prepare(
    'SELECT id, article_id, version_number, title, status, created_at FROM article_versions WHERE tenant_id = ? AND article_id = ? ORDER BY version_number DESC',
  ).bind(t, articleId).all()
  return (results || []) as unknown as ArticleVersionRow[]
}

/**
 * 快照当前 articles 行到 article_versions(版本号自增)。
 * 在文章编辑保存路径调用;回滚后也调用一次记录"回滚"这个动作本身。
 * 快照继承源文章的 tenant_id，保证版本与源文章同租户。
 */
export async function captureVersion(env: Bindings, tenantId: number, articleId: number, actorId?: number, note?: string): Promise<void> {
  const t = Number(tenantId) || 1
  const row = (await env.DB.prepare(
    "SELECT tenant_id, title, slug, category, summary, content, status, seo_title, seo_description, seo_keywords, card_svg, cover_image FROM articles WHERE id = ? AND tenant_id = ?",
  ).bind(articleId, t).first()) as any
  if (!row) return

  const latest = (await env.DB.prepare(
    'SELECT MAX(version_number) AS n FROM article_versions WHERE tenant_id = ? AND article_id = ?',
  ).bind(t, articleId).first()) as any
  const next = Number(latest?.n || 0) + 1

  await env.DB.prepare(
    `INSERT INTO article_versions
       (tenant_id, article_id, version_number, root_id, title, slug, category, summary, content, status,
        seo_title, seo_description, seo_keywords, card_svg, cover_image, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(t, articleId, next, articleId,
      row.title, row.slug, row.category, row.summary, row.content, row.status,
      row.seo_title, row.seo_description, row.seo_keywords, row.card_svg, row.cover_image, actorId ?? null)
    .run()

  // 可选备注(如 restore)暂以 created_by + note 表达:note 追加到 title 前缀,避免加列
  if (note) {
    await env.DB.prepare('UPDATE article_versions SET title = ? WHERE id = (SELECT MAX(id) FROM article_versions WHERE tenant_id = ? AND article_id = ?)')
      .bind('[' + note + '] ' + row.title, t, articleId).run()
  }
}

/** 用指定版本快照覆盖 articles 行(仅在同一租户内) */
export async function restoreVersion(env: Bindings, tenantId: number, articleId: number, versionNumber: number): Promise<void> {
  const t = Number(tenantId) || 1
  const snap = (await env.DB.prepare(
    'SELECT * FROM article_versions WHERE tenant_id = ? AND article_id = ? AND version_number = ?',
  ).bind(t, articleId, versionNumber).first()) as any
  if (!snap) throw new Error('版本不存在: #' + versionNumber)

  await env.DB.prepare(
    `UPDATE articles SET title=?, slug=?, category=?, summary=?, content=?, status=?,
       seo_title=?, seo_description=?, seo_keywords=?, card_svg=?, cover_image=?, updated_at=datetime('now')
     WHERE id=? AND tenant_id = ?`,
  )
    .bind(snap.title, snap.slug, snap.category, snap.summary, snap.content, snap.status,
      snap.seo_title, snap.seo_description, snap.seo_keywords, snap.card_svg, snap.cover_image, articleId, t)
    .run()
}
