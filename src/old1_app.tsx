import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
// 1. 不再引入 NavBar，彻底移除顶部的管理入口和钱包连接按钮
import Home from './pages/Home'
import MintConfirm from './pages/MintConfirm'
import Success from './pages/Success'

export default function App() {
  return (
    <BrowserRouter>
      {/* 移除了 min-h-screen 下的 <NavBar /> */}
      <div className="min-h-screen bg-[#0f172a]"> 
        <main>
          <Routes>
            {/* 首页：用于输入 Hash Code */}
            <Route path="/" element={<Home />} />
            
            {/* 铸造确认页：自动填充地址并代付 Gas */}
            <Route path="/valut_mint_nft/:hashCode" element={<MintConfirm />} />
            
            {/* 成功页：展示勋章编号和 Matrix 入口 */}
            <Route path="/success" element={<Success />} />

            {/* 2. 删除了 /settings 路由 */}
            {/* 3. 删除了整个 /admin 及其子路由组 */}
          </Routes>
        </main>
        
        {/* 简洁的底部标识 */}
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center text-white/30 text-xs tracking-widest uppercase">
          Whale Vault • Decentralized Identity System © {new Date().getFullYear()}
        </footer>
      </div>
    </BrowserRouter>
  )
}
