import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Orion view crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <section className="error-state" role="alert">
        <span className="error-state__icon" aria-hidden="true">
          <TriangleAlert size={26} />
        </span>
        <p className="eyebrow">Recoverable error</p>
        <h1>This view hit a snag.</h1>
        <p>
          The rest of Orion is still running. Try rendering the view again — your files and settings
          were not touched.
        </p>
        <div className="error-state__actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => this.setState({ error: null })}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Try again
          </button>
          <button
            className="button"
            type="button"
            onClick={() => window.location.assign('#/dashboard')}
          >
            Back to dashboard
          </button>
        </div>
        <details>
          <summary>Technical details</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </section>
    )
  }
}
