import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LogLine {
  text: string
  url?: string
}

interface LogState {
  logs: Record<string, LogLine[]> // key: pubkey base58
  add: (pubkey: string, text: string, url?: string) => void
  clear: (pubkey: string) => void
  clearAll: () => void
}

// 从 localStorage 加载初始数据
const loadLogsFromStorage = (): Record<string, LogLine[]> => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem('ponzimon-logs')
    if (stored) {
      const parsed = JSON.parse(stored)
      // 验证数据格式，确保每个值都是数组
      if (typeof parsed === 'object' && parsed !== null) {
        const validated: Record<string, LogLine[]> = {}
        for (const [key, value] of Object.entries(parsed)) {
          if (Array.isArray(value)) {
            validated[key] = value
          } else {
            console.warn(`Invalid log format for ${key}, resetting to empty array`)
            validated[key] = []
          }
        }
        return validated
      }
    }
  } catch (error) {
    console.warn('Failed to load logs from localStorage:', error)
  }
  return {}
}

// 保存到 localStorage
const saveLogsToStorage = (logs: Record<string, LogLine[]>) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('ponzimon-logs', JSON.stringify(logs))
  } catch (error) {
    console.warn('Failed to save logs to localStorage:', error)
  }
}

export const useLogStore = create<LogState>()(
  persist(
    (set) => ({
      logs: loadLogsFromStorage(),
      add: (k, text, url) => {
        set((s) => {
          // 确保当前日志是数组格式
          const currentLogs = Array.isArray(s.logs[k]) ? s.logs[k] : []
          const newLogs = {
            ...s.logs,
            [k]: [...currentLogs, { text: `[${new Date().toLocaleTimeString()}] ${text}`, url }],
          }
          // 保存到 localStorage
          saveLogsToStorage(newLogs)
          return { logs: newLogs }
        })
      },
      clear: (k) => {
        set((s) => {
          const newLogs = { ...s.logs, [k]: [] }
          // 保存到 localStorage
          saveLogsToStorage(newLogs)
          return { logs: newLogs }
        })
      },
      clearAll: () => {
        set({ logs: {} })
        // 清除 localStorage
        localStorage.removeItem('ponzimon-logs')
      },
    }),
    {
      name: 'ponzimon-logs', // localStorage 的 key
      partialize: (state) => ({ logs: state.logs }), // 只持久化 logs 字段
      migrate: (persistedState) => persistedState, // 添加 migrate 函數消除警告
    }
  )
)
