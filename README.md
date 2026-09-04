# 岩馆换线日历 H5

公开浏览合作岩馆的已发布换线安排，并按单个有效合作岩馆查看场馆资料、上次开放、线龄与下次计划。项目包含移动端 React 页面及只读 BFF；浏览器不包含、也不会请求飞书凭证或 Base 信息。

## 本地启动

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。前端通过 Vite 代理请求本地 BFF，BFF 默认运行在 `http://localhost:8787`。

## API

```text
GET /api/v1/route-calendar?city=上海&from=2026-08-01&to=2026-08-31&keyword=攀岩馆&page=1&pageSize=20
```

支持 `city`、`from`、`to`、`keyword`、`page` 和 `pageSize` 参数；`pageSize` 最大为 100。响应仅含公开字段，按开始日期升序，未设开始日期的记录排在最后并按最后更新时间倒序。

## Mock 与真实数据

未配置服务端数据适配层时，`src/server/routeCalendar.ts` 会返回 mock 数据，页面可完整演示加载、筛选、日历、详情和无图片状态。

要接入真实数据：

1. 在飞书开发者后台创建或选择自建应用，在“基础信息 > 凭证与基础信息”获取 `App ID` 和 `App Secret`。
2. 复制 `.env.example` 为 `.env`，只在服务端填写 `LARK_APP_ID`、`LARK_APP_SECRET`、`LARK_APP_TOKEN`、`LARK_TABLE_ID`、`LARK_PARTNER_TABLE_ID`。
3. 为应用申请 Base 只读权限与“下载云文档中的图片和附件”权限，并将“换线发布”Base 授权给该应用。
4. BFF 自动申请并缓存短期 `tenant_access_token`，完整读取“换线发布”数据表，在代码中仅保留“对外展示状态”为“已发布”的记录；同时读取“合作岩馆库”中合作状态为“有效合作”的记录。

合作岩馆公开数据仅包含名称、别名、城市、区域或商圈、地址、场馆项目、难度体系与预约或主页链接；不得读取或返回运营对接人、运营备注、合作状态、换线记录的对外展示状态，也不得将任何飞书 Token、表 ID、字段 ID 写入前端包。

## 构建

```bash
npm run build
```

## 线上部署（GitHub + Vercel）

Vercel 会将 `dist` 作为静态 H5，同时把 `api/v1/route-calendar.ts` 作为动态 Serverless API。因此访问者始终使用同一个 Vercel 链接，但每次页面加载及页面运行期间的每 60 秒，都会从飞书多维表格读取最新的公开数据。

在 Vercel 项目设置的 **Environment Variables** 中配置以下五项（Production、Preview、Development 均按需要启用）：

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_APP_TOKEN
LARK_TABLE_ID
LARK_PARTNER_TABLE_ID
```

不要在前端变量中使用 `VITE_` 前缀，也不要把真实值提交到 GitHub。`.env.example` 仅列出需要的字段名，`.env` 已在 Git 忽略列表中。

将 GitHub 仓库导入 Vercel 后，Vercel 会在每次推送默认分支时自动更新部署；固定的生产链接无需改变。
