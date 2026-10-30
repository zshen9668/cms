import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = {
  'src/services/newsPipeline.ts': ['pending_review', 'published', 'statusAfterAiDraft'],
  'src/routes/admin/articles.ts': ["/articles/:id/approve", "reviewed_by='admin'", 'notifyPublishedUrl(', 'syncPublishedArticleToDomesticPlatforms('],
  'src/utils/seo.ts': ['submitBaidu', 'submitIndexNow', 'submitAllEngines'],
  'src/routes/seo.ts': ["seoRoutes.get('/sitemap.xml'", "seoRoutes.get('/robots.txt'", "seoRoutes.get('/ai-index.json'", "seoRoutes.get('/llms.txt'", "seoRoutes.get('/llms-full.txt'", "seoRoutes.get('/feed.xml'"],
  'src/templates/layout.ts': ['Organization', 'WebSite', 'WebPage', 'describedby', 'BreadcrumbList', 'og:image', 'Person', "t(locale, 'a11y.main_nav')", 'hreflang', 'canonicalUrl'],
  'src/routes/public.ts': ['renderArticlePage', 'safeInternalPath', 'breadcrumbs: crumbs(', 'ogType'],
  'src/routes/admin/seo.ts': ["adminSeoRoutes.get('/geo'", "adminSeoRoutes.post('/geo'", "adminSeoRoutes.get('/social'"],
  'src/templates/admin.ts': ['renderGeoPage', 'renderSocialDistributionPage'],
  'src/utils/socialPlatforms.ts': ['douyin', 'kuaishou', 'xiaohongshu', 'bilibili'],
  'src/utils/socialSync.ts': ['syncPublishedArticleToDomesticPlatforms', "status='ready'"],
  'src/utils/geo.ts': ['HUMAN_REVIEW_PUBLICATION_MODE', 'PUBLICATION_PIPELINE'],
}
for (const [file, needles] of Object.entries(checks)) {
  const text = read(file)
  const missing = needles.filter((needle) => !text.includes(needle))
  if (missing.length) {
    console.error(file + ' missing required SEO/GEO contract:')
    console.error(missing.join('\n'))
    process.exit(1)
  }
}

const forbiddenAutomaticPublishResidue = /google-sitemap-ping|bing-sitemap-ping|news_auto_publish|industry_keywords_auto_publish/
for (const file of ['src/utils/seo.ts', 'src/routes/seo.ts', 'src/services/newsPipeline.ts']) {
  const text = read(file)
  if (forbiddenAutomaticPublishResidue.test(text)) {
    console.error(file + ' contains deprecated/forbidden automatic publication residue.')
    process.exit(1)
  }
}

const geo = read('src/routes/seo.ts')
for (const endpoint of ['/sitemap.xml', '/robots.txt', '/llms.txt', '/ai-index.json']) {
  if (!geo.includes("seoRoutes.get('" + endpoint + "'")) {
    console.error('Missing SEO/GEO endpoint: ' + endpoint)
    process.exit(1)
  }
}

console.log('SEO/GEO publication contract OK')
