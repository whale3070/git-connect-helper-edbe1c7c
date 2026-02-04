import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '../contexts/AppModeContext';
import { useApi } from '../hooks/useApi';
import { MOCK_BOOKS, MOCK_REGIONS, getTotalSales } from '../data/mockData';
import { showToast, ToastContainer } from '../components/ui/CyberpunkToast';

interface BookSales {
  address: string;
  symbol: string;
  name: string;
  author: string;
  sales: number;
  explorerUrl: string;
}

interface RegionRank {
  region: string;
  count: number;
}

const Publisher: React.FC = () => {
  const navigate = useNavigate();
  const { apiBaseUrl } = useAppMode();


// 仅用于展示的地址缩写：不要把缩写地址写回 state / 发给后端
const shortenAddress = (addr: string) => {
  const a = (addr || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) {
    return `${a.slice(0, 6)}...${a.slice(-4)}`;
  }
  return a;
};



// ✅ 后端热力图接口实际是 /api/v1/analytics/distribution（兼容之前前端叫 heatmap 的概念）
const fetchDistribution = async () => {
  const base = apiBaseUrl.replace(/\/$/, "");
  const url = `${base}/api/v1/analytics/distribution`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    return { ok: false, error: msg || `HTTP ${res.status}` };
  }
  return res.json();
};

const { getPublisherBalance } = useApi();

  const [loading, setLoading] = useState(true);
  const [opLoading, setOpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'addBook' | 'qrcode' | 'analytics'>('overview');

  const [bookName, setBookName] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [symbol, setSymbol] = useState<string>('');
  const [serial, setSerial] = useState<string>('');
  const [contractAddr, setContractAddr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(100);

  

  // =========================
  // REAL 模式：书籍搜索（下拉框 -> 搜索框 + 候选列表）
  // =========================
  const [bookQuery, setBookQuery] = useState<string>('');
  const [bookCandidates, setBookCandidates] = useState<any[]>([]);
  const [bookSearchLoading, setBookSearchLoading] = useState<boolean>(false);
  const [selectedBook, setSelectedBook] = useState<any | null>(null);

const [pubAddress, setPubAddress] = useState<string>('');
  const [balanceCFX, setBalanceCFX] = useState<number>(0);
  const [maxDeploys, setMaxDeploys] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);

  const [bookSales, setBookSales] = useState<BookSales[]>([]);
  const [regionRanks, setRegionRanks] = useState<RegionRank[]>([]);
  const [totalSales, setTotalSales] = useState<number>(0);

// =========================
// Mock / Real 一键切换（双存储隔离）
// =========================
const [envMode, setEnvMode] = useState<"real" | "mock">(() => {
  const saved = (typeof window !== "undefined"
    ? (localStorage.getItem("publisher_env_mode") as "real" | "mock" | null)
    : null);
  return saved === "mock" ? "mock" : "real";
});

const toggleEnvMode = () => {
  setEnvMode((prev) => {
    const next = prev === "real" ? "mock" : "real";
    // 从 MOCK -> REAL 给一次确认，避免误操作（可按需删掉）
    if (prev === "mock" && next === "real") {
      const ok = window.confirm("即将切换到 REAL 模式，将调用真实后端与链上交易。继续？");
      if (!ok) return prev;
    }
    localStorage.setItem("publisher_env_mode", next);
    return next;
  });
};

const storageKey = envMode === "mock" ? "publisher_mock_books" : "publisher_real_books";
const loadBooksFromStorage = (): BookSales[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as BookSales[]) : [];
  } catch {
    return [];
  }
};
const saveBooksToStorage = (books: BookSales[]) => {
  localStorage.setItem(storageKey, JSON.stringify(books));
};



const updateBooks = (updater: (prev: BookSales[]) => BookSales[]) => {
  updateBooks((prev) => {
    const next = updater(prev);
    saveBooksToStorage(next);
    return next;
  });
};


// 切换环境时加载对应（Mock/Real）的书籍列表，互不干扰
useEffect(() => {
  if (typeof window === "undefined") return;
  const books = loadBooksFromStorage();
  setBookSales(books);
}, [envMode]);



