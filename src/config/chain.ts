// Conflux eSpace Testnet 配置
export const CHAIN_ID = 71
export const RPC_URL = 'https://evmtestnet.confluxrpc.com'
export const EXPLORER_URL = 'https://evmtestnet.confluxscan.io'
export const TREASURY_ADDRESS = "0x5E8de2503881a49ed4db721E4fbAfc106C3782E6";
export const DEPLOY_FEE_USDT = 10; // 人类单位
// BookFactory 合约地址 (已部署)
export const FACTORY_ADDRESS = '0xfd19cc70af0a45d032df566ef8cc8027189fd5f3'

// BookFactory ABI (仅包含前端需要的函数)
export const FACTORY_ABI = [
  // 读取函数
  {
    name: 'treasury',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  },
  {
    name: 'deployFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'totalBooks',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'deployedBooks',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256', name: 'index' }],
    outputs: [{ type: 'address' }]
  },
  {
    name: 'getPublisherBooks',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'publisher' }],
    outputs: [{ type: 'address[]' }]
  },
  {
    name: 'bookInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'bookContract' }],
    outputs: [
      { type: 'string', name: 'name' },
      { type: 'string', name: 'symbol' },
      { type: 'string', name: 'author' },
      { type: 'address', name: 'publisher' },
      { type: 'uint256', name: 'deployedAt' }
    ]
  },
  {
    name: 'getBookSales',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'bookContract' }],
    outputs: [{ type: 'uint256' }]
  },
  // 写入函数
  {
    name: 'deployBook',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { type: 'string', name: 'bookName' },
      { type: 'string', name: 'symbol' },
      { type: 'string', name: 'authorName' },
      { type: 'string', name: 'baseURI' },
      { type: 'address', name: 'relayer' }
    ],
    outputs: [{ type: 'address' }]
  },
  // 事件
  {
    name: 'BookDeployed',
    type: 'event',
    inputs: [
      { type: 'address', indexed: true, name: 'bookContract' },
      { type: 'address', indexed: true, name: 'publisher' },
      { type: 'string', name: 'name' },
      { type: 'string', name: 'symbol' },
      { type: 'string', name: 'author' }
    ]
  }
] as const

// =========================
// ERC20 (USDT) 配置
// =========================

// ✅ USDT 合约地址（Conflux eSpace Testnet 上的那个）
export const USDT_ADDRESS = "0x62b452bbb6a4530347002edccc742628f1431211";

// ✅ ERC20 ABI（只保留 balanceOf/decimals/symbol）
export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

