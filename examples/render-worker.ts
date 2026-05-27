import { createRenderHost } from '../src'
import { todosView } from './todosView'

createRenderHost({
  sswUrl: new URL('./ssw-worker.ts', import.meta.url),
  views: [todosView],
})
