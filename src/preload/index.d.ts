import type { OpenCatApi } from '../shared/api'

declare global {
  interface Window {
    opencat: OpenCatApi
  }
}
