import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../config/backend';
import { useBookFactory } from '@/hooks/useBookFactory';
import { EXPLORER_URL } from '@/config/chain';

// 书籍销量数据结构
interface BookSales {
  address: string;
  symbol: string;
  name: string;
  author: string;
  sales: number;
  explorerUrl: string;
}

// 地区排名数据结构
interface RegionRank {
  region: string;
  count: number;
}

const Publisher: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [opLoading, setOpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'addBook' | 'qrcode' | 'analytics'>('overview');
  
  // 书籍状态
  const [bookName, setBookName] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [symbol, setSymbol] = useState<string>('');
  const [contractAddr, setContractAddr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(100);
  const [showRechargeGuide, setShowRechargeGuide] = useState<boolean>(false);
  
  // 出版社地址（从本地缓存获取）
  const [pubAddress, setPubAddress] = useState<string>('');
  
  // 钱包余额状态
  const [balanceCFX, setBalanceCFX] = useState<number>(0);
  const [maxDeploys, setMaxDeploys] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(true);

  // 销量数据
  const [bookSales, setBookSales] = useState<BookSales[]>([]);
  const [regionRanks, setRegionRanks] = useState<RegionRank[]>([]);
  const [totalSales, setTotalSales] = useState<number>(0);

  // --- 核心：无感知准入检查 ---
  useEffect(() => {
    const authAddr = localStorage.getItem('vault_pub_auth');
    const authRole = localStorage.getItem('vault_user_role');

    if (!authAddr || authRole !== 'publisher') {
      navigate('/', { replace: true });
    } else {
      setPubAddress(authAddr);
      setLoading(false);
      fetchDashboardData();
    }
  }, [navigate]);

  // --- 获取出版社余额 ---
  const fetchPublisherBalance = async () => {
    setBalanceLoading(true);
    try {
      const codeHash = localStorage.getItem('vault_code_hash');
      console.log('[Publisher] Fetching balance with codeHash:', codeHash);
      
      if (!codeHash) {
        console.warn('[Publisher] No vault_code_hash in localStorage');
        setBalanceLoading(false);
        return;
      }
      
      const url = `${BACKEND_URL}/api/v1/publisher/balance?codeHash=${codeHash}`;
      console.log('[Publisher] Balance API URL:', url);
      
      const res = await fetch(url);
      const data = await res.json();
      console.log('[Publisher] Balance API response:', data);
      
      if (res.ok && data.ok) {
        setBalanceCFX(data.balance || 0);
        setMaxDeploys(data.maxDeploys || 0);
      } else {
        console.error('[Publisher] Balance API error:', data.error);
      }
    } catch (err) {
      console.error('[Publisher] Balance fetch error:', err);
    } finally {
      setBalanceLoading(false);
    }
  };

  // --- 获取仪表盘数据 ---
  const fetchDashboardData = async () => {
    try {
      // 先获取余额
      fetchPublisherBalance();
      
      // 获取书籍大盘数据
      const tickersRes = await fetch(`${BACKEND_URL}/api/v1/market/tickers?page=1`);
      if (tickersRes.ok) {
        const tickers = await tickersRes.json();
        const salesData: BookSales[] = (tickers || []).map((t: any) => ({
          address: t.address || '',
          symbol: t.symbol || 'N/A',
          name: t.name?.zh || t.name?.en || '未知书籍',
          author: t.author?.zh || t.author?.en || '未知作者',
          sales: t.sales || 0,
          // Conflux eSpace Testnet 区块链浏览器链接
          explorerUrl: `https://evmtestnet.confluxscan.io/address/${t.address}`
        }));
        setBookSales(salesData);
        setTotalSales(salesData.reduce((acc, b) => acc + b.sales, 0));
      }

      // 获取地区分布数据
      const distRes = await fetch(`${BACKEND_URL}/api/v1/analytics/distribution`);
      if (distRes.ok) {
        const distData = await distRes.json();
        // 按数量排序，取前10
        const ranked: RegionRank[] = (distData || [])
          .map((d: any) => ({ region: d.name || '未知', count: d.value?.[2] || 0 }))
          .sort((a: RegionRank, b: RegionRank) => b.count - a.count)
          .slice(0, 10);
        setRegionRanks(ranked);
      }
    } catch (err) {
      console.error('Dashboard data fetch error:', err);
    }
  };

  // 使用 BookFactory Hook
  const { deployBook, getExplorerLink, isLoading: walletLoading, error: walletError } = useBookFactory();

  // --- 部署合约逻辑 (改为前端直连钱包) ---
  const handleDeployContract = async () => {
    if (!bookName || !symbol) {
      setError("请完整填写书籍名称和代码");
      return;
    }

    setOpLoading(true);
    setError(null);
    setShowRechargeGuide(false);

    try {
      // 调用工厂合约部署新书 (通过 MetaMask)
      const result = await deployBook({
        bookName: bookName,
        symbol: symbol.toUpperCase(),
        authorName: author || '未知作者',
        baseURI: 'https://arweave.net/metadata', // 默认元数据 URI
        relayer: undefined // 不设置 relayer
      });

      // 部署成功，显示交易哈希
      setContractAddr(result.txHash);
      // 刷新数据
      setTimeout(() => fetchDashboardData(), 5000); // 等待链上确认
    } catch (err: any) {
      if (err.message.includes('user rejected') || err.message.includes('User denied')) {
        setError("用户取消了交易");
      } else if (err.message.includes('insufficient funds')) {
        setError("CFX 余额不足，请先充值");
        setShowRechargeGuide(true);
      } else {
        setError(err.message || "部署失败");
      }
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
      const apiUrl = `${BACKEND_URL}/admin/generate?count=${count}&contract=${contractAddr}`;
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

  if (loading) {
    return <div className="min-h-screen bg-[#0b0e11]"></div>;
  }

  // 退出登录
  const handleLogout = () => {
    localStorage.removeItem('vault_pub_auth');
    localStorage.removeItem('vault_user_role');
    localStorage.removeItem('vault_code_hash');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white">
      {/* 顶部导航栏 */}
      <header className="bg-[#131722] border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                PUBLISHER TERMINAL
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">
                {pubAddress.slice(0, 6)}...{pubAddress.slice(-4)}
              </p>
            </div>
            {/* 钱包余额显示 */}
            <div className="flex items-center gap-4 px-4 py-2 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 rounded-xl">
              <div className="text-center">
                <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider">CFX 余额</p>
                <p className="text-lg font-bold text-emerald-400">
                  {balanceLoading ? '...' : balanceCFX.toFixed(2)}
                </p>
              </div>
              <div className="w-px h-8 bg-white/10"></div>
              <div className="text-center">
                <p className="text-[10px] text-cyan-400/70 uppercase tracking-wider">可部署次数</p>
                <p className="text-lg font-bold text-cyan-400">
                  {balanceLoading ? '...' : maxDeploys}
                </p>
              </div>
              <button 
                onClick={fetchPublisherBalance}
                className="ml-2 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                title="刷新余额"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              {(['overview', 'addBook', 'qrcode', 'analytics'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                    activeTab === tab 
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab === 'overview' && '📊 销量总览'}
                  {tab === 'addBook' && '📚 新增图书'}
                  {tab === 'qrcode' && '🔗 生成二维码'}
                  {tab === 'analytics' && '🗺️ 热力分析'}
                </button>
              ))}
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {/* === 销量总览 Tab === */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* 统计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-blue-600/20 to-blue-800/10 border border-blue-500/20 rounded-2xl p-6">
                <p className="text-blue-400 text-xs uppercase tracking-wider mb-1">总销量 (NFT Minted)</p>
                <p className="text-4xl font-black text-white">{totalSales.toLocaleString()}</p>
              </div>
              <div className="bg-gradient-to-br from-cyan-600/20 to-cyan-800/10 border border-cyan-500/20 rounded-2xl p-6">
                <p className="text-cyan-400 text-xs uppercase tracking-wider mb-1">上架图书数</p>
                <p className="text-4xl font-black text-white">{bookSales.length}</p>
              </div>
              <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/10 border border-purple-500/20 rounded-2xl p-6">
                <p className="text-purple-400 text-xs uppercase tracking-wider mb-1">覆盖地区</p>
                <p className="text-4xl font-black text-white">{regionRanks.length}</p>
              </div>
            </div>

            {/* 图书销量表格 */}
            <div className="bg-[#131722] border border-white/5 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/5">
                <h2 className="text-sm font-bold text-white">📖 图书销量排行</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase">排名</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase">代码</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase">书名</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase">作者</th>
                      <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-400 uppercase">销量</th>
                      <th className="px-4 py-3 text-center text-[10px] font-bold text-slate-400 uppercase">合约</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {bookSales.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-slate-500 text-sm">
                          暂无图书数据，请先上架图书
                        </td>
                      </tr>
                    ) : (
                      bookSales.map((book, idx) => (
                        <tr key={book.address} className="hover:bg-white/5 transition-colors">
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                              idx === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                              idx === 1 ? 'bg-slate-400/20 text-slate-300' :
                              idx === 2 ? 'bg-orange-500/20 text-orange-400' :
                              'bg-white/5 text-slate-500'
                            }`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-4 py-4 font-mono text-cyan-400 text-sm">{book.symbol}</td>
                          <td className="px-4 py-4 text-white text-sm">{book.name}</td>
                          <td className="px-4 py-4 text-slate-400 text-sm">{book.author}</td>
                          <td className="px-4 py-4 text-right font-mono text-lg text-green-400">{book.sales.toLocaleString()}</td>
                          <td className="px-4 py-4 text-center">
                            <a 
                              href={book.explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg text-xs text-purple-400 hover:text-purple-300 transition-all"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              查看
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* === 新增图书 Tab === */}
        {activeTab === 'addBook' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-[#131722] border border-white/5 rounded-2xl p-8">
              <h2 className="text-lg font-bold text-white mb-6">📚 部署新书 NFT 合约</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-2 uppercase">书籍名称</label>
                  <input 
                    placeholder="例：区块链技术原理" 
                    className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500 transition-colors"
                    value={bookName} 
                    onChange={(e) => setBookName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-2 uppercase">作者名称</label>
                  <input 
                    placeholder="例：张三" 
                    className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500 transition-colors"
                    value={author} 
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-2 uppercase">书籍代码 (Symbol)</label>
                  <input 
                    placeholder="例：BLOCKCHAIN" 
                    className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-cyan-500 transition-colors"
                    value={symbol} 
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  />
                </div>

                {showRechargeGuide && (
                  <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-sm text-orange-300">
                    ⚠️ {error}
                  </div>
                )}

                {error && !showRechargeGuide && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300">
                    ❌ {error}
                  </div>
                )}

                {contractAddr && (
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <p className="text-green-400 text-sm font-medium">✅ 合约部署成功</p>
                    <p className="text-green-300/70 text-xs font-mono mt-1 break-all">{contractAddr}</p>
                  </div>
                )}

                <button 
                  onClick={handleDeployContract}
                  disabled={opLoading || !!contractAddr}
                  className={`w-full py-4 rounded-xl text-sm font-bold transition-all ${
                    contractAddr 
                      ? 'bg-green-500/20 text-green-400 cursor-default' 
                      : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:from-blue-500 hover:to-cyan-500'
                  }`}
                >
                  {opLoading ? '处理中...' : contractAddr ? '✓ 合约已部署' : '部署书籍合约 (需持有 10 CFX)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === 生成二维码 Tab === */}
        {activeTab === 'qrcode' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-[#131722] border border-white/5 rounded-2xl p-8">
              <h2 className="text-lg font-bold text-white mb-6">🔗 批量生成激活码</h2>
              
              {!contractAddr ? (
                <div className="text-center py-8">
                  <p className="text-slate-400 mb-4">请先在「新增图书」中部署合约</p>
                  <button 
                    onClick={() => setActiveTab('addBook')}
                    className="px-6 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg text-sm"
                  >
                    前往部署
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
                    <p className="text-cyan-400 text-xs uppercase mb-1">当前合约地址</p>
                    <p className="text-white font-mono text-sm break-all">{contractAddr}</p>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-2 uppercase">生成数量 (1-500)</label>
                    <input 
                      type="number" 
                      min={1}
                      max={500}
                      value={count}
                      onChange={(e) => setCount(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-4 text-3xl font-mono text-center outline-none focus:border-cyan-500"
                    />
                  </div>

                  <button 
                    onClick={handleGenerateBatch}
                    disabled={opLoading}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 font-bold text-sm hover:from-purple-500 hover:to-pink-500 transition-all"
                  >
                    {opLoading ? '生成中...' : `生成 ${count} 个二维码 并下载 ZIP`}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* === 热力分析 Tab === */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* 地区销量排行 */}
            <div className="bg-[#131722] border border-white/5 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/5">
                <h2 className="text-sm font-bold text-white">🏆 地区读者排行榜</h2>
              </div>
              <div className="p-6">
                {regionRanks.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">暂无地区数据</p>
                ) : (
                  <div className="space-y-3">
                    {regionRanks.map((r, idx) => (
                      <div key={r.region} className="flex items-center gap-4">
                        <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${
                          idx === 0 ? 'bg-yellow-500 text-black' :
                          idx === 1 ? 'bg-slate-400 text-black' :
                          idx === 2 ? 'bg-orange-600 text-white' :
                          'bg-white/10 text-slate-400'
                        }`}>
                          {idx + 1}
                        </span>
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-white font-medium">{r.region}</span>
                            <span className="text-cyan-400 font-mono">{r.count.toLocaleString()} 人</span>
                          </div>
                          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all"
                              style={{ width: `${(r.count / (regionRanks[0]?.count || 1)) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 热力地图入口 */}
            <div className="bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border border-cyan-500/20 rounded-2xl p-8 text-center">
              <h3 className="text-xl font-bold text-white mb-2">🌍 全球读者热力地图</h3>
              <p className="text-slate-400 text-sm mb-6">可视化查看全球读者分布情况</p>
              <button 
                onClick={() => navigate('/Heatmap')}
                className="px-8 py-3 bg-cyan-500 text-black font-bold rounded-xl hover:bg-cyan-400 transition-colors"
              >
                打开热力地图
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Publisher;
