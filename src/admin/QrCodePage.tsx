import React from "react";
import { useOutletContext } from "react-router-dom";
import type { PublisherOutletContext } from "./PublisherAdminLayout";

export default function QrCodePage() {
  const {
    envMode,
    bookSales,
    contractAddr,
    setContractAddr,

    // real search
    bookQuery,
    setBookQuery,
    bookCandidates,
    bookSearchLoading,
    selectedBook,
    setSelectedBook,
    shortenAddress,

    // batch
    count,
    setCount,
    opLoading,
    handleGenerateBatch,
  } = useOutletContext<PublisherOutletContext>();

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-8">
        <h2 className="text-lg font-bold text-slate-800 mb-6">🔗 批量生成二维码</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">
              选择已部署的书籍合约
            </label>

            {envMode === "mock" ? (
              <select
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400"
                value={contractAddr || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setContractAddr(v || null);
                  setSelectedBook(null);
                }}
              >
                <option value="">-- 选择合约 --</option>
                {bookSales.map((book) => (
                  <option key={book.address} value={book.address}>
                    {book.symbol} - {book.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-3">
                <input
                  value={bookQuery}
                  onChange={(e) => setBookQuery(e.target.value)}
                  placeholder="输入书名 / 作者 / 代码 / serial（至少2个字符）"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400"
                />

                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-4 py-2 text-xs text-slate-500 flex items-center justify-between">
                    <span>候选列表（最多 20 条）</span>
                    <span>
                      {bookSearchLoading
                        ? "搜索中..."
                        : bookQuery.trim().length < 2
                        ? "输入 2 个字符开始搜索"
                        : `${bookCandidates.length} 条`}
                    </span>
                  </div>

                  {bookCandidates.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-400">
                      {bookQuery.trim().length < 2 ? "请输入关键词开始搜索" : "没有匹配结果"}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-auto">
                      {bookCandidates.map((b, idx) => {
                        const addr = (b.bookAddr || b.address || "").toString();
                        const title = b.name || "未命名";
                        const au = b.author || "未知作者";
                        const sym = (b.symbol || "").toString();
                        const ser = (b.serial || "").toString();

                        return (
                          <button
                            key={addr || idx}
                            type="button"
                            className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 border-t border-slate-100"
                            onClick={() => {
                              setContractAddr(addr);
                              setSelectedBook(b);
                            }}
                          >
                            <div className="font-semibold text-slate-800">
                              《{title}》 - {au}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {sym} / {ser}{" "}
                              <span className="ml-2">{shortenAddress(addr)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedBook && contractAddr ? (
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                    已选择：《{selectedBook.name || "未命名"}》 (
                    {(selectedBook.symbol || "").toString()} /{" "}
                    {(selectedBook.serial || "").toString()})
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase font-semibold">
              生成数量
            </label>
            <input
              type="number"
              placeholder="100"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400"
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 100)}
            />
          </div>

          <button
            onClick={handleGenerateBatch}
            disabled={opLoading || !contractAddr}
            className="w-full mt-4 py-4 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 transition-all shadow-md"
          >
            {opLoading ? "生成中..." : `生成 ${count} 个二维码`}
          </button>
        </div>
      </div>
    </div>
  );
}
