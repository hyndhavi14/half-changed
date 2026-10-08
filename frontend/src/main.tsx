import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.tsx'
import DashboardPage from './pages/DashboardPage/DashboardPage.tsx'
import ProcessesPage from './pages/ProcessesPage/ProcessesPage.tsx'
import SchedulePage from './pages/SchedulePage/SchedulePage.tsx'
import EnergyPage from './pages/EnergyPage/EnergyPage.tsx'
import BuilderPage from './pages/BuilderPage/BuilderPage.tsx'
import FactoryViewPage from './pages/FactoryViewPage/FactoryViewPage.tsx'
import NotFoundPage from './pages/NotFoundPage/NotFoundPage.tsx'
import { FactoryProvider } from './context/FactoryContext.tsx'
import Phase6UatPage from './pages/Phase6UatPage.tsx'
import SolarShiftHistoricalPage from './pages/SolarShiftHistoricalPage.tsx'
import SolarShiftPage from './pages/SolarShiftPage/SolarShiftPage.tsx'

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
      { path: 'factory', element: <ProcessesPage /> },
      { path: 'schedule', element: <SchedulePage /> },
      { path: 'energy', element: <EnergyPage /> },
      { path: 'solarshift', element: <SolarShiftPage /> },
      { path: '3d', element: <FactoryViewPage /> },
      // Kept routes: the builder stays reachable by URL; old links redirect to the merged pages.
      { path: 'builder', element: <BuilderPage /> },
      { path: 'processes', element: <Navigate to="/factory" replace /> },
      { path: 'compare', element: <Navigate to="/schedule" replace /> },
      { path: 'factory-view', element: <Navigate to="/3d" replace /> },
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
