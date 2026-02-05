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
        const verifyResult = await verifyCode(codeHash);

        // 检查后端返回的 ok 字段或 error 字段
        if (!verifyResult.ok || verifyResult.error) {
          setInvalidCode(true);
          setError(verifyResult.error || '无效的二维码，请购买正版商品');
          setLoading(false);
          return;
        }

        if (verifyResult.role === 'publisher') {
          setRole('publisher');
        } else if (verifyResult.role === 'author') {
          setRole('author');
        } else {
          setRole('reader');
        }

        try {
          const bindResult = await getBinding(codeHash);
          if (bindResult.ok) {
            if (bindResult.address) setTargetAddress(bindResult.address);
            if (bindResult.book_address) setBookAddress(bindResult.book_address);
          }
        } catch (bindError: any) {
          // 绑定信息获取失败也表明是无效二维码
          console.warn('获取绑定信息失败:', bindError);
          if (bindError.message?.includes('not found') || bindError.message?.includes('Binding not found')) {
            setInvalidCode(true);
            setError('无效的二维码，请购买正版商品');
            setLoading(false);
            return;
          }
        }

        setLoading(false);
      } catch (e: any) {
        console.error('验证失败:', e);
        const errMsg = e.message || '';

        // 任何后端返回的错误都视为无效二维码
        if (
          errMsg.includes('403') ||
          errMsg.includes('404') ||
          errMsg.includes('not found') ||
          errMsg.includes('Binding not found') ||
          errMsg.includes('invalid') ||
          errMsg.includes('不存在')
        ) {
          setInvalidCode(true);
          setError('无效的二维码，请购买正版商品');
        } else {
          setInvalidCode(true);
          setError('无效的二维码，请购买正版商品');
        }
        setLoading(false);
      }
    };

    initTerminal();
  }, [codeHash, verifyCode, getBinding]);

  const confirmAndGoToMint = () => {
    const params = new URLSearchParams();

    // ✅ keep legacy params AND add canonical "contract"
    if (bookAddress) {
      params.set('book_address', bookAddress);
      params.set('contract', bookAddress);
    }
    if (targetAddress) params.set('reader_address', targetAddress);

    navigate(`/mint/${codeHash}?${params.toString()}`);
  };

  if (invalidCode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-6 shadow-lg">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto border border-red-100">
            <span className="text-red-500 text-4xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-slate-800">无效的二维码</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            {error || '该二维码无效或已被使用。请确认您扫描的是正版商品附带的二维码。'}
          </p>
          {isMockMode && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs text-amber-700 font-medium">⚠️ DEMO 模式：使用 pub_xxx 或 auth_xxx 格式的 hash 进行测试</p>
            </div>
          )}
        </div>
        <div className="mt-10 text-xs text-slate-400 uppercase tracking-widest font-medium">
          Whale Vault Protocol <span className="mx-2">•</span> {isMockMode ? 'DEMO MODE' : 'DEV API'}
        </div>
      </div>
    );
  }

  if (loading && !role) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className={`text-sm ${isMockMode ? 'text-amber-600' : 'text-emerald-600'}`}>
          {isMockMode ? 'Mock 验证中...' : '连接后端 API...'}
        </p>
      </div>
    );
  }

  const handleAdminLogin = async () => {
    if (!targetAddress) {
      setError('请输入管理钱包地址');
      return;
    }

    localStorage.setItem('vault_pub_auth', targetAddress.toLowerCase());
    localStorage.setItem('vault_user_role', role || 'publisher');
    localStorage.setItem('vault_code_hash', codeHash);

    if (role === 'publisher' || role === 'author') {
      navigate('/publisher-admin');
    }
  };

  const getRoleStyle = () => {
    switch (role) {
      case 'publisher':
        return { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-600', label: '出版社' };
      case 'author':
        return { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600', label: '作者' };
      case 'reader':
        return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600', label: '读者' };
      default:
        return { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-600', label: '未知' };
    }
  };

  const roleStyle = getRoleStyle();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-lg space-y-8">
        {/* 模式标识 */}
        <div className={`${isMockMode ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} border rounded-xl p-3 text-center`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${isMockMode ? 'text-amber-700' : 'text-emerald-700'}`}>
            {isMockMode ? '🔧 Demo Mode - Mock Data' : '🟢 Dev API - 后端验证'}
          </p>
        </div>

        <div className="text-center space-y-4">
          <h2 className="text-indigo-600 font-bold text-xs uppercase tracking-widest">Identity Terminal</h2>
          <div className="py-6 flex flex-col items-center justify-center space-y-3">
            <div className={`px-4 py-2 rounded-full border text-sm font-bold ${roleStyle.border} ${roleStyle.text} ${roleStyle.bg}`}>
              {roleStyle.label} Detected
            </div>
            <p className="text-slate-400 text-xs font-mono break-all px-4">{codeHash}</p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-center">
            <p className="text-red-600 text-xs">{error}</p>
          </div>
        )}

        {role === 'reader' ? (
          <div className="text-center space-y-6">
            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">预设确权地址</p>
              <p className="text-xs font-mono text-slate-600 break-all">{targetAddress || '0x...'}</p>
            </div>

            {bookAddress && (
              <div className="space-y-1">
                <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">书籍合约地址</p>
                <p className="text-xs font-mono text-indigo-600 break-all">{bookAddress}</p>
              </div>
            )}

            <button
              onClick={() => setShowDecisionModal(true)}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-sm uppercase tracking-widest hover:from-emerald-600 hover:to-teal-600 transition-all shadow-md"
            >
              立即领取 NFT 勋章
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className={`p-4 rounded-xl ${role === 'publisher' ? 'bg-purple-50 border border-purple-100' : 'bg-orange-50 border border-orange-100'}`}>
              <p className={`text-sm ${role === 'publisher' ? 'text-purple-700' : 'text-orange-700'}`}>
                {role === 'publisher'
                  ? '📚 出版社管理后台：查看销量、部署新书、生成二维码、热力分析'
                  : '✍️ 作者后台：查看作品销量和读者分布'}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-500 uppercase font-semibold ml-1">绑定钱包地址</label>
              <input
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-sm font-mono text-center outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                placeholder="0x..."
                readOnly={!!targetAddress}
              />
            </div>

            <button
              onClick={handleAdminLogin}
              className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest text-white transition-all shadow-md ${
                role === 'publisher'
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600'
              }`}
            >
              进入{role === 'publisher' ? '出版社' : '作者'}后台
            </button>
          </div>
        )}
      </div>

      {/* 读者博弈抉择弹窗 */}
      {showDecisionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-6">
          <div className="max-w-sm w-full bg-white border border-slate-200 rounded-3xl p-8 space-y-6 text-center shadow-2xl">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto border border-amber-200">
              <span className="text-amber-500 text-2xl">⚠️</span>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-bold text-slate-800">确权博弈提醒</h3>
              <p className="text-sm text-slate-500 leading-relaxed px-2">
                领取 NFT 会使该激活码失效。<br />
                <span className="text-amber-600 font-medium">若您有推荐人，请确保其已在系统中登记您的激活码，否则他将无法获得推广奖励。</span>
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => setShowDecisionModal(false)}
                className="w-full py-4 rounded-xl bg-indigo-500 text-white font-bold text-xs uppercase tracking-widest hover:bg-indigo-600 transition-all"
              >
                等推荐人先登记 (暂不领取)
              </button>
              <button
                onClick={confirmAndGoToMint}
                className="w-full py-4 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                无推荐人 / 已登记，直接领取
              </button>
            </div>

            <button
              onClick={() => setShowDecisionModal(false)}
              className="text-xs text-slate-400 uppercase tracking-widest font-medium hover:text-slate-600 transition-colors"
            >
              取消并退出
            </button>
          </div>
        </div>
      )}

      <div className="mt-12 text-xs text-slate-400 uppercase tracking-widest font-medium text-center">
        Whale Vault Protocol <span className="mx-2">•</span> {isMockMode ? 'DEMO MODE' : 'DEV API'}
      </div>
    </div>
  );
};

export default VerifyPage;
