import type { Context } from 'hono'
import { getCookieFromString } from './auth'

import { SUPPORTED, DEFAULT_LOCALE, normalizeLocale, resolveLocale, type Locale } from './localeResolve'
export { SUPPORTED, DEFAULT_LOCALE, type Locale }

type Dict = Record<string, string>

const ZH: Dict = {
  'nav.home': '首页',
  'nav.services': '服务项目',
  'nav.cities': '服务城市',
  'nav.articles': '新闻资讯',
  'nav.about': '关于我们',
  'nav.contact': '联系我们',
  'nav.search_placeholder': '请输入服务、城市或主题关键词',
  'nav.search_button': '搜索',
  'bottom.home': '首页',
  'bottom.services': '服务',
  'bottom.articles': '资讯',
  'bottom.cities': '城市',
  'home.hero.title': '网站内容平台',
  'home.hero.subtitle': '',
  'home.services.title': '服务项目',
  'home.services.more': '查看全部 →',
  'home.cities.title': '服务城市',
  'home.cities.more': '查看全部 →',
  'home.articles.title': '新闻资讯',
  'home.articles.more': '查看全部 →',
  'common.learn_more': '了解更多 →',
  'common.no_data': '暂无内容',
  'city.hot_services': '服务项目',
  'city.articles': '新闻资讯',
  'service.why_us': '服务说明',
  'service.available_cities': '服务地区',
  'service.list_title': '服务项目',
  'city.list_title': '服务城市',
  'about.title': '关于我们',
  'about.contact': '联系方式',
  'pages.cases': '成功案例',
  'contact.title': '联系我们',
  'contact.subtitle': '提交需求或留下联系方式，我们会尽快回复。',
  'contact.name': '姓名',
  'contact.phone': '联系电话',
  'contact.phone_required': '请填写联系电话',
  'contact.email_invalid': '请填写有效邮箱',
  'contact.city': '所在城市',
  'contact.service': '需要的服务',
  'contact.message': '需求说明',
  'contact.submit': '提交留言',
  'contact.success': '留言已提交，我们会尽快联系您。',
  'contact.qr': '微信扫码咨询',
  'contact.error_load': '页面加载失败，请刷新重试或稍后再访问。',
  'contact.utm_rejected': '提交的 utm_source 不在站点允许的来源名单中，请检查链接后重试。',
  'search.results_for': '的搜索结果',
  'search.no_results': '没有找到相关内容，换个关键词试试，或直接',
  'search.contact_us': '联系我们',
  'search.section_services': '相关服务',
  'search.section_cities': '相关城市',
  'search.section_articles': '相关资讯',
  'search.all_cities': '全部城市',
  'footer.disclaimer': '本站内容可能包含人工整理或 AI 辅助生成的信息，发布前应完成人工审核；重要事项请以权威来源和最新公开信息为准。',
  'lang.switch': '语言',
  // --- 访问性 / 导航标签（双语版本新增，此前为模板内硬编码中文） ---
  'a11y.skip_to_main': '跳到主要内容',
  'a11y.main_nav': '主导航',
  'a11y.mobile_nav': '移动端导航',
  'a11y.quick_nav': '快捷导航',
  'a11y.breadcrumb': '面包屑导航',
  'a11y.open_nav': '打开导航',
  'a11y.close_nav': '关闭导航',
  'a11y.more_nav': '更多导航',
  'nav.more': '更多',
  // --- 文章页固定文案 ---
  'article.faq_title': '常见问题',
  'article.published_at': '发布时间',
  'article.updated_at': '更新于',
  'article.author': '作者',
  'article.source': '参考来源',
  'article.original_link': '原文参考',
  'article.source_link': '来源链接',
  'article.default_category': '资讯',
  'article.insights': '新闻资讯',
  'notfound.title': '页面不存在',
  'notfound.path_prefix': '您访问的路径',
  'notfound.path_suffix': '未找到。',
  'notfound.continue': '你可以从这里继续',
  'notfound.back_home': '返回首页',
  'notfound.back_home_note': '浏览服务、城市与最新资讯',
  'notfound.feedback': '如果您认为这是系统问题，请通过「联系我们」页面提交反馈。',
  // --- 智能问答组件 ---
  'qa.open': '在线问答',
  'qa.title': '智能问答',
  'qa.close': '关闭',
  'qa.placeholder': '输入你的问题…',
  'qa.send': '发送',
  'qa.thinking': '正在根据站内资料整理回答…',
  'qa.error': '暂时无法回答，请稍后重试或直接留言。',
  'qa.sources': '参考站内内容',
  'qa.disclaimer': '回答基于本站已发布内容自动生成，重要事项请与我们确认。',
}

