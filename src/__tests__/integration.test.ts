import { describe, it, expect } from 'vitest'
import { bindHost, clientFromPort, defineStore } from 'ssw'
import { bindRenderHost } from '../createRenderHost'
import { rendererFromPort } from '../createRenderer'
import { defineView } from '../defineView'
import { html } from '../html'

interface Todo {
  id: number
  text: string
  done: boolean
}

function defineTodosStore(id = 'todos') {
  return defineStore(id, ({ signal, computed }) => {
    const items = signal<Todo[]>([])
    const nextId = signal(1)
    const filter = signal<'all' | 'active' | 'done'>('all')

    const visible = computed(() => {
      const f = filter.value
      if (f === 'all') return items.value
      if (f === 'active') return items.value.filter((t) => !t.done)
      return items.value.filter((t) => t.done)
    })
    const remaining = computed(() => items.value.filter((t) => !t.done).length)
    const total = computed(() => items.value.length)

    const add = (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      items.value = [...items.value, { id: nextId.value, text: trimmed, done: false }]
      nextId.value = nextId.value + 1
    }
    const toggle = (id: number) => {
      items.value = items.value.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    }
    const remove = (id: number) => {
      items.value = items.value.filter((t) => t.id !== id)
    }
    const clearDone = () => {
      items.value = items.value.filter((t) => !t.done)
    }
    const setFilter = (f: 'all' | 'active' | 'done') => {
      filter.value = f
    }

    return { items, filter, visible, remaining, total, add, toggle, remove, clearDone, setFilter }
  })
}

const todosStore = defineTodosStore()

const todosView = defineView('todos-view', todosStore, (store) => {
  const rows = store.visible.length
    ? store.visible.map(
        (t) => html`<li id="t${t.id}" class="${t.done ? 'done' : ''}"><span>${t.text}</span></li>`,
      )
    : html`<li class="empty">none</li>`
  return html`<section><h2>${store.remaining}/${store.total}</h2><ul>${rows}</ul></section>`
})

function makeContainer(): Element {
  let inner = ''
  return {
    get innerHTML() {
      return inner
    },
    set innerHTML(v: string) {
      inner = v
    },
  } as unknown as Element
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await tick()
}

interface Rig {
  sswOnConnect: (port: MessagePort) => void
  bridgeNewClient: () => ReturnType<typeof clientFromPort>
  bridgeNewTab: () => ReturnType<typeof rendererFromPort>
}

function setupRig(
  views: Parameters<typeof bindRenderHost>[0] = [todosView],
  stores: Parameters<typeof bindHost>[0] = [todosStore],
): Rig & { dispose: () => void } {
  const sswOnConnect = bindHost(stores)
  const sswForSwrCh = new MessageChannel()
  sswOnConnect(sswForSwrCh.port2)
  const swr = bindRenderHost(views, sswForSwrCh.port1)

  return {
    sswOnConnect,
    bridgeNewClient() {
      const ch = new MessageChannel()
      sswOnConnect(ch.port2)
      return clientFromPort(ch.port1)
    },
    bridgeNewTab() {
      const ch = new MessageChannel()
      swr.onConnect(ch.port2)
      return rendererFromPort(ch.port1)
    },
    dispose: swr.dispose,
  }
}

describe('swr / initial render', () => {
  it('mounts with the empty-state HTML once ssw is ready', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    tab.mount(todosView, el)
    await flush()
    expect(el.innerHTML).toBe('<section><h2>0/0</h2><ul><li class="empty">none</li></ul></section>')
  })

  it('sends cached HTML to a late subscriber immediately', async () => {
    const rig = setupRig()
    // first tab kicks the render and waits for it
    const firstTab = rig.bridgeNewTab()
    const firstEl = makeContainer()
    firstTab.mount(todosView, firstEl)
    await flush()

    // drive some state via a peer ssw client
    const peer = rig.bridgeNewClient()
    const peerStore = peer.useStore(todosStore)
    await peerStore.ready
    peerStore.add('write me')
    await flush()

    // late tab arrives
    const lateTab = rig.bridgeNewTab()
    const lateEl = makeContainer()
    lateTab.mount(todosView, lateEl)
    await flush()

    expect(lateEl.innerHTML).toContain('write me')
    expect(lateEl.innerHTML).toBe(firstEl.innerHTML)
  })
})

