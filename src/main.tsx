// 1. 物理补丁：必须放在所有 import 之前，强行压制环境报错
if (typeof window !== 'undefined' && !window.crypto.randomUUID) {
  // @ts-ignore
  window.crypto.randomUUID = function() {
    return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: any) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
  };
  console.log("Whale Vault: 已注入 crypto.randomUUID 兼容性补丁");
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
// import './i18n' // 如果之前导致白屏，请先保持注释，等页面亮了再开启

// 2. 导入 Wagmi v2 新组件
import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// 3. 初始化 React Query (Wagmi v2 的必需品)
const queryClient = new QueryClient()

// 4. 配置 Wagmi v2
const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
})

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

createRoot(rootElement).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)