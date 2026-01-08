# Whale Vault DApp / NFT 金库收银台

Whale Vault 是一个围绕 **实体书 Secret Code** 的 NFT 金库与收银台 DApp，面向读者、作者和出版社三方：

- 读者：通过扫码 + 铸造 NFT 解锁 Arweave 正文、Matrix 私域社群等数字权益
- 作者 / 出版社：在管理后台查看销量、财务数据，一键提现和批量导入授权
- 平台方：运行 Go 中间层为用户提供 **免 Gas 元交易**，并做风控与统计

本仓库包含：

- 前端：React + Vite + Tailwind CSS 单页应用
- 钱包与链交互：Polkadot{.js} 扩展 + `@polkadot/api` / `@polkadot/api-contract`
- 后端：Go 实现的元交易 Relay Server + Redis 统计

---

## 1. 功能总览

### 1.1 收银台（读者侧）

完整用户流：**填写地址 + Secret Code → 普通 / 免 Gas Mint → 成功页 → 解锁内容 / 继续下一本**。

- 填写页 `/scan`
  - 不再调用摄像头与扫码组件，改为**表单输入**
  - 表单包含：
    - 波卡钱包地址（必填）
    - Secret Code（如有，可从实体书抄写或线下扫码得到）
  - 地址强校验：
    - 拦截以 `0x` 开头的 EVM 地址
    - 使用 `@polkadot/util-crypto` 的 `decodeAddress` 校验 Base58 / Substrate 地址合法性
  - 智能地址转换：
    - 支持输入任意合法 Substrate 地址（例如以 `5` 开头的通用地址）
    - 前端自动转换为以 `1` 开头的 Polkadot 主网地址：`encodeAddress(decodeAddress(input), 0)`
    - 转换后的地址会带入后续 Mint 流程
  - 表单提交后跳转 `/mint-confirm?code=...&recipient=...`

- 支付 Mint 页 `/mint-confirm`
  - 展示当前 Secret Code 与可选参数（如 `book_id`、`ar`）
  - 不强制用户一开始就连接钱包；支持“直接填接收地址”完成免 Gas
  - 两种铸造方式：
    - 使用钱包直接 Mint：调用 Polkadot{.js} 钱包，向 Ink! 合约发送 `mint(code)` 交易（用户自费 Gas）
    - 免 Gas 铸造：用户输入“接收地址”，前端编码合约调用数据并 POST `/relay/mint`，由后端代付 Gas 完成交易
  - 支持加载状态：发送中 / 区块确认中 / 错误提示
  - 铸造成功后自动跳转到成功页 `/success`

- 成功展示页 `/success`
  - 展示一个 NFT 勋章占位图和简洁的祝贺文案
  - 展示当前钱包地址与 `book_id`
  - 点击「验证访问权限」调用合约只读方法 `has_access(address, book_id)`
  - 验证通过后展示：
    - Arweave 资源链接：`https://arweave.net/{TX_ID}`
    - Matrix 私域社群入口
  - 提供「继续扫码下一本」按钮，跳回 `/scan`

### 1.2 管理后台（作者 / 出版社）

管理后台挂在 `/admin` 路由下，采用侧边栏布局，包含：

- 数据总览 `/admin/overview`
  - 卡片展示：
    - 累计销售额
    - 已 Mint 数量
    - 当前可提现余额
  - 使用 Mock 数据 + 可选链上统计进行组合展示

- 销量监控看板 `/admin/monitor`
  - 数据卡片：总销售额、已铸造 NFT 数量、待提现余额
  - 趋势图表：使用 Recharts 绘制近 30 天销售增长曲线
  - 明细表：展示最近 Mint 记录（时间、book_id、用户地址缩略、状态）
  - 可从后端 `/metrics/mint` 或合约只读方法拉取统计，并与 Mock 数据叠加

- 销量明细 `/admin/sales`
  - 表格列出每笔 Mint 记录
  - 包含时间戳、book_id、交易哈希等
  - 目前以 Mock 数据为主，可平滑切换到真实后端

