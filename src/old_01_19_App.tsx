import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import MintConfirm from './pages/MintConfirm'
import Success from './pages/Success'
import Heatmap from './pages/Heatmap'
import AdminDashboard from './pages/AdminDashboard'

// 核心：身份分流中转站
function AuthGate() {
  const { hashCode } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const identifyAndRedirect = async () => {
      try {
        // 第一步：根据 Code 获取绑定的预分配钱包地址
        const bindRes = await fetch(`http://192.168.47.130:8080/secret/get-binding?codeHash=${hashCode}`);
        const bindData = await bindRes.json();
        const userAddress = bindData.address;

        if (!userAddress) {
          navigate('/?error=no_binding');
          return;
        }

        // 第二步：根据钱包地址验证角色
        const verifyRes = await fetch(`http://192.168.47.130:8080/secret/verify?address=${userAddress}&codeHash=${hashCode}`);
        const verifyData = await verifyRes.json();

        if (verifyData.ok) {
          // 根据后端 verifyHandler 返回的 Role 字段跳转
          if (verifyData.role === 'publisher') {
            // 跳转到后台页面，同时传递地址和激活码作为查询参数
            navigate(`/admin/dashboard?address=${userAddress}&codeHash=${hashCode}`);
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
        navigate('/?error=server_error');
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

// 新增：后台路由守卫组件
function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const checkAccess = async () => {
      // 从查询参数中获取地址和激活码
      const searchParams = new URLSearchParams(location.search);
      const address = searchParams.get('address');
      const codeHash = searchParams.get('codeHash');

      if (!address || !codeHash) {
        setError('缺少必要的验证参数');
        navigate('/');
        return;
      }

      try {
        // 1. 先验证是否是出版社
        const verifyRes = await fetch(`http://192.168.47.130:8080/secret/verify?address=${address}&codeHash=${codeHash}`);
        const verifyData = await verifyRes.json();

        if (verifyData.ok && verifyData.role === 'publisher') {
          // 2. 再检查后台访问权限
          const accessRes = await fetch(`http://192.168.47.130:8080/api/admin/check-access?address=${address}&codeHash=${codeHash}`);
          const accessData = await accessRes.json();

          if (accessData.ok && accessData.role === 'publisher') {
            setAuthorized(true);
          } else {
            setError('访问被拒绝：仅限出版社访问后台');
            setTimeout(() => navigate('/'), 3000);
          }
        } else {
          setError('您不是出版社，无法访问此页面');
          setTimeout(() => navigate('/'), 3000);
        }
      } catch (error) {
        console.error('后台访问验证失败:', error);
        setError('验证失败，请重试');
        setTimeout(() => navigate('/'), 3000);
      } finally {
        setLoading(false);
      }
    };

    checkAccess();
  }, [location, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="text-cyan-500">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <div>验证后台访问权限...</div>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center">
        <div className="text-4xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold mb-2 text-red-400">访问被拒绝</h1>
        <p className="text-gray-400 mb-4">{error}</p>
        <p className="text-sm text-gray-500">正在跳转到首页...</p>
      </div>
    );
  }

  return <>{children}</>;
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
            
            {/* 出版社后台页面（受保护路由） */}
            <Route 
              path="/admin/dashboard" 
              element={
                <ProtectedAdminRoute>
                  <AdminDashboard />
                </ProtectedAdminRoute>
              } 
            />
            <Route 
              path="/admin/overview" 
              element={
                <ProtectedAdminRoute>
                  <AdminDashboard />
                </ProtectedAdminRoute>
              } 
            />
            
            {/* 预留作者页面 */}
            <Route 
              path="/author/dashboard" 
              element={
                <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
                  <div className="text-center">
                    <h1 className="text-2xl font-bold mb-4 text-cyan-500">作者后台</h1>
                    <p className="text-gray-400">功能开发中...</p>
                  </div>
                </div>
              } 
            />
          </Routes>
        </main>
        
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center text-white/30 text-xs tracking-widest uppercase">
          Whale Vault • Decentralized Identity System © {new Date().getFullYear()}
        </footer>
      </div>
    </BrowserRouter>
  )
}
