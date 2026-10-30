/** 后台页面域模板：城市、服务、前台受管页面与子项目专题。 */
import { escapeHtml } from './layout'
import { renderAdminLayout } from './adminLayout'
import { siteModulesBody } from './adminSiteModules'
export function citiesListBody(rows: any[], catalog: any[] = [], message = ''): string {
  const addedKeys = new Set(rows.flatMap((x) => [String(x.name || ''), String(x.slug || '')]))
  const availableCatalog = catalog.filter((x) => !addedKeys.has(String(x.name || '')) && !addedKeys.has(String(x.slug || '')))
  const provinces = Array.from(new Set(availableCatalog.map((x) => x.province)))
  return `
    <div class="section-title"><h2>城市管理</h2><a class="btn secondary" href="/admin/services">服务管理 →</a></div>
    <div class="card" style="margin-bottom:16px;background:#f8fbff;border-color:#dbe7f7">
      <strong>城市与服务怎么关联？</strong>
      <p style="color:var(--muted);font-size:12px;line-height:1.8;margin:6px 0 0">城市 = 地域维度（例如深圳、广州）；服务 = 业务维度（例如企业咨询、项目服务）。两者不是父子关系。只有在「关键词矩阵」里组合成“城市 × 服务”时，才形成具体的本地服务落地词和落地页。</p>
      <p style="margin:8px 0 0;font-size:12px"><a href="/admin/keywords">去关键词矩阵查看城市 × 服务 →</a>　<a href="/admin/services">查看服务管理 →</a></p>
    </div>
    <p style="color:var(--muted)">选择全国城市加入城市库。已经添加的城市会自动从选择器中隐藏并按名称/slug 去重；新增城市会参与城市 × 服务 SEO 矩阵。</p>
    ${message ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">${escapeHtml(message)}</div>` : ''}
    <div class="card" style="margin-bottom:18px">
      <h3 style="margin-top:0">选择全国城市</h3>
      <form class="admin-form" method="post" action="/admin/cities/add">
        <label>城市库选择</label>
        <select name="catalog_key">
          <option value="">请选择城市</option>
          ${provinces.length ? provinces.map((province) => `<optgroup label="${escapeHtml(province)}">${availableCatalog.filter((x) => x.province === province).map((x) => `<option value="${escapeHtml(x.province + '|' + x.name + '|' + x.slug + '|' + x.tier)}">${escapeHtml(x.name)}（${escapeHtml(x.tier)}）</option>`).join('')}</optgroup>`).join('') : `<option value="" disabled>全国城市库已全部添加</option>`}
        </select>
        <button class="btn" type="submit">加入城市</button>
      </form>
      <form class="admin-form" method="post" action="/admin/cities/add" style="margin-top:12px">
        <label>手工添加城市（全国任何城市都可以）</label>
        <input name="province" placeholder="省份/自治区/直辖市" required />
        <input name="name" placeholder="城市名称" required />
        <input name="slug" placeholder="URL slug，如 shenzhen" required pattern="[a-z0-9-]+" />
        <select name="tier"><option>一线</option><option>新一线</option><option selected>二线</option><option>三线</option></select>
        <button class="btn secondary" type="submit">手工加入城市</button>
      </form>
    </div>

    <form method="post" action="/admin/cities/bulk-delete" id="bulkCitiesForm" onsubmit="return confirmBulkCityDelete()">
      <div class="card bulk-city-toolbar" style="margin-bottom:14px">
        <div class="bulk-city-toolbar-head">
          <div>
            <strong>批量删除城市</strong>
            <p class="bulk-city-help">已生成/待生成内容、启用/停用城市都可以一起选择删除。删除会同步清理该城市的关键词、AI城市内容、AI生成文章、独立联系方式和页面图片。</p>
          </div>
          <strong id="bulkCityCount">已选择 0 个</strong>
        </div>
        <div class="admin-actions">
          <button class="btn secondary" type="button" onclick="setCitySelection('all')">全选当前列表</button>
          <button class="btn secondary" type="button" onclick="setCitySelection('with-content')">选择已生成内容</button>
          <button class="btn secondary" type="button" onclick="setCitySelection('without-content')">选择待生成内容</button>
          <button class="btn secondary" type="button" onclick="setCitySelection('active')">选择已启用</button>
          <button class="btn secondary" type="button" onclick="setCitySelection('inactive')">选择已停用</button>
          <button class="btn secondary" type="button" onclick="setCitySelection('none')">清空选择</button>
          <button class="btn danger" type="submit">删除选中城市</button>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table>
          <thead><tr>
            <th><input type="checkbox" id="selectAllCities" aria-label="全选城市" onchange="setAllCityCheckboxes(this.checked)" /></th>
            <th>城市</th><th>省份</th><th>等级</th><th>状态</th><th>SEO</th><th>页面内容</th><th>操作</th>
          </tr></thead>
          <tbody>
          ${rows.length ? rows.map((c) => `<tr>
            <td><input type="checkbox" class="city-checkbox" name="city_ids" value="${escapeHtml(c.id)}" data-active="${c.is_active ? '1' : '0'}" data-content="${c.ai_content_exists ? '1' : '0'}" onchange="updateBulkCityCount()" aria-label="选择${escapeHtml(c.name)}" /></td>
            <td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.province || '')}</td>
            <td><span class="badge">${escapeHtml(c.tier || '二线')}</span></td>
            <td>${c.is_active ? '启用' : '停用'}</td>
            <td>${c.seo_title ? '已设置' : '自动生成'}</td>
            <td>${c.ai_content_exists ? '已生成' : '待生成'}</td>
            <td class="city-row-actions">
              <a href="/admin/cities/${escapeHtml(c.id)}/edit">编辑</a>
              <button class="btn secondary ai-city-generate" type="button" data-city-id="${escapeHtml(c.id)}">🤖 AI生成</button>
              <button class="btn secondary city-single-delete" type="button" data-city-id="${escapeHtml(c.id)}" data-city-name="${escapeHtml(c.name)}" style="color:#e5484d">删除</button>
            </td>
          </tr>`).join('') : `<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:24px">暂无城市，请先从全国城市库添加。</td></tr>`}
          </tbody>
        </table>
      </div>
    </form>

    <script>
      function cityBoxes(){ return Array.from(document.querySelectorAll('.city-checkbox')); }
      function updateBulkCityCount(){
        const boxes = cityBoxes();
        const selected = boxes.filter(function(box){ return box.checked; });
        const count = document.getElementById('bulkCityCount');
        if(count) count.textContent = '已选择 ' + selected.length + ' 个';
        const selectAll = document.getElementById('selectAllCities');
        if(selectAll){
          selectAll.checked = boxes.length > 0 && selected.length === boxes.length;
          selectAll.indeterminate = selected.length > 0 && selected.length < boxes.length;
        }
      }
      function setAllCityCheckboxes(checked){
        cityBoxes().forEach(function(box){ box.checked = checked; });
        updateBulkCityCount();
      }
      function setCitySelection(mode){
        cityBoxes().forEach(function(box){
          const active = box.dataset.active === '1';
          const content = box.dataset.content === '1';
          box.checked =
            mode === 'all' ||
            (mode === 'with-content' && content) ||
            (mode === 'without-content' && !content) ||
            (mode === 'active' && active) ||
            (mode === 'inactive' && !active);
          if(mode === 'none') box.checked = false;
        });
        updateBulkCityCount();
      }
      function confirmBulkCityDelete(){
        const count = cityBoxes().filter(function(box){ return box.checked; }).length;
        if(!count){
          alert('请先选择要删除的城市。');
          return false;
        }
        return confirm('确认批量删除 ' + count + ' 个城市？已生成/待生成内容、启用/停用状态都会删除，并同步清理关键词、AI城市内容、AI生成文章、独立联系方式和页面图片。删除后不可恢复。');
      }
      function startCityAiGeneration(button){
        const cityId = button.getAttribute('data-city-id');
        if(!cityId) return;
        if(button.disabled) return;
        button.disabled = true;
        button.textContent = '⏳ 生成中…';
        const form = document.createElement('form');
        form.method = 'post';
        form.action = '/admin/cities/' + encodeURIComponent(cityId) + '/ai-content';
        form.style.display = 'none';
        document.body.appendChild(form);
        form.submit();
      }
      function deleteSingleCity(button){
        const cityId = button.getAttribute('data-city-id');
        const cityName = button.getAttribute('data-city-name') || '';
        if(!cityId) return;
        if(!confirm('确认删除城市「' + cityName + '」及其关键词、AI内容、图片？删除后不可恢复。')) return;
        const form = document.createElement('form');
        form.method = 'post';
        form.action = '/admin/cities/' + encodeURIComponent(cityId) + '/delete';
        form.style.display = 'none';
        document.body.appendChild(form);
        form.submit();
      }
      document.querySelectorAll('.ai-city-generate').forEach(function(button){
        button.addEventListener('click', function(){ startCityAiGeneration(button); });
      });
      document.querySelectorAll('.city-single-delete').forEach(function(button){
        button.addEventListener('click', function(){ deleteSingleCity(button); });
      });
      updateBulkCityCount();
    </script>
  `
}

export function renderCitiesList(rows: any[], catalog: any[] = [], message = '', siteName?: string, cspNonce?: string): string {
  return renderAdminLayout({ title: '城市管理', active: '/admin/cities', siteName, cspNonce, body: citiesListBody(rows, catalog, message) })
}

export function renderCityForm(city: any, pageContent = '', aiError = '', image?: any, globalSeoKeywords = '', siteName?: string, cspNonce?: string, csrfToken?: string): string {
  return renderAdminLayout({
    title: '编辑城市', active: '/admin/cities', siteName, cspNonce, csrfToken,
    body: `
    <h2>编辑城市：${escapeHtml(city.name)}</h2>
    ${aiError ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(aiError)}</div>` : ''}
    <form class="admin-form" method="post" action="/admin/cities/${city.id}/edit">
      <label>城市等级（影响关键词机会分权重）</label>
      <select name="tier">${['一线', '新一线', '二线', '三线'].map((t) => `<option value="${t}" ${city.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label><input type="checkbox" name="is_active" ${city.is_active ? 'checked' : ''} /> 启用该城市</label>
      <p style="color:var(--muted);font-size:12px">启用时会自动补齐空白 SEO，并可生成城市 AI 页面内容。</p>
      <div class="card" style="margin:10px 0">
        <strong>SEO由「关键词管理」统一设置</strong>
        <p style="color:var(--muted);font-size:12px;margin:6px 0">城市名称、省份、等级、状态来自城市库；SEO关键词统一从关键词管理读取并自动生成。</p><p style="font-size:12px">当前统一关键词：${escapeHtml(globalSeoKeywords || '尚未设置')}</p>
      </div>      <label>城市页面内容（后台修改，前台自动显示）</label>
      <textarea name="page_content" rows="8" placeholder="留空表示使用 AI 生成内容；AI 会结合该城市关键词主题组织内容。保存时不会自动覆盖已有 AI 内容。">${escapeHtml(pageContent)}</textarea>
      <fieldset style="border:1px solid var(--border);border-radius:8px;padding:12px"><legend style="padding:0 6px;font-size:13px;color:var(--muted)">本城市页面独立联系方式</legend>
        <p style="color:var(--muted);font-size:12px">留空使用全站默认微信/QQ；填写后只显示在 ${escapeHtml(city.name)} 页面。</p>
      </fieldset>
      <button class="btn" type="submit">保存城市设置</button>
    </form>
    <form method="post" action="/admin/cities/${city.id}/ai-content" style="margin-top:10px"><button class="btn secondary" type="submit">🤖 AI 自动生成城市页面内容</button></form>
    <form method="post" action="/admin/cities/${city.id}/content/delete" onsubmit="return confirm('确认删除该城市页面的AI正文和图片？删除后不可恢复。')" style="margin-top:10px"><button class="btn secondary" type="submit">删除城市页面内容</button></form>
    <div class="card" style="margin-top:16px"><h3 style="margin-top:0">城市页面图片（R2）</h3>
      ${image?.url ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || city.name)}" style="display:block;max-width:320px;width:100%;border-radius:8px;margin-bottom:10px" />` : '<p style="color:var(--muted);font-size:12px">暂未设置图片。</p>'}
      <form class="admin-form" method="post" action="/admin/page-images/city/${escapeHtml(city.slug)}" enctype="multipart/form-data"><input type="file" name="file" accept="image/jpeg,image/png,image/webp" required /><button class="btn" type="submit">上传/替换城市图片</button></form>
      ${image?.url ? `<form method="post" action="/admin/page-images/city/${escapeHtml(city.slug)}/delete" style="display:inline" onsubmit="return confirm('确认删除该城市图片？R2 文件将直接删除。')"><button class="btn secondary" style="color:#e5484d" type="submit">删除城市图片</button></form>` : ''}
    </div>
  `,
  })
}

export function renderServiceForm(service: any, pageContent = '', aiError = '', image?: any, globalSeoKeywords = '', siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const isCreate = !service?.id
  return renderAdminLayout({
    title: isCreate ? '添加服务' : '编辑服务', active: '/admin/services', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>${isCreate ? '添加服务' : '编辑服务：' + escapeHtml(service.name)}</h2>
      <a href="/admin/services" style="color:var(--muted);font-size:13px">← 返回服务管理</a>
    </div>
    ${aiError ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(aiError)}</div>` : ''}
    <form class="admin-form" method="post" action="${isCreate ? '/admin/services/new' : `/admin/services/${service.id}/edit`}">
      ${isCreate ? `
      <label>服务名称</label>
      <input name="name" maxlength="100" placeholder="例如：企业咨询、项目服务、解决方案" required />
      <label>URL slug</label>
      <input name="slug" maxlength="120" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="例如：dai-li-ji-zhang" required />
      <label>服务简介</label>
      <textarea name="summary" rows="3" maxlength="500" placeholder="简要说明服务内容，保存后用于 SEO 描述和前台服务页。"></textarea>
      ` : ''}
      <label>需求权重 0-100</label><input type="number" name="demand_weight" min="0" max="100" value="${service.demand_weight ?? 50}" />
      <label><input type="checkbox" name="is_active" ${isCreate || service.is_active ? 'checked' : ''} /> 启用该服务</label>
      <p style="color:var(--muted);font-size:12px">启用时会自动补齐空白 SEO，并可生成服务 AI 页面内容。</p>
      <div class="card" style="margin:10px 0">
        <strong>SEO由「关键词管理」统一设置</strong>
        <p style="color:var(--muted);font-size:12px;margin:6px 0">服务SEO关键词不在本页填写；启用服务后由系统根据统一关键词自动生成。</p><p style="font-size:12px">当前统一关键词：${escapeHtml(globalSeoKeywords || '尚未设置')}</p>
      </div>
      ${isCreate ? '' : `
      <label>服务外站链接（填写后前台入口打开外站；留空使用本站）</label>
      <input name="external_url" value="${escapeHtml(service.external_url || '')}" placeholder="https://example.com/service" />
      <label>服务页面内容（后台修改，前台自动显示）</label>
      <textarea name="page_content" rows="8" placeholder="留空可由 AI 生成">${escapeHtml(pageContent)}</textarea>
      <fieldset style="border:1px solid var(--border);border-radius:8px;padding:12px"><legend style="padding:0 6px;font-size:13px;color:var(--muted)">本服务页面独立联系方式</legend>
        <p style="color:var(--muted);font-size:12px">留空使用全站默认微信/QQ；填写后只显示在 ${escapeHtml(service.name)} 页面。</p>
      </fieldset>
      `}
      <button class="btn" type="submit">${isCreate ? '创建服务' : '保存服务设置'}</button>
    </form>
    ${isCreate ? `
    <div class="card" style="margin-top:16px">
      <strong>创建后自动处理</strong>
      <p style="color:var(--muted);font-size:12px;line-height:1.8;margin-bottom:0">启用时自动生成 SEO 标题、描述和关键词；创建完成后进入服务编辑页，可以继续用 Workers AI 生成页面正文并上传 R2 图片。</p>
    </div>
    ` : `
    <form method="post" action="/admin/services/${service.id}/ai-content" style="margin-top:10px"><button class="btn secondary" type="submit">🤖 AI 自动生成服务页面内容</button></form>
    <form method="post" action="/admin/services/${service.id}/content/delete" onsubmit="return confirm('确认删除该服务页面的AI正文和图片？删除后不可恢复。')" style="margin-top:10px"><button class="btn secondary" type="submit">删除服务页面内容</button></form>
    <div class="card" style="margin-top:16px"><h3 style="margin-top:0">服务页面图片（R2）</h3>
      ${image?.url ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || service.name)}" style="display:block;max-width:320px;width:100%;border-radius:8px;margin-bottom:10px" />` : '<p style="color:var(--muted);font-size:12px">暂未设置图片。</p>'}
      <form class="admin-form" method="post" action="/admin/page-images/service/${escapeHtml(service.slug)}" enctype="multipart/form-data"><input type="file" name="file" accept="image/jpeg,image/png,image/webp" required /><button class="btn" type="submit">上传/替换服务图片</button></form>
      ${image?.url ? `<form method="post" action="/admin/page-images/service/${escapeHtml(service.slug)}/delete" style="display:inline" onsubmit="return confirm('确认删除该服务图片？R2 文件将直接删除。')"><button class="btn secondary" style="color:#e5484d" type="submit">删除服务图片</button></form>` : ''}
    </div>
    `}
  `,
  })
}

