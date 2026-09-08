import React from 'react'
import * as LucideIcons from 'lucide-react'

interface PluginIconProps {
  icon?: string
  className?: string
  size?: number
}

function toPascalCase(str: string): string {
  return str.replace(/(^\w|-\w)/g, (m) => m.replace('-', '').toUpperCase())
}

/**
 * Dynamic icon renderer for contributions.
 * Supports:
 * 1. Raw inline SVG strings ("<svg ...>")
 * 2. Image URLs or Base64 Data URIs ("http://...", "https://...", "data:image/...")
 * 3. Lucide icon names ("pin", "bell-off", "star", "sparkles", "archive", "mic", "zap", "flask", etc.)
 */
export const PluginIcon: React.FC<PluginIconProps> = ({ icon, className = 'indicator-icon', size = 16 }) => {
  if (!icon) return null

  const trimmed = icon.trim()

  // 1. Raw inline SVG string (provided by an untrusted plugin manifest).
  //    Render it as an <img> data URI rather than via dangerouslySetInnerHTML:
  //    an <img>-hosted SVG document runs no scripts and fires no event-handler
  //    attributes (onload/onerror/onbegin/...), so a hostile manifest icon
  //    cannot get renderer-origin code execution (F11-01).
  if (trimmed.startsWith('<svg')) {
    const dataUri = `data:image/svg+xml,${encodeURIComponent(trimmed)}`
    return (
      <img
        src={dataUri}
        alt=""
        className={`plugin-svg-icon ${className}`}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      />
    )
  }

  // 2. Base64 / data-URI image only. Bare http(s) plugin icons are rejected:
  //    a remote URL is a load-time beacon (author learns when/where the app
  //    renders + the user's IP) and http:// is mixed content (F11-08).
  if (trimmed.startsWith('data:image/')) {
    return (
      <img
        src={trimmed}
        alt=""
        className={className}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      />
    )
  }

  // 3. Lucide icon lookup (kebab-case or PascalCase)
  const pascalName = toPascalCase(trimmed)
  const IconComponent = (LucideIcons as Record<string, any>)[pascalName] || (LucideIcons as Record<string, any>)[trimmed]
  if (IconComponent && (typeof IconComponent === 'object' || typeof IconComponent === 'function')) {
    const Component = IconComponent as React.ComponentType<{ size?: number; className?: string }>
    return <Component size={size} className={className} />
  }

  return null
}
