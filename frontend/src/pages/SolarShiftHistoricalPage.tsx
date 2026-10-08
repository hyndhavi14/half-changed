import PageHeader from '../components/PageHeader/PageHeader'
import HistoricalReplay from './HistoricalReplay'

/** Public, no-login route for the historical replay. The same view is embedded on the SolarShift page. */
export default function SolarShiftHistoricalPage() {
  return (
    <>
      <PageHeader eyebrow="SolarShift historical replay · public" title="Historical SolarShift" />
      <HistoricalReplay />
    </>
  )
}
