import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, ExternalLink, Loader2, Users, LineChart, MapPin, Globe, RefreshCw, Clock, AlertCircle, MessageCircle } from 'lucide-react';
import { useAppMode } from '../contexts/AppModeContext';
import { mockDelay, MOCK_REGIONS, getRandomBook } from '../data/mockData';
import { useApi } from '../hooks/useApi';

type TxStatus = 'pending' | 'syncing' | 'success' | 'failed';

interface TxData {
  status: string;
  tokenId: string;
  reader: string;
  contract: string;
  txHash: string;
  cached?: boolean;
}

const Success = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isMockMode } = useAppMode();
  const { queryTransaction } = useApi();
  
  const txHash = searchParams.get('txHash');
  const userAddress = (searchParams.get('address') || '0x' + 'a'.repeat(40)).toLowerCase();
  const codeHash = searchParams.get('codeHash');
  const initialStatus = searchParams.get('status') as TxStatus || 'pending';

  const [txStatus, setTxStatus] = useState<TxStatus>(initialStatus);
  const [txData, setTxData] = useState<TxData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [totalMinted, setTotalMinted] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const [mintedBook, setMintedBook] = useState(getRandomBook());
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // 查询交易状态
  const checkTxStatus = useCallback(async () => {
    if (!txHash) return;
    
    setIsRefreshing(true);
    setTxStatus('syncing');
    
    try {
      const result = await queryTransaction(txHash);
      setLastChecked(new Date());
      
      if (result.ok && result.data) {
        setTxData({
          status: result.data.status,
          tokenId: result.data.tokenId || '0',
          reader: result.data.reader || userAddress,
          contract: result.data.contract || '',
          txHash: result.data.txHash || txHash,
          cached: (result.data as any).cached,
        });
        
        if (result.data.status === 'SUCCESS') {
          setTxStatus('success');
          // 成功后模拟加载额外数据
          await mockDelay(500);
          setTotalMinted(Math.floor(Math.random() * 5000) + 1000);
          const randomLocation = MOCK_REGIONS[Math.floor(Math.random() * MOCK_REGIONS.length)];
          setUserLocation(randomLocation.name);
        } else if (result.data.status === 'FAILED') {
          setTxStatus('failed');
        } else {
          setTxStatus('pending');
        }
      }
    } catch (e: any) {
      console.error('查询交易状态失败:', e);
      setTxStatus('pending');
    } finally {
      setIsRefreshing(false);
    }
  }, [txHash, queryTransaction, userAddress]);

  // 初始加载
  useEffect(() => {
    if (initialStatus === 'pending') {
      // 如果是pending状态，显示同步中提示
      setTxStatus('pending');
    }
  }, [initialStatus]);

  // 加载「看广告领 Gas / 空投」插件（Conflux Faucet Plugin）
  useEffect(() => {
    // 仅在浏览器环境执行
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const SCRIPT_ID = 'conflux-faucet-plugin';
    // 避免重复插入
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'http://47.76.50.74/conflux-faucet-plugin.js';
    script.async = true;

    script.setAttribute('data-contract', '0x6CD9AFBCfC6cE793A4Ed3293127735B47DDD842B');
    script.setAttribute('data-server', 'http://whale3070.com:3000');
    script.setAttribute('data-position', 'bottom-right');
    script.setAttribute('data-text', 'Get Free CFX');
    script.setAttribute('data-color', '#1a2980');

    document.body.appendChild(script);
  }, []);


  const displayTokenId = txData?.tokenId && txData.tokenId !== '0' 
    ? `#${txData.tokenId}` 
    : '#---';

  // 待确认状态 UI
  if (txStatus === 'pending' || txStatus === 'syncing') {
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
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                <Clock className="w-8 h-8 text-amber-600 animate-pulse" />
              </div>
            </div>
            <h2 className="text-2xl font-black text-slate-800">交易已提交</h2>
            <p className="text-slate-500 text-sm">区块链数据同步中...</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className={`w-5 h-5 text-amber-600 ${txStatus === 'syncing' ? 'animate-spin' : ''}`} />
              <div>
                <p className="text-sm font-bold text-slate-800">等待区块确认</p>
                <p className="text-xs text-slate-500">通常需要 1-5 分钟完成铸造并通知所有区块</p>
              </div>
            </div>
            
            {txHash && (
              <div className="bg-white rounded-xl p-4 border border-amber-100">
                <p className="text-xs text-slate-400 uppercase font-semibold mb-1">交易哈希</p>
                <p className="text-xs text-slate-600 font-mono break-all">{txHash}</p>
              </div>
            )}

            {lastChecked && (
              <p className="text-xs text-slate-400 text-center">
                上次检查: {lastChecked.toLocaleTimeString()}
              </p>
            )}
          </div>

          <button
            onClick={checkTxStatus}
            disabled={isRefreshing}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold text-sm uppercase tracking-widest hover:from-indigo-600 hover:to-purple-600 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '正在查询...' : '刷新状态'}
          </button>

          <button
            onClick={checkTxStatus}
            disabled={isRefreshing}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-all"
          >
            <ExternalLink className="w-4 h-4" />
            链上哈希核验
          </button>

          <div className="text-center">
            <button 
              onClick={() => navigate('/bookshelf')}
              className="text-xs text-slate-400 hover:text-indigo-600 transition-colors uppercase tracking-widest"
            >
              返回书架
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 失败状态 UI
  if (txStatus === 'failed') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center py-12 px-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
            </div>
            <h2 className="text-2xl font-black text-slate-800">交易失败</h2>
            <p className="text-slate-500 text-sm">链上交易未能成功执行</p>
          </div>

          {txHash && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <p className="text-xs text-slate-400 uppercase font-semibold mb-1">交易哈希</p>
              <p className="text-xs text-slate-600 font-mono break-all">{txHash}</p>
            </div>
          )}

          <button
            onClick={() => navigate('/bookshelf')}
            className="w-full py-4 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm uppercase tracking-widest hover:bg-slate-200 transition-all"
          >
            返回书架
          </button>
        </div>
      </div>
    );
  }

  // 成功状态 UI
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
            <p className="text-xs text-slate-500 font-mono break-all">{txData?.reader || userAddress}</p>
          </div>
          {txData?.contract && (
            <div className="space-y-1">
              <span className="text-xs text-slate-400 uppercase font-semibold">合约地址</span>
              <p className="text-xs text-slate-500 font-mono break-all">{txData.contract}</p>
            </div>
          )}
          {txData?.cached && (
            <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded inline-block">
              ⚡ 缓存数据
            </div>
          )}
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

          <a 
            href="https://matrix.to/#/!jOcJpAxdUNYvaMZuqJ:matrix.org" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-4 bg-gradient-to-r from-pink-50 to-rose-50 border border-pink-200 p-4 rounded-2xl hover:from-pink-100 hover:to-rose-100 transition-all group text-left"
          >
            <div className="bg-pink-100 p-3 rounded-xl"><MessageCircle className="w-5 h-5 text-pink-600" /></div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">加入读者俱乐部</h4>
              <p className="text-xs text-pink-600">和作者、其他读者一起在线分享读书感想</p>
            </div>
          </a>

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
            <button 
              onClick={checkTxStatus}
              disabled={isRefreshing}
              className="text-xs text-slate-400 hover:text-indigo-600 transition-colors inline-flex items-center gap-1.5 uppercase tracking-widest disabled:opacity-50"
            >
              {isRefreshing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  查询中...
                </>
              ) : (
                <>
                  链上哈希核验 <ExternalLink className="w-3 h-3" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Success;