const EN: Dict = {
  'nav.home': 'Home',
  'nav.services': 'Services',
  'nav.cities': 'Cities',
  'nav.articles': 'Insights',
  'nav.about': 'About Us',
  'nav.contact': 'Contact',
  'nav.search_placeholder': 'Service, city or topic keyword',
  'nav.search_button': 'Search',
  'bottom.home': 'Home',
  'bottom.services': 'Services',
  'bottom.articles': 'Insights',
  'bottom.cities': 'Cities',
  'home.hero.title': 'Content platform',
  'home.hero.subtitle': '',
  'home.services.title': 'Services',
  'home.services.more': 'View all →',
  'home.cities.title': 'Cities',
  'home.cities.more': 'View all →',
  'home.articles.title': 'Insights',
  'home.articles.more': 'View all →',
  'common.learn_more': 'Learn more →',
  'common.no_data': 'No content yet',
  'city.hot_services': 'Services',
  'city.articles': 'Insights',
  'service.why_us': 'About this service',
  'service.available_cities': 'Service areas',
  'service.list_title': 'Services',
  'city.list_title': 'Cities',
  'about.title': 'About Us',
  'about.contact': 'Contact details',
  'pages.cases': 'Case studies',
  'contact.title': 'Contact Us',
  'contact.subtitle': 'Send your request or leave your contact details and we will get back to you shortly.',
  'contact.name': 'Name',
  'contact.phone': 'Phone',
  'contact.phone_required': 'Please provide a phone number',
  'contact.email_invalid': 'Please provide a valid email address',
  'contact.city': 'City',
  'contact.service': 'Service needed',
  'contact.message': 'Your request',
  'contact.submit': 'Send message',
  'contact.success': 'Your message has been submitted. We will contact you shortly.',
  'contact.qr': 'Scan the QR code to chat',
  'contact.utm_rejected': 'The submitted utm_source is not in the site-allowed source list. Please check the link and try again.',
  'contact.error_load': 'Page failed to load. Please refresh or try again later.',
  'search.results_for': 'search results',
  'search.no_results': 'Nothing matched. Try another keyword, or',
  'search.contact_us': 'contact us',
  'search.section_services': 'Matching services',
  'search.section_cities': 'Matching cities',
  'search.section_articles': 'Matching insights',
  'search.all_cities': 'All cities',
  'footer.disclaimer': 'Some content on this site may be compiled by hand or drafted with AI assistance and should be human-reviewed before publication. For anything important, rely on authoritative and up-to-date sources.',
  'lang.switch': 'Language',
  'a11y.skip_to_main': 'Skip to main content',
  'a11y.main_nav': 'Main navigation',
  'a11y.mobile_nav': 'Mobile navigation',
  'a11y.quick_nav': 'Quick navigation',
  'a11y.breadcrumb': 'Breadcrumb',
  'a11y.open_nav': 'Open navigation',
  'a11y.close_nav': 'Close navigation',
  'a11y.more_nav': 'More navigation',
  'nav.more': 'More',
  'article.faq_title': 'Frequently asked questions',
  'article.published_at': 'Published',
  'article.updated_at': 'Updated',
  'article.author': 'Author',
  'article.source': 'Source',
  'article.original_link': 'Original source',
  'article.source_link': 'Source link',
  'article.default_category': 'Insights',
  'article.insights': 'Insights',
  'notfound.title': 'Page not found',
  'notfound.path_prefix': 'The path',
  'notfound.path_suffix': 'could not be found.',
  'notfound.continue': 'You can continue from here',
  'notfound.back_home': 'Back to home',
  'notfound.back_home_note': 'Browse services, cities and the latest insights',
  'notfound.feedback': 'If you believe this is a system problem, please report it on the Contact page.',
  'qa.open': 'Ask a question',
  'qa.title': 'AI assistant',
  'qa.close': 'Close',
  'qa.placeholder': 'Type your question…',
  'qa.send': 'Send',
  'qa.thinking': 'Looking up our published content…',
  'qa.error': 'Unable to answer right now. Please try again later or send us a message.',
  'qa.sources': 'Based on',
  'qa.disclaimer': 'Answers are generated from our published content. Please confirm anything important with us directly.',
}