describe('swr / state propagation', () => {
  it('reflects every action in the rendered HTML', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    tab.mount(todosView, el)

    const writer = rig.bridgeNewClient()
    const ws = writer.useStore(todosStore)
    await ws.ready

    ws.add('buy milk')
    await flush()
    expect(el.innerHTML).toContain('<li id="t1" class="">')
    expect(el.innerHTML).toContain('buy milk')
    expect(el.innerHTML).toContain('<h2>1/1</h2>')

    ws.add('walk dog')
    await flush()
    expect(el.innerHTML).toContain('<h2>2/2</h2>')

    ws.toggle(1)
    await flush()
    expect(el.innerHTML).toMatch(/<li id="t1" class="done">/)
    expect(el.innerHTML).toContain('<h2>1/2</h2>')

    ws.remove(2)
    await flush()
    expect(el.innerHTML).not.toContain('walk dog')
    expect(el.innerHTML).toContain('<h2>0/1</h2>')

    ws.clearDone()
    await flush()
    expect(el.innerHTML).toContain('<h2>0/0</h2>')
    expect(el.innerHTML).toContain('<li class="empty">none</li>')
  })

  it('switches the rendered list when the filter changes', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    tab.mount(todosView, el)

    const writer = rig.bridgeNewClient()
    const ws = writer.useStore(todosStore)
    await ws.ready

    ws.add('a')
    ws.add('b')
    ws.add('c')
    await flush()
    ws.toggle(2)
    await flush()
    expect(el.innerHTML.match(/<li id="t/g)?.length).toBe(3)

    ws.setFilter('active')
    await flush()
    expect(el.innerHTML.match(/<li id="t/g)?.length).toBe(2)
    expect(el.innerHTML).not.toContain('id="t2"')

    ws.setFilter('done')
    await flush()
    expect(el.innerHTML.match(/<li id="t/g)?.length).toBe(1)
    expect(el.innerHTML).toContain('id="t2"')

    ws.setFilter('all')
    await flush()
    expect(el.innerHTML.match(/<li id="t/g)?.length).toBe(3)
  })
})

describe('swr / multi-tab', () => {
  it('broadcasts a single render to every subscribed tab', async () => {
    const rig = setupRig()
    const tabA = rig.bridgeNewTab()
    const tabB = rig.bridgeNewTab()
    const tabC = rig.bridgeNewTab()
    const a = makeContainer()
    const b = makeContainer()
    const c = makeContainer()
    tabA.mount(todosView, a)
    tabB.mount(todosView, b)
    tabC.mount(todosView, c)
    await flush()

    const writer = rig.bridgeNewClient()
    const ws = writer.useStore(todosStore)
    await ws.ready
    ws.add('shared')
    await flush()

    expect(a.innerHTML).toBe(b.innerHTML)
    expect(b.innerHTML).toBe(c.innerHTML)
    expect(a.innerHTML).toContain('shared')
  })

  it('serializes concurrent writes from two tabs deterministically', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    tab.mount(todosView, el)

    const writer1 = rig.bridgeNewClient().useStore(todosStore)
    const writer2 = rig.bridgeNewClient().useStore(todosStore)
    await Promise.all([writer1.ready, writer2.ready])

    writer1.add('from-1')
    writer2.add('from-2')
    await flush()

    // both should appear; ssw serializes ops by arrival order
    expect(el.innerHTML).toContain('from-1')
    expect(el.innerHTML).toContain('from-2')
    expect(el.innerHTML).toContain('<h2>2/2</h2>')
  })

  it('two containers on one tab both reflect updates', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const a = makeContainer()
    const b = makeContainer()
    const handleA = tab.mount(todosView, a)
    tab.mount(todosView, b)
    await flush()

    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.add('x')
    await flush()

    expect(a.innerHTML).toContain('x')
    expect(b.innerHTML).toContain('x')

    handleA.unmount()
    ws.add('y')
    await flush()
    expect(a.innerHTML).not.toContain('y')
    expect(b.innerHTML).toContain('y')
  })
})

describe('swr / lifecycle', () => {
  it('unmount unsubscribes when last container goes; stops receiving updates', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    const handle = tab.mount(todosView, el)
    await flush()

    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.add('seen')
    await flush()
    expect(el.innerHTML).toContain('seen')

    handle.unmount()
    ws.add('after-unmount')
    await flush()
    expect(el.innerHTML).not.toContain('after-unmount')
  })

  it('remount after unmount picks back up with current state', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    const handle = tab.mount(todosView, el)
    await flush()

    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.add('one')
    await flush()
    handle.unmount()

    ws.add('two')
    ws.add('three')
    await flush()

    tab.mount(todosView, el)
    await flush()
    expect(el.innerHTML).toContain('one')
    expect(el.innerHTML).toContain('two')
    expect(el.innerHTML).toContain('three')
    expect(el.innerHTML).toContain('<h2>3/3</h2>')
  })
})

describe('swr / multiple views', () => {
  it('one render-host can serve multiple independent views', async () => {
    const counterStore = defineStore('counter', ({ signal }) => ({ n: signal(0) }))
    const counterView = defineView(
      'counter-view',
      counterStore,
      (s) => html`<p>n=${s.n}</p>`,
    )

    const sswOnConnect = bindHost([todosStore, counterStore])
    const sswForSwrCh = new MessageChannel()
    sswOnConnect(sswForSwrCh.port2)
    const swr = bindRenderHost([todosView, counterView], sswForSwrCh.port1)
    const tabCh = new MessageChannel()
    swr.onConnect(tabCh.port2)
    const tab = rendererFromPort(tabCh.port1)

    const peerCh = new MessageChannel()
    sswOnConnect(peerCh.port2)
    const peer = clientFromPort(peerCh.port1)

    const todosEl = makeContainer()
    const counterEl = makeContainer()
    tab.mount(todosView, todosEl)
    tab.mount(counterView, counterEl)
    await flush()

    const todoWs = peer.useStore(todosStore)
    const counterWs = peer.useStore(counterStore)
    await Promise.all([todoWs.ready, counterWs.ready])

    todoWs.add('alpha')
    counterWs.n = 42
    await flush()

    expect(todosEl.innerHTML).toContain('alpha')
    expect(todosEl.innerHTML).not.toContain('n=42')
    expect(counterEl.innerHTML).toBe('<p>n=42</p>')
  })
})

describe('swr / html safety', () => {
  it('escapes hostile user input in todo text', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    tab.mount(todosView, el)

    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.add('<img src=x onerror=alert(1)>')
    ws.add(`it's "fine" & <ok>`)
    await flush()

    expect(el.innerHTML).not.toContain('<img')
    expect(el.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(el.innerHTML).toContain('it&#39;s &quot;fine&quot; &amp; &lt;ok&gt;')
  })

  it('preserves nested html`` fragments without re-escaping them', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    tab.mount(todosView, el)
    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.add('hi')
    await flush()
    expect(el.innerHTML).toContain('<li id="t1"')
    expect(el.innerHTML).not.toContain('&lt;li')
  })
})

describe('swr / errors', () => {
  it('reports an error when the view id is unknown to the host', async () => {
    const rig = setupRig([])
    const tab = rig.bridgeNewTab()
    const el = makeContainer()

    const errs: string[] = []
    const orig = console.error
    console.error = (...a) => errs.push(a.map(String).join(' '))
    let caught: unknown
    try {
      const handle = tab.mount(todosView, el)
      try {
        await handle.ready
      } catch (e) {
        caught = e
      }
      await flush()
    } finally {
      console.error = orig
    }
    expect(errs.some((m) => m.includes('unknown view'))).toBe(true)
    expect(caught).toBeInstanceOf(Error)
    expect(String(caught)).toContain('unknown view')
    expect(el.innerHTML).toBe('')
  })

  it('contains errors thrown inside the render function and broadcasts them', async () => {
    const brokenStore = defineStore('broken', ({ signal }) => ({ trigger: signal(false) }))
    const brokenView = defineView('broken-view', brokenStore, (s) => {
      if (s.trigger) throw new Error('intentional render failure')
      return html`<p>ok</p>`
    })

    const sswOnConnect = bindHost([brokenStore])
    const sswCh = new MessageChannel()
    sswOnConnect(sswCh.port2)
    const swr = bindRenderHost([brokenView], sswCh.port1)
    const tabCh = new MessageChannel()
    swr.onConnect(tabCh.port2)
    const renderer = rendererFromPort(tabCh.port1)

    const el = makeContainer()
    const handle = renderer.mount(brokenView, el)
    await handle.ready
    expect(el.innerHTML).toBe('<p>ok</p>')

    const peerCh = new MessageChannel()
    sswOnConnect(peerCh.port2)
    const peer = clientFromPort(peerCh.port1)
    const peerStore = peer.useStore(brokenStore)
    await peerStore.ready

    const errs: string[] = []
    const orig = console.error
    console.error = (...a) => errs.push(a.map(String).join(' '))
    try {
      peerStore.trigger = true
      await flush()
    } finally {
      console.error = orig
    }
    expect(errs.some((m) => m.includes('intentional render failure'))).toBe(true)

    // A new mount on the broken view sees the cached error.
    const tab2Ch = new MessageChannel()
    swr.onConnect(tab2Ch.port2)
    const renderer2 = rendererFromPort(tab2Ch.port1)
    const el2 = makeContainer()
    const h2 = renderer2.mount(brokenView, el2)
    let rejected: unknown
    try {
      await h2.ready
    } catch (e) {
      rejected = e
    }
    expect(rejected).toBeInstanceOf(Error)
  })

  it('rejects duplicate view ids at host construction time', () => {
    const v1 = defineView('dupe', todosStore, () => html`<p>1</p>`)
    const v2 = defineView('dupe', todosStore, () => html`<p>2</p>`)
    const sswOnConnect = bindHost([todosStore])
    const sswCh = new MessageChannel()
    sswOnConnect(sswCh.port2)
    expect(() => bindRenderHost([v1, v2], sswCh.port1)).toThrowError(/duplicate view id/)
  })
})

describe('swr / mount().ready', () => {
  it('resolves with the first render', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    const handle = tab.mount(todosView, el)
    await expect(handle.ready).resolves.toBeUndefined()
    expect(el.innerHTML).not.toBe('')
  })

  it('is already settled for late mounts because the worker has a cached render', async () => {
    const rig = setupRig()
    // prime the cache with one tab
    const tabA = rig.bridgeNewTab()
    const elA = makeContainer()
    await tabA.mount(todosView, elA).ready

    const tabB = rig.bridgeNewTab()
    const elB = makeContainer()
    const handle = tabB.mount(todosView, elB)
    await handle.ready
    expect(elB.innerHTML).toBe(elA.innerHTML)
  })
})

