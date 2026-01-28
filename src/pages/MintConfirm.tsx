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

        // 1. ⚡️ 获取绑定地址
        const bResp = await fetch(`${BACKEND_URL}/secret/get-binding?codeHash=${codeHash}`);
        
        if (!bResp.ok) {
          console.error(`获取绑定失败: HTTP ${bResp.status} ${bResp.statusText}`);
          navigate('/', { replace: true });
          return;
        }
        
        const bData = await bResp.json();
        const addr = bData.address;

        if (!addr) {
          console.error("Redis 映射缺失 (Key: vault:bind:...)");
          navigate('/', { replace: true });
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
          navigate('/', { replace: true });
          return;
        }
        
        const mintData = await mintResp.json();
        
        if (!mintData.txHash) {
          console.error("Mint 响应缺少 txHash:", mintData);
          navigate('/', { replace: true });
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
        navigate('/', { replace: true }); 
      }
    };

    fastVaultRelay();
  }, [code, navigate, bookIdRaw]);

  // 渲染 null：实现肉眼不可见的“秒转”逻辑中转
  return null;
}