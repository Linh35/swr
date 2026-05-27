import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const sswEntry = fileURLToPath(new URL('../ssw/src/index.ts', import.meta.url))

export default defineConfig({
  root: 'examples',
  resolve: {
    alias: [{ find: /^ssw$/, replacement: sswEntry }],
  },
  worker: {
    format: 'es',
  },
})
