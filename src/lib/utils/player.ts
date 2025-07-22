// Utility helpers to derive useful stats from raw Anchor Player account
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import BN from 'bn.js'
import { PublicKey } from '@solana/web3.js'

export interface EnhancedPlayer {
  farmLevel: number
  capacity: number
  berryCapacity: number
  stakedCardCount: number
  berries: number
  totalHashpower: number
  lastClaimSlot?: number
  totalRewards?: number
  pendingAction: unknown
  raw: unknown
  cards: Card[]
  cardCount: number
  stakedCardsBitset: bigint
  referrer?: string | null
}

export interface Card {
  id: number
  rarity: number
  hashpower: number
  berryConsumption: number
}

const countBits = (big: bigint | BN): number => {
  let n: bigint
  if (big instanceof BN) {
    n = BigInt(big.toString())
  } else {
    n = big
  }
  let c = 0
  while (n) {
    c += Number(n & 1n)
    n >>= 1n
  }
  return c
}

export function parsePlayer(raw: unknown): EnhancedPlayer {
  if (!raw) throw new Error('raw player null')
  // Anchor camelCases snake names
  const farm = (raw as Record<string, unknown>).farm ?? (raw as Record<string, unknown>).farm_
  const farmLevel = farm?.farmType ?? farm?.farm_type ?? 0
  const capacity = (() => {
    const v = farm?.totalCards ?? farm?.total_cards ?? 0
    return typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v)
  })()

  const berryCapacity = (() => {
    const v = farm?.berryCapacity ?? farm?.berry_capacity ?? 0
    return typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v)
  })()

  const berries = (() => {
    const v = (raw as Record<string, unknown>).berries ?? (raw as Record<string, unknown>).berries_ ?? 0
    return typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v)
  })()

  const totalHashpower = (() => {
    const v = (raw as Record<string, unknown>).totalHashpower ?? (raw as Record<string, unknown>).total_hashpower ?? 0
    return typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v)
  })()

  const lastClaimSlot = (() => {
    const v = (raw as Record<string, unknown>).lastClaimSlot ?? (raw as Record<string, unknown>).last_claim_slot ?? 0
    return typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v)
  })()

  const totalRewards = (() => {
    const v = (raw as Record<string, unknown>).totalRewards ?? (raw as Record<string, unknown>).total_rewards ?? 0
    return typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v)
  })()

  const bitset =
    (raw as Record<string, unknown>).stakedCardsBitset ?? (raw as Record<string, unknown>).staked_cards_bitset ?? 0
  const stakedCardCount = countBits(
    bitset instanceof BN ? bitset : BigInt(bitset.toString ? bitset.toString() : bitset)
  )

  return {
    farmLevel,
    capacity,
    berryCapacity,
    stakedCardCount,
    berries,
    totalHashpower,
    lastClaimSlot,
    totalRewards,
    pendingAction: (raw as Record<string, unknown>).pendingAction ?? (raw as Record<string, unknown>).pending_action,
    raw,
  }
}

// ------- Buffer parser (copied & simplified from ponzimon-miner) -------

export function parsePlayerBuffer(data: Buffer): EnhancedPlayer {
  let off = 8 // skip discriminator

  // owner
  off += 32

  // farm struct
  const farmType = data.readUInt8(off++)
  const totalCardsCap = data.readUInt8(off++)
  const berryCapacity = Number(data.readBigUInt64LE(off))
  off += 8

  // parse cards array (128 * 6 bytes)
  const cards: Card[] = []
  for (let i = 0; i < 128; i++) {
    const id = data.readUInt16LE(off)
    off += 2
    const rarity = data.readUInt8(off++)
    const hashpower = data.readUInt16LE(off)
    off += 2
    const berryConsumption = data.readUInt8(off++)

    if (id > 0) {
      // 只加入有效的卡片
      cards.push({
        id,
        rarity,
        hashpower,
        berryConsumption,
      })
    }
  }

  const cardCount = data.readUInt8(off++)

  // staked bitset u128
  const stLow = data.readBigUInt64LE(off)
  const stHigh = data.readBigUInt64LE(off + 8)
  const stakedBits = stLow + (stHigh << 64n)
  off += 16

  const berries = Number(data.readBigUInt64LE(off))
  off += 8
  const totalHashpower = Number(data.readBigUInt64LE(off))
  off += 8

  // ---------- Optional referrer ----------
  let referrer: string | null = null
  if (data.readUInt8(off++)) {
    // Option 標記
    referrer = new PublicKey(data.slice(off, (off += 32))).toBase58()
  }

  const stakedCardCount = countBits(stakedBits)

  return {
    farmLevel: farmType,
    capacity: totalCardsCap,
    berryCapacity,
    stakedCardCount,
    berries,
    totalHashpower,
    pendingAction: null,
    raw: {},
    cards,
    cardCount,
    stakedCardsBitset: stakedBits,
    referrer,
  }
}
