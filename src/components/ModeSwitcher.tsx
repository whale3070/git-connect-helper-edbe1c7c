import React from 'react';
import { useAppMode } from '../contexts/AppModeContext';
import { Settings, Zap } from 'lucide-react';

const ModeSwitcher: React.FC = () => {
  const { mode, toggleMode, isMockMode } = useAppMode();

  return (
    <button
      onClick={toggleMode}
      className={`
        fixed bottom-20 right-4 z-50
        flex items-center gap-2 px-3 py-2 rounded-lg
        text-xs font-mono uppercase tracking-wider
        border transition-all duration-300 shadow-md
        ${isMockMode 
          ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100' 
          : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
        }
      `}
      title={isMockMode ? '切换到开发者模式 (真实API)' : '切换到 Mock 模式'}
    >
      {isMockMode ? (
        <>
          <Zap className="w-4 h-4" />
          <span>Mock</span>
        </>
      ) : (
        <>
          <Settings className="w-4 h-4 animate-spin" style={{ animationDuration: '3s' }} />
          <span>Dev API</span>
        </>
      )}
    </button>
  );
};

export default ModeSwitcher;
