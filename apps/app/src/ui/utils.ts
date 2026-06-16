import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Joins classes conditionally and resolves Tailwind conflicts (shadcn pattern). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