const DICTS: Record<Locale, Dict> = { 'zh-CN': ZH, en: EN }

/**
 * 界面固定文案翻译。
 * 中文是权威词条：英文缺失的键回落到中文，再回落到键名本身。
 * 数据库里的城市名/服务名/文章正文属于运营内容，不做机器翻译。
 */
export function t(locale: Locale, key: string): string {
  return DICTS[locale]?.[key] ?? ZH[key] ?? key
}

/**
 * 临时双语文案取值器：`pick(locale, '中文', 'English')`。
 * 用于只出现在模板里的零散标签——把它们全部塞进词条表反而更难维护，
 * 而这些标签也不需要在运行时改语言。词条表（t）仍用于需要统一维护的界面文案。
 */
export function pick(locale: Locale, chinese: string, english: string): string {
  return locale === 'zh-CN' ? chinese : english
}

/** 语言对应的 BCP 47 值，用于 <html lang> / hreflang / JSON-LD 的 inLanguage。 */
export function localeBcp47(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh-CN' : 'en-US'
}

/** og:locale 需要的下划线写法。 */
export function ogLocale(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh_CN' : 'en_US'
}

/**
 * 前台传入已启用语言时按一次性 cookie / 持久 cookie / Accept-Language 解析（见 localeResolve）。
 *
 * `_langq` 是「语言切换请求」写下来的一次性 cookie：当前请求按它渲染，
 * 并立刻把它清掉、把值同步到持久 `lang` cookie。这样"切语言"必然立即生效，
 * 而不是被历史 `lang` cookie 盖住（旧实现下，点切换链接会保留上一份 cookie，
 * 而持久 cookie 优先级高于 URL 参数，导致"切到英文后切不回中文"）。
 */
export function detectLocale(c: Context, enabled: readonly Locale[] = SUPPORTED): Locale {
  const cookieHeader = c.req.header('cookie') || ''
  const persistent = getCookieFromString(cookieHeader, 'lang')
  const oneShot = getCookieFromString(cookieHeader, '_langq')

  if (oneShot !== undefined) {
    // 一次切换 = 一次消费：清掉一次性 cookie；并写入对应持久 cookie，
    // 下一次普通浏览（无 _langq）仍按用户选择保持语言。
    const target = normalizeLocale(oneShot)
    if (target && enabled.includes(target)) {
      c.header('Set-Cookie', 'lang=' + target + '; Path=/; Max-Age=31536000; SameSite=Lax')
      c.header('Set-Cookie', '_langq=; Path=/; Max-Age=0; SameSite=Lax', { append: true })
      return target
    }
    // 目标语言已停用：清掉一次性 cookie，回落常规解析。
    c.header('Set-Cookie', '_langq=; Path=/; Max-Age=0; SameSite=Lax')
  }

  return resolveLocale(persistent, c.req.header('accept-language') || '', enabled)
}
