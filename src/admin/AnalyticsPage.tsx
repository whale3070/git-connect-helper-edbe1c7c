import React from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { PublisherOutletContext } from "./PublisherAdminLayout";

export default function AnalyticsPage() {
  const navigate = useNavigate();
  const { regionRanks } = useOutletContext<PublisherOutletContext>();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-800 mb-4">🗺️ 地区读者分布</h2>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {regionRanks.map((region, idx) => (
            <div
              key={region.region}
              className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100"
            >
              <p className="text-[10px] text-slate-400 uppercase mb-1">#{idx + 1}</p>
              <p className="text-sm font-bold text-slate-800">{region.region}</p>
              <p className="text-lg font-black text-indigo-600">{region.count}</p>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => navigate("/Heatmap")}
        className="w-full py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl font-bold text-indigo-600 hover:from-indigo-100 hover:to-purple-100 transition-all"
      >
        查看完整热力图 →
      </button>
    </div>
  );
}
