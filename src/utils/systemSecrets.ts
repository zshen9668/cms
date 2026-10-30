/**
 * 系统密钥统一入口。
 *
 * 背景：早期版本要求站长先在 Cloudflare Dashboard 里手动配置一堆 Secret
 * （SETUP_TOKEN / JWT_SECRET / INDEXNOW_KEY ...），
 * 少配一个就有功能不可用，对新手极不友好。
 *
 * 现在所有运行时密钥都可以在「后台 → 系统设置 → 系统密钥」里填写，
 * 由 AES-GCM 加密后存进 D1 的 settings 表（实现见 protectedSecrets.ts）。
 *
 * 读取顺序（所有密钥一致）：
 *   1. 后台加密存储（settings 表里的 secret:<NAME>）
 *   2. 环境变量 / Worker Secret（兼容旧部署，优先级更低）
 *
 * 写入永远只写第 1 层。任何密钥都不会被写进 wrangler.toml、源码或 git 仓库。
 *
 * 注册表 SYSTEM_SECRET_SPECS 同时驱动后台表单渲染与写入校验：
 * 未登记的名字一律拒绝写入，避免任意 key 被塞进 settings 表。
 */
import type { Bindings } from '../types'
import { getProtectedSecret, saveProtectedSecret, hasProtectedSecret } from './protectedSecrets'

/** 读写密钥所需的最小绑定集合：只依赖 D1 与 KV，便于只持有部分绑定的调用点复用。 */
export type SystemSecretEnv = Pick<Bindings, 'DB' | 'CACHE_KV'>

export type SystemSecretGroup = 'security' | 'ai' | 'push' | 'wechatWork'

export type SystemSecretSpec = {
  /** 环境变量名，同时也是 settings 表里 secret:<name> 的后缀 */
  name: string
  label: string
  group: SystemSecretGroup
  /** 表单下方的用途说明 */
  hint: string
  /** 输入框占位提示，绝不含真实值 */
  placeholder: string
  /** true 表示按密码框渲染，保存后只显示「已配置」，不回显明文 */
  masked: boolean
  /** 多行输入（整段 JSON 类） */
  multiline?: boolean
  /** 重新填写会使所有已登录后台会话立即失效 */
  invalidatesSessions?: boolean
}

export const SYSTEM_SECRET_GROUPS: ReadonlyArray<{ id: SystemSecretGroup; label: string; description: string }> = [
  {
    id: 'security',
    label: '安全与登录',
    description: '保护后台初始化与登录会话。留空时系统会自动处理，但生产环境建议手动设置。',
  },
  {
    id: 'ai',
    label: 'AI 服务',
    description: '使用 Cloudflare Workers AI 时不需填写；改用 OpenAI 兼容接口时才需要外部密钥。',
  },
  {
    id: 'push',
    label: '搜索引擎推送',
    description: '文章发布后主动通知搜索引擎收录。均可留空，留空时该渠道自动跳过。',
  },
  {
    id: 'wechatWork',
    label: '企业微信',
    description: '接入企业微信后，前台的智能问答可以直接转到企业微信客服，也可由机器人自动回复。',
  },
]

