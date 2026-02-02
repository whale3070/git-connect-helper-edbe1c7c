import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppMode } from '../contexts/AppModeContext';
import { useApi } from '../hooks/useApi';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

export default function MintConfirm() {
  const { hashCode } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isMockMode } = useAppMode();
  const { mintNFT, queryTransaction, getBinding } = useApi();
  
  const [error, setError] = useState<string | null>(null);
  const [mintStatus, setMintStatus] = useState<string>('');
  const [hasStarted, setHasStarted] = useState(false);

  const code = hashCode || params.get('code') || '';
  const bookIdRaw = params.get('book_id') ?? '1';
  const bookAddressParam = params.get('book_address') || '';
  const readerAddressParam = params.get('reader_address') || '';

  // 轮询交易状态
  const pollTransactionStatus = useCallback(async (txHash: string, maxAttempts = 30): Promise<{
    success: boolean;
    tokenId: string;
    reader: string;
  }> => {
    for (let i = 0; i < maxAttempts; i++) {
      setMintStatus(`确认交易中... (${i + 1}/${maxAttempts})`);
      
      try {
        const result = await queryTransaction(txHash);
        
        if (result.ok && result.data) {
          if (result.data.status === 'SUCCESS') {
            return {
              success: true,
              tokenId: result.data.tokenId,
              reader: result.data.reader,
            };
          } else if (result.data.status === 'FAILED') {
            throw new Error('交易失败，请重试');
          }
          // PENDING 状态继续等待
        }
      } catch (e: any) {
        console.warn('查询交易状态出错:', e);
        // 继续轮询
      }
      
      // 等待 2 秒后重试
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('交易确认超时，请稍后在区块浏览器查询');
  }, [queryTransaction]);

  useEffect(() => {
    const performMint = async () => {
      if (!code || hasStarted) return;
      setHasStarted(true);

      // 基础验证
      if (code.toLowerCase().startsWith('invalid') || code.length < 8) {
        setError('INVALID_CODE');
        return;
      }

      try {
        let bookAddress = bookAddressParam;
        let readerAddress = readerAddressParam;

        // 如果没有传入地址参数，尝试从后端获取
        if (!bookAddress || !readerAddress) {
          setMintStatus('获取绑定信息...');
          try {
            const bindResult = await getBinding(code);
            if (bindResult.ok) {
              bookAddress = bindResult.book_address || bookAddress;
              readerAddress = bindResult.address || readerAddress;
            }
          } catch (e) {
            console.warn('获取绑定信息失败，使用默认值');
          }
        }

        // 验证必要参数
        if (!bookAddress) {
          // Mock 模式下使用默认地址
          if (isMockMode) {
            bookAddress = '0xe250ae653190F2EDF3ac79FD9bdF2687A90CDE84';
          } else {
            setError('MISSING_BOOK_ADDRESS');
            return;
          }
        }

        if (!readerAddress) {
          if (isMockMode) {
            readerAddress = `0x${code.slice(0, 40).padEnd(40, '0')}`;
          } else {
            setError('MISSING_READER_ADDRESS');
            return;
          }
        }

        // 发起铸造请求
        setMintStatus('正在链上铸造 NFT...');
        const mintResult = await mintNFT(bookAddress, readerAddress);

        if (!mintResult.ok || !mintResult.data?.tx_hash) {
          throw new Error((mintResult as any).error || '铸造请求失败');
        }

        const txHash = mintResult.data.tx_hash;
        setMintStatus(`交易已发送: ${txHash.slice(0, 10)}...`);

        // 轮询等待交易确认
        const confirmResult = await pollTransactionStatus(txHash);

        if (confirmResult.success) {
          // 跳转到成功页面
          const query = new URLSearchParams({
            book_id: bookIdRaw,
            address: confirmResult.reader,
            txHash: txHash,
            codeHash: code,
            token_id: confirmResult.tokenId,
          });

          navigate(`/success?${query.toString()}`, { replace: true });
        }
      } catch (e: any) {
        console.error("Mint failed:", e);
        setError(e.message || 'MINT_FAILED');
      }
    };

    performMint();
  }, [code, hasStarted, mintNFT, getBinding, pollTransactionStatus, navigate, bookIdRaw, bookAddressParam, readerAddressParam, isMockMode]);

  // 错误状态
  if (error) {
    const getErrorInfo = () => {
      switch (error) {
        case 'INVALID_CODE':
          return { title: '无效的二维码', desc: '该二维码无效或已被使用。请确认您扫描的是正版商品附带的二维码。' };
        case 'MISSING_BOOK_ADDRESS':
          return { title: '缺少书籍合约地址', desc: '无法获取书籍合约信息，请返回重新扫码。' };
        case 'MISSING_READER_ADDRESS':
          return { title: '缺少读者地址', desc: '无法获取读者钱包地址，请返回重新验证。' };
        default:
          return { title: '铸造失败', desc: error };
      }
    };

    const errorInfo = getErrorInfo();

    return (
      <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full bg-[#131722] border border-white/10 rounded-[32px] p-8 text-center space-y-6 shadow-2xl">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
            <span className="text-red-500 text-4xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-white">{errorInfo.title}</h1>
          <p className="text-sm text-gray-400 leading-relaxed">{errorInfo.desc}</p>
          
          {/* 模式提示 */}
          <div className={`${isMockMode ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-red-500/5 border-red-500/20'} border rounded-xl p-4`}>
            <p className={`text-xs ${isMockMode ? 'text-yellow-500/80' : 'text-red-400'} font-medium`}>
              {isMockMode 
                ? '⚠️ DEMO 模式：避免使用 invalid 开头的码' 
                : '🔴 Dev API 模式：请检查后端服务状态'}
            </p>
          </div>
          
          <button 
            onClick={() => navigate('/bookshelf', { replace: true })}
            className="w-full py-4 rounded-xl bg-white/5 text-white font-bold text-sm uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
          >
            返回大盘
          </button>
        </div>
        <div className="mt-10 text-[9px] text-gray-600 uppercase tracking-[0.4em] font-medium">
          Whale Vault Protocol <span className="mx-2">•</span> {isMockMode ? 'DEMO MODE' : 'DEV API'}
        </div>
      </div>
    );
  }

  // 加载状态
  return (
    <div className="min-h-screen bg-[#0b0e11] flex flex-col items-center justify-center">
      <LoadingSpinner 
        message={mintStatus || '正在验证二维码...'} 
        variant="chain"
        size="lg"
      />
      <div className="mt-8 max-w-xs text-center">
        <div className={`${isMockMode ? 'bg-purple-500/10 border-purple-500/20' : 'bg-green-500/10 border-green-500/20'} border rounded-xl p-4`}>
          <p className={`text-[10px] ${isMockMode ? 'text-purple-400' : 'text-green-400'} font-bold uppercase tracking-wider`}>
            {isMockMode ? '🔧 DEMO MODE' : '🟢 DEV API'}
          </p>
          <p className="text-[9px] text-gray-500 mt-1">
            {isMockMode ? '模拟链上 NFT 铸造流程' : '正在与后端 API 通信...'}
          </p>
        </div>
      </div>
    </div>
  );
}
