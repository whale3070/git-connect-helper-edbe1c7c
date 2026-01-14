import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useChainConfig } from '../state/useChainConfig'
import { BACKEND_URL } from '../config/backend'

type MintState = 'idle' | 'sending' | 'in-block' | 'finalized' | 'success' | 'error'

export default function MintConfirm() {
  const [params] = useSearchParams()
  const code = useMemo(() => params.get('code') ?? '', [params])
  const bookIdRaw = useMemo(() => params.get('book_id') ?? '', [params])
  const [state, setState] = useState<MintState>('idle')
  const [message, setMessage] = useState<string>('')
  const [recipient, setRecipient] = useState<string>(() => params.get('recipient') ?? '')
  const { config } = useChainConfig()
  const navigate = useNavigate()
  const [showConfirm, setShowConfirm] = useState<boolean>(false)
  const [confirmLoading, setConfirmLoading] = useState<boolean>(false)

  // 暴力破解：不再校验地址格式，允许 0x 穿透
  const validateAddress = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return '地址不能为空'
    return null 
  }

  const sha256Hex = async (text: string) => {
    const enc = new TextEncoder()
    const data = enc.encode(text)
    const digest = await crypto.subtle.digest('SHA-256', data)
    const bytes = new Uint8Array(digest)
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const buildSuccessPath = () => {
    const qs: string[] = []
    if (bookIdRaw) qs.push(`book_id=${encodeURIComponent(bookIdRaw)}`)
    return `/success${qs.length ? `?${qs.join('&')}` : ''}`
  }

  const handleMintGasless = async () => {
    if (!code) {
      setState('error'); setMessage('未获取到 Secret Code'); return
    }
    const err = validateAddress(recipient)
    if (err) {
      setState('error'); setMessage(err); return
    }
    // 直接进入确认环节，不再调用波卡钱包转换逻辑
    setShowConfirm(true)
  }

  const confirmAndSubmit = async () => {
    setConfirmLoading(true)
    try {
      setState('sending')
      const codeHash = await sha256Hex(code)
      
      // 物理接管：构造发送给 Go 后端的 Payload
      const payload = {
        dest: recipient.trim(), // 这里的 dest 将会是你的 0x 地址
        codeHash: codeHash,    // 对应 main.go 识别 hash-code.txt 的逻辑
        signer: recipient.trim()
      }

      const url = `${BACKEND_URL}/relay/mint${bookIdRaw ? `?book_id=${encodeURIComponent(bookIdRaw)}` : ''}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await resp.json()
      setConfirmLoading(false)
      setShowConfirm(false)

      if (resp.ok && (result.status === 'submitted' || result.status === 'success')) {
        setState('success')
        navigate(buildSuccessPath())
      } else {
        setState('error')
        setMessage(result.error || '后端逻辑未跑通')
      }
    } catch (e) {
      setConfirmLoading(false)
      setShowConfirm(false)
      setState('error')
      setMessage('网络请求失败')
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 text-white">
      <h1 className="text-xl font-semibold mb-6">Whale Vault 物理接管 Mint</h1>
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <p className="text-sm text-white/70 mb-2">当前 Secret Code:</p>
        <p className="text-base font-mono bg-black/30 p-2 rounded mb-6">{code || '无'}</p>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm text-white/70 mb-2 block">接收地址 (支持 0x 或波卡地址)</label>
            <input
              className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary"
              placeholder="请输入您的钱包地址"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>

          <button
            className="w-full rounded-lg bg-primary/80 hover:bg-primary py-3 font-bold transition shadow-glow"
            onClick={handleMintGasless}
            disabled={state === 'sending'}
          >
            {state === 'sending' ? '正在连接后端...' : '立即免 Gas 铸造'}
          </button>
          {message && <p className="text-center text-red-400 text-sm mt-2">{message}</p>}
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-full max-w-md rounded-xl border border-white/20 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-bold">最后确认</h2>
            <p className="text-sm text-gray-400">我们将使用 1.1 DEV 钱包为您代付 Gas</p>
            <div className="bg-black/40 p-3 rounded font-mono text-xs break-all">{recipient}</div>
            <div className="flex gap-3">
              <button className="flex-1 py-2 bg-gray-700 rounded" onClick={() => setShowConfirm(false)}>取消</button>
              <button className="flex-1 py-2 bg-primary rounded font-bold" onClick={confirmAndSubmit}>确认提交</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}