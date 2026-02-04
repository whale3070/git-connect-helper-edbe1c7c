import { useCallback, useState } from 'react'
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  formatEther,
  type Address,
  parseEventLogs,
  toHex,
  zeroAddress,
} from 'viem'
import { confluxESpaceTestnet } from 'viem/chains'
import { FACTORY_ADDRESS, FACTORY_ABI, RPC_URL, EXPLORER_URL } from '@/config/chain'

/**
 * Conflux eSpace Testnet chain config
 * - viem 自带 confluxESpaceTestnet，但你这里显式覆盖 id/rpcUrls，便于统一使用 RPC_URL
 */
const confluxTestnet = {
  ...confluxESpaceTestnet,
  id: 71,
  name: 'Conflux eSpace Testnet',
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
} as const

// 公共客户端（只读操作，走 RPC_URL）
const publicClient = createPublicClient({
  chain: confluxTestnet,
  transport: http(RPC_URL),
})

export type BookInfo = {
  address: Address
  name: string
  symbol: string
  author: string
  publisher: Address
  deployedAt: Date
  sales: bigint
}

/**
 * 更稳健的 EIP-1193 provider 获取：
 * - 不强制 MetaMask（Rabby/OKX/CB Wallet 等也会注入 window.ethereum）
 * - 避免 SSR/build 环境直接访问 window 报错
 */
function getEthereumProvider(): Window['ethereum'] | null {
  if (typeof window === 'undefined') return null
  return (window as any).ethereum ?? null
}

/**
 * 将常见钱包错误映射为更友好的文案
 */
function mapWalletError(err: any): string {
  const msg = err?.shortMessage || err?.message || String(err ?? '')

  // 用户拒绝授权 / 拒绝交易
  if (err?.code === 4001) return '用户取消了钱包操作'
  // MetaMask / 部分钱包：未连接或锁定
  if (/request accounts|eth_requestAccounts/i.test(msg)) return '请在钱包中授权连接'
  // 网络切换失败
  if (/switch|chain/i.test(msg) && /reject|denied|refuse/i.test(msg)) return '用户拒绝切换网络'
  // 兜底
  return msg || '操作失败'
}

/**
 * 尝试切换到 Conflux eSpace Testnet
 * - 若链不存在则自动 add
 */
async function ensureChain(ethereum: NonNullable<Window['ethereum']>) {
  const expectedId = confluxTestnet.id
  const expectedHex = toHex(expectedId) // 71 -> 0x47

  const currentChainId = (await ethereum.request({ method: 'eth_chainId' })) as string
  if (parseInt(currentChainId, 16) === expectedId) return

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: expectedHex }],
    })
  } catch (switchError: any) {
    // 4902: unknown chain
    if (switchError?.code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: expectedHex,
            chainName: confluxTestnet.name,
            rpcUrls: [RPC_URL],
            nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      })
      // add 后再切一次，某些钱包需要
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: expectedHex }],
      })
      return
    }
    throw switchError
  }
}

/**
 * 尝试从 receipt logs 解析“新书合约地址”
 * 说明：
 * - 你这里原来写的是 log.topics[0] === '0x...'，那是占位符，会导致永远解析不到
 * - 我用 viem 的 parseEventLogs 直接按 ABI 解析
 * - 事件名不确定：尝试几个常见名字；最终拿不到就返回 zeroAddress（前端可提示用户去浏览器查看）
 */
function tryExtractBookAddressFromReceipt(receipt: { logs: any[] }): Address {
  const eventNames = ['BookDeployed', 'DeployedBook', 'BookCreated'] as const

  for (const eventName of eventNames) {
    try {
      const parsed = parseEventLogs({
        abi: FACTORY_ABI as any,
        logs: receipt.logs as any,
        eventName: eventName as any,
      })

      // 找第一个匹配事件
      const first = parsed?.[0] as any
      if (!first?.args) continue

      // 常见字段名猜测：book / bookAddr / bookAddress / addr
      const candidate =
        first.args.book ||
        first.args.bookAddr ||
        first.args.bookAddress ||
        first.args.addr ||
        first.args.address

      if (candidate) return candidate as Address
    } catch {
      // ignore and try next eventName
    }
  }

  return zeroAddress
}

