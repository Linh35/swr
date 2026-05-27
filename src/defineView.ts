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

/** Bind a view to one store. */
export function defineView<S extends Record<string, unknown>>(
  id: string,
  store: StoreDefinitionLike<S>,
  render: (store: Store<S>) => HtmlString,
): ViewDefinition
/** Bind a view to multiple stores. The render fn receives mirrors keyed identically. */
export function defineView<M extends Record<string, AnyStoreDef>>(
  id: string,
  stores: M,
  render: (stores: StoresFromMap<M>) => HtmlString,
): ViewDefinition
export function defineView(
  id: string,
  arg: AnyStoreDef | Record<string, AnyStoreDef>,
  render: (arg: any) => HtmlString,
): ViewDefinition {
  return {
    id,
    init(useStore) {
      if (isStoreDef(arg)) {
        const s = useStore(arg)
        return {
          ready: s.ready,
          render: () => render(s),
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
        render: () => render(proxies),
      }
    },
  }
}
