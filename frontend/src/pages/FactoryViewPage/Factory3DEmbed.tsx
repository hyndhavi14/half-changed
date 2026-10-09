import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../../data/supabase'
import { factory3dEmbedUrl, factory3dUrl } from './factoryViewModel'
import styles from './FactoryViewPage.module.css'

interface Factory3DEmbedProps {
  baseUrl: string
  factoryId: string
  scheduleId: string
  /** Plan time shown in the 2D view; the 3D scene follows it. */
  at: number | null
  /** Called when the viewer moves the time inside the 3D scene. */
  onTimeChange?: (at: number) => void
}

type Phase = 'loading' | 'connected' | 'unreachable'

/**
 * Embeds the separate Factory-3D app and connects it to this page:
 * - hands over the signed-in session with postMessage (never in the URL), so no second sign-in;
 * - keeps the 3D plan time in step with the 2D time slider, both ways.
 * Messages are only sent to, and accepted from, the configured Factory-3D origin.
 */
export default function Factory3DEmbed({ baseUrl, factoryId, scheduleId, at, onTimeChange }: Factory3DEmbedProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const origin = new URL(baseUrl).origin
  const src = factory3dEmbedUrl(baseUrl, factoryId, scheduleId)
  const atRef = useRef(at)
  const timeChange = useRef(onTimeChange)
  useLayoutEffect(() => {
    atRef.current = at
    timeChange.current = onTimeChange
  })

  // The parent re-mounts this component (key) when the schedule changes, so phase starts at 'loading'.
  useEffect(() => {
    const post = (message: unknown) => frame.current?.contentWindow?.postMessage(message, origin)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return
      const data = event.data as { type?: unknown; at?: unknown } | null
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'byteme-3d-ready') {
        void supabase.auth.getSession().then(({ data: sessionData }) => {
          const session = sessionData.session
          if (session) post({ type: 'byteme-3d-session', accessToken: session.access_token, refreshToken: session.refresh_token })
          if (atRef.current !== null) post({ type: 'byteme-3d-time', at: atRef.current })
          setPhase('connected')
        })
      } else if (data.type === 'byteme-3d-time' && typeof data.at === 'number' && Number.isFinite(data.at)) {
        timeChange.current?.(data.at)
      }
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => setPhase((current) => (current === 'loading' ? 'unreachable' : current)), 15_000)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
    }
  }, [origin, src])

  useEffect(() => {
    if (phase === 'connected' && at !== null) frame.current?.contentWindow?.postMessage({ type: 'byteme-3d-time', at }, origin)
  }, [at, phase, origin])

  return (
    <div className={styles.embed}>
      <iframe ref={frame} className={styles.embedFrame} src={src} title="3D factory scene" allow="fullscreen" />
      {phase === 'loading' && <p className={styles.embedState} role="status">Loading the 3D factory…</p>}
      {phase === 'unreachable' && (
        <p className={styles.embedState} role="alert">
          The 3D app did not answer. Start it with <code>npm run dev</code> in the factory-3d folder (it runs on {origin}), then reload this page.
        </p>
      )}
      <a className={styles.embedLink} href={factory3dUrl(baseUrl, factoryId, scheduleId)} target="_blank" rel="noreferrer">Open 3D full screen ↗</a>
    </div>
  )
}