export const SYSTEM_SECRET_SPECS: ReadonlyArray<SystemSecretSpec> = [
  // ---- 安全与登录 ----
  {
    name: 'SETUP_TOKEN',
    label: '后台初始化令牌',
    group: 'security',
    hint: '设置后，访问 /admin/setup 创建首个管理员时必须先输入这个令牌，避免被陌生人抢先注册。首次部署时后台还进不去，可先在 Cloudflare 里配同名 Secret；成功登录后改到这里即可。',
    placeholder: '留空表示不校验令牌',
    masked: true,
  },
  {
    name: 'JWT_SECRET',
    label: '登录会话签名密钥',
    group: 'security',
    hint: '建议填写 32 位以上随机字符串。留空时系统会自动生成并保存在 KV 中。修改此项会让所有已登录的后台会话立即失效，需要重新登录。',
    placeholder: '至少 32 位随机字符串',
    masked: true,
    invalidatesSessions: true,
  },

  // ---- AI ----
  {
    name: 'EXTERNAL_AI_API_KEY',
    label: '外部 AI 接口密钥',
    group: 'ai',
    hint: '只有在 AI 设置里选择了「外部 OpenAI 兼容接口」时才需要填写。密钥只在请求内存中使用，不会回显。',
    placeholder: 'sk-...',
    masked: true,
  },

  // ---- 搜索引擎推送 ----
  {
    name: 'INDEXNOW_KEY',
    label: 'IndexNow 密钥',
    group: 'push',
    hint: '一次推送给 Bing、Yandex 等支持 IndexNow 的搜索引擎。留空则新文章靠搜索引擎自然发现。',
    placeholder: '自定义任意字符串',
    masked: true,
  },
  {
    name: 'BAIDU_TOKEN',
    label: '百度推送 Token',
    group: 'push',
    hint: '百度搜索资源平台 → 普通收录 → API 提交 里的 token。也可以改在 SEO 推送页填写。',
    placeholder: '百度 API 提交 token',
    masked: true,
  },
  {
    name: 'SO_TOKEN',
    label: '360 推送 Token',
    group: 'push',
    hint: '360 站长平台 → 收录提交 的 token。也可以改在 SEO 推送页填写。',
    placeholder: '360 收录提交 token',
    masked: true,
  },
  {
    name: 'SOGOU_TOKEN',
    label: '搜狗推送 Token',
    group: 'push',
    hint: '搜狗站长平台 → 链接提交 的 token。也可以改在 SEO 推送页填写。',
    placeholder: '搜狗链接提交 token',
    masked: true,
  },
  {
    name: 'GOOGLE_SERVICE_ACCOUNT_JSON',
    label: 'Google 索引服务账号 JSON',
    group: 'push',
    hint: 'Google Indexing API 的服务账号 JSON 全文，从 Google Cloud 下载后整段粘贴。用于主动提交新页面给 Google。',
    placeholder: '{ "type": "service_account", ... }',
    masked: true,
    multiline: true,
  },

  // ---- 企业微信 ----
  {
    name: 'WECHAT_WORK_CORP_ID',
    label: '企业 ID（CorpID）',
    group: 'wechatWork',
    hint: '企业微信管理后台 → 我的企业 → 企业信息 里的企业 ID，形如 ww...。',
    placeholder: 'ww...',
    masked: false,
  },
  {
    name: 'WECHAT_WORK_AGENT_ID',
    label: '应用 AgentId',
    group: 'wechatWork',
    hint: '企业微信管理后台 → 应用管理 → 自建应用 里的 AgentId（纯数字）。',
    placeholder: '1000002',
    masked: false,
  },
  {
    name: 'WECHAT_WORK_SECRET',
    label: '应用 Secret',
    group: 'wechatWork',
    hint: '自建应用详情页里的 Secret。用于获取企业微信接口调用凭证。',
    placeholder: '应用 Secret',
    masked: true,
  },
  {
    name: 'WECHAT_WORK_TOKEN',
    label: '接收消息 Token',
    group: 'wechatWork',
    hint: '自建应用 → 接收消息 里自行设置的 Token，用于验证回调请求来自企业微信。',
    placeholder: '自定义 Token',
    masked: true,
  },
  {
    name: 'WECHAT_WORK_AES_KEY',
    label: '接收消息 EncodingAESKey',
    group: 'wechatWork',
    hint: '自建应用 → 接收消息 里生成的 43 位 EncodingAESKey，用于解密回调消息体。',
    placeholder: '43 位 EncodingAESKey',
    masked: true,
  },
]

const SPEC_BY_NAME = new Map<string, SystemSecretSpec>(SYSTEM_SECRET_SPECS.map((spec) => [spec.name, spec]))

/** 已登记的密钥名；未登记的名字不允许写入 settings 表。 */
export const SYSTEM_SECRET_NAMES: readonly string[] = SYSTEM_SECRET_SPECS.map((spec) => spec.name)

export function getSystemSecretSpec(name: string): SystemSecretSpec | undefined {
  return SPEC_BY_NAME.get(name)
}

