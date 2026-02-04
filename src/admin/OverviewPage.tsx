import React from "react";
import { useOutletContext } from "react-router-dom";
import type { PublisherOutletContext } from "./PublisherAdminLayout";

export default function OverviewPage() {
  const { totalSales, bookSales, regionRanks, envMode } = useOutletContext<PublisherOutletContext>();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-soft border border-slate-100">
          <p className="text-indigo-600 text-xs uppercase font-semibold mb-1">总销量</p>
          <p className="text-4xl font-black text-slate-800">{totalSales.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-soft border border-slate-100">
          <p className="text-teal-600 text-xs uppercase font-semibold mb-1">上架图书数</p>
          <p className="text-4xl font-black text-slate-800">{bookSales.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-soft border border-slate-100">
          <p className="text-purple-600 text-xs uppercase font-semibold mb-1">覆盖地区</p>
          <p className="text-4xl font-black text-slate-800">{regionRanks.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-sm font-bold text-slate-800">📖 图书销量排行</h2>
          <span className={`text-xs ${envMode === "mock" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"} px-2 py-1 rounded-full font-medium`}>
            {envMode === "mock" ? "Demo Data" : "Live Data"}
          </span>
        </div>

        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">排名</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">代码</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">书名</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">作者</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">销量</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bookSales.map((book, idx) => (
              <tr key={book.address} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-4">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    idx === 0 ? "bg-amber-100 text-amber-700" :
                    idx === 1 ? "bg-slate-200 text-slate-600" :
                    idx === 2 ? "bg-orange-100 text-orange-700" :
                    "bg-slate-100 text-slate-500"
                  }`}>
                    {idx + 1}
                  </span>
                </td>
                <td className="px-4 py-4 font-mono text-indigo-600 text-sm font-medium">{book.symbol}</td>
                <td className="px-4 py-4 text-slate-800 font-medium">{book.name}</td>
                <td className="px-4 py-4 text-slate-500">{book.author}</td>
                <td className="px-4 py-4 text-right font-mono text-lg text-emerald-600 font-bold">{book.sales.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