describe('swr / multi-store views', () => {
  it('subscribes to multiple stores and renders against the union', async () => {
    const userStore = defineStore('user', ({ signal }) => ({ name: signal('alice') }))
    const themeStore = defineStore('theme', ({ signal }) => ({ dark: signal(false) }))
    const header = defineView(
      'header',
      { user: userStore, theme: themeStore },
      ({ user, theme }) => html`<header class="${theme.dark ? 'dark' : 'light'}">${user.name}</header>`,
    )

    const sswOnConnect = bindHost([userStore, themeStore])
    const sswForSwrCh = new MessageChannel()
    sswOnConnect(sswForSwrCh.port2)
    const swr = bindRenderHost([header], sswForSwrCh.port1)
    const tabCh = new MessageChannel()
    swr.onConnect(tabCh.port2)
    const tab = rendererFromPort(tabCh.port1)

    const el = makeContainer()
    const handle = tab.mount(header, el)
    await handle.ready
    expect(el.innerHTML).toBe('<header class="light">alice</header>')

    const peerCh = new MessageChannel()
    sswOnConnect(peerCh.port2)
    const peer = clientFromPort(peerCh.port1)
    const u = peer.useStore(userStore)
    const t = peer.useStore(themeStore)
    await Promise.all([u.ready, t.ready])
    u.name = 'bob'
    t.dark = true
    await flush()
    expect(el.innerHTML).toBe('<header class="dark">bob</header>')
  })
})

