/** 后台系统域模板：媒体库、系统自检与站点设置（含行业模板与首页排序）。 */
import { escapeHtml } from './layout'
import { getSiteProfile } from '../utils/siteProfile'
import { INDUSTRY_PRESETS } from '../utils/industryPresets'
import { type IndustryPreset } from '../utils/industryPresets'
import { HOME_SECTION_LABELS, parseHomeSectionOrder } from './homeSections'
import { renderAdminLayout } from './adminLayout'

/** 格式化文件大小显示 */
function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '-'
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(2) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

/** 判断是否已压缩 */
function isCompressed(originalSize: number | null, storedSize: number | null): boolean {
  return originalSize != null && storedSize != null && Number(storedSize) < Number(originalSize)
}

export function renderMediaRow(row: any): string {
  const objectKey = String(row.object_key || '')
  const publicUrl = '/media/' + objectKey.slice('media/'.length)
  const type = String(row.content_type || '')
  const size = formatFileSize(Number(row.size || 0))
  const origSize = formatFileSize(row.original_size)
  const storedSize = formatFileSize(row.stored_size)
  const compressed = isCompressed(row.original_size, row.stored_size)
  const preview = type.startsWith('image/')
    ? `<a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(publicUrl)}" alt="" loading="lazy" width="72" height="54" style="width:72px;height:54px;object-fit:contain;background:#f6f8fb;border:1px solid #e5eaf0;border-radius:6px;display:block" /></a>`
    : '<span style="color:var(--muted);font-size:12px">非图片</span>'
  return `<tr>
    <td><input class="media-select" type="checkbox" name="keys" value="${escapeHtml(objectKey)}" /></td>
    <td>${preview}</td>
    <td>${escapeHtml(row.original_name || objectKey.split('/').pop() || objectKey)}${row.r2_only ? '<br><small style="color:#8a98aa">历史R2文件</small>' : ''}</td>
    <td>${escapeHtml(type || '未知')}</td>
    <td>${origSize}</td>
    <td>${storedSize}${compressed ? ' <span style="color:#1a8a4e;font-size:11px">✓ 已压缩</span>' : ''}</td>
    <td>${size}</td>
    <td>${escapeHtml(row.uploaded_at || '')}</td>
    <td><a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">打开</a></td>
    <td>
      <button class="btn secondary" type="button" onclick="copyUrl('${escapeHtml(publicUrl)}')">复制地址</button>
      <button class="btn secondary" type="button" style="color:#e5484d" onclick="deleteOneMedia('${escapeHtml(objectKey).replace(/'/g, '&#39;')}')">删除</button>
    </td>
  </tr>`
}

