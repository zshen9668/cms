import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  suggestCaseSlug, validateCaseSlug, parseCaseResults, caseDisplayTitle,
  casePublicPath, autoCaseSeo, buildCaseJsonLd, isCasePublic,
  CASE_RESULT_MAX_LINES,
} from '../src/utils/cases.ts'

test('suggestCaseSlug 从英文客户名推导 slug，中文名返回空串交给人工填写', () => {
  assert.equal(suggestCaseSlug('Shenzhen Catering Group'), 'shenzhen-catering-group')
  assert.equal(suggestCaseSlug('ACME_Inc'), 'acme-inc')
  assert.equal(suggestCaseSlug('深圳某连锁餐饮企业'), '')
  // 客户名无法推导时退回行业
  assert.equal(suggestCaseSlug('深圳某连锁餐饮企业', 'Catering'), 'catering')
})

test('validateCaseSlug 拦截空值、中文与空格，大写先规范化为小写再通过', () => {
  assert.equal(validateCaseSlug('shenzhen-catering'), null)
  assert.equal(validateCaseSlug('Shenzhen-Catering'), null)
  assert.equal(validateCaseSlug('  shenzhen  '), null)
  assert.ok(validateCaseSlug(''))
  assert.ok(validateCaseSlug('深圳案例'))
  assert.ok(validateCaseSlug('shen zhen'))
  assert.ok(validateCaseSlug('shenzhen_catering'))
  assert.ok(validateCaseSlug('a'.repeat(61)))
})

test('parseCaseResults 逐行解析、去掉项目符号、忽略空行并封顶', () => {
  assert.deepEqual(parseCaseResults('上线 3 个月收录 120 页\n- 表单提升 60%\n\n* 首屏 1.1s'), [
    '上线 3 个月收录 120 页', '表单提升 60%', '首屏 1.1s',
  ])
  const many = parseCaseResults(Array.from({ length: 30 }, (_, i) => '成果' + i).join('\n'))
  assert.equal(many.length, CASE_RESULT_MAX_LINES)
})

test('caseDisplayTitle 优先客户名，缺失时退回地区+行业', () => {
  assert.equal(caseDisplayTitle({ client_name: '某连锁餐饮企业', industry: '餐饮', region: '深圳' }), '某连锁餐饮企业')
  assert.equal(caseDisplayTitle({ client_name: '', industry: '餐饮', region: '深圳' }), '深圳餐饮案例')
  assert.equal(caseDisplayTitle({ client_name: '', industry: '', region: '' }), '成功案例')
})

test('casePublicPath 生成 /case/{slug}', () => {
  assert.equal(casePublicPath('shenzhen-catering'), '/case/shenzhen-catering')
})

test('autoCaseSeo 输出确定性的标题/描述/关键词', () => {
  const first = autoCaseSeo(
    { clientName: '某连锁餐饮企业', industry: '连锁餐饮', serviceName: '企业官网建设', region: '深圳', summary: '' },
    '示例站点',
    '本地服务,企业官网',
  )
  const second = autoCaseSeo(
    { clientName: '某连锁餐饮企业', industry: '连锁餐饮', serviceName: '企业官网建设', region: '深圳', summary: '' },
    '示例站点',
    '本地服务,企业官网',
  )
  assert.deepEqual(first, second)
  assert.ok(first.seo_title.includes('某连锁餐饮企业'))
  assert.ok(first.seo_title.includes('成功案例') || first.seo_title.includes('案例'))
  assert.ok(first.seo_description.length > 0 && first.seo_description.length <= 150)
  assert.ok(first.seo_keywords.includes('某连锁餐饮企业案例'))
  assert.ok(first.seo_keywords.includes('深圳连锁餐饮案例'))

  // 有摘要时描述优先用摘要
  const withSummary = autoCaseSeo({ clientName: 'A公司', summary: '三个月自然流量翻倍。' }, '站点')
  assert.equal(withSummary.seo_description, '三个月自然流量翻倍。')
})

test('buildCaseJsonLd 输出 Article 结构化数据并引用可见页面', () => {
  const jsonLd = buildCaseJsonLd({
    siteName: '示例站点',
    siteUrl: 'https://example.com/',
    slug: 'shenzhen-catering',
    title: '某连锁餐饮企业 - 成功案例',
    description: '三个月自然搜索流量翻倍。',
    clientName: '某连锁餐饮企业',
    industry: '连锁餐饮',
    serviceName: '企业官网建设',
    region: '深圳',
    imageUrl: 'https://example.com/cover.jpg',
    publishedAt: '2026-01-02',
    modifiedAt: '2026-02-03',
    projectUrl: 'https://client.example.com',
  }) as any

  assert.equal(jsonLd['@context'], 'https://schema.org')
  assert.equal(jsonLd['@type'], 'Article')
  assert.equal(jsonLd.headline, '某连锁餐饮企业 - 成功案例')
  assert.equal(jsonLd.url, 'https://example.com/case/shenzhen-catering')
  assert.equal(jsonLd.mainEntityOfPage['@id'], 'https://example.com/case/shenzhen-catering')
  assert.equal(jsonLd.publisher.name, '示例站点')
  assert.deepEqual(jsonLd.image, ['https://example.com/cover.jpg'])
  assert.equal(jsonLd.datePublished, '2026-01-02')
  assert.equal(jsonLd.dateModified, '2026-02-03')
  assert.deepEqual(jsonLd.sameAs, ['https://client.example.com'])
  const aboutNames = jsonLd.about.map((item: any) => item.name)
  assert.deepEqual(aboutNames, ['某连锁餐饮企业', '连锁餐饮', '企业官网建设'])
})

test('isCasePublic 只认 is_active = 1', () => {
  assert.equal(isCasePublic({ is_active: 1 }), true)
  assert.equal(isCasePublic({ is_active: 0 }), false)
  assert.equal(isCasePublic({ is_active: '1' as unknown as number }), true)
  assert.equal(isCasePublic({}), false)
})
