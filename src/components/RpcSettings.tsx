'use client';

import { useAppStore } from '@/store';
import { useState } from 'react';
import { useI18n } from '../lib/useI18n';

interface Props {
  onClose: () => void;
}

const RpcSettings = ({ onClose }: Props) => {
  const { config, setRpcEndpoint, setRateLimit } = useAppStore();
  const [localRpc, setLocalRpc] = useState(config.rpcEndpoint);
  const [localRate, setLocalRate] = useState({
    requestsPerSecond: config.rateLimit.requestsPerSecond,
    batchSize: config.rateLimit.batchSize,
    delayMs: config.rateLimit.delayMs,
  });
  const [dirty, setDirty] = useState(false);
  const { t } = useI18n();

  return (
    <div className="bg-gray-800 p-4 rounded-lg max-w-md">
      <h2 className="text-xl font-bold mb-4">{t('rpc_settings')}</h2>
      <div className="space-y-4">
        {/* RPC URL（可編輯） */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('rpc_url')}</label>
          <input
            type="text"
            value={localRpc}
            onChange={e => { setLocalRpc(e.target.value); setDirty(true); }}
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('enter_rpc_url')}
          />
        </div>
        {/* 限速資訊（可編輯） */}
        <h3 className="text-lg font-semibold mb-3 text-gray-200">{t('rate_limiting')}</h3>
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('requests_per_second')}</label>
          <input
            type="number"
            value={localRate.requestsPerSecond}
            min={1}
            max={100}
            onChange={e => { setLocalRate(r => ({ ...r, requestsPerSecond: Number(e.target.value) })); setDirty(true); }}
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white"
          />
          <p className="text-xs text-gray-400 mt-1">{t('rate_tip_1')}</p>
        </div>
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('batch_size')}</label>
          <input
            type="number"
            value={localRate.batchSize}
            min={1}
            max={100}
            onChange={e => { setLocalRate(r => ({ ...r, batchSize: Number(e.target.value) })); setDirty(true); }}
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white"
          />
          <p className="text-xs text-gray-400 mt-1">{t('rate_tip_2')}</p>
        </div>
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('delay_ms')}</label>
          <input
            type="number"
            value={localRate.delayMs}
            min={0}
            max={10000}
            onChange={e => { setLocalRate(r => ({ ...r, delayMs: Number(e.target.value) })); setDirty(true); }}
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white"
            placeholder={t('delay_ms_placeholder')}
          />
          <p className="text-xs text-gray-400 mt-1">{t('rate_tip_3')}</p>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
            disabled={!dirty}
            onClick={() => {
              setRpcEndpoint(localRpc);
              setRateLimit(localRate);
              setDirty(false);
              if (onClose) onClose();
            }}
          >
            {t('save')}
          </button>
          <button
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md"
            onClick={onClose}
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RpcSettings;
