import React, { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  txHash?: string;
  duration?: number;
  onClose: () => void;
}

export const CyberpunkToast: React.FC<ToastProps> = ({
  message,
  type,
  txHash,
  duration = 5000,
  onClose
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-emerald-50 border-emerald-300 text-emerald-700';
      case 'error':
        return 'bg-red-50 border-red-300 text-red-700';
      case 'warning':
        return 'bg-amber-50 border-amber-300 text-amber-700';
      default:
        return 'bg-indigo-50 border-indigo-300 text-indigo-700';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      default: return 'ℹ';
    }
  };

  const getIconBg = () => {
    switch (type) {
      case 'success': return 'bg-emerald-100';
      case 'error': return 'bg-red-100';
      case 'warning': return 'bg-amber-100';
      default: return 'bg-indigo-100';
    }
  };

  return (
    <div
      className={`fixed top-6 right-6 z-[9999] max-w-md transform transition-all duration-300 ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className={`${getStyles()} border rounded-2xl p-4 shadow-lg`}>
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-full ${getIconBg()} flex items-center justify-center text-lg font-bold`}>
            {getIcon()}
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm text-slate-800">{message}</p>
            {txHash && (
              <p className="mt-2 text-[10px] font-mono opacity-60 break-all">
                TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </p>
            )}
          </div>
          <button
            onClick={() => {
              setIsVisible(false);
              setTimeout(onClose, 300);
            }}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

// Toast 管理器
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  txHash?: string;
}

let toastId = 0;
let toastListeners: ((toasts: Toast[]) => void)[] = [];
let currentToasts: Toast[] = [];

const notifyListeners = () => {
  toastListeners.forEach(listener => listener([...currentToasts]));
};

export const showToast = (
  message: string,
  type: Toast['type'] = 'info',
  txHash?: string
) => {
  const id = `toast-${++toastId}`;
  currentToasts.push({ id, message, type, txHash });
  notifyListeners();
  return id;
};

export const removeToast = (id: string) => {
  currentToasts = currentToasts.filter(t => t.id !== id);
  notifyListeners();
};

export const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (newToasts: Toast[]) => setToasts(newToasts);
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  return toasts;
};

export const ToastContainer: React.FC = () => {
  const toasts = useToasts();

  return (
    <>
      {toasts.map((toast, index) => (
        <div key={toast.id} style={{ top: `${24 + index * 100}px` }} className="fixed right-6 z-[9999]">
          <CyberpunkToast
            message={toast.message}
            type={toast.type}
            txHash={toast.txHash}
            onClose={() => removeToast(toast.id)}
          />
        </div>
      ))}
    </>
  );
};
