import type { Signal, ReadonlySignal } from '@preact/signals-core'

/** Mirror of ssw's StoreContext, kept local to avoid importing ssw internals. */
export interface StoreContext {
  signal: <T>(initial: T) => Signal<T>
  computed: <T>(fn: () => T) => ReadonlySignal<T>
}
