import { useAppMode } from '../contexts/AppModeContext';
import { useCallback } from 'react';
import { MOCK_BOOKS, mockDelay, generateFakeTxHash } from '../data/mockData';

/**
 * 统一 API Hook - 根据模式自动切换 Mock / 真实 API
 */
export const useApi = () => {
  const { isMockMode, apiBaseUrl } = useAppMode();

  // 通用 fetch 封装
  const apiFetch = useCallback(async <T>(
    endpoint: string,
    options?: RequestInit,
    mockFn?: () => Promise<T>
  ): Promise<T> => {
    if (isMockMode && mockFn) {
      return mockFn();
    }

    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }, [isMockMode, apiBaseUrl]);

  // 获取书籍/市场数据
  const fetchBooks = useCallback(async (page = 1) => {
    return apiFetch(
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

  // 验证接口
  const verifyCode = useCallback(async (address: string, codeHash: string) => {
    return apiFetch(
      `/secret/verify?address=${address}&codeHash=${codeHash}`,
      { method: 'GET' },
      async () => {
        await mockDelay(800);
        // Mock: 根据 hash 前缀模拟角色
        if (codeHash.startsWith('pub_')) return { ok: true, role: 'publisher' };
        if (codeHash.startsWith('adm_')) return { ok: true, role: 'admin' };
        return { ok: true, role: 'reader' };
      }
    );
  }, [apiFetch]);

  // Mint NFT
  const mintNFT = useCallback(async (hashCode: string, walletAddress: string) => {
    return apiFetch(
      `/api/v1/mint`,
      {
        method: 'POST',
        body: JSON.stringify({ hashCode, walletAddress }),
      },
      async () => {
        await mockDelay(1500);
        return {
          success: true,
          txHash: generateFakeTxHash(),
          tokenId: Math.floor(Math.random() * 100000) + 1,
        };
      }
    );
  }, [apiFetch]);

  // 获取热力图数据
  const fetchHeatmapData = useCallback(async () => {
    return apiFetch(
      `/api/v1/heatmap`,
      { method: 'GET' },
      async () => {
        await mockDelay(300);
        return {
          regions: [
            { name: '北京', value: [116.4, 39.9, 45] },
            { name: '上海', value: [121.4, 31.2, 38] },
            { name: 'San Francisco', value: [-122.4, 37.77, 42] },
          ],
        };
      }
    );
  }, [apiFetch]);

  return {
    isMockMode,
    apiFetch,
    fetchBooks,
    verifyCode,
    mintNFT,
    fetchHeatmapData,
  };
};
