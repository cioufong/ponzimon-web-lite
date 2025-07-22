// Ponzimon 錯誤碼對應友善訊息
export function getPonzimonFriendlyError(err: unknown, fallback: string): string {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorCode =
    (err as { code?: unknown; errorCode?: unknown; errorNumber?: unknown }).code ||
    (err as { code?: unknown; errorCode?: unknown; errorNumber?: unknown }).errorCode ||
    (err as { code?: unknown; errorCode?: unknown; errorNumber?: unknown }).errorNumber;
  // 錯誤碼與訊息對應表
  const errorMap: Record<string | number, string> = {
    6001: '漿果消耗超過農場上限，請回收或解除部分卡片',
    6002: '農場卡片已達上限，請先回收或升級農場',
    6003: '代幣餘額不足',
    6004: 'SOL 餘額不足',
    6005: '冷卻時間未結束，請稍後再試',
    6006: '系統維護中，暫停操作',
    6010: '未授權操作',
    6011: '已購買初始農場，請勿重複操作',
    6012: '推薦人地址無效',
    6016: '不可推薦自己',
    6018: '沒有可領取的獎勵',
    6019: '獎勵已領取',
    6020: '獎勵已過期',
    6027: '此卡片已質押，無法進行該操作',
    6028: '此卡片未質押，無法解除質押',
    6029: '此卡片正在回收中，無法進行該操作',
    6032: '已有待處理的抽卡請求，請先結算',
    6033: '沒有待結算的抽卡請求',
    6034: '已有待處理的回收請求，請先結算',
    6035: '沒有待結算的回收請求',
    6036: '回收卡片數量需在 1~20 張之間',
    6037: '回收卡片索引重複，請檢查選擇',
    6042: '卡片索引錯誤，請刷新頁面',
    'MachineCapacityExceeded': '農場卡片已達上限，請先回收或升級農場',
    'PowerCapacityExceeded': '漿果消耗超過農場上限，請回收或解除部分卡片',
    'CardIsStaked': '此卡片已質押，無法進行該操作',
    'CardNotStaked': '此卡片未質押，無法解除質押',
    'CardPendingRecycling': '此卡片正在回收中，無法進行該操作',
    'BoosterAlreadyPending': '已有待處理的抽卡請求，請先結算',
    'NoBoosterPending': '沒有待結算的抽卡請求',
    'RecycleAlreadyPending': '已有待處理的回收請求，請先結算',
    'NoRecyclePending': '沒有待結算的回收請求',
    'InvalidRecycleCardCount': '回收卡片數量需在 1~20 張之間',
    'DuplicateRecycleCardIndices': '回收卡片索引重複，請檢查選擇',
    'CardIndexOutOfBounds': '卡片索引錯誤，請刷新頁面',
    'InsufficientTokens': '代幣餘額不足',
    'InsufficientLamports': 'SOL 餘額不足',
    'CooldownNotExpired': '冷卻時間未結束，請稍後再試',
    'ProductionDisabled': '系統維護中，暫停操作',
    'Unauthorized': '未授權操作',
    'InitialFarmAlreadyPurchased': '已購買初始農場，請勿重複操作',
    'InvalidReferrer': '推薦人地址無效',
    'SelfReferralNotAllowed': '不可推薦自己',
    'NoPendingReward': '沒有可領取的獎勵',
    'RewardAlreadyClaimed': '獎勵已領取',
    'RewardExpired': '獎勵已過期',
    6053: '隨機性 slot 已過期，請重新嘗試（請勿等待太久）',
    6025: '隨機性尚未準備好，請稍後再結算（通常需等待幾秒）',
  };
  // 16進位 custom program error
  const hexMap: Record<string, string> = {
    '0x1771': errorMap[6001],
    '0x1772': errorMap[6002],
    '0x1773': errorMap[6003],
    '0x1774': errorMap[6004],
    '0x1775': errorMap[6005],
    '0x1776': errorMap[6006],
    '0x177a': errorMap[6010],
    '0x177b': errorMap[6011],
    '0x177c': errorMap[6012],
    '0x1780': errorMap[6016],
    '0x1782': errorMap[6018],
    '0x1783': errorMap[6019],
    '0x1784': errorMap[6020],
    '0x1793': errorMap[6032],
    '0x1794': errorMap[6033],
    '0x1795': errorMap[6034],
    '0x1796': errorMap[6035],
    '0x1797': errorMap[6036],
    '0x1798': errorMap[6037],
    '0x17aa': errorMap[6042],
    '0x17a5': errorMap[6053],
    '0x1789': errorMap[6025],
  };
  if (errorMap[errorCode as string]) return errorMap[errorCode as string];
  if (errorMap[errorMessage]) return errorMap[errorMessage];
  for (const hex in hexMap) {
    if (errorMessage.includes(hex)) return hexMap[hex];
  }
  // fallback: 部分錯誤訊息片段
  if (errorMessage.includes('MachineCapacityExceeded') || errorMessage.includes('Farm card capacity exceeded')) return errorMap[6002];
  if (errorMessage.includes('PowerCapacityExceeded')) return errorMap[6001];
  if (errorMessage.includes('Insufficient tokens')) return errorMap[6003];
  if (errorMessage.includes('Insufficient lamports')) return errorMap[6004];
  if (errorMessage.includes('Cooldown not expired')) return errorMap[6005];
  if (errorMessage.includes('Production is disabled')) return errorMap[6006];
  if (errorMessage.includes('Unauthorized')) return errorMap[6010];
  if (errorMessage.includes('already purchased')) return errorMap[6011];
  if (errorMessage.includes('Invalid referrer')) return errorMap[6012];
  if (errorMessage.includes('Self-referral')) return errorMap[6016];
  if (errorMessage.includes('No pending reward')) return errorMap[6018];
  if (errorMessage.includes('Reward already claimed')) return errorMap[6019];
  if (errorMessage.includes('Reward expired')) return errorMap[6020];
  if (errorMessage.includes('already staked')) return errorMap[6027];
  if (errorMessage.includes('not staked')) return errorMap[6028];
  if (errorMessage.includes('pending recycling')) return errorMap[6029];
  if (errorMessage.includes('pending booster pack')) return errorMap[6032];
  if (errorMessage.includes('No pending booster')) return errorMap[6033];
  if (errorMessage.includes('pending card recycle')) return errorMap[6034];
  if (errorMessage.includes('No pending card recycle')) return errorMap[6035];
  if (errorMessage.includes('Must provide between')) return errorMap[6036];
  if (errorMessage.includes('Duplicate card indices')) return errorMap[6037];
  if (errorMessage.includes('Card index out of bounds')) return errorMap[6042];
  if (errorMessage.includes('SlotNotFound')) return errorMap[6053];
  if (errorMessage.includes('RandomnessNotResolved')) return errorMap[6025];
  if (errorMessage.includes('insufficient funds')) return 'POKE 代幣餘額不足，請先充值';
  if (errorMessage.includes('CancelTimeoutNotExpired') || errorMessage.includes('0x17a2')) {
    return '無法立即取消，請稍後再試（冷卻時間未到）';
  }
  return fallback;
} 