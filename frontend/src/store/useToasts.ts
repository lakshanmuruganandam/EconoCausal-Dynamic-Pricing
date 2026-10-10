import { create } from 'zustand'

export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'good' | 'info' | 'warn' | 'bad'
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
    window.setTimeout(() => get().dismiss(id), 5500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))
