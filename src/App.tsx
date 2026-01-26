import React from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'

// 导入页面组件
import Home from './pages/Home'
import MintConfirm from './pages/MintConfirm'
import Success from './pages/Success'
import Reward from './pages/Reward' 
import Publisher from './pages/Publisher';

export default function App() {
  return (
    <BrowserRouter>
      {/* 使用 flex-col 并设置 min-h-screen 确保容器有高度且背景统一 */}
      <div className="min-h-screen bg-[#0f172a] flex flex-col text-white"> 
        <main className="flex-grow">
          <Routes>
            {/* 首页：用于手动输入 Hash Code */}
            <Route path="/" element={<Home />} />
            
            {/* 铸造确认页：扫码进入后自动填充地址并由后端代付 Gas */}
            <Route path="/valut_mint_nft/:hashCode" element={<MintConfirm />} />
            
            {/* 成功页：展示勋章编号、Matrix 社区入口及链上存证 */}
            <Route path="/success" element={<Success />} />

            {/* 奖励领取页：集齐 5 码换取 0.001 MON 返利 */}
            <Route path="/reward" element={<Reward />} />

            {/* 出版社管理后台：查看热力图与销售统计 */}
            <Route path="/publisher-admin" element={<Publisher />} />

            {/* 兜底路由：404 页面 */}
            <Route path="*" element={
              <div className="p-10 text-center">
                <h2 className="text-2xl font-bold text-red-400">404</h2>
                <p className="text-slate-400 mt-2">页面未找到，请检查 URL 是否正确</p>
                <Link to="/" className="text-blue-400 underline mt-4 block">返回首页</Link>
              </div>
            } />
          </Routes>
        </main>
        
        {/* 底部页脚：包含测试入口链接及版权信息 */}
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center border-t border-white/5 w-full">
          <div className="mb-4">
            <Link to="/reward" className="text-blue-400 hover:text-blue-300 text-sm underline">
              测试入口：5 码换返利页面
            </Link>
          </div>
          <p className="text-white/30 text-[10px] tracking-[0.2em] uppercase">
            Whale Vault • Decentralized Identity System © {new Date().getFullYear()}
          </p>
          <p className="text-blue-500/20 text-[9px] mt-1 font-mono">
            Monad Hackathon 2026 Submission
          </p>
        </footer>
      </div>
    </BrowserRouter>
  )
}
