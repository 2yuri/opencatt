// Vite's `?raw` imports: a file's text, bundled into main at build time (OP-81's vendored files).
declare module '*?raw' {
  const text: string
  export default text
}
