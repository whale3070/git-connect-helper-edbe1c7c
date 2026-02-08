//input_hashcode_Reward.tsx 非常值得保留
//它是你将来： 无扫码环境，API 被限制，B 端后台版本，的「备用方案」
import React, { useState, useEffect } from 'react';

const Reward: React.FC = () => {
  const [codes, setCodes] = useState<string[]>(['', '', '', '', '']);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<{ txHash?: string; error?: string; info?: string } | null>(null);

  // 当输入地址后，自动从 Redis 拉取已保存的码
  const fetchSavedCodes = async (address: string) => {
    if (!address.startsWith('0x') || address.length < 42) return;
    try {
      const res = await fetch(`/relay/get-saved?address=${address}`);
      const data = await res.json();
      if (data.codes && Array.isArray(data.codes)) {
        const newCodes = ['', '', '', '', ''];
        data.codes.forEach((c: string, i: number) => { if (i < 5) newCodes[i] = c; });
        setCodes(newCodes);
      }
    } catch (e) { 
      console.error("获取暂存失败", e); 
    }
  };

  // 单个保存逻辑：存入 Redis 暂存集合
  const handleSaveSingle = async (index: number) => {
    const code = codes[index];
    if (!code || !walletAddress) {
      setResult({ error: '请先填写地址和该位置的书码' });
      return;
    }

    try {
      const response = await fetch('/relay/save-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress, codeHash: code })
      });
      const data = await response.json();
      if (data.ok) {
        setResult({ info: `书码 ${index + 1} 保存成功！当前已暂存 ${data.count || ''} 个` });
      } else {
        setResult({ error: data.error || '保存失败' });
      }
    } catch (err) {
      setResult({ error: '后端连接失败，请检查 8080 端口是否启动' });
    }
  };

  // 最终兑换逻辑：集齐 5 码后调用合约转账
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codes.some(c => !c) || !walletAddress) return;
    
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/relay/reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dest: walletAddress,
          codes: codes
        })
      });
      const data = await response.json();
      if (data.ok) {
        setResult({ info: '恭喜！0.001 MON 奖励已发放到您的钱包', txHash: data.txHash });
      } else {
        setResult({ error: data.error || '兑换失败' });
      }
    } catch (err) {
      setResult({ error: '网络错误，请稍后再试' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#1e293b] p-8 rounded-2xl shadow-2xl border border-white/10">
        <h2 className="text-2xl font-bold mb-6 text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
          🐳 鲸鱼金库：5 码换返利
        </h2>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-400 mb-2">您的收款钱包地址:</label>
          <input
            type="text"
            className="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            placeholder="0x..."
            value={walletAddress}
            onChange={(e) => {
              setWalletAddress(e.target.value);
              fetchSavedCodes(e.target.value);
            }}
          />
        </div>

        <div className="space-y-4">
          {codes.map((code, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={`书码 ${index + 1}`}
                value={code}
                onChange={(e) => {
                  const newCodes = [...codes];
                  newCodes[index] = e.target.value.trim();
                  setCodes(newCodes);
                }}
              />
              <button 
                onClick={() => handleSaveSingle(index)}
                className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition-colors"
              >
                保存
              </button>
            </div>
          ))}
        </div>

        <button 
          onClick={handleSubmit}
          disabled={loading || codes.filter(c => c).length < 5}
          className="mt-8 w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-slate-600 disabled:to-slate-600 py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95"
        >
          {loading ? '处理中...' : '集齐 5 码，立即领取奖励'}
        </button>

        {result?.info && <div className="mt-4 p-3 bg-cyan-500/20 border border-cyan-500/50 text-cyan-400 rounded-lg text-sm">ℹ️ {result.info}</div>}
        {result?.error && <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg text-sm">❌ {result.error}</div>}
        {result?.txHash && (
          <div className="mt-4 p-3 bg-green-500/20 border border-green-500/50 text-green-400 rounded-lg text-xs break-all">
            ✅ 交易已发送: <br/>
            <a href={`https://testnet.monadexplorer.com/tx/${result.txHash}`} target="_blank" rel="noreferrer" className="underline">
              {result.txHash}
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

// 关键修复：确保有默认导出
export default Reward;
