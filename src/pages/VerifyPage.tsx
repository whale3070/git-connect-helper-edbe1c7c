import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppMode } from '../contexts/AppModeContext';
import { useApi } from '../hooks/useApi';

interface VerifyPageProps {
  onVerify?: (address: string, codeHash: string) => Promise<'publisher' | 'author' | 'reader' | null>;
}

const VerifyPage: React.FC<VerifyPageProps> = ({ onVerify }) => {
  const navigate = useNavigate();
  const { hash } = useParams<{ hash: string }>(); 
  const { isMockMode } = useAppMode();
  const { verifyCode, getBinding } = useApi();

  const [codeHash] = useState(hash || '');
  const [targetAddress, setTargetAddress] = useState('');
  const [bookAddress, setBookAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [role, setRole] = useState<'publisher' | 'author' | 'reader' | null>(null);
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [invalidCode, setInvalidCode] = useState(false);

  useEffect(() => {
    const initTerminal = async () => {
      if (!codeHash) {
        setLoading(false);
        return;
      }
      
      try {
        // 1. 验证 codeHash 是否存在
        const verifyResult = await verifyCode(codeHash);
        
        if (!verifyResult.ok) {
          setInvalidCode(true);
          setError(verifyResult.error || '二维码验证失败');
          setLoading(false);
          return;
        }
        
        // 2. 设置角色
        if (verifyResult.role === 'publisher') {
          setRole('publisher');
        } else if (verifyResult.role === 'author') {
          setRole('author');
        } else {
          setRole('reader');
        }
        
        // 3. 获取绑定的地址
        try {
          const bindResult = await getBinding(codeHash);
          if (bindResult.ok) {
            if (bindResult.address) {
              setTargetAddress(bindResult.address);
            }
            if (bindResult.book_address) {
              setBookAddress(bindResult.book_address);
            }
          }
        } catch (bindError) {
          console.warn('获取绑定信息失败:', bindError);
          // 绑定信息可选，不阻塞流程
        }
        
        setLoading(false);
      } catch (e: any) {
        console.error('验证失败:', e);
        
        // 检查是否是 404/403 错误（无效码）
        if (e.message?.includes('403') || e.message?.includes('404') || e.message?.includes('not found') || e.message?.includes('Binding not found')) {
          setInvalidCode(true);
          setError('该二维码在系统中不存在，请购买正版书籍获取有效的激活码。');
        } else {
          setError(e.message || '网络异常，请确认后端已启动');
        }
        setLoading(false);
      }
    };
    
    initTerminal();
  }, [codeHash, verifyCode, getBinding]);

  const confirmAndGoToMint = () => {
    // 将 bookAddress 传递到铸造页面
    const params = new URLSearchParams();
    if (bookAddress) params.set('book_address', bookAddress);
    if (targetAddress) params.set('reader_address', targetAddress);
    
    navigate(`/mint/${codeHash}?${params.toString()}`);
  };

  // 无效二维码错误页面
  if (invalidCode) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full bg-[#131722] border border-white/10 rounded-[32px] p-8 text-center space-y-6 shadow-2xl">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
            <span className="text-red-500 text-4xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-white">无效的二维码</h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            {error || '该二维码无效或已被使用。请确认您扫描的是正版商品附带的二维码。'}
          </p>
          {isMockMode && (
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
              <p className="text-xs text-yellow-500/80 font-medium">
                ⚠️ DEMO 模式：使用 pub_xxx 或 auth_xxx 格式的 hash 进行测试
              </p>
            </div>
          )}
          <button 
            onClick={() => navigate('/bookshelf')}
            className="w-full py-4 rounded-xl bg-white/5 text-white font-bold text-sm uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
          >
            返回大盘
          </button>
        </div>
        <div className="mt-10 text-[9px] text-gray-600 uppercase tracking-[0.4em] font-medium">
          Whale Vault Protocol <span className="mx-2">•</span> {isMockMode ? 'DEMO MODE' : 'DEV API'}
        </div>
      </div>
    );
  }

  if (loading && !role) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center font-mono text-[10px] tracking-widest uppercase">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className={isMockMode ? 'text-cyan-500 animate-pulse' : 'text-green-500 animate-pulse'}>
          {isMockMode ? 'Mock 验证中...' : '连接后端 API...'}
        </p>
      </div>
    );
  }

  // 出版社/作者登录处理
  const handleAdminLogin = async () => {
    if (!targetAddress) {
      setError('请输入管理钱包地址');
      return;
    }
    
    // 保存登录状态到 localStorage
    localStorage.setItem('vault_pub_auth', targetAddress.toLowerCase());
    localStorage.setItem('vault_user_role', role || 'publisher');
    localStorage.setItem('vault_code_hash', codeHash);
    
    if (role === 'publisher' || role === 'author') {
      navigate('/publisher-admin');
    }
  };

  // 获取角色对应的样式和文案
  const getRoleStyle = () => {
    switch (role) {
      case 'publisher':
        return { border: 'border-purple-500/50', text: 'text-purple-500', bg: 'bg-purple-500/5', label: '出版社' };
      case 'author':
        return { border: 'border-orange-500/50', text: 'text-orange-500', bg: 'bg-orange-500/5', label: '作者' };
      case 'reader':
        return { border: 'border-green-500/50', text: 'text-green-500', bg: 'bg-green-500/5', label: '读者' };
      default:
        return { border: 'border-blue-500/50', text: 'text-blue-500', bg: 'bg-blue-500/5', label: '未知' };
    }
  };

  const roleStyle = getRoleStyle();

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#131722] p-8 rounded-[32px] border border-white/5 shadow-2xl space-y-8 relative overflow-hidden">
        
        <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent ${
          role === 'publisher' ? 'via-purple-500' : role === 'author' ? 'via-orange-500' : 'via-blue-500'
        } to-transparent opacity-50`} />

        {/* 模式标识 */}
        <div className={`${isMockMode ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-green-500/10 border-green-500/20'} border rounded-lg p-2 text-center`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${isMockMode ? 'text-cyan-400' : 'text-green-400'}`}>
            {isMockMode ? '🔧 Demo Mode - Mock Data' : '🟢 Dev API - 后端验证'}
          </p>
        </div>

        <div className="text-center space-y-4">
          <h2 className="text-[#2962ff] font-bold text-[10px] uppercase tracking-[0.5em]">Identity Terminal</h2>
          <div className="py-6 flex flex-col items-center justify-center space-y-3">
             <div className={`px-4 py-1 rounded-full border text-[10px] font-bold tracking-widest uppercase transition-all ${roleStyle.border} ${roleStyle.text} ${roleStyle.bg}`}>
               {roleStyle.label} Detected
             </div>
             <p className="text-gray-500 text-[9px] font-mono opacity-40 break-all px-4">{codeHash}</p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        {role === 'reader' ? (
          <div className="text-center space-y-6">
            <div className="space-y-1 text-center">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">预设确权地址</p>
                <p className="text-[10px] font-mono text-slate-400 break-all">{targetAddress || '0x...'}</p>
            </div>
            {bookAddress && (
              <div className="space-y-1 text-center">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">书籍合约地址</p>
                <p className="text-[10px] font-mono text-cyan-400 break-all">{bookAddress}</p>
              </div>
            )}
            <button 
              onClick={() => setShowDecisionModal(true)}
              className="w-full py-5 rounded-2xl bg-green-600 font-black text-xs uppercase tracking-widest hover:bg-green-500 active:scale-95 transition-all shadow-lg shadow-green-500/10"
            >
              立即领取 NFT 勋章
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className={`p-4 rounded-xl ${role === 'publisher' ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-orange-500/10 border border-orange-500/20'}`}>
              <p className={`text-xs ${role === 'publisher' ? 'text-purple-400' : 'text-orange-400'}`}>
                {role === 'publisher' ? '📚 出版社管理后台：查看销量、部署新书、生成二维码、热力分析' : '✍️ 作者后台：查看作品销量和读者分布'}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">绑定钱包地址</label>
              <input 
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-4 text-sm font-mono text-center outline-none focus:border-[#2962ff] transition-all"
                placeholder="0x..."
                readOnly={!!targetAddress}
              />
              <p className="text-[9px] text-slate-600 text-center">
                {isMockMode ? '此地址已与您的激活码绑定 (Mock)' : '此地址已与您的激活码绑定'}
              </p>
            </div>
            <button 
              onClick={handleAdminLogin}
              className={`w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all ${
                role === 'publisher' 
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500' 
                  : 'bg-gradient-to-r from-orange-600 to-yellow-600 hover:from-orange-500 hover:to-yellow-500'
              }`}
            >
              进入{role === 'publisher' ? '出版社' : '作者'}后台
            </button>
          </div>
        )}
      </div>

      {/* 读者博弈抉择弹窗 */}
      {showDecisionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md px-6">
          <div className="max-w-sm w-full bg-[#1c2128] border border-white/10 rounded-[40px] p-8 space-y-6 text-center shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-yellow-500/50" />
            
            <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto border border-yellow-500/20">
              <span className="text-yellow-500 text-2xl">⚠️</span>
            </div>
            
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-white italic tracking-tight">确权博弈提醒</h3>
              <p className="text-xs text-gray-400 leading-relaxed px-2">
                领取 NFT 会使该激活码失效。<br/>
                <span className="text-yellow-500/80 font-medium">若您有推荐人，请确保其已在系统中登记您的激活码，否则他将无法获得推广奖励。</span>
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => setShowDecisionModal(false)}
                  className="w-full py-4 rounded-xl bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest hover:bg-blue-500 transition-all active:scale-95"
                >
                  等推荐人先登记 (暂不领取)
                </button>
                <button 
                  onClick={confirmAndGoToMint}
                  className="w-full py-4 rounded-xl bg-white/5 text-white/70 font-bold text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
                >
                  无推荐人 / 已登记，直接领取
                </button>
              </div>
            </div>

            <button 
              onClick={() => setShowDecisionModal(false)}
              className="text-[9px] text-gray-600 uppercase tracking-widest font-bold hover:text-gray-400 transition-colors"
            >
              取消并退出
            </button>
          </div>
        </div>
      )}
      
      <div className="mt-12 text-[9px] text-gray-600 uppercase tracking-[0.4em] font-medium text-center">
        Whale Vault Protocol <span className="mx-2">•</span> {isMockMode ? 'DEMO MODE' : 'DEV API'}
      </div>
    </div>
  );
};

export default VerifyPage;
