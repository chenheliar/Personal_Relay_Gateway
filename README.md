# Personal Gateway Pages Template

部署在 **Cloudflare Pages + Pages Functions + D1** 上的个人自用万能中转网关模板。

它已经包含：

- 路径前缀式 HTTP / HTTPS 中转
- `/admin` 可视化后台
- 账号密码登录
- D1 持久化存储
- OpenAI / Gemini / npm / Docker 常用预设
- 一条命令完成模板初始化

## 这次升级了什么

这份仓库现在已经是可复用的 **Pages 项目模板**：

- 加入了 `package.json`
- 加入了 `npm run setup` 初始化脚本
- 加入了 `.gitignore`
- 加入了 GitHub Actions 校验工作流
- 初始化脚本会自动：
  - 检查 Wrangler 登录状态
  - 创建 D1 数据库
  - 回填 `wrangler.toml`
  - 执行远端数据库迁移
  - 首次部署到 Cloudflare Pages

## 一键初始化

先安装依赖：

```bash
npm install
```

然后直接运行：

```bash
npm run setup -- --project my-gateway
```

如果你想自定义数据库名：

```bash
npm run setup -- --project my-gateway --database my-gateway-db
```

如果你只想创建 D1 和写回配置，先不部署：

```bash
npm run setup -- --project my-gateway --skip-deploy
```

## 运行结果

`npm run setup` 会完成这些动作：

1. 执行 `wrangler whoami`
2. 执行 `wrangler d1 create`
3. 自动把真实 `database_name` 和 `database_id` 写回 [wrangler.toml](D:\web\gpt-proxy\wrangler.toml)
4. 执行 [migrations/0001_init.sql](D:\web\gpt-proxy\migrations\0001_init.sql) 的本地迁移
5. 执行远端迁移
6. 执行 `wrangler pages deploy . --project-name <你的项目名>`

## 本地开发

```bash
npm run dev
```

本地语法检查：

```bash
npm run check
```

后续手动部署：

```bash
npm run deploy -- --project-name my-gateway
```

## 模板结构

```text
admin/                   管理后台页面
functions/               Pages Functions API 与代理入口
functions/_lib/          鉴权、代理、D1 工具函数
migrations/              D1 迁移
scripts/setup-template.mjs
.github/workflows/validate.yml
wrangler.toml
package.json
```

## 后台能力

后台路径是 `/admin`，支持：

- 初始化首个管理员
- 登录 / 退出登录
- 添加路由
- 编辑路由
- 删除路由
- 启用 / 停用路由
- 设置注入请求头
- 设置移除请求头
- 设置是否去掉挂载路径前缀

## 路由示例

如果配置：

- 挂载路径：`/openai`
- 目标地址：`https://api.openai.com`
- 去前缀：开启

那么：

```text
https://your-domain.com/openai/v1/chat/completions
=> https://api.openai.com/v1/chat/completions
```

## 当前适用范围

这套模板适合：

- OpenAI API
- Gemini API
- npm registry
- Docker Registry HTTP API
- 其他 REST / SSE / 上传下载 / 包管理镜像类 HTTP 服务

这套模板不适合：

- 原始 TCP
- UDP
- 非 HTTP 协议直通

如果你未来要做真正“全协议”网关，需要改为 Cloudflare Workers 其他形态，或者换 Tunnel / VPS / 反向代理方案。

## 关于“Deploy to Cloudflare”按钮

我帮你核对了 Cloudflare 官方文档。当前官方的 **Deploy to Cloudflare** 按钮是给 **Workers** 用的，不是给 **Pages** 用的。

官方文档：

- Deploy buttons: [developers.cloudflare.com/workers/platform/deploy-buttons/](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- Pages Wrangler configuration: [developers.cloudflare.com/pages/functions/wrangler-configuration/](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- Pages API reference: [developers.cloudflare.com/pages/functions/api-reference/](https://developers.cloudflare.com/pages/functions/api-reference/)

所以这份仓库采用的是更适合 Pages 的“模板仓库 + 单命令初始化部署”方案，而不是伪造一个实际上不可用的按钮。

## 关键文件

- Pages 入口与 API：[functions/[[path]].js](D:\web\gpt-proxy\functions\[[path]].js)
- 代理逻辑：[functions/_lib/proxy.js](D:\web\gpt-proxy\functions\_lib\proxy.js)
- 认证逻辑：[functions/_lib/auth.js](D:\web\gpt-proxy\functions\_lib\auth.js)
- 管理后台页面：[admin/index.html](D:\web\gpt-proxy\admin\index.html)
- 后台脚本：[admin/app.js](D:\web\gpt-proxy\admin\app.js)
- 数据库迁移：[migrations/0001_init.sql](D:\web\gpt-proxy\migrations\0001_init.sql)
- 一键初始化脚本：[scripts/setup-template.mjs](D:\web\gpt-proxy\scripts\setup-template.mjs)

## 仓库发布建议

如果你准备把它作为自己的模板仓库使用，建议：

1. 把这个仓库推到 GitHub
2. 在 GitHub 中启用 `Use this template`
3. 每次新项目都从模板新建仓库
4. 新仓库拉下来后直接运行 `npm install` 和 `npm run setup -- --project <name>`
