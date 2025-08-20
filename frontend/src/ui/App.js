import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
// Schema shared with backend contract
export const PositionSchema = z.object({ x: z.number(), y: z.number() });
export const ElementSchema = z.object({
    id: z.string(),
    type: z.enum(['start_event', 'end_event', 'task', 'gateway']),
    label: z.string(),
    position: PositionSchema
});
export const SwimlaneSchema = z.object({
    id: z.string(),
    label: z.string(),
    elements: z.array(z.string())
});
export const ConnectionSchema = z.object({
    source: z.string(),
    target: z.string(),
    label: z.string().optional()
});
export const ProcessSchema = z.object({
    processName: z.string(),
    swimlanes: z.array(SwimlaneSchema),
    elements: z.array(ElementSchema),
    connections: z.array(ConnectionSchema)
});
const initialModel = {
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
};
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';
export const App = () => {
    const [model, setModel] = useState(initialModel);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [messages, setMessages] = useState([]);
    const SIDEBAR_WIDTH = 280;
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const s = localStorage.getItem('sidebarOpen');
        return s ? s === '1' : false;
    });
    const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
    const [selectedKey, setSelectedKey] = useState(null);
    const [activeWorkflowId, setActiveWorkflowId] = useState(null);
    const [library, setLibrary] = useState([]);
    const [saving, setSaving] = useState('idle');
    const [saveError, setSaveError] = useState(null);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 900px)');
        const onChange = () => setIsMobile(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    useEffect(() => {
        function onEsc(e) {
            if (e.key === 'Escape' && sidebarOpen)
                setSidebarOpen(false);
        }
        window.addEventListener('keydown', onEsc);
        return () => window.removeEventListener('keydown', onEsc);
    }, [sidebarOpen]);
    // Load library once
    useEffect(() => {
        fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => { });
    }, []);
    // Prevent unload with unsaved changes
    useEffect(() => {
        const beforeUnload = (e) => {
            if (saving === 'saving') {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [saving]);
    function toggleSidebar() {
        const next = !sidebarOpen;
        setSidebarOpen(next);
        localStorage.setItem('sidebarOpen', next ? '1' : '0');
    }
    async function loadWorkflow(id) {
        const res = await fetch(`${API_BASE}/api/workflows/${id}`);
        if (!res.ok)
            throw new Error('Failed to load workflow');
        const wf = await res.json();
        const parsed = ProcessSchema.parse(wf.jsonContent);
        setActiveWorkflowId(wf.id);
        setModel(parsed);
        setSelectedKey(String(wf.id));
    }
    async function sendInstruction(text) {
        if (!text.trim()) return;
        // System prompt to ensure valid BPMN JSON and clarify change intent
        const systemPrompt = `You are an expert BPMN workflow assistant. The user's input describes the change that should happen to the workflow. Always generate a valid JSON file for process documentation in BPMN style, with no empty swim lanes, no invalid elements, and no formatting errors. The output must be directly visualizable. Do not add anything except the correct JSON. Never introduce unnecessary complexity or create elements that are not explicitly mentioned in the user's instructions.`;
        const fullPrompt = `${systemPrompt}\n${text.trim()}`;
        setMessages((m) => [...m, text.trim()]);
        setInput('');
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/assistant/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction: fullPrompt })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const parsed = ProcessSchema.parse(data);
            setModel(parsed);
            if (activeWorkflowId != null) scheduleSave(activeWorkflowId, parsed);
        } catch (e) {
            setError(e?.message || 'Unknown error');
        } finally {
            setLoading(false);
        }
    }
    // Debounced save of active workflow
    const saveTimer = useRef(null);
    const pendingSaveRef = useRef(null);
    function scheduleSave(id, json) {
        setSaving('saving');
        setSaveError(null);
        pendingSaveRef.current = { id, json };
        if (saveTimer.current)
            window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
            try {
                const body = JSON.stringify({ json });
                const res = await fetch(`${API_BASE}/api/workflows/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
                if (!res.ok)
                    throw new Error(`Save failed (${res.status})`);
                setSaving('saved');
                // refresh library to update timestamps
                fetch(`${API_BASE}/api/library`).then((r) => r.json()).then(setLibrary).catch(() => { });
            }
            catch (e) {
                setSaving('error');
                setSaveError(e?.message || 'Save failed');
            }
        }, 700);
    }
    const templateCols = !isMobile && sidebarOpen ? `${SIDEBAR_WIDTH}px 360px 1fr` : '360px 1fr';
    return (_jsxs("div", { style: { position: 'relative', display: 'grid', gridTemplateColumns: templateCols, height: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }, children: [_jsx("button", { "aria-label": "Toggle process library", onClick: toggleSidebar, style: { position: 'absolute', top: 8, left: 8, width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }, children: _jsx("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "#111827", strokeWidth: "2", strokeLinecap: "round", children: _jsx("path", { d: "M3 6h18M3 12h18M3 18h18" }) }) }), !isMobile && sidebarOpen && (_jsxs("div", { style: { borderRight: '1px solid #e5e7eb', padding: 12, overflowY: 'auto' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, children: [_jsx("strong", { children: "Workflows" }), _jsx("button", { onClick: async () => {
                                        const dept = library[0];
                                        if (!dept)
                                            return;
                                        const res = await fetch(`${API_BASE}/api/workflows`, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ name: 'New Workflow', departmentId: dept.departmentId, json: initialModel })
                                        });
                                        if (res.ok) {
                                            const created = await res.json();
                                            setActiveWorkflowId(created.id);
                                            setModel(ProcessSchema.parse(created.jsonContent));
                                            // optimistic insert
                                            setLibrary((prev) => prev.map((d) => d.departmentId === dept.departmentId ? { ...d, workflows: [{ id: created.id, name: created.name, updatedAt: created.updatedAt }, ...d.workflows] } : d));
                                        }
                                }, style: { fontSize: 12 }, children: "New" })] }), library.map((dept) => (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { style: { fontSize: 12, color: '#6b7280', margin: '8px 0' }, children: dept.departmentName }), dept.workflows.map((wf) => {
                                const sel = activeWorkflowId === wf.id;
                                return (_jsxs("div", { onClick: () => loadWorkflow(wf.id), style: { cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: sel ? '#e0f2fe' : 'transparent' }, children: [_jsx("div", { style: { fontSize: 14 }, children: wf.name }), _jsx("div", { style: { fontSize: 11, color: '#6b7280' }, children: new Date(wf.updatedAt).toLocaleString() })] }, wf.id));
                            })] }, dept.departmentId)))] })), _jsxs("div", { style: { borderRight: '1px solid #e5e7eb', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }, children: [_jsx("h2", { style: { margin: 0, textAlign: 'center' }, children: "Chat" }), _jsxs("div", { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4, alignItems: 'center', textAlign: 'center' }, children: [messages.length === 0 && (_jsx("div", { style: { fontSize: 12, color: '#6b7280' }, children: "Your messages will appear here." })), messages.map((m, i) => (_jsx("div", { style: { background: '#e0f2fe', color: '#0c4a6e', padding: '8px 10px', borderRadius: 10, maxWidth: '85%' }, children: m }, i)))] }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("input", { value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                    sendInstruction(input); }, placeholder: "e.g., Add a task 'Review' in Lane A and connect after Start", style: { flex: 1, padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 } }), _jsx("button", { disabled: loading || !input.trim(), onClick: () => sendInstruction(input), style: { padding: '8px 12px' }, children: loading ? 'Working…' : 'Send' })] }), error && _jsx("div", { style: { color: 'crimson' }, children: error }), _jsxs("div", { style: { fontSize: 12, color: '#6b7280' }, children: ["Model is authoritative; server validates and returns updated JSON. ", saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''] })] }), _jsx("div", { style: { position: 'relative' }, children: _jsx(Canvas, { model: model }) }), isMobile && (_jsxs(_Fragment, { children: [sidebarOpen && (_jsx("div", { onClick: () => setSidebarOpen(false), style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 20 } })), _jsxs("div", { style: {
                            position: 'fixed', left: 0, top: 0, bottom: 0, width: SIDEBAR_WIDTH,
                            background: '#fff', borderRight: '1px solid #e5e7eb', padding: 12, overflowY: 'auto', zIndex: 25,
                            transform: `translateX(${sidebarOpen ? '0' : '-100%'})`, transition: 'transform 200ms ease-in-out'
                        }, children: [_jsxs("div", { style: { position: 'relative', marginBottom: 8, height: 28 }, children: [_jsx("strong", { style: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }, children: "Workflows" }), _jsx("button", { style: { position: 'absolute', top: '50%', right: 0, transform: 'translateY(-50%)' }, onClick: async () => {
                                            const dept = library[0];
                                            if (!dept)
                                                return;
                                            const res = await fetch(`${API_BASE}/api/workflows`, {
                                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ name: 'New Workflow', departmentId: dept.departmentId, json: initialModel })
                                            });
                                            if (res.ok) {
                                                const created = await res.json();
                                                setActiveWorkflowId(created.id);
                                                setModel(ProcessSchema.parse(created.jsonContent));
                                                setLibrary((prev) => prev.map((d) => d.departmentId === dept.departmentId ? { ...d, workflows: [{ id: created.id, name: created.name, updatedAt: created.updatedAt }, ...d.workflows] } : d));
                                            }
                                        }, style: { fontSize: 12 }, children: "New" })] }), library.map((dept) => (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { style: { fontSize: 12, color: '#6b7280', margin: '8px 0' }, children: dept.departmentName }), dept.workflows.map((wf) => {
                                        const sel = activeWorkflowId === wf.id;
                                        return (_jsxs("div", { onClick: () => { loadWorkflow(wf.id); setSidebarOpen(false); }, style: { cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: sel ? '#e0f2fe' : 'transparent' }, children: [_jsx("div", { style: { fontSize: 14 }, children: wf.name }), _jsx("div", { style: { fontSize: 11, color: '#6b7280' }, children: new Date(wf.updatedAt).toLocaleString() })] }, wf.id));
                                    })] }, dept.departmentId)))] })] })), saving === 'error' && (_jsxs("div", { style: { position: 'fixed', left: 16, bottom: 16, background: '#fee2e2', color: '#7f1d1d', padding: '10px 12px', border: '1px solid #fecaca', borderRadius: 8, zIndex: 40 }, children: [_jsxs("div", { style: { marginBottom: 6 }, children: ["Save failed: ", saveError] }), _jsx("button", { onClick: () => { const p = pendingSaveRef.current; if (p)
                            scheduleSave(p.id, p.json); }, style: { fontSize: 12 }, children: "Retry" })] }))] }));
};
const laneHeight = 140;
const laneGap = 16;
const laneHeaderWidth = 120;
const Canvas = ({ model }) => {
    const width = 1200;
    const height = model.swimlanes.length * laneHeight + (model.swimlanes.length + 1) * laneGap;
    const idToElement = useMemo(() => new Map(model.elements.map((e) => [e.id, e])), [model.elements]);
    const elementIdToLaneIndex = useMemo(() => {
        const map = new Map();
        model.swimlanes.forEach((lane, idx) => lane.elements.forEach((id) => map.set(id, idx)));
        return map;
    }, [model.swimlanes]);
    function laneY(index) {
        return laneGap + index * (laneHeight + laneGap);
    }
    const layoutMap = useMemo(() => {
        const positions = new Map();
        const minX = laneGap + laneHeaderWidth + 16;
        const rightMargin = 32;
        const shapeSize = (el) => {
            switch (el.type) {
                case 'task': return { w: 160, h: 60 };
                case 'start_event':
                case 'end_event': return { w: 40, h: 40 };
                case 'gateway': return { w: 56, h: 56 };
            }
        };
        const laneCount = Math.max(model.swimlanes.length, 1);
        for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
            const laneElems = model.swimlanes[laneIndex]?.elements ?? [];
            const records = laneElems
                .map((id) => idToElement.get(id))
                .filter(Boolean);
            // Establish base positions and dimensions
            const items = records.map((el) => {
                const size = shapeSize(el);
                const baseY = el.type === 'task' ? laneY(laneIndex) + (laneHeight - size.h) / 2 : el.position.y;
                const baseX = Math.max(el.position.x, minX);
                return { el, w: size.w, h: size.h, baseX, baseY, x: 0, y: 0 };
            });
            // Sort by desired x and pack to avoid horizontal overlaps
            items.sort((a, b) => a.baseX - b.baseX);
            const minGap = 16;
            let cursorX = minX;
            for (const item of items) {
                const maxX = width - rightMargin - item.w;
                const x = Math.min(Math.max(item.baseX, cursorX), maxX);
                const y = item.baseY;
                item.x = x;
                item.y = y;
                cursorX = x + item.w + minGap;
            }
            // Write back
            items.forEach((it) => positions.set(it.el.id, { x: it.x, y: it.y }));
        }
        // Fallback for elements not listed in any lane
        model.elements.forEach((el) => {
            if (!positions.has(el.id)) {
                const laneIndex = elementIdToLaneIndex.get(el.id) ?? 0;
                const size = shapeSize(el);
                const y = el.type === 'task' ? laneY(laneIndex) + (laneHeight - size.h) / 2 : el.position.y;
                positions.set(el.id, { x: Math.max(el.position.x, minX), y });
            }
        });
        return positions;
    }, [model, elementIdToLaneIndex, idToElement]);
    function getElementRenderPosition(el) {
        return layoutMap.get(el.id) ?? { x: el.position.x, y: el.position.y };
    }
    return (_jsxs("svg", { width: width, height: height, style: { background: '#fff' }, children: [model.swimlanes.map((lane, i) => (_jsxs("g", { children: [_jsx("rect", { x: laneGap, y: laneY(i), width: laneHeaderWidth, height: laneHeight, fill: "#f3f4f6", stroke: "#d1d5db" }), _jsx("text", { x: laneGap + laneHeaderWidth / 2, y: laneY(i) + laneHeight / 2, textAnchor: "middle", dominantBaseline: "middle", fontSize: 14, fill: "#374151", children: lane.label }), _jsx("rect", { x: laneGap + laneHeaderWidth, y: laneY(i), width: width - laneHeaderWidth - 2 * laneGap, height: laneHeight, fill: "#ffffff", stroke: "#d1d5db" })] }, lane.id))), model.connections.map((c, idx) => {
                const s = idToElement.get(c.source);
                const t = idToElement.get(c.target);
                if (!s || !t)
                    return null;
                const sPos = getElementRenderPosition(s);
                const tPos = getElementRenderPosition(t);
                const sc = getElementCenter(s, sPos);
                const tc = getElementCenter(t, tPos);
                // Compute boundary intersections so lines meet the shape edges
                const sp = getBoundaryPoint(s, sPos, tc);
                const tp = getBoundaryPoint(t, tPos, sc);
                const midX = (sp.x + tp.x) / 2;
                const path = `M ${sp.x} ${sp.y} C ${midX} ${sp.y}, ${midX} ${tp.y}, ${tp.x} ${tp.y}`;
                // Basic label displacement to avoid overlapping shapes
                let labelX = midX;
                let labelY = (sp.y + tp.y) / 2 - 6;
                const elementBoxes = model.elements.map((el) => {
                    const p = getElementRenderPosition(el);
                    switch (el.type) {
                        case 'task': return { x: p.x, y: p.y, w: 160, h: 60 };
                        case 'start_event':
                        case 'end_event': return { x: p.x + 2, y: p.y + 2, w: 36, h: 36 };
                        case 'gateway': return { x: p.x - 6, y: p.y - 6, w: 68, h: 68 };
                    }
                });
                const overlaps = elementBoxes.some((b) => labelX >= b.x && labelX <= b.x + b.w && labelY >= b.y && labelY <= b.y + b.h);
                if (overlaps)
                    labelY -= 14;
                return (_jsxs("g", { children: [_jsx("path", { d: path, stroke: "#111827", strokeWidth: 1.5, fill: "none", markerEnd: "url(#arrow)" }), c.label && (_jsx("text", { x: labelX, y: labelY, textAnchor: "middle", fontSize: 12, fill: "#374151", style: { pointerEvents: 'none' }, children: c.label }))] }, idx));
            }), _jsx("defs", { children: _jsx("marker", { id: "arrow", viewBox: "0 0 12 12", refX: "10", refY: "6", markerUnits: "userSpaceOnUse", markerWidth: "12", markerHeight: "12", orient: "auto", children: _jsx("path", { d: "M 0 0 L 12 6 L 0 12 z", fill: "#111827" }) }) }), model.elements.map((el) => (_jsx(ElementNode, { element: el, getPos: getElementRenderPosition }, el.id)))] }));
};
function getAnchorPoint(el, renderPos) {
    const base = renderPos ?? el.position;
    const { x, y } = base;
    switch (el.type) {
        case 'start_event':
        case 'end_event':
            return { x: x + 20, y: y + 20 };
        case 'task':
            return { x: x + 80, y: y + 30 };
        case 'gateway':
            return { x: x + 28, y: y + 28 };
    }
}
function getElementCenter(el, renderPos) {
    const p = renderPos ?? el.position;
    switch (el.type) {
        case 'task':
            return { x: p.x + 80, y: p.y + 30 };
        case 'gateway':
            return { x: p.x + 28, y: p.y + 28 };
        case 'start_event':
        case 'end_event':
            return { x: p.x + 20, y: p.y + 20 };
    }
}
function getBoundaryPoint(el, renderPos, toward) {
    const c = getElementCenter(el, renderPos);
    let dx = toward.x - c.x;
    let dy = toward.y - c.y;
    if (dx === 0 && dy === 0)
        return c;
    switch (el.type) {
        case 'task': {
            const halfWidth = 80, halfHeight = 30;
            const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
            return { x: c.x + dx * scale, y: c.y + dy * scale };
        }
        case 'start_event':
        case 'end_event': {
            const r = 18;
            const len = Math.hypot(dx, dy) || 1;
            const scale = r / len;
            return { x: c.x + dx * scale, y: c.y + dy * scale };
        }
        case 'gateway': {
            const a = 28; // diamond radius along axes
            const denom = Math.abs(dx) + Math.abs(dy) || 1;
            const scale = a / denom;
            return { x: c.x + dx * scale, y: c.y + dy * scale };
        }
    }
}
const ElementNode = ({ element, getPos }) => {
    const { type, label } = element;
    const { x, y } = getPos(element);
    switch (type) {
        case 'start_event':
            return (_jsxs("g", { children: [_jsx("circle", { cx: x + 20, cy: y + 20, r: 18, fill: "#10b98120", stroke: "#059669" }), _jsx("text", { x: x + 20, y: y + 48, textAnchor: "middle", fontSize: 12, fill: "#065f46", style: { pointerEvents: 'none' }, children: label })] }));
        case 'end_event':
            return (_jsxs("g", { children: [_jsx("circle", { cx: x + 20, cy: y + 20, r: 18, fill: "#ef444420", stroke: "#dc2626", strokeWidth: 2 }), _jsx("text", { x: x + 20, y: y + 48, textAnchor: "middle", fontSize: 12, fill: "#7f1d1d", style: { pointerEvents: 'none' }, children: label })] }));
        case 'task':
            return (_jsxs("g", { children: [_jsx("rect", { x: x, y: y, width: 160, height: 60, rx: 8, ry: 8, fill: "#e0f2fe", stroke: "#0284c7" }), _jsx("text", { x: x + 80, y: y + 34, textAnchor: "middle", fontSize: 13, fill: "#0c4a6e", style: { pointerEvents: 'none' }, children: label })] }));
        case 'gateway':
            return (_jsxs("g", { children: [_jsx("rect", { x: x, y: y, width: 56, height: 56, transform: `rotate(45 ${x + 28} ${y + 28})`, fill: "#fef3c7", stroke: "#d97706" }), _jsx("text", { x: x + 28, y: y + 70, textAnchor: "middle", fontSize: 12, fill: "#92400e", style: { pointerEvents: 'none' }, children: label })] }));
    }
};
