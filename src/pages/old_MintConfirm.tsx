import React, { useMemo, useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { BACKEND_URL } from '../config/backend'

type MintState = 'idle' | 'checking' | 'sending' | 'success' | 'error'

export default function MintConfirm() {
  const { hashCode } = useParams() 
  const [params] = useSearchParams()
  const navigate = useNavigate()
  
  const code = useMemo(() => hashCode || params.get('code') || '', [hashCode, params])
  const bookIdRaw = useMemo(() => params.get('book_id') ?? '1', [params])
  
  const [state, setState] = useState<MintState>('checking') 
  const [message, setMessage] = useState<string>('')
  const [recipient, setRecipient] = useState<string>('') // 初始地址为空
  const [showConfirm, setShowConfirm] = useState<boolean>(false)
  const [confirmLoading, setConfirmLoading] = useState<boolean>(false)

  const sha256Hex = async (text: string) => {
    if (text.length === 64) return text; 
    if (!window.crypto || !window.crypto.subtle) return text; 
    try {
      const enc = new TextEncoder()
      const data = enc.encode(text)
      const digest = await crypto.subtle.digest('SHA-256', data)
      const bytes = new Uint8Array(digest)
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch (e) { return text }
  }

  // --- 逻辑：自动预检 + 自动填充地址 ---
  useEffect(() => {
    const initPage = async () => {
      if (!code) {
        setState('error'); setMessage('未检测到有效提取码'); return;
      }

      try {
        const codeHash = await sha256Hex(code);

        // 1. 验证 Hash 合法性 (防伪检查)
        const vResp = await fetch(`${BACKEND_URL}/secret/verify?codeHash=${codeHash}`);
        if (vResp.status === 403 || vResp.status === 404) {
          setState('error'); setMessage('无效的兑换码，请确保您获取的是正版书籍'); return;
        }

        // 2. 自动填充：从 Redis 获取该码绑定的专属钱包
        const bResp = await fetch(`${BACKEND_URL}/secret/get-binding?codeHash=${codeHash}`);
        if (bResp.ok) {
          const bData = await bResp.json();
          if (bData.address) {
            setRecipient(bData.address); // 🌟 关键：在这里自动填充
          }
        }
        
        setState('idle'); // 验证完成，显示 UI
      } catch (e) {
        setState('error'); setMessage('网络异常，请确认后端已启动');
      }
    };
    initPage();
  }, [code]);

  const confirmAndSubmit = async () => {
    setConfirmLoading(true); setState('sending');
    try {
      const codeHash = await sha256Hex(code);
      const addr = recipient.trim().toLowerCase();

      // 管理员跳转逻辑
      const vResp = await fetch(`${BACKEND_URL}/secret/verify?codeHash=${codeHash}&address=${addr}`);
      const vData = await vResp.json();
      if (vData.role === 'publisher') {
        window.location.replace("/admin/overview"); return;
      }

      // 正常免 Gas 铸造
      const resp = await fetch(`${BACKEND_URL}/relay/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest: addr, codeHash: codeHash })
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || '铸造失败');
      
      navigate(`/success?book_id=${encodeURIComponent(bookIdRaw)}&token_id=0&address=${encodeURIComponent(addr)}&txHash=${result.txHash}`);
    } catch (e: any) {
      setConfirmLoading(false); setShowConfirm(false); setState('error'); setMessage(e.message);
    }
  }

  const isAddrInvalid = useMemo(() => !/^0x[0-9a-fA-F]{40}$/.test(recipient), [recipient]);

  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-white font-sans">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold mb-3 bg-gradient-to-r from-blue-400 to-blue-200 bg-clip-text text-transparent italic">
          Whale Vault
        </h1>
        <p className="text-white/60 text-sm">一书一码 • 物理确权</p>
      </div>

      {state === 'checking' ? (
        <div className="text-center py-20 animate-pulse">
            <p className="text-blue-400 text-xs tracking-widest uppercase">正在检索金库映射关系...</p>
        </div>
      ) : state === 'error' ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-10 text-center backdrop-blur-md">
          <h2 className="text-xl font-bold text-red-400 mb-2">权限验证失败</h2>
          <p className="text-white/60 text-sm mb-8 leading-relaxed">{message}</p>
          <button onClick={() => window.location.reload()} className="px-8 py-2 rounded-full border border-red-500/30 text-red-400">重新尝试</button>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-sm">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-white/50 uppercase tracking-widest block text-center">接收 NFT 的钱包地址</label>
              <input
                className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-4 outline-none text-blue-400 font-mono text-center focus:border-blue-500/50 transition-all"
                placeholder="0x..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)} // 允许用户修改！
              />
              <p className="text-[10px] text-center text-white/30 italic">提示：已自动填充预设地址，您也可以手动修改</p>
            </div>
            
            <button
              className="w-full rounded-xl bg-blue-600 py-4 font-bold text-lg shadow-lg hover:bg-blue-500 transition-all active:scale-[0.98] disabled:opacity-30"
              onClick={() => setShowConfirm(true)}
              disabled={isAddrInvalid}
            >
              确认并执行确权
            </button>
          </div>
        </div>
      )}

      {showConfirm && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
            <div className="w-full max-w-md rounded-2xl border border-white/20 bg-gray-900 p-8 space-y-6 shadow-2xl text-center">
                <h2 className="text-xl font-bold">确认确权信息</h2>
                <div className="bg-black/40 p-4 rounded-lg font-mono text-xs break-all border border-white/5 text-blue-400">{recipient}</div>
                <div className="flex gap-4">
                    <button className="flex-1 py-3 bg-white/5 rounded-xl" onClick={() => setShowConfirm(false)}>取消</button>
                    <button className="flex-1 py-3 bg-blue-600 rounded-xl font-bold" onClick={confirmAndSubmit} disabled={confirmLoading}>
                        {confirmLoading ? '确权中...' : '确认提交'}
                    </button>
                </div>
            </div>
         </div>
      )}
    </div>
  )
}
