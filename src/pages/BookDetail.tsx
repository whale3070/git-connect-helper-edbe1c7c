import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Heatmap from "./Heatmap";
import { useAppMode } from "../contexts/AppModeContext";

const BOOK_DATA_MAP: any = {
  btc: {
    symbol: "BTC-WP",
    name: "Bitcoin Whitepaper",
    author: "Satoshi Nakamoto",
    sales: 21000,
    growth: "+0.1%",
    desc: "去中心化货币开山之作。销量数据由 Arweave 预言机实时同步。",
    pool: "1.2M DOT",
  },
  eth: {
    symbol: "ETH-YP",
    name: "Ethereum Yellowpaper",
    author: "Vitalik Buterin",
    sales: 15500,
    growth: "+5.4%",
    desc: "智能合约底层协议规范。",
    pool: "0.8M DOT",
  },
  mitnick: {
    symbol: "GHOST",
    name: "The Ghost in the Wires",
    author: "Kevin Mitnick",
    sales: 3070,
    growth: "+12.5%",
    desc: "高级攻防实战记录。目前处于销量挑战活跃期。",
    pool: "0.5M DOT",
  },
};

export default function BookDetail() {
  const { address } = useParams();
  const navigate = useNavigate();
  const { isMockMode } = useAppMode(); // ✅ 方案 B：跟全局模式联动

  const [book, setBook] = useState<any>(null);
  const [timeLeft] = useState("09D 23H 59M 59S"); // 十天倒计时（demo）

  useEffect(() => {
    const addrKey = address?.toLowerCase() || "";
    const foundKey = Object.keys(BOOK_DATA_MAP).find((key) => addrKey.includes(key));
    setBook(BOOK_DATA_MAP[foundKey || "btc"]);
  }, [address]);

  if (!book) return <div style={{ color: "white", padding: "20px" }}>Syncing Terminal...</div>;

  // ✅ 这里把全局 isMockMode 映射为 Heatmap 的 envMode（mock/real）
  const envMode = isMockMode ? "mock" : "real";

  return (
    <div
      style={{
        backgroundColor: "#0b0e11",
        minHeight: "100vh",
        color: "#d1d4dc",
        fontFamily: "monospace",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 顶部导航 */}
      <div
        style={{
          borderBottom: "1px solid #1e222d",
          backgroundColor: "#131722",
          padding: "15px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => navigate("/bookshelf")}
          style={{
            color: "#2962ff",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ← BACK TO MARKET
        </button>
        <div style={{ fontSize: "12px" }}>
          TERMINAL: <span style={{ color: "#089981" }}>CONNECTED</span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 380px",
          flex: 1,
          backgroundColor: "#1e222d",
          gap: "1px",
        }}
      >
        {/* 左侧：查询区 */}
        <div style={{ backgroundColor: "#0b0e11", padding: "40px", overflowY: "auto" }}>
          <div style={{ marginBottom: "40px" }}>
            <h1 style={{ fontSize: "36px", color: "#f0f3fa", margin: "0 0 16px 0", fontWeight: 900 }}>
              {book.name}
            </h1>
            <p style={{ color: "#868d9a", fontSize: "15px", lineHeight: "1.8", maxWidth: "700px" }}>
              {book.desc}
            </p>
          </div>

          <div style={{ marginTop: "50px" }}>
            <h3 style={{ fontSize: "11px", color: "#5d606b", marginBottom: "15px", letterSpacing: "2px" }}>
              REAL-TIME DISTRIBUTION (GEOGRAPHIC ECHO)
            </h3>

            {/* ✅ 注意：Heatmap 内部 minHeight=600；这里给足高度避免溢出 */}
            <div
              style={{
                height: "600px",
                backgroundColor: "#0f172a",
                border: "1px solid #1e222d",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              <Heatmap envMode={envMode} />
            </div>
          </div>
        </div>

        {/* 右侧：控制面板 */}
        <div style={{ backgroundColor: "#131722", padding: "30px" }}>
          <div style={{ borderBottom: "1px solid #1e222d", paddingBottom: "30px", marginBottom: "30px" }}>
            <div style={{ fontSize: "11px", color: "#868d9a", marginBottom: "10px" }}>当前真实销量 (TOTAL SALES)</div>
            <div style={{ fontSize: "42px", fontWeight: 900, color: "#f0f3fa" }}>{book.sales.toLocaleString()}</div>
            <div style={{ fontSize: "14px", color: "#089981", marginTop: "8px", fontWeight: "bold" }}>
              {book.growth} 24H 增速
            </div>
          </div>

          <div
            style={{
              backgroundColor: "#0b0e11",
              padding: "20px",
              borderRadius: "4px",
              border: "1px solid #1e222d",
              marginBottom: "30px",
            }}
          >
            <div style={{ fontSize: "10px", color: "#868d9a", marginBottom: "10px" }}>10-DAY ENDGAME COUNTDOWN</div>
            <div style={{ fontSize: "20px", color: "#22d3ee", fontWeight: "bold", textAlign: "center" }}>{timeLeft}</div>
          </div>

          <button
            style={{
              width: "100%",
              backgroundColor: "#089981",
              color: "white",
              border: "none",
              padding: "20px",
              borderRadius: "4px",
              fontWeight: "bold",
              cursor: "pointer",
              fontSize: "16px",
              marginBottom: "15px",
            }}
          >
            参与销量预判 (PLACE BET)
          </button>

          <button
            style={{
              width: "100%",
              backgroundColor: "transparent",
              color: "#f23645",
              border: "1px solid #f23645",
              padding: "15px",
              borderRadius: "4px",
              fontWeight: "bold",
              cursor: "pointer",
              fontSize: "14px",
              marginBottom: "30px",
            }}
          >
            发起专家审计挑战 (CHALLENGE)
          </button>

          <div style={{ fontSize: "12px", color: "#5d606b", lineHeight: "1.6" }}>
            <p>
              • 奖金池: <span style={{ color: "#d1d4dc" }}>{book.pool}</span>
            </p>
            <p>• 挑战基于专家审计抄袭比例结果</p>
            <p>• 结果判定由金库协议自动 mint 数据执行</p>
          </div>
        </div>
      </div>
    </div>
  );
}
