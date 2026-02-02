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
            return { success: true, tokenId: result.data.tokenId, reader: result.data.reader };
          } else if (result.data.status === 'FAILED') {
            throw new Error('交易失败，请重试');
          }
        }
      } catch (e: any) {
        console.warn('查询交易状态出错:', e);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('交易确认超时，请稍后在区块浏览器查询');
  }, [queryTransaction]);

  useEffect(() => {
    const performMint = async () => {
      if (!code || hasStarted) return;
      setHasStarted(true);

      if (code.toLowerCase().startsWith('invalid') || code.length < 8) {
        setError('INVALID_CODE');
        return;
      }

      try {
        let bookAddress = bookAddressParam;
        let readerAddress = readerAddressParam;

        // 第一步：获取绑定信息并验证
        setMintStatus('验证读者身份...');
        try {
          const bindResult = await getBinding(code);
          console.log('[MintConfirm] 绑定信息返回:', bindResult);
          
          if (!bindResult.ok) {
            throw new Error(bindResult.error || '验证失败');
          }
          
          // 检查是否为有效读者
          if (bindResult.status !== 'valid' && bindResult.status !== 'used') {
            throw new Error('无效的激活码状态');
          }
          
          // 提取地址信息
          bookAddress = bindResult.book_address || bookAddress;
          readerAddress = bindResult.address || readerAddress;
          
          console.log('[MintConfirm] 验证成功 - 书籍地址:', bookAddress, '读者地址:', readerAddress);
        } catch (e: any) {
          console.error('[MintConfirm] 获取绑定信息失败:', e);
          if (!isMockMode) {
            setError(e.message || 'BINDING_FAILED');
            return;
          }
          console.warn('Mock 模式：使用默认值');
        }

        if (!bookAddress) {
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

        setMintStatus('正在链上铸造 NFT...');
        const mintResult = await mintNFT(bookAddress, readerAddress);

        if (!mintResult.ok || !mintResult.data?.tx_hash) {
          throw new Error((mintResult as any).error || '铸造请求失败');
        }

        const txHash = mintResult.data.tx_hash;
        setMintStatus(`交易已发送: ${txHash.slice(0, 10)}...`);

        const confirmResult = await pollTransactionStatus(txHash);

        if (confirmResult.success) {
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

  if (error) {
    const getErrorInfo = () => {
      switch (error) {
        case 'INVALID_CODE':
          return { title: '无效的二维码', desc: '该二维码无效或已被使用。' };
        case 'MISSING_BOOK_ADDRESS':
          return { title: '缺少书籍合约地址', desc: '无法获取书籍合约信息。' };
        case 'MISSING_READER_ADDRESS':
          return { title: '缺少读者地址', desc: '无法获取读者钱包地址。' };
        default:
          return { title: '铸造失败', desc: error };
      }
    };

    const errorInfo = getErrorInfo();

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-6 shadow-lg">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto border border-red-100">
            <span className="text-red-500 text-4xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-slate-800">{errorInfo.title}</h1>
          <p className="text-sm text-slate-500 leading-relaxed">{errorInfo.desc}</p>
          
          <div className={`${isMockMode ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'} border rounded-xl p-4`}>
            <p className={`text-xs ${isMockMode ? 'text-amber-700' : 'text-red-600'} font-medium`}>
              {isMockMode ? '⚠️ DEMO 模式：避免使用 invalid 开头的码' : '🔴 Dev API 模式：请检查后端服务状态'}
            </p>
          </div>
          
          <button 
            onClick={() => navigate('/bookshelf', { replace: true })}
            className="w-full py-4 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm uppercase tracking-widest hover:bg-slate-200 transition-all"
          >
            返回大盘
          </button>
        </div>
        <div className="mt-10 text-xs text-slate-400 uppercase tracking-widest font-medium">
          Whale Vault Protocol <span className="mx-2">•</span> {isMockMode ? 'DEMO MODE' : 'DEV API'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center">
      <LoadingSpinner 
        message={mintStatus || '正在验证二维码...'} 
        variant="chain"
        size="lg"
      />
      <div className="mt-8 max-w-xs text-center">
        <div className={`${isMockMode ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} border rounded-xl p-4`}>
          <p className={`text-xs ${isMockMode ? 'text-amber-700' : 'text-emerald-700'} font-semibold uppercase tracking-wider`}>
            {isMockMode ? '🔧 DEMO MODE' : '🟢 DEV API'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {isMockMode ? '模拟链上 NFT 铸造流程' : '正在与后端 API 通信...'}
          </p>
        </div>
      </div>
    </div>
  );
}