// ---------------------------------------------------------------------------
// 进程内记忆缓存
//
// getSystemSecret 位于登录校验等热路径上，每个请求都打一次 D1 会明显拖慢响应，
// 也会消耗 D1 免费额度的读取次数。这里按 isolate 缓存 60 秒：
// 后台保存时立刻清除本进程缓存，其它 isolate 最多 60 秒后生效。
// 空值同样缓存，避免「未配置」的密钥反复查库。
// ---------------------------------------------------------------------------
const MEMO_TTL_MS = 60_000
const memo = new Map<string, { value: string; expiresAt: number }>()

function memoRead(name: string): string | undefined {
  const hit = memo.get(name)
  if (!hit) return undefined
  if (hit.expiresAt <= Date.now()) {
    memo.delete(name)
    return undefined
  }
  return hit.value
}

function memoWrite(name: string, value: string): void {
  memo.set(name, { value, expiresAt: Date.now() + MEMO_TTL_MS })
}

/** 清除缓存。传 name 只清一个，不传清全部。后台保存后必须调用。 */
export function clearSystemSecretCache(name?: string): void {
  if (name) memo.delete(name)
  else memo.clear()
}

/** 环境变量兜底值（兼容旧部署时配的 Worker Secret / Var） */
function envFallback(env: SystemSecretEnv, name: string): string {
  const raw = (env as unknown as Record<string, unknown>)[name]
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 读取密钥：后台加密存储优先，其次环境变量。
 * 返回空字符串表示两层都没有配置。
 */
export async function getSystemSecret(env: SystemSecretEnv, name: string): Promise<string> {
  const cached = memoRead(name)
  if (cached !== undefined) return cached
  let value = ''
  try {
    value = await getProtectedSecret(env, name)
  } catch {
    // KV 未绑定等异常不应让整个请求失败，退回环境变量
    value = ''
  }
  if (!value) value = envFallback(env, name)
  memoWrite(name, value)
  return value
}

/** 密钥是否已配置（后台存储或环境变量任一存在即为 true）。 */
export async function hasSystemSecret(env: SystemSecretEnv, name: string): Promise<boolean> {
  if (await getSystemSecret(env, name)) return true
  // getSystemSecret 会在 KV 异常时吞掉错误，这里再单独查一次存储层，避免误报未配置
  try {
    return await hasProtectedSecret(env, name)
  } catch {
    return false
  }
}

/** 批量查询配置状态，供后台表单渲染使用（一次拿全，避免逐项查库）。 */
export async function getSystemSecretStatus(env: SystemSecretEnv): Promise<Record<string, boolean>> {
  const status: Record<string, boolean> = {}
  for (const name of SYSTEM_SECRET_NAMES) {
    status[name] = await hasSystemSecret(env, name)
  }
  return status
}

/**
 * 写入密钥。空字符串表示清除该密钥的后台存储。
 * 名字必须在注册表内，否则抛出异常（防止 settings 表被写入任意 key）。
 */
export async function saveSystemSecret(env: SystemSecretEnv, name: string, value: string): Promise<void> {
  if (!SPEC_BY_NAME.has(name)) throw new Error('未登记的系统密钥：' + name)
  clearSystemSecretCache(name)
  await saveProtectedSecret(env, name, value)
}

/**
 * 批量写入。值为空的项一律跳过（表单里留空表示「不修改」），
 * 清除操作请走 saveSystemSecret(env, name, '')。
 */
export async function saveSystemSecrets(env: SystemSecretEnv, entries: ReadonlyArray<[string, string]>): Promise<string[]> {
  const saved: string[] = []
  for (const [name, raw] of entries) {
    const value = String(raw || '').trim()
    if (!value) continue
    await saveSystemSecret(env, name, value)
    saved.push(name)
  }
  return saved
}

/**
 * 把注册表按分组整理好，供模板直接渲染。
 * 并入当前配置状态，模板无需再关心存储层。
 */
export async function buildSystemSecretForm(
  env: SystemSecretEnv,
): Promise<Array<{ id: SystemSecretGroup; label: string; description: string; items: Array<SystemSecretSpec & { configured: boolean }> }>> {
  const status = await getSystemSecretStatus(env)
  return SYSTEM_SECRET_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    description: group.description,
    items: SYSTEM_SECRET_SPECS.filter((spec) => spec.group === group.id).map((spec) => ({
      ...spec,
      configured: status[spec.name] === true,
    })),
  }))
}
