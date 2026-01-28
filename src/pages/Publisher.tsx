import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const Publisher: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [opLoading, setOpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 书籍状态
  const [bookName, setBookName] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [symbol, setSymbol] = useState<string>('');
  const [contractAddr, setContractAddr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(100);
  const [showRechargeGuide, setShowRechargeGuide] = useState<boolean>(false);
  
  // 出版社地址（从本地缓存获取）
  const [pubAddress, setPubAddress] = useState<string>('');

  // --- 核心：无感知准入检查 ---
  useEffect(() => {
    const authAddr = localStorage.getItem('vault_pub_auth');
    const authRole = localStorage.getItem('vault_user_role');

    if (!authAddr || authRole !== 'publisher') {
      // 如果没有经过首页验证，或者角色不对，静默重定向
      navigate('/', { replace: true });
    } else {
      setPubAddress(authAddr);
      setLoading(false);
    }
  }, [navigate]);

  // --- 部署合约逻辑 ---
  const handleDeployContract = async () => {
    if (!bookName || !symbol) {
      setError("请完整填写书籍名称和代码");
      return;
    }

    setOpLoading(true);
    setError(null);
    setShowRechargeGuide(false);

    try {
      const response = await fetch('http://198.55.109.102:8080/api/v1/factory/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bookName,
          author: author,
          symbol: symbol.toUpperCase(),
          address: pubAddress // 使用本地缓存的已验证地址
        }),
      });

      const data = await response.json();

      if (response.status === 402) {
        setError(data.error);
        setShowRechargeGuide(true);
        return;
      }

      if (!data.ok) throw new Error(data.error || "部署失败");

      setContractAddr(data.address);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setOpLoading(false);
    }
  };

  // --- 批量生成码逻辑 ---
  const handleGenerateBatch = async () => {
    if (!contractAddr) return;
    setOpLoading(true);
    setError(null);

    try {
      const apiUrl = `http://198.55.109.102:8080/admin/generate?count=${count}&contract=${contractAddr}`;
      const response = await fetch(apiUrl, { method: 'GET' });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${symbol}_Codes_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err: any) {
      setError(err.message || "生成失败");
    } finally {
      setOpLoading(false);
    }
  };

  // 验证中显示黑色背景，防止 UI 闪现
  if (loading) {
    return <div className="min-h-screen bg-[#0b0e11]"></div>;
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#1e293b] p-8 rounded-3xl border border-white/10 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent italic">
            PUBLISHER TERMINAL
          </h1>
          <p className="text-slate-500 text-[10px] uppercase tracking-widest mt-1">
            已验证出版社: {pubAddress.slice(0, 6)}...{pubAddress.slice(-4)}
          </p>
        </div>

        <div className="space-y-4">
          <div className="p-5 bg-white/5 rounded-2xl border border-white/5 space-y-3">
            <p className="text-[10px] uppercase text-cyan-400 font-bold">Step 1: 录入书籍信息</p>
            <input 
              placeholder="书籍名称" 
              className="w-full bg-[#0f172a] border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-cyan-500"
              value={bookName} onChange={(e) => setBookName(e.target.value)}
            />
            <input 
              placeholder="书籍代码 (Symbol)" 
              className="w-full bg-[#0f172a] border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-cyan-500"
              value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
            <button 
              onClick={handleDeployContract}
              disabled={opLoading || !!contractAddr}
              className={`w-full py-3 rounded-xl text-xs font-bold transition-all ${
                contractAddr ? 'bg-green-500/20 text-green-400' : 'bg-white text-black hover:bg-slate-200'
              }`}
            >
              {opLoading ? '处理中...' : contractAddr ? '✓ 合约已部署' : '部署书籍合约 (10 CFX)'}
            </button>
          </div>

          {showRechargeGuide && (
            <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl text-[11px] text-orange-300">
              ⚠️ {error}
            </div>
          )}

          <div className={`p-5 rounded-2xl border transition-all ${contractAddr ? 'bg-white/5 border-white/10' : 'opacity-20 pointer-events-none'}`}>
            <p className="text-[10px] uppercase text-cyan-400 font-bold mb-3">Step 2: 生成激活码</p>
            <input 
              type="number" 
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 0)}
              className="w-full bg-[#0f172a] border border-white/10 rounded-xl px-4 py-3 text-2xl font-mono outline-none"
            />
            <button 
              onClick={handleGenerateBatch}
              className="w-full mt-4 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 font-bold text-xs"
            >
              生成并下载 ZIP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Publisher;