import type { ReactNode } from 'react'
import { viewLabel, type ViewerItem } from './viewerContext'

/** A thumbnail that opens the media viewer (OP-88): "View image" or "View video", zoom-in cursor. */
export function ViewButton({
  kind,
  onOpen,
  className = '',
  children,
  ...rest
}: {
  kind: ViewerItem['kind']
  onOpen: () => void
  className?: string
  children: ReactNode
  'data-testid'?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`block cursor-zoom-in border-0 bg-transparent p-0 text-left ${className}`}
      aria-label={viewLabel(kind)}
      onClick={(e) => {
        // Cards and editors around a thumbnail keep their own click.
        e.stopPropagation()
        onOpen()
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
