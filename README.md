# swr

A SharedWorker HTML renderer that sits on top of [ssw](../ssw). You declare views as `(store) => HtmlString`; a `SharedWorker` runs every view's render inside a signal effect, broadcasts the resulting HTML string to subscribed tabs, and each tab does `container.innerHTML = msg.html`. The render runs once no matter how many tabs are open.

Status: experimental. ~40 tests run end-to-end over `MessageChannel`s. Render errors are isolated per view; redundant DOM writes are skipped.

## Why

- **Render once, broadcast everywhere.** ssw dedups state across tabs. swr does the same for the view: one `effect` fire, one render, N `innerHTML` writes.
- **Templates next to state.** A view is `(store) => HtmlString`. The same signals reactivity that drives ssw drives the render.
- **Small tab-side runtime.** The tab does a worker port, a message handler, and `el.innerHTML = msg.html` (skipped when unchanged). Escaping and effect machinery live in the worker.
- **Errors stay contained.** A throwing render does not take down the worker or sibling views. The error is cached per view, broadcast to current subscribers, and replayed to later mounts.

## Install / run the demo

```bash
git clone <this-repo>
cd swr
npm install
npm run dev
```

Requires a sibling `../ssw` checkout (resolved via Vite alias). Open the printed URL in two tabs, type in one, the other reflects it. The demo is a shared todo list.

## Quick start

```ts
// todos.ts
import { defineStore } from 'ssw'

export const todosStore = defineStore('todos', ({ signal, computed }) => {
  const items = signal<{ id: number; text: string; done: boolean }[]>([])
  const nextId = signal(1)
  const remaining = computed(() => items.value.filter((t) => !t.done).length)

  const add = (text: string) => {
    items.value = [...items.value, { id: nextId.value, text, done: false }]
    nextId.value++
  }
  const toggle = (id: number) => {
    items.value = items.value.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
  }
  return { items, remaining, add, toggle }
})
```

```ts
// todosView.ts
import { defineView, html } from 'swr'
import { todosStore } from './todos'

export const todosView = defineView('todos', todosStore, (store) => html`
  <p>${store.remaining} remaining</p>
  <ul>
    ${store.items.map((t) => html`
      <li class="${t.done ? 'done' : ''}" data-toggle="${t.id}">${t.text}</li>
    `)}
  </ul>
`)
```

```ts
// ssw-worker.ts
import { createHost } from 'ssw'
import { todosStore } from './todos'
createHost([todosStore])
```

```ts
// render-worker.ts
import { createRenderHost } from 'swr'
import { todosView } from './todosView'

createRenderHost({
  sswUrl: new URL('./ssw-worker.ts', import.meta.url),
  views: [todosView],
})
```

```ts
// main.ts
import { createRenderer } from 'swr'
import { todosView } from './todosView'

const renderer = createRenderer(new URL('./render-worker.ts', import.meta.url))
const handle = renderer.mount(todosView, document.getElementById('view')!)
await handle.ready
```

Mutations go through the regular ssw client:

```ts
import { createClient } from 'ssw'
import { todosStore } from './todos'

const { useStore } = createClient(new URL('./ssw-worker.ts', import.meta.url))
const store = useStore(todosStore)
store.add('write the readme')
```

## API

### `defineView(id, store, render)`

```ts
defineView<S>(id: string, store: StoreDefinition<S>, render: (store: Store<S>) => HtmlString)
```

- `id`: globally unique view id.
- `store`: an ssw store definition. swr subscribes via `useStore`.
- `render`: runs inside a worker-side `effect()`. Reads every signal it depends on synchronously, like any preact-signals effect.

### `defineView(id, stores, render)` (multi-store)

```ts
defineView(
  'header',
  { user: userStore, theme: themeStore },
  ({ user, theme }) => html`<header class="${theme.dark ? 'dark' : 'light'}">${user.name}</header>`,
)
```

The render function receives a record of mirrors keyed the same way as the input. The effect re-fires when any underlying store changes.

### `` html`...` ``

Tagged template. Interpolated values are HTML-escaped. Nested `` html`...` `` results pass through unescaped. Arrays of `HtmlString` concatenate. `null`, `undefined`, and `false` render as the empty string, so `${cond && html`...`}` works.

```ts
html`<ul>${items.map((x) => html`<li>${x.label}</li>`)}</ul>`
```

`raw(s)` wraps an already-trusted string. Use sparingly.

### `createRenderHost({ sswUrl, views, sswName? })` -> `{ dispose }`

Call from the swr SharedWorker entry. The host:

1. Creates `new SharedWorker(sswUrl)` for ssw state. The render-worker is itself an ssw client.
2. Calls `useStore(view.store)` for each view via the view's `init` step.
3. Wraps each view's render in `effect()`, catches throws, and broadcasts the HTML to subscribed tabs. Identical HTML on consecutive fires is dropped: no broadcast, no DOM write.

Returns `{ dispose }` for cleanup. Useful in tests; not normally called in the browser since SharedWorkers live as long as the user-agent decides.

