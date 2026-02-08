// TopUpPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ethers } from "ethers";
import { useAppMode } from "../contexts/AppModeContext";
import type { PublisherOutletContext } from "./PublisherAdminLayout";

// ✅ 方案A：统一从 chain.ts 取链配置（不再依赖 localStorage）
import { RPC_URL, USDT_ADDRESS } from "../config/chain";

type Asset = "FIAT" | "USDT" | "BTC" | "ETH" | "XMR";

type Network =
  | "bank_transfer"
  | "card"
  | "alipay_wechat"
  | "ethereum"
  | "tron"
  | "bitcoin"
  | "monero";

const ASSET_LABEL: Record<Asset, string> = {
  FIAT: "法币（Fiat）",
  USDT: "USDT",
  BTC: "BTC",
  ETH: "ETH",
  XMR: "XMR",
};

const NETWORK_LABEL: Record<Network, string> = {
  bank_transfer: "银行转账",
  card: "信用卡/借记卡",
  alipay_wechat: "支付宝/微信（演示）",
  ethereum: "EVM（Ethereum/Conflux eSpace）",
  tron: "TRON",
  bitcoin: "Bitcoin",
  monero: "Monero",
};

// 纯演示用：给每个资产一个“充值地址”占位符
const DEMO_DEPOSIT_ADDRESS: Record<Asset, string> = {
  FIAT: "由客服/合同提供的收款账户（演示）",
  USDT: "0xDEMO_TREASURY_USDT_0000000000000000000000000000",
  BTC: "bc1qdemoaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  ETH: "0xDEMO_TREASURY_ETH_000000000000000000000000000000",
  XMR: "84demoXMRaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
};

// 纯演示用：报价（你后续可以替换为后端/预言机）
function getDemoRate(asset: Asset): number {
  switch (asset) {
    case "FIAT":
      return 1;
    case "USDT":
      return 1;
    case "BTC":
      return 65000;
    case "ETH":
      return 3500;
    case "XMR":
      return 160;
    default:
      return 1;
  }
}

/**
 * ✅ 后端 USDT 充值接口
 * POST /api/admin/usdt/recharge
 * body: { to: "0x...", amount: 1000 }
 * resp: { ok: true, txHash: "0x..." } 或 { ok: false, error: "..." }
 */
type RechargeResp = { ok: boolean; txHash?: string; error?: string };

// 如果你后端设置了 ADMIN_API_KEY，这里填同样的值；否则留空
const ADMIN_API_KEY = "";

/** ========= helpers ========= **/

function isHexAddress(addr: string) {
  const a = (addr || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

function isHexTxHash(v: string) {
  const s = (v || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(s);
}

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchReceiptWithRetry(rpcUrl: string, txHash: string) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // 简单重试：有些 RPC/链同步会让 receipt 过几秒才可读
  const backoff = [250, 500, 900, 1500, 2200, 3200];
  let lastErr: any = null;

  for (const ms of backoff) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) return receipt;
    } catch (e: any) {
      lastErr = e;
    }
    await sleep(ms);
  }

  // 最后再试一次
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) return receipt;
  } catch (e: any) {
    lastErr = e;
  }

  if (lastErr) throw lastErr;
  return null;
}

/**
 * ✅ 更稳的 tokenAddr 推断：
 * 1) 优先找 Transfer(to == publisherAddr) 的 log.address
 * 2) 找不到再退回第一个 Transfer 的 log.address
 */