- 财务提现 `/admin/withdraw`
  - 展示当前账户在合约中的「可提取余额」
  - 点击「立即提现」时：
    - 调用 Polkadot{.js} 钱包，签名执行合约 `pull_funds()`
    - 显示发送与区块确认状态
    - 提现成功后触发前端 Confetti（纸屑特效）
    - 自动刷新可提余额

- 批次创建 `/admin/batch`
  - 支持导入 CSV 文件批量配置授权：
    - 每行结构：`book_id, secret_code`
  - 前端自动对 Secret Code 计算 SHA-256 哈希（使用浏览器 `crypto.subtle.digest`）
  - 组装参数并调用合约 `add_book_batch(ids, hashes)`，实现一次性写入链上

---

## 2. 技术栈与架构

### 2.1 前端

- React 18
- Vite
- React Router v7（`react-router-dom`）
- Tailwind CSS
- Polkadot 相关：
  - `@polkadot/api`
  - `@polkadot/api-contract`
  - `@polkadot/extension-dapp`
  - `@polkadot/util-crypto` / `@polkadot/util`（地址解析与网络前缀转换）
- 图表：`recharts`
- 特效：`canvas-confetti`

主要结构：

- `src/App.tsx`：路由入口
  - `/` 首页（入口卡片 + 简要销量看板）
  - `/scan` 扫码页
  - `/mint-confirm` 支付 / 元交易确认页
  - `/success` 成功 + 解锁内容页
  - `/settings` 链配置页
  - `/admin/*` 管理后台布局与子路由

- 钱包相关
  - `src/hooks/usePolkadotWallet.ts`：统一封装 Polkadot{.js} 扩展连接与账户选择
  - `src/components/NavBar.tsx`：连接 / 断开钱包按钮 + 账户选择器

- 链配置
  - `src/state/useChainConfig.ts`:
    - `endpoint`：节点 WebSocket 地址（默认 `wss://ws.azero.dev`）
    - `contractAddress`：Ink! 合约地址
    - `abiUrl`：ABI JSON 文件 URL
    - 持久化到 `localStorage.chainConfig`

- 后端地址配置
  - `src/config/backend.ts`:
    - `export const BACKEND_URL = 'http://localhost:8080'`
    - 用于元交易中间层和监控接口

### 2.2 后端（Middle-layer / Relay Server）

位置：`backend/main.go`

当前 Demo 职责：

- 接收前端编码后的合约调用数据（当前为 `mint(code)` 的 dataHex）
- 校验与解析请求体（包含 `dest` / `dataHex` / `signer` / `codeHash`）
- 对每个 IP 做简单限流与封禁检查
- 基于 `codeHash`（Secret Code 的 SHA-256）做**唯一性锁**，防止同一兑换码被并发或重复刷接口
- 写入成功的 Mint 日志到 Redis（`mint:logs`），供前端销量看板查询

依赖：

- `github.com/gorilla/mux`
- `golang.org/x/time/rate`
- `github.com/redis/go-redis/v9`
- （预留）`github.com/centrifuge/go-substrate-rpc-client/v4` 用于接入真实链上调用

---

## 3. 安装与运行

### 3.1 前端 DApp

#### 安装依赖

```bash
npm install
```

#### 开发模式

```bash
npm run dev
```

默认通过 Vite 启动开发服务器（通常是 `http://localhost:5173`）。

#### 打包构建

```bash
npm run build
```

产物输出到 `dist/` 目录，可使用任意静态服务器托管。

### 3.2 后端 Relay Server

#### 前置依赖

- Go 1.20+
- Redis 实例（本地或远程）

#### 环境变量

- `REDIS_ADDR`（可选）
  - Redis 地址，默认 `127.0.0.1:6379`

> 说明：当前 `main.go` 中尚未接入真实 WebSocket 节点与链上签名逻辑，如需将 Demo 升级为真正代付 Gas 的 Relay Server，可基于 go-substrate-rpc-client 扩展新增：
>
> - `WS_ENDPOINT`：链的 WebSocket 节点（如 `wss://ws.azero.dev`）
> - `RELAYER_SEED`：平台方代付 Gas 的账户种子（sr25519）

#### 启动后端

```bash
cd backend
go run main.go
```

默认监听：`http://localhost:8080`

同时应用了宽松的 CORS 设置，方便前端本地调试。

---

