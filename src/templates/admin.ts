/**
 * 后台模板入口（barrel）。
 *
 * 原单体文件 2662 行、32 个互不相关的页面模板挤在一个文件里，改一处要在整文件里滚动定位。
 * 现已按后台导航的分组拆成 8 个同域模块，本文件只负责转发导出，因此
 * `src/routes/admin/*` 里的 22 处导入路径无需改动，也不会出现循环依赖：
 *
 *   admin.ts (barrel)
 *     ├── adminLayout      后台外壳（侧边栏/登录/初始化）—— 不是导航分组，被所有模块复用
 *     ├── adminOverview    总览    组
 *     ├── adminContent     内容    组（分发相关模板单独放在 adminSocial）
 *     ├── adminPages       页面    组
 *     ├── adminSeo         SEO 增长 组
 *     ├── adminAi          AI      组
 *     ├── adminSocial      内容组里的微信排版/平台分发切片
 *     └── adminSystem      系统    组
 *
 * 模块名与导航分组 id 刻意保持同名（admin+分组 id），这样「某个后台页面挂在哪一组」
 * 和「它的模板在哪个文件」是同一个答案，新同学不用查两份目录。
 * adminLayout 与 adminSocial 是两个例外：前者是外壳、后者是内容组的切片，
 * 测试 `tests/adminNav.test.ts` 按这条规则校验分组与模块的对应关系。
 *
 * adminLayout 不反向依赖任何同级模块；其余模块只依赖它导出的 renderAdminLayout
 * 与 sanitizeAdminPreviewHtml。
 *
 * 新增后台页面时：写进对应域模块，在 NAV 里挂到某个分组，并在这里补一行导出。
 * ADMIN_MODULES 是域划分的唯一真相源，`scripts/check-admin-templates.mjs` 用它校验
 * 「文件存在 + 函数确实被导出 + 没有被两个模块重复实现」。
 */
export { renderAdminLayout, renderLoginPage, renderRecoverPage, renderSetupPage, renderSetupSuccessPage } from './adminLayout'
export { renderDashboard } from './adminOverview'
export { renderArticlesList, renderArticleAiPreview, renderArticleForm, renderCollectionLogsList, renderMessagesList, renderNewsSourcesList } from './adminContent'
export { renderCitiesList, renderCityForm, renderServiceForm, renderPageSettingsPage, renderPagesHub, renderSubprojectsList, renderSubprojectForm } from './adminPages'
export { renderKeywordsList, renderKeywordForm, renderGeoPage, renderStructuredDataPage, renderSeoPage } from './adminSeo'
export { renderRankingPage, renderRankingFormPage } from './adminRanking'
export { renderAiSettingsPage, renderAiPromptsPage } from './adminAi'
export { renderWechatEditor, renderSocialHub, renderSocialSettingsPage, renderSocialDistributionPage, renderSocialEditor } from './adminSocial'
export { renderMediaPage, renderSystemPage, renderSettingsPage } from './adminSystem'

/** 后台模板的域划分：模块名 → 该模块负责的模板函数。 */
export const ADMIN_MODULES = {
  adminLayout: ['renderAdminLayout', 'renderLoginPage', 'renderRecoverPage', 'renderSetupPage', 'renderSetupSuccessPage'],
  adminOverview: ['renderDashboard'],
  adminContent: ['renderArticlesList', 'renderArticleAiPreview', 'renderArticleForm', 'renderCollectionLogsList', 'renderMessagesList', 'renderNewsSourcesList'],
  adminPages: ['renderCitiesList', 'renderCityForm', 'renderServiceForm', 'renderPageSettingsPage', 'renderPagesHub', 'renderSubprojectsList', 'renderSubprojectForm'],
  adminSeo: ['renderKeywordsList', 'renderKeywordForm', 'renderGeoPage', 'renderStructuredDataPage', 'renderSeoPage'],
  adminRanking: ['renderRankingPage', 'renderRankingFormPage'],
  adminAi: ['renderAiSettingsPage', 'renderAiPromptsPage'],
  adminSocial: ['renderWechatEditor', 'renderSocialHub', 'renderSocialSettingsPage', 'renderSocialDistributionPage', 'renderSocialEditor'],
  adminSystem: ['renderMediaPage', 'renderSystemPage', 'renderSettingsPage'],
} as const
