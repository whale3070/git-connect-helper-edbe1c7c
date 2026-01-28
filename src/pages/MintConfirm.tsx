import { useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'

// 统一配置后端基准地址
const BACKEND_URL = 'http://198.55.109.102:8080';

export default function MintConfirm() {
  const { hashCode } = useParams() 
  const [params] = useSearchParams()
  const navigate = useNavigate()
  
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

        // 1. ⚡️ 关键修正：从脚本定义的 vault:bind: 结构中获取地址
        // 后端 get-binding 接口需支持 HGET vault:bind:{codeHash} address [cite: 2026-01-27]
        const bResp = await fetch(`${BACKEND_URL}/secret/get-binding?codeHash=${codeHash}`);
        const bData = await bResp.json();
        const addr = bData.address;

        if (!addr) {
          console.error("Redis 映射缺失 (Key: vault:bind:...)");
          // 若地址未绑定，理智的做法是退回引导页 [cite: 2026-01-01]
          navigate('/', { replace: true });
          return;
        }

        // 2. ⚡️ 瞬时广播：不等待 Block 确认，直接拿到 txHash [cite: 2026-01-13]
        const mintResp = await fetch(`${BACKEND_URL}/relay/mint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dest: addr, codeHash: codeHash })
        });
        
        const mintData = await mintResp.json();
        
        // 3. 🌟 终极跳转：携带所有身份参数进入 Success.tsx
        // Success.tsx 会利用 codeHash 自动识别 Reader/Publisher
        const query = new URLSearchParams({
          book_id: bookIdRaw,
          address: addr,
          txHash: mintData.txHash || '',
          codeHash: codeHash,
          token_id: '0'
        });

        navigate(`/success?${query.toString()}`, { replace: true });
        
      } catch (e) {
        console.error("Vault sequence failed:", e);
        navigate('/', { replace: true }); 
      }
    };

    fastVaultRelay();
  }, [code, navigate, bookIdRaw]);

  // 渲染 null：实现肉眼不可见的“秒转”逻辑中转
  return null;
}