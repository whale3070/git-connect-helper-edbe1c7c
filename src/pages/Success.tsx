import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, ExternalLink, Loader2, Megaphone, Users, LineChart, MessageSquare, MapPin, Globe } from 'lucide-react';
import { BACKEND_URL } from '../config/backend';

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
  const [totalMinted, setTotalMinted] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<string | null>(null);

  useEffect(() => {
    const verifyAndFetchData = async () => {
      if (!codeHash) {
        setTimeout(() => setIsLoading(false), 1000);
        return;
      }

      try {
        // 1. 请求后端验证接口识别身份角色
        const response = await fetch(`${BACKEND_URL}/secret/verify?codeHash=${codeHash}&address=${userAddress}`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || '身份核验失败');

        // 出版社扫码后直接跳转到热力图
        if (data.role === 'publisher') {
          navigate('/heatmap');
          return;
        }

        // 2. 获取链上 NFT 总铸造数量
        try {
          const statsRes = await fetch(`${BACKEND_URL}/api/v1/nft/total-minted`);
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            setTotalMinted(statsData.total || 0);
          }
        } catch (e) {
          console.warn('无法获取 NFT 统计:', e);
        }

        // 3. 获取用户地理位置信息
        try {
          const locationRes = await fetch(`${BACKEND_URL}/api/v1/reader/location`);
          if (locationRes.ok) {
            const locData = await locationRes.json();
            setUserLocation(locData.city || locData.region || locData.country || '未知地区');
          }
        } catch (e) {
          console.warn('无法获取位置信息:', e);
        }

        setIsLoading(false);
      } catch (err: any) {
        setError(err.message || "身份确权异常");
        setIsLoading(false);
      }
    };

    verifyAndFetchData();
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

        {/* 2. 第 N 位读者徽章 */}
        {totalMinted !== null && (
          <div className="bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 border border-cyan-500/30 rounded-3xl p-6 text-center space-y-3 animate-pulse-slow">
            <p className="text-[10px] text-cyan-400 uppercase font-bold tracking-[0.3em]">🎉 恭喜你成为</p>
            <p className="text-5xl font-black bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              第 {totalMinted} 位
            </p>
            <p className="text-gray-400 text-xs">全球领取此书 NFT 存证的读者</p>
            {userLocation && (
              <div className="flex items-center justify-center gap-2 mt-2 text-green-400">
                <MapPin className="w-4 h-4" />
                <span className="text-sm font-medium">{userLocation} 已点亮 !</span>
              </div>
            )}
          </div>
        )}

        {/* 3. 存证卡片 */}
        <div className="bg-[#131722] border border-white/5 rounded-3xl p-6 space-y-4 shadow-2xl">
          <div className="flex justify-between items-end border-b border-white/5 pb-4">
            <div>
              <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest">勋章编号</span>
              <p className="text-xl font-black text-blue-500">{displayTokenId}</p>
            </div>
            <p className="text-[9px] text-green-500 font-bold italic uppercase tracking-tighter">Verified on Conflux</p>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest">绑定地址</span>
            <p className="text-[10px] text-gray-400 font-mono break-all leading-relaxed">{userAddress}</p>
          </div>
        </div>

        {/* 4. 读者激励矩阵 */}
        <div className="grid grid-cols-1 gap-3">
          <p className="text-[10px] text-gray-600 font-bold uppercase tracking-[0.3em] text-center mb-1">下一步行动计划</p>
          
          {/* 选择 0: 查看全球热力图（新增） */}
          <button 
            onClick={() => navigate('/heatmap')} 
            className="flex items-center gap-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 p-4 rounded-2xl hover:from-cyan-500/20 hover:to-blue-500/20 transition-all group text-left"
          >
            <div className="bg-cyan-500/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <Globe className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">查看全球读者热力图</h4>
              <p className="text-[10px] text-cyan-400">你的地区已被点亮！看看全球读者分布</p>
            </div>
          </button>

          {/* 选择 1: 赚取 Gas 费 */}
          <button className="flex items-center gap-4 bg-white/5 border border-white/5 p-4 rounded-2xl hover:bg-white/10 transition-all group text-left">
            <div className="bg-orange-500/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <Megaphone className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">看广告赚取 Gas 服务费</h4>
              <p className="text-[10px] text-gray-500">我不收过路费，我只收代付服务费</p>
            </div>
          </button>

          {/* 选择 2: 推荐用户 */}
          <button onClick={() => navigate('/reward')} className="flex items-center gap-4 bg-white/5 border border-white/5 p-4 rounded-2xl hover:bg-white/10 transition-all group text-left">
            <div className="bg-green-500/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <Users className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">推荐 5 位新用户</h4>
              <p className="text-[10px] text-gray-500">邀请好友激活，赚取节点分成收益</p>
            </div>
          </button>

          {/* 选择 3: 终焉大盘 */}
          <button onClick={() => navigate('/bookshelf')} className="flex items-center gap-4 bg-[#2962ff]/10 border border-[#2962ff]/20 p-4 rounded-2xl hover:bg-[#2962ff]/20 transition-all group text-left">
            <div className="bg-[#2962ff]/20 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <LineChart className="w-5 h-5 text-[#2962ff]" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">进入"终焉大盘系统"</h4>
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

        {/* 5. 链上存证链接 */}
        {txHash && (
          <div className="pt-4 text-center">
            <a 
              href={`https://evmtestnet.confluxscan.org/tx/${txHash}`} 
              target="_blank" 
              rel="noreferrer" 
              className="text-[10px] text-gray-600 hover:text-cyan-400 transition-colors inline-flex items-center gap-1.5 uppercase tracking-widest"
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