import { createClient } from 'ssw'
import { createRenderer } from '../src'
import { todosStore } from './todos'
import { todosView } from './todosView'

const renderer = createRenderer(new URL('./render-worker.ts', import.meta.url))
const container = document.getElementById('view')!
renderer.mount(todosView, container)

const { useStore } = createClient(new URL('./ssw-worker.ts', import.meta.url))
const store = useStore(todosStore)

const input = document.getElementById('new-todo') as HTMLInputElement
const form = document.getElementById('add-form') as HTMLFormElement

form.addEventListener('submit', (e) => {
  e.preventDefault()
  store.add(input.value)
  input.value = ''
})

container.addEventListener('click', (e) => {
  const t = e.target
  if (!(t instanceof HTMLElement)) return

  const toggleId = t.getAttribute('data-toggle')
  if (toggleId) {
    store.toggle(Number(toggleId))
    return
  }

  const removeId = t.getAttribute('data-remove')
  if (removeId) {
    store.remove(Number(removeId))
    return
  }

  const filter = t.getAttribute('data-filter')
  if (filter === 'all' || filter === 'active' || filter === 'done') {
    store.setFilter(filter)
    return
  }

  if (t.hasAttribute('data-clear-done')) {
    store.clearDone()
    return
  }
})
