import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkGeoContent } from '../src/utils/geoCheck.ts'

const good = `<p>政策要求企业在办理前完成资料核验,适用于新申请与续期企业,核心是先备齐材料再提交。</p>
<h2>适用对象与范围</h2><p>${'适用于需要办理相关业务的中小企业,覆盖新设与续期场景。'.repeat(8)}</p>
<h2>办理流程与企业执行步骤</h2><p>${'先核验营业执照与经营范围,再按清单准备材料并提交。'.repeat(8)}</p>
<h2>企业实际影响</h2><p>${'资料不齐会导致退回,影响项目排期,建议提前安排专人核对。'.repeat(8)}</p>
<h2>注意事项与风险提醒</h2><p>${'以官方最新公告为准,不要依赖未经核实的经验性说法。'.repeat(8)}</p>`

test('passes a well-structured GEO article', () => {
  const r = checkGeoContent({ title: '资料核验指南', content: good })
  assert.equal(r.passed, r.total, JSON.stringify(r.items.filter((i) => !i.ok)))
  assert.equal(r.score, 100)
})

test('flags a long first paragraph that is not extractable', () => {
  const content = `<p>${'很长的开场白'.repeat(20)}</p>` + good.slice(good.indexOf('<h2>'))
  const r = checkGeoContent({ title: 't', content })
  assert.equal(r.items.find((i) => i.key === 'lead')?.ok, false)
})

test('flags missing process, risk and impact sections', () => {
  const content = `<p>简短结论。</p><h2>概述</h2><p>${'普通说明。'.repeat(120)}</p>`
  const r = checkGeoContent({ title: 't', content })
  for (const key of ['process', 'risk', 'impact', 'structure']) {
    assert.equal(r.items.find((i) => i.key === key)?.ok, false, key)
  }
})

test('flags thin content below 600 characters', () => {
  const r = checkGeoContent({ title: 't', content: '<p>短。</p>' })
  assert.equal(r.items.find((i) => i.key === 'length')?.ok, false)
})
