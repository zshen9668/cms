const CACHE_NAME = 'whitelabel-cms-cache-v8'
const PRECACHE = ['/', '/styles.css?v=20261029-1', '/main.js?v=20261029-1', '/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

// 静态资源走缓存优先；页面走网络优先（保证内容新鲜），网络失败时回退缓存
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const isStatic = /\.(css|js|png|jpg|jpeg|svg|ico|woff2?)$/.test(url.pathname)

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then((c) => c.put(req, clone))
        return res
      }))
    )
  } else {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    )
  }
})
