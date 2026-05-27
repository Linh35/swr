export const HTML = Symbol.for('swr.html')

export interface HtmlString {
  readonly [HTML]: true
  readonly value: string
}

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => entities[c]!)
}

function isHtmlString(v: unknown): v is HtmlString {
  return !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[HTML] === true
}

function renderValue(v: unknown): string {
  if (v == null || v === false) return ''
  if (isHtmlString(v)) return v.value
  if (Array.isArray(v)) return v.map(renderValue).join('')
  return escape(String(v))
}

/** Tagged template. Interpolations are escaped; nested `html` results and arrays of them pass through. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlString {
  let out = ''
  for (let i = 0; i < strings.length; i++) {
    out += strings[i]
    if (i < values.length) out += renderValue(values[i])
  }
  return { [HTML]: true, value: out }
}

/** Trust a string as pre-escaped HTML. Use sparingly. */
export function raw(s: string): HtmlString {
  return { [HTML]: true, value: s }
}

export function toString(h: HtmlString): string {
  return h.value
}