## 4. 前端主要页面说明

### 4.1 首页 `/`

- 文件：`src/pages/Home.tsx`
- 功能：
  - 左侧卡片：项目简介 + 「扫描 Secret Code」按钮（跳转 `/scan`）
  - 右侧卡片：可扩展的销量展示组件（`SalesBoard`）

### 4.2 填写页 `/scan`

- 文件：`src/pages/Scan.tsx`
- 功能：
  - 作为读者入口页，替代原来的扫码 UI
  - 提供表单输入：
    - 波卡钱包地址（必填）
    - Secret Code（如有）
  - 地址校验与智能转换：
    - 使用 `decodeAddress` 判断地址是否合法
    - 自动将任意合法 Substrate 地址转换为以 `1` 开头的 Polkadot 主网地址
  - 表单提交后跳转：`/mint-confirm?code={encodedCode}&recipient={normalizedAddress}`

### 4.3 Mint 确认页 `/mint-confirm`

- 文件：`src/pages/MintConfirm.tsx`
- 功能：
  - 展示从 URL 中解析的 `code` 与可选参数 `book_id`、`ar`
  - 不强制连接钱包：提供钱包下载 / 使用说明（推荐 Talisman / SubWallet）与“接收地址”输入框
  - 地址处理：
    - 复用 `decodeAddress` / `encodeAddress`，确保使用 Polkadot 主网地址参与铸造
    - 从 `/scan` 透传的 `recipient` 自动填入，也可手工修改
  - 二次确认弹窗：
    - 在调用后端 `/relay/mint` 之前，弹出 Modal：
      - 清晰展示最终将用于铸造的 `1` 开头地址
      - 如发生地址格式转换，给出“已自动转换为波卡主网地址”的提示
      - 风险提示：“NFT 铸造后不可撤回，每个兑换码仅限使用一次”
    - 提供「返回修改」与「确认领取」按钮，并在确认后联动 Loading 状态
  - 按钮：
    - 「使用钱包直接 Mint」：通过扩展钱包调用合约 `mint(code)`（用户自费 Gas）
    - 「免 Gas 铸造」：填写接收地址后，前端编码 `mint(code)` 的 dataHex 并 POST `/relay/mint`，由后端代付 Gas（当前 Demo 为占位逻辑）
  - 状态展示：发送中 / 区块确认中 / 错误提示
  - 成功后自动跳转至 `/success?book_id=...&ar=...`

### 4.4 成功展示页 `/success`

- 文件：`src/pages/Success.tsx`
- 功能：
  - 展示 NFT 勋章占位图与成功文案
  - 从 URL 中读取：
    - `book_id`：书籍编号
    - `ar`：Arweave 交易 ID（如存在则优先使用）
  - 读取当前钱包地址（优先使用 `localStorage.selectedAddress`）
  - Arweave 映射与网关：
    - 常量 `ARWEAVE_GATEWAY = "https://arweave.net/"`
    - 内置 `BOOKS` 映射：`book_id → txId`（例如 Book 1 映射为 `uxtt46m7gTAAcS9pnyh8LkPErCr4PFJiqYjQnWcbzBI`）
    - 计算规则：`arTxId ? ARWEAVE_GATEWAY + arTxId : ARWEAVE_GATEWAY + BOOKS[book_id].txId`
  - 按钮：
    - 「验证访问权限」：调用合约 `has_access(address, book_id)`
    - 验证通过后：
      - 显示「打开 Arweave 内容」按钮（新窗口）
      - 显示「进入 Matrix 私域社群」入口
    - 验证失败时给出错误提示
  - 「继续扫码下一本」：`<Link to="/scan">`，引导用户进入下一次收银流程

### 4.5 管理后台

- 布局：
  - `src/admin/AdminLayout.tsx`：侧边栏 + 嵌套路由结构

- 子页面：
  - `src/admin/OverviewPage.tsx`：数据总览
  - `src/admin/MonitorPage.tsx`：销量监控看板（图表 + 明细）
  - `src/admin/SalesPage.tsx`：销量明细列表
  - `src/admin/WithdrawPage.tsx`：财务提现
  - `src/admin/BatchPage.tsx`：批次创建（CSV 导入 + SHA-256 + add_book_batch）

