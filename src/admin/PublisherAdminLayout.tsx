import React, { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { useAppMode } from "../contexts/AppModeContext";
import { useApi } from "../hooks/useApi";
import { MOCK_BOOKS, MOCK_REGIONS, getTotalSales } from "../data/mockData";
import { showToast, ToastContainer } from "../components/ui/CyberpunkToast";

import { RPC_URL, USDT_ADDRESS, TREASURY_ADDRESS, DEPLOY_FEE_USDT } from "../config/chain";

export interface BookSales {
  address: string;
  symbol: string;
  name: string;
  author: string;
  sales: number;
  explorerUrl: string;
}
export interface RegionRank {
  region: string;
  count: number;
}

export type PublisherOutletContext = {
  // env / header
  envMode: "real" | "mock";
  toggleEnvMode: () => void;
  apiBaseUrl: string; // (kept for compatibility, but API calls below do NOT rely on it)
  pubAddress: string;

  // balance (CFX from backend)
  balanceCFX: number;
  maxDeploys: number;
  balanceLoading: boolean;
  fetchPublisherBalanceData: () => Promise<void>;

  // token balance (USDT/others via RPC)
  balanceUSDT: number;
  usdtLoading: boolean;

  // after topup
  refreshAfterTopup: (token?: { symbol?: string; address?: string }) => Promise<void>;

  // overview data
  bookSales: BookSales[];
  regionRanks: RegionRank[];
  totalSales: number;

  // on-chain NFT stats (per contract)
  nftStatsMap: Record<
    string,
    {
      contract: string;
      last_scanned_block: number;
      minted_total: number;
      unique_minters: number;
      unique_real_users: number;
    }
  >;
  refreshNftStats: (contracts?: string[]) => Promise<void>;

  // add book form
  bookName: string;
  setBookName: (v: string) => void;
  author: string;
  setAuthor: (v: string) => void;
  symbol: string;
  setSymbol: (v: string) => void;
  serial: string;
  setSerial: (v: string) => void;
  contractAddr: string | null;
  setContractAddr: (v: string | null) => void;

  // qrcode form
  count: number;
  setCount: (v: number) => void;

  // real search
  bookQuery: string;
  setBookQuery: (v: string) => void;
  bookCandidates: any[];
  bookSearchLoading: boolean;
  selectedBook: any | null;
  setSelectedBook: (v: any | null) => void;

  // status
  loading: boolean;
  opLoading: boolean;
  error: string | null;

  // handlers
  handleDeployContract: () => Promise<void>;
  handleGenerateBatch: () => Promise<void>;

  // helpers
  shortenAddress: (addr: string) => string;
};

const shortenAddress = (addr: string) => {
  const a = (addr || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return `${a.slice(0, 6)}...${a.slice(-4)}`;
  return a;
};
const isHexAddress = (addr: string) => /^0x[a-fA-F0-9]{40}$/.test((addr || "").trim());

/**
 * ✅ IMPORTANT FIX:
 * Never construct API URLs using a route prefix like "/publisher-admin".
 * Always call backend with an absolute path (starting with "/") or full origin.
 * This prevents requests like "/publisher-admin/api/v1/..." which would be swallowed by SPA fallback and return index.html.
 */
const origin = () => (typeof window !== "undefined" ? window.location.origin : "");

/**
 * Parse filename from Content-Disposition.
 * - Supports: filename="a.zip"
 * - Supports: filename*=UTF-8''a%20b.zip
 */
const pickFilenameFromContentDisposition = (cd: string, fallback: string) => {
  if (!cd) return fallback;

  const mStar = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (mStar?.[1]) {
    try {
      return decodeURIComponent(mStar[1].trim());
    } catch {
      return mStar[1].trim();
    }
  }

  const m = cd.match(/filename\s*=\s*([^;]+)/i);
  if (m?.[1]) return m[1].trim().replace(/^"|"$/g, "");

  return fallback;
};

async function fetchJsonOrThrow<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  // Read text once for better error messages; then parse if JSON
  const text = await res.text().catch(() => "");
  const preview = text.slice(0, 300);

  const isJson = ct.includes("application/json");
  let data: any = null;
  if (isJson && text) {
    try {
      data = JSON.parse(text);
    } catch {
      // fallthrough
    }
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || preview || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!isJson) {
    throw new Error(`响应格式错误: 期望 JSON，但得到 ${ct || "unknown"}: ${preview}`);
  }
  return (data as T) ?? ({} as T);
}

export default function PublisherAdminLayout() {
  const navigate = useNavigate();
  const { apiBaseUrl } = useAppMode(); // keep as-is for UI/context; do NOT rely on it for URL building
  const { getPublisherBalance, getErc20Balance } = useApi();

  const [loading, setLoading] = useState(true);
  const [opLoading, setOpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pubAddress, setPubAddress] = useState<string>("");

  // backend balance (CFX)
  const [balanceCFX, setBalanceCFX] = useState<number>(0);
  const [maxDeploys, setMaxDeploys] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);

  // token balance (USDT)
  const [balanceUSDT, setBalanceUSDT] = useState<number>(0);
  const [usdtLoading, setUsdtLoading] = useState<boolean>(false);

  const [bookSales, setBookSales] = useState<BookSales[]>([]);
  const [regionRanks, setRegionRanks] = useState<RegionRank[]>([]);
  const [totalSales, setTotalSales] = useState<number>(0);

  const [nftStatsMap, setNftStatsMap] = useState<
    Record<
      string,
      {
        contract: string;
        last_scanned_block: number;
        minted_total: number;
        unique_minters: number;
        unique_real_users: number;
      }
    >
  >({});

  // form
  const [bookName, setBookName] = useState<string>("");
  const [author, setAuthor] = useState<string>("");
  const [symbol, setSymbol] = useState<string>("");
  const [serial, setSerial] = useState<string>("");
  const [contractAddr, setContractAddr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(100);

  // search
  const [bookQuery, setBookQuery] = useState<string>("");
  const [bookCandidates, setBookCandidates] = useState<any[]>([]);
  const [bookSearchLoading, setBookSearchLoading] = useState<boolean>(false);
  const [selectedBook, setSelectedBook] = useState<any | null>(null);

  // envMode (publisher panel internal)
  const [envMode, setEnvMode] = useState<"real" | "mock">(() => {
    const saved =
      typeof window !== "undefined"
        ? (localStorage.getItem("publisher_env_mode") as "real" | "mock" | null)
        : null;
    return saved === "mock" ? "mock" : "real";
  });

  const toggleEnvMode = () => {
    setEnvMode((prev) => {
      const next = prev === "real" ? "mock" : "real";
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

  // ✅ distribution (always call absolute URL)
  const fetchDistribution = async () => {
    const url = `${origin()}/api/v1/analytics/distribution`;
    return fetchJsonOrThrow<{ ok: boolean; regions?: any[]; error?: string }>(url, { method: "GET" });
  };


  // -----------------------------
  // On-chain NFT stats (per contract)
  // -----------------------------
  const fetchNftStatsOne = async (contract: string) => {
    const c = (contract || "").trim();
    if (!isHexAddress(c)) return null;

    const url = `${origin()}/api/v1/nft/stats?contract=${encodeURIComponent(c)}`;
    const res = await fetchJsonOrThrow<{ ok: boolean; data?: any }>(url, { method: "GET" });

    if (!res?.ok || !res?.data) return null;
    return res.data as {
      contract: string;
      last_scanned_block: number;
      minted_total: number;
      unique_minters: number;
      unique_real_users: number;
    };
  };

  const refreshNftStats = async (contracts?: string[]) => {
    if (envMode !== "real") return;

    const list = (contracts && contracts.length ? contracts : bookSales.map((b) => b.address))
      .map((x) => (x || "").toLowerCase())
      .filter((x) => isHexAddress(x));

    const uniq = Array.from(new Set(list));
    if (uniq.length === 0) return;

    const results = await Promise.all(uniq.map((c) => fetchNftStatsOne(c)));

    setNftStatsMap((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r?.contract) next[r.contract.toLowerCase()] = r;
      }
      return next;
    });
  };


  // 切换 env 时读取各自 storage
  useEffect(() => {
    if (typeof window === "undefined") return;
    setBookSales(loadBooksFromStorage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envMode]);

  // 切换环境后：刷新仪表盘
  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envMode]);

  // real search debounce
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
        if (!isHexAddress(publisher)) {
          setBookCandidates([]);
          return;
        }

        setBookSearchLoading(true);
        const url = `${origin()}/api/v1/publisher/books/search?publisher=${publisher}&q=${encodeURIComponent(
          q
        )}&limit=20&offset=0`;

        const data = await fetchJsonOrThrow<any>(url, { method: "GET" });
        setBookCandidates(Array.isArray(data.items) ? data.items : []);
      } catch (e: any) {
        setBookCandidates([]);
        showToast(e?.message || "搜索失败", "error");
      } finally {
        setBookSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [bookQuery, envMode, pubAddress]);

  // init
  useEffect(() => {
    const initPublisher = async () => {
      const authAddr = localStorage.getItem("vault_pub_auth");
      const authRole = localStorage.getItem("vault_user_role");

      if (!authAddr || (authRole !== "publisher" && authRole !== "author")) {
        // mock fallback
        const rand = Math.random().toString(16).slice(2);
        const mockAddr = `0x${rand.padEnd(40, "0").slice(0, 40)}`;
        setPubAddress(mockAddr);
        localStorage.setItem("vault_pub_auth", mockAddr);
        localStorage.setItem("vault_user_role", "publisher");
      } else {
        setPubAddress(authAddr);
      }

      await fetchDashboardData();

      // 初次进入拉一次余额（CFX + USDT）
      try {
        await fetchPublisherBalanceDataInternal(authAddr || "");
      } catch {
        // ignore
      }

      setLoading(false);
    };

    initPublisher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDashboardData = async () => {
    try {
      if (envMode === "real") {
        const realBooks = loadBooksFromStorage();
        setBookSales(realBooks);

        setTotalSales(0);

        const heatmapResult = await fetchDistribution();
        if (heatmapResult?.ok && Array.isArray(heatmapResult.regions)) {
          const ranked: RegionRank[] = heatmapResult.regions
            .map((r: any) => ({ region: r.name, count: r.value?.[2] ?? 0 }))
            .sort((a: RegionRank, b: RegionRank) => b.count - a.count)
            .slice(0, 10);
          setRegionRanks(ranked);
        } else {
          setRegionRanks([]);
        }

        // Refresh on-chain stats for visible books
        await refreshNftStats(realBooks.map((b) => b.address));

        return;
      }

      const salesData: BookSales[] = MOCK_BOOKS.map((book) => ({
        address: `0x${book.id}${"0".repeat(40 - book.id.length)}`,
        symbol: book.symbol,
        name: book.title,
        author: book.author,
        sales: book.sales,
        explorerUrl: "#",
      }));

      setBookSales(salesData);
      setTotalSales(getTotalSales());

      const ranked: RegionRank[] = MOCK_REGIONS
        .map((r: any) => ({ region: r.name, count: r.value[2] }))
        .sort((a: RegionRank, b: RegionRank) => b.count - a.count)
        .slice(0, 10);
      setRegionRanks(ranked);
    } catch (e: any) {
      console.error("获取仪表盘数据失败:", e);
      if (envMode === "real") {
        setBookSales(loadBooksFromStorage());
        setTotalSales(0);
        setRegionRanks([]);
        showToast(e?.message || "REAL 仪表盘拉取失败：已显示空数据", "error");
      } else {
        setBookSales([]);
        setTotalSales(0);
        setRegionRanks([]);
      }
    }
  };

  // ✅ 拉 USDT 余额（链上 RPC；只是显示用）
  const fetchUsdtBalanceInternal = async (tokenAddr?: string) => {
    const owner = (pubAddress || "").trim();
    const rpcUrl = RPC_URL;
    const usdtAddr = (tokenAddr || USDT_ADDRESS || "").trim();

    if (!isHexAddress(owner) || !isHexAddress(usdtAddr)) {
      setBalanceUSDT(0);
      return;
    }

    const r = await getErc20Balance(rpcUrl, usdtAddr, owner);
    if (r?.ok) {
      const n = Number(r.balance);
      setBalanceUSDT(Number.isFinite(n) ? n : 0);
    }
  };

  // ✅ 统一拉余额（CFX + USDT）
  const fetchPublisherBalanceDataInternal = async (preferAddress?: string, token?: { address?: string }) => {
    const publisher = (preferAddress || pubAddress || "").trim();
    if (!publisher) return;

    setBalanceLoading(true);
    setUsdtLoading(true);

    try {
      const codeHash = localStorage.getItem("vault_code_hash") || "";
      const result = await getPublisherBalance(publisher, codeHash);
      if (result.ok) {
        setBalanceCFX(parseFloat(result.balance));
        setMaxDeploys(result.maxDeploys);
      }
      await fetchUsdtBalanceInternal(token?.address);
    } finally {
      setBalanceLoading(false);
      setUsdtLoading(false);
    }
  };

  const fetchPublisherBalanceData = async () => {
    try {
      await fetchPublisherBalanceDataInternal();
      showToast("余额已刷新", "success");
    } catch (e: any) {
      showToast(e?.message || "获取余额失败", "error");
      if (envMode === "mock") {
        setBalanceCFX((prev) => prev || 125.5);
        setMaxDeploys((prev) => prev || 12);
        setBalanceUSDT((prev) => prev || 88.0);
      }
    }
  };

  const refreshAfterTopup = async (token?: { symbol?: string; address?: string }) => {
    await new Promise((r) => setTimeout(r, 600));
    await fetchPublisherBalanceDataInternal(undefined, token);
    showToast(`余额已自动刷新${token?.symbol ? `（${token.symbol}）` : ""}`, "success");
  };

  // ✅ REAL 部署：不再用 MetaMask，直接让后端(用Redis私钥)扣费+部署
  const handleDeployContract = async () => {
    if (!bookName || !symbol) {
      setError("请完整填写书籍名称和代码");
      return;
    }

    setOpLoading(true);
    setError(null);

    try {
      if (envMode === "mock") {
        const mockBookAddr = `0x${Math.random().toString(16).slice(2).padEnd(40, "0").slice(0, 40)}`;
        const mockTx = `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`;
        setContractAddr(mockBookAddr);

        const newBook: BookSales = {
          address: mockBookAddr,
          symbol: symbol.toUpperCase(),
          name: bookName,
          author: author || "未知作者",
          sales: 0,
          explorerUrl: "#",
        };

        const nextBooks = [newBook, ...loadBooksFromStorage()];
        saveBooksToStorage(nextBooks);
        setBookSales(nextBooks);
        showToast(`Demo：合约部署成功！${symbol.toUpperCase()}`, "success", mockTx);
        return;
      }

      const ok = window.confirm(
        `部署将由后端自动完成：\n- 从出版社余额扣除 ${DEPLOY_FEE_USDT} USDT（防垃圾费）\n- 然后部署合约\n\n继续？\n收款地址：${TREASURY_ADDRESS}`
      );
      if (!ok) {
        showToast("已取消部署", "error");
        return;
      }

      const publisher = (pubAddress || "").trim();
      if (!isHexAddress(publisher)) {
        throw new Error(`publisher 地址无效（需要 0x + 40 位十六进制）：${publisher}`);
      }

      const url = `${origin()}/api/v1/publisher/deploy-book`;
      const result = await fetchJsonOrThrow<any>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bookName,
          symbol: symbol.toUpperCase(),
          author: author || "未知作者",
          serial: serial || `SERIAL${Date.now()}`,
          publisher,
        }),
      });

      if (!result?.ok) throw new Error(result?.error || "部署失败");

      // 后端可能会返回 bookAddr 为空（如果没等receipt解析事件），这里做兼容
      if (result.bookAddr) setContractAddr(result.bookAddr);

      // ✅ 扣费成功后，立刻刷新 USDT 余额（你要的 10100 -> 10090）
      await refreshAfterTopup({ symbol: "USDT", address: USDT_ADDRESS });

      const txHash = result.txHash || "";
      const explorerTx = txHash ? `https://evmtestnet.confluxscan.io/tx/${txHash}` : "#";

      const newBook: BookSales = {
        address: result.bookAddr || "(pending)",
        symbol: symbol.toUpperCase(),
        name: bookName,
        author: author || "未知作者",
        sales: 0,
        explorerUrl: explorerTx,
      };

      const nextBooks = [newBook, ...loadBooksFromStorage()];
      saveBooksToStorage(nextBooks);
      setBookSales(nextBooks);

      // feeTxHash 也展示一下（更像“支付+部署”）
      const feeTxHash = result.feeTxHash;
      if (feeTxHash) {
        showToast(`已扣除 ${DEPLOY_FEE_USDT} USDT，合约部署交易已发出`, "success", feeTxHash);
      } else {
        showToast(`部署成功（并已扣除 ${DEPLOY_FEE_USDT} USDT）`, "success", txHash);
      }
    } catch (e: any) {
      setError(e?.message || "部署失败，请检查参数");
      showToast(e?.message || "部署失败", "error");
    } finally {
      setOpLoading(false);
    }
  };

  const handleGenerateBatch = async () => {
    if (!contractAddr) {
      showToast("请先选择已部署的书籍合约", "error");
      return;
    }

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
      if (envMode === "mock") {
        await new Promise((resolve) => setTimeout(resolve, 800));
        showToast(`Demo：已生成 ${n} 个二维码（ZIP）`, "success");
        return;
      }

      const url = `${origin()}/api/v1/publisher/zip?count=${encodeURIComponent(String(n))}&contract=${encodeURIComponent(
        contractAddr
      )}`;

      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `请求失败：${res.status}`);
      }

      const blob = await res.blob();
      const dlUrl = window.URL.createObjectURL(blob);

      // ✅ 同域名情况下 res.headers 直接可读；若未来跨域，也可在后端加 Expose-Headers
      const cd = res.headers.get("content-disposition") || "";
      const filename = pickFilenameFromContentDisposition(cd, `WhaleVault_Codes_${n}_${Date.now()}.zip`);

      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = filename; // ✅ 不再写死，使用后端返回的带时间戳文件名
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

  const handleLogout = () => {
    localStorage.removeItem("vault_pub_auth");
    localStorage.removeItem("vault_user_role");
    localStorage.removeItem("vault_code_hash");
    navigate("/bookshelf");
  };

  const ctx: PublisherOutletContext = {
    envMode,
    toggleEnvMode,
    apiBaseUrl,
    pubAddress,

    balanceCFX,
    maxDeploys,
    balanceLoading,
    fetchPublisherBalanceData,

    balanceUSDT,
    usdtLoading,
    refreshAfterTopup,

    bookSales,
    regionRanks,
    totalSales,

    nftStatsMap,
    refreshNftStats,

    bookName,
    setBookName,
    author,
    setAuthor,
    symbol,
    setSymbol,
    serial,
    setSerial,
    contractAddr,
    setContractAddr,

    count,
    setCount,

    bookQuery,
    setBookQuery,
    bookCandidates,
    bookSearchLoading,
    selectedBook,
    setSelectedBook,

    loading,
    opLoading,
    error,

    handleDeployContract,
    handleGenerateBatch,

    shortenAddress,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 text-sm">{envMode === "mock" ? "加载 Mock 数据..." : "连接后端 API..."}</p>
        </div>
      </div>
    );
  }

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
                  {(pubAddress || "").slice(0, 6)}...{(pubAddress || "").slice(-4)}
                </p>
                <span
                  className={`text-[10px] ${
                    envMode === "mock" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  } px-2 py-0.5 rounded-full font-medium`}
                >
                  {envMode === "mock" ? "Demo" : "Dev API"}
                </span>
              </div>

              {/* ✅ 明示费用提示（防垃圾费） */}
              {envMode === "real" ? (
                <div className="mt-1 text-[11px] text-slate-500">
                  部署会由后端自动完成并扣除 <b>{DEPLOY_FEE_USDT} USDT</b>（防垃圾费）→ 收款地址{" "}
                  {shortenAddress(TREASURY_ADDRESS)}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-4 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl">
              <div className="text-center">
                <p className="text-[10px] text-emerald-600 uppercase font-medium">CFX 余额</p>
                <p className="text-lg font-bold text-emerald-700">{balanceLoading ? "..." : balanceCFX.toFixed(2)}</p>
              </div>

              <div className="w-px h-8 bg-emerald-200"></div>

              <div className="text-center">
                <p className="text-[10px] text-sky-600 uppercase font-medium">USDT 余额</p>
                <p className="text-lg font-bold text-sky-700">{usdtLoading ? "..." : balanceUSDT.toFixed(2)}</p>
              </div>

              <div className="w-px h-8 bg-emerald-200"></div>

              <div className="text-center">
                <p className="text-[10px] text-teal-600 uppercase font-medium">可部署次数</p>
                <p className="text-lg font-bold text-teal-700">{balanceLoading ? "..." : maxDeploys}</p>
              </div>

              <button
                onClick={fetchPublisherBalanceData}
                className="ml-2 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                title="刷新余额"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => navigate("/publisher-admin/overview")}
                className="px-3 py-2 text-xs font-medium rounded-md hover:bg-white"
              >
                📊 销量总览
              </button>
              <button
                onClick={() => navigate("/publisher-admin/add-book")}
                className="px-3 py-2 text-xs font-medium rounded-md hover:bg-white"
              >
                📚 新增图书
              </button>
              <button
                onClick={() => navigate("/publisher-admin/qrcode")}
                className="px-3 py-2 text-xs font-medium rounded-md hover:bg-white"
              >
                🔗 生成二维码
              </button>
              <button
                onClick={() => navigate("/publisher-admin/analytics")}
                className="px-3 py-2 text-xs font-medium rounded-md hover:bg-white"
              >
                🗺️ 热力分析
              </button>
              <button
                onClick={() => navigate("/publisher-admin/topup")}
                className="px-3 py-2 text-xs font-medium rounded-md hover:bg-white"
              >
                💳 多资产充值
              </button>
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
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
