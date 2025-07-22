'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PublicKey, Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useMemo } from 'react';
import { useAppStore, Account } from '@/store';
import { PonzimonClient } from '@/lib/ponzimon-client';
import { parsePlayerBuffer, Card } from '@/lib/utils/player';
import { useEffect } from 'react';
import bs58 from 'bs58';

import { IDL } from '@/lib/idl/ponzimon';
import { useToastStore } from '@/store/toast';
import { useLogStore } from '@/store/log';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import Modal from '@/components/Modal';
import { FaGem } from 'react-icons/fa';
import { FaCheckSquare } from 'react-icons/fa';
import { FaLock } from 'react-icons/fa';
import { FaBolt } from 'react-icons/fa';
import { FaRecycle } from 'react-icons/fa';
import { FaGift } from 'react-icons/fa';
import { FaCheck } from 'react-icons/fa';
import { getPonzimonFriendlyError } from '@/lib/utils/errors';
import { PROGRAM_ID } from '@/store';

interface Props {
  account: Account;
  tokenMint?: string;
  isInitializing?: boolean;
}

// 定義 PendingAction 型別
interface PendingActionBooster {
  type: 'Booster';
}
interface PendingActionRecycle {
  type: 'Recycle';
  card_indices: number[];
  card_count: number;
}
type PendingAction = PendingActionBooster | PendingActionRecycle | { type: string };

