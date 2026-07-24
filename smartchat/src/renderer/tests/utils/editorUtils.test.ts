import { describe, it, expect } from 'vitest'
import {
  convertTextToHtml,
  getEditableText,
  hasRawEmojis
} from '@renderer/utils/editorUtils'

describe('editorUtils utility', () => {
  describe('convertTextToHtml', () => {
    it('returns empty string for empty input', () => {
      expect(convertTextToHtml('')).toBe('')
    })

    it('escapes HTML special characters (&, <, >)', () => {
      const html = convertTextToHtml('Tom & <Jerry>')
      expect(html).toBe('Tom &amp; &lt;Jerry&gt;')
    })

    it('replaces newlines with <br> tags', () => {
      const html = convertTextToHtml('Line 1\nLine 2')
      expect(html).toBe('Line 1<br>Line 2')
    })

    it('replaces Unicode emojis with inline Apple-style emoji img tags', () => {
      const html = convertTextToHtml('Hello 😊!')
      expect(html).toContain('<img src="https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f60a.png"')
      expect(html).toContain('data-emoji="😊"')
      expect(html).toContain('class="inline-emoji"')
    })
  })

  describe('getEditableText', () => {
    it('extracts plain text from DOM text nodes', () => {
      const div = document.createElement('div')
      div.textContent = 'Hello World'
      expect(getEditableText(div)).toBe('Hello World')
    })

    it('extracts newlines from BR elements and text from data-emoji attribute on IMG tags', () => {
      const div = document.createElement('div')
      div.innerHTML = 'Line 1<br>Line 2 <img data-emoji="😊" class="inline-emoji" />'
      expect(getEditableText(div)).toBe('Line 1\nLine 2 😊')
    })

    it('handles nested DIV containers with newlines', () => {
      const parent = document.createElement('div')
      parent.innerHTML = 'Header<div>Nested line</div>'
      expect(getEditableText(parent)).toBe('Header\nNested line')
    })
  })

  describe('hasRawEmojis', () => {
    it('returns true if element contains un-replaced raw Unicode emojis in text nodes', () => {
      const div = document.createElement('div')
      div.textContent = 'Hello 😊 world'
      expect(hasRawEmojis(div)).toBe(true)
    })

    it('returns false if emojis are already replaced with inline-emoji img elements', () => {
      const div = document.createElement('div')
      div.innerHTML = 'Hello <img class="inline-emoji" data-emoji="😊" /> world'
      expect(hasRawEmojis(div)).toBe(false)
    })

    it('returns false for plain text without emojis', () => {
      const div = document.createElement('div')
      div.textContent = 'Just plain text'
      expect(hasRawEmojis(div)).toBe(false)
    })
  })
})
