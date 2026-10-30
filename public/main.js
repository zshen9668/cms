/**
 * 前台页面主脚本：处理样式表 preload 切换、移动端菜单、顶部搜索、Service Worker。
 * 由 layout.ts 通过 <script src="/main.js?v=..."> 引入，不再内联，
 * 避免 CSP nonce 与内联脚本白名单的关联问题。
 */
(() => {
  const toggle = document.querySelector('.mobile-menu-toggle');
  const more = document.querySelector('.bottom-nav-more');
  const panel = document.getElementById('mobileNav');
  const close = document.querySelector('.mobile-nav-close');
  if (!toggle || !panel) return;
  const setOpen = (open) => {
    panel.hidden = !open;
    panel.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('mobile-nav-open', open);
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  if (more) more.addEventListener('click', () => setOpen(panel.hidden));
  if (close) close.addEventListener('click', () => setOpen(false));
  panel.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  // 顶部搜索:点击图标展开搜索面板,再点收起;Escape 关闭。
  const searchToggle = document.querySelector('.header-search-toggle');
  const searchPanel = document.getElementById('headerSearch');
  if (searchToggle && searchPanel) {
    const setSearchOpen = (open) => {
      searchPanel.hidden = !open;
      searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        const field = searchPanel.querySelector('input[name="q"]');
        if (field) field.focus();
      }
    };
    searchToggle.addEventListener('click', () => setSearchOpen(searchPanel.hidden));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !searchPanel.hidden) setSearchOpen(false);
    };
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
