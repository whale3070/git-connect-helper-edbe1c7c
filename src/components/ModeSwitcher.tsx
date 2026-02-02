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
        border transition-all duration-300
        ${isMockMode 
          ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30' 
          : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/30'
        }
        shadow-lg backdrop-blur-sm
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
