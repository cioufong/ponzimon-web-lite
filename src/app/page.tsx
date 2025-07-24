'use client';

import { PublicKey } from '@solana/web3.js';
import AddWalletCard from '@/components/AddWalletCard';
import PlayerCard from '@/components/PlayerCard';
import { useAppStore } from '@/store';
import { useState, useEffect, useRef, useCallback } from 'react';
import Modal from '@/components/Modal';
import RpcSettings from '@/components/RpcSettings';
import RpcStatus from '@/components/RpcStatus';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { PonzimonClient } from '@/lib/ponzimon-client';
import { useToastStore } from '@/store/toast';
import { useLogStore } from '@/store/log';
import { IDL } from '@/lib/idl/ponzimon';
import { parsePlayerBuffer } from '@/lib/utils/player';
import { useQueryClient } from '@tanstack/react-query';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import type { GlobalState } from '@/lib/types';
import { I18nProvider, useI18n, Locale } from '../lib/I18nProvider';

function Home() {
  const { accounts, config, addAccount, refreshInterval } = useAppStore();
  const [rpcOpen, setRpcOpen] = useState(false);
  const [addingWallet, setAddingWallet] = useState(false);
  const toast = useToastStore((s) => s.add);
  const clearAllLogs = useLogStore((s) => s.clearAll);
  const logsMap = useLogStore((s) => s.logs);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [showAddWalletCard, setShowAddWalletCard] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { locale, setLocale, t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);

  // 顯示抽卡價格
  const [boosterCost, setBoosterCost] = useState<number | null>(null);
  const [farmInitCost, setFarmInitCost] = useState<number | null>(null);
  const [claimTimeRemaining, setClaimTimeRemaining] = useState<string>(''); // 新增
  useEffect(() => {
    const fetchBoosterCost = async () => {
      if (!config.tokenMint) {
        setBoosterCost(null);
        setFarmInitCost(null);
        return;
      }
      try {
        const connection = new (await import('@solana/web3.js')).Connection(config.rpcEndpoint, 'confirmed');
        const client = new PonzimonClient(connection, config.programId ? new PublicKey(config.programId) : new PublicKey(IDL.address));
        const globalState = await client.getGlobalState(new PublicKey(config.tokenMint));
        setBoosterCost(Number(globalState.booster_pack_cost_microtokens) / 1_000_000);
        setFarmInitCost(Number(globalState.initial_farm_purchase_fee_lamports) / 1_000_000_000);
      } catch (e) {
        toast(`讀取抽卡價格失敗: ${e}`, 'error');
        setBoosterCost(null);
        setFarmInitCost(null);
      }
    };
    fetchBoosterCost();
  }, [config.rpcEndpoint, config.programId, config.tokenMint, refreshInterval, toast]);

  // 計算 claim 開放時間倒數
  useEffect(() => {
    if (!config.tokenMint) return;
    
    const fetchGlobalState = async () => {
      try {
        const connection = new (await import('@solana/web3.js')).Connection(config.rpcEndpoint, 'confirmed');
        const client = new PonzimonClient(connection, config.programId ? new PublicKey(config.programId) : new PublicKey(IDL.address));
        return await client.getGlobalState(new PublicKey(config.tokenMint));
      } catch {
        return null;
      }
    };

    let globalState: GlobalState | null = null;
    let lastFetchTime = 0;
    const FETCH_INTERVAL = 10000; // 10 秒查詢一次 GlobalState

    const updateCountdown = async () => {
      const now = Date.now();
      
      // 每 10 秒才重新查詢 GlobalState
      if (!globalState || now - lastFetchTime > FETCH_INTERVAL) {
        globalState = await fetchGlobalState();
        lastFetchTime = now;
      }
      
      if (!globalState || !globalState.start_slot) {
        setClaimTimeRemaining('');
        return;
      }

      const currentSlot = Date.now() / 400; // 估算當前 slot（每 400 slot）
      const startSlot = Number(globalState.start_slot);
      const remainingSlots = Math.max(0, startSlot - currentSlot);
      
      if (remainingSlots <= 0) {
        setClaimTimeRemaining('');
        return;
      }

      // 轉換為時間（1 slot = 400ms）
      const remainingMs = remainingSlots * 400;
      const hours = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

      if (hours > 0) {
        setClaimTimeRemaining(`Claim 開放倒數: ${hours}時${minutes}分`);
      } else if (minutes > 0) {
        setClaimTimeRemaining(`Claim 開放倒數: ${minutes}分${seconds}秒`);
      } else {
        setClaimTimeRemaining(`Claim 開放倒數: ${seconds}秒`);
      }
    };

    // 只在有自動刷新間隔時才啟用 start slot 查詢
    if (refreshInterval > 0) {
      updateCountdown();
      const interval = setInterval(updateCountdown, 10);
      return () => clearInterval(interval);
    } else {
      // 沒有自動刷新時，只顯示靜態時間（如果有緩存的 globalState）
      setClaimTimeRemaining('');
    }
  }, [config.programId, config.rpcEndpoint, config.tokenMint, refreshInterval]);

  // 全域自動刷新
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const handleGlobalRefresh = useCallback(async () => {
    setRefreshing(true);
    // 获取限流配置
    const state = useAppStore.getState();
    const rateLimit = state.config.rateLimit;
    const { delay } = await import('@/lib/utils/rate-limiter');
    
    const pubkeyList = accounts.map(acc => Keypair.fromSecretKey(bs58.decode(acc.secret)).publicKey);
    
    // 为 QuickNode 15/second 限制优化：每个钱包需要1-3个请求，所以每批次最多5个钱包
    // 这样可以确保每批次最多 5 * 3 = 15 个请求
    const maxWalletsPerBatch = Math.min(rateLimit.batchSize, Math.floor(15 / 3));
    const batches = [];
    for (let i = 0; i < pubkeyList.length; i += maxWalletsPerBatch) {
      batches.push(pubkeyList.slice(i, i + maxWalletsPerBatch));
    }
    
    try {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchRequest = [];
        let id = 1;
        const pubkeyToIds: Record<string, {sol: number, poke: number, player: number, ata: string, pda: string}> = {};
        
        // 为当前批次构建请求
        for (const pubkey of batch) {
          let pokeId = -1;
          let playerId = -1;
          let ata = '';
          let pda = '';
          
          // 总是查询 SOL 余额
          const solId = id;
          batchRequest.push(
            { jsonrpc: '2.0', id: solId, method: 'getBalance', params: [pubkey.toBase58(), { commitment: 'confirmed' }] }
          );
          id += 1;
          
          // 如果有 token mint，则查询 Poke 余额和玩家数据
          if (config.tokenMint) {
            const tokenMintPubkey = new PublicKey(config.tokenMint);
            ata = (await getAssociatedTokenAddress(tokenMintPubkey, pubkey)).toBase58();
            const pid = config.programId ? new PublicKey(config.programId) : new PublicKey(IDL.address);
            const [playerPda] = PublicKey.findProgramAddressSync([
              Buffer.from('player'),
              pubkey.toBuffer(),
              tokenMintPubkey.toBuffer(),
            ], pid);
            pda = playerPda.toBase58();
            
            pokeId = id;
            playerId = id + 1;
            
            batchRequest.push(
              { jsonrpc: '2.0', id: pokeId, method: 'getTokenAccountBalance', params: [ata, { commitment: 'confirmed' }] },
              { jsonrpc: '2.0', id: playerId, method: 'getAccountInfo', params: [pda, { encoding: 'base64', commitment: 'confirmed' } as { encoding: string; commitment: string }] },
            );
            id += 2;
          }
          
          // 統一 key 生成
          const pubkeyStr = pubkey.toBase58();
          pubkeyToIds[pubkeyStr] = { sol: solId, poke: pokeId, player: playerId, ata, pda };
        }
        
        // 发送当前批次的请求
        const response = await fetch(config.rpcEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchRequest),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const results: unknown[] = await response.json();
        
        // 处理当前批次的结果
        for (const pubkey of batch) {
          const pubkeyStr = pubkey.toBase58();
          const acc = accounts.find(acc => Keypair.fromSecretKey(bs58.decode(acc.secret)).publicKey.toBase58() === pubkeyStr);
          if (!acc) continue;
          
          const ids = pubkeyToIds[pubkeyStr];
          const solResult = results.find((r: unknown) => (r as { id: number }).id === ids.sol) as { result?: { value: number } } | undefined;
          const solLamports = solResult?.result?.value ?? 0;
          
          let pokeBalance = 0;
          let playerData = null;
          
          // 如果有 token mint，解析 Poke 余额和玩家数据
          if (config.tokenMint && ids.poke > 0 && ids.player > 0) {
            const pokeResult = results.find((r: unknown) => (r as { id: number }).id === ids.poke) as { result?: { value?: { uiAmount: number } } } | undefined;
            pokeBalance = pokeResult?.result?.value?.uiAmount ?? 0;
            
            const playerResult = results.find((r: unknown) => (r as { id: number }).id === ids.player) as { error?: unknown; result?: { value?: { data: string[] } } } | undefined;
            if (playerResult && !playerResult.error && playerResult.result?.value?.data) {
              const accountData = Buffer.from(playerResult.result.value.data[0], 'base64');
              playerData = parsePlayerBuffer(accountData);
            }
          }
          // 統一 key 生成
          const tokenMintKey = config.tokenMint ? config.tokenMint : 'none';
          queryClient.setQueryData([
            'accountBatch',
            pubkeyStr,
            tokenMintKey,
            config.rpcEndpoint
          ], { solLamports, pokeBalance, playerData });
        }
        
        // 批次间延迟（除了最后一批）- 为 QuickNode 增加更长的延迟
        if (batchIndex < batches.length - 1) {
          const delayTime = Math.max(rateLimit.delayMs, 1000); // 至少1秒延迟
          await delay(delayTime);
        }
      }
      
      // 在全部刷新時也更新 start slot 倒數計時
      if (config.tokenMint) {
        try {
          const connection = new (await import('@solana/web3.js')).Connection(config.rpcEndpoint, 'confirmed');
          const client = new PonzimonClient(connection, config.programId ? new PublicKey(config.programId) : new PublicKey(IDL.address));
          const globalState = await client.getGlobalState(new PublicKey(config.tokenMint));
          
          if (globalState && globalState.start_slot) {
            const currentSlot = Date.now() / 400;
            const startSlot = Number(globalState.start_slot);
            const remainingSlots = Math.max(0, startSlot - currentSlot);
            
            if (remainingSlots > 0) {
              const remainingMs = remainingSlots * 400;
              const hours = Math.floor(remainingMs / (1000 * 60 * 60));
              const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
              const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

              if (hours > 0) {
                setClaimTimeRemaining(`Claim 開放倒數: ${hours}時${minutes}分`);
              } else if (minutes > 0) {
                setClaimTimeRemaining(`Claim 開放倒數: ${minutes}分${seconds}秒`);
              } else {
                setClaimTimeRemaining(`Claim 開放倒數: ${seconds}秒`);
              }
            } else {
              setClaimTimeRemaining('');
            }
          }
        } catch (error) {
          console.warn('Failed to update start slot countdown:', error);
        }
      }
      
      toast(t('all_accounts_refreshed'), 'success');
      setRefreshing(false);
    } catch (error) {
      console.error('全部刷新失敗:', error);
      toast(t('all_accounts_refresh_failed'), 'error');
      setRefreshing(false);
    }
  }, [accounts, config.tokenMint, config.rpcEndpoint, config.programId, toast, t, queryClient]);

  // 初始載入時執行一次批量查詢
  useEffect(() => {
    if (accounts.length > 0) {
      handleGlobalRefresh();
    }
  }, [accounts.length, refreshInterval, config.rpcEndpoint, handleGlobalRefresh]); // 只在關鍵依賴變化時執行

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (refreshInterval > 0 && accounts.length > 0) {
      intervalRef.current = setInterval(() => {
        handleGlobalRefresh();
      }, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshInterval, config.rpcEndpoint, accounts.length, handleGlobalRefresh]);

  // 一鍵新增新錢包
  const handleAddNewWallet = () => {
    const keypair = Keypair.generate();
    const name = keypair.publicKey.toBase58();
    const secret = bs58.encode(keypair.secretKey);
    addAccount({ name, secret });
    toast(t('new_wallet_added').replace('{name}', name), 'success');
    setWalletModalOpen(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-8 bg-gray-900 text-white">
      <div className="w-full max-w-7xl mx-auto">
        <header className="mb-8 flex flex-col items-start justify-between">
          <div className="w-full flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold">{t('title')}</h1>
              <RpcStatus />
            </div>
            <div className="flex gap-2 items-center">
              {/* 語言切換下拉選單 */}
              <select
                value={locale}
                onChange={e => setLocale(e.target.value as Locale)}
                className="bg-gray-700 text-white rounded px-2 py-1"
                title={t('switch_language')}
              >
                <option value="zh-TW">繁中</option>
                <option value="zh-CN">简中</option>
                <option value="en">English</option>
              </select>
              <button
                onClick={handleGlobalRefresh}
                className={`bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center ${refreshing ? 'opacity-60 cursor-not-allowed' : ''}`}
                disabled={refreshing}
                title={t('refresh')}
              >
                {refreshing ? (
                  <span className="animate-spin mr-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                ) : (
                  '🔄'
                )}
                {t('refresh')}
              </button>
              <button
                onClick={() => setLogsModalOpen(true)}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-md"
                disabled={false}
                title={t('logs')}
              >
                📋 {t('logs')}
              </button>
              <button
                onClick={() => setRpcOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md"
                disabled={false}
              >
                RPC
              </button>
            </div>
          </div>
          <div className="mt-3 mb-2 px-4 py-2 bg-amber-100/10 border border-amber-300/30 rounded text-amber-200 text-sm max-w-2xl">
            <span className="font-bold">{t('security_note')}</span>{t('security_detail')}
            <div className="mt-2 flex gap-4 items-center justify-end w-full">
              <a
                href="https://www.ponzimon.com?referral=4Qhw3wgchX2CtH9ZjfCWfxynbgN7Ee86BAenKwKrhg5Z"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-300 hover:text-blue-400 underline"
                title={t('ponzimon_website')}
              >
                <svg width="18" height="18" fill="currentColor" className="inline-block" viewBox="0 0 24 24">
                  <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.11-.75.41-1.27.74-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.27 5.7.42.36.79 1.09.79 2.2 0 1.59-.01 2.87-.01 3.26 0 .31.21.68.8.56C20.71 21.39 24 17.08 24 12c0-6.27-5.23-11.5-12-11.5z"/>
                </svg>
                {t('ponzimon_website')}
              </a>
              <a
                href="https://github.com/cioufong/ponzimon-web-lite"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-300 hover:text-blue-400 underline"
                title={t('github')}
              >
                <svg width="18" height="18" fill="currentColor" className="inline-block" viewBox="0 0 24 24">
                  <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.11-.75.41-1.27.74-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.27 5.7.42.36.79 1.09.79 2.2 0 1.59-.01 2.87-.01 3.26 0 .31.21.68.8.56C20.71 21.39 24 17.08 24 12c0-6.27-5.23-11.5-12-11.5z"/>
                </svg>
                {t('github')}
              </a>
              <a
                href="https://x.com/0xTisane"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-neutral-300 hover:text-black underline"
                title={t('x')}
              >
                {/* X (Twitter) 標誌 */}
                <svg width="18" height="18" fill="currentColor" className="inline-block" viewBox="0 0 24 24">
                  <path d="M17.53 3H21.5l-7.06 8.06L22.5 21h-7.5l-5.2-6.18L3.5 21H-.5l7.67-8.76L1.5 3h7.5l4.7 5.58L17.53 3zm-2.13 15h2.13l-5.98-7.1-1.5 1.72L15.4 18zm-8.93 0h2.13l2.1-2.4-2.1-2.42-2.13 2.42 2.1 2.4zm1.5-13H5.87l5.98 7.1 1.5-1.72L8.1 5zm8.93 0h-2.13l-2.1 2.4 2.1 2.42 2.13-2.42-2.1-2.4z"/>
                </svg>
                {t('x')}
              </a>
            </div>
          </div>
          {/* 單錢包操作與錢包設定區塊（保留） */}
          <div className="w-full flex flex-wrap gap-2 mt-4 items-center bg-gray-800 border border-gray-600 p-4 rounded-lg">
            {/* 新增錢包按鈕 */}
            <div className="flex gap-2 items-center bg-gray-700 border border-gray-500 p-2 rounded">
              <button
                onClick={() => setWalletModalOpen(true)}
                className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-md"
                disabled={false}
                title={t('add_wallet')}
              >
                ➕ {t('add_wallet')}
              </button>
            </div>
            {/* 抽卡價格顯示區塊 */}
            {config.tokenMint && (
              <>
                <div className="flex items-center gap-2 bg-gray-700 border border-green-500 p-2 rounded my-1">
                  <span className="text-xs text-green-300">{t('farm_init_cost')}：</span>
                  <span className="font-mono text-base text-green-200">{farmInitCost !== null ? `${farmInitCost} SOL` : t('loading')}</span>
                </div>
                <div className="flex items-center gap-2 bg-gray-700 border border-yellow-500 p-2 rounded my-1">
                  <span className="text-xs text-yellow-300">{t('booster_cost')}：</span>
                  <span className="font-mono text-base text-yellow-200">{boosterCost !== null ? `${boosterCost} PONZI` : t('loading')}</span>
                  {claimTimeRemaining && (
                    <span className="text-xs text-yellow-400 font-medium animate-pulse ml-auto">
                      {claimTimeRemaining}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {addingWallet && (
            <AddWalletCard
              onCancel={() => setAddingWallet(false)}
              onSaved={() => setAddingWallet(false)}
            />
          )}
          {accounts
            .filter((acc) => acc.secret)
            .map((acc) => {
              // const pubkeyStr = Keypair.fromSecretKey(bs58.decode(acc.secret)).publicKey.toBase58();
              return (
                <PlayerCard
                  key={acc.secret}
                  account={acc}
                  tokenMint={config.tokenMint}
                  isInitializing={false}
                />
              );
            })}
        </div>
        <Modal open={rpcOpen} onClose={() => setRpcOpen(false)} title="RPC Settings">
          <RpcSettings onClose={() => setRpcOpen(false)} />
        </Modal>
        
        {/* 全域日誌管理 Modal */}
        <Modal open={logsModalOpen} onClose={() => setLogsModalOpen(false)} title={t('global_log_manage')} maxWidth="max-w-6xl">
          <div className="flex flex-col h-96 max-h-[80vh] w-full max-w-4xl">
            <div className="flex justify-between items-center mb-4 p-2 bg-gray-700 rounded">
              <span className="text-sm text-gray-300">
                {t('log_wallet_count').replace('{count}', String(Object.keys(logsMap).length))}
                {t('log_count').replace('{count}', String(Object.values(logsMap).reduce((total, logs) => total + (Array.isArray(logs) ? logs.length : 0), 0)))}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    clearAllLogs();
                    toast(t('all_logs_cleared'), 'success');
                  }}
                  className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                >
                  {t('clear_all_logs')}
                </button>
                <button
                  onClick={() => {
                    const allLogsText = Object.entries(logsMap)
                      .map(([pubkey, logs]) => {
                        if (!Array.isArray(logs)) return '';
                        return `${pubkey}:\n${logs.map(l => l.url ? `${l.text} ${l.url}` : l.text).join('\n')}`;
                      })
                      .filter(text => text)
                      .join('\n\n');
                    navigator.clipboard.writeText(allLogsText);
                    toast(t('all_logs_copied'), 'success');
                  }}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  {t('copy_all_logs')}
                </button>
              </div>
            </div>
            
            {/* 日誌列表 */}
            <div className="flex-1 overflow-auto">
              {Object.keys(logsMap).length === 0 ? (
                <div className="text-gray-500 text-center py-8">{t('no_logs')}</div>
              ) : (
                Object.entries(logsMap).map(([pubkey, logs]) => (
                  <div key={pubkey} className="mb-4 p-3 bg-gray-800 rounded border border-gray-700">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-mono text-gray-300">
                        {pubkey.slice(0, 8)}...{pubkey.slice(-8)} ({Array.isArray(logs) ? logs.length : 0} 條日誌)
                      </span>
                      <button
                        onClick={() => {
                          if (Array.isArray(logs)) {
                            const logText = logs.map(l => l.url ? `${l.text} ${l.url}` : l.text).join('\n');
                            navigator.clipboard.writeText(logText);
                            toast(t('logs_copied'), 'success');
                          }
                        }}
                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                        disabled={!Array.isArray(logs)}
                      >
                        {t('copy_logs')}
                      </button>
                    </div>
                    <div className="text-xs max-h-32 overflow-auto space-y-1 font-mono">
                      {Array.isArray(logs) ? logs.slice(-5).map((log, i) => (
                        <div key={i} className="flex gap-1 break-all">
                          <span className="text-gray-400">{log.text}</span>
                          {log.url && (
                            <a href={log.url} target="_blank" rel="noreferrer" className="underline text-blue-400">↗</a>
                          )}
                        </div>
                      )) : (
                        <div className="text-gray-500 text-center py-1">{t('invalid_log_format')}</div>
                      )}
                      {Array.isArray(logs) && logs.length > 5 && (
                        <div className="text-gray-500 text-center py-1">
                          {t('more_logs').replace('{count}', String(logs.length - 5))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
        
        <Modal open={walletModalOpen} onClose={() => { setWalletModalOpen(false); setShowAddWalletCard(false); }} title={t('add_wallet')}>
          {!showAddWalletCard ? (
            <div className="flex flex-col gap-4 p-4">
              <button
                onClick={handleAddNewWallet}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded"
              >
                ➕ {t('auto_generate')}
              </button>
              <button
                onClick={() => setShowAddWalletCard(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded"
              >
                🔑 {t('manual_import')}
              </button>
            </div>
          ) : (
            <AddWalletCard
              onCancel={() => { setShowAddWalletCard(false); setWalletModalOpen(false); }}
              onSaved={() => { setShowAddWalletCard(false); setWalletModalOpen(false); }}
            />
          )}
        </Modal>
      </div>
    </main>
  );
}

export default function HomePageWrapper() {
  return (
    <I18nProvider>
      <Home />
    </I18nProvider>
  );
}
