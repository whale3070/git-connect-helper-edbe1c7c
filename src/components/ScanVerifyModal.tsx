import React, { useState } from 'react';
import { useScanSimulation } from '../hooks/useMockSimulation';
import { ScanningLoader } from './ui/LoadingSpinner';
import { showToast } from './ui/CyberpunkToast';

interface ScanVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
}

export const ScanVerifyModal: React.FC<ScanVerifyModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { isScanning, scanResult, startScan, resetScan } = useScanSimulation();
  const [showResult, setShowResult] = useState(false);

  const handleScan = async () => { await startScan(); setShowResult(true); };
  const handleClose = () => { resetScan(); setShowResult(false); onClose(); };
  const handleConfirm = () => { if (scanResult?.success) { showToast('NFT Minted Successfully!', 'success', scanResult.txHash); onSuccess?.(scanResult); } handleClose(); };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 space-y-6 shadow-xl">
        <div className="text-center">
          <h2 className="text-lg font-bold text-slate-800 mb-2">{isScanning ? '正在扫描验证...' : showResult ? '验证结果' : '扫描二维码'}</h2>
          <p className="text-xs text-slate-400">{isScanning ? '模拟链上交互中' : showResult ? '' : '点击下方按钮开始扫描'}</p>
        </div>

        <div className="py-6">
          {isScanning ? <ScanningLoader /> : showResult && scanResult ? (
            <div className="space-y-4">
              <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${scanResult.success ? 'bg-emerald-100 border border-emerald-200' : 'bg-red-100 border border-red-200'}`}>
                <span className="text-4xl">{scanResult.success ? '✓' : '⚠️'}</span>
              </div>
              {scanResult.book && (
                <div className="bg-slate-50 rounded-xl p-4 space-y-2 border border-slate-100">
                  <div className="flex items-center gap-3">
                    <img src={scanResult.book.coverImage} alt={scanResult.book.title} className="w-12 h-16 object-cover rounded" onError={(e) => { e.currentTarget.src = 'https://placehold.co/100x140/e2e8f0/6366f1?text=Book'; }} />
                    <div><p className="text-slate-800 font-medium">{scanResult.book.title}</p><p className="text-xs text-slate-400">{scanResult.book.author}</p></div>
                  </div>
                </div>
              )}
              <p className={`text-center text-sm font-medium ${scanResult.success ? 'text-emerald-600' : 'text-red-500'}`}>{scanResult.message}</p>
              {scanResult.success && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 uppercase mb-1">Transaction Hash</p>
                  <p className="text-xs font-mono text-indigo-600 break-all">{scanResult.txHash}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-24 h-24 mx-auto bg-indigo-50 rounded-full flex items-center justify-center mb-4 border border-indigo-100"><span className="text-5xl">📱</span></div>
              <p className="text-slate-500 text-sm">点击按钮模拟扫描书籍二维码</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {!showResult ? (
            <button onClick={handleScan} disabled={isScanning} className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold text-sm uppercase tracking-widest hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 transition-all">{isScanning ? 'Scanning...' : 'Scan QR Code'}</button>
          ) : (
            <button onClick={handleConfirm} className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest transition-all ${scanResult?.success ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white' : 'bg-red-100 text-red-600 border border-red-200'}`}>{scanResult?.success ? 'Confirm & Close' : 'Close'}</button>
          )}
          {!isScanning && <button onClick={handleClose} className="w-full py-3 text-slate-400 text-xs uppercase tracking-widest hover:text-slate-600 transition-colors">Cancel</button>}
        </div>
      </div>
    </div>
  );
};
