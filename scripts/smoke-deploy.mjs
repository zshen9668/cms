const raw = process.argv[2]
if (!raw) {
  console.error('用法：npm run smoke:deploy -- https://你的-worker.workers.dev')
  process.exit(2)
}

const base = raw.replace(/\/$/, '')
const endpoints = [
  '/healthz',
  '/healthz?probe=1',
  '/robots.txt',
  '/sitemap.xml',
]

let failed = false
for (const path of endpoints) {
  try {
    const response = await fetch(base + path, { redirect: 'follow' })
    const text = await response.text()
    if (!response.ok) {
      failed = true
      console.error('FAIL', path, response.status, text.slice(0, 500))
      continue
    }
    console.log('OK', path, response.status)
    if (path === '/healthz?probe=1') {
      try {
        const data = JSON.parse(text)
        console.log(JSON.stringify({
          ok: data.ok,
          bindings: data.bindings,
          d1_schema: data.d1_schema,
          missing_tables: data.missing_tables,
          probe: data.probe,
        }, null, 2))
        if (!data.ok || (Array.isArray(data.missing_tables) && data.missing_tables.length)) failed = true
      } catch {
        failed = true
        console.error('FAIL /healthz?probe=1: 返回不是 JSON')
      }
    }
  } catch (error) {
    failed = true
    console.error('FAIL', path, String(error))
  }
}

if (failed) process.exit(1)
console.log('部署 smoke test 全部通过')
