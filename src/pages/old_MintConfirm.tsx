import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useChainConfig } from '../state/useChainConfig'
import { BACKEND_URL } from '../config/backend'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'

type VerifyState = 'idle' | 'verifying' | 'valid' | 'invalid'
type SubmitState = 'idle' | 'sending' | 'success' | 'error'

export default function MintConfirm() {
  const { hashCode: rawHashCode } = useParams()
  const hashCode = useMemo(() => {
    const raw = rawHashCode ?? ''
    try {
      return decodeURIComponent(raw).trim()
    } catch {
      return raw.trim()
    }
  }, [rawHashCode])
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [message, setMessage] = useState<string>('')
  const [recipient, setRecipient] = useState<string>('')
  const { config } = useChainConfig()
  const navigate = useNavigate()

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

  useEffect(() => {
    try {
      const addr = localStorage.getItem('selectedAddress')
      if (addr) setRecipient(addr)
    } catch {}
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        setVerifyState('verifying')
        setMessage('')
        if (!hashCode) {
          setVerifyState('invalid')
          setMessage('未获取到领取信息')
          return
        }
        const url = `${BACKEND_URL}/secret/verify?codeHash=${encodeURIComponent(hashCode)}`
        const resp = await fetch(url, { method: 'GET' })
        const body = await resp.json().catch(() => ({} as any))
        const ok = resp.ok && body?.ok === true
        setVerifyState(ok ? 'valid' : 'invalid')
        if (!ok) {
          setMessage('当前链接无效，无法领取')
        }
      } catch {
        setVerifyState('invalid')
        setMessage('领取资格验证失败')
      }
    })()
  }, [hashCode])

  const submit = async () => {
    if (verifyState !== 'valid') {
      setSubmitState('error')
      setMessage('当前链接无效，无法领取')
      return
    }
    const err = validateAddress(recipient)
    if (err) {
      setSubmitState('error')
      setMessage(err)
      return
    }
    if (!config.contractAddress || !config.abiUrl) {
      setSubmitState('error')
      setMessage('未配置合约地址或 ABI')
      return
    }
    try {
      setSubmitState('sending')
      setMessage('')
      const pub = decodeAddress(recipient.trim())
      const normalized = encodeAddress(pub, 0)
      const payload = {
        dest: config.contractAddress,
        value: '0',
        gasLimit: '0',
        storageDepositLimit: null as string | null,
        dataHex: '0x00',
        signer: normalized,
        codeHash: hashCode
      }
      const url = `${BACKEND_URL}/relay/mint`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const body = await resp.json().catch(() => ({} as any))
      if (!resp.ok) {
        setSubmitState('error')
        setMessage(typeof body?.error === 'string' ? body.error : '后端处理失败')
        return
      }
      if (body?.status === 'submitted') {
        setSubmitState('success')
        navigate('/success')
        return
      }
      setSubmitState('error')
      setMessage(typeof body?.error === 'string' ? body.error : '提交失败')
    } catch {
      setSubmitState('error')
      setMessage('提交失败，请稍后重试')
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      {verifyState === 'invalid' ? (
        <div className="min-h-[calc(100vh-120px)] flex items-center justify-center">
          <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-8 text-center space-y-4">
            <div className="text-xl font-semibold text-red-300">无法领取</div>
            <div className="text-sm text-white/70">{message || '当前链接无效或已失效'}</div>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/20 px-4 py-2 text-sm text-white/80 transition"
            >
              返回首页
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8 space-y-6">
          <div className="space-y-3">
            <h1 className="text-xl font-semibold">领取 NFT</h1>
            <div className="text-sm text-white/70">
              下载安装钱包：推荐{' '}
              <a href="https://talisman.xyz" target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80 underline">
                Talisman
              </a>{' '}
              或{' '}
              <a href="https://subwallet.app" target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80 underline">
                SubWallet
              </a>
              ，妥善保存助记词，并复制以 1 开头的波卡地址。
            </div>
          </div>

          {verifyState === 'verifying' ? (
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              正在验证领取资格...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm text-white/70">请输入您的波卡钱包地址</div>
                <input
                  className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary/60 font-mono text-sm"
                  placeholder="请输入您的波卡钱包地址（以 1 开头）"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  disabled={submitState === 'sending'}
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  className="rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary px-4 py-2 transition shadow-glow disabled:opacity-60"
                  onClick={submit}
                  disabled={submitState === 'sending' || verifyState !== 'valid'}
                >
                  {submitState === 'sending' ? '处理中...' : '确认领取'}
                </button>
                {message && <span className={`text-sm ${submitState === 'error' ? 'text-red-400' : 'text-white/70'}`}>{message}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
