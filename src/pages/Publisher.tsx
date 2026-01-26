import React, { useState } from 'react';

const Publisher: React.FC = () => {
  const [count, setCount] = useState<number>(100);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateBatch = async () => {
    if (count <= 0 || count > 500) {
      setError("单次生成数量请保持在 1-500 之间");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 这里的接口地址对应你在 main.go 中注册的路由
      const apiUrl = `http://192.168.47.130:8080/admin/generate?count=${count}`;
      
      const response = await fetch(apiUrl, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.statusText}`);
      }

      // 处理二进制文件流下载
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `WhaleVault_Codes_${count}_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      
      // 清理资源
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err: any) {
      setError(err.message || "生成失败，请检查后端服务是否启动");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#1e293b] p-8 rounded-3xl border border-white/10 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            出版社后台系统
          </h1>
          <p className="text-slate-400 text-sm mt-2">批量生成正版书码二维码 ZIP 包</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-500 mb-3 ml-1">
              拟出版新书数量
            </label>
            <input 
              type="number" 
              value={count}
              onChange={(e) => setCount(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full bg-[#0f172a] border border-white/10 rounded-2xl px-6 py-4 text-3xl font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm">
              ⚠️ {error}
            </div>
          )}

          <button 
            onClick={handleGenerateBatch}
            disabled={loading}
            className={`w-full py-4 rounded-2xl font-bold text-lg transition-all active:scale-95 shadow-xl ${
              loading 
                ? 'bg-slate-700 cursor-not-allowed' 
                : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 shadow-blue-500/20'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                正在打包生成...
              </span>
            ) : (
              '一键生成并下载 ZIP'
            )}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-white/5 space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            自动同步至 Redis vault:codes:valid 池
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            二维码包含 /valut_mint_nft 验证跳转
          </div>
        </div>
      </div>
      
      <p className="mt-6 text-slate-600 text-[10px] uppercase tracking-tighter">
        Whale Vault Protocol v1.0 • Publisher MVP Mode
      </p>
    </div>
  );
};

export default Publisher;
