import React, { useMemo, useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { BACKEND_URL } from '../config/backend'

type MintState = 'idle' | 'checking' | 'sending' | 'success' | 'error'

export default function MintConfirm() {
  const { hashCode } = useParams() 
  const [params] = useSearchParams()
  
  const code = useMemo(() => hashCode || params.get('code') || '', [hashCode, params])
  const bookIdRaw = useMemo(() => params.get('book_id') ?? '1', [params])
  
  const [state, setState] = useState<MintState>('checking') 
  const [message, setMessage] = useState<string>('')
  const [recipient, setRecipient] = useState<string>(() => params.get('recipient') ?? '')
  const navigate = useNavigate()
  const [showConfirm, setShowConfirm] = useState<boolean>(false)
  const [confirmLoading, setConfirmLoading] = useState<boolean>(false)

  // --- 逻辑：sha256Hex 适配 ---
  const sha256Hex = async (text: string) => {
    if (text.length === 64) return text; 
    if (!window.crypto || !window.crypto.subtle) return text; 
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

  // --- 新增：自动下载地址备份文件逻辑 ---
  const downloadBackup = (address: string) => {
    const content = `鲸鱼金库 (Whale Vault) 确权备份\n` +
                    `------------------------------\n` +
                    `您的钱包地址: ${address}\n` +
                    `备份时间: ${new Date().toLocaleString()}\n\n` +
                    `【重要提示】\n` +
                    `1. 请务必妥善保管此文件。当您未来需要重新进入私域频道或提取 Arweave 资料时，系统将要求您输入此地址进行确权。\n` +
                    `2. 此地址是您在链上的身份凭证，也是唯一能证明您持有此书 NFT 的证据。\n` +
                    `3. 这里的地址仅作为资产接收凭证，无法用于扣除您的银行余额。`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Whale_Vault_Backup_${address.slice(0, 6)}.txt`; // 以地址前6位命名
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- 核心逻辑：进入页面自动预检 ---
  useEffect(() => {
    const checkCodeStatus = async () => {
      if (!code) {
        setState('error');
        setMessage('未检测到兑换码，请扫描书中的正确二维码');
        return;
      }

      try {
        const codeHash = await sha256Hex(code);
        const resp = await fetch(`${BACKEND_URL}/secret/verify?codeHash=${codeHash}`);
        
        if (resp.status === 409) {
          setState('error');
          setMessage('USED_RECOVER'); 
        } else if (resp.status === 403 || resp.status === 404) {
          setState('error');
          setMessage('无效的兑换码，请确保您获取的是正版书籍');
        } else if (resp.ok) {
          setState('idle'); 
        } else {
          throw new Error('服务器响应异常');
        }
      } catch (e) {
        setState('error');
        setMessage('网络连接失败，请检查您的互联网连接');
      }
    };

    checkCodeStatus();
  }, [code]);

  // --- 确权登录逻辑：老读者验证成功后触发下载并跳转 ---
  const handleVerifyOwned = async () => {
    if (isAddrInvalid) return;
    setConfirmLoading(true);
    try {
      const codeHash = await sha256Hex(code);
      const resp = await fetch(`${BACKEND_URL}/secret/verify?codeHash=${codeHash}&address=${recipient.trim()}`);
      const result = await resp.json();

      if (resp.ok && result.ok) {
        // 1. 触发下载
        downloadBackup(recipient.trim());
        // 2. 校验成功，跳转
        navigate(`/success?book_id=${encodeURIComponent(bookIdRaw)}&token_id=0&address=${encodeURIComponent(recipient.trim())}`);
      } else {
        alert('地址校验失败：该地址未持有此书的 NFT 领取记录');
      }
    } catch (e) {
      alert('验证服务暂时不可用');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleRecipientChange = (val: string) => {
    let addr = val.trim();
    if (addr.length > 0 && !addr.startsWith('0x')) addr = '0x' + addr;
    let body = addr.startsWith("0x") ? addr.substring(2) : addr;
    body = body.replace(/[^0-9a-fA-F]/g, ""); 
    setRecipient(("0x" + body).substring(0, 42));
  };

  const isAddrInvalid = useMemo(() => !/^0x[0-9a-fA-F]{40}$/.test(recipient), [recipient]);

  // --- 铸造逻辑：Mint 成功后触发下载并跳转 ---
  const confirmAndSubmit = async () => {
    setConfirmLoading(true); 
    setState('sending');
    try {
      const codeHash = await sha256Hex(code);
      const resp = await fetch(`${BACKEND_URL}/relay/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest: recipient.trim(), codeHash: codeHash })
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || '铸造失败');
      
      // 1. 触发下载备份
      downloadBackup(recipient.trim());
      // 2. 跳转到成功页
      navigate(`/success?book_id=${encodeURIComponent(bookIdRaw)}&token_id=0&address=${encodeURIComponent(recipient.trim())}`);
    } catch (e: any) {
      setConfirmLoading(false); 
      setShowConfirm(false); 
      setState('error'); 
      setMessage(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-white">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold mb-3 bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
          鲸鱼金库 (Whale Vault)
        </h1>
        <p className="text-white/60 text-sm">一书一码，链上确权</p>
      </div>

      {state === 'checking' ? (
        <div className="text-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent mx-auto mb-4"></div></div>
      ) : message === 'USED_RECOVER' ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 backdrop-blur-md shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🛡️</div>
            <h2 className="text-xl font-bold text-primary">您已领取过此书 NFT</h2>
            <p className="text-white/50 text-xs mt-2">请输入您领取时使用的钱包地址以确权进入私域</p>
          </div>
          <input
            className={`w-full rounded-xl bg-black/40 border px-4 py-4 outline-none transition-all font-mono text-center ${
              recipient.length > 0 && isAddrInvalid ? 'border-red-500/50' : 'border-white/10 text-primary'
            }`}
            placeholder="0x 领取的钱包地址"
            value={recipient}
            onChange={(e) => handleRecipientChange(e.target.value)}
          />
          <button 
            onClick={handleVerifyOwned}
            disabled={isAddrInvalid || confirmLoading}
            className="w-full mt-6 rounded-xl bg-primary py-4 font-bold shadow-glow disabled:opacity-30 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {confirmLoading ? '确权中...' : '确认地址并进入资料库'}
          </button>
        </div>
      ) : state === 'error' ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-10 text-center backdrop-blur-md">
          <h2 className="text-xl font-bold text-red-400 mb-2">权限验证失败</h2>
          <p className="text-white/60 text-sm mb-8 leading-relaxed">{message}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 rounded-full border border-red-500/30 text-red-400">重试</button>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-sm">
          <div className="space-y-6">
            <label className="text-sm font-medium text-white/80 block text-center">接收 NFT 的地址 (EVM 卡号)</label>
            <input
              className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-4 outline-none text-primary font-mono text-lg text-center"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => handleRecipientChange(e.target.value)}
            />
            <button
              className="w-full rounded-xl bg-primary py-4 font-bold text-lg shadow-glow transition-all hover:scale-[1.02] active:scale-[0.98]"
              onClick={() => setShowConfirm(true)}
              disabled={isAddrInvalid}
            >
              立即免 Gas 铸造
            </button>
          </div>
        </div>
      )}

      {showConfirm && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
            <div className="w-full max-w-md rounded-2xl border border-white/20 bg-gray-900 p-8 space-y-6 shadow-2xl text-center">
                <h2 className="text-xl font-bold">确认接收地址</h2>
                <div className="bg-black/40 p-4 rounded-lg font-mono text-sm break-all border border-white/5 text-primary">{recipient}</div>
                <p className="text-xs text-white/40">系统将自动为您下载地址备份文件，请妥善保存。</p>
                <div className="flex gap-4">
                    <button className="flex-1 py-3 bg-white/5 rounded-xl" onClick={() => setShowConfirm(false)}>返回</button>
                    <button className="flex-1 py-3 bg-primary rounded-xl font-bold" onClick={confirmAndSubmit} disabled={confirmLoading}>
                        {confirmLoading ? '铸造中...' : '确认铸造'}
                    </button>
                </div>
            </div>
         </div>
      )}
    </div>
  )
}
