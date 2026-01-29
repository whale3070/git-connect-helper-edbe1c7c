import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const BACKEND_URL = "http://198.55.109.102:8080";

interface VerifyPageProps {
  onVerify: (address: string, codeHash: string) => Promise<'publisher' | 'author' | 'reader' | null>;
}

const VerifyPage: React.FC<VerifyPageProps> = ({ onVerify }) => {
  const navigate = useNavigate();
  const { hash } = useParams<{ hash: string }>(); 

  const [codeHash] = useState(hash || '');
  const [targetAddress, setTargetAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [role, setRole] = useState<'publisher' | 'author' | 'reader' | null>(null);
  const [showDecisionModal, setShowDecisionModal] = useState(false);

  // 新增：无效二维码状态
  const [invalidCode, setInvalidCode] = useState(false);

  useEffect(() => {
    const initTerminal = async () => {
      if (!codeHash) return;
      try {
        // 1. 先检查绑定是否存在
        const bindResp = await fetch(`${BACKEND_URL}/secret/get-binding?codeHash=${codeHash}`);
        
        if (!bindResp.ok) {
          const errorData = await bindResp.json().catch(() => ({}));
          // 检测 "Binding not found" 或 404 状态
          if (errorData.error?.includes('not found') || bindResp.status === 404) {
            setInvalidCode(true);
            setLoading(false);
            return;
          }
        }
        
        const bindData = await bindResp.json();
        if (!bindData.address) {
          setInvalidCode(true);
          setLoading(false);
          return;
        }
        setTargetAddress(bindData.address);

        // 2. 角色预检
        const preResp = await fetch(`${BACKEND_URL}/api/v1/precheck-code?codeHash=${codeHash}`);
        const preData = await preResp.json();
        setRole(preData.role);

      } catch (err) {
        setError("连接金库失败");
      } finally {
        setLoading(false);
      }
    };
    initTerminal();
  }, [codeHash]);

  /**
   * 核心逻辑修正：执行确权跳转 [cite: 2026-01-16]
   * 必须跳转到独立的 /mint 路径，否则 React Router 会因为路径相同而拒绝操作
   */
  const confirmAndGoToMint = () => {
    console.log("理智抉择：确认无推荐人或已登记，进入铸造流程。");
    setShowDecisionModal(false);
    // 跳转到 App.tsx 中新定义的 MintConfirm 路径
    navigate(`/mint/${codeHash}`);
  };

  // 无效二维码错误页面
  if (invalidCode) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full bg-[#131722] border border-white/10 rounded-[32px] p-8 text-center space-y-6 shadow-2xl">
          
          {/* 错误图标 */}
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
            <span className="text-red-500 text-4xl">✕</span>
          </div>

          {/* 错误标题 */}
          <h1 className="text-xl font-bold text-white">无效的二维码</h1>

          {/* 错误描述 */}
          <p className="text-sm text-gray-400 leading-relaxed">
            该二维码无效或已被使用。请确认您扫描的是正版商品附带的二维码。
          </p>

          {/* 提示信息 */}
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
            <p className="text-xs text-yellow-500/80 font-medium">
              ⚠️ 请购买正版商品以获取有效的激活二维码
            </p>
          </div>

          {/* 返回按钮 */}
          <button 
            onClick={() => window.location.href = '/'}
            className="w-full py-4 rounded-xl bg-white/5 text-white font-bold text-sm uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
          >
            返回首页
          </button>
        </div>

        {/* 底部标识 */}
        <div className="mt-10 text-[9px] text-gray-600 uppercase tracking-[0.4em] font-medium">
          Whale Vault Protocol <span className="mx-2">•</span> Physical Asset Provenance
        </div>
      </div>
    );
  }

  if (loading && !role) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center font-mono text-blue-500 text-[10px] tracking-widest uppercase animate-pulse">
        Establishing Vault Connection...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#131722] p-8 rounded-[32px] border border-white/5 shadow-2xl space-y-8 relative overflow-hidden">
        
        {/* 装饰性光效 */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-30" />

        <div className="text-center space-y-4">
          <h2 className="text-[#2962ff] font-bold text-[10px] uppercase tracking-[0.5em]">Identity Terminal</h2>
          <div className="py-6 flex flex-col items-center justify-center space-y-3">
             <div className={`px-4 py-1 rounded-full border text-[10px] font-bold tracking-widest uppercase transition-all ${
               role === 'reader' ? 'border-green-500/50 text-green-500 bg-green-500/5' : 'border-blue-500/50 text-blue-500 bg-blue-500/5'
             }`}>
               {role || 'Unknown'} Detected
             </div>
             <p className="text-gray-500 text-[9px] font-mono opacity-40 break-all px-4">{codeHash}</p>
          </div>
        </div>

        {role === 'reader' ? (
          <div className="text-center space-y-6">
            <div className="space-y-1 text-center">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">预设确权地址</p>
                <p className="text-[10px] font-mono text-slate-400 break-all">{targetAddress || '0x...'}</p>
            </div>
            <button 
              onClick={() => setShowDecisionModal(true)}
              className="w-full py-5 rounded-2xl bg-green-600 font-black text-xs uppercase tracking-widest hover:bg-green-500 active:scale-95 transition-all shadow-lg shadow-green-500/10"
            >
              立即领取 NFT 勋章
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">管理节点验证</label>
              <input 
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-4 text-sm font-mono text-center outline-none focus:border-[#2962ff] transition-all"
                placeholder="请输入管理钱包地址"
              />
            </div>
            <button 
              onClick={() => onVerify(targetAddress, codeHash).then(() => navigate('/publisher-admin'))} 
              className="w-full py-4 rounded-2xl bg-[#2962ff] font-bold text-xs uppercase tracking-widest hover:bg-blue-500 transition-all"
            >
              进入管理后台
            </button>
          </div>
        )}
      </div>

      {/* 读者博弈抉择弹窗 [cite: 2026-01-16] */}
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
                {/* 选项一：为了推荐人的利益选择等待 */}
                <button 
                  onClick={() => setShowDecisionModal(false)}
                  className="w-full py-4 rounded-xl bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest hover:bg-blue-500 transition-all active:scale-95"
                >
                  等推荐人先登记 (暂不领取)
                </button>
                {/* 选项二：确认已处理或无推荐人，进入最终铸造页面 */}
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
        Whale Vault Protocol <span className="mx-2">•</span> Physical Asset Provenance
      </div>
    </div>
  );
};

export default VerifyPage;