export function useBookFactory() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取部署费用
  const getDeployFee = useCallback(async (): Promise<string> => {
    const fee = (await publicClient.readContract({
      address: FACTORY_ADDRESS as Address,
      abi: FACTORY_ABI,
      functionName: 'deployFee',
    })) as bigint
    return formatEther(fee)
  }, [])

  // 获取总书籍数量
  const getTotalBooks = useCallback(async (): Promise<number> => {
    const total = (await publicClient.readContract({
      address: FACTORY_ADDRESS as Address,
      abi: FACTORY_ABI,
      functionName: 'totalBooks',
    })) as bigint
    return Number(total)
  }, [])

  // 获取出版社的书籍列表
  const getPublisherBooks = useCallback(async (publisher: Address): Promise<Address[]> => {
    const books = (await publicClient.readContract({
      address: FACTORY_ADDRESS as Address,
      abi: FACTORY_ABI,
      functionName: 'getPublisherBooks',
      args: [publisher],
    })) as Address[]
    return books
  }, [])

  // 获取书籍详情
  const getBookInfo = useCallback(async (bookAddress: Address): Promise<BookInfo> => {
    const [info, sales] = await Promise.all([
      publicClient.readContract({
        address: FACTORY_ADDRESS as Address,
        abi: FACTORY_ABI,
        functionName: 'bookInfo',
        args: [bookAddress],
      }),
      publicClient.readContract({
        address: FACTORY_ADDRESS as Address,
        abi: FACTORY_ABI,
        functionName: 'getBookSales',
        args: [bookAddress],
      }),
    ])

    const [name, symbol, author, publisher, deployedAt] = info as [
      string,
      string,
      string,
      Address,
      bigint,
    ]

    return {
      address: bookAddress,
      name,
      symbol,
      author,
      publisher,
      deployedAt: new Date(Number(deployedAt) * 1000),
      sales: sales as bigint,
    }
  }, [])

  /**
   * 部署新书（需要连接钱包）
   * - 不在 hook 顶层强制检测 window.ethereum，避免“页面一打开就报错”
   * - 仅在用户触发 deployBook 时才检测并提示
   */
  const deployBook = useCallback(
    async (params: {
      bookName: string
      symbol: string
      authorName: string
      baseURI: string
      relayer?: Address
    }): Promise<{ txHash: string; bookAddress: Address }> => {
      setIsLoading(true)
      setError(null)

      try {
        const ethereum = getEthereumProvider()
        if (!ethereum) {
          throw new Error('未检测到钱包（window.ethereum），请安装/打开 MetaMask 或其他 EVM 钱包扩展')
        }

        // 请求连接钱包
        const accounts = (await ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[]

        if (!accounts || accounts.length === 0) {
          throw new Error('未获取到钱包账户，请检查钱包是否已解锁并授权')
        }

        // 确保网络正确
        await ensureChain(ethereum)

        // 创建钱包客户端（写链）
        const walletClient = createWalletClient({
          chain: confluxTestnet,
          transport: custom(ethereum as any),
        })

        // 获取部署费用
        const deployFee = (await publicClient.readContract({
          address: FACTORY_ADDRESS as Address,
          abi: FACTORY_ABI,
          functionName: 'deployFee',
        })) as bigint

        // 发送部署交易
        const hash = await walletClient.writeContract({
          account: accounts[0] as Address,
          address: FACTORY_ADDRESS as Address,
          abi: FACTORY_ABI,
          functionName: 'deployBook',
          args: [
            params.bookName,
            params.symbol,
            params.authorName,
            params.baseURI,
            params.relayer || zeroAddress,
          ],
          value: deployFee,
        })

        // 等待交易确认
        const receipt = await publicClient.waitForTransactionReceipt({ hash })

        // 从事件日志中解析新书地址（如 ABI 里带 event）
        const bookAddress = tryExtractBookAddressFromReceipt(receipt as any)

        return { txHash: hash, bookAddress }
      } catch (err: any) {
        const message = mapWalletError(err)
        setError(message)
        throw new Error(message)
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  // 获取交易/地址的浏览器链接
  const getExplorerLink = useCallback(
    (txHashOrAddress: string, type: 'tx' | 'address' = 'tx') => {
      return `${EXPLORER_URL}/${type}/${txHashOrAddress}`
    },
    [],
  )

  return {
    isLoading,
    error,
    getDeployFee,
    getTotalBooks,
    getPublisherBooks,
    getBookInfo,
    deployBook,
    getExplorerLink,
  }
}

// 类型声明扩展：EIP-1193 Provider 的最小接口
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>
      on?: (event: string, handler: (...args: any[]) => void) => void
      removeListener?: (event: string, handler: (...args: any[]) => void) => void
    }
  }
}
