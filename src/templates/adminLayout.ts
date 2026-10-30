/**
 * 后台外壳：侧边栏导航、移动端抽屉、面包屑，以及登录/找回密码/初始化三个免登录页面。
 *
 * 拆自原单体 templates/admin.ts（2662 行）。后台导航的分组定义（NAV）也在这里，
 * 它是后台信息架构的唯一真相源：`check-admin-routes.mjs` 的快照只保证路由存在，
 * 而「某个页面挂在哪一组、叫什么名字」由 NAV 决定。
 */
import { escapeHtml } from './layout'
import { STYLESHEET_HREF } from './assets'
import { DEFAULT_ADMIN_SITE_NAME } from '../utils/adminSiteName'
import { INDUSTRY_PRESETS } from '../utils/industryPresets'
/**
 * Sanitize HTML for safe inline rendering in admin preview panes.
 * Prevents stored XSS from user-controlled article content (news pipeline).
 * Strips dangerous tags, attributes, and protocols.
 */
export function sanitizeAdminPreviewHtml(html: string): string {
  if (!html) return ''
  return String(html)
    // Remove script, style, iframe, object, embed, form, textarea, select tags and their content
    .replace(/<(script|style|iframe|object|embed|form|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Remove any remaining dangerous opening/closing tags
    .replace(/<\/?(script|style|iframe|object|embed|form|textarea|select)[^>]*>/gi, '')
    // Remove all on* event handlers (onclick, onload, onerror, etc.)
    .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove javascript:, vbscript:, data: protocols from href, src, xlink:href
    .replace(/\s+(?:href|src|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (_m) => {
      const lower = _m.toLowerCase()
      if (lower.includes('javascript:') || lower.includes('vbscript:') || lower.includes('data:')) {
        return ''
      }
      return _m
    })
    // Only allow safe tags: p, h1-h4, strong, br, span, img, a
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (full, tagName) => {
      const tag = String(tagName).toLowerCase()
      const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'br', 'span', 'img', 'a', 'div', 'section', 'ul', 'ol', 'li'])
      if (!allowed.has(tag)) return ''
      // For allowed tags, strip dangerous attributes but keep safe ones
      if (full.startsWith('</')) return '</' + tag + '>'
      // Keep only safe attributes
      let clean = full
      clean = clean.replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      clean = clean.replace(/\s+(?:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (_m) => {
        const lower = _m.toLowerCase()
        if (lower.includes('javascript:') || lower.includes('vbscript:') || lower.includes('data:')) {
          return ''
        }
        return _m
      })
      return clean
    })
    // Remove any unclosed tag fragments at end
    .replace(/<[a-z][^>]*$/i, '')
}

/**
 * 后台导航的分组定义。
 *
 * 这是后台信息架构的**唯一真相源**：侧边栏分组、面包屑的组名、移动端底部快捷栏
 * 全部从这里派生。旧版把底部快捷栏的 6 个链接硬编码在模板里，分组名散落在 NAV 的
 * 每一项上——新增一个后台页面要同时改三处，且容易漏。
 */
export type AdminNavGroupId = 'overview' | 'content' | 'pages' | 'seo' | 'ai' | 'system'

type AdminNavGroup = {
  id: AdminNavGroupId
  /** 侧边栏分组标题 */
  label: string
  /** 移动端底部栏用的短标签（宽度有限） */
  shortLabel: string
  icon: string
  /** 点击分组标题时该去哪一页（也是该组在底部栏的落点） */
  entryHref: string
  /** 分组用途，鼠标悬停时提示 */
  hint: string
}

export const NAV_GROUPS: readonly AdminNavGroup[] = [
  { id: 'overview', label: '总览', shortLabel: '首页', icon: '📊', entryHref: '/admin', hint: '站点运行状态与访问数据' },
  { id: 'content', label: '内容', shortLabel: '内容', icon: '📰', entryHref: '/admin/articles', hint: '文章、案例、采集、分发与留言' },
  { id: 'pages', label: '页面', shortLabel: '页面', icon: '📄', entryHref: '/admin/pages', hint: '前台页面、城市、服务与站点模块' },
  { id: 'seo', label: 'SEO 增长', shortLabel: 'SEO', icon: '🚀', entryHref: '/admin/seo', hint: '收录推送、GEO 监测与关键词矩阵' },
  { id: 'ai', label: 'AI', shortLabel: 'AI', icon: '🤖', entryHref: '/admin/ai-settings', hint: '模型通道、提示词与智能问答' },
  { id: 'system', label: '系统', shortLabel: '设置', icon: '⚙️', entryHref: '/admin/settings', hint: '媒体、权限、密钥、设置与部署自检' },
]

type AdminNavItem = {
  group: AdminNavGroupId
  href: string
  label: string
  sub?: string
  /** 站点的「前台页面」重命名后，侧边栏标签跟随它变化（见 /admin/page-nav-labels） */
  pageKey?: string
  icon: string
}

/** 侧边栏可见的后台页面清单，按分组顺序排列（分组顺序由 NAV_GROUPS 决定）。 */
export const NAV: readonly AdminNavItem[] = [
  { group: 'overview', href: '/admin', label: '数据概览', sub: '访问、内容与待办', icon: '📊' },
  { group: 'overview', href: '/admin/analytics', label: '访问统计', sub: '近 30 天每日 PV', icon: '📈' },
  { group: 'content', href: '/admin/articles', label: '文章管理', sub: '草稿、审核与发布', pageKey: 'articles', icon: '📰' },
  { group: 'content', href: '/admin/cases', label: '成功案例', sub: '客户案例与交付成果', icon: '🏆' },
  { group: 'content', href: '/admin/news-sources', label: '新闻采集', sub: '来源、定时与质量门槛', icon: '📡' },
  { group: 'content', href: '/admin/collection-logs', label: '采集日志', sub: '定时任务运行记录', icon: '📜' },
  { group: 'content', href: '/admin/social', label: '内容分发', sub: '国内平台文案与排版', icon: '📣' },
  { group: 'content', href: '/admin/messages', label: '客户留言', sub: '咨询与回复', icon: '💬' },
  { group: 'pages', href: '/admin/pages', label: '前台页面', sub: '页面、城市、服务与导航联系', icon: '📄' },
  { group: 'seo', href: '/admin/seo', label: 'SEO / 推送', sub: '收录提交与推送日志', icon: '🚀' },
  { group: 'seo', href: '/admin/geo', label: 'GEO / AI 搜索', sub: '中控、引用监测、体检', icon: '🧭' },
  { group: 'seo', href: '/admin/keywords', label: '关键词矩阵', sub: '城市 × 服务词库', icon: '🔎' },
  { group: 'seo', href: '/admin/rankings', label: '排名追踪', sub: 'SERP 排位雷达', icon: '📈' },
  { group: 'ai', href: '/admin/ai-settings', label: 'AI 通道', sub: '模型、免费层与测试', icon: '🤖' },
  { group: 'ai', href: '/admin/ai-prompts', label: 'AI 提示词', sub: '随行业自动生成，可补充', icon: '🧠' },
  { group: 'ai', href: '/admin/ai-qa', label: '智能问答', sub: '站内问答与企业微信', icon: '💬' },
  { group: 'system', href: '/admin/media', label: '媒体库', sub: 'R2 图片与文件', icon: '🖼️' },
  { group: 'system', href: '/admin/forms', label: '表单管理', sub: '动态表单与提交收集', icon: '📝' },
  { group: 'system', href: '/admin/rbac', label: '角色权限', sub: 'RBAC 自定义角色分配', icon: '🛡️' },
  { group: 'system', href: '/admin/api-keys', label: 'API 密钥', sub: 'Bearer 鉴权密钥管理', icon: '🔑' },
  { group: 'system', href: '/admin/settings', label: '系统设置', sub: '行业、管理员与站点信息', icon: '⚙️' },
  { group: 'system', href: '/admin/system-secrets', label: '系统密钥', sub: 'AI、推送与接入密钥', icon: '🗝️' },
  { group: 'system', href: '/admin/system', label: '系统自检', sub: '绑定、数据库与部署状态', icon: '🩺' },
]

/** 把扁平清单按 NAV_GROUPS 的顺序归组，供侧边栏渲染。 */
function groupedNav(): Array<{ group: AdminNavGroup; items: AdminNavItem[] }> {
  return NAV_GROUPS.map((group) => ({
    group,
    items: NAV.filter((item) => item.group === group.id),
  })).filter((entry) => entry.items.length > 0)
}

/**
 * 已并入「页面管理」的旧入口 → 归属菜单。
 *
 * 城市 / 服务 / 导航联系现在都是 /admin/pages 的分页签，但它们的编辑表单仍走原路由
 * （/admin/cities/:id/edit 等）。没有这张表，这些子页面会掉进「后台 / 管理」兜底，
 * 面包屑和移动端底部栏都不高亮。
 */
const NAV_ALIASES: ReadonlyArray<[string, string]> = [
  ['/admin/cities', '/admin/pages'],
  ['/admin/services', '/admin/pages'],
  ['/admin/modules', '/admin/pages'],
  ['/admin/subprojects', '/admin/pages'],
]

/** 根据 active 路径解析分组与页面标题，用于面包屑与导航高亮。 */
export function resolveNavContext(active: string): { groupId: AdminNavGroupId | ''; group: string; label: string; href: string } {
  const alias = NAV_ALIASES.find(([prefix]) => active === prefix || active.startsWith(prefix + '/'))
  const target = alias ? alias[1] : active
  const exact = NAV.find((n) => n.href === target)
  const matched = exact || NAV.filter((n) => n.href !== '/admin' && target.startsWith(n.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]
  if (!matched) return { groupId: '', group: '后台', label: '管理', href: '/admin' }
  const group = NAV_GROUPS.find((g) => g.id === matched.group)
  return { groupId: matched.group, group: group?.label || '后台', label: matched.label, href: matched.href }
}

/**
 * 侧边栏导航：分组可折叠 + 顶部筛选框。
 *
 * 折叠状态存在 localStorage（`admin.nav.collapsed`），首次访问默认全部展开——
 * 默认折叠会把一半功能藏起来，把"菜单少了"当成 bug 报过来比省滚动更糟。
 * 当前页所在分组始终强制展开，避免"点进去以后自己在哪一组"看不出来。
 */
function renderSidebarNav(active: string): string {
  const nav = resolveNavContext(active)
  const groups = groupedNav().map(({ group, items }) => {
    const hasActive = nav.groupId === group.id
    const bodyId = 'adminNavGroup-' + group.id
    const links = items.map((item) => {
      const isActive = item.href === nav.href
      return `<a class="admin-nav-link${isActive ? ' active' : ''}" href="${item.href}"${isActive ? ' aria-current="page"' : ''}${item.pageKey ? ` data-page-key="${item.pageKey}"` : ''}><span class="admin-nav-icon" aria-hidden="true">${item.icon}</span><span class="admin-nav-text"><span class="admin-nav-label">${escapeHtml(item.label)}</span>${item.sub ? `<small class="admin-nav-sub">${escapeHtml(item.sub)}</small>` : ''}</span></a>`
    }).join('\n        ')
    return `<section class="admin-nav-group${hasActive ? ' has-active' : ''}" data-nav-group="${group.id}" title="${escapeHtml(group.hint)}">
      <button type="button" class="admin-nav-group-title admin-nav-group-toggle" aria-expanded="true" aria-controls="${bodyId}">
        <span class="admin-nav-caret" aria-hidden="true">▾</span>
        <span class="admin-nav-group-emoji" aria-hidden="true">${group.icon}</span>
        <span class="admin-nav-group-name">${escapeHtml(group.label)}</span>
        <span class="admin-nav-group-count" aria-hidden="true">${items.length}</span>
      </button>
      <div class="admin-nav-group-body" id="${bodyId}">
        ${links}
      </div>
    </section>`
  }).join('\n    ')

  return `<label class="admin-nav-filter-wrap">
      <span class="admin-nav-filter-icon" aria-hidden="true">🔍</span>
      <input type="search" id="adminNavFilter" class="admin-nav-filter" placeholder="筛选菜单…" aria-label="筛选后台菜单" autocomplete="off" />
    </label>
    <div class="admin-nav-groups">
    ${groups}
    </div>`
}

/** 移动端底部快捷栏：一个分组一项，按当前页所属分组高亮（子页面也能正确高亮）。 */
function renderAdminBottomNav(active: string): string {
  const nav = resolveNavContext(active)
  return NAV_GROUPS.map((group) => {
    const isActive = nav.groupId === group.id
    return `<a href="${group.entryHref}" class="${isActive ? 'active' : ''}"${isActive ? ' aria-current="page"' : ''}><span aria-hidden="true">${group.icon}</span>${escapeHtml(group.shortLabel)}</a>`
  }).join('\n  ')
}

/**
 * 后台外壳。
 *
 * `opts.siteName` 由路由经 `resolveAdminSiteName(env, tenantId)` 解析后逐层传入;
 * 不传时落到 `DEFAULT_ADMIN_SITE_NAME`(见 utils/adminSiteName.ts)。
 * 这个参数保留为兜底,是为了让登录/初始化这类还没有租户上下文的页面,以及
 * 尚未完成改造的调用点仍能渲染出完整的页面,而不是显示空品牌名。
 */
export function renderAdminLayout(opts: { title: string; active: string; body: string; siteName?: string; cspNonce?: string; csrfToken?: string }): string {
  const nav = resolveNavContext(opts.active)
  const cspNonce = opts.cspNonce || ''
  const csrfToken = opts.csrfToken || ''
  return `<!DOCTYPE html>
<html lang="zh-CN" data-csp-nonce="${escapeHtml(cspNonce)}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="csrf-token" content="${escapeHtml(csrfToken)}" />
<title>${escapeHtml(opts.title)} - ${escapeHtml(opts.siteName || DEFAULT_ADMIN_SITE_NAME)} 后台管理</title>
<link rel="stylesheet" href="${STYLESHEET_HREF}" />
</head>
<body class="admin-page">
<div class="admin-shell">
  <div class="admin-mobile-header">
    <button type="button" class="admin-hamburger" onclick="toggleAdminMenu(true)" aria-label="打开菜单" aria-controls="adminSidebar" aria-expanded="false">☰</button>
    <span>◈ ${escapeHtml(opts.siteName || DEFAULT_ADMIN_SITE_NAME)} 后台</span>
    <form method="post" action="/admin/logout" class="admin-mobile-logout-form"><button type="submit" class="admin-mobile-logout">退出</button></form>
  </div>
  <div id="adminOverlay" class="admin-overlay" onclick="toggleAdminMenu(false)"></div>
  <aside id="adminSidebar" class="admin-sidebar" aria-label="后台导航">
    <div class="admin-brand">◈ <span>${escapeHtml(opts.siteName || DEFAULT_ADMIN_SITE_NAME)} 后台</span></div>
    <nav class="admin-sidebar-nav" aria-label="后台功能分组">
      ${renderSidebarNav(opts.active)}
    </nav>
    <form method="post" action="/admin/logout" class="admin-logout-form"><button type="submit" class="admin-logout-link">退出登录</button></form>
  </aside>
  <main class="admin-main">
    <div class="admin-content">
      <div class="admin-breadcrumb" aria-label="当前位置">
        <span class="admin-breadcrumb-group">${escapeHtml(nav.group)}</span>
        <span class="admin-breadcrumb-sep">/</span>
        <span class="admin-breadcrumb-page">${escapeHtml(nav.label)}</span>
      </div>
      ${opts.body}
    </div>
  </main>
</div>
<nav class="admin-bottom-nav" aria-label="后台快捷导航">
  ${renderAdminBottomNav(opts.active)}
</nav>
<script nonce="${cspNonce}">
function toggleAdminMenu(open){
  var sidebar=document.getElementById('adminSidebar');
  var overlay=document.getElementById('adminOverlay');
  var button=document.querySelector('.admin-hamburger');
  if(!sidebar||!overlay) return;
  sidebar.classList.toggle('open',!!open);
  overlay.classList.toggle('open',!!open);
  if(button) button.setAttribute('aria-expanded',String(!!open));
}
document.querySelectorAll('.admin-sidebar a').forEach(function(link){
  link.addEventListener('click',function(){ toggleAdminMenu(false); });
});

/* 分组折叠 + 菜单筛选。
   折叠状态记在 localStorage，默认全部展开：默认折叠会把一半功能藏起来，
   用户会当成"菜单不见了"。当前页所在分组由服务端打上 has-active，始终强制展开。 */
(function(){
  var STORE='admin.nav.collapsed';
  var groups=Array.prototype.slice.call(document.querySelectorAll('.admin-nav-group'));
  if(!groups.length) return;
  function readCollapsed(){
    try { var v=JSON.parse(localStorage.getItem(STORE)||'[]'); return Object.prototype.toString.call(v)==='[object Array]'?v:[]; }
    catch(e){ return []; }
  }
  function writeCollapsed(list){
    try { localStorage.setItem(STORE,JSON.stringify(list)); } catch(e){}
  }
  function setExpanded(group,open){
    var toggle=group.querySelector('.admin-nav-group-toggle');
    var body=group.querySelector('.admin-nav-group-body');
    if(!toggle||!body) return;
    toggle.setAttribute('aria-expanded',open?'true':'false');
    body.hidden=!open;
    group.classList.toggle('is-collapsed',!open);
  }
  var collapsed=readCollapsed();
  groups.forEach(function(group){
    var name=group.getAttribute('data-nav-group');
    var open=group.classList.contains('has-active')?true:collapsed.indexOf(name)===-1;
    setExpanded(group,open);
  });
  groups.forEach(function(group){
    var toggle=group.querySelector('.admin-nav-group-toggle');
    if(!toggle) return;
    toggle.addEventListener('click',function(){
      var name=group.getAttribute('data-nav-group');
      var open=group.querySelector('.admin-nav-group-body').hidden;
      setExpanded(group,open);
      var list=readCollapsed().filter(function(n){ return n!==name; });
      if(!open) list.push(name);
      writeCollapsed(list);
    });
  });
  var filter=document.getElementById('adminNavFilter');
  if(!filter) return;
  filter.addEventListener('input',function(){
    var q=filter.value.trim().toLowerCase();
    groups.forEach(function(group){
      var visible=0;
      group.querySelectorAll('.admin-nav-link').forEach(function(link){
        var hit=!q||link.textContent.toLowerCase().indexOf(q)!==-1;
        link.hidden=!hit;
        if(hit) visible++;
      });
      group.hidden=visible===0;
      // 筛选时强制展开命中分组，否则用户以为"没搜到"；清空后恢复记忆的折叠状态
      if(q) setExpanded(group,visible>0);
      else {
        var name=group.getAttribute('data-nav-group');
        setExpanded(group,group.classList.contains('has-active')?true:readCollapsed().indexOf(name)===-1);
      }
    });
  });
  filter.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&filter.value){ filter.value=''; filter.dispatchEvent(new Event('input')); }
  });
})();

fetch('/admin/page-nav-labels').then(function(r){ return r.ok ? r.json() : null; }).then(function(labels){
  if(!labels) return;
  document.querySelectorAll('[data-page-key]').forEach(function(link){
    var key=link.getAttribute('data-page-key');
    var label=link.querySelector('.admin-nav-label');
    if(key && labels[key]){
      if(label) label.textContent=labels[key];
      else link.textContent=labels[key];
    }
  });
}).catch(function(){});

/* CSRF 引导:把双提交 cookie 的 token 送到每个后台表单与 fetch 请求。
   服务端 csrfProtection 是严格比对(header 或 _csrf 字段必须与 cookie 一致),
   因此这里必须覆盖三条提交路径:
   1) 模板里已有的 <form method="post">(129 个,源码里不逐个手写隐藏字段);
   2) 页面加载后由 JS 创建的表单;
   3) fetch 发出的 POST(SEO 批量操作、分发标记等)。
   优先从 <meta name="csrf-token"> 读取 token(服务端注入，首次请求也可用);
   没读到时回退 cookie，读不到时直接跳过:宁可让请求以 403 被拒(可见、可排查),
   也不要静默提交一个必然失败的请求。 */
(function(){
  function readToken(){
    var meta=document.querySelector('meta[name="csrf-token"]');
    var metaVal = meta ? meta.getAttribute('content')||'' : '';
    if(metaVal) return metaVal;
    var parts=document.cookie?document.cookie.split(';'):[];
    for(var i=0;i<parts.length;i++){
      var item=parts[i].trim();
      if(item.indexOf('csrf_token=')===0){
        var raw=item.slice('csrf_token='.length);
        try { return decodeURIComponent(raw); } catch(e){ return raw; }
      }
    }
    return '';
  }
  var token=readToken();
  if(!token) return;
  window.__csrfToken=token;

  function fill(form){
    try {
      if(!form||!form.tagName||form.tagName.toLowerCase()!=='form') return;
      if(String(form.getAttribute('method')||'get').toLowerCase()!=='post') return;
      if(form.querySelector('input[name="_csrf"]')) return;
      var input=document.createElement('input');
      input.type='hidden';
      input.name='_csrf';
      input.value=token;
      form.appendChild(input);
    } catch(e){}
  }
  window.csrfFill=fill;

  function fillAll(root){
    if(!root||!root.querySelectorAll) return;
    var forms=root.querySelectorAll('form');
    for(var i=0;i<forms.length;i++) fill(forms[i]);
    fill(root);
  }
  fillAll(document);

  /* 动态插入的表单(弹层、局部刷新) */
  try {
    new MutationObserver(function(records){
      for(var i=0;i<records.length;i++){
        var added=records[i].addedNodes;
        for(var j=0;j<added.length;j++){ if(added[j].nodeType===1) fillAll(added[j]); }
      }
    }).observe(document.documentElement,{childList:true,subtree:true});
  } catch(e){}

  /* JS 建表后立刻 form.submit() 是同步的,上面那趟异步填充来不及,这里兜住 */
  var nativeSubmit=HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit=function(){
    fill(this);
    return nativeSubmit.apply(this,arguments);
  };

  /* fetch 的 POST 统一带 X-CSRF-Token */
  var nativeFetch=window.fetch;
  if(typeof nativeFetch==='function'){
    window.fetch=function(input,init){
      try {
        var url=typeof input==='string'?input:(input&&input.url)||'';
        var method=String((init&&init.method)||(input&&input.method)||'get').toUpperCase();
        if(method!=='GET'&&method!=='HEAD'){
          var abs=new URL(url,location.origin);
          if(abs.origin===location.origin&&abs.pathname.indexOf('/admin')===0){
            var headers=new Headers((init&&init.headers)||(typeof input!=='string'&&input?input.headers:undefined));
            if(!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token',token);
            init=Object.assign({},init,{headers:headers});
          }
        }
      } catch(e){}
      return nativeFetch.call(this,input,init);
    };
  }
})();
</script>
</body>
</html>`
}
/**
 * 角色权限不足时的提示页。
 *
 * 明确告诉站长「是角色权限拦下的、去哪里改」，而不是给一个空白页或 404——
 * 受限账号看到 404 会以为功能坏了，然后反复找站长报障。
 */
export function renderNoPermissionPage(groupLabel: string): string {
  return renderAdminLayout({
    title: '无访问权限',
    active: '/admin',
    body: `
    <div class="card" style="border-left:4px solid #e5484d;max-width:720px">
      <h2 style="margin-top:0">⛔ 当前角色没有访问「${escapeHtml(groupLabel)}」的权限</h2>
      <p style="color:var(--muted);font-size:13px;line-height:1.9">
        你的账号被分配了一个受限角色，该角色没有勾选这个后台模块。<br />
        需要访问时，请让超级管理员到「系统 → 角色权限」里，为你的角色勾选对应模块并保存。
      </p>
      <p style="margin-bottom:0"><a class="btn secondary" href="/admin">返回数据概览</a></p>
    </div>`,
  })
}

export function renderLoginPage(error?: string, turnstileSiteKey?: string): string {  const turnstileBlock = turnstileSiteKey ? `
  <div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" style="margin-bottom:14px"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>后台登录</title>
<link rel="stylesheet" href="${STYLESHEET_HREF}" /></head>
<body class="auth-page">
<form method="post" action="/admin/login" class="card auth-card">
  <h2>后台登录</h2>
  ${error ? `<p style="color:#e5484d;font-size:13px">${escapeHtml(error)}</p>` : ''}
  <input name="email" type="email" autocomplete="username" placeholder="管理员邮箱" required />
  <input name="password" type="password" autocomplete="current-password" placeholder="密码" style="margin-bottom:14px" required />
  ${turnstileBlock}
  <button class="btn" type="submit">登录</button>
  <p style="text-align:center;margin-top:12px;font-size:12px"><a href="/admin/recover">忘记密码？使用 SETUP_TOKEN 恢复管理员账号</a></p>
  <p style="text-align:center;margin-top:8px;font-size:12px;color:var(--muted)">首次使用会自动进入管理员初始化。</p>
</form>
</body></html>`
}

export function renderRecoverPage(
  error?: string,
  options: { requireToken?: boolean } = {},
): string {
  const requireToken = !!options.requireToken
  const tokenHelp = requireToken
    ? '当前 Worker 已配置 <strong>SETUP_TOKEN</strong>。请输入该 Secret 的当前值。'
    : '当前 Worker 尚未配置 <strong>SETUP_TOKEN</strong>。如果首次部署时没有配置过它，不存在可“找回”的旧令牌；请先到 Cloudflare → Worker → Settings → Variables and Secrets 新建一个名为 <strong>SETUP_TOKEN</strong> 的 Secret 并设置一个新的随机值，然后再回来恢复管理员。'
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>恢复管理员账号</title>
<link rel="stylesheet" href="${STYLESHEET_HREF}" /></head>
<body class="auth-page">
<form method="post" action="/admin/recover" class="card auth-card">
  <h2>恢复唯一管理员</h2>
  <p style="color:var(--muted);font-size:13px;line-height:1.7">仅用于忘记后台密码。<strong>SETUP_TOKEN</strong> 是管理员恢复密钥，不会由系统回显或保存到 D1；恢复后原密码立即失效。</p>
  <p style="color:${requireToken ? 'var(--muted)' : '#b45309'};font-size:12px;line-height:1.7">${tokenHelp}</p>
  ${error ? `<p style="color:#e5484d;font-size:13px">${escapeHtml(error)}</p>` : ''}
  <input name="setup_token" type="password" autocomplete="off" placeholder="SETUP_TOKEN" required />
  <input name="email" type="email" autocomplete="username" placeholder="新的管理员邮箱" required />
  <input name="password" type="password" autocomplete="new-password" placeholder="新的密码（至少10位，含两类字符）" minlength="10" maxlength="128" required />
  <button class="btn" type="submit">恢复管理员账号</button>
  <p style="text-align:center;margin-top:12px;font-size:12px"><a href="/admin/login">返回登录</a></p>
</form>
</body></html>`
}

export function renderSetupPage(error?: string, options: { requireToken?: boolean; industryPresets?: Array<{ id: string; label: string }> } = {}) {
  const presets = options.industryPresets || []
  const presetOptions = presets.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('')
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>初始化管理员账号</title>
<link rel="stylesheet" href="${STYLESHEET_HREF}" /></head>
<body class="auth-page">
<form method="post" action="/admin/setup" class="card auth-card">
  <h2>初始化管理员账号</h2>
  <p style="color:var(--muted);font-size:13px">首次使用请创建管理员账号，创建后会自动登录后台。</p>
  ${error ? `<p style="color:#e5484d;font-size:13px">${escapeHtml(error)}</p>` : ''}
  ${options.requireToken ? '<input name="setup_token" type="password" autocomplete="off" placeholder="初始化令牌（Cloudflare Secret：SETUP_TOKEN）" required />' : ''}
  <input name="email" type="email" autocomplete="username" placeholder="管理员邮箱" required />
  <input name="password" type="password" autocomplete="new-password" placeholder="密码（至少10位，含两类字符）" minlength="10" maxlength="128" style="margin-bottom:14px" required />
  <label style="display:block;margin-top:10px">行业模板（首次配置，创建后可在「系统设置」修改）</label>
  <select name="industry_preset_id" style="width:100%;padding:8px;margin-bottom:14px">
    <option value="">暂不选（稍后再配）</option>
    ${presetOptions}
  </select>
  <button class="btn" type="submit">创建账号并登录</button>
</form>
<p style="text-align:center;margin-top:12px;font-size:12px"><a href="/admin/login">已有账号？去登录</a></p>
</body></html>`
}

export function renderSetupSuccessPage(opts: { siteName?: string; industryApplied: boolean; industryLabel?: string; citiesInserted?: number; servicesInserted?: number }): string {
  const siteName = escapeHtml(opts.siteName || DEFAULT_ADMIN_SITE_NAME)
  const industryHtml = opts.industryApplied
    ? `<div class="card" style="border-left:4px solid #1a8a4e;margin-bottom:14px">
      <h3 style="margin-top:0">✅ 行业配置已应用</h3>
      <p style="color:var(--muted);font-size:13px;margin:6px 0">${opts.industryLabel ? '行业模板：<strong>' + escapeHtml(opts.industryLabel) + '</strong><br />' : ''}城市已写入 <strong>${opts.citiesInserted ?? 0}</strong> 个，服务已写入 <strong>${opts.servicesInserted ?? 0}</strong> 个，关键词矩阵已生成。</p>
    </div>`
    : `<div class="card" style="border-left:4px solid var(--muted);margin-bottom:14px">
      <h3 style="margin-top:0">⏭ 行业配置暂未应用</h3>
      <p style="color:var(--muted);font-size:13px;margin:6px 0">创建时未选择行业模板，可在后台「系统设置」中稍后配置。</p>
    </div>`
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>初始化完成</title>
<link rel="stylesheet" href="${STYLESHEET_HREF}" /></head>
<body class="auth-page">
<div class="card auth-card" style="max-width:720px">
  <h2>✅ 管理员账号已创建</h2>
  <p style="color:var(--muted);font-size:13px">账号已创建并自动登录后台。</p>
  ${industryHtml}
  <div style="margin-top:14px">
    <a class="btn" href="/admin/ai-settings">下一步：配置 AI 通道 →</a>
    <a class="btn secondary" href="/admin/system-secrets">下一步：配置 SEO 推送密钥 →</a>
  </div>
  <p style="text-align:center;margin-top:12px;font-size:12px"><a href="/admin">直接进入后台</a></p>
</div>
</body></html>`
}
