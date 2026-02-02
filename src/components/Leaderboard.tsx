import React, { useEffect, useState } from 'react';
import { useAppMode } from '../contexts/AppModeContext';
import { useApi } from '../hooks/useApi';

interface LeaderboardItem {
  address: string;
  count: number;
}

const Leaderboard: React.FC = () => {
  const { isMockMode } = useAppMode();
  const { getLeaderboard } = useApi();
  const [list, setList] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      const result = await getLeaderboard();
      
      if (result.ok && result.all_stats) {
        const formattedList = Object.entries(result.all_stats)
          .map(([addr, count]) => ({
            address: addr,
            count: parseInt(count as string, 10),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        
        setList(formattedList);
        setError(null);
      }
    } catch (e: any) {
      console.error("排行榜数据抓取失败", e);
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    
    // 非 Mock 模式下每 30 秒自动刷新
    if (!isMockMode) {
      const timer = setInterval(fetchLeaderboard, 30000);
      return () => clearInterval(timer);
    }
  }, [isMockMode]);

  if (loading) return <div className="text-center text-slate-500 py-4 text-xs">同步金库排行中...</div>;

  return (
    <div className="mt-8 w-full bg-[#1e293b]/30 rounded-2xl border border-white/5 overflow-hidden">
      <div className="p-4 border-b border-white/5 bg-white/5 flex justify-between items-center">
        <h3 className="text-sm font-bold text-blue-400">🏆 社区贡献排行榜</h3>
        <span className={`text-[10px] ${isMockMode ? 'text-cyan-400' : 'text-green-400'}`}>
          {isMockMode ? 'Mock' : 'Live'}
        </span>
      </div>
      {error && (
        <div className="p-3 bg-red-500/10 text-red-400 text-xs">{error}</div>
      )}
      <div className="divide-y divide-white/5">
        {list.map((item, index) => (
          <div key={item.address} className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              <span className={`text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full ${
                index === 0 ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-slate-400'
              }`}>
                {index + 1}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {item.address.slice(0, 6)}...{item.address.slice(-4)}
              </span>
            </div>
            <div className="text-xs font-bold text-blue-400">{item.count} 次领取</div>
          </div>
        ))}
        {list.length === 0 && !error && <div className="p-4 text-center text-xs text-slate-600">暂无推荐记录</div>}
      </div>
    </div>
  );
};

export default Leaderboard;
