// 智能问答 / 企业微信 / 双语前台的接线契约校验。
//
// 这三块功能都是「多文件协作」的：密钥注册表、加解密工具、公开路由、挂载点、
// 后台面板、语言解析与模板任何一处漏掉，表现都是"功能静默失效"而不是报错。
// 例如：密钥登记了但没有路由 → 填了没用；路由写了但 index.ts 没挂 → 404；
// 语言设置了但 settingsSchema 没登记 → 前台读不到配置，永远回落默认语言。
// 本脚本把这条链路逐段锁死。
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const required = {
  // 公开问答接口
  'src/routes/aiQa.ts': [
    "aiQaRoutes.get('/qa'",
    "aiQaRoutes.post('/ask'",
    'rateLimit(',
    'verifyTurnstile',
    'logAiQaMessage',
  ],
  // 企业微信回调（URL 验证 + 消息处理）
  'src/routes/wecom.ts': [
    "wecomRoutes.get('/callback'",
    "wecomRoutes.post('/callback'",
    'verifyWecomSignature',
    'decryptWecomMessage',
    'encryptWecomMessage',
    'sendWecomTextMessage',
  ],
  // 挂载点：少一处就是 404
  'src/index.ts': [
    "app.route('/api/ai'",
    "app.route('/api/wecom'",
    'normalizeLocale',
  ],
  // 五项企业微信密钥必须都在注册表里（缺一项回调就永远 503）
  'src/utils/systemSecrets.ts': [
    'WECHAT_WORK_CORP_ID',
    'WECHAT_WORK_AGENT_ID',
    'WECHAT_WORK_SECRET',
    'WECHAT_WORK_TOKEN',
    'WECHAT_WORK_AES_KEY',
  ],
  'src/utils/wecomWork.ts': [
    'qyapi.weixin.qq.com',
    'PKCS7_BLOCK = 32',
    'aes256CbcDecrypt',
    'timingSafeEqual',
  ],
  // 设置项必须登记，否则 getMap('all') 读不到（前台拿不到语言与问答开关）
  'src/utils/settingsSchema.ts': ["'languages'", "'ai_qa_enabled'", "'ai_qa_wecom_auto_reply'"],
  // 双语：语言列表与解析必须真的放行英文
  'src/modules/languageManager/types.ts': ["code: 'en'"],
  'src/modules/languageManager/storage.ts': ['getLanguageConfig', 'defaultLocaleFrom'],
  'src/utils/localeResolve.ts': ['resolveLocale', 'parseAcceptLanguage'],
  // 前台：语言切换 + hreflang + 问答组件
  'src/templates/layout.ts': ['hreflang', 'renderLangSwitcher', 'renderAiQaWidget', 'canonicalUrl'],
  // 后台面板与导航
  // 注意：导航分组定义在拆分后归属于 src/templates/adminLayout.ts（admin.ts 只剩转发导出），
  // 因此"智能问答挂在后台导航里"这条契约要在这里校验。
  'src/routes/admin/index.ts': ['adminAiQaRoutes'],
  'src/templates/adminLayout.ts': ["'/admin/ai-qa'"],
  'src/templates/adminAiQa.ts': ['/admin/ai-qa/save', '/admin/ai-qa/wecom-test'],
  // 数据层
  'migrations/0005_ai_qa_wecom.sql': ['ai_qa_messages', 'wecom_message_log', 'tenant_id'],
}

for (const [file, needles] of Object.entries(required)) {
  let text
  try {
    text = read(file)
  } catch {
    console.error('缺少文件: ' + file)
    process.exit(1)
  }
  const missing = needles.filter((needle) => !text.includes(needle))
  if (missing.length) {
    console.error(file + ' 缺少智能问答/企业微信契约:')
    console.error(missing.join('\n'))
    process.exit(1)
  }
}

// 迁移必须带租户作用域的唯一去重键：企业微信会重推同一条消息
const migration = read('migrations/0005_ai_qa_wecom.sql')
if (!/UNIQUE INDEX[\s\S]*?ai_qa_messages\(msg_id, tenant_id\)/i.test(migration)) {
  console.error('ai_qa_messages 缺少 (msg_id, tenant_id) 唯一索引 —— 企业微信重推会产生重复问答记录')
  process.exit(1)
}

// 回归红线：不能用"忽略配置、强制返回中文"的老办法实现"仅中文"。
// 想只做中文站，请在后台关掉 English，而不是在代码里丢掉语言配置。
// 判定依据是旧实现的代码特征（normalize 的入参被写成 `_items` 即"故意不用"），
// 而不是注释文字——否则注释里提一句历史就会误报。
const storage = read('src/modules/languageManager/storage.ts')
if (/function normalize\(\s*_items/.test(storage)) {
  console.error('src/modules/languageManager/storage.ts 的 normalize() 又丢弃了语言配置（入参写成 _items）—— 请改用启用/停用开关')
  process.exit(1)
}
for (const needle of ['enabledLocalesFrom', 'defaultLocaleFrom']) {
  if (!storage.includes(needle)) {
    console.error('src/modules/languageManager/storage.ts 缺少 ' + needle + ' —— 语言配置没有被真正解析')
    process.exit(1)
  }
}

// AES 实现必须自带：企业微信填充块长 32 字节，WebCrypto 的 AES-CBC 固定按 16 字节校验，
// 填充长度 17~32 时会直接抛 OperationError。
const wecom = read('src/utils/wecomWork.ts')
if (/crypto\.subtle\.decrypt\(\{\s*name:\s*['"]AES-CBC/.test(wecom)) {
  console.error('企业微信解密不允许走 crypto.subtle(AES-CBC) —— 块长 16 的填充校验会让半数消息解密失败')
  process.exit(1)
}

console.log('AI 问答 / 企业微信 / 双语契约 OK')
