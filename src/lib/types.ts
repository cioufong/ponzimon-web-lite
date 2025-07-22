// Ponzimon 型別手動定義，對應 Rust 結構

export interface Card {
  id: number
  rarity: number
  hashpower: number
  berry_consumption: number
}

export interface Farm {
  farm_type: number
  total_cards: number
  berry_capacity: string // u64
}

export type PendingRandomAction =
  | { type: 'None' }
  | { type: 'Gamble'; amount: string }
  | { type: 'Booster' }
  | { type: 'Recycle'; card_indices: number[]; card_count: number }

export interface Player {
  owner: string // pubkey
  farm: Farm
  cards: Card[]
  card_count: number
  staked_cards_bitset: string // u128
  berries: string // u64
  total_hashpower: string // u64
  referrer: string | null // option<pubkey>
  last_acc_tokens_per_hashpower: string // u128
  last_claim_slot: string // u64
  last_upgrade_slot: string // u64
  total_rewards: string // u64
  total_gambles: string // u64
  total_gamble_wins: string // u64
  pending_action: PendingRandomAction
  commit_slot: string // u64
  total_earnings_for_referrer: string // u64
  total_booster_packs_opened: string // u64
  total_cards_recycled: string // u64
  successful_card_recycling: string // u64
  total_sol_spent: string // u64
  total_tokens_spent: string // u64
  staked_tokens: string // u64
  last_stake_slot: string // u64
  last_acc_sol_rewards_per_token: string // u128
  last_acc_token_rewards_per_token: string // u128
  claimed_token_rewards: string // u64
  // padding 不用理會
}

export interface GlobalState {
  authority: string
  token_mint: string
  fees_wallet: string
  total_supply: string
  burned_tokens: string
  cumulative_rewards: string
  start_slot: string
  reward_rate: string
  acc_tokens_per_hashpower: string
  last_reward_slot: string
  burn_rate: number
  referral_fee: number
  production_enabled: boolean
  dust_threshold_divisor: string
  initial_farm_purchase_fee_lamports: string
  booster_pack_cost_microtokens: string
  gamble_fee_lamports: string
  total_berries: string
  total_hashpower: string
  total_global_gambles: string
  total_global_gamble_wins: string
  total_booster_packs_opened: string
  total_card_recycling_attempts: string
  total_successful_card_recycling: string
  total_staked_tokens: string
  staking_lockup_slots: string
  acc_sol_rewards_per_token: string
  acc_token_rewards_per_token: string
  last_staking_reward_slot: string
  token_reward_rate: string
  total_sol_deposited: string
  rewards_vault: string
  // padding 不用理會
}

// 其他型別如有需要可再補充
