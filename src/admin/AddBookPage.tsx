import React from "react";
import { useOutletContext } from "react-router-dom";
import type { PublisherOutletContext } from "./PublisherAdminLayout";

export default function AddBookPage() {
  const {
    envMode, apiBaseUrl, error, opLoading,
    bookName, setBookName,
    author, setAuthor,
    symbol, setSymbol,
    contractAddr,
    handleDeployContract,
  } = useOutletContext<PublisherOutletContext>();

  const buttonText = opLoading ? "支付中 / 部署中..." : "支付 10 USDT 并部署合约";

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-8">
        <h2 className="text-lg font-bold text-slate-800 mb-6">📚 部署新书 NFT 合约</h2>

        <div
          className={`mb-4 p-3 ${
            envMode === "mock"
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200"
          } border rounded-xl`}
        >
          <p className={`text-xs ${envMode === "mock" ? "text-amber-700" : "text-emerald-700"}`}>
            {envMode === "mock"
              ? "🔧 Demo 模式：合约部署仅为模拟（不会真实扣款）"
              : `🟢 Dev API：${apiBaseUrl}（部署前会从出版社余额扣除 10 USDT 作为垃圾数据防护）`}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-600 text-xs">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">书籍名称 *</label>
            <input
              placeholder="例：区块链技术原理"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">作者名称</label>
            <input
              placeholder="例：张三"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">书籍代码 (Symbol) *</label>
            <input
              placeholder="例：BLOCKCHAIN"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all uppercase"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
          </div>

          <button
            onClick={handleDeployContract}
            disabled={opLoading || !bookName || !symbol}
            className="w-full mt-4 py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 transition-all shadow-md"
          >
            {buttonText}
          </button>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            说明：为了防止链上产生大量垃圾书籍合约，REAL 模式下部署前会要求支付 <b>10 USDT</b>。
          </p>

          {contractAddr && (
            <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <p className="text-emerald-700 text-xs mb-2 font-medium">✓ 合约部署成功</p>
              <p className="text-xs font-mono text-slate-500 break-all">{contractAddr}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
