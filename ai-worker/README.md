# DeepSeek 接入

原日报网页通过 Worker 调用 DeepSeek 官方 API 的 `deepseek-flash`。只有走 AI 整理时，网页才发送这次录入的文字。按原文识别、历史记录、预览和保存均在浏览器内处理。

## 开通

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建官方 API 密钥并核对余额。模型用量记在该 DeepSeek 账户。参考[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。
2. 在现有 Worker 的「设置 → 运行时变量和密钥」中添加生产环境的加密密钥 `DEEPSEEK_API_KEY`，再发布 Worker。也可以在本目录运行 `npx wrangler login`，用自己的 Cloudflare 账号授权后用 `npx wrangler secret put DEEPSEEK_API_KEY` 配置现有 Worker。新建 Worker 时先部署到对应账号，再设置所需密钥。
3. 初次配置时用 `npx wrangler secret put AI_ACCESS_TOKEN` 设置独立访问口令，例如用 `openssl rand -hex 24` 生成。口令填在日报网页的 AI 区域，官方 API 密钥存入 Cloudflare。由硅基流动迁移时，可将原 `SILICONFLOW_API_KEY` 保留最长 30 天，用于验证此前签发的设备凭证。模型请求全部发送到 DeepSeek 官方 API。
4. 将首页 `index.html` 中 `aiSection` 的 `data-endpoint` 设为部署所得的 HTTPS Worker 地址加 `/generate`，随网页发布。仅填 URL。空值时不显示 AI 区域。当前 Worker 只允许来自原日报网站的网页请求，并校验独立口令。
5. 在线上原网址输入一段测试用工作简述，检查生成和时间预览。使用正式记录前先核对日期和估排时段。

Worker 固定使用上述模型，以非思考模式请求 JSON。每次生成发出一次模型请求，限流是每个 Cloudflare 节点约每分钟六次。

## 本地验证

管理员在 Cloudflare 为 Worker 配置独立的 `AI_ADMIN_TOKEN` 密钥，使用 24–128 位字母、数字、下划线或短横线。部署包含 `AI_APPROVALS` Durable Object 和 SQLite 迁移。管理员用同事发来的审批链接打开原日报网页，输入管理员口令批准；也可以从「管理授权」查看或撤销。

同事先在日常使用的浏览器点「申请 AI 权限」，再复制审批链接经微信转发。链接仅标识申请，领取凭证由原浏览器持有。申请 24 小时有效，授权从批准时起有效 180 天。服务端只存审批状态、时间和随机凭证的哈希，不存姓名、联系方式或日报。

在项目根目录运行 `node --test tests/*.test.cjs`。AI 测试模拟模型 API，覆盖额度限制、无效响应、时间安排、失败重试和预览保存。测试无需真实密钥。
