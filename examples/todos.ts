import { defineStore } from 'ssw'

export interface Todo {
  id: number
  text: string
  done: boolean
}

export const todosStore = defineStore('todos', ({ signal, computed }) => {
  const items = signal<Todo[]>([])
  const nextId = signal(1)
  const filter = signal<'all' | 'active' | 'done'>('all')

  const visible = computed(() => {
    const f = filter.value
    if (f === 'all') return items.value
    if (f === 'active') return items.value.filter((t) => !t.done)
    return items.value.filter((t) => t.done)
  })
  const remaining = computed(() => items.value.filter((t) => !t.done).length)
  const total = computed(() => items.value.length)

  const add = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    items.value = [...items.value, { id: nextId.value, text: trimmed, done: false }]
    nextId.value = nextId.value + 1
  }

  const toggle = (id: number) => {
    items.value = items.value.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
  }

  const remove = (id: number) => {
    items.value = items.value.filter((t) => t.id !== id)
  }

  const clearDone = () => {
    items.value = items.value.filter((t) => !t.done)
  }

  const setFilter = (f: 'all' | 'active' | 'done') => {
    filter.value = f
  }

  return { items, filter, visible, remaining, total, add, toggle, remove, clearDone, setFilter }
})
