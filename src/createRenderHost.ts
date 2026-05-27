import { clientFromPort, effect } from 'ssw'
import type { ViewDefinition } from './defineView'
import type { ClientMessage, WorkerMessage } from './protocol'

declare const self: SharedWorkerGlobalScope

interface ViewRuntime {
  subscribers: Set<MessagePort>
  lastHtml: string
  lastError: string | null
  hasRendered: boolean
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

  for (const view of views) {
    if (runtimes.has(view.id)) {
      throw new Error(`[swr] duplicate view id: ${view.id}`)
    }
    const runtime: ViewRuntime = {
      subscribers: new Set(),
      lastHtml: '',
      lastError: null,
      hasRendered: false,
      disposeEffect: null,
    }
    runtimes.set(view.id, runtime)

    const wiring = view.init(useStore)

    wiring.ready
      .then(() => {
        const dispose = effect(() => {
          let result
          try {
            result = wiring.render()
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            runtime.lastError = message
            runtime.hasRendered = false
            const msg: WorkerMessage = { type: 'error', viewId: view.id, message }
            for (const port of runtime.subscribers) port.postMessage(msg)
            return
          }
          const html = result.value
          runtime.lastError = null
          if (runtime.hasRendered && html === runtime.lastHtml) return
          runtime.lastHtml = html
          runtime.hasRendered = true
          const msg: WorkerMessage = { type: 'render', viewId: view.id, html }
          for (const port of runtime.subscribers) port.postMessage(msg)
        })
        runtime.disposeEffect = dispose
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        runtime.lastError = message
        const msg: WorkerMessage = { type: 'error', viewId: view.id, message }
        for (const port of runtime.subscribers) port.postMessage(msg)
      })
  }

  function dropPort(port: MessagePort) {
    const views = portViews.get(port)
    if (views) {
      for (const viewId of views) {
        const runtime = runtimes.get(viewId)
        runtime?.subscribers.delete(port)
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
        runtime.subscribers.add(port)
        ownedViews.add(msg.viewId)
        if (runtime.lastError) {
          port.postMessage({
            type: 'error',
            viewId: msg.viewId,
            message: runtime.lastError,
          } satisfies WorkerMessage)
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
        if (runtime) runtime.subscribers.delete(port)
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
      runtime.disposeEffect?.()
      runtime.disposeEffect = null
      runtime.subscribers.clear()
    }
  }

  return { onConnect, dispose }
}
