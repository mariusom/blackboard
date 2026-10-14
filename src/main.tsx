import { render } from "@gpuix/react"
import React from "react"
import { App } from "./App"

render(<App />, {
  title: "Blackboard",
  width: 760,
  height: 640,
  focus: process.env.GPUIX_BACKGROUND !== "1",
})
