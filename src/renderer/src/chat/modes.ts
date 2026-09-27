import { Clapperboard, Image as ImageIcon, Type } from 'lucide-react'
import type { ComposerMode } from '@shared/api'

/** Pencil "OP-79 · Composer modes": each mode's words and icon. */
export const MODE_COPY: Record<
  ComposerMode,
  { label: string; placeholder: string; send: string; chip: string | null }
> = {
  text: { label: 'Text', placeholder: 'Describe the post…', send: 'Send', chip: null },
  image: {
    label: 'Generate image',
    placeholder: 'Describe the image to make with the post…',
    send: 'Send and make the image',
    chip: 'Image'
  },
  video: {
    label: 'Generate video',
    placeholder: 'Describe the video to make with the post…',
    send: 'Send and make the video',
    chip: 'Video'
  }
}

export const MODE_ICON: Record<ComposerMode, typeof Type> = {
  text: Type,
  image: ImageIcon,
  video: Clapperboard
}