describe('swr / dispose & leave', () => {
  it('renderer.dispose() drops the port and stops applying renders', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    await tab.mount(todosView, el).ready
    const beforeHtml = el.innerHTML

    tab.dispose()
    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.add('after-dispose')
    await flush()
    expect(el.innerHTML).toBe(beforeHtml)
  })

  it('further mounts on a disposed renderer reject immediately', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    tab.dispose()
    const el = makeContainer()
    const handle = tab.mount(todosView, el)
    await expect(handle.ready).rejects.toThrow(/disposed/)
  })

  it('host.dispose() stops the render effect and clears subscribers', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    await tab.mount(todosView, el).ready

    rig.dispose()

    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.add('after-host-dispose')
    await flush()
    expect(el.innerHTML).not.toContain('after-host-dispose')
  })
})

describe('swr / repeated lifecycle', () => {
  it('unmount is idempotent', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    const handle = tab.mount(todosView, el)
    await handle.ready
    expect(() => {
      handle.unmount()
      handle.unmount()
      handle.unmount()
    }).not.toThrow()
  })

  it('rapid mount/unmount churn does not leak subscribers', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    for (let i = 0; i < 20; i++) {
      const el = makeContainer()
      const h = tab.mount(todosView, el)
      await h.ready
      h.unmount()
    }
    const el = makeContainer()
    const final = tab.mount(todosView, el)
    await final.ready
    expect(el.innerHTML).toContain('0/0')
  })
})

describe('swr / performance characteristics', () => {
  it('skips innerHTML writes when the rendered HTML did not change', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    await tab.mount(todosView, el).ready

    let writes = 0
    let last = el.innerHTML
    Object.defineProperty(el, 'innerHTML', {
      get: () => last,
      set: (v: string) => {
        writes++
        last = v
      },
    })

    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready
    ws.setFilter('all') // already 'all', no observable change
    ws.setFilter('all')
    ws.setFilter('all')
    await flush()
    expect(writes).toBe(0)

    ws.add('one')
    await flush()
    expect(writes).toBe(1)
  })

  it('handles a large list without splitting renders', async () => {
    const rig = setupRig()
    const tab = rig.bridgeNewTab()
    const el = makeContainer()
    await tab.mount(todosView, el).ready
    const ws = rig.bridgeNewClient().useStore(todosStore)
    await ws.ready

    const N = 200
    for (let i = 0; i < N; i++) ws.add(`item ${i}`)
    await flush(6)
    const matches = el.innerHTML.match(/<li id="t/g)
    expect(matches?.length).toBe(N)
    expect(el.innerHTML).toContain(`<h2>${N}/${N}</h2>`)
  })
})
