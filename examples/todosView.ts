import { defineView, html } from '../src'
import { todosStore } from './todos'

export const todosView = defineView('todos', todosStore, (store) => {
  const items = store.visible
  const filter = store.filter
  const tab = (key: 'all' | 'active' | 'done', label: string) => html`
    <button
      type="button"
      data-filter="${key}"
      class="${filter === key ? 'active' : ''}"
    >${label}</button>
  `

  const rows = items.length
    ? items.map(
        (t) => html`
          <li data-id="${t.id}" class="${t.done ? 'done' : ''}">
            <label>
              <input type="checkbox" data-toggle="${t.id}" ${t.done ? 'checked' : ''} />
              <span>${t.text}</span>
            </label>
            <button type="button" data-remove="${t.id}" aria-label="remove">×</button>
          </li>
        `,
      )
    : html`<li class="empty"><em>nothing here yet</em></li>`

  return html`
    <ul class="todos">
      ${rows}
    </ul>
    <p class="meta">
      <span>${store.remaining} of ${store.total} remaining</span>
      <span class="filters">
        ${tab('all', 'all')}
        ${tab('active', 'active')}
        ${tab('done', 'done')}
      </span>
      <button type="button" data-clear-done>clear done</button>
    </p>
  `
})
