// components/SalesBoard.tsx
import React, { useEffect, useState } from "react";

type MintLog = {
  book_id?: string | number;
  timestamp?: number;
  tx_hash?: string;
};

export default function SalesBoard() {
  const [logs, setLogs] = useState<MintLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      // ✅ 同域部署：不要 BACKEND_URL，不要写死 IP/端口
      const res = await fetch(`/metrics/mint`, { method: "GET" });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(text?.slice(0, 120) || `加载失败（HTTP ${res.status}）`);
        return;
      }

      const data = await res.json().catch(() => null);
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold mb-2">实时销量看板</h2>
        <button
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10 transition"
          onClick={load}
          disabled={loading}
        >
          刷新
        </button>
      </div>

      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      <div className="space-y-2">
        {loading && <div className="text-white/70 text-sm">加载中...</div>}
        {!loading && logs.length === 0 && <div className="text-white/50 text-sm">暂无数据</div>}

        {logs.map((item, idx) => {
          const t = item.timestamp ? new Date(item.timestamp * 1000).toLocaleString() : "";
          const book =
            typeof item.book_id === "number" ? item.book_id : parseInt(String(item.book_id || "0"), 10);

          return (
            <div
              key={idx}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between"
            >
              <div>
                <div className="text-xs text-white/70">Book</div>
                <div className="text-sm font-mono">{isNaN(book) ? "-" : book}</div>
              </div>
              <div className="max-w-[50%]">
                <div className="text-xs text-white/70">Tx</div>
                <div className="text-sm font-mono truncate">{item.tx_hash || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-white/70">Time</div>
                <div className="text-sm">{t || "-"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
