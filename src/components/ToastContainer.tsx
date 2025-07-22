'use client';
import { useToastStore } from '@/store/toast';

const ToastContainer = () => {
  const { toasts, remove } = useToastStore();
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div key={t.id}>
          <a
            href={t.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => remove(t.id)}
            className={`block px-4 py-2 rounded shadow text-white cursor-pointer hover:opacity-90 ${
              t.type === 'success'
                ? 'bg-green-600'
                : t.type === 'error'
                ? 'bg-red-600'
                : 'bg-gray-800'
            }`}
          >
            {t.text}
          </a>
        </div>
      ))}
    </div>
  );
};
export default ToastContainer; 