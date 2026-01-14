import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useChainConfig } from '../state/useChainConfig'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { web3Accounts, web3Enable } from '@polkadot/extension-dapp'

type VerifyState = 'idle' | 'verifying' | 'granted' | 'denied' | 'error'

const ARWEAVE_GATEWAY = 'https://arweave.net/'
const BOOKS: Record<number, { txId: string }> = {
  1: { txId: 'uxtt46m7gTAAcS9pnyh8LkPErCr4PFJiqYjQnWcbzBI' }
}

export default function Success() {
  const [params] = useSearchParams()
  const bookIdRaw = params.get('book_id') ?? ''
  const arTxId = params.get('ar') ?? ''
  const { config } = useChainConfig()
  const [address, setAddress] = useState<string>('')
  const [state, setState] = useState<VerifyState>('idle')
  const [message, setMessage] = useState<string>('')
  const [matrixId, setMatrixId] = useState<string>('')
  const [inviteStatus, setInviteStatus] = useState<string>('')
  const [isInviting, setIsInviting] = useState(false)

  const bookId = useMemo(() => {
    const n = Number(bookIdRaw)
    return Number.isFinite(n) ? n : null
  }, [bookIdRaw])

  useEffect(() => {
    ;(async () => {
      try {
        const exts = await web3Enable('Whale Vault DApp')
        if (!exts || exts.length === 0) {
          setMessage('未检测到钱包扩展')
          return
        }
        let addr = ''
        try {
          addr = localStorage.getItem('selectedAddress') || ''
        } catch {}
        if (!addr) {
          const accs = await web3Accounts()
          addr = accs[0]?.address ?? ''
        }
        setAddress(addr)
      } catch {
        setMessage('钱包初始化失败')
      }
    })()
  }, [])

  const verifyAccess = async () => {
    if (!address || bookId === null) {
      setState('error')
      setMessage('缺少地址或书籍编号')
      return
    }
    if (!config.contractAddress || !config.abiUrl) {
      setState('error')
      setMessage('未配置合约地址或 ABI')
      return
    }
    try {
      setState('verifying')
      setMessage('')
      const api = await ApiPromise.create({ provider: new WsProvider(config.endpoint) })
      const res = await fetch(config.abiUrl)
      const abi = await res.json()
      const contract = new ContractPromise(api, abi, config.contractAddress)
      const query = await contract.query.has_access(address, { value: 0, gasLimit: -1 }, address, bookId)
      if (query.result.isErr) {
        setState('error')
        setMessage('查询失败')
        return
      }
      let granted = false
      const out = query.output?.toJSON() as any
      if (typeof out === 'boolean') {
        granted = out
      } else if (out && typeof out === 'object') {
        if (typeof out.ok === 'boolean') granted = out.ok
        if (typeof out.Ok === 'boolean') granted = out.Ok
      }
      if (granted) {
        setState('granted')
        setMessage('已验证访问权限')
      } else {
        setState('denied')
        setMessage('未获得访问权限')
      }
    } catch {
      setState('error')
      setMessage('网络或合约错误')
    }
  }

  const handleJoinMatrix = async () => {
    if (!matrixId.includes(':')) {
      setInviteStatus('请输入完整的 Matrix ID (如 @user:matrix.org)')
      return
    }

    setIsInviting(true)
    setInviteStatus('正在请求邀请...')

    try {
      const response = await fetch('http://192.168.47.128:8080/api/matrix/test-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrixId, address })
      })

      if (response.ok) {
        setInviteStatus('✅ 邀请已发送！请检查 Element 通知')
      } else {
        const data = await response.json()
        setInviteStatus(`❌ 失败: ${data.error || '服务器错误'}`)
      }
    } catch (err) {
      setInviteStatus('❌ 无法连接到后端 Relay Server')
    } finally {
      setIsInviting(false)
    }
  }

  const arweaveUrl = useMemo(() => {
    if (arTxId) {
      return `${ARWEAVE_GATEWAY}${arTxId}`
    }
    if (bookId !== null) {
      const meta = BOOKS[bookId]
      if (meta?.txId) {
        return `${ARWEAVE_GATEWAY}${meta.txId}`
      }
    }
    return ''
  }, [arTxId, bookId])
  const matrixUrl = 'https://matrix.to/#/#whale-vault:matrix.org'

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex flex-col items-center">
        <div className="relative">
          <div className="h-40 w-40 md:h-56 md:w-56 rounded-full bg-gradient-to-tr from-accent via-primary to-white/60 shadow-glow" />
          <div className="absolute inset-0 blur-2xl rounded-full bg-primary/10" />
        </div>
        <h1 className="text-2xl font-semibold mt-6">恭喜完成 Mint</h1>
        <p className="text-white/70 text-sm mt-2">你的 NFT 勋章已铸造成功</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6 mt-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-white/70">当前账户</div>
            <div className="font-mono text-sm break-all">{address || '未连接'}</div>
          </div>
          <div>
            <div className="text-sm text-white/70">书籍编号</div>
            <div className="font-mono text-sm">{bookIdRaw || '缺失'}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-b border-white/5 pb-6">
          <button
            className="rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary px-4 py-2 transition shadow-glow"
            onClick={verifyAccess}
            disabled={state === 'verifying' || state === 'granted'}
          >
            {state === 'verifying' ? '验证中...' : state === 'granted' ? '验证通过' : '验证访问权限'}
          </button>
          {message && <span className="text-sm text-white/70">{message}</span>}
        </div>

        {state === 'granted' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="p-4 rounded-lg bg-accent/5 border border-accent/20">
              <h3 className="text-sm font-bold text-accent mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                解锁私域社群权益
              </h3>

              <div className="space-y-3">
                <input
                  type="text"
                  value={matrixId}
                  onChange={(e) => setMatrixId(e.target.value)}
                  placeholder="@username:matrix.org"
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent/50 transition"
                />
                <button
                  onClick={handleJoinMatrix}
                  disabled={isInviting}
                  className="w-full bg-accent/30 hover:bg-accent/50 border border-accent/50 text-white font-medium py-2 rounded-lg transition shadow-glow disabled:opacity-50"
                >
                  {isInviting ? '处理中...' : '立即加入 Matrix 私域群'}
                </button>
                {inviteStatus && (
                  <p className={`text-xs text-center ${inviteStatus.includes('✅') ? 'text-emerald-400' : 'text-accent/80'}`}>
                    {inviteStatus}
                  </p>
                )}
              </div>
            </div>

            {arweaveUrl && (
              <a
                href={arweaveUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-center rounded-lg bg-emerald-400/10 hover:bg-emerald-400/20 border border-emerald-400/30 text-emerald-300 px-4 py-2 transition"
              >
                📖 阅读 Arweave 链上正文
              </a>
            )}
          </div>
        )}

        {state === 'denied' && <div className="text-sm text-red-400">验证未通过，请确认持有权限</div>}

        <div className="pt-2 flex flex-wrap gap-3">
          <Link
            to="/scan"
            className="inline-flex items-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/20 px-4 py-2 text-sm text-white/80 transition"
          >
            ← 继续扫码下一本
          </Link>
          <Link
            to="/"
            className="inline-flex items-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/20 px-4 py-2 text-sm text-white/80 transition"
          >
            返回首页
          </Link>
          <a
            href={matrixUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg bg-accent/30 hover:bg-accent/50 border border-accent/50 text-white px-4 py-2 text-sm transition shadow-glow"
          >
            直接进入 Matrix 私域社群
          </a>
        </div>
      </div>
    </div>
  )
}
 
