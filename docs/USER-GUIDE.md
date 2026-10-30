# 白标 CMS 使用指南

本指南面向站长（非开发人员），介绍部署完成后的常见操作和配置步骤。

## 1. 部署后 3 步配置向导

部署完成后，请按顺序完成以下三步，把站点从「白标空壳」变成「可用站点」：

### 第 1 步：选行业模板 + 创建管理员

打开 `https://你的项目.workers.dev/admin/setup`，填写管理员邮箱和密码（至少 10 位、含两类字符），并选择行业预设。

系统会自动：
- 创建管理员账号
- 写入行业画像（行业类型、目标客户、服务特色、应用场景、行业关键词）
- 生成城市×服务关键词矩阵
- 插入默认城市和服务数据

> 提示：画像名称输入时会自动匹配行业预设。例如输入「物流」会自动匹配「物流与货运」预设并回填相关字段。

### 第 2 步：配置 AI 通道

打开 `/admin/ai-settings`：

1. 开启「AI 内容生成」开关
2. 选择通道：Cloudflare Workers AI（无需额外密钥）或第三方 OpenAI 兼容 API（需填 Base URL 和模型名）
3. 外部 API Key：在「系统密钥」页面填写 `EXTERNAL_AI_API_KEY`
4. 点击「运行诊断」验证通道是否可用
5. 可选：勾选「启用联网增强」，允许 AI 在回答时检索联网信息（需模型支持 OpenAI tools 调用，推荐 Perplexity/Google Gemini 等；NVIDIA 等模型保存时可能提示 400 错误）

### 第 3 步：配置 SEO 推送密钥

打开 `/admin/system-secrets`，填写以下密钥（可选，但建议配置以便文章发布后自动通知搜索引擎）：

| 密钥 | 说明 |
|------|------|
| `INDEXNOW_KEY` | IndexNow 密钥，用于通知 Bing/Yandex/百度 |
| `BAIDU_TOKEN` | 百度普通收录 Token |
| `SO_TOKEN` | 360 搜索 Token |
| `SOGOU_TOKEN` | 搜狗搜索 Token |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Indexing API 服务账号 JSON |

---

## 2. 后台功能一览

后台入口 `/admin`，侧边栏分 6 组：

| 分组 | 页面 | 功能 |
|------|------|------|
| **总览** | `/admin` | 站点状态、内容统计、访问数据 |
| **内容** | `/admin/articles` | 文章管理（含 AI 写作、版本历史、微信排版、多平台分发） |
| | `/admin/cases` | 成功案例 |
| | `/admin/news-sources` | 新闻采集来源与采集日志 |
| | `/admin/messages` | 客户留言 |
| **页面** | `/admin/pages` | 前台页面 / 城市 / 服务 / 导航与联系（四个分页签） |
| | `/admin/subprojects` | 子项目 / 栏目标签 |
| **SEO 增长** | `/admin/seo` | SEO 推送与结构化数据 |
| | `/admin/geo` | GEO / AI 搜索监测 |
| | `/admin/keywords` | 关键词矩阵（城市 × 服务） |
| | `/admin/rankings` | 排名追踪 |
| **AI** | `/admin/ai-settings` | AI 通道、模型与生成参数 |
| | `/admin/ai-prompts` | AI 提示词（全局 + 按任务） |
| | `/admin/ai-qa` | 智能问答：开关、测试、会话记录、企业微信配置 |
| **系统** | `/admin/media` | R2 媒体库与微信二维码 |
| | `/admin/forms` | 动态表单与提交收集 |
| | `/admin/rbac` | 角色与后台模块权限 |
| | `/admin/api-keys` | API 密钥 |
| | `/admin/modules/*` | 联系渠道 / 语言 / 导航（与 `/admin` 同等权限校验） |
| | `/admin/settings` | 系统设置（站点画像、行业与业务配置、首页模块顺序） |
| | `/admin/system-secrets` | 系统密钥（加密存储，免重部署） |
| | `/admin/system` | 系统自检 |
| | `/admin/tenants` | 多租户管理 |
| | `/admin/articles?status=review_logs` | 审核日志 |
| | `/admin/geo?tab=crawler` | AI 爬虫统计 |
| | `/admin/ai-qa` | 企业微信日志 |

---

## 3. 常见问题

### Q1: 创建管理员失败，提示「管理员密码加密失败」

**原因**：PBKDF2 60万次迭代在 Cloudflare Workers 免费层的 CPU 时间限制（约 50ms/请求）内可能超时。

**解决**：系统已内置自动回退机制。首次创建时若 60万次迭代超时，会自动回退到 10万次迭代重新生成。重新尝试即可成功。

### Q2: 提交后台表单提示「CSRF 令牌无效」

**原因**：首次访问后台时，CSRF Cookie 尚未写入浏览器，表单缺少 `_csrf` 隐藏字段。

