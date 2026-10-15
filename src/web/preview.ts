export interface PreviewFrame {
  setDocument: (html: string) => void
  setTitle: (title: string) => void
  onReady: (ready: () => void) => void
  mount: (covered: boolean) => void
  afterPaint: (painted: () => void) => void
  show: () => void
  remove: () => void
}

/** Coordinates rendering independently of the DOM so visible-frame continuity is testable. */
export function createPreviewRenderer(makeFrame: () => PreviewFrame) {
  let current: PreviewFrame | undefined
  let pending: PreviewFrame | undefined
  let requested: string | undefined
  let disposed = false
  return {
    render(html: string, title: string) {
      if (disposed) return
      current?.setTitle(title)
      pending?.setTitle(title)
      if (html === requested) return
      requested = html
      pending?.remove()
      const next = makeFrame()
      pending = next
      next.setTitle(title)
      next.onReady(() => {
        if (disposed || pending !== next) {
          next.remove()
          return
        }
        next.afterPaint(() => {
          if (disposed || pending !== next) {
            next.remove()
            return
          }
          next.show()
          current?.remove()
          current = next
          pending = undefined
        })
      })
      next.setDocument(html)
      next.mount(true)
    },
    dispose() {
      disposed = true
      pending?.remove()
      current?.remove()
      pending = undefined
      current = undefined
    }
  }
}

export function createDOMPreview(surface: HTMLElement) {
  return createPreviewRenderer(() => {
    const iframe = document.createElement("iframe")
    iframe.setAttribute("sandbox", "")
    iframe.setAttribute("referrerpolicy", "no-referrer")
    iframe.setAttribute("tabindex", "-1")
    return {
      setDocument: html => {
        iframe.srcdoc = html
      },
      setTitle: title => {
        iframe.title = title
      },
      onReady: ready => {
        iframe.addEventListener("load", ready, { once: true })
      },
      // Keep replacements painted beneath the current frame until they are ready.
      mount: covered => {
        iframe.style.zIndex = covered ? "0" : "1"
        surface.append(iframe)
      },
      afterPaint: painted => {
        requestAnimationFrame(() => requestAnimationFrame(painted))
      },
      show: () => {
        iframe.style.zIndex = "1"
      },
      remove: () => {
        iframe.remove()
      }
    }
  })
}
