'use client';

import { useState } from 'react';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { useAppStore } from '@/store';
import { useI18n } from '../lib/useI18n';

interface Props {
  onCancel: () => void;
  onSaved: () => void;
}

const AddWalletCard = ({ onCancel, onSaved }: Props) => {
  const { addAccount, accounts } = useAppStore();
  const [secretKey, setSecretKey] = useState('');
  const [error, setError] = useState('');
  const { t } = useI18n();

  const handleSave = () => {
    try {
      const kp = Keypair.fromSecretKey(bs58.decode(secretKey.trim()));
      
      // 檢查是否已存在相同的私鑰
      const existingAccount = accounts.find(acc => acc.secret === secretKey.trim());
      if (existingAccount) {
        setError(t('wallet_already_added'));
        return;
      }
      
      addAccount({ name: kp.publicKey.toBase58(), secret: secretKey.trim() });
      onSaved();
    } catch {
      setError(t('invalid_secret_key'));
    }
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg flex flex-col h-full">
      <h3 className="font-semibold mb-2">{t('add_wallet')}</h3>
      <input
        type="text"
        value={secretKey}
        onChange={(e) => setSecretKey(e.target.value)}
        placeholder={t('enter_wallet_secret_key')}
        className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      <div className="mt-auto flex gap-2 pt-4">
        <button
          onClick={handleSave}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-1 rounded text-sm"
        >
          {t('save')}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-1 rounded text-sm"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
};

export default AddWalletCard; 