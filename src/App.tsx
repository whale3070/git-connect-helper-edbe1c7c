import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';

// 导入所有页面组件
import Home from './pages/Home';
import MintConfirm from './pages/MintConfirm';
import Success from './pages/Success';
import Reward from './pages/Reward';
import Publisher from './pages/Publisher';
import Heatmap from './pages/Heatmap'; // 新增：导入热力图组件

export default function App() {
  return (
    <BrowserRouter>
      {/* 统一背景与布局 */}
      <div className="min-h-screen bg-[#0f172a] flex flex-col text-white"> 
        <main className="flex-grow">
          <Routes>
            {/* 1. 首页：引导扫码 */}
            <Route path="/" element={<Home />} />
            
            {/* 2. 铸造确权页：一书一码一钱包 */}
            <Route path="/valut_mint_nft/:hashCode" element={<MintConfirm />} />
            
            {/* 3. 成功反馈页：领取 NFT 后的着陆页 */}
            <Route path="/success" element={<Success />} />

            {/* 4. 推荐返利页：5 码换返利功能 */}
            <Route path="/reward" element={<Reward />} />

            {/* 5. 出版社管理后台 */}
            <Route path="/publisher-admin" element={<Publisher />} />

            {/* 6. 全球读者回响热力图：可视化确权分布 */}
            <Route path="/Heatmap" element={<Heatmap />} />

            {/* 7. 404 兜底路由 */}
            <Route path="*" element={
              <div className="flex flex-col items-center justify-center h-[60vh]">
                <h1 className="text-4xl font-bold text-cyan-500 mb-4">404</h1>
                <p className="text-white/60">页面未找到，请检查扫码链接是否正确</p>
                <Link to="/" className="mt-6 text-blue-400 underline">返回首页</Link>
              </div>
            } />
          </Routes>
        </main>
        
        {/* 页脚：包含系统标识与快速测试入口 */}
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center border-t border-white/5">
          <div className="flex flex-wrap justify-center gap-6 mb-4 text-sm">
            <Link to="/reward" className="text-blue-400 hover:text-blue-300 underline">
              推荐奖励系统
            </Link>
            <Link to="/Heatmap" className="text-cyan-400 hover:text-cyan-300 underline">
              全球读者分布
            </Link>
          </div>
          <p className="text-white/30 text-xs tracking-widest uppercase">
            Whale Vault • Monad Hackathon 2026 • Decentralized Identity System
          </p>
        </footer>
      </div>
    </BrowserRouter>
  )
}
