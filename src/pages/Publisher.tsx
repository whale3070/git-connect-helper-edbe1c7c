import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '../contexts/AppModeContext';
import { useApi } from '../hooks/useApi';
import { MOCK_BOOKS, MOCK_REGIONS, generateFakeTxHash, getTotalSales } from '../data/mockData';
import { showToast, ToastContainer } from '../components/ui/CyberpunkToast';

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
  const { isMockMode, apiBaseUrl } = useAppMode();
  const { deployBook, getPublisherBalance, fetchHeatmapData } = useApi();
  
  const [loading, setLoading] = useState(true);
  const [opLoading, setOpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'addBook' | 'qrcode' | 'analytics'>('overview');
  
  // 书籍状态
  const [bookName, setBookName] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [symbol, setSymbol] = useState<string>('');
  const [serial, setSerial] = useState<string>('');
  const [privKey, setPrivKey] = useState<string>('');
  const [contractAddr, setContractAddr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(100);
  
  // 出版社地址
  const [pubAddress, setPubAddress] = useState<string>('');
  
  // 钱包余额
  const [balanceCFX, setBalanceCFX] = useState<number>(0);
  const [maxDeploys, setMaxDeploys] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);

  // 销量数据
  const [bookSales, setBookSales] = useState<BookSales[]>([]);
  const [regionRanks, setRegionRanks] = useState<RegionRank[]>([]);
  const [totalSales, setTotalSales] = useState<number>(0);

  useEffect(() => {
    const initPublisher = async () => {
      const authAddr = localStorage.getItem('vault_pub_auth');
      const authRole = localStorage.getItem('vault_user_role');

      if (!authAddr || (authRole !== 'publisher' && authRole !== 'author')) {
        // Demo 模式：自动生成模拟地址
        const mockAddr = `0x${Math.random().toString(16).slice(2, 42)}`;
        setPubAddress(mockAddr);
        localStorage.setItem('vault_pub_auth', mockAddr);
        localStorage.setItem('vault_user_role', 'publisher');
      } else {
        setPubAddress(authAddr);
      }
      
      await fetchDashboardData();
      setLoading(false);
    };
    
    initPublisher();
  }, []);

  // 获取仪表盘数据
  const fetchDashboardData = async () => {
    try {
      // 生成销量列表 (目前后端无专用接口，使用 Mock)
      const salesData: BookSales[] = MOCK_BOOKS.map((book) => ({
        address: `0x${book.id}${'0'.repeat(40 - book.id.length)}`,
        symbol: book.symbol,
        name: book.title,
        author: book.author,
        sales: book.sales,
        explorerUrl: isMockMode ? '#' : `https://evm.confluxscan.net/address/${book.id}`
      }));
      
      setBookSales(salesData);
      setTotalSales(getTotalSales());
      
      // 获取热力图数据
      const heatmapResult = await fetchHeatmapData();
      if (heatmapResult.ok && heatmapResult.regions) {
        const ranked: RegionRank[] = heatmapResult.regions
          .map(r => ({ region: r.name, count: r.value[2] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        setRegionRanks(ranked);
      } else {
        // 降级使用 Mock
        const ranked: RegionRank[] = MOCK_REGIONS
          .map(r => ({ region: r.name, count: r.value[2] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        setRegionRanks(ranked);
      }
    } catch (e: any) {
      console.error('获取仪表盘数据失败:', e);
      // 降级使用 Mock 数据
      const salesData: BookSales[] = MOCK_BOOKS.map((book) => ({
        address: `0x${book.id}${'0'.repeat(40 - book.id.length)}`,
        symbol: book.symbol,
        name: book.title,
        author: book.author,
        sales: book.sales,
        explorerUrl: '#'
      }));
      setBookSales(salesData);
      setTotalSales(getTotalSales());
    }
  };

  // 刷新余额
  const fetchPublisherBalanceData = async () => {
    if (!pubAddress) return;
    
    setBalanceLoading(true);
    try {
      const result = await getPublisherBalance(pubAddress);
      if (result.ok) {
        setBalanceCFX(parseFloat(result.balance));
        setMaxDeploys(result.maxDeploys);
      }
      showToast('余额已刷新', 'success');
    } catch (e: any) {
      console.error('获取余额失败:', e);
      showToast(e.message || '获取余额失败', 'error');
      // Mock 模式下模拟数据
      if (isMockMode) {
        setBalanceCFX(prev => prev || 125.50);
        setMaxDeploys(prev => prev || 12);
      }
    } finally {
      setBalanceLoading(false);
    }
  };

  // 部署合约
  const handleDeployContract = async () => {
    if (!bookName || !symbol) {
      setError("请完整填写书籍名称和代码");
      return;
    }

    setOpLoading(true);
    setError(null);

    try {
      const result = await deployBook({
        name: bookName,
        symbol: symbol.toUpperCase(),
        author: author || '未知作者',
        serial: serial || `SERIAL${Date.now()}`,
        publisher: pubAddress,
        privKey: privKey, // 生产环境中应该由后端管理
      });

      if (result.ok) {
        setContractAddr(result.bookAddr);
        
        // 添加到列表
        const newBook: BookSales = {
          address: result.bookAddr,
          symbol: symbol.toUpperCase(),
          name: bookName,
          author: author || '未知作者',
          sales: 0,
          explorerUrl: isMockMode ? '#' : `https://evm.confluxscan.net/tx/${result.txHash}`
        };
        setBookSales(prev => [newBook, ...prev]);
        
        showToast(`合约部署成功！${symbol.toUpperCase()}`, 'success', result.txHash);
      } else {
        throw new Error(result.error || '部署失败');
      }
    } catch (e: any) {
      console.error('部署合约失败:', e);
      setError(e.message || '部署失败，请检查参数');
      showToast(e.message || '部署失败', 'error');
    } finally {
      setOpLoading(false);
    }
  };

  // 批量生成码 (目前仍使用 Mock)
  const handleGenerateBatch = async () => {
    if (!contractAddr) return;
    setOpLoading(true);

    // TODO: 接入后端 API
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    showToast(`已生成 ${count} 个激活码`, 'success');
    setOpLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400 text-sm">
            {isMockMode ? '加载 Mock 数据...' : '连接后端 API...'}
          </p>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    localStorage.removeItem('vault_pub_auth');
    localStorage.removeItem('vault_user_role');
    localStorage.removeItem('vault_code_hash');
    navigate('/bookshelf');
  };

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white">
      <ToastContainer />
      
      {/* 顶部导航栏 */}
      <header className="bg-[#131722] border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                PUBLISHER TERMINAL
              </h1>
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">
                  {pubAddress.slice(0, 6)}...{pubAddress.slice(-4)}
                </p>
                <span className={`text-[8px] ${isMockMode ? 'bg-cyan-500/20 text-cyan-400' : 'bg-green-500/20 text-green-400'} px-2 py-0.5 rounded-full uppercase`}>
                  {isMockMode ? 'Demo' : 'Dev API'}
                </span>
              </div>
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
                onClick={fetchPublisherBalanceData}
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-blue-600/20 to-blue-800/10 border border-blue-500/20 rounded-2xl p-6">
                <p className="text-blue-400 text-xs uppercase tracking-wider mb-1">总销量</p>
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

            <div className="bg-[#131722] border border-white/5 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center">
                <h2 className="text-sm font-bold text-white">📖 图书销量排行</h2>
                <span className={`text-[10px] ${isMockMode ? 'bg-cyan-500/20 text-cyan-400' : 'bg-green-500/20 text-green-400'} px-2 py-1 rounded-full uppercase`}>
                  {isMockMode ? 'Demo Data' : 'Live Data'}
                </span>
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {bookSales.map((book, idx) => (
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
                      </tr>
                    ))}
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
              
              {/* API 模式提示 */}
              <div className={`mb-4 p-3 ${isMockMode ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-green-500/10 border-green-500/20'} border rounded-xl`}>
                <p className={`text-xs ${isMockMode ? 'text-cyan-400' : 'text-green-400'}`}>
                  {isMockMode 
                    ? '🔧 Demo 模式：合约部署仅为模拟' 
                    : `🟢 Dev API：将调用 ${apiBaseUrl}/api/v1/publisher/deploy-book`}
                </p>
              </div>
              
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-xs">{error}</p>
                </div>
              )}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-2 uppercase">书籍名称 *</label>
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
                  <label className="block text-xs text-slate-400 mb-2 uppercase">书籍代码 (Symbol) *</label>
                  <input 
                    placeholder="例：BLOCKCHAIN" 
                    className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500 transition-colors uppercase"
                    value={symbol} 
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-2 uppercase">序列号 (Serial)</label>
                  <input 
                    placeholder="例：SERIAL001" 
                    className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500 transition-colors"
                    value={serial} 
                    onChange={(e) => setSerial(e.target.value)}
                  />
                </div>
                
                {!isMockMode && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-2 uppercase">出版社私钥 (用于签名)</label>
                    <input 
                      type="password"
                      placeholder="0x..." 
                      className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500 transition-colors font-mono"
                      value={privKey} 
                      onChange={(e) => setPrivKey(e.target.value)}
                    />
                    <p className="text-[9px] text-yellow-500/70 mt-1">⚠️ 仅用于 Dev 测试，生产环境由后端管理私钥</p>
                  </div>
                )}
                
                <button
                  onClick={handleDeployContract}
                  disabled={opLoading || !bookName || !symbol}
                  className="w-full mt-4 py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-sm uppercase tracking-widest hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 transition-all"
                >
                  {opLoading ? '部署中...' : '部署合约'}
                </button>
                
                {contractAddr && (
                  <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <p className="text-green-400 text-xs mb-2">✓ 合约部署成功</p>
                    <p className="text-[10px] font-mono text-gray-400 break-all">{contractAddr}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === 生成二维码 Tab === */}
        {activeTab === 'qrcode' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-[#131722] border border-white/5 rounded-2xl p-8">
              <h2 className="text-lg font-bold text-white mb-6">🔗 批量生成二维码</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-2 uppercase">选择已部署的书籍合约</label>
                  <select 
                    className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500"
                    value={contractAddr || ''}
                    onChange={(e) => setContractAddr(e.target.value)}
                  >
                    <option value="">-- 选择合约 --</option>
                    {bookSales.map(book => (
                      <option key={book.address} value={book.address}>
                        {book.symbol} - {book.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs text-slate-400 mb-2 uppercase">生成数量</label>
                  <input 
                    type="number"
                    placeholder="100" 
                    className="w-full bg-[#0b0e11] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500"
                    value={count} 
                    onChange={(e) => setCount(parseInt(e.target.value) || 100)}
                    min={1}
                    max={10000}
                  />
                </div>
                
                <button
                  onClick={handleGenerateBatch}
                  disabled={opLoading || !contractAddr}
                  className="w-full mt-4 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl font-bold text-sm uppercase tracking-widest hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 transition-all"
                >
                  {opLoading ? '生成中...' : `生成 ${count} 个二维码`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === 热力分析 Tab === */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="bg-[#131722] border border-white/5 rounded-2xl p-6">
              <h2 className="text-sm font-bold text-white mb-4">🗺️ 地区读者分布</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {regionRanks.map((region, idx) => (
                  <div key={region.region} className="bg-white/5 rounded-xl p-4 text-center">
                    <p className="text-[10px] text-slate-500 uppercase mb-1">#{idx + 1}</p>
                    <p className="text-sm font-bold text-white">{region.region}</p>
                    <p className="text-lg font-black text-cyan-400">{region.count}</p>
                  </div>
                ))}
              </div>
            </div>
            
            <button
              onClick={() => navigate('/Heatmap')}
              className="w-full py-4 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 rounded-xl font-bold text-cyan-400 hover:from-cyan-500/30 hover:to-blue-500/30 transition-all"
            >
              查看完整热力图 →
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default Publisher;
