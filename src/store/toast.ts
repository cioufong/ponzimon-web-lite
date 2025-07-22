import { create } from 'zustand'

export interface ToastMsg {
  id: number
  text: string
  type?: 'success' | 'error' | 'info'
  url?: string
}

interface ToastState {
  toasts: ToastMsg[]
  add: (text: string, type?: ToastMsg['type']) => void
  remove: (id: number) => void
}

let idCounter = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (text, type = 'info', url?: string) => {
    const id = ++idCounter
    set((s) => ({ toasts: [...s.toasts, { id, text, type, url }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 2000)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
