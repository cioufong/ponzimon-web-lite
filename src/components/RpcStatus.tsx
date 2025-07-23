'use client';

import { useState, useEffect } from 'react';
import { rpcRateLimiter } from '@/lib/utils/rate-limiter';
import { useAppStore } from '@/store';
import { useI18n } from '../lib/useI18n';

interface Props {
  className?: string;
}

const RpcStatus = ({ className = '' }: Props) => {
  const [queueLength, setQueueLength] = useState(0);
  // 直接從store取得最新config
  const { config } = useAppStore();
  const { t } = useI18n();

  useEffect(() => {
    const updateStatus = () => {
      setQueueLength(rpcRateLimiter.getQueueLength());
    };
    const interval = setInterval(updateStatus, 1000);
    updateStatus();
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (queueLength === 0) return 'text-green-400';
    if (queueLength < 3) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getStatusText = () => {
    if (queueLength === 0) return t('rpc_status_ok');
    if (queueLength < 3) return t('rpc_status_busy');
    return t('rpc_status_crowded');
  };

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <div className="flex items-center gap-1">
        <div className={`w-2 h-2 rounded-full ${queueLength === 0 ? 'bg-green-400' : queueLength < 3 ? 'bg-yellow-400' : 'bg-red-400'}`}></div>
        <span className={getStatusColor()}>{t('rpc')}</span>
      </div>
      <span className="text-gray-400">|</span>
      <span className={getStatusColor()}>{getStatusText()}</span>
      {queueLength > 0 && (
        <>
          <span className="text-gray-400">|</span>
          <span className="text-gray-300">{t('rpc_queue')}: {queueLength}</span>
        </>
      )}
      <span className="text-gray-400">|</span>
      <span className="text-gray-300">{config.rateLimit.requestsPerSecond}/s</span>
      <span className="text-gray-400">|</span>
      <span className="text-gray-300">{t('rpc_batch')}: {config.rateLimit.batchSize}</span>
      {config.rateLimit.delayMs > 0 && (
        <>
          <span className="text-gray-400">|</span>
          <span className="text-gray-300">{t('rpc_delay')}: {config.rateLimit.delayMs}ms</span>
        </>
      )}
    </div>
  );
};

export default RpcStatus; 