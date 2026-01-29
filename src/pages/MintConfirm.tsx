import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
// 统一配置后端基准地址
const BACKEND_URL = 'http://198.55.109.102:8080';

export default function MintConfirm() {
  const { hashCode } = useParams() 
  const [params] = useSearchParams()
  const navigate = useNavigate()
  
  // 错误状态管理
  const [error, setError] = useState<string | null>(null)
  
  // 核心：处理用户从 valut_mint_nft/<hashcode> 进来的请求
  const code = hashCode || params.get('code') || ''
  const bookIdRaw = params.get('book_id') ?? '1'
  const hasSubmitted = useRef(false)

  // 算法对齐：确保哈希处理逻辑与 Python 脚本一致 [cite: 2026-01-27]
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

  useEffect(() => {
    const fastVaultRelay = async () => {
      // 严格防止重复铸造请求 [cite: 2026-01-13]
      if (!code || hasSubmitted.current) return;
      hasSubmitted.current = true;

      try {
        const codeHash = await sha256Hex(code);

        // 1. ⚡️ 获取绑定地址
        const bResp = await fetch(`${BACKEND_URL}/secret/get-binding?codeHash=${codeHash}`);
        
        // 检查 HTTP 错误或 Binding not found
        if (!bResp.ok) {
          const errorData = await bResp.json().catch(() => ({}));
          if (errorData.error?.includes('not found') || bResp.status === 404) {
            setError('INVALID_CODE');
            return;
          }
          console.error(`获取绑定失败: HTTP ${bResp.status} ${bResp.statusText}`);
          setError('NETWORK_ERROR');
          return;
        }
        
        const bData = await bResp.json();
        const addr = bData.address;

        // 如果返回成功但地址为空，也视为无效二维码
        if (!addr) {
          setError('INVALID_CODE');
          return;
        }

        // 2. ⚡️ 发起 Mint 请求
        const mintResp = await fetch(`${BACKEND_URL}/relay/mint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dest: addr, codeHash: codeHash })
        });
        
        if (!mintResp.ok) {
          const errorText = await mintResp.text().catch(() => '');
          console.error(`Mint 请求失败: HTTP ${mintResp.status} ${mintResp.statusText}`, errorText);
          setError('MINT_FAILED');
          return;
        }
        
        const mintData = await mintResp.json();
        
        if (!mintData.txHash) {
          console.error("Mint 响应缺少 txHash:", mintData);
          setError('MINT_FAILED');
          return;
        }
        
        // 3. 🌟 跳转到成功页面
        const query = new URLSearchParams({
          book_id: bookIdRaw,
          address: addr,
          txHash: mintData.txHash,
          codeHash: codeHash,
          token_id: mintData.tokenId?.toString() || '0'
        });

        navigate(`/success?${query.toString()}`, { replace: true });
        
      } catch (e) {
        console.error("Vault sequence failed:", e);
        setError('NETWORK_ERROR');
      }
    };

    fastVaultRelay();
  }, [code, navigate, bookIdRaw]);

  // 错误状态：显示友好的错误提示页面
  if (error) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full bg-[#131722] border border-white/10 rounded-[32px] p-8 text-center space-y-6 shadow-2xl">
          
          {/* 错误图标 */}
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
            <span className="text-red-500 text-4xl">✕</span>
          </div>

          {/* 错误标题 */}
          <h1 className="text-xl font-bold text-white">
            {error === 'INVALID_CODE' ? '无效的二维码' : '请求失败'}
          </h1>

          {/* 错误描述 */}
          <p className="text-sm text-gray-400 leading-relaxed">
            {error === 'INVALID_CODE' 
              ? '该二维码无效或已被使用。请确认您扫描的是正版商品附带的二维码。'
              : '网络连接失败，请检查网络后重试。'}
          </p>

          {/* 提示信息 */}
          {error === 'INVALID_CODE' && (
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
              <p className="text-xs text-yellow-500/80 font-medium">
                ⚠️ 请购买正版商品以获取有效的激活二维码
              </p>
            </div>
          )}

          {/* 返回按钮 */}
          <button 
            onClick={() => navigate('/', { replace: true })}
            className="w-full py-4 rounded-xl bg-white/5 text-white font-bold text-sm uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
          >
            返回首页
          </button>
        </div>

        {/* 底部标识 */}
        <div className="mt-10 text-[9px] text-gray-600 uppercase tracking-[0.4em] font-medium">
          Whale Vault Protocol <span className="mx-2">•</span> Physical Asset Provenance
        </div>
      </div>
    );
  }

  // 加载状态：显示加载动画
  return (
    <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center">
      <div className="animate-pulse text-blue-500 text-[10px] tracking-[0.3em] uppercase font-mono">
        正在验证二维码...
      </div>
    </div>
  );
}
