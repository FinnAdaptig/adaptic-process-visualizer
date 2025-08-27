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

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8082'

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeWorkflowId, setActiveWorkflowId] = useState<number | null>(null)
  const [library, setLibrary] = useState<Array<{ departmentId: number; departmentName: string; workflows: Array<{ id: string; name: string; updatedAt: string }> }>>([])
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  
  // Version history states
  const [history, setHistory] = useState<ProcessModel[]>([initialModel])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [historyAction, setHistoryAction] = useState<'none' | 'undo' | 'redo'>('none')

  // Enhanced database version history
  const [versionHistory, setVersionHistory] = useState<Array<{
    id: string
    versionNumber: number
    jsonContent: ProcessModel
    changeNote?: string
    createdAt: string
    createdBy?: { id: number; name: string; email: string }
  }>>([])
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  
  // Workflow management states
  const [editingWorkflowId, setEditingWorkflowId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [sidebarOpen])
  
  // Add keyboard shortcuts for history navigation (Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Check for Ctrl+Z or Cmd+Z (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        goBackInHistory()
      }
      // Check for Ctrl+Y or Cmd+Shift+Z (Mac)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        goForwardInHistory()
      }
    }
    
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [historyIndex, history.length])

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
  
  // Version history functions
  function updateModelWithHistory(newModel: ProcessModel) {
    // When setting a new model, truncate any future history
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(newModel)
    setModel(newModel)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }
  
  function goBackInHistory() {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setModel(history[newIndex])
      setHistoryAction('undo')
      
      // Clear the history action after a delay
      setTimeout(() => setHistoryAction('none'), 2000)
      
      // Save the reverted state if this is an active workflow
      if (activeWorkflowId != null) {
        scheduleSave(activeWorkflowId, history[newIndex]);
      }
    }
  }
  
  function goForwardInHistory() {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      setModel(history[newIndex])
      setHistoryAction('redo')
      
      // Clear the history action after a delay
      setTimeout(() => setHistoryAction('none'), 2000)
      
      // Save the restored state if this is an active workflow
      if (activeWorkflowId != null) {
        scheduleSave(activeWorkflowId, history[newIndex]);
      }
    }
  }

  async function loadWorkflow(id: number) {
    const res = await fetch(`${API_BASE}/api/workflows/${id}`)
    if (!res.ok) throw new Error('Failed to load workflow')
    const wf = await res.json()
    const parsed = ProcessSchema.parse(wf.json)
    setActiveWorkflowId(wf.id)
    
    // Reset history when loading a new workflow
    setHistory([parsed])
    setHistoryIndex(0)
    setModel(parsed)
    setSelectedKey(String(wf.id))
    
    // Load database version history for this workflow
    if (typeof wf.id === 'string') {
      await loadVersionHistory(wf.id)
    }
  }

  // Load version history for active workflow
  async function loadVersionHistory(workflowId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}/versions`)
      if (res.ok) {
        const versions = await res.json()
        setVersionHistory(versions)
      }
    } catch (e) {
      console.error('Failed to load version history:', e)
    }
  }

  // Restore to a specific version
  async function restoreToVersion(workflowId: string, versionNumber: number) {
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}/restore/${versionNumber}`, {
        method: 'POST'
      })
      if (res.ok) {
        const result = await res.json()
        // Reload the workflow to get the restored version
        if (activeWorkflowId) {
          await loadWorkflow(activeWorkflowId)
        }
        // Refresh library
        fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => {})
        
        // Show success message
        console.log(`Restored to version ${versionNumber}, created new version ${result.newVersionNumber}`)
      } else {
        throw new Error('Failed to restore version')
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to restore version')
    }
  }

  async function deleteWorkflow(workflowId: string) {
    if (!confirm('Are you sure you want to delete this workflow?')) return
    
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete workflow')
      
      // If this was the active workflow, clear it
      if (activeWorkflowId === parseInt(workflowId.replace('workflow_', ''))) {
        setActiveWorkflowId(null)
        setModel(initialModel)
        setHistory([initialModel])
        setHistoryIndex(0)
      }
      
      // Refresh the library
      fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => {})
    } catch (e: any) {
      alert(`Failed to delete workflow: ${e.message}`)
    }
  }

  async function startRenaming(workflowId: string, currentName: string) {
    setEditingWorkflowId(parseInt(workflowId.replace('workflow_', '')))
    setEditingName(currentName)
  }

  async function saveRename(workflowId: string) {
    if (!editingName.trim()) return
    
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName.trim() })
      })
      if (!res.ok) throw new Error('Failed to rename workflow')
      
      setEditingWorkflowId(null)
      setEditingName('')
      
      // Refresh the library
      fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => {})
    } catch (e: any) {
      alert(`Failed to rename workflow: ${e.message}`)
    }
  }

  function cancelRename() {
    setEditingWorkflowId(null)
    setEditingName('')
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
      
      // Update model with history tracking
      updateModelWithHistory(parsed)
      
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
  const templateCols = sidebarOpen
    ? `${SIDEBAR_WIDTH}px 360px 1fr`
    : `${MIN_STRIPE}px 360px 1fr`

  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: templateCols, height: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Minimal left stripe always present */}
      <div style={{ width: MIN_STRIPE, background: '#fff', borderRight: '1px solid #e5e7eb', position: 'relative', gridColumn: '1 / 2', zIndex: 1 }}>
        <button
          aria-label="Toggle process library"
          onClick={toggleSidebar}
          style={{ position: 'absolute', top: 8, left: 8, width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
      </div>
      {/* Sidebar when open */}
      {sidebarOpen && (
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
                  
                  const newModel = ProcessSchema.parse(created.jsonContent)
                  // Reset history when creating a new workflow
                  setHistory([newModel])
                  setHistoryIndex(0)
                  setModel(newModel)
                  
                  // Refresh the library to show new workflow
                  fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => {})
                }
              }}
              style={{ 
                fontSize: 12, 
                padding: '4px 12px', 
                border: '1px solid #d1d5db', 
                borderRadius: 4, 
                cursor: 'pointer',
                backgroundColor: 'white'
              }}
            >New</button>
          </div>
          {library.map((dept) => (
            <div key={dept.departmentId} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#6b7280', margin: '8px 0' }}>{dept.departmentName}</div>
              {dept.workflows.map((wf) => {
                const numericId = parseInt(wf.id.replace('workflow_', ''))
                const sel = activeWorkflowId === numericId
                const isEditing = editingWorkflowId === numericId
                return (
                  <div
                    key={wf.id}
                    style={{ 
                      padding: '6px 8px', 
                      borderRadius: 6, 
                      background: sel ? '#e0f2fe' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(wf.id)
                            if (e.key === 'Escape') cancelRename()
                          }}
                          onBlur={() => saveRename(wf.id)}
                          autoFocus
                          style={{ 
                            width: '100%', 
                            fontSize: 14, 
                            border: '1px solid #d1d5db', 
                            borderRadius: 4, 
                            padding: '2px 4px' 
                          }}
                        />
                      ) : (
                        <div
                          onClick={() => isEditing ? undefined : loadWorkflow(numericId)}
                          onDoubleClick={() => startRenaming(wf.id, wf.name)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div style={{ fontSize: 14, fontWeight: sel ? 'bold' : 'normal' }}>{wf.name}</div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>{new Date(wf.updatedAt).toLocaleString()}</div>
                        </div>
                      )}
                    </div>
                    {!isEditing && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startRenaming(wf.id, wf.name)
                          }}
                          style={{
                            padding: '4px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Rename"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="m18.5 2.5-6 6L8 11l1 1 2.5-4.5L18.5 2.5z"></path>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteWorkflow(wf.id)
                          }}
                          style={{
                            padding: '4px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Delete"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3,6 5,6 21,6"></polyline>
                            <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Chat column with history controls */}
      <div style={{ borderRight: '1px solid #e5e7eb', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Chat</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', backgroundColor: '#f9fafb', padding: '5px 8px', borderRadius: 6 }}>
            <span style={{ fontSize: 13, marginRight: 4, fontWeight: 'bold' }}>History:</span>
            <button 
              onClick={goBackInHistory} 
              disabled={historyIndex <= 0}
              style={{ 
                padding: '6px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: historyIndex <= 0 ? '#f3f4f6' : 'white',
                cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer',
                opacity: historyIndex <= 0 ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              title="Undo (Ctrl+Z)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10h10a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5h-4"></path>
                <path d="M7 15l-4-4 4-4"></path>
              </svg>
              <span style={{ marginLeft: 4, fontSize: 13 }}>Undo</span>
            </button>
            <button 
              onClick={goForwardInHistory} 
              disabled={historyIndex >= history.length - 1}
              style={{ 
                padding: '6px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: historyIndex >= history.length - 1 ? '#f3f4f6' : 'white',
                cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
                opacity: historyIndex >= history.length - 1 ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              title="Redo (Ctrl+Y)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10H11a5 5 0 0 0-5 5v2a5 5 0 0 0 5 5h4"></path>
                <path d="M17 15l4-4-4-4"></path>
              </svg>
              <span style={{ marginLeft: 4, fontSize: 13 }}>Redo</span>
            </button>
            <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 4, fontWeight: 'bold' }}>
              {historyIndex + 1}/{history.length}
            </span>
            
            {/* Version History Button */}
            <button
              onClick={() => {
                if (activeWorkflowId && typeof activeWorkflowId === 'string') {
                  loadVersionHistory(activeWorkflowId)
                }
                setShowVersionHistory(!showVersionHistory)
              }}
              disabled={!activeWorkflowId}
              style={{
                padding: '6px 10px',
                marginLeft: 8,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: !activeWorkflowId ? '#f3f4f6' : 'white',
                cursor: !activeWorkflowId ? 'not-allowed' : 'pointer',
                opacity: !activeWorkflowId ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              title="Version History"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12,6 12,12 16,14"></polyline>
              </svg>
              <span style={{ marginLeft: 4, fontSize: 12 }}>History</span>
            </button>
          </div>
          
          {/* Version History Panel */}
          {showVersionHistory && activeWorkflowId && (
            <div style={{
              position: 'absolute',
              top: 70,
              right: 10,
              width: 320,
              maxHeight: 400,
              background: 'white',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 1000,
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid #e5e7eb',
                background: '#f9fafb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 'bold' }}>Version History</h3>
                <button
                  onClick={() => setShowVersionHistory(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    borderRadius: 4
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {versionHistory.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                    No version history available
                  </div>
                ) : (
                  versionHistory.map((version, index) => (
                    <div
                      key={version.id}
                      style={{
                        padding: '12px 16px',
                        borderBottom: index < versionHistory.length - 1 ? '1px solid #f3f4f6' : 'none',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#f9fafb'}
                      onMouseLeave={(e) => (e.target as HTMLElement).style.background = 'white'}
                      onClick={() => {
                        if (activeWorkflowId && typeof activeWorkflowId === 'string') {
                          restoreToVersion(activeWorkflowId, version.versionNumber)
                          setShowVersionHistory(false)
                        }
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 'bold' }}>Version {version.versionNumber}</span>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>
                          {new Date(version.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {version.changeNote && (
                        <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                          {version.changeNote}
                        </div>
                      )}
                      {version.createdBy && (
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          by {version.createdBy.name}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
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
        <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            Model is authoritative; server validates and returns updated JSON. {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
          </span>
          {historyAction !== 'none' && (
            <span style={{ 
              fontWeight: 'bold', 
              color: historyAction === 'undo' ? '#3b82f6' : '#10b981',
              animation: 'fadeIn 0.3s ease-in-out'
            }}>
              {historyAction === 'undo' ? '⟲ Undone' : '⟳ Redone'}
            </span>
          )}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <Canvas model={model} />
      </div>

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


