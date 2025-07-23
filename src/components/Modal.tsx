'use client';

import React, { PropsWithChildren } from 'react';
import { useI18n } from '../lib/useI18n';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: string; // 新增最大寬度屬性
}

const Modal: React.FC<PropsWithChildren<ModalProps>> = ({ 
  open, 
  onClose, 
  title, 
  children, 
  maxWidth = "max-w-md" 
}) => {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className={`bg-gray-800 rounded-lg p-6 w-full ${maxWidth} shadow-xl relative max-h-[90vh] overflow-hidden`}>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-400 hover:text-white z-10 bg-gray-800 rounded-full w-6 h-6 flex items-center justify-center"
          title={t('close')}
        >
          ✕
        </button>
        {title && <h2 className="text-xl font-bold mb-4 pr-8">{title}</h2>}
        <div className="overflow-auto max-h-[calc(90vh-120px)]">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal; 