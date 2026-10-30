/**
 * 静态资源版本号（单一真相源）。
 *
 * 为什么必须集中在一处：`public/styles.css` 通过 Workers Assets 发布，默认带长缓存。
 * 改完样式如果忘了给 `<link>` 加 `?v=` 或忘了同步版本号，站长看到的是旧样式，
 * 表现成"改了没生效"，而且刷新、清缓存都救不了——因为文件本身没变。
 *
 * 旧版本把这个查询串硬编码在 5 个地方（后台外壳 4 个页面 + 前台 layout），
 * 外加 3 处路由里的裸 HTML 字符串，改一次要全局搜索，漏一处就出现半新半旧的界面。
 *
 * 约定：**修改 public/styles.css 后，把 STYLESHEET_VERSION 改成当天日期 + 序号**。
 * `scripts/check-admin-templates.mjs` 不校验这个值（它没有"正确值"），
 * 但所有引用都必须走 STYLESHEET_HREF，避免又退回到硬编码。
 */
export const STYLESHEET_VERSION = '20261029-1'

/** 供 `<link rel="stylesheet" href="...">` 直接使用的地址。 */
export const STYLESHEET_HREF = '/styles.css?v=' + STYLESHEET_VERSION

/** 前台页面主脚本（处理样式表 preload 切换、移动端菜单、顶部搜索、Service Worker）。 */
export const MAIN_SCRIPT_HREF = '/main.js?v=' + STYLESHEET_VERSION
