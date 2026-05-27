import { clientFromPort, effect } from 'ssw'
import type { ViewDefinition, ViewWiring } from './defineView'
import type { ClientMessage, WorkerMessage } from './protocol'

declare const self: SharedWorkerGlobalScope

interface ViewRuntime {
  id: string
  subscribers: Set<MessagePort>
  wiring: ViewWiring
  isReady: boolean
  hasRendered: boolean
  lastHtml: string
  lastError: string | null
  disposeEffect: (() => void) | null
}

export interface CreateRenderHostOptions {
  sswUrl: URL | string
  sswName?: string
  views: ViewDefinition[]
}

export interface RenderHostHandle {
  /** Drop all effects and stop accepting messages on the listed ports. */
  dispose(): void
}

/** Call from the swr SharedWorker entry. Spawns an ssw client and registers views. */
export function createRenderHost({
  sswUrl,
  sswName = 'ssw',
  views,
}: CreateRenderHostOptions): RenderHostHandle {
  const sswWorker = new SharedWorker(sswUrl, { type: 'module', name: sswName })
  const handle = bindRenderHost(views, sswWorker.port)
  self.addEventListener('connect', (event) => {
    const port = (event as MessageEvent).ports[0]
    if (port) handle.onConnect(port)
  })
  return { dispose: handle.dispose }
}

export interface BoundRenderHost extends RenderHostHandle {
  onConnect(port: MessagePort): void
}

/** Port-level entry. Accepts an already-wired ssw MessagePort; returns a handle with onConnect/dispose. */
export function bindRenderHost(views: ViewDefinition[], sswPort: MessagePort): BoundRenderHost {
  const { useStore } = clientFromPort(sswPort)
  const runtimes = new Map<string, ViewRuntime>()
  const portViews = new WeakMap<MessagePort, Set<string>>()
  const portMessageHandlers = new WeakMap<MessagePort, (ev: MessageEvent) => void>()

  function broadcast(runtime: ViewRuntime, msg: WorkerMessage) {
    for (const port of runtime.subscribers) port.postMessage(msg)
  }

  function startEffect(runtime: ViewRuntime) {
    if (runtime.disposeEffect || !runtime.isReady) return
    // First fire after a (re)start always broadcasts even if the render matches
    // the cached value, so the subscriber that triggered the start receives it.
    let isFirstFire = true
    runtime.disposeEffect = effect(() => {
      let result
      try {
        result = runtime.wiring.render()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        runtime.lastError = message
        runtime.hasRendered = false
        isFirstFire = false
        if (runtime.subscribers.size > 0) {
          broadcast(runtime, { type: 'error', viewId: runtime.id, message })
        }
        return
      }
      const html = result.value
      runtime.lastError = null
      const unchanged = runtime.hasRendered && html === runtime.lastHtml
      runtime.lastHtml = html
      runtime.hasRendered = true
      if (unchanged && !isFirstFire) return
      isFirstFire = false
      if (runtime.subscribers.size > 0) {
        broadcast(runtime, { type: 'render', viewId: runtime.id, html })
      }
    })
  }

  function stopEffect(runtime: ViewRuntime) {
    if (runtime.disposeEffect) {
      runtime.disposeEffect()
      runtime.disposeEffect = null
    }
  }

  for (const view of views) {
    if (runtimes.has(view.id)) {
      throw new Error(`[swr] duplicate view id: ${view.id}`)
    }
    const runtime: ViewRuntime = {
      id: view.id,
      subscribers: new Set(),
      wiring: view.init(useStore),
      isReady: false,
      hasRendered: false,
      lastHtml: '',
      lastError: null,
      disposeEffect: null,
    }
    runtimes.set(view.id, runtime)

    runtime.wiring.ready
      .then(() => {
        runtime.isReady = true
        if (runtime.subscribers.size > 0) startEffect(runtime)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        runtime.lastError = message
        if (runtime.subscribers.size > 0) {
          broadcast(runtime, { type: 'error', viewId: view.id, message })
        }
      })
  }

  function dropPort(port: MessagePort) {
    const subs = portViews.get(port)
    if (subs) {
      for (const viewId of subs) {
        const runtime = runtimes.get(viewId)
        if (!runtime) continue
        runtime.subscribers.delete(port)
        if (runtime.subscribers.size === 0) stopEffect(runtime)
      }
      portViews.delete(port)
    }
    const handler = portMessageHandlers.get(port)
    if (handler) {
      port.removeEventListener('message', handler)
      portMessageHandlers.delete(port)
    }
  }

  function onConnect(port: MessagePort) {
    const ownedViews = new Set<string>()
    portViews.set(port, ownedViews)

    const handler = (ev: MessageEvent) => {
      const msg = ev.data as ClientMessage
      if (msg.type === 'subscribe') {
        const runtime = runtimes.get(msg.viewId)
        if (!runtime) {
          port.postMessage({
            type: 'error',
            viewId: msg.viewId,
            message: `unknown view: ${msg.viewId}`,
          } satisfies WorkerMessage)
          return
        }
        const wasEmpty = runtime.subscribers.size === 0
        runtime.subscribers.add(port)
        ownedViews.add(msg.viewId)
        if (runtime.lastError) {
          port.postMessage({
            type: 'error',
            viewId: msg.viewId,
            message: runtime.lastError,
          } satisfies WorkerMessage)
          return
        }
        if (wasEmpty) {
          startEffect(runtime)
        } else if (runtime.hasRendered) {
          port.postMessage({
            type: 'render',
            viewId: msg.viewId,
            html: runtime.lastHtml,
          } satisfies WorkerMessage)
        }
        return
      }
      if (msg.type === 'unsubscribe') {
        const runtime = runtimes.get(msg.viewId)
        if (runtime) {
          runtime.subscribers.delete(port)
          if (runtime.subscribers.size === 0) stopEffect(runtime)
        }
        ownedViews.delete(msg.viewId)
        return
      }
      if (msg.type === 'leave') {
        dropPort(port)
        return
      }
    }

    portMessageHandlers.set(port, handler)
    port.addEventListener('message', handler)
    port.start()
  }

  function dispose() {
    for (const runtime of runtimes.values()) {
      stopEffect(runtime)
      runtime.subscribers.clear()
    }
  }

  return { onConnect, dispose }
}
