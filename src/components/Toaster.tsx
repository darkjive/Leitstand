import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, X } from 'lucide-react';
import { TOAST_EVENT, type ToastItem, type ToastKind } from '../lib/toast';

const KIND_CLASSES: Record<ToastKind, string> = {
  error: 'border-red-500/60 bg-red-950/90 text-red-200',
  success: 'border-green-500/60 bg-green-950/90 text-green-200',
  info: 'border-accent/60 bg-bg/95 text-accent',
};

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent).detail as ToastItem;
      setToasts(prev => [...prev, item]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== item.id));
      }, 6000);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-md">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-2 px-3 py-2 rounded border text-xs font-mono shadow-lg whitespace-pre-wrap ${KIND_CLASSES[t.kind]}`}
        >
          {t.kind === 'success' ? (
            <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            className="opacity-60 hover:opacity-100"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
