import React, { useState, useEffect } from 'react'
import { useChainConfig } from '../state/useChainConfig'

export default function Settings() {
  const { config, save } = useChainConfig()
  const [endpoint, setEndpoint] = useState(config.endpoint)
  const [contractAddress, setContractAddress] = useState(config.contractAddress)
  const [abiUrl, setAbiUrl] = useState(config.abiUrl)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setEndpoint(config.endpoint)
    setContractAddress(config.contractAddress)
    setAbiUrl(config.abiUrl)
  }, [config])

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-xl font-semibold mb-4">设置</h1>
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
        <div>
          <label className="block text-sm text-white/70 mb-1">节点 Endpoint</label>
          <input
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary/60"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="wss://ws.azero.dev 或 wss://rpc.astar.network"
          />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1">合约地址</label>
          <input
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary/60"
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
            placeholder="填入 Ink! 合约地址"
          />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1">ABI URL</label>
          <input
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-primary/60"
            value={abiUrl}
            onChange={(e) => setAbiUrl(e.target.value)}
            placeholder="可访问的 ABI JSON 链接"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            className="rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary px-4 py-2 transition shadow-glow"
            onClick={() => {
              save({ endpoint, contractAddress, abiUrl })
              setSaved(true)
              setTimeout(() => setSaved(false), 1500)
            }}
          >
            保存配置
          </button>
          {saved && <span className="text-sm text-emerald-400">已保存</span>}
        </div>
      </div>
    </div>
  )
}
