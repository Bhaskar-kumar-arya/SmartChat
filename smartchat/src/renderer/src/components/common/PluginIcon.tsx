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

  // 1. Raw inline SVG string (provided by plugin manifest)
  if (trimmed.startsWith('<svg')) {
    const scaledSvgHtml = trimmed.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
      const cleanedAttrs = attrs.replace(/\b(width|height)=["'][^"']*["']/gi, '')
      return `<svg ${cleanedAttrs} style="width: 100%; height: 100%; display: block;" >`
    })

    return (
      <span
        className={`plugin-svg-icon ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          flexShrink: 0
        }}
        dangerouslySetInnerHTML={{ __html: scaledSvgHtml }}
      />
    )
  }

  // 2. Image URL or Base64 Data URI
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/')) {
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
