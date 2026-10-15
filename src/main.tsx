import { render } from "@gpuix/react"
import React from "react"
import { App } from "./App"

render(<App />, {
  title: "Blackboard",
  width: 1024,
  height: 720,
  focus: process.env.GPUIX_BACKGROUND !== "1",
})
