import React, { useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { BACKEND_URL } from '../config/backend'

type MintState = 'idle' | 'sending' | 'success' | 'error'

export default function MintConfirm() {
  // 1. 获取 URL 路径中的 hashCode
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

  // --- 核心逻辑：傻瓜式地址处理器 ---
  const handleRecipientChange = (val: string) => {
    let addr = val.trim();
    
    // 自动补齐 0x 前缀
    if (addr.length > 0 && !addr.startsWith('0x')) {
      addr = '0x' + addr;
    }

    // 过滤：只允许 0x 开头和十六进制字符 (0-9, a-f)
    const prefix = "0x";
    let body = addr.startsWith("0x") ? addr.substring(2) : addr;
    body = body.replace(/[^0-9a-fA-F]/g, ""); 
    
    // 强制截断至 42 位
    const finalAddr = (prefix + body).substring(0, 42);
    setRecipient(finalAddr);
    
    // 如果长度对了，尝试清除之前的错误提示
    if (finalAddr.length === 42) setMessage('');
  };

  // 实时检查地址是否合法（用于前端按钮状态控制）
  const isAddrInvalid = useMemo(() => {
    // 必须是 0x 开头，后面跟着 40 位十六进制字符
    return !/^0x[0-9a-fA-F]{40}$/.test(recipient);
  }, [recipient]);

  // 修改后的 sha256Hex：适配非 HTTPS 这种不安全环境
  const sha256Hex = async (text: string) => {
    if (text.length === 64) return text; 

    if (!window.crypto || !window.crypto.subtle) {
      console.warn("⚠️ 环境限制：当前无法本地计算哈希，将传递原始值。")
      return text 
    }

    try {
      const enc = new TextEncoder()
      const data = enc.encode(text)
      const digest = await crypto.subtle.digest('SHA-256', data)
      const bytes = new Uint8Array(digest)
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch (e) {
      return text
    }
  }

  const handleMintClick = () => {
    if (isAddrInvalid) {
      setState('error'); setMessage('请输入正确的 42 位钱包地址'); return
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

      const resp = await fetch(`${BACKEND_URL}/relay/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (resp.status === 403) {
        throw new Error('🚫 此码无效或已被领取')
      }

      const result = await resp.json()
      
      if (!resp.ok || result.status === 'error') {
        throw new Error(result.error || '请求被拒绝')
      }

      if (result.status === 'success' || result.status === 'submitted') {
        setConfirmLoading(false)
        setShowConfirm(false)
        setState('success')
        
        const tokenId = result.token_id || '0'
        const successPath = `/success?book_id=${encodeURIComponent(bookIdRaw)}&token_id=${tokenId}&address=${encodeURIComponent(recipient.trim())}`
        navigate(successPath)
      }
    } catch (e: any) {
      setConfirmLoading(false)
      setShowConfirm(false)
      setState('error')
      setMessage(e.message || '网络连接异常，请稍后再试')
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-white">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold mb-3 bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
          领取您的数字出版物
        </h1>
        <p className="text-white/60 text-sm">
          NFT 是您的书在区块链上的“出生证明”，永久存储，不可篡改。
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-sm">
        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium text-white/80 mb-1 block">接收地址 (EVM 卡号)</label>
            <p className="text-[11px] text-white/40 mb-3">
              * 安全提示：地址仅用于接收 NFT，无法从中划扣资金。请放心粘贴。
            </p>
            <input
              className={`w-full rounded-xl bg-black/40 border px-4 py-4 outline-none transition-all font-mono text-lg ${
                recipient.length > 0 && isAddrInvalid 
                ? 'border-red-500/50 text-red-400' 
                : 'border-white/10 text-primary focus:border-primary shadow-inner'
              }`}
              placeholder="0x..."
              value={recipient}
              onChange={(e) => handleRecipientChange(e.target.value)}
            />
          </div>

          <button
            className="w-full rounded-xl bg-primary hover:bg-primary/90 py-4 font-bold text-lg transition-all shadow-glow active:scale-[0.98] disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
            onClick={handleMintClick}
            disabled={state === 'sending' || isAddrInvalid || !code}
          >
            {state === 'sending' 
              ? '正在处理中...' 
              : isAddrInvalid 
                ? '请输入完整的接收卡号' 
                : '立即免 Gas 铸造'}
          </button>
          
          {message && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm py-3 px-4 rounded-lg text-center animate-pulse">
              {message}
            </div>
          )}
        </div>
      </div>

      {/* 二次确认弹窗 */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-gray-900 p-8 space-y-6 shadow-2xl">
            <h2 className="text-xl font-bold text-center">确认接收信息</h2>
            <div className="space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider text-center">NFT 将发送至以下地址</p>
              <div className="bg-black/40 p-4 rounded-lg font-mono text-sm break-all border border-white/5 text-primary text-center">
                {recipient}
              </div>
            </div>
            <p className="text-xs text-yellow-500/80 text-center bg-yellow-500/5 py-2 rounded">
              ⚠️ 请确保地址正确，NFT 一旦发出将无法撤回。
            </p>
            <div className="flex gap-4">
              <button 
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors" 
                onClick={() => setShowConfirm(false)}
                disabled={confirmLoading}
              >
                返回修改
              </button>
              <button 
                className="flex-1 py-3 bg-primary rounded-xl font-bold hover:shadow-glow transition-all disabled:opacity-50" 
                onClick={confirmAndSubmit}
                disabled={confirmLoading}
              >
                {confirmLoading ? '提交中...' : '确认无误，提交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