export function pageSettingsBody(pages: any[], current?: any, error = '', image?: any, subprojects: any[] = [], message = ''): string {
  const p = current
  const sectionLabels: Record<string, string> = { service: '服务', article: '资讯', new: '新闻专题', city: '城市' }
  return `
    <div class='section-title'><h2>页面管理</h2><a href='/admin/pages' style='color:var(--muted);font-size:13px'>返回页面列表</a></div>
    <p style='color:var(--muted);font-size:13px'>页面列表是唯一的页面管理入口。标题/副标题只负责页面头部；正文属于 SEO 与信息补充，统一显示在前台页面主体底部的固定内容区，不参与服务卡片、城市列表、资讯卡片等主布局。这样编辑正文不会把页面结构顶乱；正文可留空，页面核心数据模块仍按标准模板展示。</p>
    ${message ? `<div class='card' style='border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px'>${escapeHtml(message)}</div>` : ''}
    ${error ? `<div class='card' style='border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px'>${escapeHtml(error)}</div>` : ''}
    ${!p ? `<div class='card' style='margin-bottom:16px'>
      <div style='display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap'>
        <div>
          <h3 style='margin:0 0 4px'>子项目 / 栏目标签</h3>
          <p style='color:var(--muted);font-size:12px;line-height:1.8;margin:0'>
            为 /service、/article、/new、/city 分别创建独立的子项目页面。每个子项目都有自己的前台 URL、标签、SEO、布局和内容绑定，
            所以和上面的页面一样在这里统一管理，不再单独占一个后台导航项。
          </p>
        </div>
        <a class='btn' href='/admin/subprojects/new'>＋ 添加子项目</a>
      </div>
      <div class='admin-table-wrap' style='margin-top:12px'><table>
        <thead><tr><th>栏目</th><th>标签</th><th>前台地址</th><th>布局</th><th>状态</th><th>绑定内容</th><th>操作</th></tr></thead>
        <tbody>
        ${subprojects.length ? subprojects.map((row) => `<tr>
          <td>${escapeHtml(sectionLabels[String(row.section)] || row.section)}</td>
          <td><strong>${escapeHtml(row.label_zh || row.name)}</strong>${row.label_en ? ' / ' + escapeHtml(row.label_en) : ''}</td>
          <td><code>${escapeHtml(String(row.frontend_path || row.slug || ''))}</code></td>
          <td>${escapeHtml(row.layout === 'list' ? '列表' : row.layout === 'feature' ? '重点' : '卡片网格')}</td>
          <td>${row.is_active ? '启用' : '停用'}</td>
          <td>${Number(row.item_count || 0)} 项</td>
          <td><a href='/admin/subprojects/${escapeHtml(String(row.id))}/edit'>编辑</a> &nbsp; <form method='post' action='/admin/subprojects/${escapeHtml(String(row.id))}' style='display:inline' onsubmit="return confirm('确认删除这个子项目？关联内容不会删除，只删除子项目标签和绑定关系。')"><button class='btn secondary' style='padding:2px 10px;color:#e5484d' type='submit'>删除</button></form></td>
        </tr>`).join('') : `<tr><td colspan='7' style='text-align:center;color:var(--muted);padding:20px'>暂无子项目。点右上角「＋ 添加子项目」创建第一个栏目标签页。</td></tr>`}
        </tbody>
      </table></div>
    </div>` : ''}
    <div class='card' style='margin-bottom:16px'><h3 style='margin-top:0'>页面列表</h3>
      <div class='admin-table-wrap'><table><thead><tr><th>页面</th><th>模式</th><th>前台地址</th><th>标题 / 副标题</th><th>内容</th><th>操作</th></tr></thead><tbody>
      ${pages.map((item) => `<tr><td>${escapeHtml(item.labelZh || item.label)}<br/><span style='color:var(--muted);font-size:11px'>${escapeHtml(item.labelEn || '')}</span></td><td><span class='badge'>${escapeHtml(item.mode === 'external' ? '外站链接' : item.mode === 'hidden' ? '隐藏' : '本站内容')}</span></td><td><a href='${escapeHtml(item.path)}' target='_blank'>${escapeHtml(item.path)}</a></td><td>${escapeHtml(item.titleZh || item.titleEn || '系统默认')}<br/><span style='color:var(--muted);font-size:12px'>${escapeHtml(item.subtitleZh || item.subtitleEn || '')}</span></td><td>${item.contentZh || item.contentEn ? '已设置' : '系统默认'}</td><td>${item.seoAudit ? `<span class='badge'>SEO ${item.seoAudit.score} · ${escapeHtml(item.seoAudit.label)}</span><br/>` : ''}<a class='btn secondary' style='display:inline-block;margin-top:5px' href='/admin/pages/${escapeHtml(item.key)}/edit'>编辑 / AI写作</a> &nbsp; <a href='${escapeHtml(item.path)}' target='_blank'>打开前台</a></td></tr>`).join('')}
      </tbody></table></div></div>
    ${p ? `
    ${p.mode === 'internal' ? `<div class='card' style='margin-bottom:16px;background:#f8fbff;border-color:#dbe7f7'><div style='display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap'><div><strong>🤖 AI 页面写作 + SEO</strong><div style='color:var(--muted);font-size:12px;line-height:1.7;margin-top:5px'>AI 生成标题、简介、正文和 3-5 个主题词；正文会进入固定内容区，生成后再参加项目内 SEO 结构检查。</div></div><form method='post' action='/admin/pages/${escapeHtml(p.key)}/ai-content' style='margin:0'><button class='btn secondary' type='submit'>🤖 AI生成/优化页面</button></form></div></div>` : ''}
    <div class='card' style='margin-bottom:16px'><h3 style='margin-top:0'>编辑：${escapeHtml(p.label)}</h3>
      <p style='color:var(--muted);font-size:12px'>本站地址：<a href='${escapeHtml(p.path)}' target='_blank'>${escapeHtml(p.path)}</a>。选择“外站链接”后，前台访问这个地址会直接跳转到外站。</p>
    </div>
    ${p.key === 'cases' ? `<div class='card' style='margin-bottom:16px;background:#f8fbff;border-color:#dbe7f7'><strong>🏆 案例条目在「成功案例」里单独管理</strong><p style='color:var(--muted);font-size:12px;line-height:1.8;margin:6px 0 0'>这一页只管 <code>/case</code> 列表页本身：页面标签、标题、副标题、SEO / 补充正文、主题词，以及隐藏或跳转外站。具体案例条目（客户、行业、服务、地区、挑战、方案、成果、客户评价）在 <a href='/admin/cases'>成功案例</a> 中新增和编辑，保存后立即出现在这一页的列表里，不需要在这里重复录入。</p></div>` : ''}
    <form class='admin-form' method='post' action='/admin/pages/${escapeHtml(p.key)}/edit'>
      <fieldset style='border:1px solid var(--border);border-radius:8px;padding:12px'><legend style='padding:0 6px;font-size:13px;color:var(--muted)'>前台页面标签</legend>
        <p style='color:var(--muted);font-size:12px'>这里控制前台导航显示的页面标签；不是页面正文标题。保存后前台导航会同步更新。</p>
        <label>中文标签</label><input name='label_zh' value='${escapeHtml(p.labelZh || p.label || '')}' maxlength='60' placeholder='例如：行业资讯' />
        <label>English label</label><input name='label_en' value='${escapeHtml(p.labelEn || '')}' maxlength='60' placeholder='例如：Insights' />
      </fieldset>
      <label>页面模式</label>
      <select name='mode'><option value='internal' ${p.mode === 'internal' ? 'selected' : ''}>本站页面（使用后台内容）</option><option value='external' ${p.mode === 'external' ? 'selected' : ''}>外站链接（直接跳转）</option><option value='hidden' ${p.mode === 'hidden' ? 'selected' : ''}>隐藏页面</option></select>
      <label>外站链接（仅外站链接模式生效）</label>
      <input name='external_url' value='${escapeHtml(p.externalUrl || '')}' placeholder='https://example.com/your-page' />
      <fieldset style='border:1px solid var(--border);border-radius:8px;padding:12px'><legend style='padding:0 6px;font-size:13px;color:var(--muted)'>中文内容</legend>
        <label>页面标题</label><input name='title_zh' value='${escapeHtml(p.titleZh || '')}' maxlength='200' placeholder='留空使用系统默认标题' />
        <label>页面副标题</label><textarea name='subtitle_zh' rows='2' maxlength='500' placeholder='留空使用系统默认说明'>${escapeHtml(p.subtitleZh || '')}</textarea>
        <label>SEO / 页面补充正文（固定内容区）</label><textarea name='content_zh' rows='8' maxlength='12000' placeholder='可选。围绕页面主题补充真实业务信息、适用对象、服务范围、办理流程、注意事项和行动建议；前台固定显示在页面底部，不会改变主卡片布局。'>${escapeHtml(p.contentZh || '')}</textarea>
        <label>SEO主题词（可选，建议 3-5 个）</label><input name='seo_keywords_zh' value='${escapeHtml(p.seoKeywordsZh || '')}' maxlength='300' placeholder='例如：主题词A,主题词B,主题词C' />
      </fieldset>
      <fieldset style='border:1px solid var(--border);border-radius:8px;padding:12px'><legend style='padding:0 6px;font-size:13px;color:var(--muted)'>English content</legend>
        <label>Page title</label><input name='title_en' value='${escapeHtml(p.titleEn || '')}' maxlength='200' placeholder='Leave empty to use the default title' />
        <label>Page subtitle</label><textarea name='subtitle_en' rows='2' maxlength='500' placeholder='Leave empty to use the default description'>${escapeHtml(p.subtitleEn || '')}</textarea>
        <label>SEO / page information content (fixed content area)</label><textarea name='content_en' rows='8' maxlength='12000' placeholder='Optional. Add useful page information; it is rendered in the fixed information area at the bottom of the page and does not change the main card/list layout.'>${escapeHtml(p.contentEn || '')}</textarea>
        <label>SEO keywords（3-5）</label><input name='seo_keywords_en' value='${escapeHtml(p.seoKeywordsEn || '')}' maxlength='300' placeholder='e.g. enterprise services, consulting, project solutions' />
      </fieldset>
      <label style='display:flex;align-items:center;gap:8px'><input type='checkbox' name='show_form' ${p.showForm !== false ? 'checked' : ''} /> 前台显示留言表单</label>
      <button class='btn' type='submit'>保存并更新前台</button>
    </form>
    ${p.key === 'home' ? `<div class='card' style='margin-top:16px'><h3 style='margin-top:0'>首页图片（R2）</h3>${image?.url ? `<img src='${escapeHtml(image.url)}' alt='首页图片' style='display:block;max-width:480px;width:100%;border-radius:8px;margin-bottom:10px' />` : '<p style="color:var(--muted);font-size:12px">暂未设置首页图片。</p>'}<form class='admin-form' method='post' action='/admin/page-images/home' enctype='multipart/form-data'><input type='file' name='file' accept='image/jpeg,image/png,image/webp' required /><button class='btn' type='submit'>上传/替换首页图片</button></form>${image?.url ? `<form method='post' action='/admin/page-images/home/delete' style='display:inline' onsubmit="return confirm('确认删除首页图片？R2 文件将直接删除。')"><button class='btn secondary' style='color:#e5484d' type='submit'>删除首页图片</button></form>` : ''}</div>` : ''}
    <form method='post' action='/admin/pages/${escapeHtml(p.key)}/clear' onsubmit="return confirm('确认清空这个页面的后台内容？删除后不能恢复。')" style='margin-top:12px'><button class='btn secondary' type='submit'>删除本页后台内容</button></form>
    ` : ''}
  `
}

