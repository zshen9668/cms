import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LOCALE, SUPPORTED, defaultLocaleFrom, enabledLocalesFrom, normalizeLocale,
  parseAcceptLanguage, resolveLocale,
} from '../src/utils/localeResolve.ts'
import { t, pick, ogLocale, localeBcp47 } from '../src/utils/i18n.ts'

const BOTH = [{ code: 'zh-CN', name: '中文', enabled: true, default: true }, { code: 'en', name: 'English', enabled: true }]

test('normalizeLocale maps browser tags onto supported locales', () => {
  assert.equal(normalizeLocale('en-US'), 'en')
  assert.equal(normalizeLocale('EN'), 'en')
  assert.equal(normalizeLocale('en_GB'), 'en')
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(normalizeLocale('zh'), 'zh-CN')
  assert.equal(normalizeLocale('fr-FR'), null)
  assert.equal(normalizeLocale(''), null)
  assert.equal(normalizeLocale(undefined), null)
})

test('enabledLocalesFrom keeps order, dedupes and drops未知语言', () => {
  assert.deepEqual(enabledLocalesFrom(BOTH), ['zh-CN', 'en'])
  assert.deepEqual(
    enabledLocalesFrom([{ code: 'en', enabled: true }, { code: 'zh-CN', enabled: true }]),
    ['en', 'zh-CN'],
  )
  assert.deepEqual(enabledLocalesFrom([{ code: 'en' }, { code: 'en-US', enabled: true }]), ['en'])
  assert.deepEqual(enabledLocalesFrom([{ code: 'fr' }, { code: 'en', enabled: true }]), ['en'])
})

test('enabledLocalesFrom falls back to the default locale instead of producing an empty list', () => {
  assert.deepEqual(enabledLocalesFrom([]), [DEFAULT_LOCALE])
  assert.deepEqual(enabledLocalesFrom(null), [DEFAULT_LOCALE])
  assert.deepEqual(enabledLocalesFrom(undefined), [DEFAULT_LOCALE])
  assert.deepEqual(enabledLocalesFrom([{ code: 'en', enabled: false }]), [DEFAULT_LOCALE])
})

test('defaultLocaleFrom prefers the marked default and must be enabled', () => {
  assert.equal(defaultLocaleFrom(BOTH), 'zh-CN')
  assert.equal(defaultLocaleFrom([{ code: 'zh-CN', enabled: true }, { code: 'en', enabled: true, default: true }]), 'en')
  // 默认语言被停用时不能当选，否则前台会解析出未启用的语言
  assert.equal(defaultLocaleFrom([{ code: 'zh-CN', enabled: false, default: true }, { code: 'en', enabled: true }]), 'en')
  assert.equal(defaultLocaleFrom(null), DEFAULT_LOCALE)
})

test('resolveLocale: cookie wins, then Accept-Language, then the default locale', () => {
  assert.equal(resolveLocale('en', 'zh-CN,zh;q=0.9', ['zh-CN', 'en']), 'en')
  assert.equal(resolveLocale('zh-CN', 'en-US,en;q=0.9', ['zh-CN', 'en']), 'zh-CN')
  assert.equal(resolveLocale(undefined, 'en-US,en;q=0.9', ['zh-CN', 'en']), 'en')
  assert.equal(resolveLocale(undefined, 'de-DE,de;q=0.9', ['zh-CN', 'en']), 'zh-CN')
  assert.equal(resolveLocale(undefined, '', ['zh-CN', 'en']), 'zh-CN')
})

test('resolveLocale ignores a cookie for a language the admin disabled', () => {
  assert.equal(resolveLocale('en', 'en-US', ['zh-CN']), 'zh-CN')
})

test('resolveLocale is a no-op on a single-language site (previous Chinese-only behaviour)', () => {
  assert.equal(resolveLocale(undefined, 'en-US,en;q=0.9', ['zh-CN']), 'zh-CN')
  assert.equal(resolveLocale('en', '', ['zh-CN']), 'zh-CN')
  assert.deepEqual(enabledLocalesFrom([{ code: 'zh-CN', enabled: true }]), ['zh-CN'])
})

test('resolveLocale honours an English-only site', () => {
  assert.equal(resolveLocale(undefined, 'zh-CN', ['en']), 'en')
  assert.equal(resolveLocale('zh-CN', '', ['en']), 'en')
})

test('parseAcceptLanguage sorts by q and drops wildcards and q=0', () => {
  assert.deepEqual(parseAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8'), ['zh-CN', 'zh', 'en'])
  assert.deepEqual(parseAcceptLanguage('en;q=0.5,fr;q=0.9'), ['fr', 'en'])
  assert.deepEqual(parseAcceptLanguage('en;q=0,*;q=1'), [])
  assert.deepEqual(parseAcceptLanguage(''), [])
})

test('SUPPORTED advertises exactly the languages the frontend can render', () => {
  assert.deepEqual([...SUPPORTED], ['zh-CN', 'en'])
})

test('t() returns English词条 for en and falls back to Chinese for missing entries', () => {
  assert.equal(t('zh-CN', 'nav.home'), '首页')
  assert.equal(t('en', 'nav.home'), 'Home')
  assert.equal(t('en', 'contact.submit'), 'Send message')
  // 键不存在时回落为键名，不能抛异常（模板里大量使用）
  assert.equal(t('en', 'no.such.key'), 'no.such.key')
})

test('every Chinese key has an English entry (no silent language gaps)', () => {
  // 用一组模板里实际会渲染的键做抽样，避免英文站出现中文残留。
  const keys = [
    'nav.home', 'nav.services', 'nav.cities', 'nav.articles', 'nav.about', 'nav.contact',
    'nav.search_placeholder', 'nav.search_button', 'common.learn_more', 'common.no_data',
    'contact.title', 'contact.subtitle', 'contact.name', 'contact.phone', 'contact.city',
    'contact.service', 'contact.message', 'contact.submit', 'contact.success',
    'about.title', 'pages.cases', 'search.all_cities', 'search.section_services',
    'article.faq_title', 'article.published_at', 'article.updated_at', 'article.author',
    'article.original_link', 'article.source_link', 'article.default_category', 'article.insights',
    'notfound.title', 'notfound.continue', 'notfound.back_home', 'notfound.feedback',
    'a11y.skip_to_main', 'a11y.main_nav', 'a11y.breadcrumb', 'nav.more', 'lang.switch',
    'qa.open', 'qa.title', 'qa.close', 'qa.placeholder', 'qa.send', 'qa.thinking', 'qa.error', 'qa.sources',
  ]
  const missing = keys.filter((key) => t('en', key) === key || t('en', key) === t('zh-CN', key))
  assert.deepEqual(missing, [], '缺少英文词条的键: ' + missing.join(', '))
})

test('pick() and locale helpers follow the language', () => {
  assert.equal(pick('zh-CN', '中文', 'English'), '中文')
  assert.equal(pick('en', '中文', 'English'), 'English')
  assert.equal(ogLocale('zh-CN'), 'zh_CN')
  assert.equal(ogLocale('en'), 'en_US')
  assert.equal(localeBcp47('zh-CN'), 'zh-CN')
  assert.equal(localeBcp47('en'), 'en-US')
})
