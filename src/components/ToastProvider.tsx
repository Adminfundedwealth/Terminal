/**
 * TOAST NOTIFICATION SYSTEM
 * 
 * Lightweight toast notifications for risk warnings, errors, and info.
 * No external dependencies — built-in implementation.
 */

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { cn } from '@/utils/helpers';
import { AlertTriangle, AlertOctagon, CheckCircle, Info, X, Volume2 } from 'lucide-react';

type ToastType = 'info' | 'success' | 'warning' | 'danger';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration?: number;
  sound?: boolean;
}

interface ToastContextType {
  showToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
  dismissToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// Beep sound for danger alerts
function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;
    oscillator.start();
    setTimeout(() => {
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      setTimeout(() => { oscillator.stop(); ctx.close(); }, 400);
    }, 150);
  } catch {
    // Audio not available
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev.slice(-4), newToast]); // Keep max 5

    if (toast.sound) {
      playBeep();
    }

    // Auto dismiss
    const duration = toast.duration || (toast.type === 'danger' ? 8000 : 5000);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-[380px] pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const icons = {
    info: <Info size={16} className="text-blue-400" />,
    success: <CheckCircle size={16} className="text-emerald-400" />,
    warning: <AlertTriangle size={16} className="text-yellow-400" />,
    danger: <AlertOctagon size={16} className="text-red-400" />,
  };

  const borderColors = {
    info: 'border-blue-500/40',
    success: 'border-emerald-500/40',
    warning: 'border-yellow-500/40',
    danger: 'border-red-500/40',
  };

  const bgColors = {
    info: 'bg-blue-950/80',
    success: 'bg-emerald-950/80',
    warning: 'bg-yellow-950/80',
    danger: 'bg-red-950/80',
  };

  return (
    <div className={cn(
      'pointer-events-auto animate-in slide-in-from-right fade-in duration-300',
      'rounded-lg border px-4 py-3 shadow-xl backdrop-blur-sm',
      borderColors[toast.type],
      bgColors[toast.type]
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icons[toast.type]}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-bold text-white">{toast.title}</p>
          <p className="text-[11px] text-white/70 mt-0.5 leading-relaxed">{toast.message}</p>
        </div>
        <button onClick={() => onDismiss(toast.id)} className="flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors">
          <X size={12} className="text-white/50" />
        </button>
      </div>
    </div>
  );
}
