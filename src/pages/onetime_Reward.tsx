import React, { useState } from 'react';

const Reward: React.FC = () => {
  // 存储 5 个输入框的值
  const [codes, setCodes] = useState<string[]>(['', '', '', '', '']);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<{ txHash?: string; error?: string } | null>(null);

  const handleInputChange = (index: number, value: string) => {
    const newCodes = [...codes];
    newCodes[index] = value.trim();
    setCodes(newCodes);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    // 校验：必须全部填写
    if (codes.some(c => !c) || !walletAddress) {
      setResult({ error: '请填写所有书码和您的钱包地址' });
      setLoading(false);
      return;
    }

    try {
      // 调用你的 Go 后端接口 
      const response = await fetch('/relay/reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dest: walletAddress,
          codes: codes
        })
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        setResult({ txHash: data.txHash });
        // 成功后清空码，防止误操作
        setCodes(['', '', '', '', '']);
      } else {
        setResult({ error: data.error || '兑换失败，请检查码是否有效' });
      }
    } catch (err) {
      setResult({ error: '网络连接失败，请检查后端是否启动' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>🐳 鲸鱼金库：5 码换返利</h2>
      <p>请输入 5 本不同书籍的 Hash Code 以领取 0.001 MON 奖励</p>
      
      <form onSubmit={handleSubmit}>
        {codes.map((code, index) => (
          <div key={index} style={{ marginBottom: '10px' }}>
            <input
              type="text"
              placeholder={`请输入第 ${index + 1} 个书码`}
              value={code}
              onChange={(e) => handleInputChange(index, e.target.value)}
              style={{ width: '100%', padding: '8px' }}
            />
          </div>
        ))}
        
        <div style={{ marginTop: '20px' }}>
          <label>收款钱包地址 (Monad Testnet):</label>
          <input
            type="text"
            placeholder="0x..."
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
          />
        </div>

        <button 
          type="submit" 
          disabled={loading}
          style={{ marginTop: '20px', width: '100%', padding: '12px', cursor: 'pointer' }}
        >
          {loading ? '正在请求 Monad 网络...' : '立即领取奖励'}
        </button>
      </form>

      {result?.error && (
        <div style={{ color: 'red', marginTop: '20px', padding: '10px', border: '1px solid red' }}>
          ❌ {result.error}
        </div>
      )}

      {result?.txHash && (
        <div style={{ color: 'green', marginTop: '20px', padding: '10px', border: '1px solid green' }}>
          ✅ 奖励已发出！<br />
          交易哈希: <a href={`https://testnet.monadexplorer.com/tx/${result.txHash}`} target="_blank" rel="noreferrer">
            {result.txHash}
          </a>
        </div>
      )}
    </div>
  );
};

export default Reward;
