import React from 'react'
import { FloatingBall } from './components/FloatingBall'
import { MainWindow } from './components/MainWindow'

const view = new URLSearchParams(window.location.search).get('view')

function App(): React.JSX.Element {
  if (view === 'main') return <MainWindow />
  return <FloatingBall />
}

export default App
