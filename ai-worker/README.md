# DeepSeek 接入

原日报网页通过 Worker 调用硅基流动的 DeepSeek V4.1 Flash。只有走 AI 整理时，网页才发送这次录入的文字。按原文识别、历史记录、预览和保存均在浏览器内处理。

## 开通

1. 在硅基流动核对 `deepseek-ai/DeepSeek-V4.1-Flash` 的计费规则和账户余额。已有 API Key 可继续使用，初次配置可新建。参考[模型广场](https://cloud.siliconflow.cn/open/models?types=chat)和[API 密钥](https://cloud.siliconflow.cn/account/ak)。
2. 在本目录运行 `npx wrangler login`，在浏览器里用自己的 Cloudflare 账号授权，然后运行 `npx wrangler deploy`。初次部署缺少密钥时接口会返回未配置。
3. 运行 `npx wrangler secret put SILICONFLOW_API_KEY`，在命令提示中粘贴硅基流动密钥。运行 `npx wrangler secret put AI_ACCESS_TOKEN`，输入单独生成的访问口令，例如用 `openssl rand -hex 24` 生成。口令与 API Key 用途不同，口令填在日报网页的 AI 区域。两者都只在 Wrangler 的输入提示中设置，避免写入代码、命令参数或聊天。
4. 将首页 `index.html` 中 `aiSection` 的 `data-endpoint` 设为部署所得的 HTTPS Worker 地址加 `/generate`，随网页发布。仅填 URL。空值时不显示 AI 区域。当前 Worker 只允许来自原日报网站的网页请求，并校验独立口令。
5. 在线上原网址输入一段测试用工作简述，检查生成和时间预览。使用正式记录前先核对日期和估排时段。

Worker 固定使用上述模型，以非思考模式请求 JSON。每次生成发出一次模型请求，限流是每个 Cloudflare 节点约每分钟六次。模型按硅基流动的用量规则计费。

## 本地验证

管理员在 Cloudflare 为 Worker 配置独立的 `AI_ADMIN_TOKEN` 密钥，使用 24–128 位字母、数字、下划线或短横线。部署包含 `AI_APPROVALS` Durable Object 和 SQLite 迁移。管理员用同事发来的审批链接打开原日报网页，输入管理员口令批准；也可以从「管理授权」查看或撤销。

同事先在日常使用的浏览器点「申请 AI 权限」，再复制审批链接经微信转发。链接仅标识申请，领取凭证由原浏览器持有。申请 24 小时有效，授权从批准时起有效 180 天。服务端只存审批状态、时间和随机凭证的哈希，不存姓名、联系方式或日报。

在项目根目录运行 `node --test tests/*.test.cjs`。AI 测试模拟模型 API，覆盖额度限制、无效响应、时间安排、失败重试和预览保存。测试无需真实密钥。
