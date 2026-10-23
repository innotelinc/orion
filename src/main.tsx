import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import './styles/global.css'
import './styles/dashboard.css'
import './styles/files.css'
import './styles/store.css'
import './styles/storage.css'
import './styles/settings.css'
import App from './App'
import { AppProvider } from './context/AppContext'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
