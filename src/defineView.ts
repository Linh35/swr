import type { Store } from 'ssw'
import type { StoreContext } from './sswTypes'
import type { HtmlString } from './html'

export interface StoreDefinitionLike<S extends Record<string, unknown>> {
  id: string
  setup: (ctx: StoreContext) => S
}

type AnyStoreDef = StoreDefinitionLike<Record<string, unknown>>

type StoresFromMap<M> = {
  [K in keyof M]: M[K] extends StoreDefinitionLike<infer S> ? Store<S> : never
}

export interface ViewContext {
  /**
   * Cache an HtmlString per `key`. Invalidated when any `deps` element changes by `===`.
   * Keys not seen during a render are evicted after that render.
   * Use primitive deps; objects coming through ssw lose identity across structured clone.
   */
  memo(
    key: string | number,
    deps: readonly unknown[],
    build: () => HtmlString,
  ): HtmlString
}

/** Internal wiring; consumed by createRenderHost. */
export interface ViewWiring {
  ready: Promise<void>
  render: () => HtmlString
}

export interface ViewDefinition {
  readonly id: string
  init(useStore: <S extends Record<string, unknown>>(def: StoreDefinitionLike<S>) => Store<S>): ViewWiring
}

function isStoreDef(v: unknown): v is AnyStoreDef {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { setup?: unknown }).setup === 'function'
  )
}

interface MemoEntry {
  deps: readonly unknown[]
  html: HtmlString
}

function depsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function makeContext(): { ctx: ViewContext; afterRender: () => void } {
  const cache = new Map<string | number, MemoEntry>()
  const touched = new Set<string | number>()
  const ctx: ViewContext = {
    memo(key, deps, build) {
      touched.add(key)
      const entry = cache.get(key)
      if (entry && depsEqual(entry.deps, deps)) return entry.html
      const html = build()
      cache.set(key, { deps, html })
      return html
    },
  }
  return {
    ctx,
    afterRender() {
      for (const k of cache.keys()) {
        if (!touched.has(k)) cache.delete(k)
      }
      touched.clear()
    },
  }
}

/** Bind a view to one store. */
export function defineView<S extends Record<string, unknown>>(
  id: string,
  store: StoreDefinitionLike<S>,
  render: (store: Store<S>, ctx: ViewContext) => HtmlString,
): ViewDefinition
/** Bind a view to multiple stores. The render fn receives mirrors keyed identically. */
export function defineView<M extends Record<string, AnyStoreDef>>(
  id: string,
  stores: M,
  render: (stores: StoresFromMap<M>, ctx: ViewContext) => HtmlString,
): ViewDefinition
export function defineView(
  id: string,
  arg: AnyStoreDef | Record<string, AnyStoreDef>,
  render: (arg: any, ctx: ViewContext) => HtmlString,
): ViewDefinition {
  return {
    id,
    init(useStore) {
      const { ctx, afterRender } = makeContext()
      const runRender = (target: unknown): HtmlString => {
        const out = render(target, ctx)
        afterRender()
        return out
      }
      if (isStoreDef(arg)) {
        const s = useStore(arg)
        return {
          ready: s.ready,
          render: () => runRender(s),
        }
      }
      const proxies: Record<string, unknown> = {}
      const readies: Promise<void>[] = []
      for (const [k, def] of Object.entries(arg)) {
        const s = useStore(def)
        proxies[k] = s
        readies.push(s.ready)
      }
      return {
        ready: Promise.all(readies).then(() => undefined),
        render: () => runRender(proxies),
      }
    },
  }
}
