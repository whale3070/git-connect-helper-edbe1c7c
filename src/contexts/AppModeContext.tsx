import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type AppMode = 'mock' | 'dev';

interface AppModeContextType {
  mode: AppMode;
  isMockMode: boolean;
  isDevMode: boolean;
  toggleMode: () => void;
  setMode: (mode: AppMode) => void;
  apiBaseUrl: string;
}

const AppModeContext = createContext<AppModeContextType | undefined>(undefined);

export const AppModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<AppMode>(() => {
    // 从 localStorage 读取保存的模式
    const saved = localStorage.getItem('app-mode');
    return (saved === 'dev' ? 'dev' : 'mock') as AppMode;
  });

  const setMode = useCallback((newMode: AppMode) => {
    setModeState(newMode);
    localStorage.setItem('app-mode', newMode);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'mock' ? 'dev' : 'mock');
  }, [mode, setMode]);

  const value: AppModeContextType = {
    mode,
    isMockMode: mode === 'mock',
    isDevMode: mode === 'dev',
    toggleMode,
    setMode,
    apiBaseUrl: mode === 'dev' ? 'http://198.55.109.102:8080' : '',
  };

  return (
    <AppModeContext.Provider value={value}>
      {children}
    </AppModeContext.Provider>
  );
};

export const useAppMode = (): AppModeContextType => {
  const context = useContext(AppModeContext);
  if (!context) {
    throw new Error('useAppMode must be used within AppModeProvider');
  }
  return context;
};
