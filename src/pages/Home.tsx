import React from 'react'

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      {/* 顶部导航栏 */}
      <header className="border-b border-white/10 bg-white/5">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg"></div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Whale Vault
              </h1>
            </div>
            <div className="text-sm text-white/50">
              一书一码 • 物理确权
            </div>
          </div>
        </div>
      </header>

      {/* 主内容区域 */}
      <main className="flex-1 flex items-center justify-center">
        <div className="mx-auto max-w-4xl w-full px-4 py-8">
          {/* 信息提示卡片 */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center">
                <span className="text-3xl">📖</span>
              </div>
              <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                欢迎使用 Whale Vault
              </h1>
              <p className="text-lg text-white/80 mb-2">
                请使用微信或系统相机扫描实体书上的二维码
              </p>
              <p className="text-white/60 text-sm">
                二维码位于书籍背面或扉页，扫码后自动进入验证流程
              </p>
            </div>
            
            {/* 分隔线 */}
            <div className="my-8 border-t border-white/10"></div>
            
            {/* 使用说明 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-black/30 p-6 rounded-lg border border-white/5">
                <div className="text-2xl mb-3">🔍</div>
                <h3 className="font-semibold mb-2 text-cyan-400">第一步：查找二维码</h3>
                <p className="text-sm text-white/60">
                  在您购买的正版书籍背面或扉页找到唯一的二维码标签
                </p>
              </div>
              
              <div className="bg-black/30 p-6 rounded-lg border border-white/5">
                <div className="text-2xl mb-3">📱</div>
                <h3 className="font-semibold mb-2 text-blue-400">第二步：扫码识别</h3>
                <p className="text-sm text-white/60">
                  使用微信或手机相机扫描二维码，自动打开验证页面
                </p>
              </div>
              
              <div className="bg-black/30 p-6 rounded-lg border border-white/5">
                <div className="text-2xl mb-3">✅</div>
                <h3 className="font-semibold mb-2 text-green-400">第三步：自动验证</h3>
                <p className="text-sm text-white/60">
                  系统自动识别您的身份，跳转到对应页面（读者/作者/出版社）
                </p>
              </div>
            </div>
            
            {/* 重要提示 */}
            <div className="bg-gradient-to-r from-cyan-900/10 to-blue-900/10 border border-cyan-500/20 rounded-lg p-6 mb-8">
              <h3 className="font-semibold mb-3 text-cyan-300 flex items-center">
                <span className="mr-2">💡</span> 重要提示
              </h3>
              <ul className="space-y-2 text-sm text-white/70">
                <li>• 每个二维码对应一本实体书，请勿重复使用</li>
                <li>• 出版社激活码为专用，普通读者请勿尝试使用</li>
                <li>• 请确保从官方渠道购买正版书籍</li>
                <li>• 如有问题，请联系客服人员</li>
              </ul>
            </div>
            
            {/* 技术支持信息 */}
            <div className="text-center">
              <p className="text-sm text-white/50">
                技术支持 | 区块链网络: Ethereum Polkadot | 系统版本: 1.0.0
              </p>
            </div>
          </div>
          
          {/* 联系信息 */}
          <div className="mt-8 text-center">
            <div className="inline-flex flex-col items-center space-y-2 text-sm text-white/40">
              <div className="flex items-center space-x-4">
                <span>🔐 基于区块链的确权技术</span>
                <span>•</span>
                <span>📚 每本书籍拥有唯一数字身份</span>
                <span>•</span>
                <span>🌐 去中心化存储保障</span>
              </div>
              <div className="text-xs">
                访问时间: {new Date().toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </main>
      
      {/* 页脚 */}
      <footer className="border-t border-white/10 bg-white/5">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="text-center text-white/30 text-xs tracking-widest uppercase">
            <p>Whale Vault • Decentralized Identity System © {new Date().getFullYear()}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
