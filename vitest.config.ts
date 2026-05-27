import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const sswEntry = fileURLToPath(new URL('../ssw/src/index.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{ find: /^ssw$/, replacement: sswEntry }],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
