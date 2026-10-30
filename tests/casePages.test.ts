import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderCaseList } from '../src/templates/publicCases.ts'
import { getPageSettings, serializePageSettings } from '../src/utils/pageSettings.ts'
import type { ManagedPage } from '../src/utils/pageSettings.ts'
import type { CaseRecord } from '../src/utils/cases.ts'

/**
 * 案例页回归测试：锁住「后台 → 前台页面 → 成功案例」保存的标题/副标题/正文
 * 在 /case 上确实渲染出来。
 * 案例列表页不渲染联系表单（成功案例只展示项目成果，不承载留资）。
 */

const caseRow: CaseRecord = {
  id: 1,
  tenant_id: 1,
  client_name: '某连锁餐饮企业',
  slug: 'shenzhen-catering',
  industry: '连锁餐饮',
  service_name: '企业官网建设',
  region: '深圳',
  summary: '三个月内自然搜索流量翻倍。',
  challenge: '',
  solution: '',
  results: '上线 3 个月自然搜索收录 120 页',
  testimonial: '',
  content: '',
  cover_image_url: '',
  project_url: '',
  is_featured: 1,
  is_active: 1,
  sort_order: 0,
  seo_title: '',
  seo_description: '',
  seo_keywords: '',
  created_at: '',
  updated_at: '',
}

function casesPage(overrides: Partial<ManagedPage> = {}): ManagedPage {
  return { ...getPageSettings({}).cases, ...overrides }
}

test('/case 把后台的页面标题/副标题/正文渲染到受管列表页的标准位置', () => {
  const html = renderCaseList([caseRow], 'zh-CN', casesPage({
    titleZh: '深圳餐饮行业案例合集',
    subtitleZh: '副标题ABC',
    contentZh: '正文ABC',
  }))
  assert.ok(html.includes('<h1>深圳餐饮行业案例合集</h1>'), '页面标题应以 h1 输出')
  assert.ok(html.includes('副标题ABC'), '副标题应出现在页面头部')
  assert.ok(html.includes('managed-seo-section') && html.includes('正文ABC'), '正文应进固定内容区')
  assert.ok(html.includes('/case/shenzhen-catering'), '案例卡片链接应保留')
})

test('案例页设置序列化后能原样读回（保存 → 回显 round trip）', () => {
  const pages = getPageSettings({})
  pages.cases = { ...pages.cases, titleZh: 'T', subtitleZh: 'S', contentZh: 'C', showForm: false }
  const back = getPageSettings({ page_settings_json: serializePageSettings(pages) })
  assert.equal(back.cases.titleZh, 'T')
  assert.equal(back.cases.subtitleZh, 'S')
  assert.equal(back.cases.contentZh, 'C')
  assert.equal(back.cases.showForm, false)
})

test('案例列表页永不输出联系表单区块（成功案例只承载项目成果，不承载留资）', () => {
  const on = renderCaseList([caseRow], 'zh-CN', casesPage({ showForm: true }), { turnstileSiteKey: 'KEY' })
  assert.equal(on.includes('class="contact-form"'), false, '开启开关时也不应输出表单')
  assert.equal(on.includes('KEY'), false, '不应输出 Turnstile 站点密钥')
  const off = renderCaseList([caseRow], 'zh-CN', casesPage({ showForm: false }))
  assert.equal(off.includes('contact-form'), false)
  assert.equal(off.includes('cf-turnstile'), false)
})

test('未传入页面设置时 /case 用默认标题，且不输出联系表单', () => {
  const html = renderCaseList([caseRow], 'en', undefined)
  assert.ok(html.includes('<h1>Case studies</h1>'))
  assert.equal(html.includes('contact-form'), false)
  assert.ok(renderCaseList([], 'zh-CN', undefined).includes('暂未发布成功案例。'))
})

test('页面正文不再输出已废弃的 case-list-content 容器', () => {
  assert.equal(renderCaseList([caseRow], 'zh-CN', casesPage({ contentZh: '正文ABC' })).includes('case-list-content'), false)
})
