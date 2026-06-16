import emojiRegex from 'emoji-regex'
import { emojiToUnified } from './emojiUtils'

/**
 * Serializes the HTML structure of a contenteditable element into plain text.
 * Replaces image tags with their data-emoji attribute value, and BR tags with newlines.
 */
export function getEditableText(node: Node): string {
  let text = ''
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement
      if (el.tagName === 'IMG' && el.getAttribute('data-emoji')) {
        text += el.getAttribute('data-emoji')
      } else if (el.tagName === 'BR') {
        text += '\n'
      } else if (el.tagName === 'DIV') {
        const inner = getEditableText(el)
        if (inner) {
          text += '\n' + inner
        }
      } else {
        text += getEditableText(el)
      }
    }
  }
  return text
}

/**
 * Converts a plain text string into an HTML string suitable for contenteditable.
 * Escapes HTML characters and replaces Unicode emojis with inline Apple-style images.
 */
export function convertTextToHtml(text: string): string {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const regex = emojiRegex()
  const replacedEmojis = escaped.replace(regex, (match) => {
    const unified = emojiToUnified(match)
    return `<img src="https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/${unified}.png" alt="${match}" data-emoji="${match}" class="inline-emoji" style="width: 20px; height: 20px; vertical-align: middle; display: inline-block; margin: 0 1px;" />`
  })

  return replacedEmojis.replace(/\n/g, '<br>')
}

/**
 * Recursively scans text nodes inside a contenteditable node to check if any raw emojis are present.
 */
export function hasRawEmojis(node: Node): boolean {
  const regex = emojiRegex()
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child.nodeType === Node.TEXT_NODE) {
      if (regex.test(child.nodeValue || '')) {
        return true
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement
      if (el.tagName === 'IMG' && el.classList.contains('inline-emoji')) {
        continue
      }
      if (hasRawEmojis(child)) return true
    }
  }
  return false
}

/**
 * Retrieves the caret's plain-text character offset inside a contenteditable element.
 */
export function getCaretCharacterOffsetWithin(element: HTMLElement): number {
  let caretOffset = 0
  const doc = element.ownerDocument || document
  const win = doc.defaultView || window
  const sel = win.getSelection()
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    const preCaretRange = range.cloneRange()
    preCaretRange.selectNodeContents(element)
    preCaretRange.setEnd(range.endContainer, range.endOffset)
    
    const container = doc.createElement('div')
    container.appendChild(preCaretRange.cloneContents())
    caretOffset = getEditableText(container).length
  }
  return caretOffset
}

/**
 * Sets the caret position inside a contenteditable element based on a plain-text character offset.
 */
export function setCaretPosition(element: HTMLElement, offset: number) {
  const range = document.createRange()
  const sel = window.getSelection()
  if (!sel) return

  let currentOffset = 0
  let found = false

  function traverse(node: Node) {
    if (found) return

    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.nodeValue?.length || 0
      if (currentOffset + len >= offset) {
        range.setStart(node, offset - currentOffset)
        range.setEnd(node, offset - currentOffset)
        found = true
      } else {
        currentOffset += len
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.tagName === 'IMG' && el.getAttribute('data-emoji')) {
        const len = el.getAttribute('data-emoji')?.length || 0
        if (currentOffset + len >= offset) {
          range.setStartAfter(el)
          range.setEndAfter(el)
          found = true
        } else {
          currentOffset += len
        }
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          traverse(node.childNodes[i])
        }
      }
    }
  }

  traverse(element)

  if (!found) {
    range.selectNodeContents(element)
    range.collapse(false)
  }

  sel.removeAllRanges()
  sel.addRange(range)
}
