import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      "terminal_title": "WHALE VAULT TERMINAL",
      "market_status": "MARKET: OPEN",
      "network": "NETWORK: MONAD TESTNET",
      "subtitle": "The \"End-Game\" Market Dashboard for Knowledge Assets",
      "th_ticker": "Ticker",
      "th_title": "Title & Author",
      "th_sales": "Echos (Sales)",
      "th_chg": "Market Chg",
      "action_execute": "EXECUTE",
      "active_shards": "ACTIVE_SHARDS",
      "index": "WV_INDEX"
    }
  },
  zh: {
    translation: {
      "terminal_title": "鲸之金库 终端",
      "market_status": "市场状态: 开启",
      "network": "网络: MONAD 测试网",
      "subtitle": "知识资产的“终焉大盘”行情分析系统",
      "th_ticker": "资产代码",
      "th_title": "标题与作者",
      "th_sales": "回响 (销量)",
      "th_chg": "市场涨跌",
      "action_execute": "执行命令",
      "active_shards": "活跃分片",
      "index": "鲸库指数"
    }
  },
  ja: { // 日本语 - 增加赛博朋克终端感
    translation: {
      "terminal_title": "ホエール・ヴォルト 端末",
      "market_status": "市場状態: オープン",
      "network": "ネットワーク: MONAD テストネット",
      "subtitle": "ナレッジアセットの「エンドゲーム」市場",
      "th_ticker": "ティッカー",
      "th_title": "タイトル & 著者",
      "th_sales": "エコー (売上)",
      "th_chg": "市場変動",
      "action_execute": "実行",
      "active_shards": "アクティブ・シャード",
      "index": "WV指数"
    }
  },
  ko: { // 韩语
    translation: {
      "terminal_title": "웨일 볼트 터미널",
      "market_status": "시장 상태: 열림",
      "network": "네트워크: MONAD 테스트넷",
      "subtitle": "지식 자산의 \"엔드게임\" 시장 대시보드",
      "th_ticker": "티커",
      "th_title": "제목 & 저자",
      "th_sales": "에코 (판매량)",
      "th_chg": "시장 변동",
      "action_execute": "실행",
      "active_shards": "활성 샤드",
      "index": "WV 지수"
    }
  },
  ru: { // 俄语 - 增加黑客技术感
    translation: {
      "terminal_title": "ТЕРМИНАЛ КИТОВОГО ХРАНИЛИЩА",
      "market_status": "РЫНОК: ОТКРЫТ",
      "network": "СЕТЬ: MONAD TESTNET",
      "subtitle": "Рыночный терминал для интеллектуальных активов",
      "th_ticker": "Тикер",
      "th_title": "Название и автор",
      "th_sales": "Эхо (Продажи)",
      "th_chg": "Изм. рынка",
      "action_execute": "ВЫПОЛНИТЬ",
      "active_shards": "АКТИВНЫЕ ШАРДЫ",
      "index": "ИНДЕКС WV"
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    debug: false,
    interpolation: { escapeValue: false }
  });

export default i18n;