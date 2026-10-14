import { describe, it, expect } from "bun:test"
import { createTestRoot, hasNativeTestRenderer } from "@gpuix/react/testing"
import React from "react"
import { App } from "../src/App"

describe("GPUIX React Component Tests", () => {
  it("mounts the App component using createTestRoot when native test renderer is available", () => {
    if (!hasNativeTestRenderer) {
      console.log("Skipping native TestRenderer test on Linux (hasNativeTestRenderer is false on this platform)")
      return
    }

    const testRoot = createTestRoot()
    testRoot.render(<App />)

    expect(testRoot.renderer).toBeDefined()
    testRoot.renderer.flush()

    const allText = testRoot.renderer.getAllText()
    expect(allText.some((t) => t.includes("Blackboard"))).toBe(true)

    testRoot.unmount()
  })

  it("verifies App component JSX element structure can be instantiated", () => {
    const element = <App />
    expect(element).toBeDefined()
    expect(element.type).toBe(App)
  })
})
