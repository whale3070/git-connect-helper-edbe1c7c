// pages/AdminDashboard.tsx
import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';

const AdminDashboard: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [mintStats, setMintStats] = useState<any[]>([]);

  // 获取出版社统计数据
  const fetchStats = async () => {
    try {
      const [salesResponse, distributionResponse] = await Promise.all([
        fetch(`http://localhost:8080/api/v1/stats/sales?address=${address}`),
        fetch(`http://localhost:8080/api/v1/analytics/distribution?address=${address}`)
      ]);
      
      const salesData = await salesResponse.json();
      const distributionData = await distributionResponse.json();
      
      setStats({
        sales: salesData,
        distribution: distributionData
      });
      
      // 模拟Mint统计
      const mockMintStats = [
        { date: '2024-01-15', count: 42 },
        { date: '2024-01-16', count: 56 },
        { date: '2024-01-17', count: 78 },
        { date: '2024-01-18', count: 91 },
      ];
      setMintStats(mockMintStats);
    } catch (error) {
      console.error('获取数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected && address) {
      fetchStats();
    }
  }, [isConnected, address]);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 text-cyan-500">🐋 出版社管理后台</h1>
          <p className="text-gray-400">请连接钱包后访问出版社后台</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 max-w-md w-full">
          <p className="text-center text-gray-400">未检测到钱包连接</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <div className="text-cyan-500">加载数据中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a]">
      {/* 头部 */}
      <div className="bg-gradient-to-r from-cyan-900/20 to-blue-900/20 border-b border-cyan-500/20">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-cyan-500 mb-2">🐋 出版社管理后台</h1>
              <p className="text-gray-400">出版社地址: {address}</p>
            </div>
            <div className="mt-4 md:mt-0">
              <div className="inline-flex items-center px-4 py-2 bg-cyan-900/30 border border-cyan-500/30 rounded-lg">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm">出版社特权已激活</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 数据统计 */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 hover:border-cyan-500/30 transition">
            <h3 className="text-xl font-semibold mb-2 text-gray-300">总发行量</h3>
            <p className="text-3xl font-bold text-cyan-400">
              {stats.sales?.reduce((sum: number, item: any) => sum + item.sales, 0) || 1250}
            </p>
          </div>
          
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 hover:border-cyan-500/30 transition">
            <h3 className="text-xl font-semibold mb-2 text-gray-300">今日新增</h3>
            <p className="text-3xl font-bold text-green-400">
              {stats.sales?.[stats.sales.length - 1]?.sales || 89}
            </p>
          </div>
          
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 hover:border-cyan-500/30 transition">
            <h3 className="text-xl font-semibold mb-2 text-gray-300">激活码库存</h3>
            <p className="text-3xl font-bold text-yellow-400">∞</p>
            <p className="text-sm text-gray-400 mt-2">出版社激活码永久有效</p>
          </div>
        </div>

        {/* 销售趋势 */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
          <h2 className="text-2xl font-bold mb-6 text-cyan-500 flex items-center">
            <span className="mr-2">📈</span> 发行趋势
          </h2>
          <div className="h-64">
            <div className="flex items-end h-48 space-x-2">
              {mintStats.map((item, index) => (
                <div key={index} className="flex flex-col items-center flex-1">
                  <div 
                    className="w-full bg-gradient-to-t from-cyan-500 to-cyan-300 rounded-t transition-all hover:opacity-80"
                    style={{ height: `${Math.min(item.count * 2, 100)}%` }}
                    title={`${item.date}: ${item.count} 次`}
                  ></div>
                  <div className="text-xs text-gray-400 mt-2">{item.date.split('-').slice(1).join('-')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 激活码管理 */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-2xl font-bold mb-6 text-cyan-500 flex items-center">
            <span className="mr-2">🔑</span> 激活码管理
          </h2>
          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-300">出版社专用激活码</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-green-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <code className="text-green-400 font-mono text-lg">pub_001</code>
                  <span className="px-3 py-1 bg-green-900/50 text-green-300 rounded-full text-sm">
                    永久有效
                  </span>
                </div>
                <div className="mt-2 text-sm text-gray-400">
                  已使用: 156次 | 剩余: ∞
                </div>
              </div>
              
              <div className="bg-gray-900 border border-green-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <code className="text-green-400 font-mono text-lg">pub_002</code>
                  <span className="px-3 py-1 bg-green-900/50 text-green-300 rounded-full text-sm">
                    永久有效
                  </span>
                </div>
                <div className="mt-2 text-sm text-gray-400">
                  已使用: 89次 | 剩余: ∞
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-cyan-900/10 to-blue-900/10 border border-cyan-500/20 rounded-lg p-4">
            <h4 className="font-semibold mb-2 text-cyan-400">📝 使用说明</h4>
            <ul className="text-gray-400 text-sm space-y-1">
              <li>• 出版社激活码以 "pub_" 开头，可以无限次使用，不会被消耗</li>
              <li>• 读者激活码一次性使用，Mint后自动失效</li>
              <li>• 后台数据每5分钟自动更新一次</li>
              <li>• 如遇问题，请联系技术支持</li>
            </ul>
          </div>
        </div>

        {/* 底部信息 */}
        <div className="mt-8 pt-6 border-t border-gray-700 text-center text-gray-500 text-sm">
          <p>© 2024 Whale Vault - 出版社特权系统</p>
          <p className="mt-1">当前时间: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
          <p className="mt-1 text-xs">系统版本: 1.2.0 | 区块链网络: Ethereum Sepolia</p>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
