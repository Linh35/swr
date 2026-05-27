import { describe, it, expect } from 'vitest'
import { html, raw, toString, HTML } from '../html'

describe('html / escaping', () => {
  it('escapes the five HTML entities in interpolated strings', () => {
    expect(toString(html`<p>${'<>&"\''}</p>`)).toBe('<p>&lt;&gt;&amp;&quot;&#39;</p>')
  })

  it('does not escape the static parts of the template', () => {
    expect(toString(html`<a href="${'https://example.com?a=1&b=2'}">go</a>`)).toBe(
      '<a href="https://example.com?a=1&amp;b=2">go</a>',
    )
  })

  it('coerces numbers and booleans (true) to their string form', () => {
    expect(toString(html`<p>${42} ${true}</p>`)).toBe('<p>42 true</p>')
  })

  it('renders null, undefined, and false as the empty string', () => {
    expect(toString(html`a${null}b${undefined}c${false}d`)).toBe('abcd')
  })

  it('returns a value that is detectable as an HtmlString', () => {
    const h = html`<p>x</p>`
    expect(h[HTML]).toBe(true)
    expect(typeof h.value).toBe('string')
  })
})

describe('html / nesting', () => {
  it('lets nested html`` pass through unescaped', () => {
    const inner = html`<em>${'<i>'}</em>`
    expect(toString(html`<p>${inner}</p>`)).toBe('<p><em>&lt;i&gt;</em></p>')
  })

  it('flattens arrays of html fragments', () => {
    const items = [1, 2, 3].map((n) => html`<li>${n}</li>`)
    expect(toString(html`<ul>${items}</ul>`)).toBe('<ul><li>1</li><li>2</li><li>3</li></ul>')
  })

  it('handles mixed arrays of fragments, strings and null', () => {
    const fragments = [html`<i>safe</i>`, '<bad>', null, false, 7]
    expect(toString(html`${fragments}`)).toBe('<i>safe</i>&lt;bad&gt;7')
  })

  it('handles deeply nested arrays', () => {
    const nested = [[html`<i>a</i>`], [[html`<i>b</i>`]]]
    expect(toString(html`${nested}`)).toBe('<i>a</i><i>b</i>')
  })

  it('preserves whitespace and newlines in the static parts', () => {
    const out = toString(html`
      <p>${'x'}</p>
    `)
    expect(out).toBe('\n      <p>x</p>\n    ')
  })
})

describe('html / raw', () => {
  it('raw() preserves its content unescaped', () => {
    const dangerous = raw('<script>x</script>')
    expect(toString(html`${dangerous}`)).toBe('<script>x</script>')
  })

  it('raw() can be composed with normal escaping', () => {
    expect(toString(html`<p>${raw('<b>bold</b>')} ${'<not bold>'}</p>`)).toBe(
      '<p><b>bold</b> &lt;not bold&gt;</p>',
    )
  })
})

describe('html / regressions', () => {
  it('does not double-escape the result of a prior html``', () => {
    const a = html`${'&'}`
    expect(toString(a)).toBe('&amp;')
    expect(toString(html`${a}`)).toBe('&amp;')
  })

  it('an empty template renders the empty string', () => {
    expect(toString(html``)).toBe('')
  })

  it('an interpolation-only template returns just the escaped value', () => {
    expect(toString(html`${'<x>'}`)).toBe('&lt;x&gt;')
  })

  it('handles an object that coerces to a string but is not an HtmlString', () => {
    const v = { toString: () => '<x>' }
    expect(toString(html`${v}`)).toBe('&lt;x&gt;')
  })
})