async function inferTokenAddressFromReceipt(rpcUrl: string, txHash: string, publisherAddr?: string) {
  if (!isHexTxHash(txHash)) return null;

  const receipt = await fetchReceiptWithRetry(rpcUrl, txHash);
  if (!receipt) return null;

  const pub = (publisherAddr || "").trim().toLowerCase();
  const wantToMatchPub = isHexAddress(pub);

  // topics[1]=from, topics[2]=to（都是 32 bytes 左填充地址）
  const topicToAddr = (topic: string) => {
    const t = (topic || "").toLowerCase();
    if (!t.startsWith("0x") || t.length !== 66) return "";
    return ("0x" + t.slice(26)) as string; // 最后 40 hex
  };

  let firstTransferToken: string | null = null;

  for (const log of receipt.logs || []) {
    const t0 = (log.topics?.[0] || "").toLowerCase();
    if (t0 !== ERC20_TRANSFER_TOPIC) continue;

    const tokenAddr = (log.address || "").toLowerCase();
    if (!isHexAddress(tokenAddr)) continue;

    if (!firstTransferToken) firstTransferToken = tokenAddr;

    if (wantToMatchPub && (log.topics?.length || 0) >= 3) {
      const toAddr = topicToAddr(log.topics[2]);
      if (toAddr && toAddr.toLowerCase() === pub) {
        return tokenAddr;
      }
    }
  }

  return firstTransferToken;
}

async function readErc20MetaAndBalance(rpcUrl: string, tokenAddr: string, owner: string) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const c = new ethers.Contract(tokenAddr, ERC20_ABI, provider);

  const [raw, decimals, symbol] = await Promise.all([
    c.balanceOf(owner),
    c.decimals(),
    c.symbol().catch(() => "TOKEN"),
  ]);

  const dec = Number(decimals);
  const bal = ethers.formatUnits(raw, dec);
  return { symbol: String(symbol || "TOKEN"), decimals: dec, balance: bal };
}

/** ========= page ========= **/

