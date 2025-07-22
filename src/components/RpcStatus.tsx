'use client';

import { useState, useEffect } from 'react';
import { rpcRateLimiter } from '@/lib/utils/rate-limiter';
import { useAppStore } from '@/store';

interface Props {
  className?: string;
}

const RpcStatus = ({ className = '' }: Props) => {
  const [queueLength, setQueueLength] = useState(0);
  // 直接從store取得最新config
  const { config } = useAppStore();

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
    if (queueLength === 0) return '正常';
    if (queueLength < 3) return '忙碌';
    return '擁擠';
  };

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <div className="flex items-center gap-1">
        <div className={`w-2 h-2 rounded-full ${queueLength === 0 ? 'bg-green-400' : queueLength < 3 ? 'bg-yellow-400' : 'bg-red-400'}`}></div>
        <span className={getStatusColor()}>RPC</span>
      </div>
      <span className="text-gray-400">|</span>
      <span className={getStatusColor()}>{getStatusText()}</span>
      {queueLength > 0 && (
        <>
          <span className="text-gray-400">|</span>
          <span className="text-gray-300">對列: {queueLength}</span>
        </>
      )}
      <span className="text-gray-400">|</span>
      <span className="text-gray-300">{config.rateLimit.requestsPerSecond}/s</span>
      <span className="text-gray-400">|</span>
      <span className="text-gray-300">批次: {config.rateLimit.batchSize}</span>
      {config.rateLimit.delayMs > 0 && (
        <>
          <span className="text-gray-400">|</span>
          <span className="text-gray-300">延遲: {config.rateLimit.delayMs}ms</span>
        </>
      )}
    </div>
  );
};

export default RpcStatus; 