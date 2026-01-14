import React, { useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { BACKEND_URL } from '../config/backend'

type MintState = 'idle' | 'sending' | 'success' | 'error'

export default function MintConfirm() {
  // 1. 物理接管：获取 URL 路径中的 hashCode
  const { hashCode } = useParams() 
  const [params] = useSearchParams()
  
  const code = useMemo(() => hashCode || params.get('code') || '', [hashCode, params])
  const bookIdRaw = useMemo(() => params.get('book_id') ?? '1', [params])
  
  const [state, setState] = useState<MintState>('idle')
  const [message, setMessage] = useState<string>('')
  const [recipient, setRecipient] = useState<string>(() => params.get('recipient') ?? '')
  const navigate = useNavigate()
  const [showConfirm, setShowConfirm] = useState<boolean>(false)
  const [confirmLoading, setConfirmLoading] = useState<boolean>(false)

  const validateAddress = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return '请输入接收地址'
    if (!trimmed.startsWith('0x')) return '请输入有效的 EVM 地址 (0x 开头)'
    return null 
  }

  // 修改后的 sha256Hex：修复非 HTTPS 环境下的 crypto.subtle undefined 报错
  const sha256Hex = async (text: string) => {
    if (text.length === 64) return text; // 已经是哈希则跳过

    if (!window.crypto || !window.crypto.subtle) {
      console.warn("⚠️ 环境限制：当前非安全源(非HTTPS)，无法本地计算哈希，将传递原始值由后端处理。")
      return text 
    }

    try {
      const enc = new TextEncoder()
      const data = enc.encode(text)
      const digest = await crypto.subtle.digest('SHA-256', data)
      const bytes = new Uint8Array(digest)
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch (e) {
      console.error("哈希计算失败", e)
      return text
    }
  }

  const handleMintClick = () => {
    const err = validateAddress(recipient)
    if (err) {
      setState('error'); setMessage(err); return
    }
    if (!code) {
      setState('error'); setMessage('无效的兑换码，请检查 URL'); return
    }
    setShowConfirm(true)
  }

  const confirmAndSubmit = async () => {
    setConfirmLoading(true)
    setState('sending')
    setMessage('')
    
    try {
      const codeHash = await sha256Hex(code)
      
      const payload = {
        dest: recipient.trim(),
        codeHash: codeHash
      }

      const url = `${BACKEND_URL}/relay/mint`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (resp.status === 403) {
        throw new Error('🚫 此提取码无效或对应的 NFT 已被领取')
      }

      const result = await resp.json()
      
      if (!resp.ok || result.status === 'failed') {
        throw new Error(result.error || '铸造请求被拒绝')
      }

      if (result.status === 'success' || result.status === 'submitted') {
        setConfirmLoading(false)
        setShowConfirm(false)
        setState('success')
        
        const tokenId = result.token_id || '0'
        
        // 【核心修改点】：在跳转路径中增加 &address=${encodeURIComponent(recipient.trim())}
        // 这样 Success.tsx 就能通过 params.get('address') 拿到用户输入的地址
        const successPath = `/success?book_id=${encodeURIComponent(bookIdRaw)}&token_id=${tokenId}&address=${encodeURIComponent(recipient.trim())}`
        
        console.log(`🎉 铸造申请已提交! TokenID: ${tokenId}, 接收地址: ${recipient.trim()}`)
        navigate(successPath)
      }
    } catch (e: any) {
      setConfirmLoading(false)
      setShowConfirm(false)
      setState('error')
      setMessage(e.message || '网络连接异常，请检查后端服务')
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-white">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold mb-2">领取您的专属 NFT</h1>
        <p className="text-white/60 text-sm">请输入您的钱包地址，我们将为您代付 Gas 完成铸造</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-sm">
        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium text-white/80 mb-3 block">接收地址 (Moonbase Alpha / EVM)</label>
            <input
              className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-primary transition-all font-mono text-primary"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>

          <button
            className="w-full rounded-xl bg-primary hover:bg-primary/90 py-4 font-bold text-lg transition-all shadow-glow active:scale-[0.98] disabled:opacity-50"
            onClick={handleMintClick}
            disabled={state === 'sending'}
          >
            {state === 'sending' ? '正在处理...' : '立即免 Gas 铸造'}
          </button>
          
          {message && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm py-3 px-4 rounded-lg text-center animate-pulse">
              {message}
            </div>
          )}
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-gray-900 p-8 space-y-6 shadow-2xl">
            <h2 className="text-xl font-bold text-center">确认铸造信息</h2>
            <div className="space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider">接收地址</p>
              <div className="bg-black/40 p-3 rounded-lg font-mono text-xs break-all border border-white/5 text-primary">
                {recipient}
              </div>
            </div>
            <p className="text-sm text-gray-400 text-center">系统将自动为您支付 Gas 费用，请稍候</p>
            <div className="flex gap-4">
              <button 
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors" 
                onClick={() => setShowConfirm(false)}
                disabled={confirmLoading}
              >
                取消
              </button>
              <button 
                className="flex-1 py-3 bg-primary rounded-xl font-bold hover:shadow-glow transition-all disabled:opacity-50" 
                onClick={confirmAndSubmit}
                disabled={confirmLoading}
              >
                {confirmLoading ? '提交中...' : '确认提交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}