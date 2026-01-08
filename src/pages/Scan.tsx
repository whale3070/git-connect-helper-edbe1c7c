import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'

export default function Scan() {
  const navigate = useNavigate()
  const [recipient, setRecipient] = useState<string>('')
  const [code, setCode] = useState<string>('')
  const [error, setError] = useState<string>('')
  const base58LikeRegex = useMemo(() => /^[1-9A-HJ-NP-Za-km-z]+$/, [])

  const validateAddress = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return '地址不能为空'
    if (trimmed.startsWith('0x')) return '不支持以太坊地址，请使用波卡(Polkadot)地址'
    if (!base58LikeRegex.test(trimmed)) return '无效的波卡地址，请检查后重新输入'
    try {
      decodeAddress(trimmed)
    } catch {
      return '无效的波卡地址，请检查后重新输入'
    }
    return null
  }

  const normalizeToPolkadot = (addr: string) => {
    try {
      const pub = decodeAddress(addr.trim())
      const polkadotAddr = encodeAddress(pub, 0)
      return polkadotAddr
    } catch {
      return addr.trim()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateAddress(recipient)
    if (err) {
      setError(err)
      return
    }
    if (!code.trim()) {
      setError('请填写 Secret Code')
      return
    }
    setError('')
    const normalized = normalizeToPolkadot(recipient)
    navigate(`/mint-confirm?code=${encodeURIComponent(code.trim())}&recipient=${encodeURIComponent(normalized)}`)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold mb-4">填写信息领取 NFT</h1>
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-5">
        <div className="text-sm text-white/70">
          下载安装使用说明书：推荐安装{' '}
          <a href="https://talisman.xyz" target="_blank" rel="noreferrer" className="text-primary underline hover:text-primary/80">
            Talisman
          </a>{' '}
          或{' '}
          <a href="https://subwallet.app" target="_blank" rel="noreferrer" className="text-primary underline hover:text-primary/80">
            SubWallet
          </a>{' '}
          插件，妥善保存助记词，并复制以 1 开头的地址。
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <div className="text-sm text-white/70 mb-1">波卡钱包地址（必填）</div>
            <input
              className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary/60 font-mono text-sm"
              placeholder="请输入您的波卡钱包地址（以 1 开头）"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onBlur={() => {
                if (!recipient.trim()) return
                const err = validateAddress(recipient)
                if (err) {
                  setError(err)
                  return
                }
                const normalized = normalizeToPolkadot(recipient)
                setRecipient(normalized)
              }}
            />
          </div>
          <div>
            <div className="text-sm text-white/70 mb-1">Secret Code（如有）</div>
            <input
              className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary/60 font-mono text-sm"
              placeholder="请输入书上的兑换码或扫码得到的 Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <button
            type="submit"
            className="w-full rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary px-4 py-2 transition shadow-glow"
          >
            前往确认页
          </button>
        </form>
      </div>
    </div>
  )
}
