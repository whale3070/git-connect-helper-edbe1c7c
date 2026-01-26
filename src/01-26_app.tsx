import React from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom' // 新增 Link 用于内部导航
// 1. 不再引入 NavBar，彻底移除顶部的管理入口和钱包连接按钮
import Home from './pages/Home'
import MintConfirm from './pages/MintConfirm'
import Success from './pages/Success'
import Reward from './pages/Reward' // 导入你刚刚在 src/pages/ 下创建的奖励页面

export default function App() {
  return (
    <BrowserRouter>
      {/* 移除了 min-h-screen 下的 <NavBar /> */}
      <div className="min-h-screen bg-[#0f172a] flex flex-col"> 
        <main className="flex-grow">
          <Routes>
            {/* 首页：用于输入单一 Hash Code */}
            <Route path="/" element={<Home />} />
            
            {/* 铸造确认页：自动填充地址并代付 Gas */}
            <Route path="/valut_mint_nft/:hashCode" element={<MintConfirm />} />
            
            {/* 成功页：展示勋章编号和 Matrix 入口 */}
            <Route path="/success" element={<Success />} />

            {/* 核心新增：5 码换奖励页面 */}
            <Route path="/reward" element={<Reward />} />

            {/* 2. 删除了 /settings 路由 */}
            {/* 3. 删除了整个 /admin 及其子路由组 */}
          </Routes>
        </main>
        
        {/* 简洁的底部标识 */}
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center">
          <div className="mb-4">
             {/* 增加一个跳转到奖励页面的入口，方便读者发现 5 码返利功能 */}
             <Link to="/reward" className="text-white/20 hover:text-white/50 text-xs transition-colors underline decoration-dotted">
                持有 5 本实体书？点击申领返利
             </Link>
          </div>
          <div className="text-white/30 text-xs tracking-widest uppercase">
            Whale Vault • Decentralized Identity System © {new Date().getFullYear()}
          </div>
        </footer>
      </div>
    </BrowserRouter>
  )
}
