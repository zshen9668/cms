import test from 'node:test'
import assert from 'node:assert/strict'
import { getFooterSettings, parseFooterLinks } from '../src/utils/footerSettings.ts'

test('parseFooterLinks accepts path and https links only', () => {
  const links = parseFooterLinks([
    '关于我们|/about',
    '联系我们|/contact',
    '官网|https://example.com',
    '坏链接|javascript:alert(1)',
    '无分隔符',
    'http不安全|http://example.com',
  ].join('\n'))
  assert.equal(links.length, 3)
  assert.deepEqual(links[0], { label: '关于我们', href: '/about' })
  assert.deepEqual(links[2], { label: '官网', href: 'https://example.com' })
})

test('getFooterSettings defaults copyright and disclaimer', () => {
  const year = new Date().getFullYear()
  const footer = getFooterSettings({}, 'Demo Site', 'zh-CN')
  assert.equal(footer.copyright, `© ${year} Demo Site`)
  assert.ok(footer.disclaimer.length > 0)
  assert.equal(footer.aiNotice, '')
  assert.equal(footer.links.length, 0)
})

test('getFooterSettings uses custom fields', () => {
  const footer = getFooterSettings({
    footer_copyright: '© Custom',
    footer_disclaimer: '仅供参考',
    footer_ai_notice: 'AI 辅助',
    footer_links: '首页|/\n隐私|https://example.com/privacy',
  }, 'X', 'zh-CN')
  assert.equal(footer.copyright, '© Custom')
  assert.equal(footer.disclaimer, '仅供参考')
  assert.equal(footer.aiNotice, 'AI 辅助')
  assert.equal(footer.links.length, 2)
})
