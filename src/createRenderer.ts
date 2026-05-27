import type { ViewDefinition } from './defineView'
import type { ClientMessage, WorkerMessage } from './protocol'

export interface MountHandle {
  /** Resolves on first render. Rejects on view-level error (e.g. unknown viewId). */
  readonly ready: Promise<void>
  /** Idempotent. View stays subscribed while other containers reference it. */
  unmount(): void
}

export interface Renderer {
  /** Bind a view to a container. The container's innerHTML is replaced on each render. */
  mount(view: ViewDefinition, container: Element): MountHandle
  /** Send `leave` and close the port. `createRenderer` wires this to `pagehide`. */
  dispose(): void
}

interface ViewState {
  containers: Set<Element>
  pending: Array<{ resolve: () => void; reject: (e: Error) => void }>
  lastHtml: string | null
}

/** Connect to a swr SharedWorker at `rendererUrl`. */
export function createRenderer(rendererUrl: URL | string, name = 'swr'): Renderer {
  const worker = new SharedWorker(rendererUrl, { type: 'module', name })
  const renderer = rendererFromPort(worker.port)

  if (typeof globalThis !== 'undefined' && 'addEventListener' in globalThis) {
    const onLeave = () => renderer.dispose()
    ;(globalThis as unknown as Window).addEventListener('pagehide', onLeave, { once: true })
  }

  return renderer
}

/** Port-level entry. Accepts any MessagePort. */
export function rendererFromPort(port: MessagePort): Renderer {
  const viewState = new Map<string, ViewState>()
  let disposed = false

  function settlePending(viewId: string, value: { ok: true } | { ok: false; error: Error }) {
    const state = viewState.get(viewId)
    if (!state) return
    const pending = state.pending
    state.pending = []
    for (const p of pending) {
      if (value.ok) p.resolve()
      else p.reject(value.error)
    }
  }

  const onMessage = (ev: MessageEvent) => {
    const msg = ev.data as WorkerMessage
    if (msg.type === 'render') {
      const state = viewState.get(msg.viewId)
      if (!state) return
      state.lastHtml = msg.html
      for (const el of state.containers) {
        if (el.innerHTML !== msg.html) el.innerHTML = msg.html
      }
      settlePending(msg.viewId, { ok: true })
      return
    }
    if (msg.type === 'error') {
      console.error('[swr]', msg.message)
      if (msg.viewId) {
        settlePending(msg.viewId, { ok: false, error: new Error(msg.message) })
      }
      return
    }
  }

  port.addEventListener('message', onMessage)
  port.start()

  function mount(view: ViewDefinition, container: Element): MountHandle {
    if (disposed) {
      const err = new Error('[swr] renderer is disposed')
      return {
        ready: Promise.reject(err),
        unmount() {},
      }
    }

    let state = viewState.get(view.id)
    const isFirstForView = !state
    if (!state) {
      state = { containers: new Set(), pending: [], lastHtml: null }
      viewState.set(view.id, state)
    }
    state.containers.add(container)

    let resolve!: () => void
    let reject!: (e: Error) => void
    const ready = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    ready.catch(() => {})

    if (state.lastHtml !== null) {
      if (container.innerHTML !== state.lastHtml) container.innerHTML = state.lastHtml
      resolve()
    } else {
      state.pending.push({ resolve, reject })
    }

    if (isFirstForView) {
      port.postMessage({ type: 'subscribe', viewId: view.id } satisfies ClientMessage)
    }

    let unmounted = false
    return {
      ready,
      unmount() {
        if (unmounted) return
        unmounted = true
        const s = viewState.get(view.id)
        if (!s) return
        s.containers.delete(container)
        if (s.containers.size === 0) {
          viewState.delete(view.id)
          port.postMessage({ type: 'unsubscribe', viewId: view.id } satisfies ClientMessage)
        }
      },
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    try {
      port.postMessage({ type: 'leave' } satisfies ClientMessage)
    } catch {
      // port may be closed
    }
    port.removeEventListener('message', onMessage)
    viewState.clear()
    try {
      port.close()
    } catch {
      // ignore
    }
  }

  return { mount, dispose }
}
