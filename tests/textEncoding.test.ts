import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeMojibake, preferReadable } from '../src/utils/textEncoding.ts'
import { getPageNavigationLabels } from '../src/utils/pageSettings.ts'
import { parseHomeSectionOrder } from '../src/utils/homeSectionConfig.ts'

/**
 * 编码错乱识别 + 首页模块顺序解析的回归测试。
 *
 * 这两处都是「站长看得见但很难描述」的问题：
 * - 标签乱码时站长只会说"后台坏了"，不会说"UTF-8 被按 GBK 解码了"；
 * - 首页模块顺序解析错时表现为"改了没反应"。
 */

test('looksLikeMojibake: 正常中文与英文都不算乱码', () => {
  assert.equal(looksLikeMojibake('首页'), false)
  assert.equal(looksLikeMojibake('服务项目'), false)
  assert.equal(looksLikeMojibake('Insights'), false)
  assert.equal(looksLikeMojibake(''), false)
  assert.equal(looksLikeMojibake(null), false)
  assert.equal(looksLikeMojibake(undefined), false)
})

test('looksLikeMojibake: 替换字符与成片 Latin-1/西里尔字符判定为乱码', () => {
  assert.equal(looksLikeMojibake('棣?ҳ'), true)
  assert.equal(looksLikeMojibake('é¦–é¡µ'), true)
  assert.equal(looksLikeMojibake('Â·Â·Â·Â·'), true)
  assert.equal(looksLikeMojibake('首页�'), true)
})

test('looksLikeMojibake: 单个重音字符不误判（例如品牌名里的 é）', () => {
  assert.equal(looksLikeMojibake('Café'), false)
  assert.equal(looksLikeMojibake('关于我们 About'), false)
})

test('preferReadable: 乱码或空值回退到默认值，正常值原样返回', () => {
  assert.equal(preferReadable('行业资讯', '新闻资讯'), '行业资讯')
  assert.equal(preferReadable('棣?ҳ', '首页'), '首页')
  assert.equal(preferReadable('', '首页'), '首页')
  assert.equal(preferReadable('   ', '首页'), '首页')
})

test('getPageNavigationLabels: 存进去的标签是乱码时回退到内置标签', () => {
  const settings = {
    page_settings_json: JSON.stringify({
      home: { labelZh: '棣?ҳ' },
      articles: { labelZh: '行业资讯' },
    }),
  }
  const labels = getPageNavigationLabels(settings, 'zh-CN')
  assert.equal(labels.home, '首页', '乱码标签必须回退到内置标签')
  assert.equal(labels.articles, '行业资讯', '正常标签必须保留站长的自定义值')
  assert.equal(labels.services, '服务项目', '未配置的页面用内置标签')
})

test('parseHomeSectionOrder: 顺序、隐藏标记与缺失补齐', () => {
  // 前缀 - 表示隐藏
  const reordered = parseHomeSectionOrder('services,intro,-cases,articles,contact')
  assert.deepEqual(reordered.map((s) => s.key), ['services', 'intro', 'cases', 'articles', 'contact'])
  assert.deepEqual(reordered.map((s) => s.visible), [true, true, false, true, true])

  // 重复项只取第一次出现，缺失项按默认顺序补在末尾且默认可见
  const partial = parseHomeSectionOrder('contact,contact')
  assert.deepEqual(partial.map((s) => s.key), ['contact', 'intro', 'services', 'cases', 'articles'])
  assert.equal(partial[0]?.visible, true)

  // 空值 = 全部默认顺序
  assert.deepEqual(parseHomeSectionOrder('').map((s) => s.key), ['intro', 'services', 'cases', 'articles', 'contact'])
  assert.deepEqual(parseHomeSectionOrder(undefined).map((s) => s.key), ['intro', 'services', 'cases', 'articles', 'contact'])
})

test('parseHomeSectionOrder: 保存后再解析必须稳定（后台保存 → 前台读取的往返）', () => {
  const saved = parseHomeSectionOrder('services,intro,-cases,articles,contact')
  const encoded = saved.map((slot) => (slot.visible ? '' : '-') + slot.key).join(',')
  assert.equal(encoded, 'services,intro,-cases,articles,contact')
  assert.deepEqual(parseHomeSectionOrder(encoded), saved)
})
