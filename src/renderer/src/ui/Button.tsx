import type { ButtonHTMLAttributes } from 'react'
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonClass'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** Design v2 button (OpenCat.pen "Section Components"). type defaults to "button". */
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />
}
