export type PlatformKey = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'bilibili'

export type PlatformConfig = {
  key: PlatformKey
  label: string
  color: string
  icon: string
  contentKind: 'script' | 'note' | 'article' // 短视频脚本 / 图文笔记 / 专栏文章
  copyMode: 'plain' | 'richtext'             // 纯文本复制 or 富文本复制（保留排版）
  hashtagStyle: (tag: string) => string
  helpText: string
}

export const PLATFORMS: Record<PlatformKey, PlatformConfig> = {
  douyin: {
    key: 'douyin', label: '抖音', color: '#111111', icon: '🎵',
    contentKind: 'script', copyMode: 'plain',
    hashtagStyle: (tag) => `#${tag}`,
    helpText: '生成的是短视频口播文案脚本，配着这段稿子对着镜头讲/配AI配音即可，不含实际视频文件。',
  },
  kuaishou: {
    key: 'kuaishou', label: '快手', color: '#ff5000', icon: '⚡',
    contentKind: 'script', copyMode: 'plain',
    hashtagStyle: (tag) => `#${tag}`,
    helpText: '生成的是短视频口播文案脚本，风格更接地气一些，同样不含实际视频文件。',
  },
  xiaohongshu: {
    key: 'xiaohongshu', label: '小红书', color: '#ff2442', icon: '📕',
    contentKind: 'note', copyMode: 'plain',
    hashtagStyle: (tag) => `#${tag}`,
    helpText: '生成的是图文笔记文案（标题+正文），配一张封面图/图解卡片一起发布效果更好。',
  },
  bilibili: {
    key: 'bilibili', label: '哔哩哔哩', color: '#00a1d6', icon: '📺',
    contentKind: 'article', copyMode: 'richtext',
    hashtagStyle: (tag) => tag,
    helpText: '生成的是B站专栏图文文章，可以直接复制粘贴到"创作中心-专栏"编辑器，保留基本排版。',
  },
}

export const PLATFORM_LIST: PlatformConfig[] = Object.values(PLATFORMS)
