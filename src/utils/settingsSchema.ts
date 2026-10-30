/**
 * Settings key 注册表：每个 key 归属一个 scope，决定读写时的键集合。
 * 新增 key 时在此登记，避免散落各处。
 */

export type SettingsScope =
  | 'public'    // 一般站点设置（site_name、SEO、GEO、导航、联系、页脚等）
  | 'profile'   // 站点画像（主题/行业/关键词/分类）
  | 'ai'        // AI 模型与提示词
  | 'secret'    // 加密保护的密钥
  | 'runtime'   // 运行时状态（分析、采集来源分析等）

export const SETTINGS_SCOPES = {
  public: [
    'site_name', 'site_description', 'site_url',
    'geo_ai_crawlers_enabled', 'geo_llms_enabled',
    'indexnow_key', 'baidu_token', 'so_token', 'sogou_token',
    'news_round_items', 'news_quality_min',
    'page_settings_json', 'service_external_links',
    'contact_channels', 'contact_phone', 'contact_phones',
    'contact_wechat', 'contact_wechats', 'contact_qqs', 'contact_qr_url',
    // GEO / E-E-A-T：作者实体、站点 logo、默认分享图、官方主页。
    // 注意：getMap('all') 会按本注册表过滤，未登记的 key 前台读不到，因此新增设置必须在此登记。
    'site_author_name', 'site_author_title', 'site_author_credentials',
    'site_author_url', 'site_author_expertise',
    'site_logo_url', 'site_og_image', 'site_social_links',
    // 前台语言配置（zh-CN / en 的启停与默认语言）。
    // 必须登记：getMap('all') 按本注册表过滤，未登记时前台读不到配置，
    // 语言切换器会永远回落到 DEFAULT_LANGUAGES。
    'languages',
    // 智能问答（前台问答组件与企业微信自动回复共用）
    'ai_qa_enabled', 'ai_qa_welcome', 'ai_qa_max_context_chars', 'ai_qa_wecom_auto_reply',
    // 首页模块顺序（前台首页按它渲染模块次序与显隐）
    'home_section_order',
    // RBAC：角色 → 可访问后台模块的映射（JSON）。空/缺省 = 不限制。
    'role_permissions_json',
    // 获客与统计（前台 CTA 悬浮区块、统计脚本注入、UTM 透传等）
    'site_analytics_enabled', 'site_analytics_snippet',
    'site_cta_enabled', 'site_cta_title', 'site_cta_subtitle', 'site_cta_btn_text',
    'site_favicon',
    'site_default_title_template', 'site_default_desc_template',
    'site_llms_content', 'site_utm_source_whitelist',
  ] as const,
  profile: [
    'site_topic', 'site_industry',
    'primary_services', 'primary_keywords',
    'industry_keywords', 'site_keywords', 'news_categories',
    // 站点画像的自定义名称：后台「白标行业 / 站点画像」卡片标题，方便多站点区分。
    'site_profile_name',
  ] as const,
  ai: [
    'ai_enabled', 'ai_provider', 'ai_model',
    'ai_temperature', 'ai_max_tokens',
    'ai_external_base_url', 'ai_external_model', 'ai_external_timeout_ms',
    'ai_fallback_enabled',
    'ai_prompt_global', 'ai_prompt_news', 'ai_prompt_city',
    'ai_prompt_service', 'ai_prompt_article', 'ai_prompt_keyword',
    'ai_prompt_landing', 'ai_prompt_page',
    // 智能问答的站点专属补充提示词（叠加在内置问答提示词之后）
    'ai_qa_prompt',
  ] as const,
  secret: [
    'secret:indexnow_key', 'secret:baidu_token',
    'secret:so_token', 'secret:sogou_token',
    'secret:EXTERNAL_AI_API_KEY',
  ] as const,
  runtime: [
    'news_source_analysis', 'analysis_data',
  ] as const,
} as const

export type SettingsKey = (typeof SETTINGS_SCOPES)[keyof typeof SETTINGS_SCOPES][number]

/** 按 scope 取键集合；'all' 返回全部（除 secret，密钥需走 protectedSecrets）。 */
export function keysForScope(scope: 'public' | 'profile' | 'ai' | 'runtime' | 'all'): readonly SettingsKey[] {
  if (scope === 'all') return [...SETTINGS_SCOPES.public, ...SETTINGS_SCOPES.profile, ...SETTINGS_SCOPES.ai, ...SETTINGS_SCOPES.runtime]
  return SETTINGS_SCOPES[scope]
}
