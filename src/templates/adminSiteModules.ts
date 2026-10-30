import { escapeHtml } from './layout'
import type { ContactChannel } from '../modules/contactChannels'
import type { NavigationItem } from '../modules/navigation/service'
import type { LanguageOption } from '../modules/languageManager'

const CHANNEL_TYPES = ['phone', 'wechat', 'qq', 'email', 'whatsapp', 'telegram', 'address', 'custom'] as const

/** 站点模块正文：由「页面管理 → 导航与联系」分页签渲染。 */
export function siteModulesBody(opts: {
  contacts: ContactChannel[]
  navigation: NavigationItem[]
  languages: LanguageOption[]
  message?: string
  error?: string
}): string {
  const { contacts, navigation, languages, message = '', error = '' } = opts

  const languageRows = languages.map((lang, i) => `
      <tr>
        <td><input name="l_name_${i}" value="${escapeHtml(lang.name)}" style="width:140px" /></td>
        <td><input name="l_code_${i}" value="${escapeHtml(lang.code)}" readonly style="width:90px;background:var(--surface, #f6f7f9)" /></td>
        <td style="text-align:center"><input type="checkbox" name="l_enabled_${i}" value="1"${lang.enabled !== false ? ' checked' : ''} /></td>
        <td style="text-align:center"><input type="radio" name="l_default" value="${i}"${lang.default ? ' checked' : ''} /></td>
      </tr>`).join('')
  const enabledLanguageCount = languages.filter((l) => l.enabled !== false).length

  const contactRows = contacts.length
    ? contacts.map((c, i) => `
      <tr data-idx="${i}">
        <td><input name="c_id_${i}" value="${escapeHtml(c.id)}" readonly style="width:72px;font-size:12px" /></td>
        <td><select name="c_type_${i}">${CHANNEL_TYPES.map((t) => `<option value="${t}"${c.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input name="c_label_${i}" value="${escapeHtml(c.label)}" /></td>
        <td><input name="c_value_${i}" value="${escapeHtml(c.value)}" style="min-width:160px" /></td>
        <td><input name="c_open_${i}" value="${escapeHtml(c.openUrl || '')}" placeholder="打开链接（可选）" style="min-width:180px" /></td>
        <td>
          <input name="c_qr_${i}" value="${escapeHtml(c.qrUrl || '')}" placeholder="R2二维码URL（可选）" style="min-width:180px" />
          <input type="file" name="c_qr_file_${i}" accept="image/jpeg,image/png,image/webp,image/gif" style="max-width:220px;margin-top:4px" />
        </td>
        <td><input name="c_locale_${i}" value="${escapeHtml(c.locale || 'all')}" style="width:72px" /></td>
        <td><input type="number" name="c_sort_${i}" value="${Number(c.sortOrder) || i + 1}" style="width:62px" /></td>
        <td style="text-align:center"><input type="checkbox" name="c_enabled_${i}" value="1"${c.enabled !== false ? ' checked' : ''} /></td>
        <td style="font-size:12px;line-height:1.8">
          <label><input type="checkbox" name="c_header_${i}" value="1"${c.display?.header ? ' checked' : ''} /> Header</label><br>
          <label><input type="checkbox" name="c_footer_${i}" value="1"${c.display?.footer !== false ? ' checked' : ''} /> Footer</label><br>
          <label><input type="checkbox" name="c_contact_${i}" value="1"${c.display?.contact !== false ? ' checked' : ''} /> 联系页</label><br>
          <label><input type="checkbox" name="c_ai_${i}" value="1"${c.display?.ai !== false ? ' checked' : ''} /> AI</label>
        </td>
        <td><button type="button" class="btn secondary btn-sm" onclick="removeRow(this)">删除</button></td>
      </tr>`).join('')
    : ''

  const navRows = navigation.map((n, i) => `
      <tr data-idx="${i}">
        <td><input name="n_key_${i}" value="${escapeHtml(n.key)}" readonly style="width:90px" /></td>
        <td><input name="n_path_${i}" value="${escapeHtml(n.path)}" readonly style="width:100px" /></td>
        <td><input name="n_label_${i}" value="${escapeHtml(n.label)}" /></td>
        <td><input type="number" name="n_sort_${i}" value="${Number(n.sortOrder) || i + 1}" style="width:72px" /></td>
        <td><input type="number" name="n_mobile_${i}" value="${Number(n.mobileOrder) || i + 1}" style="width:72px" /></td>
        <td style="text-align:center"><input type="checkbox" name="n_enabled_${i}" value="1"${n.enabled !== false ? ' checked' : ''} /></td>
        <td style="text-align:center"><input type="checkbox" name="n_bottom_${i}" value="1"${n.bottom !== false && n.group !== 'more' ? ' checked' : ''} /></td>
      </tr>`).join('')

  return `
    <div class="section-title">
      <div>
        <h2>站点模块</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:13px">统一管理前台导航顺序与联系渠道。路径固定不可改；标签名也可在「页面管理」中修改。</p>
      </div>
    </div>
    ${message ? `<div class="card" style="border-left:4px solid #2f9e44;margin-bottom:16px">${escapeHtml(message)}</div>` : ''}
    ${error ? `<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">${escapeHtml(error)}</div>` : ''}

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">① 联系渠道</h3>
      <p style="color:var(--muted);font-size:13px;margin-top:0">联系方式渠道：支持电话、即时通讯、邮箱、二维码、自定义链接等多种类型。可配置打开链接、二维码与不同展示场景（Header / Footer / 联系页 / AI）；选择二维码文件后保存，系统会上传到 R2 并写入媒体地址。</p>
      <form method="post" action="/admin/modules/contact/form" id="contactForm" enctype="multipart/form-data">
        <input type="hidden" name="contact_count" id="contact_count" value="${contacts.length}" />
        <div class="admin-table-wrap">
          <table id="contactTable">
            <thead><tr><th>ID</th><th>类型</th><th>标签</th><th>值</th><th>打开链接</th><th>二维码</th><th>语言</th><th>排序</th><th>启用</th><th>显示位置</th><th></th></tr></thead>
            <tbody>${contactRows}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
          <button type="button" class="btn secondary" onclick="addContactRow()">+ 添加渠道</button>
          <button type="submit" class="btn">保存联系方式</button>
        </div>
      </form>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">② 导航顺序与启停</h3>
      <p style="color:var(--muted);font-size:13px;margin-top:0">路径固定。桌面顺序用 sortOrder，底部导航用 mobileOrder,勾选“底部栏”的入口最多显示 5 个(手机端底部栏固定 5 项),其余入口在“更多”抽屉中。</p>
      <form method="post" action="/admin/modules/navigation/form">
        <input type="hidden" name="nav_count" value="${navigation.length}" />
        <div class="admin-table-wrap"><table><thead><tr><th>Key</th><th>路径</th><th>标签</th><th>桌面顺序</th><th>移动顺序</th><th>启用</th><th>底部栏</th></tr></thead><tbody>${navRows}</tbody></table></div>
        <button type="submit" class="btn" style="margin-top:12px">保存导航</button>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">③ 语言</h3>
      <p style="color:var(--muted);font-size:13px;margin-top:0">
        前台支持<strong>中文 + English</strong>。启用的语言会出现在页头的语言切换器里，并用 <code>?lang=xxx</code> 生成可被搜索引擎单独收录的地址。
        只启用一种语言时前台不显示切换器，站点按该语言渲染（与旧版"仅中文"表现一致）。
      </p>
      <form method="post" action="/admin/modules/languages/form">
        <input type="hidden" name="lang_count" value="${languages.length}" />
        <div class="admin-table-wrap">
          <table>
            <thead><tr><th>名称</th><th>代码</th><th>启用</th><th>默认语言</th></tr></thead>
            <tbody>${languageRows}</tbody>
          </table>
        </div>
        <p style="color:var(--muted);font-size:12px;margin:10px 0 0">
          默认语言必须是已启用的语言。页面标题、正文与 SEO 词的英文版本在「前台页面」里单独填写；
          城市名、服务名与文章正文属于运营内容，不做机器翻译。
        </p>
        ${enabledLanguageCount > 1 ? '<p style="color:#c26a00;font-size:12px;margin:8px 0 0">提示：启用多语言后，前台同一 URL 会因 cookie 返回不同语言，因此页面不再进入 Cloudflare 边缘缓存（避免把中文缓存给英文访客）。只启用一种语言即可恢复原缓存策略。</p>' : ''}
        <button type="submit" class="btn" style="margin-top:12px">保存语言设置</button>
      </form>
    </div>

    <script>
    function removeRow(btn){var tr=btn.closest('tr');if(tr)tr.remove();reindexContacts();}
    function reindexContacts(){var rows=document.querySelectorAll('#contactTable tbody tr');document.getElementById('contact_count').value=rows.length;rows.forEach(function(tr,i){tr.setAttribute('data-idx',i);tr.querySelectorAll('input,select').forEach(function(el){if(!el.name)return;el.name=el.name.replace(/_\\d+$/,'_'+i);});});}
    function addContactRow(){
      var tbody=document.querySelector('#contactTable tbody');var i=tbody.querySelectorAll('tr').length;var id=String(Date.now())+'-'+i;var tr=document.createElement('tr');tr.setAttribute('data-idx',i);
      tr.innerHTML='<td><input name="c_id_'+i+'" value="'+id+'" readonly style="width:72px;font-size:12px" /></td>'+
        '<td><select name="c_type_'+i+'">'+${JSON.stringify([...CHANNEL_TYPES])}.map(function(t){return '<option value="'+t+'">'+t+'</option>';}).join('')+'</select></td>'+
        '<td><input name="c_label_'+i+'" value="" /></td><td><input name="c_value_'+i+'" value="" style="min-width:160px" /></td>'+
        '<td><input name="c_open_'+i+'" value="" placeholder="https://..." style="min-width:180px" /></td><td><input name="c_qr_'+i+'" value="" placeholder="R2二维码URL" style="min-width:180px" /><input type="file" name="c_qr_file_'+i+'" accept="image/jpeg,image/png,image/webp,image/gif" style="max-width:220px;margin-top:4px" /></td>'+
        '<td><input name="c_locale_'+i+'" value="all" style="width:72px" /></td><td><input type="number" name="c_sort_'+i+'" value="'+(i+1)+'" style="width:62px" /></td>'+
        '<td style="text-align:center"><input type="checkbox" name="c_enabled_'+i+'" value="1" checked /></td>'+
        '<td style="font-size:12px;line-height:1.8"><label><input type="checkbox" name="c_header_'+i+'" value="1" /> Header</label><br><label><input type="checkbox" name="c_footer_'+i+'" value="1" checked /> Footer</label><br><label><input type="checkbox" name="c_contact_'+i+'" value="1" checked /> 联系页</label><br><label><input type="checkbox" name="c_ai_'+i+'" value="1" checked /> AI</label></td>'+
        '<td><button type="button" class="btn secondary btn-sm" onclick="removeRow(this)">删除</button></td>';
      tbody.appendChild(tr);document.getElementById('contact_count').value=i+1;
    }
    </script>
  `
}