### `createRenderer(rendererUrl, name?)` -> `Renderer`

Connects a tab to the swr SharedWorker. Registers a `pagehide` listener that sends a `leave` message to the worker so the port is dropped from `subscribers` (since `MessagePort` has no native close event). Returns `{ mount, dispose }`.

### `renderer.mount(view, container)` -> `{ ready, unmount }`

- Subscribes to the view (if not already) and writes the worker's HTML into `container.innerHTML` on every update. Identical-HTML writes are skipped.
- `ready: Promise<void>` resolves with the first delivered render. Rejects if the worker reports an error for the view (unknown id, render threw at init):

  ```ts
  const handle = renderer.mount(view, el)
  try {
    await handle.ready
  } catch (err) {
    // unknown view, or render threw during initial wiring
  }
  ```

- `unmount()` is idempotent. Removes the binding. The worker auto-unsubscribes when the last container for a view unmounts.

### `renderer.dispose()`

Sends `leave`, removes the message listener, closes the port. Further `mount(...)` calls return a handle whose `ready` rejects with `disposed`.

### `bindRenderHost(views, sswPort)` -> `{ onConnect, dispose }`

Port-level entry used by the test suite. Accepts any `MessagePort`, so the system can be wired without a real `SharedWorker`. Tests bind the ssw host to one channel, the swr host to another, and drive the renderer through a third.

### `rendererFromPort(port)` -> `Renderer`

Same as `createRenderer`, but takes any `MessagePort`.

## Architecture

```
+-- tab (per browser tab) -+   +------- swr SharedWorker --------+   +-- ssw SharedWorker --+
|                          |   |                                 |   |                      |
|  el.innerHTML = msg.html |<--+  effect(() => view.render(...)) +-->+  signals (canonical) |
|  renderer.mount(v, el)   |   |  string broadcast to ports      |   |  store mutations     |
|                          |   |  (skipped when unchanged)       |   |                      |
|  store.x = 1  (direct    +-->+--- swr is itself an ssw client--+-->+                      |
|     ssw client)          |   |                                 |   |                      |
+--------------------------+   +---------------------------------+   +----------------------+
```

Two SharedWorkers, one per concern. Each tab:

- Connects to ssw directly for writes (`store.x = 1`).
- Connects to swr to receive rendered HTML for views it has mounted.

The swr worker opens its own SharedWorker connection to ssw. Browsers dedup SharedWorkers by `(url, name)`, so ssw still runs as a single instance.

**Render dedup.** One `effect()` fire per view per state change. The output is broadcast as a string; tabs blit it into `innerHTML`. Identical-HTML re-renders are dropped at the worker before broadcast, and again at the client before assignment.

**Late subscribers.** If the worker has already produced a render for a view, mounting it sends the cached HTML immediately, so `await handle.ready` resolves on the next tick.

**Error containment.** A throw inside `view.render(...)` is caught at the effect boundary. The error is cached, broadcast to current subscribers, and replayed to anyone who mounts later. Sibling views and the ssw connection keep working.

**Port lifecycle.** SharedWorker `MessagePort` does not fire a close event, so the worker has no native way to detect a tab leaving. The client sends `leave` on `pagehide`; the worker drops the port from every view's `subscribers` set and removes its message listener.

**Protocol.**

| Direction | Message | Purpose |
| --- | --- | --- |
| client -> worker | `{ type: 'subscribe', viewId }` | start receiving renders for this view |
| client -> worker | `{ type: 'unsubscribe', viewId }` | stop receiving renders for this view |
| client -> worker | `{ type: 'leave' }` | drop this port from all subscriptions |
| worker -> client | `{ type: 'render', viewId, html }` | apply this HTML to every container bound to viewId |
| worker -> client | `{ type: 'error', viewId?, message }` | render failed; rejects pending `ready` |

## Limitations

- **`innerHTML` replacement is destructive.** Focus, scroll, and uncontrolled `<input>` state are lost on every update. The HTML-string model trades fidelity for simplicity. Keep inputs outside the rendered container (as the demo does for the new-todo box).
- **No event delegation built in.** Wire `addEventListener` on the container yourself and dispatch via `data-*` attributes (see `examples/main.ts`).
- **SharedWorker-inside-SharedWorker.** `createRenderHost` calls `new SharedWorker(sswUrl)`. Chrome and Firefox support this. Safari support has been spotty. Use the port-level entry (`bindRenderHost(views, sswPort)`) and bridge from the main thread if you hit issues.
- **Render must read signals synchronously.** Same rule as any signals `effect`.
- **No fine-grained DOM diffing.** Patches are full HTML strings. For very large views that mutate often, a virtual-DOM approach would be more efficient.
- **No persistence.** Same caveat as ssw.

## Roadmap

- Optional `morphdom`-style patching at the client for input-preserving updates.
- View ids exposed in DevTools / inspector overlay.
- `defineView` returning an `actions` proxy so views can dispatch without a separate ssw client in the tab.
- Streaming initial render for SSR/hydration parity.

## Scripts

```bash
npm run dev        # vite dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

## License

MIT.
