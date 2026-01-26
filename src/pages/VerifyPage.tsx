// pages/VerifyPage.tsx
import React, { useState } from 'react';
import { useAccount } from 'wagmi';

interface VerifyPageProps {
  onVerify: (address: string, codeHash: string) => Promise<string | null>;
  onRedeem: (codeHash: string) => Promise<any>;
  userRole: string;
  isVerified: boolean;
}

const VerifyPage: React.FC<VerifyPageProps> = ({ onVerify, onRedeem, userRole, isVerified }) => {
  const { address } = useAccount();
  const [codeHash, setCodeHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const handleVerify = async () => {
    if (!address || !codeHash.trim()) {
      setError('请输入钱包地址和激活码');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const role = await onVerify(address, codeHash);
      
      if (role) {
        // 验证成功
        console.log(`验证成功，用户角色: ${role}`);
      } else {
        setError('验证失败，请检查激活码');
      }
    } catch (err) {
      setError('验证过程中出现错误');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleRedeem = async () => {
    if (!address || !codeHash.trim()) return;
    
    setLoading(true);
    setError('');
    
    try {
      const result = await onRedeem(codeHash);
      
      if (result) {
        if (result.role === 'publisher') {
          // 自动跳转到后台页面
          setTimeout(() => {
            window.location.href = '/admin/dashboard';
          }, 1000);
        } else if (result.role === 'reader') {
          // 自动跳转到Mint页面
          setTimeout(() => {
            window.location.href = '/mint';
          }, 1000);
        }
      } else {
        setError('兑换失败');
      }
    } catch (err) {
      setError('兑换过程中出现错误');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 p-8 bg-gray-800 rounded-xl shadow-2xl">
      <h1 className="text-3xl font-bold text-center mb-6">🔐 验证身份</h1>
      
      <div className="mb-6">
        <label className="block text-gray-300 mb-2">钱包地址</label>
        <div className="p-3 bg-gray-900 rounded text-gray-400 break-all">
          {address || '未连接钱包'}
        </div>
      </div>
      
      <div className="mb-6">
        <label className="block text-gray-300 mb-2">激活码</label>
        <input
          type="text"
          value={codeHash}
          onChange={(e) => setCodeHash(e.target.value)}
          placeholder="输入您的激活码"
          className="w-full p-3 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
        />
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300">
          {error}
        </div>
      )}
      
      {isVerified && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-700 rounded">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
            <span className="font-semibold">验证成功！</span>
          </div>
          <p className="mt-2 text-green-300">
            您的身份: <span className="font-bold capitalize">{userRole}</span>
          </p>
        </div>
      )}
      
      <div className="flex space-x-4">
        <button
          onClick={handleVerify}
          disabled={loading || !address}
          className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded font-semibold transition"
        >
          {loading ? '验证中...' : '验证身份'}
        </button>
        
        <button
          onClick={handleRedeem}
          disabled={loading || !address || !codeHash}
          className="flex-1 py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 rounded font-semibold transition"
        >
          {loading ? '兑换中...' : '兑换激活码'}
        </button>
      </div>
      
      <div className="mt-8 pt-6 border-t border-gray-700">
        <h3 className="text-lg font-semibold mb-3">💡 使用说明</h3>
        <ul className="text-gray-400 space-y-2 text-sm">
          <li>• 出版社：使用 "pub_" 开头的激活码，永久有效</li>
          <li>• 作者：无需激活码，连接钱包自动识别</li>
          <li>• 读者：使用普通激活码，一次性使用</li>
          <li>• 出版社兑换后自动跳转到管理后台</li>
          <li>• 读者兑换后自动跳转到Mint页面</li>
        </ul>
      </div>
    </div>
  );
};

export default VerifyPage;
