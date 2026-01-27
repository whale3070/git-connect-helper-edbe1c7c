import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// 初始数据
const INITIAL_TICKERS = [
  { symbol: "BTC-WP", name: "Bitcoin Whitepaper", price: 21000, address: "btc", author: "Satoshi Nakamoto", change: "+5.4%" },
  { symbol: "ETH-YP", name: "Ethereum Yellowpaper", price: 15500, address: "eth", author: "Vitalik Buterin", change: "+2.1%" },
  { symbol: "GHOST", name: "The Ghost in the Wires", price: 3070, address: "mitnick", author: "Kevin Mitnick", change: "-0.8%" },
  { symbol: "SOV-I", name: "The Sovereign Individual", price: 5400, address: "sov", author: "J.D. Davidson", change: "+12.5%" },
  { symbol: "BLACK", name: "The Black Swan", price: 6800, address: "black", author: "Nassim Taleb", change: "+4.2%" }
];

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
  const [tickers, setTickers] = useState(INITIAL_TICKERS);
  const [lastUpdatedIndex, setLastUpdatedIndex] = useState<number | null>(null);

  // 模拟“终焉大盘”实时波动逻辑
  useEffect(() => {
    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * tickers.length);
      
      setTickers(prev => prev.map((item, idx) => {
        if (idx === randomIndex) {
          const increment = Math.floor(Math.random() * 5) + 1;
          const newPrice = item.price + increment;
          const currentChange = parseFloat(item.change);
          const newChangeVal = (currentChange + (Math.random() * 0.05)).toFixed(2);
          
          return { 
            ...item, 
            price: newPrice, 
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

  // 根据当前语言渲染标题
  const renderTitle = () => {
    switch(i18n.language) {
      case 'zh': return '鲸之金库';
      case 'ja': return 'ホエール・ヴォルト';
      case 'ko': return '웨일 볼트';
      case 'ru': return 'КИТОВОЕ ХРАНИЛИЩЕ';
      default: return 'WHALE VAULT';
    }
  };

  return (
    <div style={styles.container}>
      {/* 顶部行情跑马灯与多语言切换组 */}
      <div style={styles.tickerBar}>
        <div style={styles.tickerContent}>
          <span style={{ color: '#00ffad', fontWeight: 'bold' }}>● {t('market_status')}</span>
          <span style={styles.divider}>|</span>
          <span>{t('network')}</span>
          <span style={styles.divider}>|</span>
          <span>{t('index')}: <span style={{color: '#fff'}}>{(tickers.reduce((acc, curr) => acc + curr.price, 0) / 10).toFixed(2)}</span></span>
          
          {/* 语言切换按钮组 */}
          <div style={styles.langButtonGroup}>
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => i18n.changeLanguage(lang.code)}
                style={{
                  ...styles.langToggleBtn,
                  backgroundColor: i18n.language === lang.code ? '#833ab4' : 'transparent',
                  color: i18n.language === lang.code ? '#fff' : '#666',
                  borderColor: i18n.language === lang.code ? '#833ab4' : '#333',
                }}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>
              {renderTitle()}{' '}
              <span style={styles.terminalText}>TERMINAL</span>
            </h1>
            <p style={styles.subtitle}>{t('subtitle')}</p>
          </div>
        </header>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.theadRow}>
                <th style={styles.th}>{t('th_asset')}</th>
                <th style={styles.th}>{t('th_title')}</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>{t('th_sales')}</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>{t('th_chg')}</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>{t('action_trade')}</th>
              </tr>
            </thead>
            <tbody>
              {tickers.map((book, index) => (
                <tr 
                  key={book.symbol} 
                  style={{
                    ...styles.tr,
                    backgroundColor: lastUpdatedIndex === index ? 'rgba(131, 58, 180, 0.1)' : 'transparent',
                  }}
                  onClick={() => navigate(`/book/${book.address}`)}
                >
                  <td style={styles.td}>
                    <div style={styles.symbolBadge}>{book.symbol}</div>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.bookName}>{book.name}</div>
                    <div style={styles.bookAuthor}>{book.author}</div>
                  </td>
                  <td style={{ 
                    ...styles.td, 
                    ...styles.numeric, 
                    color: lastUpdatedIndex === index ? '#00ffad' : '#f0f3fa',
                    transition: 'color 0.3s ease'
                  }}>
                    {book.price.toLocaleString()}
                  </td>
                  <td style={{ 
                    ...styles.td, 
                    ...styles.numeric, 
                    color: book.change.startsWith('+') ? '#00ffad' : '#ff4d4d' 
                  }}>
                    {book.change}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <button style={styles.actionBtn}>{t('action_trade')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* 视觉特效层 */}
      <div style={styles.scanline}></div>
      <div style={styles.gridOverlay}></div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#050505',
    minHeight: '100vh',
    color: '#a0a0a0',
    fontFamily: '"Inter", "Roboto Mono", monospace',
    position: 'relative',
    overflow: 'hidden',
  },
  tickerBar: {
    backgroundColor: '#000',
    borderBottom: '1px solid #1a1a1a',
    padding: '8px 20px',
    fontSize: '11px',
    letterSpacing: '1px',
    zIndex: 10,
    position: 'relative',
  },
  tickerContent: { display: 'flex', gap: '20px', alignItems: 'center' },
  divider: { color: '#333' },
  langButtonGroup: {
    marginLeft: 'auto',
    display: 'flex',
    gap: '4px',
    backgroundColor: '#0a0a0a',
    padding: '2px',
    borderRadius: '4px',
    border: '1px solid #1a1a1a'
  },
  langToggleBtn: {
    background: 'none',
    border: '1px solid transparent',
    fontSize: '9px',
    padding: '2px 8px',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'all 0.2s ease',
    fontWeight: 'bold',
  },
  main: { padding: '40px 20px', maxWidth: '1100px', margin: '0 auto', position: 'relative', zIndex: 1 },
  header: { marginBottom: '40px' },
  title: { color: '#fff', fontSize: '32px', fontWeight: 900, margin: 0, letterSpacing: '-1.5px' },
  terminalText: { 
    color: '#833ab4', 
    textShadow: '0 0 20px rgba(131, 58, 180, 0.6)',
    fontStyle: 'italic'
  },
  subtitle: { fontSize: '14px', color: '#444', margin: '5px 0 0 0', fontWeight: 400 },
  tableContainer: {
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    backdropFilter: 'blur(15px)',
    border: '1px solid #1a1a1a',
    borderRadius: '2px',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '15px 20px', color: '#333', fontSize: '10px', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #1a1a1a' },
  td: { padding: '15px 20px', borderBottom: '1px solid #0f0f0f' },
  tr: { transition: 'background-color 0.4s ease', cursor: 'pointer' },
  symbolBadge: { color: '#833ab4', fontWeight: 'bold', border: '1px solid #1a1a1a', padding: '2px 6px', display: 'inline-block' },
  bookName: { color: '#efefef', fontWeight: 600, fontSize: '15px' },
  bookAuthor: { color: '#444', fontSize: '12px' },
  numeric: { fontFamily: '"Roboto Mono", monospace', textAlign: 'right' },
  actionBtn: {
    backgroundColor: 'transparent',
    border: '1px solid #833ab4',
    color: '#833ab4',
    padding: '4px 12px',
    fontSize: '10px',
    cursor: 'pointer',
    fontWeight: 'bold',
    borderRadius: '1px',
    transition: 'all 0.2s ease'
  },
  scanline: {
    width: '100%', height: '2px', zIndex: 5, background: 'rgba(131, 58, 180, 0.05)',
    position: 'absolute', pointerEvents: 'none', top: 0,
    boxShadow: '0 0 10px rgba(131, 58, 180, 0.2)',
  },
  gridOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundImage: `linear-gradient(#080808 1px, transparent 1px), linear-gradient(90deg, #080808 1px, transparent 1px)`,
    backgroundSize: '30px 30px', zIndex: 0, pointerEvents: 'none',
  }
};