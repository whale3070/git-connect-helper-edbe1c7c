import React, { useState } from 'react';
import { useBettingSimulation } from '../hooks/useMockSimulation';
import { WalletSigningLoader } from './ui/LoadingSpinner';
import { showToast } from './ui/CyberpunkToast';
import { MockBook } from '../data/mockData';

interface BettingModalProps { isOpen: boolean; onClose: () => void; book: MockBook; onBetPlaced?: (amount: number, newPool: number) => void; }

export const BettingModal: React.FC<BettingModalProps> = ({ isOpen, onClose, book, onBetPlaced }) => {
  const [amount, setAmount] = useState<string>('100');
  const [prediction, setPrediction] = useState<'up' | 'down'>('up');
  const { isProcessing, walletStatus, placeBet, resetBet } = useBettingSimulation();

  const handlePlaceBet = async () => {
    const betAmount = parseFloat(amount) || 0;
    if (betAmount <= 0) { showToast('Please enter a valid amount', 'warning'); return; }
    const result = await placeBet(betAmount, book.id);
    if (result.success) { showToast(`Bet placed! ${betAmount} USDT on ${book.symbol}`, 'success', result.txHash); onBetPlaced?.(betAmount, book.predictionPool + betAmount); handleClose(); }
  };

  const handleClose = () => { resetBet(); setAmount('100'); onClose(); };

  if (!isOpen) return null;
  if (isProcessing && walletStatus) return <WalletSigningLoader status={walletStatus} />;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 space-y-6 shadow-xl">
        <div className="text-center">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Place Your Prediction</h2>
          <p className="text-xs text-indigo-600 font-mono">{book.symbol}</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 flex items-center gap-4 border border-slate-100">
          <img src={book.coverImage} alt={book.title} className="w-14 h-20 object-cover rounded" onError={(e) => { e.currentTarget.src = 'https://placehold.co/100x140/e2e8f0/6366f1?text=Book'; }} />
          <div className="flex-1">
            <p className="text-slate-800 font-medium">{book.title}</p>
            <p className="text-xs text-slate-400">{book.author}</p>
            <div className="mt-2 flex items-center gap-2"><span className="text-xs text-slate-400">Current Sales:</span><span className="text-sm font-bold text-indigo-600">{book.sales.toLocaleString()}</span></div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4 text-center">
          <p className="text-xs text-indigo-600 uppercase tracking-wider mb-1">Current Pool</p>
          <p className="text-2xl font-black text-slate-800">{book.predictionPool.toLocaleString()} <span className="text-sm text-slate-400">USDT</span></p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setPrediction('up')} className={`py-4 rounded-xl font-bold text-sm uppercase transition-all ${prediction === 'up' ? 'bg-emerald-500 text-white shadow-md' : 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100'}`}>📈 Sales Up</button>
          <button onClick={() => setPrediction('down')} className={`py-4 rounded-xl font-bold text-sm uppercase transition-all ${prediction === 'down' ? 'bg-red-500 text-white shadow-md' : 'bg-red-50 text-red-500 border border-red-200 hover:bg-red-100'}`}>📉 Sales Down</button>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-400 uppercase font-semibold">Bet Amount (USDT)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-xl font-bold text-center text-slate-800 outline-none focus:border-indigo-400" placeholder="100" min="1" />
          <div className="flex justify-center gap-2 mt-2">
            {[50, 100, 500, 1000].map((preset) => (<button key={preset} onClick={() => setAmount(preset.toString())} className="px-3 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-700 transition-all">{preset}</button>))}
          </div>
        </div>

        <div className="space-y-3">
          <button onClick={handlePlaceBet} disabled={isProcessing || !amount || parseFloat(amount) <= 0} className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold text-sm uppercase tracking-widest hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 transition-all shadow-md">{isProcessing ? 'Processing...' : 'Confirm Prediction'}</button>
          <button onClick={handleClose} className="w-full py-3 text-slate-400 text-xs uppercase tracking-widest hover:text-slate-600 transition-colors">Cancel</button>
        </div>

        <p className="text-[9px] text-slate-400 text-center">This is a demo. No real transactions will occur.</p>
      </div>
    </div>
  );
};
