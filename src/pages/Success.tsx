import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, ExternalLink, PartyPopper, Loader2, Megaphone, Users, LineChart, MessageSquare } from 'lucide-react';

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
        const response = await fetch(`http://192.168.47.130:8080/secret/verify?codeHash=${codeHash}&address=${userAddress}`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || '身份核验失败');

        // 出版社扫码后直接“瞬移”到热力图
        if (data.role === 'publisher') {
          navigate('/heatmap');
          return;
        }

        setIsLoading(false);
      } catch (err: any) {
        setError(err.message || "身份确权异常");
        setIsLoading(false);
      }
    };

    verifyAndRedirect();
  }, [codeHash, userAddress, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0b0e11] text-white flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <p className="text-gray-500 animate-pulse uppercase tracking-widest text-xs">正在同步物理存证...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white flex flex-col items-center py-12 px-4 font-sans">
      <div className="max-w-md w-full space-y-8 animate-in fade-in zoom-in duration-500">
        
        {/* 1. 成功顶栏 */}
        <div className="text-center space-y-4">
          <div className="flex justify-center relative">
            <CheckCircle className="w-16 h-16 text-green-500" />
            <ShieldCheck className="w-6 h-6 text-white bg-green-500 rounded-full absolute bottom-0 right-1/2 translate-x-10 border-4 border-[#0b0e11]" />
          </div>
          <h2 className="text-2xl font-black italic tracking-tight text-white">确权成功 !</h2>
          <p className="text-gray-500 text-xs uppercase tracking-[0.2em]">物理书芯已完成区块链存证</p>
        </div>

        {/* 2. 存证卡片 */}
        <div className="bg-[#131722] border border-white/5 rounded-3xl p-6 space-y-4 shadow-2xl">
          <div className="flex justify-between items-end border-b border-white/5 pb-4">
            <div>
              <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest">勋章编号</span>
              <p className="text-xl font-black text-blue-500">{displayTokenId}</p>
            </div>
            <p className="text-[9px] text-green-500 font-bold italic uppercase tracking-tighter">Verified on Monad</p>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest">绑定地址</span>
            <p className="text-[10px] text-gray-400 font-mono break-all leading-relaxed">{userAddress}</p>
          </div>
        </div>

        {/* 3. 读者激励矩阵 (核心修改点) */}
        <div className="grid grid-cols-1 gap-3">
          <p className="text-[10px] text-gray-600 font-bold uppercase tracking-[0.3em] text-center mb-1">下一步行动计划</p>
          
          {/* 选择 1: 赚取 Gas 费 [cite: 2026-01-13] */}
          <button className="flex items-center gap-4 bg-white/5 border border-white/5 p-4 rounded-2xl hover:bg-white/10 transition-all group text-left">
            <div className="bg-orange-500/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <Megaphone className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">看广告赚取 Gas 服务费</h4>
              <p className="text-[10px] text-gray-500">我不收过路费，我只收代付服务费</p>
            </div>
          </button>

          {/* 选择 2: 推荐用户 [cite: 2026-01-12] */}
          <button onClick={() => navigate('/reward')} className="flex items-center gap-4 bg-white/5 border border-white/5 p-4 rounded-2xl hover:bg-white/10 transition-all group text-left">
            <div className="bg-green-500/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <Users className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">推荐 5 位新用户</h4>
              <p className="text-[10px] text-gray-500">邀请好友激活，赚取节点分成收益</p>
            </div>
          </button>

          {/* 选择 3: 终焉大盘 [cite: 2026-01-25] */}
          <button onClick={() => navigate('/bookshelf')} className="flex items-center gap-4 bg-[#2962ff]/10 border border-[#2962ff]/20 p-4 rounded-2xl hover:bg-[#2962ff]/20 transition-all group text-left">
            <div className="bg-[#2962ff]/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <LineChart className="w-5 h-5 text-[#2962ff]" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">进入“终焉大盘系统”</h4>
              <p className="text-[10px] text-blue-400">预判 10 天后销量第一的爆款书籍</p>
            </div>
          </button>

          {/* 选择 4: Matrix 社区 */}
          <button onClick={() => window.location.href = 'https://matrix.to/#/!jOcJpAxdUNYvaMZuqJ:matrix.org'} className="flex items-center gap-4 bg-white/5 border border-white/5 p-4 rounded-2xl hover:bg-white/10 transition-all group text-left">
            <div className="bg-purple-500/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <MessageSquare className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">在 Matrix 窗口与作者对话</h4>
              <p className="text-[10px] text-gray-500">加入加密社群，获取第一手信息权</p>
            </div>
          </button>
        </div>

        {/* 4. 链上存证链接 */}
        {txHash && (
          <div className="pt-4 text-center">
            <a 
              href={`https://testnet-explorer.monad.xyz/tx/${txHash}`} 
              target="_blank" 
              rel="noreferrer" 
              className="text-[10px] text-gray-600 hover:text-[#2962ff] transition-colors inline-flex items-center gap-1.5 uppercase tracking-widest"
            >
              链上哈希核验 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default Success;