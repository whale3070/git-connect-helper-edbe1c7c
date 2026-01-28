import React, { useState, useEffect } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser'; 

// --- 子组件：Leaderboard (社区贡献排行榜) ---
const Leaderboard: React.FC = () => {
  const [list, setList] = useState<{ address: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = async () => {
    try {
      // 请求后端统计接口（不带 address 参数获取全量排行榜）
      const res = await fetch('http://198.55.109.102:8080/relay/stats');
      const data = await res.json();
      
      if (data.ok && data.all_stats) {
        // 将 Redis 的 Hash 对象转为数组并按推荐次数从高到低排序
        const formattedList = Object.entries(data.all_stats).map(([addr, count]) => ({
          address: addr,
          count: parseInt(count as string, 10),
        })).sort((a, b) => b.count - a.count);
        
        setList(formattedList.slice(0, 10)); // 仅展示前 10 名
      }
    } catch (e) {
      console.error("排行榜抓取失败", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const timer = setInterval(fetchLeaderboard, 30000); // 每 30 秒轮询一次
    return () => clearInterval(timer);
  }, []);

  if (loading) return <div className="text-center text-slate-500 py-6 text-xs animate-pulse">同步金库排行中...</div>;

  return (
    <div className="mt-8 w-full bg-[#0f172a]/50 rounded-2xl border border-white/5 overflow-hidden shadow-inner">
      <div className="p-4 border-b border-white/5 bg-white/5 flex justify-between items-center">
        <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2">🏆 社区贡献榜</h3>
        <span className="text-[10px] text-slate-500">实时数据</span>
      </div>
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
              <div className="text-[9px] text-slate-600 uppercase">Successful Referrals</div>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="p-6 text-center text-xs text-slate-600 italic">虚位以待，快去推荐读者吧！</div>}
      </div>
    </div>
  );
};

// --- 主组件：Reward ---
const Reward: React.FC = () => {
  const [codes, setCodes] = useState<string[]>(['', '', '', '', '']);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', msg: string, txHash?: string } | null>(null);

  // 1. 处理图片上传并提取二维码
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatus({ type: 'info', msg: '正在解析二维码图片...' });

    const codeReader = new BrowserQRCodeReader();
    try {
      const imageUrl = URL.createObjectURL(file);
      const result = await codeReader.decodeFromImageUrl(imageUrl);
      const decodedText = result.getText();

      // 提取 HashCode
      const match = decodedText.match(/\/valut_mint_nft\/(0x[a-fA-F0-9]+|[a-fA-F0-9]+)/);
      
      if (match && match[1]) {
        const hashCode = match[1].toLowerCase(); 
        await verifyAndAddCode(hashCode);
      } else {
        setStatus({ type: 'error', msg: '无法识别有效书码：请扫描正版书籍二维码' });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: '解析失败：请确保二维码清晰且光线充足' });
    } finally {
      setLoading(false);
      e.target.value = ''; 
    }
  };

  // 2. 校验并自动填充槽位
  const verifyAndAddCode = async (h: string) => {
    try {
      const res = await fetch(`http://198.55.109.102:8080/secret/verify?codeHash=${h}`);
      const data = await res.json();

      if (res.ok && data.ok) {
        if (codes.includes(h)) {
          setStatus({ type: 'info', msg: '该书码已在列表中' });
          return;
        }

        const emptyIdx = codes.findIndex(c => c === '');
        if (emptyIdx !== -1) {
          const newCodes = [...codes];
          newCodes[emptyIdx] = h;
          setCodes(newCodes);
          setStatus({ type: 'success', msg: '正版验证成功！已自动填入' });
          
          // 如果用户填了地址，则同步到 Redis 暂存
          if (walletAddress) {
             fetch('http://198.55.109.102:8080/relay/save-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: walletAddress.toLowerCase(), codeHash: h })
             });
          }
        } else {
          setStatus({ type: 'error', msg: '5 个槽位已满，请先提交领取' });
        }
      } else {
        setStatus({ type: 'error', msg: '无效二维码：可能是盗版或已被使用' });
      }
    } catch (e) {
      setStatus({ type: 'error', msg: '服务器连接失败' });
    }
  };

  // 3. 提交领取奖励
  const handleSubmit = async () => {
    const finalCodes = codes.filter(c => c !== '');
    const cleanAddr = walletAddress.trim().toLowerCase();

    setLoading(true);
    setStatus({ type: 'info', msg: '正在请求国库发放 MON 奖励...' });

    try {
      const response = await fetch('http://198.55.109.102:8080/relay/reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dest: cleanAddr,
          codes: finalCodes
        })
      });

      const data = await response.json();
      if (data.ok) {
        // 请求成功后的推荐计数统计
        let currentCount = "1";
        try {
          const statsRes = await fetch(`http://198.55.109.102:8080/relay/stats?address=${cleanAddr}`);
          const statsData = await statsRes.json();
          if (statsData.ok) currentCount = statsData.count;
        } catch (e) { console.error(e); }

        setCodes(['', '', '', '', '']);
        setStatus({ 
          type: 'success', 
          msg: `🎉 领取成功！您已累计推荐 ${currentCount} 位读者。`,
          txHash: data.txHash 
        });

        alert(`恭喜！奖励已到账。\n您当前的累计推荐人数为：${currentCount} 人。`);
      } else {
        setStatus({ type: 'error', msg: data.error || '领取失败' });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: '通信失败，请检查网络' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#1e293b] p-8 rounded-2xl border border-white/10 shadow-2xl">
        <h2 className="text-2xl font-bold mb-6 text-center text-blue-400">🐳 拍照提取返利</h2>
        
        <div className="mb-8">
          <label className="block text-center p-6 border-2 border-dashed border-white/20 rounded-xl hover:border-blue-500 cursor-pointer transition-all bg-[#0f172a]/50">
            <span className="text-sm text-slate-400">{loading ? '通信中...' : '点击拍照或上传书籍二维码'}</span>
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
                 链上凭证: <a href={`https://explorer.monad.xyz/tx/${status.txHash}`} target="_blank" rel="noreferrer" className="underline font-mono">{status.txHash}</a>
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
                className="w-full bg-[#0f172a]/50 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-slate-500 italic"
                value={code}
              />
            ))}
          </div>
        </div>

        <button 
          onClick={handleSubmit} 
          className="mt-8 w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 py-4 rounded-xl font-bold disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 transition-all shadow-xl active:scale-95"
          disabled={loading || codes.filter(c => c).length < 5 || !walletAddress.startsWith('0x')}
        >
          {loading ? '正在处理数据...' : '集齐 5 码领取 0.001 MON'}
        </button>

        {/* 4. 集成排行榜组件 */}
        <Leaderboard />
      </div>
      
      <p className="mt-6 text-[10px] text-slate-500 font-mono">Whale Vault Protocol v1.0 • Powering Monad Ecosystem</p>
    </div>
  );
};

export default Reward;