export function renderPageSettingsPage(pages: any[], current?: any, error = '', image?: any, subprojects: any[] = [], message = '', siteName?: string, cspNonce?: string, csrfToken?: string): string {
  return renderAdminLayout({
    title: current ? `编辑页面：${escapeHtml(current.label)}` : '页面管理',
    active: '/admin/pages', siteName, cspNonce, csrfToken,
    body: pageSettingsBody(pages, current, error, image, subprojects, message),
  })
}

export function renderSubprojectsList(rows: any[], message = '', siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const sectionLabels: Record<string, string> = { service: '服务', article: '资讯', new: '新闻专题', city: '城市' }
  return renderAdminLayout({
    title: '子项目管理',
    active: '/admin/subprojects', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <div><h2>子项目 / 栏目标签</h2><p style="margin:4px 0 0;color:var(--muted);font-size:13px">为 /service、/article、/new、/city 分别创建独立的子项目页面。每个子项目都有独立 Slug、标签、SEO、布局和内容绑定。</p></div>
      <a class="btn" href="/admin/subprojects/new">＋ 添加子项目</a>
    </div>
    ${message ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">' + escapeHtml(message) + '</div>' : ''}
    <div class="admin-table-wrap">
      <table>
        <thead><tr><th>栏目</th><th>标签</th><th>URL Slug</th><th>布局</th><th>状态</th><th>绑定内容</th><th>操作</th></tr></thead>
        <tbody>
        ${rows.length ? rows.map((row) => `<tr>
          <td>${escapeHtml(sectionLabels[String(row.section)] || row.section)}</td>
          <td><strong>${escapeHtml(row.label_zh || row.name)}</strong>${row.label_en ? ' / ' + escapeHtml(row.label_en) : ''}</td>
          <td><code>${escapeHtml(row.slug)}</code></td>
          <td>${escapeHtml(row.layout === 'list' ? '列表' : row.layout === 'feature' ? '重点' : '卡片网格')}</td>
          <td>${row.is_active ? '启用' : '停用'}</td>
          <td>${Number(row.item_count || 0)} 项</td>
          <td><a href="/admin/subprojects/${row.id}/edit">编辑</a> &nbsp; <form method="post" action="/admin/subprojects/${row.id}" style="display:inline" onsubmit="return confirm('确认删除这个子项目？关联内容不会删除，只删除子项目标签和绑定关系。')"><button class="btn secondary" style="padding:2px 10px;color:#e5484d" type="submit">删除</button></form></td>
        </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">暂无子项目</td></tr>'}
        </tbody>
      </table>
    </div>
  `,
  })
}

export function renderSubprojectForm(opts: {
  subproject?: any
  items?: any[]
  selectedIds?: number[]
  error?: string
  saved?: boolean
  siteName?: string, cspNonce?: string, csrfToken?: string
}): string {
  const p = opts.subproject || {
    section: 'service', name: '', slug: '', label_zh: '', label_en: '',
    title_zh: '', title_en: '', subtitle_zh: '', subtitle_en: '',
    content_zh: '', content_en: '', seo_title_zh: '', seo_title_en: '',
    seo_description_zh: '', seo_description_en: '', seo_keywords_zh: '', seo_keywords_en: '',
    layout: 'grid', is_active: 1, sort_order: 0,
  }
  const selected = new Set((opts.selectedIds || []).map((id) => Number(id)))
  const groups: Record<string, string> = { service: '服务', article: '资讯文章', new: '新闻文章', city: '城市' }
  const itemLabel = String(p.section) === 'service' ? '选择服务项目' : String(p.section) === 'city' ? '选择城市' : '选择文章'
  return renderAdminLayout({
    title: opts.subproject ? '编辑子项目' : '新建子项目',
    active: '/admin/subprojects', siteName: opts.siteName, cspNonce: opts.cspNonce,
    body: `
    <div class="section-title"><h2>${opts.subproject ? '编辑子项目' : '新建子项目'}</h2><a href="/admin/subprojects">← 返回子项目列表</a></div>
    ${opts.error ? '<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">' + escapeHtml(opts.error) + '</div>' : ''}
    ${opts.saved ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">子项目已保存。</div>' : ''}
    <form class="admin-form" method="post" action="${opts.subproject ? '/admin/subprojects/' + opts.subproject.id + '/edit' : '/admin/subprojects/new'}">
      <label>所属栏目</label>
      <select name="section" ${opts.subproject ? 'disabled' : ''}>
        ${Object.entries(groups).map(([key, label]) => '<option value="' + key + '" ' + (String(p.section) === key ? 'selected' : '') + '>' + label + '</option>').join('')}
      </select>
      ${opts.subproject ? '<input type="hidden" name="section" value="' + escapeHtml(p.section) + '" />' : ''}
      <label>后台名称</label>
      <input name="name" value="${escapeHtml(p.name || '')}" maxlength="120" required placeholder="例如：项目服务" />
      <label>中文标签</label>
      <input name="label_zh" value="${escapeHtml(p.label_zh || p.name || '')}" maxlength="120" required placeholder="前台标签文字" />
      <label>English label</label>
      <input name="label_en" value="${escapeHtml(p.label_en || '')}" maxlength="120" placeholder="Optional" />
      <label>URL Slug <span class="admin-field-hint">只能使用小写字母、数字和短横线</span></label>
      <input name="slug" value="${escapeHtml(p.slug || '')}" maxlength="120" pattern="[a-z0-9-]+" required placeholder="例如 service-slug" />
      <div class="card" style="margin:12px 0">
        <strong>前台页面路径</strong>
        <p style="margin:6px 0;color:var(--muted);font-size:12px">服务：/service/topic/slug　资讯：/article/tag/slug　新闻专题：/new/slug　城市：/city/topic/slug</p>
      </div>
      <label>中文标题</label><input name="title_zh" value="${escapeHtml(p.title_zh || '')}" maxlength="180" placeholder="留空自动使用中文标签" />
      <label>English title</label><input name="title_en" value="${escapeHtml(p.title_en || '')}" maxlength="180" />
      <label>中文副标题</label><input name="subtitle_zh" value="${escapeHtml(p.subtitle_zh || '')}" maxlength="300" />
      <label>English subtitle</label><input name="subtitle_en" value="${escapeHtml(p.subtitle_en || '')}" maxlength="300" />
      <label>中文正文 / 页面说明</label><textarea name="content_zh" rows="9" maxlength="16000">${escapeHtml(p.content_zh || '')}</textarea>
      <label>English content</label><textarea name="content_en" rows="9" maxlength="16000">${escapeHtml(p.content_en || '')}</textarea>
      <label>中文 SEO 标题</label><input name="seo_title_zh" value="${escapeHtml(p.seo_title_zh || '')}" maxlength="180" />
      <label>English SEO title</label><input name="seo_title_en" value="${escapeHtml(p.seo_title_en || '')}" maxlength="180" />
      <label>中文 SEO 描述</label><textarea name="seo_description_zh" rows="3" maxlength="320">${escapeHtml(p.seo_description_zh || '')}</textarea>
      <label>English SEO description</label><textarea name="seo_description_en" rows="3" maxlength="320">${escapeHtml(p.seo_description_en || '')}</textarea>
      <label>中文 SEO 主题词（3-5个，逗号分隔）</label><input name="seo_keywords_zh" value="${escapeHtml(p.seo_keywords_zh || '')}" maxlength="300" />
      <label>English SEO topics</label><input name="seo_keywords_en" value="${escapeHtml(p.seo_keywords_en || '')}" maxlength="300" />
      <label>页面布局</label>
      <select name="layout">
        <option value="grid" ${p.layout === 'grid' ? 'selected' : ''}>卡片网格</option>
        <option value="list" ${p.layout === 'list' ? 'selected' : ''}>列表</option>
        <option value="feature" ${p.layout === 'feature' ? 'selected' : ''}>重点卡片</option>
      </select>
      <label>排序</label><input type="number" name="sort_order" value="${escapeHtml(p.sort_order ?? 0)}" min="0" max="9999" />
      <label><input type="checkbox" name="is_active" value="1" ${p.is_active ? 'checked' : ''} /> 前台启用</label>

      <div class="card" style="margin-top:16px">
        <h3 style="margin-top:0">${escapeHtml(itemLabel)}</h3>
        <p style="color:var(--muted);font-size:12px">子项目页面只显示这里选中的内容；取消勾选只会解除绑定，不会删除原内容。</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;max-height:480px;overflow:auto">
          ${(opts.items || []).map((item) => `
            <label style="display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid #e8edf3;border-radius:8px;background:#fff">
              <input type="checkbox" name="item_ids" value="${escapeHtml(item.id)}" ${selected.has(Number(item.id)) ? 'checked' : ''} />
              <span><strong>${escapeHtml(item.name || item.title || '')}</strong>${item.slug ? '<br><small style="color:var(--muted)">' + escapeHtml(item.slug) + '</small>' : ''}</span>
            </label>`).join('') || '<p style="color:var(--muted)">暂无可绑定内容，请先在对应模块添加。</p>'}
        </div>
      </div>

      <button class="btn" type="submit">保存子项目</button>
    </form>
  `,
  })
}

/** 服务列表正文（原内联在 /admin/services 路由里，现由「页面管理」统一渲染）。 */
export function servicesListBody(rows: any[], aiKeys: Set<string>, imageStore: any): string {
  return `
    <div class="section-title"><h2>服务管理</h2><a class="btn" href="/admin/services/new">＋ 添加服务</a></div>
    <p style="color:var(--muted);font-size:13px">启用服务会自动补齐 SEO；可生成 AI 页面内容；图片直接存储在 R2。删除服务会同步删除关键词、AI 页面内容和对应 R2 图片。添加服务后可立即进入编辑页继续设置。</p>
    <div class="admin-table-wrap"><table><thead><tr><th>服务</th><th>需求权重</th><th>状态</th><th>SEO</th><th>AI内容</th><th>图片</th><th>操作</th></tr></thead><tbody>
      ${rows.length ? rows.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.demand_weight}</td><td>${item.is_active ? '启用' : '停用'}</td><td>${item.seo_title ? '已设置' : '自动生成'}</td><td>${aiKeys.has(String(item.slug)) || !!imageStore?.services?.[String(item.slug)]?.content ? '已生成' : '待生成'}</td><td>${imageStore?.services?.[String(item.slug)]?.url ? '已设置' : '未设置'}</td><td><a href="/admin/services/${item.id}/edit">编辑</a> &nbsp; <a href="/admin/services/${item.id}/delete" onclick="return confirm('确认删除该服务、关键词、AI内容、图片？删除后不可恢复。')" style="color:#e5484d">删除</a></td></tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">暂无服务，点右上角「＋ 添加服务」创建第一个。</td></tr>'}
    </tbody></table></div>
  `
}

export type PagesHubTab = 'pages' | 'cities' | 'services' | 'modules'

const PAGES_HUB_TABS: ReadonlyArray<{ id: PagesHubTab; label: string; hint: string }> = [
  { id: 'pages', label: '前台页面', hint: '页面标签、标题、正文与子项目' },
  { id: 'cities', label: '城市页面', hint: '城市库、等级与城市页内容' },
  { id: 'services', label: '服务页面', hint: '服务项目、权重与详情内容' },
  { id: 'modules', label: '导航与联系', hint: '菜单顺序、联系渠道与语言' },
]

/**
 * 「页面管理」统一入口。
 *
 * 城市 / 服务 / 导航联系原本各占一个侧边栏项，站长要在四个页面之间来回找同一件事
 * （某个前台页面到底在哪配）。现在合并成一个页面 + 分页签，侧边栏只留「前台页面」一项；
 * 各分页签的编辑表单仍走原路由（/admin/cities/:id/edit 等），旧链接不会失效。
 */
export function renderPagesHub(opts: {
  tab: PagesHubTab
  pages: any[]
  current?: any
  error?: string
  image?: any
  subprojects?: any[]
  message?: string
  cities?: { rows: any[]; catalog: any[]; message?: string }
  services?: { rows: any[]; aiKeys: Set<string>; imageStore: any }
  modules?: { contacts: any[]; navigation: any[]; languages: any[]; message?: string; error?: string }
  siteName?: string, cspNonce?: string
}): string {
  const tab = opts.tab
  const activeTab = PAGES_HUB_TABS.find((t) => t.id === tab) || PAGES_HUB_TABS[0]!
  const body = tab === 'cities'
    ? citiesListBody(opts.cities?.rows || [], opts.cities?.catalog || [], opts.cities?.message || '')
    : tab === 'services'
      ? servicesListBody(opts.services?.rows || [], opts.services?.aiKeys || new Set<string>(), opts.services?.imageStore)
      : tab === 'modules'
        ? siteModulesBody({
            contacts: opts.modules?.contacts || [],
            navigation: opts.modules?.navigation || [],
            languages: opts.modules?.languages || [],
            message: opts.modules?.message || '',
            error: opts.modules?.error || '',
          })
        : pageSettingsBody(opts.pages, opts.current, opts.error || '', opts.image, opts.subprojects || [], opts.message || '')

  return renderAdminLayout({
    title: opts.current ? `编辑页面：${escapeHtml(opts.current.label)}` : '页面管理',
    active: '/admin/pages', siteName: opts.siteName, cspNonce: opts.cspNonce,
    body: `
    <div class="section-title">
      <div>
        <h2>页面管理</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:13px">前台页面、城市、服务、导航与联系渠道统一在这里管理，不再分散到多个侧边栏入口。</p>
      </div>
    </div>
    <div id="pages-hub">
      <nav class="pages-hub-tabs" aria-label="页面管理分页">
        ${PAGES_HUB_TABS.map((t) => `<a class="pages-hub-tab${t.id === tab ? ' active' : ''}" href="/admin/pages?tab=${t.id}"${t.id === tab ? ' aria-current="page"' : ''}><strong>${escapeHtml(t.label)}</strong><small>${escapeHtml(t.hint)}</small></a>`).join('')}
      </nav>
      <style>
        .pages-hub-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 18px}
        .pages-hub-tab{display:block;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:#fff;text-decoration:none;color:inherit}
        .pages-hub-tab strong{display:block;font-size:14px}
        .pages-hub-tab small{display:block;margin-top:3px;color:var(--muted);font-size:11px;line-height:1.5}
        .pages-hub-tab.active{border-color:#1557a8;box-shadow:0 0 0 2px rgba(21,87,168,.12)}
        @media (max-width:900px){.pages-hub-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}}
      </style>
      ${body}
      <script>
      (function(){
        function runScripts(el){
          el.querySelectorAll('script').forEach(function(old){
            var script=document.createElement('script')
            Array.prototype.forEach.call(old.attributes, function(attr){ script.setAttribute(attr.name, attr.value) })
            script.textContent=old.textContent
            old.parentNode.replaceChild(script, old)
          })
        }
        document.body.addEventListener('click', function(e){
          var link = e.target.closest('.pages-hub-tab')
          if(!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
          e.preventDefault()
          var hub = document.getElementById('pages-hub')
          if(!hub) return
          fetch(link.href)
            .then(function(r){ return r.ok ? r.text() : null })
            .then(function(html){
              if(!html) return
              var doc = new DOMParser().parseFromString(html, 'text/html')
              var next = doc.getElementById('pages-hub')
              if(!next) return
              runScripts(next)
              hub.replaceWith(next)
              try { history.pushState(null, '', link.href) } catch(err){}
            })
            .catch(function(){})
        })
      })()
      </script>
    </div>
  `,
  })
}
