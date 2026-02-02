import { useAppMode } from '../contexts/AppModeContext';
import { useCallback } from 'react';
import { MOCK_BOOKS, MOCK_REGIONS, MOCK_LEADERBOARD, mockDelay, generateFakeTxHash } from '../data/mockData';

/**
 * 统一 API Hook - 根据模式自动切换 Mock / 真实 API
 * 
 * API 接口规范 (来自后端文档):
 * 
 * 读者:
 * - POST /relay/mint: 铸造 NFT { book_address, reader_address }
 * - GET  /relay/tx/{txHash}: 查询交易状态
 * 
 * 返利:
 * - POST /relay/save-code: 保存书码
 * - POST /relay/reward: 领取奖励
 * - GET  /relay/stats: 排行榜
 * 
 * 出版社:
 * - POST /api/v1/publisher/deploy-book: 部署新书合约
 * 
 * 验证:
 * - GET /secret/verify: 验证 codeHash
 * - GET /secret/get-binding: 获取绑定地址
 * 
 * 分析:
 * - GET /api/v1/analytics/heatmap: 热力图数据
 */

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export const useApi = () => {
  const { isMockMode, apiBaseUrl } = useAppMode();

  // 通用 fetch 封装 - 支持错误捕获和 Content-Type 检查
  const apiFetch = useCallback(async <T>(
    endpoint: string,
    options?: RequestInit,
    mockFn?: () => Promise<T>
  ): Promise<T> => {
    if (isMockMode && mockFn) {
      return mockFn();
    }

    const url = `${apiBaseUrl}${endpoint}`;
    console.log(`[API] ${options?.method || 'GET'} ${url}`);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      // 检查 Content-Type，防止 HTML 错误页面
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        const textResponse = await response.text();
        console.error('[API] Expected JSON but got:', contentType);
        console.error('[API] Response preview:', textResponse.substring(0, 200));
        
        if (textResponse.trim().startsWith('<!') || textResponse.includes('<html')) {
          throw new Error(`服务器返回 HTML 而非 JSON。可能原因：认证重定向、服务器错误或限流。状态码: ${response.status}`);
        }
        throw new Error(`响应格式错误: ${contentType || 'unknown'}`);
      }

      const data = await response.json();

      if (!response.ok) {
        // 返回后端的具体错误信息
        throw new Error(data.error || `API 错误: ${response.status} ${response.statusText}`);
      }

      return data;
    } catch (error: any) {
      console.error('[API] Request failed:', error);
      throw error;
    }
  }, [isMockMode, apiBaseUrl]);

  // ========== 读者相关 API ==========

  /**
   * 铸造 NFT
   * POST /relay/mint
   * Body: { book_address, reader_address }
   * Response: { ok: true, data: { tx_hash } }
   */
  const mintNFT = useCallback(async (bookAddress: string, readerAddress: string) => {
    return apiFetch<ApiResponse<{ tx_hash: string }>>(
      `/relay/mint`,
      {
        method: 'POST',
        body: JSON.stringify({ 
          book_address: bookAddress, 
          reader_address: readerAddress 
        }),
      },
      async () => {
        await mockDelay(1500);
        return {
          ok: true,
          data: { tx_hash: generateFakeTxHash() },
        };
      }
    );
  }, [apiFetch]);

  /**
   * 查询交易状态
   * GET /relay/tx/{txHash}
   * Response: { ok: true, data: { status, reader, tokenId, contract, txHash } }
   */
  const queryTransaction = useCallback(async (txHash: string) => {
    return apiFetch<ApiResponse<{
      status: 'SUCCESS' | 'PENDING' | 'FAILED';
      reader: string;
      tokenId: string;
      contract: string;
      txHash: string;
    }>>(
      `/relay/tx/${txHash}`,
      { method: 'GET' },
      async () => {
        await mockDelay(800);
        return {
          ok: true,
          data: {
            status: 'SUCCESS',
            reader: '0x5ad82cEB0A10153C06F1215B70d0a5dB97Ad9240',
            tokenId: String(Math.floor(Math.random() * 1000) + 1),
            contract: '0xe250ae653190F2EDF3ac79FD9bdF2687A90CDE84',
            txHash,
          },
        };
      }
    );
  }, [apiFetch]);

  // ========== 验证相关 API ==========

  /**
   * 验证 codeHash 是否有效
   * GET /secret/verify?codeHash=xxx
   * Response: { ok: true, role: 'reader' | 'publisher' | 'author' }
   */
  const verifyCode = useCallback(async (codeHash: string) => {
    return apiFetch<{ ok: boolean; role: string; error?: string }>(
      `/secret/verify?codeHash=${encodeURIComponent(codeHash)}`,
      { method: 'GET' },
      async () => {
        await mockDelay(800);
        if (codeHash.toLowerCase().startsWith('pub')) return { ok: true, role: 'publisher' };
        if (codeHash.toLowerCase().startsWith('auth')) return { ok: true, role: 'author' };
        return { ok: true, role: 'reader' };
      }
    );
  }, [apiFetch]);

  /**
   * 获取 codeHash 绑定的地址
   * GET /secret/get-binding?codeHash=xxx
   * Response: { ok: true, address: '0x...' }
   */
  const getBinding = useCallback(async (codeHash: string) => {
    return apiFetch<{ ok: boolean; address?: string; book_address?: string }>(
      `/secret/get-binding?codeHash=${encodeURIComponent(codeHash)}`,
      { method: 'GET' },
      async () => {
        await mockDelay(500);
        return {
          ok: true,
          address: `0x${codeHash.slice(0, 40).padEnd(40, '0')}`,
          book_address: '0xe250ae653190F2EDF3ac79FD9bdF2687A90CDE84',
        };
      }
    );
  }, [apiFetch]);

  // ========== 返利相关 API ==========

  /**
   * 保存书码
   * POST /relay/save-code
   * Body: { code_hash, wallet_address }
   */
  const saveCode = useCallback(async (codeHash: string, walletAddress: string) => {
    return apiFetch<ApiResponse<{ message: string }>>(
      `/relay/save-code`,
      {
        method: 'POST',
        body: JSON.stringify({ code_hash: codeHash, wallet_address: walletAddress }),
      },
      async () => {
        await mockDelay(500);
        return { ok: true, data: { message: '书码保存成功' } };
      }
    );
  }, [apiFetch]);

  /**
   * 领取奖励
   * POST /relay/reward
   * Body: { wallet_address }
   */
  const claimReward = useCallback(async (walletAddress: string) => {
    return apiFetch<ApiResponse<{ tx_hash: string; count: number }>>(
      `/relay/reward`,
      {
        method: 'POST',
        body: JSON.stringify({ wallet_address: walletAddress }),
      },
      async () => {
        await mockDelay(2000);
        return {
          ok: true,
          data: {
            tx_hash: generateFakeTxHash(),
            count: Math.floor(Math.random() * 20) + 1,
          },
        };
      }
    );
  }, [apiFetch]);

  /**
   * 获取排行榜
   * GET /relay/stats
   * Response: { ok: true, all_stats: { address: count } }
   */
  const getLeaderboard = useCallback(async () => {
    return apiFetch<{ ok: boolean; all_stats: Record<string, string> }>(
      `/relay/stats`,
      { method: 'GET' },
      async () => {
        await mockDelay(600);
        const stats: Record<string, string> = {};
        MOCK_LEADERBOARD.forEach(item => {
          stats[item.address] = String(item.count);
        });
        return { ok: true, all_stats: stats };
      }
    );
  }, [apiFetch]);

  // ========== 出版社相关 API ==========

  /**
   * 部署新书合约
   * POST /api/v1/publisher/deploy-book
   * Body: { name, symbol, author, serial, publisher, privKey }
   * Response: { ok: true, txHash, bookAddr }
   */
  const deployBook = useCallback(async (params: {
    name: string;
    symbol: string;
    author: string;
    serial: string;
    publisher: string;
    privKey: string;
  }) => {
    return apiFetch<{ ok: boolean; txHash: string; bookAddr: string; error?: string }>(
      `/api/v1/publisher/deploy-book`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
      async () => {
        await mockDelay(2000);
        const txHash = generateFakeTxHash();
        return { ok: true, txHash, bookAddr: txHash };
      }
    );
  }, [apiFetch]);

  /**
   * 获取出版社余额
   * GET /api/v1/publisher/balance?address=xxx
   */
  const getPublisherBalance = useCallback(async (address: string) => {
    return apiFetch<{ ok: boolean; balance: string; maxDeploys: number }>(
      `/api/v1/publisher/balance?address=${encodeURIComponent(address)}`,
      { method: 'GET' },
      async () => {
        await mockDelay(500);
        return {
          ok: true,
          balance: (Math.random() * 200).toFixed(2),
          maxDeploys: Math.floor(Math.random() * 20) + 5,
        };
      }
    );
  }, [apiFetch]);

  // ========== 分析相关 API ==========

  /**
   * 获取热力图数据
   * GET /api/v1/analytics/heatmap
   * Response: { ok: true, regions: [...] }
   */
  const fetchHeatmapData = useCallback(async () => {
    return apiFetch<{ ok: boolean; regions: Array<{ name: string; value: [number, number, number] }> }>(
      `/api/v1/analytics/heatmap`,
      { method: 'GET' },
      async () => {
        await mockDelay(300);
        return {
          ok: true,
          regions: MOCK_REGIONS,
        };
      }
    );
  }, [apiFetch]);

  /**
   * 获取书籍/市场数据
   * GET /api/v1/market/tickers
   */
  const fetchBooks = useCallback(async (page = 1) => {
    return apiFetch<{ data: typeof MOCK_BOOKS; total: number; page: number }>(
      `/api/v1/market/tickers?page=${page}`,
      { method: 'GET' },
      async () => {
        await mockDelay(500);
        return {
          data: MOCK_BOOKS,
          total: MOCK_BOOKS.length,
          page,
        };
      }
    );
  }, [apiFetch]);

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
    deployBook,
    getPublisherBalance,
    // 分析
    fetchHeatmapData,
    fetchBooks,
  };
};
