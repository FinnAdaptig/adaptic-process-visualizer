import React, { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

// Schema shared with backend contract
export const PositionSchema = z.object({ x: z.number(), y: z.number() })
export const ElementSchema = z.object({
  id: z.string(),
  type: z.enum(['start_event', 'end_event', 'task', 'gateway']),
  label: z.string(),
  position: PositionSchema
})

export const SwimlaneSchema = z.object({
  id: z.string(),
  label: z.string(),
  elements: z.array(z.string())
})

export const ConnectionSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().optional()
})

export const ProcessSchema = z.object({
  processName: z.string(),
  swimlanes: z.array(SwimlaneSchema),
  elements: z.array(ElementSchema),
  connections: z.array(ConnectionSchema)
})

export type ProcessModel = z.infer<typeof ProcessSchema>

const initialModel: ProcessModel = {
  processName: 'Untitled Process',
  swimlanes: [
    { id: 'lane-1', label: 'Lane A', elements: ['start-1', 'task-1'] },
    { id: 'lane-2', label: 'Lane B', elements: ['end-1'] }
  ],
  elements: [
    { id: 'start-1', type: 'start_event', label: 'Start', position: { x: 80, y: 80 } },
    { id: 'task-1', type: 'task', label: 'Task', position: { x: 240, y: 70 } },
    { id: 'end-1', type: 'end_event', label: 'End', position: { x: 420, y: 80 } }
  ],
  connections: [
    { source: 'start-1', target: 'task-1' },
    { source: 'task-1', target: 'end-1' }
  ]
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'

export const App: React.FC = () => {
  const [model, setModel] = useState<ProcessModel>(initialModel)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  const SIDEBAR_WIDTH = 280
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    const s = localStorage.getItem('sidebarOpen')
    return s ? s === '1' : false
  })
  const [isMobile, setIsMobile] = useState<boolean>(() => window.matchMedia('(max-width: 900px)').matches)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeWorkflowId, setActiveWorkflowId] = useState<number | null>(null)
  const [library, setLibrary] = useState<Array<{ departmentId: number; departmentName: string; workflows: Array<{ id: number; name: string; updatedAt: string }> }>>([])
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [sidebarOpen])

  // Load library once
  useEffect(() => {
    fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => {})
  }, [])

  // Prevent unload with unsaved changes
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (saving === 'saving') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [saving])

  function toggleSidebar() {
    const next = !sidebarOpen
    setSidebarOpen(next)
    localStorage.setItem('sidebarOpen', next ? '1' : '0')
  }

  async function loadWorkflow(id: number) {
    const res = await fetch(`${API_BASE}/api/workflows/${id}`)
    if (!res.ok) throw new Error('Failed to load workflow')
    const wf = await res.json()
    const parsed = ProcessSchema.parse(wf.json)
    setActiveWorkflowId(wf.id)
    setModel(parsed)
    setSelectedKey(String(wf.id))
  }

  async function sendInstruction(text: string) {
    if (!text.trim()) return
    setMessages((m) => [...m, text.trim()])
    setInput('')
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/assistant/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: text })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const parsed = ProcessSchema.parse(data)
      setModel(parsed)
      if (activeWorkflowId != null) scheduleSave(activeWorkflowId, parsed)
    } catch (e: any) {
      setError(e?.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Debounced save of active workflow
  const saveTimer = useRef<number | null>(null)
  const pendingSaveRef = useRef<{ id: number; json: ProcessModel } | null>(null)
  function scheduleSave(id: number, json: ProcessModel) {
    setSaving('saving')
    setSaveError(null)
    pendingSaveRef.current = { id, json }
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      try {
        const body = JSON.stringify({ json })
        const res = await fetch(`${API_BASE}/api/workflows/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
        if (!res.ok) throw new Error(`Save failed (${res.status})`)
        setSaving('saved')
        // refresh library to update timestamps
        fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => {})
      } catch (e: any) {
        setSaving('error')
        setSaveError(e?.message || 'Save failed')
      }
    }, 700)
  }

  // Always reserve a minimal left stripe for the hamburger icon
  const MIN_STRIPE = 48
  const templateCols = !isMobile
    ? (sidebarOpen
        ? `${SIDEBAR_WIDTH}px 360px 1fr`
        : `${MIN_STRIPE}px 360px 1fr`)
    : '360px 1fr'

  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: templateCols, height: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Minimal left stripe always present (desktop only) */}
      {!isMobile && (
        <div style={{ width: MIN_STRIPE, background: '#fff', borderRight: '1px solid #e5e7eb', position: 'relative', gridColumn: '1 / 2', zIndex: 1 }}>
          <button
            aria-label="Toggle process library"
            onClick={toggleSidebar}
            style={{ position: 'absolute', top: 8, left: 8, width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
        </div>
      )}
      {/* Sidebar when open (desktop only) */}
      {!isMobile && sidebarOpen && (
        <div style={{ borderRight: '1px solid #e5e7eb', padding: 12, overflowY: 'auto', width: SIDEBAR_WIDTH, position: 'relative', gridColumn: '1 / 2', zIndex: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, gap: 12 }}>
              <strong style={{ flex: 1, textAlign: 'center', fontSize: 18 }}>Workflows</strong>
              <button
                onClick={async () => {
                const dept = library[0]
                if (!dept) return
                const res = await fetch(`${API_BASE}/api/workflows`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: 'New Workflow', departmentId: dept.departmentId, json: initialModel })
                })
                if (res.ok) {
                  const created = await res.json()
                  setActiveWorkflowId(created.id)
                  setModel(ProcessSchema.parse(created.jsonContent))
                  // optimistic insert
                  setLibrary((prev) => prev.map((d) => d.departmentId === dept.departmentId ? { ...d, workflows: [{ id: created.id, name: created.name, updatedAt: created.updatedAt }, ...d.workflows] } : d))
                }
              }}
              style={{ fontSize: 12 }}
            >New</button>
          </div>
          {library.map((dept) => (
            <div key={dept.departmentId} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#6b7280', margin: '8px 0' }}>{dept.departmentName}</div>
              {dept.workflows.map((wf) => {
                const sel = activeWorkflowId === wf.id
                return (
                  <div
                    key={wf.id}
                    onClick={() => loadWorkflow(wf.id)}
                    style={{ cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: sel ? '#e0f2fe' : 'transparent' }}
                  >
                    <div style={{ fontSize: 14 }}>{wf.name}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{new Date(wf.updatedAt).toLocaleString()}</div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Chat column (unchanged) */}
      <div style={{ borderRight: '1px solid #e5e7eb', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
    <h2 style={{ margin: 0, textAlign: 'center', fontSize: 20 }}>Chat</h2>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
          {messages.length === 0 && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>Your messages will appear here.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ alignSelf: 'flex-end', background: '#e0f2fe', color: '#0c4a6e', padding: '8px 10px', borderRadius: 10, maxWidth: '85%' }}>
              {m}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendInstruction(input) }}
            placeholder="e.g., Add a task 'Review' in Lane A and connect after Start"
            style={{ flex: 1, padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
          <button disabled={loading || !input.trim()} onClick={() => sendInstruction(input)} style={{ padding: '8px 12px' }}>
            {loading ? 'Working…' : 'Send'}
          </button>
        </div>
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Model is authoritative; server validates and returns updated JSON. {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <Canvas model={model} />
      </div>

      {/* Mobile overlay sidebar */}
      {isMobile && (
        <>
          {/* Backdrop */}
          {sidebarOpen && (
            <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 20 }} />
          )}
          {/* Panel */}
          <div
            style={{
              position: 'fixed', left: 0, top: 0, bottom: 0, width: SIDEBAR_WIDTH,
              background: '#fff', borderRight: '1px solid #e5e7eb', padding: 12, overflowY: 'auto', zIndex: 25,
              transform: `translateX(${sidebarOpen ? '0' : '-100%'})`, transition: 'transform 200ms ease-in-out'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>Workflows</strong>
              <button
                onClick={async () => {
                  const dept = library[0]
                  if (!dept) return
                  const res = await fetch(`${API_BASE}/api/workflows`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'New Workflow', departmentId: dept.departmentId, json: initialModel })
                  })
                  if (res.ok) {
                    const created = await res.json()
                    setActiveWorkflowId(created.id)
                    setModel(ProcessSchema.parse(created.jsonContent))
                    setLibrary((prev) => prev.map((d) => d.departmentId === dept.departmentId ? { ...d, workflows: [{ id: created.id, name: created.name, updatedAt: created.updatedAt }, ...d.workflows] } : d))
                  }
                }}
                style={{ fontSize: 12 }}
              >New</button>
            </div>
            {library.map((dept) => (
              <div key={dept.departmentId} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#6b7280', margin: '8px 0' }}>{dept.departmentName}</div>
                {dept.workflows.map((wf) => {
                  const sel = activeWorkflowId === wf.id
                  return (
                    <div
                      key={wf.id}
                      onClick={() => { loadWorkflow(wf.id); setSidebarOpen(false) }}
                      style={{ cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: sel ? '#e0f2fe' : 'transparent' }}
                    >
                      <div style={{ fontSize: 14 }}>{wf.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{new Date(wf.updatedAt).toLocaleString()}</div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Save error toast */}
      {saving === 'error' && (
        <div style={{ position: 'fixed', left: 16, bottom: 16, background: '#fee2e2', color: '#7f1d1d', padding: '10px 12px', border: '1px solid #fecaca', borderRadius: 8, zIndex: 40 }}>
          <div style={{ marginBottom: 6 }}>Save failed: {saveError}</div>
          <button onClick={() => { const p = pendingSaveRef.current; if (p) scheduleSave(p.id, p.json) }} style={{ fontSize: 12 }}>Retry</button>
        </div>
      )}
    </div>
  )
}

const laneHeight = 140
const laneGap = 24 // Increased gap for more vertical space
const laneHeaderWidth = 120
const minElementGap = 32 // Minimum horizontal gap between elements
const fontFamily = 'Inter, system-ui, sans-serif'

const Canvas: React.FC<{ model: ProcessModel }> = ({ model }) => {
  const width = 1200
  const height = model.swimlanes.length * laneHeight + (model.swimlanes.length + 1) * laneGap

  const idToElement = useMemo(() => new Map(model.elements.map((e) => [e.id, e])), [model.elements])
  const elementIdToLaneIndex = useMemo(() => {
    const map = new Map<string, number>()
    model.swimlanes.forEach((lane, idx) => lane.elements.forEach((id) => map.set(id, idx)))
    return map
  }, [model.swimlanes])

  function laneY(index: number) {
    return laneGap + index * (laneHeight + laneGap)
  }

  // Improved layout: always enforce non-overlapping elements horizontally
  const layoutMap = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>()
    const minX = laneGap + laneHeaderWidth + 16
    const rightMargin = 32
    const shapeSize = (el: z.infer<typeof ElementSchema>) => {
      switch (el.type) {
        case 'task': return { w: 160, h: 60 }
        case 'start_event':
        case 'end_event': return { w: 40, h: 40 }
        case 'gateway': return { w: 56, h: 56 }
      }
    }
    const laneCount = Math.max(model.swimlanes.length, 1)
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
      const laneElems = model.swimlanes[laneIndex]?.elements ?? []
      const records = laneElems
        .map((id) => idToElement.get(id))
        .filter(Boolean) as z.infer<typeof ElementSchema>[]
      // Establish base positions and dimensions
      const items = records.map((el) => {
        const size = shapeSize(el)
        const baseY = el.type === 'task' ? laneY(laneIndex) + (laneHeight - size.h) / 2 : laneY(laneIndex) + (laneHeight - size.h) / 2
        // Ignore el.position.x for layout, always auto-pack
        return { el, w: size.w, h: size.h, baseY, x: 0, y: 0 }
      })
      // Pack horizontally with enforced gap
      let cursorX = minX
      for (const item of items) {
        const maxX = width - rightMargin - item.w
        const x = Math.min(cursorX, maxX)
        const y = item.baseY
        item.x = x
        item.y = y
        cursorX = x + item.w + minElementGap
      }
      // Write back
      items.forEach((it) => positions.set(it.el.id, { x: it.x, y: it.y }))
    }
    // Fallback for elements not listed in any lane
    model.elements.forEach((el) => {
      if (!positions.has(el.id)) {
        const laneIndex = elementIdToLaneIndex.get(el.id) ?? 0
        const size = shapeSize(el)
        const y = laneY(laneIndex) + (laneHeight - size.h) / 2
        positions.set(el.id, { x: minX, y })
      }
    })
    return positions
  }, [model, elementIdToLaneIndex, idToElement])

  function getElementRenderPosition(el: z.infer<typeof ElementSchema>): { x: number; y: number } {
    return layoutMap.get(el.id) ?? { x: laneGap + laneHeaderWidth + 16, y: laneGap }
  }

  return (
    <svg width={width} height={height} style={{ background: '#fff', fontFamily }}>
      {/* Swimlanes */}
      {model.swimlanes.map((lane, i) => (
        <g key={lane.id}>
          <rect x={laneGap} y={laneY(i)} width={laneHeaderWidth} height={laneHeight} fill="#f3f4f6" stroke="#d1d5db" />
          <text x={laneGap + laneHeaderWidth / 2} y={laneY(i) + laneHeight / 2} textAnchor="middle" dominantBaseline="middle" fontSize={15} fill="#374151" style={{ fontFamily }}>
            {lane.label}
          </text>
          <rect x={laneGap + laneHeaderWidth} y={laneY(i)} width={width - laneHeaderWidth - 2 * laneGap} height={laneHeight} fill="#ffffff" stroke="#d1d5db" />
        </g>
      ))}

      {/* Connections */}
      {model.connections.map((c, idx) => {
        const s = idToElement.get(c.source)
        const t = idToElement.get(c.target)
        if (!s || !t) return null
        const sPos = getElementRenderPosition(s)
        const tPos = getElementRenderPosition(t)
        const sc = getElementCenter(s, sPos)
        const tc = getElementCenter(t, tPos)
        // Compute boundary intersections so lines meet the shape edges
        const sp = getBoundaryPoint(s, sPos, tc)
        const tp = getBoundaryPoint(t, tPos, sc)
        const midX = (sp.x + tp.x) / 2
        const path = `M ${sp.x} ${sp.y} C ${midX} ${sp.y}, ${midX} ${tp.y}, ${tp.x} ${tp.y}`
        // Basic label displacement to avoid overlapping shapes
        let labelX = midX
        let labelY = (sp.y + tp.y) / 2 - 6
        const elementBoxes = model.elements.map((el) => {
          const p = getElementRenderPosition(el)
          switch (el.type) {
            case 'task': return { x: p.x, y: p.y, w: 160, h: 60 }
            case 'start_event':
            case 'end_event': return { x: p.x + 2, y: p.y + 2, w: 36, h: 36 }
            case 'gateway': return { x: p.x - 6, y: p.y - 6, w: 68, h: 68 }
          }
        })
        const overlaps = elementBoxes.some((b) => labelX >= b.x && labelX <= b.x + b.w && labelY >= b.y && labelY <= b.y + b.h)
        if (overlaps) labelY -= 14
        return (
          <g key={idx}>
            <path d={path} stroke="#111827" strokeWidth={1.5} fill="none" markerEnd="url(#arrow)" />
            {c.label && (
              <text x={labelX} y={labelY} textAnchor="middle" fontSize={13} fill="#374151" style={{ pointerEvents: 'none', fontFamily }}>{c.label}</text>
            )}
          </g>
        )
      })}

      <defs>
        <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto">
          <path d="M 0 0 L 12 6 L 0 12 z" fill="#111827" />
        </marker>
      </defs>

      {/* Elements */}
      {model.elements.map((el) => (
        <ElementNode key={el.id} element={el} getPos={getElementRenderPosition} />
      ))}
    </svg>
  )
}

function getAnchorPoint(el: z.infer<typeof ElementSchema>, renderPos?: { x: number; y: number }): { x: number; y: number } {
  const base = renderPos ?? el.position
  const { x, y } = base
  switch (el.type) {
    case 'start_event':
    case 'end_event':
      return { x: x + 20, y: y + 20 }
    case 'task':
      return { x: x + 80, y: y + 30 }
    case 'gateway':
      return { x: x + 28, y: y + 28 }
  }
}

function getElementCenter(el: z.infer<typeof ElementSchema>, renderPos?: { x: number; y: number }): { x: number; y: number } {
  const p = renderPos ?? el.position
  switch (el.type) {
    case 'task':
      return { x: p.x + 80, y: p.y + 30 }
    case 'gateway':
      return { x: p.x + 28, y: p.y + 28 }
    case 'start_event':
    case 'end_event':
      return { x: p.x + 20, y: p.y + 20 }
  }
}

function getBoundaryPoint(
  el: z.infer<typeof ElementSchema>,
  renderPos: { x: number; y: number },
  toward: { x: number; y: number }
): { x: number; y: number } {
  const c = getElementCenter(el, renderPos)
  let dx = toward.x - c.x
  let dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c

  switch (el.type) {
    case 'task': {
      const halfWidth = 80, halfHeight = 30
      const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight)
      return { x: c.x + dx * scale, y: c.y + dy * scale }
    }
    case 'start_event':
    case 'end_event': {
      const r = 18
      const len = Math.hypot(dx, dy) || 1
      const scale = r / len
      return { x: c.x + dx * scale, y: c.y + dy * scale }
    }
    case 'gateway': {
      const a = 28 // diamond radius along axes
      const denom = Math.abs(dx) + Math.abs(dy) || 1
      const scale = a / denom
      return { x: c.x + dx * scale, y: c.y + dy * scale }
    }
  }
}

const ElementNode: React.FC<{ element: z.infer<typeof ElementSchema>; getPos: (e: z.infer<typeof ElementSchema>) => { x: number; y: number } }> = ({ element, getPos }) => {
  const { type, label } = element
  const { x, y } = getPos(element)
  switch (type) {
    case 'start_event':
      return (
        <g>
          <circle cx={x + 20} cy={y + 20} r={18} fill="#10b98120" stroke="#059669" />
          <text x={x + 20} y={y + 48} textAnchor="middle" fontSize={13} fill="#065f46" style={{ pointerEvents: 'none', fontFamily }}>{label}</text>
        </g>
      )
    case 'end_event':
      return (
        <g>
          <circle cx={x + 20} cy={y + 20} r={18} fill="#ef444420" stroke="#dc2626" strokeWidth={2} />
          <text x={x + 20} y={y + 48} textAnchor="middle" fontSize={13} fill="#7f1d1d" style={{ pointerEvents: 'none', fontFamily }}>{label}</text>
        </g>
      )
    case 'task':
      return (
        <g>
          <rect x={x} y={y} width={160} height={60} rx={8} ry={8} fill="#e0f2fe" stroke="#0284c7" />
          <text x={x + 80} y={y + 34} textAnchor="middle" fontSize={15} fill="#0c4a6e" style={{ pointerEvents: 'none', fontFamily }}>{label}</text>
        </g>
      )
    case 'gateway':
      return (
        <g>
          <rect x={x} y={y} width={56} height={56} transform={`rotate(45 ${x + 28} ${y + 28})`} fill="#fef3c7" stroke="#d97706" />
          <text x={x + 28} y={y + 70} textAnchor="middle" fontSize={13} fill="#92400e" style={{ pointerEvents: 'none', fontFamily }}>{label}</text>
        </g>
      )
  }
}


