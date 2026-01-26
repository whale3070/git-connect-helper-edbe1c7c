import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, ExternalLink, PartyPopper, Loader2 } from 'lucide-react';

const Success = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // 从 URL 获取参数
  const txHash = searchParams.get('txHash');
  const userAddress = searchParams.get('address') || '未知持有人';
  const codeHash = searchParams.get('codeHash');
  
  // 勋章编号逻辑
  const rawTokenId = searchParams.get('token_id');
  const displayTokenId = (!rawTokenId || rawTokenId === '0') ? '最新生成' : `#${rawTokenId}`;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verifyAndRedirect = async () => {
      // 如果没有 codeHash，可能是直接访问，不做管理员校验直接展示
      if (!codeHash) {
        setTimeout(() => setIsLoading(false), 1000);
        return;
      }

      try {
        // 请求后端验证接口，使用你 Kali 的本地 IP
        const response = await fetch(`http://192.168.1.9:8080/secret/verify?codeHash=${codeHash}&address=${userAddress}`);
        
        if (!response.ok) {
          throw new Error('身份核验失败');
        }

        const data = await response.json();

        // --- 核心：管理员跳转逻辑 ---
        if (data.role === 'publisher') {
          console.log("🎯 检测到管理员身份，执行权限跳转...");
          // 请确保你在 App.tsx 中配置了 /admin 路由
          navigate('/admin'); 
          return;
        }

        // 如果是普通成功用户，停留 1.5 秒增加仪式感后显示 UI
        setTimeout(() => setIsLoading(false), 1500);
      } catch (err) {
        console.error("验证流程异常:", err);
        setError("身份确权异常，请联系出版社");
        setIsLoading(false);
      }
    };

    verifyAndRedirect();
  }, [codeHash, userAddress, navigate]);

  // 加载中状态（物理存证同步动效）
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
          <p className="text-slate-400 font-medium animate-pulse">正在同步物理存证...</p>
        </div>
      </div>
    );
  }

  // 错误处理状态
  if (error) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4">
        <div className="bg-red-500/10 border border-red-500/50 p-6 rounded-2xl text-center">
          <p className="text-red-400 font-bold">{error}</p>
          <button onClick={() => navigate('/')} className="mt-4 text-sm text-slate-400 underline">返回首页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-[#1e293b] border border-slate-700 rounded-3xl p-8 shadow-2xl relative">
        
        {/* 核心验证成功 UI */}
        <div className="text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="flex justify-center">
            <div className="relative">
              <CheckCircle className="w-20 h-20 text-green-500 relative z-10" />
              <ShieldCheck className="w-8 h-8 text-white bg-green-500 rounded-full absolute -bottom-1 -right-1 border-4 border-[#1e293b] z-20" />
            </div>
          </div>
          
          <div className="space-y-2">
            <h2 className="text-3xl font-extrabold text-white flex items-center justify-center gap-2">
              验证成功 <PartyPopper className="w-8 h-8 text-yellow-500" />
            </h2>
            <p className="text-green-400 font-medium tracking-wide">Whale Vault 访问权限已激活</p>
          </div>

          {/* 资产物理详情卡片 */}
          <div className="bg-slate-900/50 rounded-2xl p-6 text-left space-y-4 border border-slate-700/50">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-[0.2em]">物理持有地址</span>
              <p className="text-xs text-slate-300 font-mono break-all leading-relaxed">{userAddress}</p>
            </div>
            
            <div className="flex justify-between items-end">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-[0.2em]">勋章编号</span>
                <p className="text-2xl font-black text-blue-500">{displayTokenId}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-[0.2em]">确权状态</span>
                <p className="text-xs text-green-500 font-bold italic">PROVED ON CHAIN</p>
              </div>
            </div>
          </div>

          {/* 演示出口：进入 Matrix 私域 */}
          <button 
            onClick={() => window.location.href = 'https://matrix.to/#/!jOcJpAxdUNYvaMZuqJ:matrix.org?via=matrix.org'} 
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl font-bold transition-all shadow-lg active:scale-95"
          >
            立即进入私域频道
          </button>
        </div>

        {/* 物理存证链接 (Monad 测试网或 Moonbeam) */}
        {txHash && (
          <div className="mt-8 pt-6 border-t border-slate-800 text-center">
            <a 
              href={`https://testnet-explorer.monad.xyz/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-500 hover:text-blue-400 flex items-center justify-center gap-1.5"
            >
              在 Explorer 查验物理存证 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
      
      <p className="mt-6 text-slate-600 text-[10px] tracking-widest font-bold">WHALE VAULT • DECENTRALIZED IDENTITY SYSTEM</p>
    </div>
  );
};

export default Success;