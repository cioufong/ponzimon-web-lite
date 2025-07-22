import { create } from 'zustand'
import { persist } from 'zustand/middleware'
// Keypair 僅用於元件中動態解析，store 不再保存 Keypair 實例

export interface Account {
  name: string
  secret: string // base58 encoded secret key
}

export type Network = 'devnet' | 'mainnet'

export interface NetworkConfig {
  rpcEndpoint: string
  programId: string
  tokenMint: string
  rateLimit: {
    requestsPerSecond: number
    batchSize: number
    delayMs: number
  }
}

interface AppState {
  config: NetworkConfig
  accounts: Account[]
  selectedAccount: Account | null
  refreshInterval: number
  addAccount: (account: Account) => void
  removeAccount: (secret: string) => void
  selectAccount: (account: Account | null) => void
  setRefreshInterval: (interval: number) => void
  setRpcEndpoint: (endpoint: string) => void
  setRateLimit: (rateLimit: NetworkConfig['rateLimit']) => void
}

const defaultRpc = 'https://api.devnet.solana.com'

// 預設限速配置 - 針對 QuickNode 15/second 限制優化
const defaultRateLimit = {
  requestsPerSecond: 8, // QuickNode 免費套餐限制
  batchSize: 3, // 批次大小（5個錢包 * 3個請求 = 15個請求）
  delayMs: 1000, // 延遲毫秒（1秒）
}

// 寫死 programId 與 tokenMint - mainnet
// export const PROGRAM_ID = '7n6Qittj5bzxH9a9G6JemNRgqfNpyWaJFvFKWGGaKn6r';
// export const TOKEN_MINT = 'mPtPbojNDpmpySrLUWmfiVZmSxSUCXhPQuREu3DZ1hM';
// devnet 
export const PROGRAM_ID = 'pvbX31Yg4c5tapUPmcrMAMEM85G4QmUjHxdv9Kuct61';
export const TOKEN_MINT = 'mw6ehonjUYzNKbFEXUyPx1Zeh3D5S5eY3vXzeLBxgGw';

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      config: {
        rpcEndpoint: defaultRpc,
        programId: PROGRAM_ID,
        tokenMint: TOKEN_MINT,
        rateLimit: defaultRateLimit,
      },
      accounts: [],
      selectedAccount: null,
      refreshInterval: 0,
      addAccount: (account) => set((state) => ({ accounts: [...state.accounts, account] })),
      removeAccount: (secret) =>
        set((state) => ({
          accounts: state.accounts.filter((acc) => acc.secret !== secret),
          selectedAccount: state.selectedAccount?.secret === secret ? null : state.selectedAccount,
        })),
      selectAccount: (account) => set({ selectedAccount: account }),
      setRefreshInterval: (interval) => set({ refreshInterval: interval }),
      setRpcEndpoint: (endpoint) => set((state) => ({
        config: { ...state.config, rpcEndpoint: endpoint },
      })),
      setRateLimit: (rateLimit) => set((state) => ({
        config: { ...state.config, rateLimit },
      })),
    }),
    {
      name: 'ponzimon-store',
    }
  )
)
