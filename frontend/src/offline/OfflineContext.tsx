import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { countPendingOutbox } from './db'
import { syncOutboxToServer } from './syncOutbox'
import { useToast } from '../Toast'

type OfflineContextValue = {
  online: boolean
  pendingOutboxCount: number
  isSyncing: boolean
  refreshPendingCount: () => Promise<void>
  syncNow: () => Promise<void>
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

export function OfflineProvider({ token, children }: { token: string | null; children: ReactNode }) {
  const showToast = useToast()
  const [online, setOnline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine,
  )
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const prevOnlineRef = useRef(online)
  const initialSyncDoneRef = useRef(false)

  useEffect(() => {
    initialSyncDoneRef.current = false
  }, [token])

  const refreshPendingCount = useCallback(async () => {
    try {
      setPendingOutboxCount(await countPendingOutbox())
    } catch {
      setPendingOutboxCount(0)
    }
  }, [])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    void refreshPendingCount()
  }, [refreshPendingCount, online])

  const syncNow = useCallback(async () => {
    if (!token || !navigator.onLine) return
    setIsSyncing(true)
    try {
      const r = await syncOutboxToServer(token)
      await refreshPendingCount()
      if (r.errors.length > 0) {
        showToast(`Sync finished with ${r.errors.length} error(s). Check console.`, 'error')
        console.error('[pos sync]', r.errors)
      } else if (r.placed > 0 || r.refunded > 0) {
        showToast(
          `Synced to server: ${r.placed} order(s) uploaded, ${r.refunded} refund(s).`,
          'success',
        )
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Sync failed', 'error')
    } finally {
      setIsSyncing(false)
    }
  }, [token, refreshPendingCount, showToast])

  useEffect(() => {
    if (!token) {
      initialSyncDoneRef.current = false
      return
    }
    if (!online || initialSyncDoneRef.current) return
    initialSyncDoneRef.current = true
    void (async () => {
      if ((await countPendingOutbox()) > 0) {
        await syncNow()
      }
    })()
  }, [token, online, syncNow])

  useEffect(() => {
    const wasOffline = !prevOnlineRef.current
    prevOnlineRef.current = online
    if (token && wasOffline && online) {
      void syncNow()
    }
  }, [online, token, syncNow])

  const value = useMemo(
    () => ({
      online,
      pendingOutboxCount,
      isSyncing,
      refreshPendingCount,
      syncNow,
    }),
    [online, pendingOutboxCount, isSyncing, refreshPendingCount, syncNow],
  )

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext)
  if (!ctx) {
    return {
      online: typeof navigator !== 'undefined' && navigator.onLine,
      pendingOutboxCount: 0,
      isSyncing: false,
      refreshPendingCount: async () => {},
      syncNow: async () => {},
    }
  }
  return ctx
}