// REAL 模式：debounce 300ms 搜索出版社书籍（/api/v1/publisher/books/search）
useEffect(() => {
  if (envMode !== "real") return;

  const q = bookQuery.trim();
  if (q.length < 2) {
    setBookCandidates([]);
    return;
  }

  const timer = window.setTimeout(async () => {
    try {
      const publisher = (pubAddress || "").trim().toLowerCase();
      if (!/^0x[a-fA-F0-9]{40}$/.test(publisher)) {
        setBookCandidates([]);
        return;
      }

      setBookSearchLoading(true);
      const base = apiBaseUrl.replace(/\/$/, "");
      const url = `${base}/api/v1/publisher/books/search?publisher=${publisher}&q=${encodeURIComponent(q)}&limit=20&offset=0`;

      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setBookCandidates(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setBookCandidates([]);
      showToast(e?.message || "搜索失败", "error");
    } finally {
      setBookSearchLoading(false);
    }
  }, 300);

  return () => window.clearTimeout(timer);
}, [bookQuery, envMode, apiBaseUrl, pubAddress]);




  useEffect(() => {
    const initPublisher = async () => {
      const authAddr = localStorage.getItem('vault_pub_auth');
      const authRole = localStorage.getItem('vault_user_role');

      if (!authAddr || (authRole !== 'publisher' && authRole !== 'author')) {
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

  const fetchDashboardData = async () => {
    try {
      const salesData: BookSales[] = MOCK_BOOKS.map((book) => ({
        address: `0x${book.id}${'0'.repeat(40 - book.id.length)}`,
        symbol: book.symbol,
        name: book.title,
        author: book.author,
        sales: book.sales,
        explorerUrl: (envMode === "mock") ? '#' : `https://evm.confluxscan.net/address/${book.id}`
      }));

      setBookSales(salesData);
      setTotalSales(getTotalSales());

      const heatmapResult = await fetchDistribution();
      if (heatmapResult.ok && heatmapResult.regions) {
        const ranked: RegionRank[] = heatmapResult.regions
          .map(r => ({ region: r.name, count: r.value[2] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        setRegionRanks(ranked);
      } else {
        const ranked: RegionRank[] = MOCK_REGIONS
          .map(r => ({ region: r.name, count: r.value[2] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        setRegionRanks(ranked);
      }
    } catch (e: any) {
      console.error('获取仪表盘数据失败:', e);
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
      if ((envMode === "mock")) {
        setBalanceCFX(prev => prev || 125.50);
        setMaxDeploys(prev => prev || 12);
      }
    } finally {
      setBalanceLoading(false);
    }
  };

  const handleDeployContract = async () => {
    if (!bookName || !symbol) {
      setError("请完整填写书籍名称和代码");
      return;
    }

    setOpLoading(true);
    setError(null);

    try {
      if ((envMode === "mock")) {
        // Demo 模式：本地模拟一个“部署成功”的合约地址
        const mockBookAddr = `0x${Math.random().toString(16).slice(2).padEnd(40, "0").slice(0, 40)}`;
        const mockTx = `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`;

        setContractAddr(mockBookAddr);

        const newBook: BookSales = {
          address: mockBookAddr,
          symbol: symbol.toUpperCase(),
          name: bookName,
          author: author || "未知作者",
          sales: 0,
          explorerUrl: "#" };
        const nextBooks = [newBook, ...loadBooksFromStorage()];
        saveBooksToStorage(nextBooks);
        setBookSales(nextBooks);
showToast(`Demo：合约部署成功！${symbol.toUpperCase()}`, "success", mockTx);
        return;
      }

      // ✅ 正式：调用后端 DeployBook（后端会从 Redis 取出版社私钥；前端不传 privKey）
      const publisher = (pubAddress || "").trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(publisher)) {
        throw new Error(`publisher 地址无效（需要 0x + 40 位十六进制）：${publisher}`);
      }

const url = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/publisher/deploy-book`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bookName,
          symbol: symbol.toUpperCase(),
          author: author || "未知作者",
          serial: serial || `SERIAL${Date.now()}`,
          publisher: publisher }) });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `部署失败：${res.status}`);
      }

      const result = await res.json();
      if (!result?.ok) {
        throw new Error(result?.error || "部署失败");
      }

      setContractAddr(result.bookAddr);

      const newBook: BookSales = {
        address: result.bookAddr,
        symbol: symbol.toUpperCase(),
        name: bookName,
        author: author || "未知作者",
        sales: 0,
        explorerUrl: (envMode === "mock") ? "#" : `https://evm.confluxscan.net/tx/${result.txHash}` };
      const nextBooks = [newBook, ...loadBooksFromStorage()];
        saveBooksToStorage(nextBooks);
        setBookSales(nextBooks);
showToast(`合约部署成功！${symbol.toUpperCase()}`, "success", result.txHash);
    } catch (e: any) {
      console.error("部署合约失败:", e);
      setError(e.message || "部署失败，请检查参数");
      showToast(e.message || "部署失败", "error");
    } finally {
      setOpLoading(false);
    }
  };


  const handleGenerateBatch = async () => {
    if (!contractAddr) {
      showToast("请先选择已部署的书籍合约", "error");
      return;
    }

    // 基本校验
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) {
      showToast("请输入正确的生成数量", "error");
      return;
    }
    if (n > 500) {
      showToast("单次最多生成 500 个（可分批）", "error");
      return;
    }

    setOpLoading(true);
    setError(null);

    try {
      if ((envMode === "mock")) {
        await new Promise(resolve => setTimeout(resolve, 800));
        showToast(`Demo：已生成 ${n} 个二维码（ZIP）`, "success");
        return;
      }

      // ⚠️ 这里假设后端路由为：GET {apiBaseUrl}/api/v1/publisher/zip?count=100&contract=0x...
      // 如果你的真实路由不同，把下面的路径改一下即可。
      const url = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/publisher/zip?count=${encodeURIComponent(String(n))}&contract=${encodeURIComponent(contractAddr)}`;

      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `请求失败：${res.status}`);
      }

      const blob = await res.blob();
      const dlUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `WhaleVault_Codes_${n}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(dlUrl);

      showToast(`已生成并下载 ${n} 个二维码 ZIP`, "success");
    } catch (e: any) {
      const msg = (e?.message || "生成失败").toString();
      setError(msg);
      showToast(msg, "error");
    } finally {
      setOpLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 text-sm">
            {(envMode === "mock") ? '加载 Mock 数据...' : '连接后端 API...'}
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <ToastContainer />

      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-200 sticky top-0 z-10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                PUBLISHER TERMINAL
              </h1>

<button
  onClick={toggleEnvMode}
  className={`px-3 py-1 rounded text-sm ${
    envMode === "mock" ? "bg-yellow-500 text-white" : "bg-green-600 text-white"
  }`}
  title="一键切换 Mock / Real"
>
  {envMode === "mock" ? "MOCK 模式" : "REAL 模式"}
</button>

              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-400 font-mono">
                  {pubAddress.slice(0, 6)}...{pubAddress.slice(-4)}
                </p>
                <span className={`text-[10px] ${(envMode === "mock") ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'} px-2 py-0.5 rounded-full font-medium`}>
                  {(envMode === "mock") ? 'Demo' : 'Dev API'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl">
              <div className="text-center">
                <p className="text-[10px] text-emerald-600 uppercase font-medium">CFX 余额</p>
                <p className="text-lg font-bold text-emerald-700">
                  {balanceLoading ? '...' : balanceCFX.toFixed(2)}
                </p>
              </div>
              <div className="w-px h-8 bg-emerald-200"></div>
              <div className="text-center">
                <p className="text-[10px] text-teal-600 uppercase font-medium">可部署次数</p>
                <p className="text-lg font-bold text-teal-700">
                  {balanceLoading ? '...' : maxDeploys}
                </p>
              </div>
              <button 
                onClick={fetchPublisherBalanceData}
                className="ml-2 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              {(['overview', 'addBook', 'qrcode', 'analytics'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-all ${
                    activeTab === tab 
                      ? 'bg-white text-indigo-600 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
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
              className="px-4 py-2 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-6 shadow-soft border border-slate-100">
                <p className="text-indigo-600 text-xs uppercase font-semibold mb-1">总销量</p>
                <p className="text-4xl font-black text-slate-800">{totalSales.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-soft border border-slate-100">
                <p className="text-teal-600 text-xs uppercase font-semibold mb-1">上架图书数</p>
                <p className="text-4xl font-black text-slate-800">{bookSales.length}</p>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-soft border border-slate-100">
                <p className="text-purple-600 text-xs uppercase font-semibold mb-1">覆盖地区</p>
                <p className="text-4xl font-black text-slate-800">{regionRanks.length}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                <h2 className="text-sm font-bold text-slate-800">📖 图书销量排行</h2>
                <span className={`text-xs ${(envMode === "mock") ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'} px-2 py-1 rounded-full font-medium`}>
                  {(envMode === "mock") ? 'Demo Data' : 'Live Data'}
                </span>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">排名</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">代码</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">书名</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">作者</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">销量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bookSales.map((book, idx) => (
                    <tr key={book.address} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          idx === 0 ? 'bg-amber-100 text-amber-700' :
                          idx === 1 ? 'bg-slate-200 text-slate-600' :
                          idx === 2 ? 'bg-orange-100 text-orange-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-mono text-indigo-600 text-sm font-medium">{book.symbol}</td>
                      <td className="px-4 py-4 text-slate-800 font-medium">{book.name}</td>
                      <td className="px-4 py-4 text-slate-500">{book.author}</td>
                      <td className="px-4 py-4 text-right font-mono text-lg text-emerald-600 font-bold">{book.sales.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'addBook' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-8">
              <h2 className="text-lg font-bold text-slate-800 mb-6">📚 部署新书 NFT 合约</h2>

              <div className={`mb-4 p-3 ${(envMode === "mock") ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} border rounded-xl`}>
                <p className={`text-xs ${(envMode === "mock") ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {(envMode === "mock") ? '🔧 Demo 模式：合约部署仅为模拟' : `🟢 Dev API：${apiBaseUrl}`}
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-600 text-xs">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">书籍名称 *</label>
                  <input 
                    placeholder="例：区块链技术原理" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                    value={bookName} 
                    onChange={(e) => setBookName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">作者名称</label>
                  <input 
                    placeholder="例：张三" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                    value={author} 
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">书籍代码 (Symbol) *</label>
                  <input 
                    placeholder="例：BLOCKCHAIN" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all uppercase"
                    value={symbol} 
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  />
                </div>

                <button
                  onClick={handleDeployContract}
                  disabled={opLoading || !bookName || !symbol}
                  className="w-full mt-4 py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 transition-all shadow-md"
                >
                  {opLoading ? '部署中...' : '部署合约'}
                </button>

                {contractAddr && (
                  <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <p className="text-emerald-700 text-xs mb-2 font-medium">✓ 合约部署成功</p>
                    <p className="text-xs font-mono text-slate-500 break-all">{contractAddr}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'qrcode' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-8">
              <h2 className="text-lg font-bold text-slate-800 mb-6">🔗 批量生成二维码</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">选择已部署的书籍合约</label>

                  {envMode === "mock" ? (
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400"
                      value={contractAddr || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setContractAddr(v);
                        setSelectedBook(null);
                      }}
                    >
                      <option value="">-- 选择合约 --</option>
                      {bookSales.map(book => (
                        <option key={book.address} value={book.address}>
                          {book.symbol} - {book.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="space-y-3">
                      <input
                        value={bookQuery}
                        onChange={(e) => setBookQuery(e.target.value)}
                        placeholder="输入书名 / 作者 / 代码 / serial（至少2个字符）"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400"
                      />

                      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                        <div className="px-4 py-2 text-xs text-slate-500 flex items-center justify-between">
                          <span>候选列表（最多 20 条）</span>
                          <span>
                            {bookSearchLoading
                              ? "搜索中..."
                              : (bookQuery.trim().length < 2 ? "输入 2 个字符开始搜索" : `${bookCandidates.length} 条`)}
                          </span>
                        </div>

                        {bookCandidates.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-400">
                            {bookQuery.trim().length < 2 ? "请输入关键词开始搜索" : "没有匹配结果"}
                          </div>
                        ) : (
                          <div className="max-h-64 overflow-auto">
                            {bookCandidates.map((b, idx) => {
                              const addr = (b.bookAddr || b.address || "").toString();
                              const title = b.name || "未命名";
                              const au = b.author || "未知作者";
                              const sym = (b.symbol || "").toString();
                              const ser = (b.serial || "").toString();
                              return (
                                <button
                                  key={addr || idx}
                                  type="button"
                                  className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 border-t border-slate-100"
                                  onClick={() => {
                                    setContractAddr(addr);
                                    setSelectedBook(b);
                                  }}
                                >
                                  <div className="font-semibold text-slate-800">
                                    《{title}》 - {au}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-1">
                                    {sym} / {ser} <span className="ml-2">{shortenAddress(addr)}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {selectedBook && contractAddr ? (
                        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                          已选择：《{selectedBook.name || "未命名"}》 ({(selectedBook.symbol || "").toString()} / {(selectedBook.serial || "").toString()})
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">生成数量</label>
                  <input 
                    type="number"
                    placeholder="100" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400"
                    value={count} 
                    onChange={(e) => setCount(parseInt(e.target.value) || 100)}
                  />
                </div>

                <button
                  onClick={handleGenerateBatch}
                  disabled={opLoading || !contractAddr}
                  className="w-full mt-4 py-4 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 transition-all shadow-md"
                >
                  {opLoading ? '生成中...' : `生成 ${count} 个二维码`}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
              <h2 className="text-sm font-bold text-slate-800 mb-4">🗺️ 地区读者分布</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {regionRanks.map((region, idx) => (
                  <div key={region.region} className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
                    <p className="text-[10px] text-slate-400 uppercase mb-1">#{idx + 1}</p>
                    <p className="text-sm font-bold text-slate-800">{region.region}</p>
                    <p className="text-lg font-black text-indigo-600">{region.count}</p>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => navigate('/Heatmap')}
              className="w-full py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl font-bold text-indigo-600 hover:from-indigo-100 hover:to-purple-100 transition-all"
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