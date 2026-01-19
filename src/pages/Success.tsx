import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, ExternalLink, PartyPopper, Loader2 } from 'lucide-react';

const Success = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const txHash = searchParams.get('txHash');
  const userAddress = (searchParams.get('address') || '未知持有人').toLowerCase();
  const codeHash = searchParams.get('codeHash');
  
  const rawTokenId = searchParams.get('token_id');
  const displayTokenId = (!rawTokenId || rawTokenId === '0') ? '最新生成' : `#${rawTokenId}`;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verifyAndRedirect = async () => {
      if (!codeHash) {
        setTimeout(() => setIsLoading(false), 1000);
        return;
      }

      try {
        // 请求后端验证接口识别身份角色
        const response = await fetch(`http://localhost:8080/secret/verify?codeHash=${codeHash}&address=${userAddress}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || '身份核验失败');
        }

        // --- 核心逻辑：出版社扫码后直接“瞬移”到热力图 ---
        if (data.role === 'publisher') {
          navigate('/heatmap');
          return;
        }

        // 作者逻辑预留
        if (data.role === 'author') {
           // navigate('/author_dashboard'); 
           // return;
        }

        // 只有普通读者才会看到这个页面的 UI
        setIsLoading(false);
      } catch (err: any) {
        console.error("验证流程异常:", err);
        setError(err.message || "身份确权异常");
        setIsLoading(false);
      }
    };

    verifyAndRedirect();
  }, [codeHash, userAddress, navigate]);

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
      <div className="max-w-md w-full bg-[#1e293b] border border-slate-700 rounded-3xl p-8 shadow-2xl relative animate-in fade-in zoom-in duration-500">
        
        <div className="text-center space-y-8">
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
            <p className="text-green-400 font-medium tracking-wide">读者勋章已确权</p>
          </div>

          <div className="bg-slate-900/50 rounded-2xl p-6 text-left space-y-4 border border-slate-700/50">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-[0.2em]">绑定地址</span>
              <p className="text-xs text-slate-300 font-mono break-all leading-relaxed">{userAddress}</p>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-[0.2em]">勋章编号</span>
                <p className="text-2xl font-black text-blue-500">{displayTokenId}</p>
              </div>
              <p className="text-xs text-green-500 font-bold italic">PROVED ON CHAIN</p>
            </div>
          </div>

          <button 
            onClick={() => window.location.href = 'https://matrix.to/#/!jOcJpAxdUNYvaMZuqJ:matrix.org'} 
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 rounded-2xl font-bold transition-all shadow-lg"
          >
            进入读者社区
          </button>
        </div>

        {txHash && (
          <div className="mt-8 pt-6 border-t border-slate-800 text-center">
            <a href={`https://monadscan.com/address/${txHash}`} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-blue-400 flex items-center justify-center gap-1.5">
              查看链上存证 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default Success;
