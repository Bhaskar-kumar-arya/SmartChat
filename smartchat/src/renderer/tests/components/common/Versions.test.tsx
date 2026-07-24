import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import Versions from '@renderer/components/common/Versions'

describe('Versions', () => {
  beforeEach(() => {
    // Setup window.electron mock versions
    ;(window as any).electron = {
      process: {
        versions: {
          electron: '30.0.0',
          chrome: '124.0.0.0',
          node: '20.11.0'
        }
      }
    }
  })

  it('renders Electron, Chromium, and Node versions', () => {
    render(<Versions />)
    expect(screen.getByText('Electron v30.0.0')).toBeInTheDocument()
    expect(screen.getByText('Chromium v124.0.0.0')).toBeInTheDocument()
    expect(screen.getByText('Node v20.11.0')).toBeInTheDocument()
  })
})
