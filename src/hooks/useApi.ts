import { useAppMode } from "../contexts/AppModeContext";
import { useCallback } from "react";
import { ethers } from "ethers";
import {
  MOCK_BOOKS,
  MOCK_REGIONS,
  MOCK_LEADERBOARD,
  mockDelay,
  generateFakeTxHash,
} from "../data/mockData";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

type TxStatus = "SUCCESS" | "PENDING" | "FAILED";

// ERC20 minimal ABI for balance query
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

const isHexAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test((v || "").trim());

export const useApi = () => {
  const { isMockMode, apiBaseUrl } = useAppMode();

  /**
   * 统一 fetch：自动 Mock/Real，且对非 JSON（HTML/网关错误页）更友好
   */
  const apiFetch = useCallback(
    async <T,>(endpoint: string, options?: RequestInit, mockFn?: () => Promise<T>): Promise<T> => {
      if (isMockMode && mockFn) return mockFn();

      const base = (apiBaseUrl || "").replace(/\/$/, "");
      const url = `${base}${endpoint}`;
      console.log(`[API] ${options?.method || "GET"} ${url}`);

      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options?.headers || {}),
        },
      });

      const contentType = res.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");

      // 非 JSON：尽量把服务端返回的文本吐出来方便排查
      if (!isJson) {
        const text = await res.text().catch(() => "");
        const preview = text.slice(0, 300);
        if (!res.ok) {
          throw new Error(`API 非JSON错误: HTTP ${res.status}. ${preview}`);
        }
        // 状态 ok 但不是 json，也视为错误
        throw new Error(`响应格式错误: 期望 JSON，但得到 ${contentType || "unknown"}: ${preview}`);
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `API 错误: ${res.status} ${res.statusText}`;
        throw new Error(msg);
      }
      return data as T;
    },
    [isMockMode, apiBaseUrl]
  );

  // ================== 读者相关 ==================

  /**
   * 铸造 NFT
   * POST /relay/mint
   */
  const mintNFT = useCallback(
    async (bookAddress: string, readerAddress: string) => {
      return apiFetch<ApiResponse<{ tx_hash: string }>>(
        `/relay/mint`,
        {
          method: "POST",
          body: JSON.stringify({
            book_address: bookAddress,
            reader_address: readerAddress,
          }),
        },
        async () => {
          await mockDelay(1200);
          return { ok: true, data: { tx_hash: generateFakeTxHash() } };
        }
      );
    },
    [apiFetch]
  );

  /**
   * 查询交易状态
   * GET /relay/tx/{txHash}
   */
  const queryTransaction = useCallback(
    async (txHash: string) => {
      return apiFetch<
        ApiResponse<{
          status: TxStatus;
          reader: string;
          tokenId: string;
          contract: string;
          txHash: string;
        }>
      >(
        `/relay/tx/${encodeURIComponent(txHash)}`,
        { method: "GET" },
        async () => {
          await mockDelay(700);
          return {
            ok: true,
            data: {
              status: "SUCCESS",
              reader: "0x5ad82cEB0A10153C06F1215B70d0a5dB97Ad9240",
              tokenId: String(Math.floor(Math.random() * 1000) + 1),
              contract: "0xe250ae653190F2EDF3ac79FD9bdF2687A90CDE84",
              txHash,
            },
          };
        }
      );
    },
    [apiFetch]
  );

  // ================== 验证相关 ==================

  /**
   * GET /secret/verify?codeHash=xxx
   */
  const verifyCode = useCallback(
    async (codeHash: string) => {
      return apiFetch<{ ok: boolean; role: string; error?: string }>(
        `/secret/verify?codeHash=${encodeURIComponent(codeHash)}`,
        { method: "GET" },
        async () => {
          await mockDelay(600);
          if (codeHash.toLowerCase().startsWith("pub")) return { ok: true, role: "publisher" };
          if (codeHash.toLowerCase().startsWith("auth")) return { ok: true, role: "author" };
          return { ok: true, role: "reader" };
        }
      );
    },
    [apiFetch]
  );

  /**
   * GET /secret/get-binding?codeHash=xxx
   */
  const getBinding = useCallback(
    async (codeHash: string) => {
      return apiFetch<{
        ok: boolean;
        address?: string;
        book_address?: string;
        role?: string;
        status?: string;
        message?: string;
        error?: string;
      }>(
        `/secret/get-binding?codeHash=${encodeURIComponent(codeHash)}`,
        { method: "GET" },
        async () => {
          await mockDelay(400);
          return {
            ok: true,
            address: `0x${codeHash.slice(0, 40).padEnd(40, "0")}`,
            book_address: "0xe250ae653190F2EDF3ac79FD9bdF2687A90CDE84",
            role: "reader",
            status: "valid",
            message: "读者激活码有效",
          };
        }
      );
    },
    [apiFetch]
  );

  // ================== 返利相关 ==================

  /**
   * POST /relay/save-code
   */
  const saveCode = useCallback(
    async (codeHash: string, walletAddress: string) => {
      return apiFetch<ApiResponse<{ message: string }>>(
        `/relay/save-code`,
        {
          method: "POST",
          body: JSON.stringify({ code_hash: codeHash, wallet_address: walletAddress }),
        },
        async () => {
          await mockDelay(400);
          return { ok: true, data: { message: "书码保存成功" } };
        }
      );
    },
    [apiFetch]
  );

  /**
   * POST /relay/reward
   */
  const claimReward = useCallback(
    async (walletAddress: string) => {
      return apiFetch<ApiResponse<{ tx_hash: string; count: number }>>(
        `/relay/reward`,
        {
          method: "POST",
          body: JSON.stringify({ wallet_address: walletAddress }),
        },
        async () => {
          await mockDelay(1200);
          return {
            ok: true,
            data: {
              tx_hash: generateFakeTxHash(),
              count: Math.floor(Math.random() * 20) + 1,
            },
          };
        }
      );
    },
    [apiFetch]
  );

  /**
   * GET /relay/stats
   */
  const getLeaderboard = useCallback(async () => {
    return apiFetch<{ ok: boolean; all_stats: Record<string, string> }>(
      `/relay/stats`,
      { method: "GET" },
      async () => {
        await mockDelay(450);
        const stats: Record<string, string> = {};
        MOCK_LEADERBOARD.forEach((item) => {
          stats[item.address] = String(item.count);
        });
        return { ok: true, all_stats: stats };
      }
    );
  }, [apiFetch]);

  // ================== 出版社相关 ==================

  /**
   * ✅ 获取出版社余额（你后端实际要求：必须带 codeHash）
   * GET /api/v1/publisher/balance?publisher=0x...&codeHash=xxx
   * - 兼容 address=0x...（一些旧代码可能还在用）
   */
  const getPublisherBalance = useCallback(
    async (publisherAddrOrAddress: string, codeHash: string) => {
      const publisher = (publisherAddrOrAddress || "").trim();
      const ch = (codeHash || "").trim();

      return apiFetch<{ ok: boolean; balance: string; maxDeploys: number }>(
        `/api/v1/publisher/balance?publisher=${encodeURIComponent(publisher)}&address=${encodeURIComponent(
          publisher
        )}&codeHash=${encodeURIComponent(ch)}`,
        { method: "GET" },
        async () => {
          await mockDelay(350);
          return {
            ok: true,
            balance: (Math.random() * 200).toFixed(2),
            maxDeploys: Math.floor(Math.random() * 20) + 5,
          };
        }
      );
    },
    [apiFetch]
  );

  /**
   * ✅ 获取 ERC20 余额（用于 USDT 等 token）
   * - 走链上 RPC（不依赖后端）
   * - 返回 balance 是“人类可读”的字符串（已按 decimals 格式化）
   *
   * 注意：你必须传 eSpace RPC（例如 https://evm.confluxrpc.com）+ 0x 地址
   */
  const getErc20Balance = useCallback(
    async (rpcUrl: string, tokenAddress: string, ownerAddress: string) => {
      const rpc = (rpcUrl || "").trim();
      const token = (tokenAddress || "").trim();
      const owner = (ownerAddress || "").trim();

      if (!rpc) throw new Error("rpcUrl 为空");
      if (!isHexAddress(token)) throw new Error(`token 地址无效（需要 0x + 40 位十六进制）：${token}`);
      if (!isHexAddress(owner)) throw new Error(`owner 地址无效（需要 0x + 40 位十六进制）：${owner}`);

      // mock：返回一个看起来合理的数
      if (isMockMode) {
        await mockDelay(250);
        return { ok: true, token, owner, symbol: "USDT", decimals: 6, balance: (Math.random() * 500).toFixed(2) };
      }

      const provider = new ethers.JsonRpcProvider(rpc);
      const c = new ethers.Contract(token, ERC20_ABI, provider);

      // 有些 token 的 symbol() 可能 revert，所以单独 try
      const [raw, decimals, symbol] = await Promise.all([
        c.balanceOf(owner),
        c.decimals(),
        c.symbol().catch(() => "TOKEN"),
      ]);

      const human = ethers.formatUnits(raw, Number(decimals));
      return { ok: true, token, owner, symbol, decimals: Number(decimals), balance: human };
    },
    [isMockMode]
  );

  // ❌ 你要求立刻删掉：deployBook（带 privKey 的版本）
  // 如果你之后要做“无 privKey”的部署，请在 PublisherAdminLayout 里继续用你现在的 POST /api/v1/publisher/deploy-book（后端从 Redis 取私钥）。

  // ================== 分析相关 ==================

  /**
   * 真实后端：GET /api/v1/analytics/distribution
   */
  const fetchDistribution = useCallback(async () => {
    return apiFetch<{ ok: boolean; regions: Array<{ name: string; value: [number, number, number] }> }>(
      `/api/v1/analytics/distribution`,
      { method: "GET" },
      async () => {
        await mockDelay(300);
        return { ok: true, regions: MOCK_REGIONS };
      }
    );
  }, [apiFetch]);

  /**
   * 市场数据：GET /api/v1/market/tickers
   */
  const fetchBooks = useCallback(
    async (page = 1) => {
      return apiFetch<{ data: typeof MOCK_BOOKS; total: number; page: number }>(
        `/api/v1/market/tickers?page=${encodeURIComponent(String(page))}`,
        { method: "GET" },
        async () => {
          await mockDelay(450);
          return { data: MOCK_BOOKS, total: MOCK_BOOKS.length, page };
        }
      );
    },
    [apiFetch]
  );

  return {
    isMockMode,
    apiBaseUrl,
    apiFetch,

    // 读者
    mintNFT,
    queryTransaction,

    // 验证
    verifyCode,
    getBinding,

    // 返利
    saveCode,
    claimReward,
    getLeaderboard,

    // 出版社
    getPublisherBalance,
    getErc20Balance,

    // 分析
    fetchDistribution,

    // 市场
    fetchBooks,
  };
};