---

## 5. 钱包与链配置

### 5.1 链参数配置

- 页面：`/settings`
- Hook：`useChainConfig`（`src/state/useChainConfig.ts`）
- 字段：
  - `endpoint`：节点 WebSocket 地址
  - `contractAddress`：Ink! 合约地址
  - `abiUrl`：ABI JSON 文件地址
- 配置保存到 `localStorage.chainConfig`，前端所有合约调用均依赖此配置。

### 5.2 钱包连接与账户选择

- Hook：`usePolkadotWallet`（`src/hooks/usePolkadotWallet.ts`）
- 功能：
  - 调用 `web3Enable('Whale Vault DApp')` 与 `web3Accounts()` 拉取扩展账户
  - 管理 `accounts` 列表与当前选中账户 `selected`
  - 支持切换账户与断开连接
  - 将选中的地址持久化到 `localStorage.selectedAddress`
  - 提供 `isConnected` 等布尔状态

导航栏组件 `NavBar` 通过该 Hook 实现：

- 「连接钱包」按钮：触发扩展授权
- 「断开」按钮：清空选择
- `AccountSelector`：展示并切换当前账户

---

## 6. 后端 HTTP 接口说明

### 6.1 POST `/relay/mint`

用途：免 Gas / 无签名的中继入口。当前 Demo 中，后端**不直接连接链节点**，而是：

- 接收前端编码好的 `mint(code)` 调用数据与接收地址
- 基于 Secret Code 的 SHA-256 哈希（`codeHash`）做唯一性锁防刷
- 生成占位用的 `txHash`，写入 Redis 日志，供前端看板展示

未来可在此基础上接入真实链节点，由后端使用平台账户代用户发送交易、代付 Gas。

#### 请求体（JSON）

```json
{
  "dest": "合约地址（SS58）",
  "value": "0",
  "gasLimit": "0",
  "storageDepositLimit": "字符串或 null",
  "dataHex": "0x 前缀的合约调用数据（当前为 mint(code) 的编码）",
  "signer": "用户地址（用于风控与日志）",
  "codeHash": "Secret Code 的 SHA-256 十六进制字符串"
}
```

> 说明：如需“签名 + mint_meta + 中继”的严格校验方案，可在前端改为对结构化消息进行签名并编码 `mint_meta(...)`，后端在验证签名与参数后，再调用链上合约并代付 Gas。

#### URL 查询参数

- `book_id`（可选）：书籍编号，用于日志记录与前端看板展示。

#### 响应体（JSON）

```json
{
  "status": "submitted" | "error",
  "txHash": "0x... 可选",
  "error": "错误信息，可选"
}
```

- `status = "submitted"`：成功提交到链上，`txHash` 为交易哈希（in-block 或 finalized 哈希）。
- `status = "error"`：请求不合法、频率超限或链上错误。

#### 风控机制

- 使用 `golang.org/x/time/rate` 为每个 IP 限速
- 使用 Redis 基于 `codeHash` 做唯一性锁：
  - 每个唯一的 Secret Code 哈希只允许成功铸造一次
  - 同一 `codeHash` 并发请求时，后续请求会收到“正在铸造中”的错误
  - 已成功的 `codeHash` 再次请求会收到“此书已经生成过 NFT 了”的错误
- 所有成功的 Mint 请求会记录到 Redis 列表 `mint:logs`（用于看板与明细）

### 6.2 GET `/metrics/mint`

用途：为前端管理后台提供 Mint 日志，用于构建销量图表和明细。

#### 响应样例

```json
[
  {
    "timestamp": 1710000000,
    "tx_hash": "0x1234...",
    "book_id": "1"
  },
  ...
]
```

前端可按时间排序、按 `book_id` 分组统计等。

---

## 7. 与合约的主要交互点

> 以下为前端使用到的合约接口名称，具体参数类型与链上实现需与实际 Ink! 合约保持一致。

- `mint(code: String)`
  - 用户自费 Gas 的铸造函数

- `mint_meta(signer, code, signature, nonce, deadline)`
  - 元交易版铸造函数
  - 前端对约定格式的消息签名，后端代付 Gas

