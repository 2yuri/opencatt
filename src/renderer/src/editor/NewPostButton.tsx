import { Plus } from 'lucide-react'
import { Button } from '../ui'

/** The toolbars' New post button: labelled, or a 32px "+" on a narrow main card (OP-58). */
export function NewPostButton({
  compact,
  onClick
}: {
  compact: boolean
  onClick: () => void
}): React.JSX.Element {
  if (compact) {
    return (
      <Button
        type="button"
        variant="primary"
        className="size-[32px] shrink-0 !px-0"
        aria-label="New post"
        title="New post"
        onClick={onClick}
      >
        <Plus size={16} aria-hidden="true" />
      </Button>
    )
  }
  return (
    <Button type="button" variant="primary" className="shrink-0" onClick={onClick}>
      <Plus size={14} aria-hidden="true" />
      New post
    </Button>
  )
}