export function renderMediaPage(rows: any[], total: number | string = rows.length, error = '', qr: { url?: string; previewUrl?: string } = {}, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const qrUrl = String(qr.url || '').trim()
  const qrPreviewUrl = String(qr.previewUrl || qrUrl)
  return renderAdminLayout({
    title: 'R2 媒体库', active: '/admin/media', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <div>
        <h2>R2 媒体库</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:13px">
          R2 中当前列出 <strong>${escapeHtml(String(total))}</strong> 个媒体文件（历史 R2 文件也会显示；当前页面最多显示 1000 个）。
          删除会直接从 Cloudflare R2 删除；如果文件被首页、城市、服务或微信二维码引用，系统会同时解除引用，不保留回收站。
        </p>
      </div>
    </div>
    ${error ? '<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">' + escapeHtml(error) + '</div>' : ''}

    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">微信二维码</h3>
      <p style="color:var(--muted);font-size:12px;line-height:1.7;margin:0 0 10px">二维码就是一张 R2 媒体文件，统一在这里上传/替换/删除。上传会替换旧文件；删除会同时删除 R2 文件和配置，不保留副本。</p>
      ${qrUrl ? `
        <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
          <div>
            <div class="contact-qr-admin"><img src="${escapeHtml(qrPreviewUrl)}" alt="当前微信二维码" loading="eager" decoding="sync" width="180" height="180" /></div>
            <div style="margin-top:8px;color:var(--muted);font-size:12px">当前已上传二维码</div>
          </div>
          <form method="post" action="/admin/media/contact-qr/delete">
            <button class="btn secondary" type="submit" onclick="return confirm('确认永久删除当前微信二维码？R2 文件和配置会立即删除，删除后不可恢复。')">删除微信二维码</button>
          </form>
        </div>` : '<div style="margin:0 0 12px;color:var(--muted);font-size:13px">当前没有微信二维码。</div>'}
      <form class="admin-form" method="post" action="/admin/media/contact-qr" enctype="multipart/form-data" style="margin-top:14px;max-width:none">
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required />
        <button class="btn" type="submit">上传并替换微信二维码</button>
      </form>
    </div>

    <form class="admin-form" method="post" action="/admin/media/upload" enctype="multipart/form-data">
      <label>上传文件（单文件最大 10MB）</label>
      <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf" required />
      <button class="btn" type="submit">上传到 R2</button>
    </form>

    <form method="post" action="/admin/media/delete-selected" id="mediaDeleteForm">
      <div class="admin-actions" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:20px">
        <div style="color:var(--muted);font-size:12px">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="mediaSelectAll" /> 全选当前显示文件
          </label>
          <span id="mediaSelectedCount" style="margin-left:10px">已选 0 个</span>
        </div>
        <button class="btn secondary" type="submit" id="mediaDeleteSelected" disabled onclick="return confirm('确认永久删除选中的 R2 文件？删除后不可恢复。')">删除选中</button>
      </div>
      <div class="admin-table-wrap">
        <table style="margin-top:10px">
          <thead><tr><th style="width:44px">选择</th><th>预览</th><th>文件</th><th>类型</th><th>原始大小</th><th>存储大小</th><th>大小</th><th>上传时间</th><th>地址</th><th>操作</th></tr></thead>
          <tbody>
          ${rows.length ? rows.map((r) => renderMediaRow(r)).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:28px">R2 暂无媒体文件</td></tr>'}
          </tbody>
        </table>
      </div>
    </form>

    <script>
      function copyUrl(path){
        navigator.clipboard.writeText(new URL(path, location.origin).href)
          .then(function(){ alert('地址已复制'); })
          .catch(function(){ prompt('复制下面地址', new URL(path, location.origin).href); });
      }
      function deleteOneMedia(path){
        if(!confirm('确认永久删除这个 R2 文件？删除后不可恢复。')) return;
        var form=document.createElement('form');
        form.method='post';
        form.action='/admin/media/delete-one';
        form.style.display='none';
        var input=document.createElement('input');
        input.type='hidden';
        input.name='object_key';
        input.value=path;
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
      }
      (function(){
        var all=document.getElementById('mediaSelectAll');
        var button=document.getElementById('mediaDeleteSelected');
        var count=document.getElementById('mediaSelectedCount');
        if(!all||!button||!count) return;
        function refresh(){
          var selected=document.querySelectorAll('.media-select:checked').length;
          var boxes=document.querySelectorAll('.media-select').length;
          count.textContent='已选 '+selected+' 个';
          button.disabled=selected===0;
          all.checked=boxes>0 && selected===boxes;
          all.indeterminate=selected>0 && selected<boxes;
        }
        all.addEventListener('change',function(){
          document.querySelectorAll('.media-select').forEach(function(el){ el.checked=all.checked; });
          refresh();
        });
        document.querySelectorAll('.media-select').forEach(function(el){ el.addEventListener('change',refresh); });
        refresh();
      })();
    </script>
  `,
  })
}


export function renderSystemPage(checks: { label: string; ok: boolean; detail: string }[], siteName?: string, cspNonce?: string, csrfToken?: string, logRetention?: { completedAt?: string; tenantId?: number; totalDeleted?: number; totalUpdated?: number } | null): string {
  return renderAdminLayout({
    title: '系统自检', active: '/admin/system', siteName, cspNonce, csrfToken,
    body: `
    <h2>系统自检</h2>
    <p style="color:var(--muted);font-size:13px">默认只检查绑定是否存在；点击下面按钮才会执行一次真实的 KV / R2 / Workers AI 读写测试，避免反复刷新后台消耗资源。</p>
    <p><a class="btn" href="/admin/system?probe=1">执行完整检测（KV + R2 + AI）</a></p>
    <div class="card" style="margin:16px 0;border-left:4px solid #3b82f6">
      <h3 style="margin-top:0">缓存与资源清理</h3>
      <p style="color:var(--muted);font-size:13px;line-height:1.8">这里不提供“全站生产库一键清空”。D1、R2、KV 是独立资源，不能安全地做成一个原子同步删除动作。日常缓存失效由内容变更自动处理；文章、城市、服务和媒体文件应在各自管理页面按对象删除。</p>
      <p style="color:var(--muted);font-size:13px;line-height:1.8"><strong>安全边界：</strong>删除文章会清理文章关联记录；删除城市/服务会清理对应关键词、AI 页面配置和专属 R2 图片；R2 媒体库支持逐文件删除。系统不会通过此页面删除管理员账号、基础设置、迁移记录或整个 D1。</p>
      <p style="margin-bottom:0"><a class="btn secondary" href="/admin/media">打开 R2 媒体库</a> <a class="btn secondary" href="/admin/articles">管理文章</a> <a class="btn secondary" href="/admin/cities">管理城市</a> <a class="btn secondary" href="/admin/services">管理服务</a></p>
    </div>

    <div class="card" style="margin:16px 0;border-left:4px solid #10b981">
      <h3 style="margin-top:0">📋 日志清理状态（上次定时运行）</h3>
      ${logRetention
        ? `<p style="color:var(--muted);font-size:13px;margin:6px 0">上次清理时间：${escapeHtml(logRetention.completedAt || '—')}</p>
         <p style="margin:0 0 6px;color:var(--muted);font-size:12px">清理统计：删除 <strong>${logRetention.totalDeleted ?? 0}</strong> 行超期数据，摘要脱敏 <strong>${logRetention.totalUpdated ?? 0}</strong> 条问答记录。</p>`
        : `<p style="color:var(--muted);font-size:13px;margin:0">尚未执行过清理任务。每天 03:00（北京时间）自动运行一次，清理完成后此处显示上次统计。</p>`}
      <p style="color:var(--muted);font-size:12px;line-height:1.8;margin:8px 0 0">
        保留策略：rank_history 90 天 · ai_qa_messages 30 天（超期仅保留问答摘要）· collection_logs/submit_logs/review_logs 180 天 · daily_stats 365 天。
      </p>
    </div>
    <table>
      <thead><tr><th>检查项</th><th>状态</th><th>说明</th></tr></thead>
      <tbody>
      ${checks.map((c) => `<tr>
        <td>${escapeHtml(c.label)}</td>
        <td>${(c as any).level === 'warning'
          ? '<span class="badge" style="background:#fff6db;color:#9a6700">警告</span>'
          : c.ok
            ? '<span class="badge" style="background:#e7f7ee;color:#1a8a4e">正常</span>'
            : '<span class="badge" style="background:#fdeaea;color:#e5484d">异常</span>'}</td>
        <td style="max-width:420px;word-break:break-all">${escapeHtml(c.detail)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  `,
  })
}

export function renderSettingsPage(settings: Record<string, string>, error = '', saved = false, ai = '', siteName?: string, cspNonce?: string, csrfToken?: string, presets: IndustryPreset[] = []): string {
  const siteProfile = getSiteProfile(settings)
  // 画像名称可自定义；未填写时回落到默认标题，保证老站点显示不变。
  const profileName = String(settings.site_profile_name || '').trim() || '白标行业 / 站点画像'
  const aiConfigSaved = ai === 'industry-config'
  const matrixOk = settings.matrix_ok === '1'
  return renderAdminLayout({
    title: '系统设置', active: '/admin/settings', siteName, cspNonce,
    body: `
    <div class="section-title"><h2>系统设置</h2></div>
    ${(settings as any).__home_order_saved ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">首页模块顺序已保存,前台立即生效。</div>' : ''}
    ${settings.__account_saved ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">管理员账号已保存。</div>' : ''}
    ${settings.__account_error ? '<div class="card" style="border-left:4px solid #c0392b;color:#c0392b;margin-bottom:16px">' + escapeHtml(settings.__account_error) + '</div>' : ''}
    ${aiConfigSaved ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px"><strong>✅ 行业与业务配置已保存</strong><br><small>关键词矩阵已重新生成 ${settings.matrix || '0'} 条，页面级 SEO 已同步 ${settings.seo || '0'} 页，城市 ${settings.cities || '0'} 个，服务 ${settings.services || '0'} 个。${matrixOk ? '' : ' 矩阵生成部分失败，请查看后台日志。'}</small></div>` : ''}
    <form class="admin-form card" method="post" action="/admin/account" style="margin-bottom:16px">
      <h3 style="margin:0 0 6px">👤 管理员账号(系统仅一个)</h3>
      <p style="margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.8">修改唯一管理员的登录邮箱与密码。密码留空则保持不变;新密码至少 10 位且包含两类字符。保存后旧登录会失效,请用新邮箱或新密码重新登录。</p>
      <label>管理员邮箱</label>
      <input type="email" name="email" maxlength="200" required value="${escapeHtml(settings.__account_email || '')}" autocomplete="username" />
      <label>新密码(可留空)</label>
      <input type="password" name="password" maxlength="128" autocomplete="new-password" />
      <button class="btn" type="submit">保存管理员账号</button>
    </form>
    <p style="color:var(--muted);font-size:13px;margin-top:-8px">全站基础信息、白标站点主题、联系方式与二维码统一管理；二维码删除后立即从 R2 删除。</p>
    <div class="card admin-settings-card">
      <h3 style="margin:0 0 6px">🏷️ ${escapeHtml(profileName)}</h3>
      <p style="margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.8">复制本仓库到其他行业时，优先修改这里。AI、自动 SEO、首页默认文案和新闻分类会读取这些配置；新站保持白标空状态，行业内容由后台配置。</p>
      <form method="post" action="/admin/settings" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0 0 12px">
        <div style="flex:1;min-width:220px">
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">画像名称（后台卡片标题，可自定义）</label>
          <input name="site_profile_name" maxlength="60" value="${escapeHtml(settings.site_profile_name || '')}" placeholder="例如：内蒙古算力中心租赁" style="width:100%;box-sizing:border-box" id="profileNameInput" />
          <p style="font-size:12px;color:var(--muted);margin-top:4px">输入后自动匹配行业预设，匹配到将回填下方 5 个字段</p>
        </div>
        <button class="btn secondary" type="submit">保存画像名称</button>
      </form>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px">
        <span class="badge">当前主题：${escapeHtml(siteProfile.topic)}</span>
        <span class="badge">行业：${escapeHtml(siteProfile.industry)}</span>
        <span class="badge">模板：${escapeHtml(settings.site_template || 'custom')}</span>
        <span class="badge">服务：${escapeHtml(String(siteProfile.primaryServices.slice(0,5).join('、')))}</span>
      </div>
      <p style="margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.7">首次部署保持白标空站点。站点名称、行业名称、服务、行业关键词和新闻分类都由这里统一定义；AI、SEO、GEO 和前台页面共用这份站点画像。</p>
    </div>
    <form method="post" action="/admin/settings/industry" class="admin-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:10px;border:1px dashed #ccc;border-radius:8px;max-width:none">
      <select name="preset_id" style="max-width:260px" required>
        <option value="">选择行业模板...</option>
        ${INDUSTRY_PRESETS.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('')}
      </select>
      <button class="btn" type="submit">一键应用行业</button>
      <span style="color:var(--muted);font-size:12px">将自动写入行业画像、核心服务、关键词与新闻分类;AI 提示词随画像自动生效。</span>
    </form>
    <div class="card admin-settings-card" style="margin:0 0 12px;padding:16px;border:1px solid var(--border);border-radius:12px;background:#fff">
      <h3 style="margin:0 0 10px">🏭 行业与业务配置</h3>
      <p style="margin:0 0 10px;color:var(--muted);font-size:12px;line-height:1.7">设置后自动应用到全站 AI 内容生成、关键词矩阵、SEO 页面标题与描述等。修改后无需重新部署，全站立即生效。</p>
      <form class="admin-form" id="industryConfigForm" method="post" action="/admin/settings/industry-config" style="margin:0">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;align-items:flex-end">
          <div>
            <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">行业类型（预设）</label>
            <select name="industry_preset_id" id="industryPresetSelect" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:#fff">
              <option value="">选择行业预设...</option>
              ${INDUSTRY_PRESETS.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('')}
            </select>
            <p style="margin:4px 0 0;color:var(--muted);font-size:11px">选中后可点「应用行业预设」自动填充下方字段。</p>
          </div>
          <div style="grid-column:1/-1">
            <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">行业关键词（逗号分隔，自动进入 SEO 与 AI 提示词）</label>
            <div style="display:flex;gap:8px;align-items:flex-end">
              <input name="industry_keywords" maxlength="1600" value="${escapeHtml(settings.industry_keywords || '')}" placeholder="例如：服务场景A,目标客户B,行业术语C" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:#fff" />
              <button class="btn secondary" type="button" onclick="generateIndustryKeywords()">🤖 AI 生成行业关键词</button>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">目标客户</label>
            <input name="target_customers" maxlength="300" value="${escapeHtml(siteProfile.targetCustomers || '')}" placeholder="例如：中小企业主、企业管理人员" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:#fff" />
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">服务特色</label>
            <input name="service_features" maxlength="500" value="${escapeHtml(siteProfile.serviceFeatures || '')}" placeholder="例如：经营咨询、资质办理、合规指导" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:#fff" />
          </div>
          <div style="grid-column:1/-1">
            <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">应用场景</label>
            <textarea name="application_scenarios" rows="2" maxlength="500" placeholder="例如：企业注册变更、资质申请办理、合规审查" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:#fff">${escapeHtml(siteProfile.applicationScenarios || '')}</textarea>
          </div>
          <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn secondary" type="submit">保存行业与业务配置</button>
            <button class="btn secondary" type="submit" formaction="/admin/settings/industry" onclick="return confirm('将覆盖当前行业画像、核心服务、关键词与新闻分类。继续？')">应用行业预设</button>
            <button class="btn" type="button" onclick="setupIndustryBackend()">⚡ 一键设置后台</button>
            <button class="btn secondary" type="button" onclick="saveCustomPreset()">💾 保存为自定义预设</button>
            <button class="btn secondary" type="button" onclick="generateIndustryKeywords()">🤖 AI 生成行业关键词</button>
          </div>
        </div>
      </form>
      <script>
      (function(){
        function toast(msg){
          var el = document.getElementById('industryConfigToast');
          if(!el){
            el = document.createElement('div');
            el.id = 'industryConfigToast';
            el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:50;padding:10px 16px;border-radius:8px;color:#fff;font-size:13px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.15)';
            document.body.appendChild(el);
          }
          el.textContent = msg;
          el.style.background = /^✅/.test(msg) ? '#1a8a4e' : '#c0392b';
          el.style.display = 'block';
          setTimeout(function(){ el.style.display = 'none'; }, 3000);
        }
        function fillField(name, value){
          var el = document.getElementById('industryConfigForm');
          if(!el) return;
          var f = el.elements[name];
          if(f && value !== undefined && value !== null) f.value = String(value);
        }
        function loadPresets(){
          fetch('/admin/settings/presets', { credentials: 'same-origin' })
            .then(function(res){ return res.ok ? res.json() : null; })
            .then(function(data){
              if(!data || !Array.isArray(data.presets)) return;
              var custom = data.presets.filter(function(p){ return p && !p.is_built_in; });
              var select = document.getElementById('industryPresetSelect');
              if(!select) return;
              var seen = {};
              Array.prototype.forEach.call(select.options, function(o){ seen[o.value] = true; });
              custom.forEach(function(p){
                if(p && p.id && !seen[p.id]){
                  var o = document.createElement('option');
                  o.value = p.id;
                  o.textContent = p.label || p.id;
                  select.appendChild(o);
                  seen[p.id] = true;
                }
              });
            })
            .catch(function(){});
        }
        var industryPresetSelect = document.getElementById('industryPresetSelect');
        if(industryPresetSelect){
          industryPresetSelect.addEventListener('change', function(){
            var presetId = this.value;
            if(!presetId) return;
            fetch('/admin/settings/presets/' + encodeURIComponent(presetId), { credentials: 'same-origin' })
              .then(function(res){ return res.ok ? res.json() : null; })
              .then(function(p){
                if(!p) return;
                // 回填5个字段（预设优先；已手工填写的字段若非空则保留，避免覆盖用户输入）
                if(!document.getElementById('industryConfigForm').elements['target_customers'].value) fillField('target_customers', p.targetCustomers);
                if(!document.getElementById('industryConfigForm').elements['service_features'].value) fillField('service_features', p.serviceFeatures);
                if(!document.getElementById('industryConfigForm').elements['application_scenarios'].value) fillField('application_scenarios', p.applicationScenarios);
                if(!document.getElementById('industryConfigForm').elements['industry_keywords'].value) fillField('industry_keywords', p.industryKeywords);
              })
              .catch(function(){});
          });
          loadPresets();
          // 画像名称输入框：输入时自动匹配行业预设
          var profileNameInput = document.getElementById('profileNameInput');
          if(profileNameInput){
            profileNameInput.addEventListener('input', function(){
              var name = profileNameInput.value.toLowerCase();
              if(!name) return;
              var presets = [
                {id: 'enterprise-service', labels: ['物流','货运','报关','物流与货运']},
                {id: 'home-services', labels: ['家政','维修','上门','本地家政']},
                {id: 'education-training', labels: ['教育','培训','考证','职业教育']},
                {id: 'health-clinic', labels: ['健康','体检','医疗','体检与医疗']},
                {id: 'construction-decoration', labels: ['建筑','装饰','工程','建筑工程与装饰']},
                {id: 'legal-ip', labels: ['法律','知识产权','商标','法律与知识产权']},
                {id: 'environment-testing', labels: ['环保','检测','认证','环保与检测认证']},
                {id: 'logistics-freight', labels: ['物流','货运','仓储','物流与货运']},
                {id: 'software-it', labels: ['软件','IT','信息化','软件与 IT 服务']},
                {id: 'auto-service', labels: ['汽车','维修','保养','汽车服务与维修']},
                {id: 'food-catering', labels: ['餐饮','食品','餐饮与食品经营']},
                {id: 'hr-labor', labels: ['人力','劳务','招聘','人力资源与劳务']}
              ];
              var matched = null;
              for(var i = 0; i < presets.length; i++){
                var p = presets[i];
                for(var j = 0; j < p.labels.length; j++){
                  if(name.indexOf(p.labels[j]) >= 0){
                    matched = p;
                    break;
                  }
                }
                if(matched) break;
              }
              if(matched){
                industryPresetSelect.value = matched.id;
                industryPresetSelect.dispatchEvent(new Event('change'));
              }
            });
          }
        }
        window.generateIndustryKeywords = function(){
          var form = document.getElementById('industryConfigForm');
          if(!form) return;
          var btn = event && event.target ? event.target : null;
          if(btn && btn.disabled) return;
          if(btn){ btn.disabled = true; btn.textContent = '生成中...'; }
          var preset = form.elements['industry_preset_id'] ? form.elements['industry_preset_id'].value : '';
          var keywords = form.elements['industry_keywords'] ? form.elements['industry_keywords'].value : '';
          var seeds = keywords.split(/[,，;；、\n]+/).map(function(s){return s.trim();}).filter(Boolean).slice(0, 5);
          var body = new FormData();
          body.append('industry_preset_id', preset || '');
          seeds.forEach(function(s){ body.append('seed_keywords[]', s); });
          fetch('/admin/settings/industry-keywords/ai', { method: 'POST', body: body, credentials: 'same-origin' })
            .then(function(res){ return res.ok ? res.json() : res.text().then(function(t){ throw new Error(t || 'AI 生成失败'); }); })
            .then(function(data){
              var input = form.elements['industry_keywords'];
              if(!input) return;
              var list = data.keywords || [];
              if(Array.isArray(list) && list.length){
                var merged = (keywords ? keywords.replace(/,\s*$/, '') + ',' : '') + list.join(',');
                input.value = merged;
              }
              toast('已生成 ' + (list.length || 0) + ' 个行业关键词，可手动调整后再保存。');
            })
            .catch(function(err){
              var m = err && err.message ? err.message : '';
              if(m.indexOf('未配置') >= 0 || m.indexOf('未启用') >= 0 || m.indexOf('configured') >= 0){
                toast('请先在 /admin/ai-settings 配置 AI 通道');
              } else {
                toast('AI 生成行业关键词失败：' + m.slice(0, 200));
              }
            })
            .finally(function(){
              if(btn){ btn.disabled = false; btn.textContent = '🤖 AI 生成行业关键词'; }
            });
        };
        window.setupIndustryBackend = function(){
          if(!confirm('将按当前选中的行业预设，自动写入行业与业务配置、城市列表、服务列表、关键词矩阵、SEO 标题/描述并生成 AI 提示词。是否继续？')) return;
          var form = document.getElementById('industryConfigForm');
          if(!form) return;
          form.action = '/admin/settings/industry-config';
          form.submit();
          toast('✅ 一键设置已提交，请查看页面顶部保存结果。');
        };
        window.saveCustomPreset = function(){
          var name = prompt('请输入自定义预设名称（例如：物流与货运进出口报关）');
          if(!name || !name.trim()) return;
          var form = document.getElementById('industryConfigForm');
          if(!form) return;
          var presetId = 'custom_' + String(name.trim()).replace(/[^a-z0-9]+/gi,'_').toLowerCase() || 'custom';
          var data = new FormData();
          data.append('id', presetId);
          data.append('name', name.trim());
          data.append('topic', form.elements['site_topic'] ? form.elements['site_topic'].value : '');
          data.append('industry', form.elements['site_industry'] ? form.elements['site_industry'].value : '');
          data.append('description', '');
          data.append('target_customers', form.elements['target_customers'] ? form.elements['target_customers'].value : '');
          data.append('service_features', form.elements['service_features'] ? form.elements['service_features'].value : '');
          data.append('application_scenarios', form.elements['application_scenarios'] ? form.elements['application_scenarios'].value : '');
          data.append('cities', '');
          data.append('primary_services', form.elements['service_features'] ? form.elements['service_features'].value : '');
          data.append('primary_keywords', form.elements['industry_keywords'] ? form.elements['industry_keywords'].value : '');
          data.append('industry_keywords', form.elements['industry_keywords'] ? form.elements['industry_keywords'].value : '');
          data.append('news_categories', '');
          fetch('/admin/settings/presets', { method: 'POST', body: data, credentials: 'same-origin' })
            .then(function(res){
              if(!res.ok) throw new Error('保存预设失败');
              return res.text();
            })
            .then(function(){
              toast('已保存自定义预设：' + name.trim());
              setTimeout(function(){ location.reload(); }, 600);
            })
            .catch(function(err){ toast(err && err.message ? err.message : '保存自定义预设失败'); });
        };
      })();
      </script>
    </div>
    <form method="post" action="/admin/settings/home-order" class="admin-form card" id="homeOrderForm" style="margin:0 0 16px">
      <h3 style="margin:0 0 6px">🏠 首页模块顺序</h3>
      <p style="margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.7">Hero 搜索区固定在最上方。下面五个模块用 ↑ / ↓ 调整先后顺序，取消勾选「显示」即可隐藏该模块；保存后前台立即生效。</p>
      <input type="hidden" name="order" id="homeOrderValue" value="" />
      <ol class="home-order-list" id="homeOrderList">
        ${parseHomeSectionOrder(settings.home_section_order).map((slot) => `
        <li class="home-order-item" data-key="${escapeHtml(slot.key)}">
          <span class="home-order-index" aria-hidden="true"></span>
          <span class="home-order-name">${escapeHtml(HOME_SECTION_LABELS[slot.key])}</span>
          <span class="home-order-actions">
            <button class="btn secondary btn-sm" type="button" data-move="up" aria-label="上移">↑</button>
            <button class="btn secondary btn-sm" type="button" data-move="down" aria-label="下移">↓</button>
            <label class="home-order-visible"><input type="checkbox" data-visible ${slot.visible ? 'checked' : ''} /> 显示</label>
          </span>
        </li>`).join('')}
      </ol>
      <button class="btn" type="submit">保存首页模块顺序</button>
      <style>
        .home-order-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
        .home-order-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:#fff}
        .home-order-index{width:22px;height:22px;flex:0 0 22px;border-radius:50%;background:#eef4fb;color:#1557a8;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
        .home-order-name{flex:1;min-width:0;font-size:14px}
        .home-order-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .home-order-actions .btn-sm{padding:4px 10px;line-height:1.2}
        .home-order-visible{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}
      </style>
      <script>
      (function(){
        var list = document.getElementById('homeOrderList');
        var hidden = document.getElementById('homeOrderValue');
        var form = document.getElementById('homeOrderForm');
        if(!list || !hidden || !form) return;
        function renumber(){
          Array.prototype.forEach.call(list.children, function(item, i){
            var badge = item.querySelector('.home-order-index');
            if(badge) badge.textContent = String(i + 1);
          });
        }
        function sync(){
          var parts = [];
          Array.prototype.forEach.call(list.children, function(item){
            var box = item.querySelector('[data-visible]');
            parts.push((box && box.checked ? '' : '-') + item.getAttribute('data-key'));
          });
          hidden.value = parts.join(',');
        }
        list.addEventListener('click', function(event){
          var button = event.target.closest('[data-move]');
          if(!button) return;
          var item = button.closest('.home-order-item');
          if(!item) return;
          if(button.getAttribute('data-move') === 'up'){
            var prev = item.previousElementSibling;
            if(prev) list.insertBefore(item, prev);
          } else {
            var next = item.nextElementSibling;
            if(next) list.insertBefore(next, item);
          }
          renumber(); sync();
        });
        list.addEventListener('change', sync);
        form.addEventListener('submit', sync);
        renumber(); sync();
      })();
      </script>
    </form>
    <form class="admin-form" method="post" action="/admin/settings">
      <label>前台站点名称（全站统一）</label>
      <input name="site_name" maxlength="80" value="${escapeHtml(settings.site_name || '')}" placeholder="例如：你的品牌名称" />
      <label>公开站点地址（可选）</label>
      <input name="site_url" maxlength="500" value="${escapeHtml(settings.site_url || '')}" placeholder="例如：https://www.example.com" inputmode="url" />
      <p style="margin:-6px 0 10px;color:var(--muted);font-size:12px;line-height:1.7">用于 Sitemap、Robots、llms.txt、AI Index 等绝对链接。留空会自动使用当前访问域名；不需要在 Cloudflare 变量里填写 SITE_URL。</p>
      <label>网站核心主题</label>
      <input name="site_topic" maxlength="120" value="${escapeHtml(settings.site_topic || '')}" placeholder="例如：本地服务解决方案" />
      <label>网站行业</label>
      <input name="site_industry" maxlength="80" value="${escapeHtml(settings.site_industry || '')}" placeholder="例如：本地服务" />
      <label>核心服务（逗号或换行分隔）</label>
      <textarea name="primary_services" rows="3" maxlength="1000" placeholder="例如：咨询服务,上门服务,项目交付">${escapeHtml(settings.primary_services || '')}</textarea>
      <label>核心主题词（逗号或换行分隔）</label>
      <textarea name="primary_keywords" rows="3" maxlength="1200" placeholder="例如：主题词A,主题词B,主题词C">${escapeHtml(settings.primary_keywords || '')}</textarea>
      <label>行业关键词（自动进入 SEO + 全部 AI 提示词 + 全站内容上下文）</label>
      <textarea name="industry_keywords" rows="4" maxlength="1600" placeholder="例如：服务场景A,目标客户B,行业术语C">${escapeHtml(settings.industry_keywords || '')}</textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:-2px 0 10px">
        <button class="btn secondary" type="submit" formaction="/admin/settings/generate-industry-keywords">🤖 AI生成行业关键词</button>
        <span style="color:var(--muted);font-size:12px;align-self:center">保存或生成后，行业关键词会自动进入 SEO 关键词池与所有 AI 任务提示词。</span>
      </div>
      <label>新闻分类（逗号或换行分隔）</label>
      <textarea name="news_categories" rows="2" maxlength="500" placeholder="例如：行业动态,政策资讯,案例解析,实用指南">${escapeHtml(settings.news_categories || '')}</textarea>
      <button class="btn" type="submit">保存白标画像</button>
    </form>
    ${error ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(error)}</div>` : ''}
    ${saved ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">系统设置已保存。</div>` : ''}
    ${ai ? `<div class="card" style="border-left:4px solid #2563eb;color:#2563eb;margin-bottom:16px">AI已完成“${escapeHtml(ai)}”页面内容生成。</div>` : ''}

    <div class="card admin-settings-card">
      <h3 style="margin:0 0 6px">🤖 AI 内容写作</h3>
      <p style="margin:0 0 12px;color:var(--muted);font-size:13px;line-height:1.8">按当前站点画像和页面资料生成清晰的标题、简介和正文。行业关键词、AI提示词和 GEO 会自动读取上面的站点画像；无需在多个地方重复填写。</p>
      <div class="admin-ai-shortcuts">
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="site" /><button class="btn secondary" type="submit">AI写站点信息</button></form>
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="home" /><button class="btn secondary" type="submit">AI写首页</button></form>
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="services" /><button class="btn secondary" type="submit">AI写服务页</button></form>
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="cases" /><button class="btn secondary" type="submit">AI写案例页</button></form>
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="cities" /><button class="btn secondary" type="submit">AI写城市页</button></form>
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="articles" /><button class="btn secondary" type="submit">AI写新闻资讯</button></form>
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="contact" /><button class="btn secondary" type="submit">AI写联系我们</button></form>
        <form method="post" action="/admin/settings/ai-seo"><input type="hidden" name="target" value="about" /><button class="btn secondary" type="submit">AI写关于我们</button></form>
      </div>
      <p style="margin:12px 0 0"><a class="btn secondary" href="/admin/ai-settings">AI模型与通道设置 →</a></p>
    </div>

    <form class="admin-form" method="post" action="/admin/settings">
      <label>站点标题</label>
      <input name="site_title" value="${escapeHtml(settings.site_title || '')}" />
      <label>站点描述</label>
      <textarea name="site_description" rows="3">${escapeHtml(settings.site_description || '')}</textarea>

      <div class="card admin-settings-card">
        <h3 style="margin:0 0 6px">联系我们页面联系方式</h3>
        <p style="color:var(--muted);font-size:12px;line-height:1.7;margin:0 0 10px">
          联系方式由<a href="/admin/modules" style="color:inherit;text-decoration:underline">「站点模块」→「联系渠道」</a>统一配置；未填写时前台不显示占位联系方式。
        </p>
        <p style="color:var(--warning);font-size:12px;margin:8px 0 0 0">
          ⚠️ 本页面对联系方式的直接编辑已停用。请使用「联系渠道」模块管理电话、微信、QQ 等。
        </p>
      </div>

      <div class="card admin-settings-card" style="margin:12px 0">
        <h3 style="margin:0 0 6px">🗝️ 各类密钥不在这里填</h3>
        <p style="color:var(--muted);font-size:12px;line-height:1.8;margin:0 0 10px">IndexNow、百度 / 360 / 搜狗推送 Token、Google 服务账号、AI 外部接口密钥、企业微信接入信息，已统一收拢到「系统密钥」页面：按用途分组、加密保存、只显示「已配置」，不再和普通站点设置混在一起。</p>
        <a class="btn secondary" href="/admin/system-secrets">前往系统密钥 →</a>
      </div>
      <div class="card admin-settings-card" style="margin:12px 0">
        <h3 style="margin:0 0 6px">📄 Footer 页脚</h3>
        <p style="color:var(--muted);font-size:12px;line-height:1.7;margin:0 0 10px">版权、免责声明、AI 内容说明与底部链接由后台配置；留空则使用站点名称与默认免责声明。</p>
        <label>版权文字 footer_copyright</label>
        <input name="footer_copyright" maxlength="200" value="${escapeHtml(settings.footer_copyright || '')}" placeholder="例如：© 2026 网站名称" />
        <label>免责声明 footer_disclaimer</label>
        <textarea name="footer_disclaimer" rows="2" maxlength="500" placeholder="例如：本站内容仅供参考">${escapeHtml(settings.footer_disclaimer || '')}</textarea>
        <label>AI 内容声明 footer_ai_notice</label>
        <textarea name="footer_ai_notice" rows="2" maxlength="500" placeholder="可选。例如：部分内容可能经 AI 辅助整理，发布前已人工审核">${escapeHtml(settings.footer_ai_notice || '')}</textarea>
      <label>底部链接 footer_links（每行：标签|路径或https地址）</label>
        <textarea name="footer_links" rows="3" maxlength="1500" placeholder="关于我们|/about\n联系我们|/contact">${escapeHtml(settings.footer_links || '')}</textarea>
      </div>
      <div class="card admin-settings-card" style="margin:12px 0">
        <h3 style="margin:0 0 6px">🔗 站点关联配置</h3>
        <p style="color:var(--muted);font-size:12px;line-height:1.7;margin:0 0 10px">一次配置，全站立即生效。头部图标、页面标题/描述模板、llms.txt 自定义内容、统计脚本等在这里统一管理；留空则使用各页面原有逻辑。</p>
        <label>站点图标 site_favicon（URL）</label>
        <input name="site_favicon" maxlength="500" value="${escapeHtml(settings.site_favicon || '')}" placeholder="例如：/icons/favicon.ico" style="width:100%;box-sizing:border-box" />
        <label>默认标题模板 site_default_title_template</label>
        <input name="site_default_title_template" maxlength="300" value="${escapeHtml(settings.site_default_title_template || '')}" placeholder="例如：{site_name} - {keyword}" style="width:100%;box-sizing:border-box" />
        <p style="color:var(--muted);font-size:11px;margin:4px 0 8px">支持占位符：{site_name}、{keyword}、{service_name}、{city_name}，按页面类型自动替换。</p>
        <label>默认描述模板 site_default_desc_template</label>
        <textarea name="site_default_desc_template" rows="2" maxlength="300" placeholder="例如：{site_name} | 提供{keyword}相关的专业服务">${escapeHtml(settings.site_default_desc_template || '')}</textarea>
        <p style="color:var(--muted);font-size:11px;margin:4px 0 8px">支持占位符：{site_name}、{keyword}、{service_name}、{city_name}，按页面类型自动替换。</p>
        <label>llms.txt 自定义内容 site_llms_content</label>
        <textarea name="site_llms_content" rows="4" maxlength="10000" placeholder="留空则使用系统自动生成的 llms.txt 内容">${escapeHtml(settings.site_llms_content || '')}</textarea>
      </div>
      <label><strong>Turnstile 人机校验(可选)</strong></label>      <div class="card" style="border:1px solid var(--border);padding:10px;margin:0 0 12px">
        <p style="color:var(--muted);font-size:12px;line-height:1.7;margin:0 0 8px">
          配置 Cloudflare Turnstile 的 Site Key / Secret Key 后,登录页、联系表单与自定义表单会自动加人机校验;
          两项都留空则完全关闭(开发态)。
        </p>
        <label>turnstile_site_key</label>
        <input name="turnstile_site_key" type="text" autocomplete="off" placeholder="0x…(公开 Site Key)" value="${escapeHtml(settings.turnstile_site_key || '')}" style="width:100%;box-sizing:border-box;margin-bottom:6px"/>
        <label>turnstile_secret_key</label>
        <input name="turnstile_secret_key" type="password" autocomplete="off" placeholder="Server Secret(留空保持不变)" value="${escapeHtml(settings.turnstile_secret_key || '')}" style="width:100%;box-sizing:border-box"/>
      </div>
      <button class="btn" type="submit">保存设置</button>
    </form>
  `,
  })
}
