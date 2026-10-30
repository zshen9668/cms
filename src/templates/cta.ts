/**
 * 前台「联系我们」CTA 悬浮区块。
 *
 * 右下角固定悬浮按钮，点击后展开卡片，包含电话/微信/表单入口/二维码。
 * 文案与联系方式全部来自后台 settings，站点统一配置、全站即时生效。
 *
 * 由 renderLayout 注入，位于 </body> 之前，z-index 高于导航与页脚。
 * 可被 settings.site_cta_enabled 开关关闭（缺省开启）。
 */
import { escapeHtml } from './layout'
import type { ContactChannel } from '../modules/contactChannels/types'
import { filterContactChannels } from '../modules/contactChannels/service'
import type { Locale } from '../utils/i18n'

export function renderCtaWidget(opts: {
  siteName?: string
  ctaTitle?: string
  ctaSubtitle?: string
  ctaBtnText?: string
  contactChannels: ContactChannel[]
  locale: Locale
  enabled: boolean
}): string {
  const {
    siteName = '本站',
    ctaTitle = '联系我们',
    ctaSubtitle = '有需求？立即咨询',
    ctaBtnText = '立即咨询',
    contactChannels,
    locale = 'zh-CN',
    enabled = true,
  } = opts
  if (enabled === false) return ''

  const channelList = filterContactChannels(contactChannels, 'contact')
  const phones = channelList.filter((c) => c.type === 'phone').map((c) => c.value)
  const wechats = channelList.filter((c) => c.type === 'wechat').map((c) => c.value)
  const qqs = channelList.filter((c) => c.type === 'qq').map((c) => c.value)

  const qrHtml = channelList.some((c) => c.qrUrl)
    ? `
    <div class="cta-qr">
      ${channelList
        .filter((c) => c.qrUrl)
        .map((c) => `
          <div class="cta-qr-item">
            <img src="${escapeHtml(c.qrUrl)}" alt="${escapeHtml(c.label || c.type)} 二维码" width="100" height="100" loading="lazy" />
            <span class="cta-qr-label">${escapeHtml(c.label || c.type)}</span>
          </div>
        `).join('')}
    </div>
    `
    : ''

  const phoneHtml = phones.length
    ? `<div class="cta-contact-item"><a href="tel:${escapeHtml(phones[0])}"><span class="cta-icon">📞</span>${escapeHtml(phones[0])}</a></div>`
    : ''
  const wechatHtml = wechats.length
    ? `<div class="cta-contact-item"><span class="cta-icon">💬</span><span>${escapeHtml(wechats[0])}</span></div>`
    : ''
  const qqHtml = qqs.length
    ? `<div class="cta-contact-item"><a href="https://wpa.qq.com/msgrd?v=3&uin=${escapeHtml(qqs[0])}&site=qq&menu=yes"><span class="cta-icon">Q</span>${escapeHtml(qqs[0])}</a></div>`
    : ''

  return `
<div class="cta-wrapper">
  <button class="cta-btn" type="button" aria-expanded="false" aria-controls="ctaPanel" aria-label="${escapeHtml(ctaTitle)}">
    <span aria-hidden="true">💬</span><span class="cta-btn-text">${escapeHtml(ctaBtnText)}</span>
  </button>
  <div class="cta-panel" id="ctaPanel" hidden role="dialog" aria-modal="true" aria-label="${escapeHtml(ctaTitle)}">
    <div class="cta-panel-header">
      <h3 class="cta-title">${escapeHtml(ctaTitle)}</h3>
      <p class="cta-subtitle">${escapeHtml(ctaSubtitle)}</p>
    </div>
    <div class="cta-contact-list">
      ${phoneHtml}${wechatHtml}${qqHtml}
    </div>
    ${qrHtml}
    <div class="cta-form-action">
      <a class="cta-form-btn" href="/contact">${escapeHtml(ctaBtnText)}</a>
    </div>
    <button class="cta-close" type="button" aria-label="关闭">×</button>
  </div>
</div>
<style>
.cta-wrapper{position:fixed;right:16px;bottom:16px;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Helvetica,Arial,sans-serif}
.cta-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;border:0;background:#1557a8;color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(21,87,168,.35)}
.cta-btn:hover{background:#0e3a7c}
.cta-btn:focus-visible{outline:3px solid rgba(21,87,168,.4);outline-offset:2px}
.cta-panel{position:absolute;right:0;bottom:calc(100% + 12px);width:min(320px,calc(100vw - 32px));max-height:min(420px,70vh);display:flex;flex-direction:column;background:#fff;border:1px solid #dbe4f0;border-radius:14px;box-shadow:0 16px 48px rgba(10,42,92,.20);overflow:hidden;animation:ctaSlideUp .2s ease}
@keyframes ctaSlideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.cta-panel[hidden]{display:none}
.cta-panel-header{padding:14px 16px;border-bottom:1px solid #e9ecef;background:#f8fafc}
.cta-title{margin:0;font-size:16px;font-weight:700;color:#16223a}
.cta-subtitle{margin:4px 0 0;font-size:13px;color:#64748f}
.cta-contact-list{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.cta-contact-item{display:flex;align-items:center;gap:10px;font-size:14px;color:#16223a}
.cta-contact-item .cta-icon{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:#eef4fb;color:#1557a8;font-size:16px}
.cta-contact-item a{color:inherit;text-decoration:none}
.cta-contact-item a:hover{text-decoration:underline}
.cta-qr{padding:12px 16px;border-top:1px solid #e9ecef}
.cta-qr-item{display:flex;flex-direction:column;align-items:center;gap:6px}
.cta-qr-item img{width:88px;height:88px;border-radius:8px;background:#fff;border:1px solid #e9ecef}
.cta-qr-label{font-size:12px;color:#64748f}
.cta-form-action{padding:12px 16px;border-top:1px solid #e9ecef}
.cta-form-btn{display:block;width:100%;padding:10px 16px;border-radius:10px;border:0;background:#1557a8;color:#fff;font-size:14px;font-weight:700;cursor:pointer;text-align:center}
.cta-form-btn:hover{background:#0e3a7c}
.cta-close{position:absolute;top:8px;right:8px;border:0;background:transparent;color:#64748f;font-size:20px;line-height:1;cursor:pointer;padding:4px 8px}
.cta-close:hover{color:#16223a}
@media (max-width:640px){
  .cta-wrapper{right:12px;bottom:12px}
  .cta-panel{width:calc(100vw - 24px);right:unset;left:12px}
}
</style>
</div>
`
}
