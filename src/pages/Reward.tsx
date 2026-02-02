import React, { useState, useEffect } from 'react';
import { useAppMode } from '../contexts/AppModeContext';
import { useApi } from '../hooks/useApi';
import { getRandomBook } from '../data/mockData';
import { showToast, ToastContainer } from '../components/ui/CyberpunkToast';

// --- 子组件：Leaderboard (社区贡献排行榜) ---
const Leaderboard: React.FC = () => {
  const { isMockMode } = useAppMode();
  const { getLeaderboard } = useApi();
  const [list, setList] = useState<{ address: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadLeaderboard = async () => {
      try {
        const result = await getLeaderboard();
        if (result.ok && result.all_stats) {
          const formattedList = Object.entries(result.all_stats)
            .map(([addr, count]) => ({
              address: addr,
              count: parseInt(count as string, 10),
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          setList(formattedList);
        }
      } catch (e: any) {
        console.error('加载排行榜失败:', e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadLeaderboard();
    
    // 非 Mock 模式下每 30 秒刷新
    if (!isMockMode) {
      const timer = setInterval(loadLeaderboard, 30000);
      return () => clearInterval(timer);
    }
  }, [getLeaderboard, isMockMode]);

  if (loading) return <div className="text-center text-slate-500 py-6 text-xs animate-pulse">同步排行中...</div>;

  return (
    <div className="mt-8 w-full bg-[#0f172a]/50 rounded-2xl border border-white/5 overflow-hidden shadow-inner">
      <div className="p-4 border-b border-white/5 bg-white/5 flex justify-between items-center">
        <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2">🏆 社区贡献榜</h3>
        <span className={`text-[10px] ${isMockMode ? 'text-cyan-400' : 'text-green-400'}`}>
          {isMockMode ? 'Mock' : 'Live'}
        </span>
      </div>
      {error && (
        <div className="p-3 bg-red-500/10 text-red-400 text-xs">{error}</div>
      )}
      <div className="divide-y divide-white/5">
        {list.map((item, index) => (
          <div key={item.address} className="flex items-center justify-between p-3 hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full ${
                index === 0 ? 'bg-yellow-500 text-black' : 
                index === 1 ? 'bg-slate-300 text-black' :
                index === 2 ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}>
                {index + 1}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {item.address.slice(0, 6)}...{item.address.slice(-4)}
              </span>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-blue-400">{item.count} 次</div>
              <div className="text-[9px] text-slate-600 uppercase">Referrals</div>
            </div>
          </div>
        ))}
        {list.length === 0 && !error && (
          <div className="p-4 text-center text-xs text-slate-600">暂无推荐记录</div>
        )}
      </div>
    </div>
  );
};

// --- 主组件：Reward ---
const Reward: React.FC = () => {
  const { isMockMode, apiBaseUrl } = useAppMode();
  const { saveCode, claimReward, verifyCode } = useApi();
  
  const [codes, setCodes] = useState<string[]>(['', '', '', '', '']);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', msg: string, txHash?: string } | null>(null);

  // 处理图片上传并解析二维码
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatus({ type: 'info', msg: '正在解析二维码图片...' });

    // TODO: 实际应该使用 @zxing/browser 解析二维码
    // 这里暂时模拟生成一个 hash
    await new Promise(resolve => setTimeout(resolve, 1500));
    const fakeHashCode = `0x${Math.random().toString(16).slice(2, 34)}`;
    
    await verifyAndAddCode(fakeHashCode);
    
    setLoading(false);
    e.target.value = '';
  };

  // 校验并自动填充槽位
  const verifyAndAddCode = async (h: string) => {
    try {
      // 验证二维码有效性
      const verifyResult = await verifyCode(h);
      
      if (!verifyResult.ok) {
        setStatus({ type: 'error', msg: verifyResult.error || '无效的二维码' });
        return;
      }
      
      if (codes.includes(h)) {
        setStatus({ type: 'info', msg: '该书码已在列表中' });
        return;
      }

      const emptyIdx = codes.findIndex(c => c === '');
      if (emptyIdx === -1) {
        setStatus({ type: 'error', msg: '5 个槽位已满，请先提交领取' });
        return;
      }

      // 保存书码到后端
      if (walletAddress) {
        try {
          await saveCode(h, walletAddress);
        } catch (e) {
          console.warn('保存书码到后端失败:', e);
        }
      }

      const newCodes = [...codes];
      newCodes[emptyIdx] = h;
      setCodes(newCodes);
      
      const book = getRandomBook();
      setStatus({ type: 'success', msg: `验证成功！《${book.title}》已自动填入` });
    } catch (e: any) {
      console.error('验证书码失败:', e);
      setStatus({ type: 'error', msg: e.message || '验证失败，请重试' });
    }
  };

  // 提交领取奖励
  const handleSubmit = async () => {
    const finalCodes = codes.filter(c => c !== '');
    const cleanAddr = walletAddress.trim().toLowerCase();

    if (finalCodes.length < 5) {
      showToast('请先集齐 5 个书码', 'warning');
      return;
    }

    if (!cleanAddr.startsWith('0x')) {
      showToast('请输入有效的钱包地址', 'warning');
      return;
    }

    setLoading(true);
    setStatus({ type: 'info', msg: '正在发放 MON 奖励...' });

    try {
      const result = await claimReward(cleanAddr);
      
      if (result.ok && result.data) {
        setCodes(['', '', '', '', '']);
        setStatus({ 
          type: 'success', 
          msg: `🎉 领取成功！您已累计推荐 ${result.data.count} 位读者。`,
          txHash: result.data.tx_hash
        });
        showToast(`🎉 奖励已发放！累计推荐 ${result.data.count} 人`, 'success', result.data.tx_hash);
      } else {
        throw new Error((result as any).error || '领取失败');
      }
    } catch (e: any) {
      console.error('领取奖励失败:', e);
      setStatus({ type: 'error', msg: e.message || '领取失败，请重试' });
      showToast(e.message || '领取失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4">
      <ToastContainer />
      
      <div className="max-w-md w-full bg-[#1e293b] p-8 rounded-2xl border border-white/10 shadow-2xl">
        <h2 className="text-2xl font-bold mb-2 text-center text-blue-400">🐳 拍照提取返利</h2>
        
        {/* 模式标识 */}
        <div className={`${isMockMode ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-green-500/10 border-green-500/20'} border rounded-lg p-2 text-center mb-6`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${isMockMode ? 'text-cyan-400' : 'text-green-400'}`}>
            {isMockMode ? '🔧 Demo Mode - Mock Data' : `🟢 Dev API - ${apiBaseUrl}`}
          </p>
        </div>
        
        <div className="mb-8">
          <label className="block text-center p-6 border-2 border-dashed border-white/20 rounded-xl hover:border-blue-500 cursor-pointer transition-all bg-[#0f172a]/50">
            <span className="text-sm text-slate-400">{loading ? '处理中...' : '点击上传二维码图片'}</span>
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              className="hidden" 
              onChange={handleFileUpload}
              disabled={loading}
            />
          </label>
        </div>

        {status && (
          <div className={`mb-4 p-3 rounded-lg text-xs break-all ${
            status.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
            status.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 
            'bg-blue-500/20 text-blue-400 border border-blue-500/30'
          }`}>
            <div className="font-bold mb-1">{status.msg}</div>
            {status.txHash && (
               <div className="mt-2 text-[10px] opacity-70">
                 TX: <span className="font-mono">{status.txHash.slice(0, 20)}...</span>
               </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <input
            type="text"
            placeholder="您的收款钱包地址 (0x...)"
            className="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
          />

          <div className="grid grid-cols-1 gap-2">
            {codes.map((code, index) => (
              <input
                key={index}
                type="text"
                readOnly
                placeholder={`待填充书码 ${index + 1}`}
                className={`w-full bg-[#0f172a]/50 border rounded-lg px-3 py-2 text-[10px] italic ${
                  code ? 'border-green-500/30 text-green-400' : 'border-white/5 text-slate-500'
                }`}
                value={code ? `${code.slice(0, 16)}...` : ''}
              />
            ))}
          </div>
        </div>

        <button 
          onClick={handleSubmit} 
          className="mt-8 w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 py-4 rounded-xl font-bold disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 transition-all shadow-xl active:scale-95"
          disabled={loading || codes.filter(c => c).length < 5 || !walletAddress.startsWith('0x')}
        >
          {loading ? '正在处理...' : '集齐 5 码领取 0.001 MON'}
        </button>

        <Leaderboard />
      </div>
      
      <p className="mt-6 text-[10px] text-slate-500 font-mono">
        Whale Vault Protocol • {isMockMode ? 'DEMO MODE' : 'DEV API'}
      </p>
    </div>
  );
};

export default Reward;
