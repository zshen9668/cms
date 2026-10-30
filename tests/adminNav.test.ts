import test from 'node:test'
import assert from 'node:assert/strict'
import { NAV, NAV_GROUPS, resolveNavContext } from '../src/templates/adminLayout.ts'
import { ADMIN_MODULES } from '../src/templates/admin.ts'

/**
 * 后台信息架构的回归测试。
 *
 * 后台导航的分组是「新增页面时最容易漏」的地方：加了一条路由、忘了往 NAV 里补一项，
 * 页面就变成只有知道 URL 才进得去；把 href 写到不存在的分组 id 上，侧边栏会静默少一组。
 * 这两类问题在浏览器里都表现为"功能好像没了"，很难查，所以在单测里锁死。
 */

test('每个分组 id 在 NAV_GROUPS 里唯一，且都带着落地页与短标签', () => {
  const ids = NAV_GROUPS.map((g) => g.id)
  assert.equal(new Set(ids).size, ids.length, '分组 id 重复: ' + ids.join(', '))
  for (const group of NAV_GROUPS) {
    assert.ok(group.label, '分组缺少名称: ' + group.id)
    assert.ok(group.shortLabel, '分组缺少移动端短标签: ' + group.id)
    assert.ok(group.icon, '分组缺少图标: ' + group.id)
    assert.ok(group.entryHref.startsWith('/admin'), '分组落地页必须是后台路径: ' + group.entryHref)
  }
})

test('分组落地页确实存在于 NAV 中（否则点分组标题会 404）', () => {
  const hrefs = new Set(NAV.map((item) => item.href))
  for (const group of NAV_GROUPS) {
    assert.ok(hrefs.has(group.entryHref), `分组 ${group.id} 的落地页 ${group.entryHref} 不在 NAV 里`)
  }
})

test('NAV 的每一项都挂在已声明的分组上，且 href 不重复', () => {
  const groupIds = new Set<string>(NAV_GROUPS.map((g) => g.id))
  const seen = new Map<string, string>()
  for (const item of NAV) {
    assert.ok(groupIds.has(item.group), `NAV 项 ${item.href} 用了未声明的分组: ${item.group}`)
    assert.ok(item.href.startsWith('/admin'), `NAV 项必须是后台路径: ${item.href}`)
    assert.ok(item.label, `NAV 项缺少标签: ${item.href}`)
    const previous = seen.get(item.href)
    assert.equal(previous, undefined, `NAV 里出现重复的 href: ${item.href}`)
    seen.set(item.href, item.label)
  }
})

test('每个分组都至少有一个菜单项（空分组会在侧边栏留下一个点不开的标题）', () => {
  for (const group of NAV_GROUPS) {
    const count = NAV.filter((item) => item.group === group.id).length
    assert.ok(count > 0, `分组 ${group.id} 没有任何菜单项`)
  }
})

test('resolveNavContext: 精确命中、子路径命中与兜底', () => {
  assert.deepEqual(resolveNavContext('/admin'), { groupId: 'overview', group: '总览', label: '数据概览', href: '/admin' })
  assert.equal(resolveNavContext('/admin/geo').groupId, 'seo')
  assert.equal(resolveNavContext('/admin/geo').label, 'GEO / AI 搜索')
  // 子页面必须归到父菜单所在分组，否则移动端底部栏会全部不高亮
  assert.equal(resolveNavContext('/admin/articles/12/edit').groupId, 'content')
  assert.equal(resolveNavContext('/admin/articles/12/edit').href, '/admin/articles')
  assert.equal(resolveNavContext('/admin/cases/new').groupId, 'content')
  assert.equal(resolveNavContext('/admin/ai-qa').groupId, 'ai')
  assert.equal(resolveNavContext('/admin/system-secrets').groupId, 'system')
  // 未登记路径不能抛异常，退回"后台 / 管理"
  assert.deepEqual(resolveNavContext('/admin/whatever'), { groupId: '', group: '后台', label: '管理', href: '/admin' })
})

test('子路径命中取最长前缀（避免 /admin/seo 抢走 /admin/seo-xxx 之类）', () => {
  // /admin/system-secrets 与 /admin/system 同时是前缀，必须命中更具体的那个
  assert.equal(resolveNavContext('/admin/system-secrets').href, '/admin/system-secrets')
  assert.equal(resolveNavContext('/admin/system/anything').href, '/admin/system')
})

test('后台模板域划分覆盖全部导航入口涉及的域', () => {
  // ADMIN_MODULES 是模板拆分后的域划分。模块名与导航分组 id 刻意同名（admin+分组 id），
  // 这样「某个页面挂在哪一组」和「它的模板在哪个文件」是同一个答案。
  const moduleNames = Object.keys(ADMIN_MODULES)
  for (const group of NAV_GROUPS) {
    const expected = 'admin' + group.id.charAt(0).toUpperCase() + group.id.slice(1)
    assert.ok(moduleNames.includes(expected), `缺少与分组 ${group.id} 同名的模板模块 ${expected}`)
  }
  // 两个记录在案的例外：后台外壳，以及内容组里单独切出来的分发模板
  for (const extra of ['adminLayout', 'adminSocial']) {
    assert.ok(moduleNames.includes(extra), `缺少模块 ${extra}`)
  }
  // 每个模板函数只归属一个模块
  const all = Object.values(ADMIN_MODULES).flat()
  assert.equal(new Set(all).size, all.length, '同一个模板函数被登记进多个模块')
  assert.ok(all.includes('renderAdminLayout'), 'ADMIN_MODULES 必须包含后台外壳 renderAdminLayout')
})
