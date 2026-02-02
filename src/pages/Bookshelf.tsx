import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppMode } from '../contexts/AppModeContext';
import { useApi } from '../hooks/useApi';
import { MOCK_BOOKS, MockBook } from '../data/mockData';
import { ScanVerifyModal } from '../components/ScanVerifyModal';
import { BettingModal } from '../components/BettingModal';
import { ToastContainer } from '../components/ui/CyberpunkToast';

// 语言选项配置
const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: 'ZH' },
  { code: 'ja', label: 'JP' },
  { code: 'ko', label: 'KR' },
  { code: 'ru', label: 'RU' }
];

export default function Bookshelf() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isMockMode } = useAppMode();
  const { fetchBooks } = useApi();
  
  const [tickers, setTickers] = useState<MockBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedIndex, setLastUpdatedIndex] = useState<number | null>(null);
  
  // Modal 状态
  const [showScanModal, setShowScanModal] = useState(false);
  const [showBettingModal, setShowBettingModal] = useState(false);
  const [selectedBook, setSelectedBook] = useState<MockBook | null>(null);

  // 加载数据
  useEffect(() => {
    const loadBooks = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const result = await fetchBooks(1);
        if (result.data) {
          setTickers(result.data);
        }
      } catch (e: any) {
        console.error('加载书籍失败:', e);
        setError(e.message || '加载数据失败');
        setTickers(MOCK_BOOKS);
      } finally {
        setLoading(false);
      }
    };
    
    loadBooks();
  }, [fetchBooks]);

  // 模拟实时波动
  useEffect(() => {
    if (tickers.length === 0) return;
    
    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * tickers.length);
      
      setTickers(prev => prev.map((item, idx) => {
        if (idx === randomIndex) {
          const increment = Math.floor(Math.random() * 50) + 1;
          const newSales = item.sales + increment;
          const currentChange = parseFloat(item.change);
          const newChangeVal = (currentChange + (Math.random() * 0.1 - 0.02)).toFixed(2);
          
          return { 
            ...item, 
            sales: newSales,
            currentPrice: newSales,
            predictionPool: item.predictionPool + Math.floor(Math.random() * 100),
            change: `${parseFloat(newChangeVal) > 0 ? '+' : ''}${newChangeVal}%` 
          };
        }
        return item;
      }));

      setLastUpdatedIndex(randomIndex);
      setTimeout(() => setLastUpdatedIndex(null), 800);
    }, 2000);

    return () => clearInterval(interval);
  }, [tickers.length]);

  const renderTitle = () => {
    switch(i18n.language) {
      case 'zh': return '鲸之金库';
      case 'ja': return 'ホエール・ヴォルト';
      case 'ko': return '웨일 볼트';
      case 'ru': return 'КИТОВОЕ ХРАНИЛИЩЕ';
      default: return 'WHALE VAULT';
    }
  };

  const handleBookClick = (book: MockBook) => {
    setSelectedBook(book);
    navigate(`/book/${book.id}`);
  };

  const handleBetClick = (e: React.MouseEvent, book: MockBook) => {
    e.stopPropagation();
    setSelectedBook(book);
    setShowBettingModal(true);
  };

  const handleBetPlaced = (amount: number, newPool: number) => {
    if (selectedBook) {
      setTickers(prev => prev.map(book => 
        book.id === selectedBook.id 
          ? { ...book, predictionPool: newPool }
          : book
      ));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm">
            {isMockMode ? '加载 Mock 数据...' : '连接后端 API...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <ToastContainer />
      
      {/* 顶部导航栏 */}
      <div className="bg-white/80 backdrop-blur-lg border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-emerald-600 text-sm font-medium">{t('market_status') || 'MARKET LIVE'}</span>
            </span>
            <span className="text-slate-300">|</span>
            <span className={`text-sm font-medium ${isMockMode ? 'text-amber-600' : 'text-emerald-600'}`}>
              {isMockMode ? 'MOCK MODE' : 'DEV API'}
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600 text-sm">
              {t('index') || 'INDEX'}: <span className="font-semibold text-slate-800">{(tickers.reduce((acc, curr) => acc + curr.sales, 0) / 10000).toFixed(2)}K</span>
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            {error && (
              <span className="text-red-500 text-xs bg-red-50 px-2 py-1 rounded">⚠️ {error.slice(0, 30)}</span>
            )}
            
            <button
              onClick={() => setShowScanModal(true)}
              className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:from-indigo-600 hover:to-purple-600 transition-all shadow-md hover:shadow-lg"
            >
              📱 Scan QR
            </button>
            
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={`px-2 py-1 text-xs font-medium rounded transition-all ${
                    i18n.language === lang.code 
                      ? 'bg-indigo-500 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <header className="mb-10">
          <h1 className="text-4xl font-black text-slate-800 mb-2">
            {renderTitle()}{' '}
            <span className="bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
              TERMINAL
            </span>
          </h1>
          <p className="text-slate-500">{t('subtitle') || 'Real-time Book Sales & Prediction Market'}</p>
          <div className={`inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full text-sm font-medium ${
            isMockMode 
              ? 'bg-amber-50 text-amber-700 border border-amber-200' 
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}>
            {isMockMode ? '🔧 DEMO MODE - No Backend Required' : '🟢 DEV API - Connected to Backend'}
          </div>
        </header>

        <div className="bg-white rounded-2xl shadow-soft border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('th_asset') || 'ASSET'}</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('th_title') || 'TITLE'}</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('th_sales') || 'SALES'}</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">POOL</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('th_chg') || 'CHG'}</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">STATUS</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('action_trade') || 'ACTION'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickers.map((book, index) => (
                <tr 
                  key={book.id} 
                  className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                    lastUpdatedIndex === index ? 'bg-indigo-50' : ''
                  }`}
                  onClick={() => handleBookClick(book)}
                >
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-600 font-semibold text-sm border border-indigo-100">
                      {book.symbol}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-800">{book.title}</div>
                    <div className="text-slate-400 text-sm">{book.author}</div>
                  </td>
                  <td className={`px-6 py-4 text-right font-mono font-semibold ${
                    lastUpdatedIndex === index ? 'text-emerald-600' : 'text-slate-800'
                  }`}>
                    {book.sales.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-purple-600 font-semibold">
                    ${(book.predictionPool / 1000).toFixed(1)}K
                  </td>
                  <td className={`px-6 py-4 text-right font-mono font-semibold ${
                    book.change.startsWith('+') ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {book.change}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${
                      book.verificationStatus === 'Verified Genuine' 
                        ? 'bg-emerald-100 text-emerald-600' 
                        : 'bg-red-100 text-red-500'
                    }`}>
                      {book.verificationStatus === 'Verified Genuine' ? '✓' : '⚠️'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button 
                      className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg text-sm font-medium hover:from-indigo-600 hover:to-purple-600 transition-all shadow-sm hover:shadow-md"
                      onClick={(e) => handleBetClick(e, book)}
                    >
                      PREDICT
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      <ScanVerifyModal 
        isOpen={showScanModal}
        onClose={() => setShowScanModal(false)}
      />
      
      {selectedBook && (
        <BettingModal
          isOpen={showBettingModal}
          onClose={() => setShowBettingModal(false)}
          book={selectedBook}
          onBetPlaced={handleBetPlaced}
        />
      )}
    </div>
  );
}
