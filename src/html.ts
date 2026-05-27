export const HTML = Symbol.for('swr.html')

export interface HtmlString {
  readonly [HTML]: true
  readonly value: string
}

function escape(s: string): string {
  let out = ''
  let last = 0
  for (let i = 0; i < s.length; i++) {
    let entity: string
    switch (s.charCodeAt(i)) {
      case 38: entity = '&amp;'; break
      case 60: entity = '&lt;'; break
      case 62: entity = '&gt;'; break
      case 34: entity = '&quot;'; break
      case 39: entity = '&#39;'; break
      default: continue
    }
    if (i > last) out += s.slice(last, i)
    out += entity
    last = i + 1
  }
  return last === 0 ? s : out + s.slice(last)
}

function isHtmlString(v: unknown): v is HtmlString {
  return !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[HTML] === true
}

function appendValue(out: string, v: unknown): string {
  if (v == null || v === false) return out
  if (isHtmlString(v)) return out + v.value
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) out = appendValue(out, v[i])
    return out
  }
  return out + escape(String(v))
}

/** Tagged template. Interpolations are escaped; nested `html` results and arrays of them pass through. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlString {
  let out = strings[0]!
  for (let i = 0; i < values.length; i++) {
    out = appendValue(out, values[i])
    out += strings[i + 1]!
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
