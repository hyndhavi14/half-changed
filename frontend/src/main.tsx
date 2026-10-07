import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.tsx'
import DashboardPage from './pages/DashboardPage/DashboardPage.tsx'
import ProcessesPage from './pages/ProcessesPage/ProcessesPage.tsx'
import SchedulePage from './pages/SchedulePage/SchedulePage.tsx'
import EnergyPage from './pages/EnergyPage/EnergyPage.tsx'
import ComparePage from './pages/ComparePage/ComparePage.tsx'
import BuilderPage from './pages/BuilderPage/BuilderPage.tsx'
import FactoryViewPage from './pages/FactoryViewPage/FactoryViewPage.tsx'
import NotFoundPage from './pages/NotFoundPage/NotFoundPage.tsx'
import { FactoryProvider } from './context/FactoryContext.tsx'
import Phase6UatPage from './pages/Phase6UatPage.tsx'
import SolarShiftHistoricalPage from './pages/SolarShiftHistoricalPage.tsx'

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <FactoryProvider>
        <App />
      </FactoryProvider>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'processes', element: <ProcessesPage /> },
      { path: 'schedule', element: <SchedulePage /> },
      { path: 'energy', element: <EnergyPage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: 'builder', element: <BuilderPage /> },
      { path: 'factory-view', element: <FactoryViewPage /> },
      { path: 'solarshift-historical', element: <SolarShiftHistoricalPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/phase6',
    element: <Phase6UatPage />,
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