export default function TopUpPage() {
  const { apiBaseUrl } = useAppMode();

  // ✅ 优先使用同域（适配 nginx 80 -> 8080 反代）；只有在明确配置 apiBaseUrl 时才覆盖
  const base = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const cfg = (apiBaseUrl || "").trim();
    return (cfg ? cfg : origin).replace(/\/$/, "");
  }, [apiBaseUrl]);

  // ✅ 从 PublisherAdminLayout 的 Outlet context 拿到 “充值后刷新”
  //    做成可选：避免 context 没提供时页面直接崩
  const outlet = useOutletContext<PublisherOutletContext | any>();
  const refreshAfterTopup: (payload: { symbol: string; address: string }) => Promise<void> =
    outlet?.refreshAfterTopup || (async () => {});

  const [asset, setAsset] = useState<Asset>("FIAT");
  const [network, setNetwork] = useState<Network>("bank_transfer");
  const [amount, setAmount] = useState<string>("");

  // ✅ Publisher 地址（默认从 localStorage 读）
  const [publisherAddr, setPublisherAddr] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("vault_pub_auth") || "";
  });

  // 状态：后端充值
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [rechargeTx, setRechargeTx] = useState<string>("");
  const [rechargeErr, setRechargeErr] = useState<string>("");

  // ✅ 自动识别 tokenAddr + token 信息
  const [autoTokenAddr, setAutoTokenAddr] = useState<string>("");
  const [autoTokenSymbol, setAutoTokenSymbol] = useState<string>("");
  const [autoTokenDecimals, setAutoTokenDecimals] = useState<number | null>(null);
  const [autoTokenBalance, setAutoTokenBalance] = useState<string>("");

  const [autoDetectLoading, setAutoDetectLoading] = useState<boolean>(false);
  const [autoDetectErr, setAutoDetectErr] = useState<string>("");

  // 这里把“系统内部结算单位”设为 CFX（你可以按自己体系改）
  const usdtPerCfx = 1;

  const supportedNetworks = useMemo<Network[]>(() => {
    switch (asset) {
      case "FIAT":
        return ["bank_transfer", "card", "alipay_wechat"];
      case "USDT":
        return ["ethereum", "tron"];
      case "BTC":
        return ["bitcoin"];
      case "ETH":
        return ["ethereum"];
      case "XMR":
        return ["monero"];
      default:
        return ["bank_transfer"];
    }
  }, [asset]);

  // ✅ 当资产切换时，自动选一个可用网络（依赖写全）
  useEffect(() => {
    if (!supportedNetworks.includes(network)) {
      setNetwork(supportedNetworks[0]);
    }
  }, [supportedNetworks, network]);

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const rateInUsdt = useMemo(() => getDemoRate(asset), [asset]);

  // 充值资产折算为“USDT 价值”
  const valueInUsdt = useMemo(() => {
    if (!parsedAmount) return 0;
    if (asset === "FIAT") return parsedAmount; // 演示：法币当 USDT
    return parsedAmount * rateInUsdt;
  }, [asset, parsedAmount, rateInUsdt]);

  // 再把 USDT 价值折算为 CFX 余额
  const creditedCfx = useMemo(() => {
    if (!valueInUsdt) return 0;
    return valueInUsdt / usdtPerCfx;
  }, [valueInUsdt]);

  const depositAddress = useMemo(() => DEMO_DEPOSIT_ADDRESS[asset], [asset]);

  const canCallUSDTRecharge = useMemo(() => {
    // 你当前后端接口是“管理员代充 USDT”，所以只在选择 USDT 时启用
    return asset === "USDT" && (network === "ethereum" || network === "tron");
  }, [asset, network]);

  const resetAutoDetect = () => {
    setAutoTokenAddr("");
    setAutoTokenSymbol("");
    setAutoTokenDecimals(null);
    setAutoTokenBalance("");
    setAutoDetectErr("");
  };

  const autoDetectAndRefresh = async (txHash: string) => {
    resetAutoDetect();
    setAutoDetectLoading(true);
    setAutoDetectErr("");

    try {
      const owner = (publisherAddr || "").trim();
      if (!isHexAddress(owner)) throw new Error("Publisher 地址无效，无法自动刷新余额");

      const rpcUrl = RPC_URL;

      const tokenAddr = await inferTokenAddressFromReceipt(rpcUrl, txHash, owner);
      if (!tokenAddr) {
        throw new Error("未在交易回执中识别到 ERC20 Transfer（可能不是 ERC20 充值，或 RPC 暂时读不到 receipt）");
      }

      setAutoTokenAddr(tokenAddr);

      // 读 token 元信息 + 当前余额（给你在页面展示一眼）
      const meta = await readErc20MetaAndBalance(rpcUrl, tokenAddr, owner);
      setAutoTokenSymbol(meta.symbol);
      setAutoTokenDecimals(meta.decimals);
      setAutoTokenBalance(meta.balance);

      // ✅ 通知顶栏自动刷新
      await refreshAfterTopup({ symbol: meta.symbol, address: tokenAddr });
    } catch (e: any) {
      setAutoDetectErr(e?.message || "自动识别失败");
    } finally {
      setAutoDetectLoading(false);
    }
  };

  const handleRechargeUSDT = async () => {
    setRechargeErr("");
    setRechargeTx("");
    resetAutoDetect();

    const to = (publisherAddr || "").trim();
    if (!isHexAddress(to)) {
      setRechargeErr("Publisher 地址无效：请填写 0x + 40 位十六进制地址");
      return;
    }
    if (!parsedAmount) {
      setRechargeErr("请输入正确的充值数量（amount > 0）");
      return;
    }

    const reqBody = { to, amount: Math.floor(parsedAmount) };

    setRechargeLoading(true);
    try {
      // ✅ nginx 80 -> 8080 反代：建议用同域 /api/admin/...
      const url = `${base}/api/admin/usdt/recharge`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ADMIN_API_KEY ? { Authorization: `Bearer ${ADMIN_API_KEY}` } : {}),
        },
        body: JSON.stringify(reqBody),
      });

      const text = await res.text().catch(() => "");
      let data: RechargeResp | null = null;
      try {
        data = text ? (JSON.parse(text) as RechargeResp) : null;
      } catch {
        // ignore
      }

      if (!res.ok) {
        const msg = data?.error || text || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (!data?.ok) {
        throw new Error(data?.error || "充值失败（unknown error）");
      }

      const tx = (data.txHash || "").trim();
      setRechargeTx(tx);

      // ✅ 自动识别 tokenAddr + 自动刷新余额
      if (tx && isHexTxHash(tx)) {
        await autoDetectAndRefresh(tx);
      } else {
        // txHash 不规范：仍然通知顶栏刷新（用 chain.ts 的 USDT_ADDRESS）
        if (isHexAddress(USDT_ADDRESS)) {
          await refreshAfterTopup({ symbol: "USDT", address: USDT_ADDRESS });
        }
      }
    } catch (e: any) {
      setRechargeErr(e?.message || "充值失败");
    } finally {
      setRechargeLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>多资产充值入口（PoC）</h1>
      <p style={{ marginTop: 0, color: "#666", lineHeight: 1.5 }}>
        目的：让出版社/合作方可以用 <b>XMR / BTC / ETH / USDT / 法币</b> 充值进入系统。系统内部以 <b>CFX</b>{" "}
        作为结算单位，用于代付 gas 与链上交互。
        <br />
        <span style={{ fontSize: 12 }}>
          注：当前已接入后端 Demo：<b>管理员代充 USDT（/api/admin/usdt/recharge）</b>；其他资产仍为前端演示占位。
        </span>
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        {/* 左侧：输入区 */}
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, background: "#fff" }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>充值信息</h2>

          <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>资产类型</label>
          <select
            value={asset}
            onChange={(e) => {
              setRechargeErr("");
              setRechargeTx("");
              resetAutoDetect();
              setAsset(e.target.value as Asset);
            }}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          >
            {(["FIAT", "USDT", "BTC", "ETH", "XMR"] as Asset[]).map((a) => (
              <option key={a} value={a}>
                {ASSET_LABEL[a]}
              </option>
            ))}
          </select>

          <div style={{ height: 12 }} />

          <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>网络/通道</label>
          <select
            value={network}
            onChange={(e) => {
              setRechargeErr("");
              setRechargeTx("");
              resetAutoDetect();
              setNetwork(e.target.value as Network);
            }}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          >
            {supportedNetworks.map((n) => (
              <option key={n} value={n}>
                {NETWORK_LABEL[n]}
              </option>
            ))}
          </select>

          <div style={{ height: 12 }} />

          <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>充值数量</label>
          <input
            value={amount}
            onChange={(e) => {
              setRechargeErr("");
              setRechargeTx("");
              resetAutoDetect();
              setAmount(e.target.value);
            }}
            placeholder="例如：100"
            inputMode="decimal"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />

          <div style={{ height: 16 }} />

          <div style={{ padding: 12, borderRadius: 12, border: "1px dashed #ddd", background: "#fafafa", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>参考报价（演示）</div>
            <div>
              1 {asset === "FIAT" ? "法币单位" : ASSET_LABEL[asset]} ≈ {rateInUsdt} USDT
            </div>
            <div>本次充值价值 ≈ {valueInUsdt.toFixed(4)} USDT</div>
            <div>系统入账（结算单位）≈ {creditedCfx.toFixed(4)} CFX</div>
          </div>

          <div style={{ height: 14 }} />

          <div style={{ padding: 12, borderRadius: 12, border: "1px solid #eee", background: "#fcfcfc" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Publisher 地址（USDT 充值目标）</div>
            <input
              value={publisherAddr}
              onChange={(e) => {
                resetAutoDetect();
                setPublisherAddr(e.target.value);
              }}
              placeholder="0x..."
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />
            <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
              默认从 localStorage 读取 <code>vault_pub_auth</code>。你也可以手动改成任意地址测试。
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
              当前 RPC（方案A / chain.ts）：
              <div style={{ fontFamily: "ui-monospace, Menlo, monospace", marginTop: 4 }}>{RPC_URL}</div>
              <div style={{ marginTop: 6 }}>
                默认 USDT（方案A / chain.ts）：
                <div style={{ fontFamily: "ui-monospace, Menlo, monospace", marginTop: 4 }}>{USDT_ADDRESS}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：地址 + 操作 */}
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, background: "#fff" }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>充值地址 / 操作</h2>

          <div style={{ marginBottom: 10, color: "#666" }}>
            将 <b>{ASSET_LABEL[asset]}</b> 通过 <b>{NETWORK_LABEL[network]}</b> 转入以下地址（演示）：
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #eee",
              background: "#fcfcfc",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              wordBreak: "break-all",
            }}
          >
            {depositAddress}
          </div>

          <div style={{ height: 12 }} />

          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(depositAddress).catch(() => {})}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              marginRight: 10,
            }}
          >
            复制地址
          </button>

          <button
            type="button"
            onClick={() => {
              alert(
                "演示：已生成充值订单。\n\n后续接入：\n- 法币：支付通道回调 → 记账\n- Crypto：监听链上入账 → 自动折算 → 入账为 CFX"
              );
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            生成充值订单（演示）
          </button>

          <div style={{ height: 16 }} />

          {/* ✅ 接入后端：USDT 充值 */}
          <div style={{ padding: 12, borderRadius: 12, border: "1px solid #eee", background: "#fafafa" }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>✅ 后端联调：管理员代充 USDT（PoC）</div>

            <div style={{ height: 10 }} />

            <button
              type="button"
              disabled={!canCallUSDTRecharge || rechargeLoading}
              onClick={handleRechargeUSDT}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #2962ff",
                background: !canCallUSDTRecharge || rechargeLoading ? "#cfd8ff" : "#2962ff",
                color: "#fff",
                cursor: !canCallUSDTRecharge || rechargeLoading ? "not-allowed" : "pointer",
                width: "100%",
                fontWeight: 800,
              }}
              title={!canCallUSDTRecharge ? "请选择 USDT + (ethereum/tron)" : "调用后端充值"}
            >
              {rechargeLoading ? "充值中..." : "管理员代充 USDT（调用后端）"}
            </button>

            {rechargeTx ? (
              <div style={{ marginTop: 10, fontSize: 13, color: "#0a7a2f", lineHeight: 1.6 }}>
                ✅ 充值成功：txHash
                <div
                  style={{
                    marginTop: 6,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #d9f2df",
                    background: "#f2fff5",
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 12,
                    wordBreak: "break-all",
                  }}
                >
                  {rechargeTx}
                </div>

                {/* ✅ 自动识别结果 */}
                <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid #e7f0ff", background: "#f5f9ff" }}>
                  <div style={{ fontWeight: 800, color: "#1b4ddb" }}>
                    自动识别 tokenAddr + 自动刷新余额 {autoDetectLoading ? "（识别中...）" : ""}
                  </div>

                  {autoDetectErr ? <div style={{ marginTop: 6, color: "#b00020" }}>❌ {autoDetectErr}</div> : null}

                  {autoTokenAddr ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#333", lineHeight: 1.6 }}>
                      <div>
                        tokenAddr： <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{autoTokenAddr}</span>
                      </div>
                      <div>
                        symbol/decimals： <b>{autoTokenSymbol || "TOKEN"}</b> / <b>{autoTokenDecimals ?? "-"}</b>
                      </div>
                      <div>
                        Publisher 当前余额：{" "}
                        <b>
                          {autoTokenBalance} {autoTokenSymbol || ""}
                        </b>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {rechargeErr ? (
              <div style={{ marginTop: 10, fontSize: 13, color: "#b00020", lineHeight: 1.6 }}>
                ❌ 充值失败：{rechargeErr}
              </div>
            ) : null}
          </div>

          <div style={{ height: 16 }} />

          <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>落地路线（答辩口径）</div>
            <ol style={{ marginTop: 0, paddingLeft: 18 }}>
              <li>出版社/合作方无需持有 CFX；只需选择资产充值。</li>
              <li>系统侧监听入账（链上/支付回调），折算为内部 CFX 余额。</li>
              <li>读者扫码时使用 EIP-7702 + 代付，让 0 CFX 用户完成交互。</li>
              <li>系统消耗 CFX 支付 gas，并记录每笔成本与账单。</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