**解决**：
1. 先访问任意其他后台页面（如 `/admin`），使浏览器存储 `csrf_token` Cookie
2. 再返回 `/admin/api-keys` 等页面提交表单
3. 如仍无效，请使用无痕模式测试，或检查浏览器是否拒绝第三方 Cookie

### Q3: AI 功能无响应，测试提示失败

**原因**：AI 通道未配置或模型不可用。

**解决**：
1. 打开 `/admin/ai-settings`，点击「运行诊断」查看具体错误
2. 确保已配置 AI 通道（Workers AI 或外部 OpenAI-compatible API）
3. 外部 API Key 已在「系统密钥 → 安全与登录」中填写 `EXTERNAL_AI_API_KEY`
4. 模型名称正确（如 `llama-3.1-8b-instruct-fast`、`deepseek-chat` 等）

### Q4: 联网增强保存报 400 错误

**原因**：所选模型不支持 OpenAI tools 调用，无法使用联网增强功能。

**解决**：切换为支持联网增强的模型，如 Perplexity、Google Gemini 等。NVIDIA 等部分模型不支持，保存时会提示 400 错误。

### Q5: 搜索引擎未收录我的文章

**解决**：
1. 在 `/admin/system-secrets` 配置 IndexNow Key、百度 Token、360 Token、搜狗 Token
2. 文章发布后，在后台「SEO / 推送」页面点击「通知搜索引擎」
3. 确保网站已配置 `SITE_URL` 环境变量，且文章已发布（状态为 published）
4. 查看 `/admin/seo` 的推送结果查询，确认提交状态

---

## 4. 后台主要页面功能说明

| 页面 | 主要功能 |
|------|----------|
| **文章管理** | 文章新建、编辑、发布、审核、驳回、AI 写作、AI 优化、版本历史、微信排版、多平台分发 |
| **新闻采集** | 添加采集源（RSS/Atom/JSON/HTML 列表页）、立即抓取、定时采集、质量门槛设置 |
| **客户留言** | 查看客户留言、回复客户、标记已读/未读、删除留言 |
| **系统设置** | 站点画像（名称、主题、行业、核心服务、核心关键词）、行业与业务配置、首页模块顺序、固定关键词 |
| **行业与业务配置** | 行业类型选择、目标客户、服务特色、应用场景、行业关键词、AI 生成行业关键词 |
| **AI 设置** | AI 通道选择（Workers AI / 外部 OpenAI-compatible）、模型参数、提示词管理、智能问答测试 |
| **智能问答** | 问答开关、欢迎语、资料上限、站内资料选择、企业微信自动回复、问答记录查看 |
| **媒体库** | 图片上传（超过 200KB 时日志提示建议压缩）、微信二维码管理、媒体文件删除 |
| **系统自检** | D1/KV/R2/AI 绑定状态检查、日志清理状态查看 |

---

## 5. 搜索引擎收录与 GEO 配置步骤

### 搜索引擎推送

1. 在 `/admin/system-secrets` 配置以下密钥（任选）：
   - `INDEXNOW_KEY`：IndexNow 密钥，用于通知 Bing/Yandex/百度
   - `BAIDU_TOKEN`：百度普通收录 Token
   - `SO_TOKEN`：360 搜索 Token
   - `SOGOU_TOKEN`：搜狗搜索 Token
   - `GOOGLE_SERVICE_ACCOUNT_JSON`：Google Indexing API 服务账号 JSON

2. 发布文章后，在后台「SEO / 推送」页面点击「通知搜索引擎」，系统会将新发布文章的 URL 提交给已配置的渠道。

### GEO / AI 搜索配置

1. 在 `/admin/ai-settings` 开启 AI 内容生成
2. 在 `/admin/geo` 配置：
   - 开启「AI 爬虫白名单」：允许 GPTBot/ClaudeBot 等 AI 爬虫抓取
   - 开启「发布 /llms.txt」：提供 AI 引擎站点摘要
3. 在「署名与站点实体」填写作者信息、站点 logo、官方主页，提升 AI 引擎可信度

---

## 6. 常见术语

| 术语 | 说明 |
|------|------|
| 白标 CMS | 可重新品牌化的内容管理系统，站长可自定义站点名称、行业、服务等 |
| D1 | Cloudflare 的 SQLite 数据库，存储所有业务数据 |
| KV | Cloudflare Workers KV，存储会话、缓存、系统密钥 |
| R2 | Cloudflare 对象存储，存储媒体文件（图片、文档等） |
| Workers AI | Cloudflare 的 AI 推理服务，用于文章生成、关键词生成等 |
| GEO | Generative Engine Optimization，AI 搜索引擎优化，确保站点内容被 AI 引擎发现和引用 |
| PBKDF2 | 密码哈希算法，用于安全存储管理员密码 |
| RBAC | 基于角色的访问控制，后台页面按角色权限控制访问 |
| CSP nonce | 内容安全策略随机数，防止 XSS 注入攻击 |