- `has_access(address, book_id) -> bool`
  - 成功页中用于验证用户是否拥有访问该书籍内容的权限

- `pull_funds()`
  - 管理后台财务页调用
  - 将作者 / 出版社地址在合约中的可提现余额转出到当前账户

- `add_book_batch(ids: Vec<BookId>, hashes: Vec<Hash>)`
  - 批次创建页调用
  - 一次性写入多本书籍的授权哈希

- `get_withdrawable(address) -> Balance`（假定名称）
  - 用于查询某地址当前可提取余额
  - 前端在提现页只读调用，展示「当前地址可提取余额」

---

## 8. 典型使用流程（读者视角）

1. 打开 DApp，点击首页入口按钮进入 `/scan`
2. 在填写页中：
   - 填写或粘贴自己的波卡钱包地址（支持任意合法 Substrate 地址）
   - 将实体书上的 Secret Code 抄写到输入框（如有）
   - 提交后自动跳转到 `/mint-confirm?code=...&recipient=...`
3. 在确认页：
   - 可选择使用扩展钱包直接 Mint（用户自费 Gas）
   - 或不连接扩展，仅填写“接收地址”，点击「免 Gas 铸造」走中继流程
   - 在点击免 Gas 铸造时，会弹出二次确认弹窗：
     - 展示已转换为 `1` 开头的波卡主网地址
     - 提示 NFT 铸造不可撤回，每个兑换码仅限一次
4. 确认后，前端调用 `/relay/mint`，后端做唯一性锁校验并记录日志
5. 返回成功 → 自动跳转 `/success?book_id=...&ar=...`
6. 成功页点击「验证访问权限」，通过后：
   - 打开 Arweave 正文内容（优先用 `ar`，否则用 BOOKS 映射）
   - 加入 Matrix 私域社群
7. 如果有下一本书，点击「继续扫码下一本」（链接回 `/scan`）再次进入收银流程

---

## 9. 部署与上线（示例：Nginx + Go 后端）

### 9.1 构建前端静态资源

```bash
npm install
npm run build
```

构建完成后，前端静态文件位于 `dist/` 目录。

> 生产环境建议将 `src/config/backend.ts` 中的 `BACKEND_URL` 修改为后端真实公网地址（或同域反代）。

### 9.2 启动 Go Relay Server（可选但建议）

在服务器上准备好 Go 与 Redis，然后：

```bash
cd backend
export WS_ENDPOINT=wss://ws.azero.dev
export RELAYER_SEED="你的平台账户种子"
export REDIS_ADDR="127.0.0.1:6379"
go run main.go
```

默认监听 `:8080`。

### 9.3 使用 Nginx 托管前端并反向代理后端

将 `dist/` 上传到服务器（例如 `/var/www/whale-vault`），站点配置示例：

```nginx
server {
    listen 80;
    server_name your-domain-or-ip;
    root /var/www/whale-vault;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /relay/   { proxy_pass http://127.0.0.1:8080/relay/; }
    location /metrics/ { proxy_pass http://127.0.0.1:8080/metrics/; }
}
```

将前端 `BACKEND_URL` 指向同域地址（例如 `http://your-domain-or-ip`），避免跨域。

---

## 10. 典型使用流程（作者 / 出版社视角）

1. 打开 DApp，连接钱包，使用作者 / 出版社账户登录
2. 进入管理后台 `/admin/overview` 查看数据总览
3. 在 `/admin/monitor` 看板中观察近 30 天销量趋势与最新 Mint 明细
4. 在 `/admin/batch` 导入 CSV 文件，批量配置书籍授权：
   - `book_id,secret_code` → 前端计算 SHA-256 哈希 → 调用 `add_book_batch`
5. 在 `/admin/withdraw` 查看可提取余额，并点击「立即提现」调用 `pull_funds()` 将收益转入当前地址

---

## 11. 后续可扩展方向

本 README 基于当前实现状态总结，后续可以在此基础上扩展：

- 将 Mock 数据完全替换为真实链上统计与后端 `/metrics/mint`
- 为作者 / 出版社增加多角色权限控制
- 增加多链配置与热切换（例如在配置中支持多个预设网络）
- 为合约与后端接口补充单元测试与集成测试