const PlayerCard = ({ account, tokenMint, isInitializing = false }: Props) => {
  const keypair = useMemo(() => Keypair.fromSecretKey(bs58.decode(account.secret)), [account.secret]);
  const toast = useToastStore((s) => s.add);
  const addLog = useLogStore((s)=>s.add);
  const clearLog = useLogStore((s)=>s.clear);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const logsMap = useLogStore(s => s.logs);
  const logs = logsMap[keypair.publicKey.toBase58()] ?? [];
  const [logOpen,setLogOpen]=useState(false);
  const { config } = useAppStore();
  // 合併查詢：SOL、Poke、玩家資料，一次 batch RPC
  const pubkeyStr = keypair.publicKey.toBase58();
  const tokenMintKey = tokenMint ? tokenMint : 'none';
  const { data: accountData, refetch } = useQuery({
    queryKey: ['accountBatch', pubkeyStr, tokenMintKey, config.rpcEndpoint],
    queryFn: async () => {
      // 使用限流机制
      const { rpcRateLimiter } = await import('@/lib/utils/rate-limiter');
      rpcRateLimiter.updateFromStore();
      
      // 总是查询 SOL 余额
      const batchRequest = [
        {
          jsonrpc: '2.0', id: 1, method: 'getBalance', params: [keypair.publicKey.toBase58(), { commitment: 'confirmed' }]
        }
      ];
      
      let pokeBalance = 0;
      let playerData = null;
      
      // 如果有 token mint，则查询 Poke 余额和玩家数据
      if (tokenMint) {
        const pid = PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address);
        const [pda] = PublicKey.findProgramAddressSync([
          Buffer.from('player'),
          keypair.publicKey.toBuffer(),
          new PublicKey(tokenMint).toBuffer(),
        ], pid);
        const ata = await getAssociatedTokenAddress(new PublicKey(tokenMint), keypair.publicKey);
        
        batchRequest.push(
          {
            jsonrpc: '2.0', id: 2, method: 'getTokenAccountBalance', params: [ata.toBase58(), { commitment: 'confirmed' }]
          },
          {
            jsonrpc: '2.0', id: 3, method: 'getAccountInfo', params: [pda.toBase58(), { encoding: 'base64', commitment: 'confirmed' } as { encoding: string; commitment: string }]
          }
        );
      }
      
      const response = await fetch(config.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchRequest),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const results = await response.json();
      
      // 解析 SOL 余额（总是有）
      const solResult = results.find((r: unknown) => (r as { id: number }).id === 1) as { result?: { value: number } } | undefined;
      const solLamports = solResult?.result?.value ?? 0;
      
      // 如果有 token mint，解析 Poke 余额和玩家数据
      if (tokenMint) {
        const pokeResult = results.find((r: unknown) => (r as { id: number }).id === 2) as { result?: { value?: { uiAmount: number } } } | undefined;
        pokeBalance = pokeResult?.result?.value?.uiAmount ?? 0;
        
        const playerResult = results.find((r: unknown) => (r as { id: number }).id === 3) as { error?: unknown; result?: { value?: { data: string[] } } } | undefined;
        if (playerResult && !playerResult.error && playerResult.result?.value?.data) {
          const accountData = Buffer.from(playerResult.result.value.data[0], 'base64');
          playerData = parsePlayerBuffer(accountData);
        }
      }
      
      return { solLamports, pokeBalance, playerData };
    },
    refetchInterval: false, // 由主頁統一控制自動刷新
    enabled: false, // 禁用自動執行，由主頁統一控制
  });

  // UI 資料
  const solLamports = accountData?.solLamports ?? 0;
  const pokeBalance = accountData?.pokeBalance ?? 0;
  const playerData = accountData?.playerData ?? null;

  // 刷新函數 - 避免重複 RPC 請求
  const refetchSol = refetch;
  const refetchPoke = refetch; // 直接使用 balances 查詢，避免重複請求
  
  // 統一刷新所有相關查詢的函數
  const refreshAllQueries = () => {
    refetch();
  };

  useEffect(() => {
    if (playerData) {
      console.log('PlayerData', keypair.publicKey.toBase58(), playerData);
    }
  }, [playerData, keypair.publicKey]);

  // 固定推薦人地址
  const DEFAULT_REFERRER = '4Qhw3wgchX2CtH9ZjfCWfxynbgN7Ee86BAenKwKrhg5Z';

  const handlePurchaseFarm = async () => {
    if (!tokenMint) return;
    setPurchaseLoading(true);
    const connection = new Connection(config.rpcEndpoint, 'confirmed');
    const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));

    // 使用 referrerInput（若合法），否則 fallback 用 DEFAULT_REFERRER
    let referrerWallet: PublicKey | undefined;
    try {
      referrerWallet = new PublicKey(referrerInput && referrerInput.trim() ? referrerInput.trim() : DEFAULT_REFERRER);
    } catch {
      referrerWallet = new PublicKey(DEFAULT_REFERRER);
    }

    try {
      const sig = await client.purchaseInitialFarm(keypair, new PublicKey(tokenMint), referrerWallet);
      const url=`https://solscan.io/tx/${sig}`;
      toast(`Purchase success: ${sig.slice(0,8)}...`, 'success');
      addLog(keypair.publicKey.toBase58(), `Purchase success ${sig}`, url);
      // 等待1秒再刷新
      await new Promise(res => setTimeout(res, 1000));
      refreshAccountQueries();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast(`Purchase failed: ${errorMessage}`,'error');
      addLog(keypair.publicKey.toBase58(),`Purchase failed ${errorMessage}`);
    } finally {
      setPurchaseLoading(false);
    }
  };

  const [claimLoading, setClaimLoading] = useState(false);

  const handleClaimRewards = async () => {
    if (!tokenMint) return;
    setClaimLoading(true);
    const connection = new Connection(config.rpcEndpoint, 'confirmed');
    const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
    try {
      const sig = await client.claimRewards(keypair, new PublicKey(tokenMint));
      // 確認交易並解析實際領取數量
      await connection.confirmTransaction(sig, 'confirmed');

      const parsedTx = await connection.getParsedTransaction(sig, { commitment: 'confirmed' });
      let claimedAmount = 0;
      if (parsedTx && parsedTx.meta) {
        const pre = parsedTx.meta.preTokenBalances?.find((b: { mint: string }) => b.mint === tokenMint);
        const post = parsedTx.meta.postTokenBalances?.find((b: { mint: string }) => b.mint === tokenMint);
        if (pre && post) {
          const decimals = post.uiTokenAmount.decimals;
          const preAmt = Number(pre.uiTokenAmount.amount) / Math.pow(10, decimals);
          const postAmt = Number(post.uiTokenAmount.amount) / Math.pow(10, decimals);
          const difference = postAmt - preAmt;
          // 使用絕對值，避免負號但保留實際數量
          claimedAmount = Math.abs(Number(difference.toFixed(decimals)));
        }
      }

      const url=`https://solscan.io/tx/${sig}`;
      toast(`Claimed ${claimedAmount} $Poke (tx: ${sig.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `Claimed ${claimedAmount} $Poke tx:${sig}`, url);
      
      // 立即重新查詢該帳號的資料
      refreshAllQueries();
    } catch(err: unknown){
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      toast(`Claim failed: ${errorMessage}`,'error');
      addLog(keypair.publicKey.toBase58(),`Claim failed ${errorMessage}`);
    } finally {
      setClaimLoading(false);
    }
  };

  const rarityText = [
    '普通',      // 0 Common
    '不常見',    // 1 Uncommon
    '稀有',      // 2 Rare
    '雙倍稀有',  // 3 Double Rare
    '非常稀有',  // 4 Very Rare
    '超級稀有',  // 5 Super Rare
    '終極稀有',  // 6 Mega Rare
  ];
  const rarityIcon = [
    null, // 0 普通
    null, // 1 不常見
    <FaGem key="rare" className="inline text-blue-400 ml-1" />,        // 2 稀有
    <FaGem key="double-rare" className="inline text-yellow-600 ml-1" />, // 3 雙倍稀有
    <FaGem key="very-rare" className="inline text-purple-500 ml-1" />,  // 4 非常稀有
    <FaGem key="super-rare" className="inline text-black ml-1" />,      // 5 超級稀有
    <FaGem key="mega-rare" className="inline text-red-600 ml-1" />,     // 6 終極稀有
  ];
  // 稀有度顏色（七種，建議色彩分明）
  const rarityColor = [
    'text-gray-500',      // 普通
    'text-green-500',     // 不常見
    'text-blue-500',      // 稀有
    'text-yellow-600',    // 雙倍稀有
    'text-purple-500',    // 非常稀有
    'text-black',         // 超級稀有
    'text-red-600',       // 終極稀有
  ];

  const [stakeLoading, setStakeLoading] = useState<number | null>(null);
  const [unstakeLoading, setUnstakeLoading] = useState<number | null>(null);
  const [boosterLoading, setBoosterLoading] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [selectedCardsForRecycle, setSelectedCardsForRecycle] = useState<number[]>([]);
  // referrerInput 初始值設為 DEFAULT_REFERRER
  const [referrerInput, setReferrerInput] = useState<string>(DEFAULT_REFERRER);
  const [lastBoosterTime, setLastBoosterTime] = useState(0);
  // 樂觀 UI 狀態
  const [optimisticStaked, setOptimisticStaked] = useState<Record<number, boolean>>({});
  const [optimisticTimestamp, setOptimisticTimestamp] = useState<Record<number, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  // 刷新該帳號所有相關查詢，並立即 refetch
  const refreshAccountQueries = () => {
    refreshAllQueries();
  };

  // 當鏈上資料刷新時自動同步樂觀狀態
  useEffect(() => {
    // 樂觀狀態最少顯示 1500ms
    const keys = Object.keys(optimisticStaked);
    if (keys.length === 0) return;
    let cleared = false;
    keys.forEach((idx) => {
      const elapsed = Date.now() - (optimisticTimestamp[Number(idx)] || 0);
      if (elapsed < 1500) {
        setTimeout(() => {
          if (!cleared) {
            setOptimisticStaked({});
            setOptimisticTimestamp({});
            cleared = true;
          }
        }, 1500 - elapsed);
      } else {
        setOptimisticStaked({});
        setOptimisticTimestamp({});
        cleared = true;
      }
    });
  }, [optimisticStaked, optimisticTimestamp]);

  // 抽卡功能
  const handleOpenBooster = async () => {
    // 防抖檢查：防止快速點擊
    const now = Date.now();
    if (now - lastBoosterTime < 5000) { // 5秒內只能點擊一次
      toast('請等待 5 秒後再嘗試抽卡', 'info');
      return;
    }
    setLastBoosterTime(now);
    
    setBoosterLoading(true);
    try {
      if (!tokenMint || !playerData) throw new Error('tokenMint or playerData is undefined');
      const connection = new Connection(config.rpcEndpoint, 'confirmed');
      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
      
      // 先嘗試結算任何待處理的抽卡請求
      try {
        console.log('嘗試結算待處理的抽卡請求...');
        const settleSig = await client.settleOpenBooster(keypair, new PublicKey(tokenMint));
        console.log('結算成功，簽名:', settleSig);
        const settleUrl = `https://solscan.io/tx/${settleSig}`;
        toast(`結算待處理請求成功 (tx: ${settleSig.slice(0,8)}...)`, 'success');
        addLog(keypair.publicKey.toBase58(), `結算待處理請求成功 ${settleSig}`, settleUrl);
        // 等待更長時間讓狀態更新
        await new Promise(res => setTimeout(res, 3000));
        // 強制刷新資料
        refreshAllQueries();
        console.log('資料已刷新');
      } catch (settleErr: unknown) {
        const settleErrorMsg = settleErr instanceof Error ? settleErr.message : String(settleErr);
        console.log('結算待處理請求結果:', settleErrorMsg);
        // 如果不是 "no pending action" 錯誤，則記錄
        if (!settleErrorMsg.includes('no pending action') && !settleErrorMsg.includes('0x1791')) {
          console.log('結算待處理請求失敗（可能是正常的）:', settleErrorMsg);
        }
      }
      
      // 再次檢查是否有待處理的請求
      console.log('檢查是否還有待處理的請求...');
      
      // 取得 fees_wallet ATA
      const programIdPK = PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address);
      const tokenMintPK = new PublicKey(tokenMint);
      const feesWallet = await PonzimonClient.getFeesWallet(connection, programIdPK, tokenMintPK);
      const feesTokenAta = await getAssociatedTokenAddress(tokenMintPK, feesWallet);
      
      // 決定 referrerTokenAta：有推薦人就用推薦人，否則用自己
      let referrerTokenAta: PublicKey;
      if (playerData.referrer) {
        try {
          const refPubkey = new PublicKey(playerData.referrer);
          referrerTokenAta = await getAssociatedTokenAddress(tokenMintPK, refPubkey);
          // 檢查推薦人 token account 是否存在且有效
          const { rpcRateLimiter } = await import('@/lib/utils/rate-limiter');
          rpcRateLimiter.updateFromStore();
          const accountInfo = await rpcRateLimiter.execute(() => connection.getAccountInfo(referrerTokenAta));
          if (!accountInfo || accountInfo.data.length < 72) {
            // 無效就 fallback
            console.log('推薦人 token account 無效，改用自己');
            referrerTokenAta = await getAssociatedTokenAddress(tokenMintPK, keypair.publicKey);
          } else {
            // 檢查 mint 是否正確
            const mintBytes = accountInfo.data.slice(0, 32);
            const accountMint = new PublicKey(mintBytes);
            if (!accountMint.equals(tokenMintPK)) {
              console.log('推薦人 token account mint 不符，改用自己');
              referrerTokenAta = await getAssociatedTokenAddress(tokenMintPK, keypair.publicKey);
            } else {
              console.log('使用推薦人:', playerData.referrer);
            }
          }
        } catch {
          // 解析失敗也 fallback
          console.log('推薦人地址解析失敗，改用自己');
          referrerTokenAta = await getAssociatedTokenAddress(tokenMintPK, keypair.publicKey);
        }
      } else {
        // 沒有推薦人直接用自己
        referrerTokenAta = await getAssociatedTokenAddress(tokenMintPK, keypair.publicKey);
        console.log('沒有推薦人，使用自己');
      }
      
      console.log('referrerTokenAta:', referrerTokenAta.toBase58());
      
      console.log('開始新的抽卡流程...');
      // commit
      const sig1 = await client.openBoosterCommit(keypair, new PublicKey(tokenMint), feesTokenAta, referrerTokenAta);
      console.log('Commit 成功，簽名:', sig1);
      const commitUrl = `https://solscan.io/tx/${sig1}`;
      toast(`抽卡請求已送出 (tx: ${sig1.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `抽卡請求已送出 ${sig1}`, commitUrl);
      // 等待 2 秒再 settle
      await new Promise(res => setTimeout(res, 3000));
      const sig2 = await client.settleOpenBooster(keypair, new PublicKey(tokenMint));
      console.log('Settle 成功，簽名:', sig2);
      const settleUrl = `https://solscan.io/tx/${sig2}`;
      toast(`抽卡結算成功 (tx: ${sig2.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `抽卡結算成功 ${sig2}`, settleUrl);
      await new Promise(res => setTimeout(res, 1000));
      refreshAccountQueries();
    } catch (err: unknown) {
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      toast(`抽卡失敗: ${errorMessage}`, 'error');
      addLog(keypair.publicKey.toBase58(), `抽卡失敗: ${errorMessage}`);

      // --- 自動偵測「已有待處理的抽卡/回收請求」錯誤，自動重置 pending action 並重試一次 ---
      const shouldResetPending =
        errorMessage.includes('已有待處理的抽卡請求') ||
        errorMessage.includes('已有待處理的回收請求');
      if (shouldResetPending && !(err as { __alreadyRetried?: boolean })?.__alreadyRetried) {
        try {
          toast('偵測到待處理請求，正在自動重置...','info');
          const connection = new Connection(config.rpcEndpoint, 'confirmed');
          const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
          if (!tokenMint) throw new Error('tokenMint is required');
          await client.cancelPendingAction(keypair, new PublicKey(tokenMint));
          await new Promise(resolve => setTimeout(resolve, 5000));
          refreshAccountQueries();
          // 標記已重試，避免無限循環
          (err as { __alreadyRetried?: boolean }).__alreadyRetried = true;
          // 再次嘗試抽卡
          await handleOpenBooster();
          return;
        } catch (resetErr: unknown) {
          const resetMsg = getPonzimonFriendlyError(resetErr, resetErr instanceof Error ? resetErr.message : String(resetErr));
          toast(`自動重置 pending action 失敗: ${resetMsg}`, 'error');
          addLog(keypair.publicKey.toBase58(), `自動重置 pending action 失敗: ${resetMsg}`);
        }
      }
    } finally {
      setBoosterLoading(false);
    }
  };

  // 卡片回收功能
  const handleRecycleCards = async () => {
    if (!tokenMint || selectedCardsForRecycle.length === 0) return;
    setRecycleLoading(true);
    
    try {
      const connection = new Connection(config.rpcEndpoint, 'confirmed');
      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
      
      // 先自動結算待處理的隨機請求（抽卡或回收）
      if (playerData && playerData.pendingAction && typeof playerData.pendingAction === 'object') {
        const pendingType = (playerData.pendingAction as PendingAction).type;
        if (pendingType === 'Recycle') {
          try {
            toast('偵測到有待結算的回收，正在自動結算...','info');
            const settleSig = await client.recycleCardsSettle(keypair, new PublicKey(tokenMint));
            console.log('自動結算回收成功:', settleSig);
            await new Promise(resolve => setTimeout(resolve, 3000));
            refreshAccountQueries();
          } catch (autoSettleErr: unknown) {
            console.log('自動結算回收失敗:', autoSettleErr);
            const errorMessage = getPonzimonFriendlyError(autoSettleErr, autoSettleErr instanceof Error ? autoSettleErr.message : String(autoSettleErr));
            toast(`自動結算回收失敗: ${errorMessage}`, 'error');
            addLog(keypair.publicKey.toBase58(), `自動結算回收失敗: ${errorMessage}`);
            setRecycleLoading(false);
            return;
          }
        } else if (pendingType === 'Booster') {
          try {
            toast('偵測到有待結算的抽卡，正在自動結算...','info');
            const settleSig = await client.settleOpenBooster(keypair, new PublicKey(tokenMint));
            console.log('自動結算抽卡成功:', settleSig);
            await new Promise(resolve => setTimeout(resolve, 3000));
            refreshAccountQueries();
          } catch (autoSettleErr: unknown) {
            console.log('自動結算抽卡失敗:', autoSettleErr);
            const errorMessage = getPonzimonFriendlyError(autoSettleErr, autoSettleErr instanceof Error ? autoSettleErr.message : String(autoSettleErr));
            toast(`自動結算抽卡失敗: ${errorMessage}`, 'error');
            addLog(keypair.publicKey.toBase58(), `自動結算抽卡失敗: ${errorMessage}`);
            setRecycleLoading(false);
            return;
          }
        }
        // --- 自動結算後，強制等待並重查 playerData 狀態 ---
        let retries = 0;
        while (retries < 5) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          refreshAccountQueries();
          // 這裡不再宣告未使用的 latestPlayerData 變數
          if (!playerData.pendingAction || (playerData.pendingAction as PendingAction).type === 'None') {
            break;
          }
          retries++;
        }
        if (playerData.pendingAction && (playerData.pendingAction as PendingAction).type !== 'None') {
          toast('鏈上狀態同步中，請稍後再試', 'info');
          setRecycleLoading(false);
          return;
        }
      }
      
      console.log(`準備回收卡片: ${selectedCardsForRecycle.join(', ')}...`);
      
      // 第一步：提交回收請求
      const commitSig = await client.recycleCardsCommit(keypair, new PublicKey(tokenMint), selectedCardsForRecycle);
      console.log('回收提交成功:', commitSig);
      
      // 等待一下讓交易確認
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 第二步：結算回收請求
      const settleSig = await client.recycleCardsSettle(keypair, new PublicKey(tokenMint));
      console.log('回收結算成功:', settleSig);
      
      toast('卡片回收成功!', 'success');
      addLog(keypair.publicKey.toBase58(), `卡片回收成功: ${selectedCardsForRecycle.join(', ')}`);
      
      // 清空選擇的卡片
      setSelectedCardsForRecycle([]);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      // 刷新資料
      refreshAccountQueries();
      
    } catch (err: unknown) {
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      console.log('卡片回收失敗:', errorMessage);
      toast(`卡片回收失敗: ${errorMessage}`, 'error');
      addLog(keypair.publicKey.toBase58(), `卡片回收失敗: ${errorMessage}`);

      // --- 自動偵測「已有待處理的抽卡/回收請求」錯誤，自動重置 pending action 並重試一次 ---
      const shouldResetPending =
        errorMessage.includes('已有待處理的抽卡請求') ||
        errorMessage.includes('已有待處理的回收請求');
      if (shouldResetPending && !(err as { __alreadyRetried?: boolean })?.__alreadyRetried) {
        try {
          toast('偵測到待處理請求，正在自動重置...','info');
          const connection = new Connection(config.rpcEndpoint, 'confirmed');
          const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
          if (!tokenMint) throw new Error('tokenMint is required');
          await client.cancelPendingAction(keypair, new PublicKey(tokenMint));
          await new Promise(resolve => setTimeout(resolve, 5000));
          refreshAccountQueries();
          // 標記已重試，避免無限循環
          (err as { __alreadyRetried?: boolean }).__alreadyRetried = true;
          // 再次嘗試回收
          await handleRecycleCards();
          return;
        } catch (resetErr: unknown) {
          const resetMsg = getPonzimonFriendlyError(resetErr, resetErr instanceof Error ? resetErr.message : String(resetErr));
          toast(`自動重置 pending action 失敗: ${resetMsg}`, 'error');
          addLog(keypair.publicKey.toBase58(), `自動重置 pending action 失敗: ${resetMsg}`);
        }
      }
    } finally {
      setRecycleLoading(false);
    }
  };

  // 切換卡片選擇狀態
  const toggleCardSelection = (cardIndex: number) => {
    setSelectedCardsForRecycle(prev => 
      prev.includes(cardIndex) 
        ? prev.filter(i => i !== cardIndex)
        : [...prev, cardIndex]
    );
  };

  const [transferTarget, setTransferTarget] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [autoInitLoading, setAutoInitLoading] = useState(false);
  const [batchClaimLoading, setBatchClaimLoading] = useState(false);

  // 快捷填入金額
  const fillAmount = (type: 'all' | 'half' | 'poke') => {
    if (type === 'all') {
      setTransferAmount(((solLamports || 0) / LAMPORTS_PER_SOL - 0.000005).toFixed(4));
    } else if (type === 'half') {
      setTransferAmount((((solLamports || 0) / LAMPORTS_PER_SOL - 0.000005) / 2).toFixed(4));
    } else if (type === 'poke') {
      setTransferAmount((pokeBalance || 0).toFixed(4));
    }
  };

  const handleTransferSOL = async () => {
    if (!transferTarget.trim()) return;
    setTransferLoading(true);
    try {
      const connection = new Connection(config.rpcEndpoint, 'confirmed');
      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
      const amount = parseFloat(transferAmount) || undefined;
      const sig = await client.transferSOL(keypair, new PublicKey(transferTarget.trim()), amount);
      await connection.confirmTransaction(sig, 'confirmed');
      const url = `https://solscan.io/tx/${sig}`;
      toast(`SOL 轉帳成功 (tx: ${sig.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `SOL 轉帳成功 ${sig}`, url);
      setTransferTarget('');
      setTransferAmount('');
      refreshAccountQueries();
    } catch (err: unknown) {
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      toast(`SOL 轉帳失敗: ${errorMessage}`, 'error');
      addLog(keypair.publicKey.toBase58(), `SOL 轉帳失敗: ${errorMessage}`);
    } finally {
      setTransferLoading(false);
    }
  };

  const handleTransferPoke = async () => {
    if (!transferTarget.trim() || !tokenMint) return;
    setTransferLoading(true);
    try {
      const connection = new Connection(config.rpcEndpoint, 'confirmed');
      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
      const amount = parseFloat(transferAmount) || undefined;
      const sig = await client.transferPoke(keypair, new PublicKey(transferTarget.trim()), new PublicKey(tokenMint), amount);
      await connection.confirmTransaction(sig, 'confirmed');
      const url = `https://solscan.io/tx/${sig}`;
      toast(`Poke 轉帳成功 (tx: ${sig.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `Poke 轉帳成功 ${sig}`, url);
      setTransferTarget('');
      setTransferAmount('');
      refreshAccountQueries();
    } catch (err: unknown) {
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      toast(`Poke 轉帳失敗: ${errorMessage}`, 'error');
      addLog(keypair.publicKey.toBase58(), `Poke 轉帳失敗: ${errorMessage}`);
    } finally {
      setTransferLoading(false);
    }
  };

  // 一鍵 Claim 和歸集功能
  const handleBatchClaimAndTransfer = async () => {
    if (!transferTarget.trim() || !tokenMint) {
      toast('請先設定目標地址', 'error');
      return;
    }
    
    setBatchClaimLoading(true);
    try {
      const connection = new Connection(config.rpcEndpoint, 'confirmed');
      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
      const targetAddress = new PublicKey(transferTarget.trim());
      
      // 檢查是否轉給自己
      const isSelfTransfer = targetAddress.equals(keypair.publicKey);
      
      // 步驟1: Claim Rewards
      console.log('步驟1: 領取獎勵...');
      const claimSig = await client.claimRewards(keypair, new PublicKey(tokenMint));
      await connection.confirmTransaction(claimSig, 'confirmed');
      
      // 解析實際領取數量
      const parsedTx = await connection.getParsedTransaction(claimSig, { commitment: 'confirmed' });
      let claimedAmount = 0;
      if (parsedTx && parsedTx.meta) {
        const pre = parsedTx.meta.preTokenBalances?.find((b: { mint: string }) => b.mint === tokenMint);
        const post = parsedTx.meta.postTokenBalances?.find((b: { mint: string }) => b.mint === tokenMint);
        if (pre && post) {
          const decimals = post.uiTokenAmount.decimals;
          const preAmt = Number(pre.uiTokenAmount.amount) / Math.pow(10, decimals);
          const postAmt = Number(post.uiTokenAmount.amount) / Math.pow(10, decimals);
          const difference = postAmt - preAmt;
          // 確保結果為正數，避免負號問題
          claimedAmount = Math.abs(Number(difference.toFixed(decimals)));
        }
      }
      
      const claimUrl = `https://solscan.io/tx/${claimSig}`;
      toast(`獎勵領取成功: ${claimedAmount} $Poke (tx: ${claimSig.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `批量操作 - 獎勵領取成功: ${claimedAmount} $Poke ${claimSig}`, claimUrl);
      
      // 等待一下讓餘額更新
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 步驟2: 檢查是否需要轉帳
      if (!isSelfTransfer) {
        console.log('步驟2: 轉帳到目標地址...');
        const transferSig = await client.transferPoke(keypair, targetAddress, new PublicKey(tokenMint));
        await connection.confirmTransaction(transferSig, 'confirmed');
        
        const transferUrl = `https://solscan.io/tx/${transferSig}`;
        toast(`Poke 歸集成功 (tx: ${transferSig.slice(0,8)}...)`, 'success');
        addLog(keypair.publicKey.toBase58(), `批量操作 - Poke 歸集成功 ${transferSig}`, transferUrl);
      } else {
        console.log('跳過轉帳：目標地址為自己');
        toast('跳過轉帳：目標地址為自己', 'info');
        addLog(keypair.publicKey.toBase58(), '批量操作 - 跳過轉帳：目標地址為自己');
      }
      
      // 清空輸入
      setTransferTarget('');
      setTransferAmount('');
      
      // 等待一下確保鏈上狀態更新
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 刷新所有相關資料
      refreshAccountQueries();
      
      // 手動刷新SOL和Poke餘額
      refetchSol();
      refetchPoke();
      
      toast('批量操作完成！', 'success');
      addLog(keypair.publicKey.toBase58(), '批量操作完成');
      
    } catch (err: unknown) {
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      console.error('批量操作失敗:', errorMessage);
      toast(`批量操作失敗: ${errorMessage}`, 'error');
      addLog(keypair.publicKey.toBase58(), `批量操作失敗: ${errorMessage}`);
    } finally {
      setBatchClaimLoading(false);
    }
  };

  // 自動初始化功能
  const handleAutoInit = async () => {
    if (!tokenMint) return;
    setAutoInitLoading(true);
    try {
      const connection = new Connection(config.rpcEndpoint, 'confirmed');
      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
      // 使用 referrerInput（若合法），否則 fallback 用 DEFAULT_REFERRER
      let referrerWallet: PublicKey | undefined;
      try {
        referrerWallet = new PublicKey(referrerInput && referrerInput.trim() ? referrerInput.trim() : DEFAULT_REFERRER);
      } catch {
        referrerWallet = new PublicKey(DEFAULT_REFERRER);
      }
      const purchaseSig = await client.purchaseInitialFarm(keypair, new PublicKey(tokenMint), referrerWallet);
      console.log('農場購買成功:', purchaseSig);
      const purchaseUrl = `https://solscan.io/tx/${purchaseSig}`;
      toast(`農場購買成功 (tx: ${purchaseSig.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `自動初始化 - 農場購買成功 ${purchaseSig}`, purchaseUrl);
      
      // 等待交易確認並刷新資料
      await connection.confirmTransaction(purchaseSig, 'confirmed');
      refreshAccountQueries();
      
      // 等待一個 slot 以通過冷卻檢查
      await connection.getSlot();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待 2 秒確保 slot 更新
      
      // 重新獲取玩家資料
      const pid = PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address);
      const [pda] = PublicKey.findProgramAddressSync([
        Buffer.from('player'),
        keypair.publicKey.toBuffer(),
        new PublicKey(tokenMint).toBuffer(),
      ], pid);
      const info = await connection.getAccountInfo(pda);
      if (!info || info.data.length === 0) {
        throw new Error('無法獲取玩家資料');
      }
      const playerData = parsePlayerBuffer(info.data);
      
      if (!playerData || playerData.cards.length < 3) {
        throw new Error('玩家卡片數量不足');
      }
      
      // 步驟2: 質押前兩張卡片
      console.log('步驟2: 質押前兩張卡片...');
      for (let i = 0; i < 2; i++) {
        const stakeSig = await client.stakeCard(keypair, new PublicKey(tokenMint), i);
        console.log(`質押卡片 #${i} 成功:`, stakeSig);
        const stakeUrl = `https://solscan.io/tx/${stakeSig}`;
        toast(`質押卡片 #${i} 成功 (tx: ${stakeSig.slice(0,8)}...)`, 'success');
        addLog(keypair.publicKey.toBase58(), `自動初始化 - 質押卡片#${i} 成功 ${stakeSig}`, stakeUrl);
        await connection.confirmTransaction(stakeSig, 'confirmed');
        // 等待一個 slot，避免冷卻未過
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      // 步驟3: 回收第三張卡片
      console.log('步驟3: 回收第三張卡片...');
      const recycleCommitSig = await client.recycleCardsCommit(keypair, new PublicKey(tokenMint), [2]);
      console.log('回收提交成功:', recycleCommitSig);
      const recycleCommitUrl = `https://solscan.io/tx/${recycleCommitSig}`;
      toast(`回收提交成功 (tx: ${recycleCommitSig.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `自動初始化 - 回收提交成功 ${recycleCommitSig}`, recycleCommitUrl);
      
      // 等待回收結算
      await connection.confirmTransaction(recycleCommitSig, 'confirmed');
      
      // 等待隨機性解析完成 (MIN_RANDOMNESS_DELAY_SLOTS = 2)
      await new Promise(resolve => setTimeout(resolve, 5000)); // 等待 5 秒確保隨機性解析
      
      const recycleSettleSig = await client.recycleCardsSettle(keypair, new PublicKey(tokenMint));
      console.log('回收結算成功:', recycleSettleSig);
      const recycleSettleUrl = `https://solscan.io/tx/${recycleSettleSig}`;
      toast(`回收結算成功 (tx: ${recycleSettleSig.slice(0,8)}...)`, 'success');
      addLog(keypair.publicKey.toBase58(), `自動初始化 - 回收結算成功 ${recycleSettleSig}`, recycleSettleUrl);
      
      // 等待回收完成並刷新資料
      await connection.confirmTransaction(recycleSettleSig, 'confirmed');
      refreshAccountQueries();
      
      // 重新獲取玩家資料以檢查是否有新卡片
      const infoAfterRecycle = await connection.getAccountInfo(pda);
      if (!infoAfterRecycle || infoAfterRecycle.data.length === 0) {
        throw new Error('無法獲取回收後的玩家資料');
      }
      const playerDataAfterRecycle = parsePlayerBuffer(infoAfterRecycle.data);
      
      if (!playerDataAfterRecycle) {
        throw new Error('無法解析回收後的玩家資料');
      }
      
      // 步驟4: 檢查是否有卡片升級，如果有則自動替換質押
      if (playerDataAfterRecycle.cards.length >= 3) {
        console.log('步驟4: 檢查卡片升級並重新質押...');
        
        // 解除質押#1
        const unstakeSig = await client.unstakeCard(keypair, new PublicKey(tokenMint), 1);
        console.log('解除質押卡片 #1 成功:', unstakeSig);
        const unstakeUrl = `https://solscan.io/tx/${unstakeSig}`;
        toast(`解除質押卡片 #1 成功 (tx: ${unstakeSig.slice(0,8)}...)`, 'success');
        addLog(keypair.publicKey.toBase58(), `自動初始化 - 解除質押卡片#1 成功 ${unstakeSig}`, unstakeUrl);
        
        await connection.confirmTransaction(unstakeSig, 'confirmed');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // 找出未質押的卡片（排除#0）
        const unstakedCards = playerDataAfterRecycle.cards.map((card, index) => ({ index, berryConsumption: card.berryConsumption }))
          .filter((_, index) => index !== 0);
        
        if (unstakedCards.length > 0) {
          // 按漿果消耗量降序排列，選擇消耗量最高的卡片
          unstakedCards.sort((a, b) => b.berryConsumption - a.berryConsumption);
          const bestCardIndex = unstakedCards[0].index;
          
          const newStakeSig = await client.stakeCard(keypair, new PublicKey(tokenMint), bestCardIndex);
          console.log(`質押漿果消耗量最高卡片 #${bestCardIndex} 成功:`, newStakeSig);
          const newStakeUrl = `https://solscan.io/tx/${newStakeSig}`;
          toast(`質押漿果消耗量最高卡片 #${bestCardIndex} 成功 (tx: ${newStakeSig.slice(0,8)}...)`, 'success');
          addLog(keypair.publicKey.toBase58(), `自動初始化 - 質押漿果消耗量最高卡片#${bestCardIndex} 成功 ${newStakeSig}`, newStakeUrl);
          
          await connection.confirmTransaction(newStakeSig, 'confirmed');
        }
      } else {
        console.log('步驟4: 卡片數量不足，保持當前質押狀態');
        toast('卡片回收完成，但卡片數量不足', 'info');
        addLog(keypair.publicKey.toBase58(), '自動初始化 - 卡片回收完成，但卡片數量不足');
      }
      
      // 最終刷新
      refreshAccountQueries();
      toast('自動初始化完成！', 'success');
      addLog(keypair.publicKey.toBase58(), '自動初始化完成');
      
      // 清空 referrer 輸入
      setReferrerInput('');
      
    } catch (err: unknown) {
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      console.error('自動初始化失敗:', errorMessage);
      toast(`自動初始化失敗: ${errorMessage}`, 'error');
      addLog(keypair.publicKey.toBase58(), `自動初始化失敗: ${errorMessage}`);
    } finally {
      setAutoInitLoading(false);
    }
  };

  // 匯出私鑰功能
  const handleExportSecret = async () => {
    try {
      await navigator.clipboard.writeText(account.secret);
      toast('私鑰已複製到剪貼簿', 'success');
    } catch {
      toast('複製失敗，請手動複製', 'error');
    }
  };

  // 恢復 isCardStaked 函數
  const isCardStaked = (cardIndex: number, stakedBitset: bigint) => {
    return (stakedBitset & (BigInt(1) << BigInt(cardIndex))) !== BigInt(0);
  };

  // 單帳號刷新函數
  const handleSingleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
      toast('帳號資料已刷新', 'success');
    } finally {
      setRefreshing(false);
    }
  };

  // 自動選擇低星等未質押卡片（最多32張）
  const handleAutoSelectForRecycle = () => {
    if (!playerData) return;
    // 取得所有卡片，附帶 originalIndex
    const allCards = playerData.cards.map((card, idx) => ({ ...card, originalIndex: idx }));
    // 過濾未質押且非終極稀有卡片（rarity !== 6）
    const unstakedCards = allCards.filter(card => {
      const staked = optimisticStaked[card.originalIndex] !== undefined
        ? optimisticStaked[card.originalIndex]
        : isCardStaked(card.originalIndex, playerData.stakedCardsBitset);
      return !staked && card.rarity !== 6;
    });
    // 按 rarity 由低到高排序
    unstakedCards.sort((a, b) => a.rarity - b.rarity || a.id - b.id);
    // 取前 32 張
    const selected = unstakedCards.slice(0, 32).map(card => card.originalIndex);
    setSelectedCardsForRecycle(selected);
    toast(`已自動選擇 ${selected.length} 張低星等未質押卡片（不含終極稀有）`, 'success');
  };

  // 自動選擇低星等未質押卡片（最多8張）
  const handleAutoSelect8ForRecycle = () => {
    if (!playerData) return;
    const allCards = playerData.cards.map((card, idx) => ({ ...card, originalIndex: idx }));
    const unstakedCards = allCards.filter(card => {
      const staked = optimisticStaked[card.originalIndex] !== undefined
        ? optimisticStaked[card.originalIndex]
        : isCardStaked(card.originalIndex, playerData.stakedCardsBitset);
      return !staked && card.rarity !== 6;
    });
    unstakedCards.sort((a, b) => a.rarity - b.rarity || a.id - b.id);
    const selected = unstakedCards.slice(0, 8).map(card => card.originalIndex);
    setSelectedCardsForRecycle(selected);
    toast(`已自動選擇 ${selected.length} 張低星等未質押卡片（不含終極稀有）`, 'success');
  };

  // 還原 handleUpgradeFarm 函數
  const handleUpgradeFarm = async () => {
    if (!tokenMint || !playerData) return;
    setUpgradeLoading(true);
    try {
      const connection = new Connection(config.rpcEndpoint, 'confirmed');
      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
      const nextFarmLevel = playerData.farmLevel + 1;
      const sig = await client.upgradeFarm(keypair, new PublicKey(tokenMint), nextFarmLevel);
      toast('農場升級成功!', 'success');
      addLog(keypair.publicKey.toBase58(), `農場升級成功: ${sig}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      refreshAccountQueries();
    } catch (err: unknown) {
      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
      toast(`升級農場失敗: ${errorMessage}`, 'error');
      addLog(keypair.publicKey.toBase58(), `升級農場失敗: ${errorMessage}`);
    } finally {
      setUpgradeLoading(false);
    }
  };

  return (
    <div className="relative bg-gray-800 rounded-lg shadow p-4 border border-gray-700">
      {(autoInitLoading || isInitializing) && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
          <span className="text-white font-bold animate-pulse">初始化中...</span>
        </div>
      )}
      <div className="flex justify-between items-center mb-2 w-full">
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-gray-400 break-all max-w-[60%]">{pubkeyStr}</span>
          <button
            className="ml-1 p-1 rounded hover:bg-gray-700"
            title="複製地址"
            onClick={() => {
              navigator.clipboard.writeText(pubkeyStr);
              toast('地址已複製', 'success');
            }}
            style={{ lineHeight: 1 }}
            disabled={autoInitLoading || isInitializing}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="10" height="10" rx="2" fill="#fff" fillOpacity="0.2" stroke="#ccc"/><rect x="8" y="2" width="10" height="10" rx="2" fill="#fff" fillOpacity="0.1" stroke="#aaa"/></svg>
          </button>
        </div>
        <div className="flex gap-2">
          <button
            className="bg-yellow-500 hover:bg-yellow-600 text-xs text-white px-2 py-1 rounded"
            onClick={handleExportSecret}
            title="匯出私鑰（複製到剪貼簿）"
            style={{ minWidth: 60 }}
            disabled={autoInitLoading || isInitializing}
          >
            🔑匯出
          </button>
          <button
            className="bg-green-600 hover:bg-green-700 text-xs text-white px-2 py-1 rounded font-bold"
            onClick={handleSingleRefresh}
            disabled={refreshing || autoInitLoading || isInitializing}
            title="刷新此帳號資料"
            style={{ minWidth: 60 }}
          >
            {refreshing ? '⏳' : '🔄 刷新'}
          </button>
          <button
            onClick={() => {
              if (window.confirm('確定要刪除此錢包？此操作無法復原，且私鑰若未備份將永久遺失！\n\n同時會清除此錢包的所有日誌記錄。')) {
                // 先清除該錢包的日誌
                clearLog(pubkeyStr);
                // 再刪除錢包
                removeAccount(account.secret);
                toast('錢包已刪除，日誌已清除', 'success');
              }
            }}
            className="bg-red-600 hover:bg-red-700 text-white text-xs px-2 py-1 rounded"
            title="Delete wallet and clear logs"
            style={{ minWidth: 32 }}
            disabled={autoInitLoading || isInitializing}
          >
            ×
          </button>
        </div>
      </div>
      
      {/* 餘額顯示區塊（兩行，分開刷新） */}
      <div className="flex flex-col gap-1 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-200">SOL：</span>
          <span className="font-mono text-base">{solLamports !== undefined && solLamports !== null ? (solLamports / LAMPORTS_PER_SOL).toFixed(4) : '0'}</span>
        </div>
        {tokenMint && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-200">Poke：</span>
          <span className="font-mono text-base">{pokeBalance !== undefined ? pokeBalance.toFixed(4) : '0'}</span>
        </div>
      )}
      </div>

      {/* 轉帳歸集功能 */}
      <div className="my-3 p-3 bg-gray-700 rounded-lg border border-gray-600">
        <h4 className="text-sm font-semibold text-gray-300 mb-2">轉帳歸集</h4>
        <div className="space-y-2">
          <div className="flex flex-col space-y-1">
            <label className="text-xs text-gray-400">目標地址:</label>
            <input
              type="text"
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              placeholder="輸入目標錢包地址..."
              className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              disabled={autoInitLoading || isInitializing}
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-xs text-gray-400">金額（SOL 或 Poke）:</label>
            <div className="flex gap-2 mb-1">
              <input
                type="number"
                min="0"
                step="0.0001"
                value={transferAmount}
                onChange={e => setTransferAmount(e.target.value)}
                placeholder="預設全部"
                className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                disabled={autoInitLoading || isInitializing}
              />
              <button
                className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
                type="button"
                onClick={() => fillAmount('all')}
                disabled={autoInitLoading || isInitializing}
              >全部</button>
              <button
                className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
                type="button"
                onClick={() => fillAmount('half')}
                disabled={autoInitLoading || isInitializing}
              >50%</button>
              <button
                className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
                type="button"
                onClick={() => fillAmount('poke')}
                disabled={!tokenMint || autoInitLoading || isInitializing}
              >全部Poke</button>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 rounded font-medium flex items-center justify-center"
              onClick={handleTransferSOL}
              disabled={transferLoading || !transferTarget.trim() || autoInitLoading || isInitializing}
            >
              {transferLoading ? (
                <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full mr-1"></span>
              ) : (
                <span>轉 SOL</span>
              )}
            </button>
            <button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs py-2 rounded font-medium flex items-center justify-center"
              onClick={handleTransferPoke}
              disabled={transferLoading || !transferTarget.trim() || !tokenMint || autoInitLoading || isInitializing}
            >
              {transferLoading ? (
                <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full mr-1"></span>
              ) : (
                <span>轉 Poke</span>
              )}
            </button>
          </div>
          
          {/* 一鍵 Claim 和歸集按鈕 */}
          <div className="mt-2">
            <button
              className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white text-xs py-2 rounded font-medium flex items-center justify-center gap-2"
              onClick={handleBatchClaimAndTransfer}
              disabled={batchClaimLoading || !transferTarget.trim() || !tokenMint || autoInitLoading || isInitializing}
              title="一鍵領取獎勵並歸集到目標地址（如果是自己則跳過轉帳）"
            >
              {batchClaimLoading ? (
                <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span>
              ) : (
                <span>🚀</span>
              )}
              {batchClaimLoading ? '批量操作中...' : '一鍵 Claim + 歸集 POKE'}
            </button>
          </div>
        </div>
      </div>

      {tokenMint && (
        <>
          {playerData && (
            <>
              <p className="text-sm mb-1 flex items-center gap-2">
                等級: {playerData.farmLevel}
                {/* 升級提示 */}
                {(() => {
                  // FARM_CONFIGS 需與後端同步，這裡直接寫死
                  const FARM_CONFIGS = [
                    [0, 0, 0],
                    [2, 6, 0],
                    [4, 12, 100],
                    [7, 20, 200],
                    [10, 40, 400],
                    [13, 70, 800],
                    [16, 130, 1600],
                    [19, 230, 3200],
                    [22, 420, 6400],
                    [24, 780, 12800],
                    [25, 2000, 25600],
                  ];
                  const nextLevel = playerData.farmLevel + 1;
                  if (nextLevel >= FARM_CONFIGS.length) return null;
                  const nextCost = FARM_CONFIGS[nextLevel][2];
                  if (nextCost > 0 && pokeBalance >= nextCost) {
                    return <span className="ml-2 px-2 py-0.5 rounded bg-amber-500 text-white font-bold animate-pulse">可升級！</span>;
                  }
                  return null;
                })()}
                <span className="relative group">
                  <svg className="inline w-4 h-4 text-yellow-400 cursor-pointer ml-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor">?</text></svg>
                  <span className="absolute left-1/2 z-10 hidden group-hover:block -translate-x-1/2 mt-2 px-3 py-2 text-xs text-white bg-gray-800 rounded shadow-lg whitespace-nowrap">
                    {(() => {
                      const FARM_CONFIGS = [
                        [0, 0, 0],
                        [2, 6, 0],
                        [4, 12, 100],
                        [7, 20, 200],
                        [10, 40, 400],
                        [13, 70, 800],
                        [16, 130, 1600],
                        [19, 230, 3200],
                        [22, 420, 6400],
                        [24, 780, 12800],
                        [25, 2000, 25600],
                      ];
                      const nextLevel = playerData.farmLevel + 1;
                      if (nextLevel >= FARM_CONFIGS.length) {
                        return '已達最高等級';
                      }
                      const nextCost = FARM_CONFIGS[nextLevel][2];
                      return `升級到等級${nextLevel} 需要 ${nextCost} POKE`;
                    })()}
                  </span>
                </span>
              </p>
              <p className="text-sm mb-1 flex items-center gap-2">
                漿果: {playerData.berries.toLocaleString()} / {playerData.berryCapacity.toLocaleString()}
                {/* 升級提示已移除 */}
              </p>
              <p className="text-sm mb-1">卡片: {playerData.stakedCardCount}/{playerData.capacity}</p>
              <p className="text-sm mb-1">算力: {playerData.totalHashpower}</p>
              {playerData.referrer && (
                <div className="text-sm mb-2">
                  <span className="text-gray-400">推薦人: </span>
                  <span className="font-mono text-blue-400">
                    {playerData.referrer.slice(0, 8)}...{playerData.referrer.slice(-8)}
                  </span>
                  <button
                    className="ml-2 p-1 rounded hover:bg-gray-700"
                    title="複製推薦人地址"
                    onClick={() => {
                      navigator.clipboard.writeText(playerData.referrer!);
                      toast('推薦人地址已複製', 'success');
                    }}
                    style={{ lineHeight: 1 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="5" y="5" width="10" height="10" rx="2" fill="#fff" fillOpacity="0.2" stroke="#ccc"/>
                      <rect x="8" y="2" width="10" height="10" rx="2" fill="#fff" fillOpacity="0.1" stroke="#aaa"/>
                    </svg>
                  </button>
                </div>
              )}
              
              {/* Claim Rewards 按鈕 */}
              <div className="mb-2 flex justify-end gap-2">
                <button
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-green-500 to-green-600 text-white font-bold shadow hover:from-green-600 hover:to-green-700 disabled:opacity-60"
                  onClick={handleClaimRewards}
                  disabled={claimLoading || autoInitLoading || isInitializing}
                >
                  {claimLoading ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                  ) : (
                    <span>🎁</span>
                  )}
                  {claimLoading ? '領取中...' : '領取獎勵'}
                </button>
                <button
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-purple-600 text-white font-bold shadow hover:from-purple-600 hover:to-purple-700 disabled:opacity-60"
                  onClick={handleUpgradeFarm}
                  disabled={upgradeLoading || autoInitLoading || isInitializing || (playerData && playerData.farmLevel + 1 >= 11)}
                >
                  {upgradeLoading ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                  ) : (
                    <span>⬆️</span>
                  )}
                  {playerData && playerData.farmLevel + 1 >= 11
                    ? '已滿級'
                    : (upgradeLoading ? '升級中...' : '升級農場')}
                </button>
              </div>
              <div className="mb-2 flex justify-end gap-2">
                
              <button
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-600 text-white font-bold shadow hover:from-orange-600 hover:to-yellow-700 disabled:opacity-60"
                    onClick={handleAutoSelectForRecycle}
                    disabled={recycleLoading || autoInitLoading || isInitializing}
                  >
                    <FaRecycle />
                    選擇(32)
                  </button>
                  <button
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-400 text-white font-bold shadow hover:from-yellow-600 hover:to-orange-500 disabled:opacity-60"
                    onClick={handleAutoSelect8ForRecycle}
                    disabled={recycleLoading || autoInitLoading || isInitializing}
                  >
                    <FaRecycle />
                    選擇(8)
                  </button>
                <button
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-red-500 to-red-600 text-white font-bold shadow hover:from-red-600 hover:to-red-700 disabled:opacity-60"
                  onClick={handleRecycleCards}
                  disabled={recycleLoading || selectedCardsForRecycle.length === 0 || autoInitLoading || isInitializing}
                >
                  {recycleLoading ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                  ) : (
                    <span>♻️</span>
                  )}
                  {recycleLoading ? '回收中...' : `回收卡片 (${selectedCardsForRecycle.length})`}
                </button>
              </div>
            </>
          )}
          
          {/* 卡片詳情卡片式 UI */}
          {playerData && playerData.cards && playerData.cards.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2 text-lg font-bold text-blue-500">
                <div className="flex items-center">
                  <FaGem className="mr-1" />
                  Cards <span className="ml-1 text-white text-base">({playerData.cards.length})</span>
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-pink-500 to-yellow-400 text-white font-bold shadow hover:from-pink-600 hover:to-yellow-500 disabled:opacity-60"
                    onClick={handleOpenBooster}
                    disabled={boosterLoading || autoInitLoading || isInitializing}
                  >
                    {boosterLoading ? (
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                    ) : (
                      <FaGift />
                    )}
                    {boosterLoading ? '抽卡中...' : '抽卡'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                {playerData.cards
                  .slice() // 創建副本避免修改原陣列
                  .map((card: Card, originalIndex: number) => ({
                    ...card,
                    originalIndex
                  }))
                  .sort((a, b) => a.id - b.id) // 按卡片 ID 由舊到新排序
                  .map((card: Card & { originalIndex: number }) => {
                  // 樂觀 UI 狀態優先，否則用鏈上資料
                  const staked =
                    optimisticStaked[card.originalIndex] !== undefined
                      ? optimisticStaked[card.originalIndex]
                      : isCardStaked(card.originalIndex, playerData.stakedCardsBitset);

                  // 質押
                  const handleStake = async () => {
                    setStakeLoading(card.originalIndex);
                    setOptimisticStaked((prev) => ({ ...prev, [card.originalIndex]: true }));
                    setOptimisticTimestamp((prev) => ({ ...prev, [card.originalIndex]: Date.now() }));
                    try {
                      const connection = new Connection(config.rpcEndpoint, 'confirmed');
                      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
                      const sig = await client.stakeCard(keypair, new PublicKey(tokenMint), card.originalIndex);
                      const stakeUrl = `https://solscan.io/tx/${sig}`;
                      toast(`質押成功 (tx: ${sig.slice(0,8)}...)`, 'success');
                      addLog(keypair.publicKey.toBase58(), `質押卡片#${card.originalIndex} 成功 ${sig}`, stakeUrl);
                      // 刷新
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      refreshAccountQueries();
                    } catch (err: unknown) {
                      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
                      toast(`質押失敗: ${errorMessage}`, 'error');
                      addLog(keypair.publicKey.toBase58(), `質押卡片#${card.originalIndex} 失敗: ${errorMessage}`);
                      setOptimisticStaked((prev) => ({ ...prev, [card.originalIndex]: false }));
                    } finally {
                      setStakeLoading(null);
                    }
                  };
                  // 解除質押
                  const handleUnstake = async () => {
                    setUnstakeLoading(card.originalIndex);
                    setOptimisticStaked((prev) => ({ ...prev, [card.originalIndex]: false }));
                    setOptimisticTimestamp((prev) => ({ ...prev, [card.originalIndex]: Date.now() }));
                    try {
                      const connection = new Connection(config.rpcEndpoint, 'confirmed');
                      const client = new PonzimonClient(connection, PROGRAM_ID ? new PublicKey(PROGRAM_ID) : new PublicKey(IDL.address));
                      const sig = await client.unstakeCard(keypair, new PublicKey(tokenMint), card.originalIndex);
                      const unstakeUrl = `https://solscan.io/tx/${sig}`;
                      toast(`解除質押成功 (tx: ${sig.slice(0,8)}...)`, 'success');
                      addLog(keypair.publicKey.toBase58(), `解除質押卡片#${card.originalIndex} 成功 ${sig}`, unstakeUrl);
                      // 刷新
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      refreshAccountQueries();
                    } catch (err: unknown) {
                      const errorMessage = getPonzimonFriendlyError(err, err instanceof Error ? err.message : String(err));
                      toast(`解除質押失敗: ${errorMessage}`, 'error');
                      addLog(keypair.publicKey.toBase58(), `解除質押卡片#${card.originalIndex} 失敗: ${errorMessage}`);
                      setOptimisticStaked((prev) => ({ ...prev, [card.originalIndex]: true }));
                    } finally {
                      setUnstakeLoading(null);
                    }
                  };
                  return (
                    <div key={card.originalIndex} className="rounded-xl border-2 border-cyan-700 bg-gray-800 p-5 shadow-lg flex flex-col">
                      <div className="flex items-center justify-center text-lg font-bold text-cyan-300 mb-2">
                        卡片 #{card.originalIndex} <FaBolt className="ml-1 text-yellow-400" />
                      </div>
                      <div className="border-b border-gray-700 mb-3"></div>
                      <div className="text-base text-gray-300 grid grid-cols-2 gap-y-1 mb-3">
                        <span className="font-medium text-gray-400">ID:</span>
                        <span className="text-right font-bold text-gray-100">{card.id}</span>
                        <span className="font-medium text-gray-400">稀有度:</span>
                        <span className={`text-right font-bold flex items-center gap-1 ${rarityColor[card.rarity]}`}>{rarityText[card.rarity] || '未知'} {rarityIcon[card.rarity]}</span>
                        <span className="font-medium text-gray-400">算力:</span>
                        <span className="text-right font-bold text-gray-100">{card.hashpower}</span>
                        <span className="font-medium text-gray-400">漿果:</span>
                        <span className="text-right font-bold text-gray-100">{card.berryConsumption}</span>
                      </div>
                      <div className={`flex items-center mb-3 px-2 py-1 rounded ${staked ? 'bg-emerald-900/60' : 'bg-gray-700'}`}> 
                        <span className="mr-2 font-medium text-gray-400">狀態:</span>
                        {staked ? (
                          <span className="flex items-center text-emerald-300 font-bold"><FaCheckSquare className="mr-1" />Staked</span>
                        ) : (
                          <span className="flex items-center text-gray-400 font-bold">none</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 mt-auto">
                        <button
                          className={`w-full py-2 rounded-lg font-bold flex items-center justify-center
                            ${staked
                              ? 'bg-gradient-to-r from-rose-700 to-rose-900 hover:from-rose-600 hover:to-rose-800 text-white'
                              : 'bg-gradient-to-r from-cyan-700 to-cyan-900 hover:from-cyan-600 hover:to-cyan-800 text-white'}
                          `}
                          disabled={stakeLoading === card.originalIndex || unstakeLoading === card.originalIndex || autoInitLoading || isInitializing}
                          onClick={staked ? handleUnstake : handleStake}
                        >
                          {(stakeLoading === card.originalIndex || unstakeLoading === card.originalIndex) ? (
                            <span className="animate-spin mr-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                          ) : (
                            <FaLock className="mr-2" />
                          )}
                          {staked ? '解除質押' : '質押'}
                        </button>
                        <button
                          className={`w-full py-2 rounded-lg font-bold flex items-center justify-center
                            ${staked
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : selectedCardsForRecycle.includes(card.originalIndex)
                              ? 'bg-gradient-to-r from-red-700 to-red-900 hover:from-red-600 hover:to-red-800 text-white'
                              : 'bg-gradient-to-r from-amber-700 to-orange-900 hover:from-amber-600 hover:to-orange-800 text-white'}
                          `}
                                                      disabled={staked || autoInitLoading || isInitializing}
                          title={staked ? '已質押卡片不可回收' : selectedCardsForRecycle.includes(card.originalIndex) ? '取消選擇' : '選擇回收'}
                          onClick={() => {
                            if (!staked) {
                              toggleCardSelection(card.originalIndex);
                            }
                          }}
                        >
                          {selectedCardsForRecycle.includes(card.originalIndex) ? (
                            <>
                              <FaCheck className="mr-2" />
                              已選擇
                            </>
                          ) : (
                            <>
                              <FaRecycle className="mr-2" />
                              選擇回收
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {tokenMint && (
        <div className="space-y-2 mt-2">
          {(!playerData || playerData.capacity === 0) && (
            <div className="space-y-2">
              <div className="flex flex-col space-y-1">
                <label className="text-xs text-gray-400">推薦人地址</label>
                <input
                  type="text"
                  value={referrerInput}
                  onChange={(e) => setReferrerInput(e.target.value)}
                  placeholder="Enter referrer wallet address..."
                  className="px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  disabled={autoInitLoading || isInitializing}
                />
              </div>
              <div className="flex gap-2">
                <button 
                                  onClick={handlePurchaseFarm} 
                disabled={purchaseLoading || autoInitLoading || isInitializing}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 text-sm py-2 rounded font-medium flex items-center justify-center"
                >
                  {purchaseLoading ? (
                    <>
                      <span className="animate-spin mr-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                      Purchasing...
                    </>
                  ) : (
                    'Purchase Farm'
                  )}
                </button>
                <button 
                  onClick={handleAutoInit} 
                  disabled={autoInitLoading || isInitializing}
                  className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-green-800 disabled:to-emerald-800 text-sm py-2 rounded font-medium flex items-center justify-center"
                  title="自動初始化：購買農場 → 質押前兩張卡 → 回收第三張卡 → 如果進化則替換質押"
                >
                  {autoInitLoading ? (
                    <>
                      <span className="animate-spin mr-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                      初始化中...
                    </>
                  ) : (
                    <>
                      <span className="mr-1">🚀</span>
                      自動初始化
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <button onClick={()=>setLogOpen(true)} className="w-full bg-gray-700 hover:bg-gray-600 text-xs py-1 rounded my-2">Logs</button>

      {tokenMint && (
        <Modal open={logOpen} onClose={()=>setLogOpen(false)} title="Logs">
          <div className="flex flex-col h-full">
            {/* 工具欄 */}
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-600">
              <span className="text-sm text-gray-300">日誌數量: {Array.isArray(logs) ? logs.length : 0}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (window.confirm('你確定要清除此錢包的日誌嗎？')) {
                      clearLog(pubkeyStr);
                      toast('日誌已清除', 'success');
                    }
                  }}
                  className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                  disabled={!Array.isArray(logs) || logs.length === 0}
                >
                  清除日誌
                </button>
                <button
                  onClick={() => {
                    if (Array.isArray(logs)) {
                      const logText = logs.map(l => l.text).join('\n');
                      navigator.clipboard.writeText(logText);
                      toast('日誌已複製到剪貼簿', 'success');
                    }
                  }}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                  disabled={!Array.isArray(logs) || logs.length === 0}
                >
                  複製日誌
                </button>
              </div>
            </div>
            
            {/* 日誌內容 */}
            <div className="text-xs max-h-96 overflow-auto space-y-1 font-mono flex-1">
              {!Array.isArray(logs) ? (
                <div className="text-gray-500 text-center py-8">日誌數據格式錯誤</div>
              ) : logs.length === 0 ? (
                <div className="text-gray-500 text-center py-8">無日誌</div>
              ) : (
                logs.map((l,i)=>(
                  <div key={i} className="flex gap-1 break-all">
                    <span>{l.text}</span>
                    {l.url && (
                      <a href={l.url} target="_blank" rel="noreferrer" className="underline text-blue-400">↗</a>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PlayerCard;
