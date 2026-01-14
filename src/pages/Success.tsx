import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, ExternalLink, PartyPopper, Wallet, BookOpen, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const Success = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const txHash = searchParams.get('txHash');
  const userAddress = searchParams.get('address') || '未知持有人';
  const rawTokenId = searchParams.get('token_id');
  const displayTokenId = (!rawTokenId || rawTokenId === '0') ? '最新生成' : `#${rawTokenId}`;

  const [isLoading, setIsLoading] = useState(true);
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    // 1. 模拟加载动画
    const timer = setTimeout(() => setIsLoading(false), 1500);

    // 2. 从后端 API 动态获取销量数据
    fetch('http://198.55.109.102:8080/api/v1/stats/sales')
      .then(res => {
        if (!res.ok) throw new Error('网络响应错误');
        return res.json();
      })
      .then(data => {
        // 确保数据是数组且格式正确
        setChartData(data);
      })
      .catch(err => {
        console.error("获取统计数据失败:", err);
      });

    return () => clearTimeout(timer);
  }, []);

  // 定义钱包导入逻辑
  const importToWallet = async () => {
    if (!window.ethereum) return alert('请先安装 SubWallet 或 MetaMask');
    try {
      await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC721',
          options: {
            address: '0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d',
            tokenId: rawTokenId || '0',
          },
        },
      });
    } catch (error) {
      console.error('导入失败', error);
      alert('无法唤起钱包，请检查插件状态');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center font-sans">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 font-medium">正在同步物理存证...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-[#1e293b] border border-slate-700 rounded-3xl p-8 shadow-2xl relative">
        
        <div className="text-center space-y-8 animate-in fade-in zoom-in duration-500">
          {/* 状态图标 */}
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

            <button 
              onClick={importToWallet}
              className="mt-2 w-full py-2 flex items-center justify-center gap-2 border border-blue-500/30 text-blue-400 text-xs rounded-xl hover:bg-blue-500/10 transition-all"
            >
              <Wallet className="w-4 h-4" /> 将勋章导入钱包私藏
            </button>
          </div>

          {/* 销量线型图组件 */}
          {chartData.length > 0 && (
            <div className="bg-slate-900/40 border border-slate-700/50 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 px-1">
                <TrendingUp className="w-4 h-4 text-blue-400" />
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">金库协议 1.0 链上实时销量曲线</span>
              </div>
              
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                    <XAxis 
                      dataKey="date" 
                      hide={true} // 隐藏底部坐标轴保持简洁
                    />
                    <YAxis 
                      hide={true} // 隐藏左侧坐标轴
                      domain={['dataMin - 5', 'dataMax + 5']} 
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '10px' }}
                      itemStyle={{ color: '#60a5fa' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="sales" 
                      stroke="#3b82f6" 
                      strokeWidth={3} 
                      dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5, fill: '#60a5fa' }}
                      animationDuration={2000}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between px-1">
                <span className="text-[9px] text-slate-500 font-medium">起始发行</span>
                <span className="text-[9px] text-slate-500 font-medium">最新数据: {chartData[chartData.length - 1].sales} 份</span>
              </div>
            </div>
          )}

          {/* 操作区 */}
          <div className="space-y-3">
            <button 
              onClick={() => window.location.href = 'https://matrix.to/#/!jOcJpAxdUNYvaMZuqJ:matrix.org?via=matrix.org'} 
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl font-bold transition-all shadow-lg active:scale-95"
            >
              立即进入私域频道
            </button>

            <button 
              onClick={() => window.open('https://xmnw3y5jxoataadrf5uz6kd4fzb4jlbk7a6feyvjrdij2zy3zqja.arweave.net/uxtt46m7gTAAcS9pnyh8LkPErCr4PFJiqYjQnWcbzBI', '_blank')} 
              className="w-full py-4 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-blue-400 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 group"
            >
              <BookOpen className="w-5 h-5 text-blue-400" /> 领取永久存储资料 (Arweave)
              <ExternalLink className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          </div>

          {/* Subscan 验证链接 */}
          <div className="pt-2">
            <a 
              href="https://moonbase.subscan.io/token/0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-400/80 hover:text-blue-400 text-[10px] font-bold uppercase tracking-widest transition-colors"
            >
              📊 查看全网持有者分布 (Subscan) <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* 底部存证链接 */}
        {txHash && (
          <div className="mt-8 pt-6 border-t border-slate-800 text-center">
            <a 
              href={`https://moonbase.moonscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-500 hover:text-blue-400 flex items-center justify-center gap-1.5"
            >
              在 Moonscan 查验物理存证 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
      
      <p className="mt-6 text-slate-600 text-[10px] tracking-widest font-bold uppercase">Whale Vault • Decentralized Identity System</p>
    </div>
  );
};

export default Success;