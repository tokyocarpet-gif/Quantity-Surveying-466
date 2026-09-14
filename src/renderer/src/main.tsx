import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import './style.css'
import './summary.css'
import './estimate.css'
import './takeoff/takeoff.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError(): { error: boolean } {
    return { error: true }
  }
  render(): React.ReactNode {
    if (this.state.error)
      return (
        <main className="startup">
          <h1>画面を表示できませんでした</h1>
          <p>保存済みのデータは保持されています。画面を読み直してください。</p>
          <button className="primary" onClick={() => location.reload()}>
            読み直す
          </button>
        </main>
      )
    return this.props.children
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
