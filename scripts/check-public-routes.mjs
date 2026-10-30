import fs from 'node:fs'
import path from 'node:path'

const routesFile = fs.readFileSync(path.resolve('src/routes/public.ts'), 'utf8')
const layoutFile = fs.readFileSync(path.resolve('src/templates/layout.ts'), 'utf8')
const templateFile = fs.readFileSync(path.resolve('src/templates/public.ts'), 'utf8')
const navServiceFile = fs.existsSync(path.resolve('src/modules/navigation/service.ts'))
  ? fs.readFileSync(path.resolve('src/modules/navigation/service.ts'), 'utf8')
  : ''

const requiredRoutes = [
  "publicRoutes.get('/',",
  "publicRoutes.get('/service',",
  "publicRoutes.get('/service/:slug',",
  "publicRoutes.get('/city',",
  "publicRoutes.get('/city/:slug',",
  "publicRoutes.get('/city/:citySlug/:serviceSlug',",
  "publicRoutes.get('/article',",
  "publicRoutes.get('/article/:slugOrId',",
  "publicRoutes.get('/about',",
  "publicRoutes.get('/contact',",
  "publicRoutes.post('/contact',",
  "publicRoutes.get('/service/topic/:slug',",
  "publicRoutes.get('/city/topic/:slug',",
  "publicRoutes.get('/article/tag/:slug',",
  "publicRoutes.get('/new',",
  "publicRoutes.get('/new/:slug',",
  "publicRoutes.get('/search',",
  "publicRoutes.get('/lang/:code',",
]

const missingRoutes = requiredRoutes.filter((needle) => !routesFile.includes(needle))
if (missingRoutes.length) {
  console.error('Missing public routes:', missingRoutes.join(', '))
  process.exit(1)
}

// Navigation matrix: either legacy hard-coded navLink calls OR dynamic DEFAULT_NAVIGATION paths
const requiredNavPaths = ['/', '/service', '/city', '/article', '/about', '/contact']
const legacyNavCalls = [
  "navLink('/', navHome)",
  "navLink('/service', navServices)",
  "navLink('/city', navCities)",
  "navLink('/article', navArticles)",
  "navLink('/about', navAbout)",
  "navLink('/contact', navContact)",
]
const hasLegacyNav = legacyNavCalls.every((needle) => layoutFile.includes(needle))
const hasDynamicNav =
  layoutFile.includes('DEFAULT_NAVIGATION') &&
  layoutFile.includes('navLink(item.path') &&
  layoutFile.includes('desktopNav') &&
  requiredNavPaths.every(
    (p) => navServiceFile.includes(`path: '${p}'`) || navServiceFile.includes(`path: "${p}"`),
  )

if (!hasLegacyNav && !hasDynamicNav) {
  const missingLegacy = legacyNavCalls.filter((needle) => !layoutFile.includes(needle))
  const missingPaths = requiredNavPaths.filter(
    (p) => !navServiceFile.includes(`path: '${p}'`) && !navServiceFile.includes(`path: "${p}"`),
  )
  console.error(
    'Missing header/mobile navigation routes.',
    missingLegacy.length ? 'legacy: ' + missingLegacy.join(', ') : '',
    missingPaths.length ? 'dynamic paths: ' + missingPaths.join(', ') : '',
  )
  process.exit(1)
}

const requiredBottomNav = ['class="bottom-nav"']
const missingBottomShell = requiredBottomNav.filter((needle) => !layoutFile.includes(needle))
if (missingBottomShell.length) {
  console.error('Missing bottom navigation shell:', missingBottomShell.join(', '))
  process.exit(1)
}

// Bottom links: legacy hard-coded hrefs OR dynamic bottomNavHtml from DEFAULT_NAV paths
const legacyBottomHrefs = ['href="/"', 'href="/service"', 'href="/article"', 'href="/city"', 'href="/about"', 'href="/contact"']
const hasLegacyBottom = legacyBottomHrefs.every((needle) => layoutFile.includes(needle))
const hasDynamicBottom =
  layoutFile.includes('bottomNavHtml') ||
  layoutFile.includes('bottomNav.map') ||
  (layoutFile.includes('bottom-nav') && hasDynamicNav)

if (!hasLegacyBottom && !hasDynamicBottom) {
  console.error('Missing bottom navigation routes:', legacyBottomHrefs.join(', '))
  process.exit(1)
}

const requiredTemplateLinks = [
  ['service detail', 'href="/service/'],
  ['city detail', 'href="/city/'],
]
const missingLinks = requiredTemplateLinks
  .filter(([, needle]) => !templateFile.includes(needle))
  .map(([label]) => label)
const hasArticleDetailLink = templateFile.includes('articlePublicPath(') || templateFile.includes('/article/')
if (!hasArticleDetailLink) missingLinks.push('article detail')
if (missingLinks.length) {
  console.error('Missing public template links:', missingLinks.join(', '))
  process.exit(1)
}

const requiredSeoEndpoints = [
  "seoRoutes.get('/sitemap.xml'",
  "seoRoutes.get('/robots.txt'",
  "seoRoutes.get('/ai-index.json'",
  "seoRoutes.get('/llms.txt'",
]
const seoRoutesFile = fs.readFileSync(path.resolve('src/routes/seo.ts'), 'utf8')
const missingSeo = requiredSeoEndpoints.filter((needle) => !seoRoutesFile.includes(needle))
if (missingSeo.length) {
  console.error('Missing SEO/GEO endpoints:', missingSeo.join(', '))
  process.exit(1)
}

console.log('Public route/link/SEO completeness OK' + (hasDynamicNav ? ' (dynamic navigation)' : ' (legacy navigation)'))
