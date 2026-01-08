import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useChainConfig } from '../state/useChainConfig'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { web3Enable, web3Accounts, web3FromAddress } from '@polkadot/extension-dapp'
import { BACKEND_URL } from '../config/backend'

type MintState = 'idle' | 'sending' | 'in-block' | 'finalized' | 'success' | 'error'

export default function MintConfirm() {
  const [params] = useSearchParams()
  const code = useMemo(() => params.get('code') ?? '', [params])
  const bookIdRaw = useMemo(() => params.get('book_id') ?? '', [params])
  const ar = useMemo(() => params.get('ar') ?? '', [params])
  const [state, setState] = useState<MintState>('idle')
  const [message, setMessage] = useState<string>('')
  const [recipient, setRecipient] = useState<string>('')
  const { config } = useChainConfig()
  const navigate = useNavigate()

  const buildSuccessPath = () => {
    const qs: string[] = []
    if (bookIdRaw) qs.push(`book_id=${encodeURIComponent(bookIdRaw)}`)
    if (ar) qs.push(`ar=${encodeURIComponent(ar)}`)
    return `/success${qs.length ? `?${qs.join('&')}` : ''}`
  }

  useEffect(() => {
    try {
      const addr = localStorage.getItem('selectedAddress')
      if (addr) {
        setRecipient(addr)
      }
    } catch {}
  }, [])

  const handleMint = async () => {
    if (!code) {
      setState('error')
      setMessage('未获取到 Secret Code')
      return
    }
    if (!config.contractAddress || !config.abiUrl) {
      setState('error')
      setMessage('未配置合约地址或 ABI')
      return
    }
    try {
      setState('sending')
      setMessage('')
      const provider = new WsProvider(config.endpoint)
      const api = await ApiPromise.create({ provider })
      const exts = await web3Enable('Whale Vault DApp')
      if (!exts || exts.length === 0) {
        setState('error')
        setMessage('未检测到钱包扩展')
        return
      }
      let address = ''
      try {
        address = localStorage.getItem('selectedAddress') || ''
      } catch {}
      if (!address) {
        const accs = await web3Accounts()
        address = accs[0]?.address ?? ''
      }
      if (!address) {
        setState('error')
        setMessage('未找到账户')
        return
      }
      const injector = await web3FromAddress(address)
      const res = await fetch(config.abiUrl)
      const abi = await res.json()
      const contract = new ContractPromise(api, abi, config.contractAddress)
      const queryRes = await contract.query.mint(address, { value: 0, gasLimit: -1, storageDepositLimit: null }, code)
      if (queryRes.result.isErr) {
        setState('error')
        setMessage('模拟执行失败')
        return
      }
      const gas = queryRes.gasRequired
      const stor = queryRes.storageDeposit?.isCharge ? queryRes.storageDeposit.asCharge : null
      const tx = contract.tx.mint({ value: 0, gasLimit: gas, storageDepositLimit: stor }, code)
      await new Promise<void>((resolve, reject) => {
        tx.signAndSend(address, { signer: injector.signer }, (result) => {
          if (result.status.isInBlock) {
            setState('in-block')
            setMessage(`已进入区块 ${result.status.asInBlock.toString()}`)
          } else if (result.status.isFinalized) {
            const failed = result.events.some(({ event }) => event.section === 'system' && event.method === 'ExtrinsicFailed')
            if (failed) {
              setState('error')
              setMessage('交易失败')
              reject(new Error('ExtrinsicFailed'))
            } else {
              setState('success')
              setMessage(`已最终确认 ${result.status.asFinalized.toString()}`)
              navigate(buildSuccessPath())
              resolve()
            }
          }
        }).catch((e) => {
          reject(e)
        })
      })
    } catch (e) {
      setState('error')
      setMessage('发送失败')
    }
  }

  const handleMintGasless = async () => {
    if (!code) {
      setState('error')
      setMessage('未获取到 Secret Code')
      return
    }
    if (!recipient) {
      setState('error')
      setMessage('请先填写接收地址')
      return
    }
    if (!config.contractAddress || !config.abiUrl) {
      setState('error')
      setMessage('未配置合约地址或 ABI')
      return
    }
    try {
      setState('sending')
      setMessage('')
      const api = await ApiPromise.create({ provider: new WsProvider(config.endpoint) })
      const res = await fetch(config.abiUrl)
      const abi = await res.json()
      const contract = new ContractPromise(api, abi, config.contractAddress)
      const msg = contract.abi.findMessage('mint')
      let dataHex = '0x00'
      if (msg) {
        const dataU8a = msg.toU8a([code])
        dataHex = '0x' + Array.from(dataU8a).map((b) => b.toString(16).padStart(2, '0')).join('')
      }
      const payload = {
        dest: config.contractAddress,
        value: '0',
        gasLimit: '0',
        storageDepositLimit: null as string | null,
        dataHex,
        signer: recipient
      }
      const url = `${BACKEND_URL}/relay/mint${bookIdRaw ? `?book_id=${encodeURIComponent(bookIdRaw)}` : ''}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!resp.ok) {
        setState('error')
        setMessage('后端处理失败')
        return
      }
      const { status, txHash } = await resp.json()
      if (status === 'submitted') {
        setState('in-block')
        setMessage(`已提交，交易哈希 ${txHash || ''}`)
        navigate(buildSuccessPath())
      } else {
        setState('error')
        setMessage('提交失败')
      }
    } catch {
      setState('error')
      setMessage('免 Gas 流程失败')
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-xl font-semibold mb-2">Mint 确认</h1>
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <p className="text-sm text-white/70 mb-4">Secret Code</p>
        <p className="text-base font-mono break-all">{code || '未识别到 Code'}</p>
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <div className="text-sm text-white/70">
              没有钱包？点击此处下载{' '}
              <a href="https://novawallet.io" target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80 underline">
                Nova Wallet
              </a>
              /
              <a href="https://subwallet.app" target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80 underline ml-1">
                SubWallet
              </a>
            </div>
            <div>
              <div className="text-sm text-white/70 mb-1">已安装钱包？请输入您的接收地址</div>
              <input
                className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary/60 font-mono text-sm"
                placeholder="粘贴或输入您的链上地址"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg bg-accent/30 hover:bg-accent/50 border border-accent/50 px-4 py-2 transition shadow-glow"
              onClick={handleMint}
              disabled={state === 'sending' || state === 'in-block'}
            >
              {state === 'sending' ? '发送中...' : state === 'in-block' ? '区块确认中...' : '确认 Mint'}
            </button>
            <button
              className="rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary px-4 py-2 transition shadow-glow"
              onClick={handleMintGasless}
              disabled={state === 'sending'}
            >
              免 Gas 铸造
            </button>
            {message && <span className="text-sm text-white/70">{message}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
