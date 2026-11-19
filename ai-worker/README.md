# 通义千问接入

原日报网页通过 Worker 调用硅基流动的免费模型 Qwen/Qwen2.5-7B-Instruct。网页只上传「工作简述」里的文字。Worker 生成事项和建议时间，网页沿用原来的预览、追加保存、重复检查和备份功能。日报历史和姓名仍由网页本地读取。

## 开通

1. 在 [硅基流动](https://cloud.siliconflow.cn/account/ak) 登录，新建 API Key。可先到[模型广场](https://cloud.siliconflow.cn/open/models?types=chat)核对 Qwen/Qwen2.5-7B-Instruct 当前仍标为 Free。
2. 在本目录运行 `npx wrangler login`，在浏览器里用自己的 Cloudflare 账号授权，然后运行 `npx wrangler deploy`。初次部署缺少密钥时接口会返回未配置。
3. 运行 `npx wrangler secret put SILICONFLOW_API_KEY`，在命令提示中粘贴硅基流动密钥。运行 `npx wrangler secret put AI_ACCESS_TOKEN`，输入单独生成的访问口令，例如用 `openssl rand -hex 24` 生成。口令与 API Key 用途不同，口令填在日报网页的 AI 区域。两者都只在 Wrangler 的输入提示中设置，避免写入代码、命令参数或聊天。
4. 将首页 `index.html` 中 `aiSection` 的 `data-endpoint` 设为部署所得的 HTTPS Worker 地址加 `/generate`，随网页发布。仅填 URL。空值时不显示 AI 区域。当前 Worker 只允许来自原日报网站的网页请求，并校验独立口令。
5. 在线上原网址输入一段测试用工作简述，检查生成和时间预览。使用正式记录前先核对日期和估排时段。

Worker 固定使用上述模型，无付费模型回退。每次生成一次请求，限流是每个 Cloudflare 节点约每分钟六次。免费模型开放情况和用量限制由硅基流动决定。

## 本地验证

在项目根目录运行 `node --test tests/*.test.cjs`。AI 测试模拟模型 API，覆盖额度限制、无效响应、时间安排、失败重试和预览保存。测试无需真实密钥。
