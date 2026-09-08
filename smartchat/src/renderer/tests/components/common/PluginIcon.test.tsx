import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginIcon } from '@renderer/components/common/PluginIcon'

describe('PluginIcon', () => {
  it('does not inject raw plugin SVG into the DOM (no dangerouslySetInnerHTML)', () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="window.__pwned=1" /></svg>'
    const { container } = render(<PluginIcon icon={hostile} />)

    // The SVG must not become live DOM — it is rendered as an <img> data URI.
    expect(container.querySelector('svg')).toBeNull()
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src.startsWith('data:image/svg+xml,')).toBe(true)
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
  })

  it('renders data: image URIs but rejects bare http(s) plugin icons', () => {
    const { container: ok } = render(
      <PluginIcon icon="data:image/png;base64,iVBORw0KGgo=" />
    )
    expect(ok.querySelector('img')).not.toBeNull()

    const { container: blocked } = render(<PluginIcon icon="http://evil.example/pixel.png" />)
    expect(blocked.querySelector('img')).toBeNull()

    const { container: blockedHttps } = render(
      <PluginIcon icon="https://evil.example/pixel.png" />
    )
    expect(blockedHttps.querySelector('img')).toBeNull()
  })
})
