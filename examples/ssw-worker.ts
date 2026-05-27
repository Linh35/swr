import { createHost } from 'ssw'
import { todosStore } from './todos'

createHost([todosStore])
