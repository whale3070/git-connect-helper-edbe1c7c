import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import Home from './pages/Home'
import MintConfirm from './pages/MintConfirm'
import Success from './pages/Success'
import Heatmap from './pages/Heatmap'

// 核心：身份分流中转站
function AuthGate() {
  const { hashCode } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const identifyAndRedirect = async () => {
      try {
        // 第一步：根据 Code 获取绑定的预分配钱包地址
        const bindRes = await fetch(`http://localhost:8080/secret/get-binding?codeHash=${hashCode}`);
        const bindData = await bindRes.json();
        const userAddress = bindData.address;

        if (!userAddress) {
          navigate('/?error=no_binding');
          return;
        }

        // 第二步：根据钱包地址验证角色
        const verifyRes = await fetch(`http://localhost:8080/secret/verify?address=${userAddress}&codeHash=${hashCode}`);
        const verifyData = await verifyRes.json();

        if (verifyData.ok) {
          // 根据后端 verifyHandler 返回的 Role 字段跳转
          if (verifyData.role === 'publisher') {
            navigate('/heatmap');
          } else if (verifyData.role === 'author') {
            navigate('/author/dashboard');
          } else {
            // 读者身份，进入领取确认页
            navigate(`/valut_mint_nft/${hashCode}`);
          }
        } else {
          navigate('/?error=unauthorized');
        }
      } catch (err) {
        console.error("Auth Error:", err);
      }
    };

    if (hashCode) identifyAndRedirect();
  }, [hashCode, navigate]);

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-cyan-500">
      <div className="animate-pulse">正在识别预分配钱包身份...</div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0f172a]"> 
        <main>
          <Routes>
            {/* 扫码后的统一入口 */}
            <Route path="/verify/:hashCode" element={<AuthGate />} />
            
            {/* 基础页面 */}
            <Route path="/" element={<Home />} />
            <Route path="/valut_mint_nft/:hashCode" element={<MintConfirm />} />
            <Route path="/success" element={<Success />} />
            <Route path="/heatmap" element={<Heatmap />} />
            
            {/* 预留作者页面 */}
            {/* <Route path="/author/dashboard" element={<AuthorDashboard />} /> */}
          </Routes>
        </main>
        
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center text-white/30 text-xs tracking-widest uppercase">
          Whale Vault • Decentralized Identity System © {new Date().getFullYear()}
        </footer>
      </div>
    </BrowserRouter>
  )
}
