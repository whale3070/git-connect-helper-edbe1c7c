import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';

// 导入所有页面组件
import Home from './pages/Home';
import Success from './pages/Success';
import Reward from './pages/Reward';
import Publisher from './pages/Publisher';
import Heatmap from './pages/Heatmap';
import Bookshelf from './pages/Bookshelf'; 
import BookDetail from './pages/BookDetail'; 
import VerifyPage from './pages/VerifyPage'; 
import MintConfirm from './pages/MintConfirm';

// 模式切换
import { AppModeProvider } from './contexts/AppModeContext';
import ModeSwitcher from './components/ModeSwitcher';

export default function App() {
  
  /**
   * 核心验证逻辑：对接后端 verify 接口
   */
  const handleVerify = async (addr: string, hash: string) => {
    try {
      if (!addr || !hash) {
        console.warn("HandleVerify: 地址或哈希缺失", { addr, hash });
        return null;
      }

      const response = await fetch(`http://198.55.109.102:8080/secret/verify?address=${addr}&codeHash=${hash}`);
      
      if (!response.ok) {
        console.error("验证接口返回错误状态:", response.status);
        return null;
      }

      const data = await response.json();
      return data.ok ? data.role : null;
    } catch (err) {
      console.error("验证接口连接异常", err);
      return null;
    }
  };

  return (
    <AppModeProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-[#0b0e11] flex flex-col text-[#d1d4dc]">
          {/* 模式切换按钮 - 固定在右下角 */}
          <ModeSwitcher />
        
        <main style={{ minHeight: '80vh', position: 'relative', flexGrow: 1 }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/bookshelf" element={<Bookshelf />} />

            {/* --- 核心修复：注册独立的铸造执行路径 --- */}
            {/* 这里的 path 必须使用 :hashCode，以匹配 MintConfirm 中的 useParams() */}
            <Route path="/mint/:hashCode" element={<MintConfirm />} />

            {/* 金库路径确权 (第一入口：用于身份识别、博弈弹窗) */}
            <Route 
              path="/vault_mint_nft/:hash" 
              element={<VerifyPage onVerify={handleVerify} />} 
            />
            {/* 容错拼写 */}
            <Route 
              path="/valut_mint_nft/:hash" 
              element={<VerifyPage onVerify={handleVerify} />} 
            />

            <Route path="/verify/:hash" element={<VerifyPage onVerify={handleVerify} />} />
            <Route path="/verify" element={<VerifyPage onVerify={handleVerify} />} />

            {/* 业务路由 */}
            <Route path="/success" element={<Success />} />
            <Route path="/reward" element={<Reward />} />
            <Route path="/publisher-admin" element={<Publisher />} />
            <Route path="/Heatmap" element={<Heatmap />} />
            <Route path="/book/:address" element={<BookDetail />} />
            
            {/* 404 页面 */}
            <Route path="*" element={
              <div className="flex flex-col items-center justify-center h-[60vh]">
                <h1 className="text-4xl font-bold text-[#2962ff] mb-4">404</h1>
                <p className="text-white/60 text-sm">TERMINAL ERROR: PATH NOT FOUND</p>
                <Link to="/bookshelf" className="mt-6 text-[#2962ff] underline">返回大盘列表</Link>
              </div>
            } />
          </Routes>
        </main>
        
        <footer className="bg-[#131722] border-t border-[#1e222d] px-8 py-4">
          <div className="max-w-[1600px] mx-auto flex justify-between items-center text-[10px] text-[#5d606b]">
            <div className="flex gap-6">
              <Link to="/bookshelf" className="hover:text-[#2962ff] uppercase tracking-tighter">Market</Link>
              <Link to="/Heatmap" className="hover:text-[#2962ff] uppercase tracking-tighter">Global Echo</Link>
              <Link to="/reward" className="hover:text-[#2962ff] uppercase tracking-tighter">Referral System</Link>
              <Link to="/verify" className="hover:text-white uppercase tracking-tighter">🔐 Admin Portal</Link>
            </div>
            <div className="uppercase tracking-widest text-right">
              Whale Vault Protocol • Terminal v1.1.2 • Monad Hackathon 2026
            </div>
          </div>
          </footer>
        </div>
      </BrowserRouter>
    </AppModeProvider>
  );
}