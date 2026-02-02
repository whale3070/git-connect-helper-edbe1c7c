import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, ExternalLink, Loader2, Megaphone, Users, LineChart, MessageSquare, MapPin, Globe } from 'lucide-react';
import { useAppMode } from '../contexts/AppModeContext';
import { mockDelay, MOCK_REGIONS, getRandomBook } from '../data/mockData';

const Success = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isMockMode } = useAppMode();
  
  const txHash = searchParams.get('txHash');
  const userAddress = (searchParams.get('address') || '0x' + 'a'.repeat(40)).toLowerCase();
  const codeHash = searchParams.get('codeHash');
  const rawTokenId = searchParams.get('token_id');
  const displayTokenId = (!rawTokenId || rawTokenId === '0') ? `#${Math.floor(Math.random() * 10000)}` : `#${rawTokenId}`;

  const [isLoading, setIsLoading] = useState(true);
  const [totalMinted, setTotalMinted] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const [mintedBook, setMintedBook] = useState(getRandomBook());

  useEffect(() => {
    const simulateDataFetch = async () => {
      await mockDelay(1200);
      setTotalMinted(Math.floor(Math.random() * 5000) + 1000);
      const randomLocation = MOCK_REGIONS[Math.floor(Math.random() * MOCK_REGIONS.length)];
      setUserLocation(randomLocation.name);
      setIsLoading(false);
    };
    simulateDataFetch();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-slate-400 uppercase tracking-widest text-xs">正在同步数据...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        
        <div className={`${isMockMode ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} border rounded-lg p-2 text-center`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${isMockMode ? 'text-amber-700' : 'text-emerald-700'}`}>
            {isMockMode ? '🔧 Demo Mode' : '🟢 Dev API'}
          </p>
        </div>

        <div className="text-center space-y-4">
          <div className="flex justify-center relative">
            <CheckCircle className="w-16 h-16 text-emerald-500" />
            <ShieldCheck className="w-6 h-6 text-white bg-emerald-500 rounded-full absolute bottom-0 right-1/2 translate-x-10 border-4 border-slate-50" />
          </div>
          <h2 className="text-2xl font-black text-slate-800">确权成功 !</h2>
          <p className="text-slate-400 text-xs uppercase tracking-widest">NFT 铸造已完成</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4 shadow-soft">
          <img src={mintedBook.coverImage} alt={mintedBook.title} className="w-16 h-24 object-cover rounded-lg" onError={(e) => { e.currentTarget.src = 'https://placehold.co/100x150/e2e8f0/6366f1?text=NFT'; }} />
          <div>
            <p className="text-slate-800 font-bold">{mintedBook.title}</p>
            <p className="text-xs text-slate-400">{mintedBook.author}</p>
            <div className={`mt-2 inline-block px-2 py-1 rounded text-[10px] font-bold uppercase ${mintedBook.verificationStatus === 'Verified Genuine' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
              {mintedBook.verificationStatus}
            </div>
          </div>
        </div>

        {totalMinted !== null && (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-3xl p-6 text-center space-y-3">
            <p className="text-xs text-indigo-600 uppercase font-semibold tracking-widest">🎉 恭喜你成为</p>
            <p className="text-5xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">第 {totalMinted} 位</p>
            <p className="text-slate-500 text-xs">全球领取此书 NFT 存证的读者</p>
            {userLocation && (
              <div className="flex items-center justify-center gap-2 mt-2 text-emerald-600">
                <MapPin className="w-4 h-4" />
                <span className="text-sm font-medium">{userLocation} 已点亮 !</span>
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-soft">
          <div className="flex justify-between items-end border-b border-slate-100 pb-4">
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">勋章编号</span>
              <p className="text-xl font-black text-indigo-600">{displayTokenId}</p>
            </div>
            <p className="text-xs text-emerald-600 font-semibold uppercase">Verified</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-slate-400 uppercase font-semibold">绑定地址</span>
            <p className="text-xs text-slate-500 font-mono break-all">{userAddress}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest text-center mb-1">下一步行动计划</p>
          
          <button onClick={() => navigate('/Heatmap')} className="flex items-center gap-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 p-4 rounded-2xl hover:from-indigo-100 hover:to-purple-100 transition-all group text-left">
            <div className="bg-indigo-100 p-3 rounded-xl"><Globe className="w-5 h-5 text-indigo-600" /></div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">查看全球读者热力图</h4>
              <p className="text-xs text-indigo-600">你的地区已被点亮！</p>
            </div>
          </button>

          <button onClick={() => navigate('/reward')} className="flex items-center gap-4 bg-white border border-slate-200 p-4 rounded-2xl hover:bg-slate-50 transition-all group text-left">
            <div className="bg-emerald-100 p-3 rounded-xl"><Users className="w-5 h-5 text-emerald-600" /></div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">推荐 5 位新用户</h4>
              <p className="text-xs text-slate-500">邀请好友激活，赚取节点分成收益</p>
            </div>
          </button>

          <button onClick={() => navigate('/bookshelf')} className="flex items-center gap-4 bg-gradient-to-r from-indigo-500 to-purple-500 p-4 rounded-2xl hover:from-indigo-600 hover:to-purple-600 transition-all group text-left shadow-md">
            <div className="bg-white/20 p-3 rounded-xl"><LineChart className="w-5 h-5 text-white" /></div>
            <div>
              <h4 className="text-sm font-bold text-white">进入"终焉大盘系统"</h4>
              <p className="text-xs text-white/80">预判销量第一的爆款书籍</p>
            </div>
          </button>
        </div>

        {txHash && (
          <div className="pt-4 text-center">
            <button onClick={() => alert(`TX Hash:\n${txHash}`)} className="text-xs text-slate-400 hover:text-indigo-600 transition-colors inline-flex items-center gap-1.5 uppercase tracking-widest">
              链上哈希核验 <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Success;
