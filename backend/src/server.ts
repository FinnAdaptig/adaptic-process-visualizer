import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { z } from 'zod'
import axios from 'axios'
import { prisma, createWorkflowVersion, getWorkflowWithLatestVersion, getWorkflowVersionHistory } from './db.js'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// Authoritative schema
const PositionSchema = z.object({ x: z.number(), y: z.number() })
const ElementSchema = z.object({
  id: z.string(),
  type: z.enum(['start_event', 'end_event', 'task', 'gateway']),
  label: z.string(),
  position: PositionSchema
})
const SwimlaneSchema = z.object({ id: z.string(), label: z.string(), elements: z.array(z.string()) })
const ConnectionSchema = z.object({ source: z.string(), target: z.string(), label: z.string().optional() })
const ProcessSchema = z.object({
  processName: z.string(),
  swimlanes: z.array(SwimlaneSchema),
  elements: z.array(ElementSchema),
  connections: z.array(ConnectionSchema)
})
type ProcessModel = z.infer<typeof ProcessSchema>

let processModel: ProcessModel = {
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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'models/gemini-1.5-flash'

async function proposeWithGemini(current: ProcessModel, instruction: string): Promise<ProcessModel> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set')
  }
  const system = `You are an assistant that updates a BPMN-style swimlane process JSON.\nStrictly return ONLY the updated JSON. No prose.\nAllowed element types: start_event, end_event, task, gateway.\nConnections are sequence flows only.\nSchema:\n{\n  "processName": "string",\n  "swimlanes": [ { "id": "string", "label": "string", "elements": ["<element_id>"] } ],\n  "elements": [ { "id": "string", "type": "start_event" | "end_event" | "task" | "gateway", "label": "string", "position": { "x": number, "y": number } } ],\n  "connections": [ { "source": "<element_id>", "target": "<element_id>", "label": "optional string" } ]\n}\nRules:\n- Preserve existing ids and layout when possible.\n- Append new ids as unique strings.\n- Ensure all connection endpoints exist in elements.\n- Maintain swimlane membership by adding element ids to the appropriate lane.\n- Do not include markdown code fences.`

  const contents = [
    {
      role: 'user',
      parts: [
        { text: system },
        { text: `Current JSON:\n${JSON.stringify(current)}` },
        { text: `Instruction:\n${instruction}` }
      ]
    }
  ]

  const url = `https://generativelanguage.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`
  const { data } = await axios.post(url, { contents }, { headers: { 'Content-Type': 'application/json' } })
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty response from Gemini')

  // Try to extract JSON substring
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const jsonStr = start >= 0 && end > start ? text.slice(start, end + 1) : text
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    throw new Error('Gemini response is not valid JSON')
  }

  const validated = ProcessSchema.parse(parsed)
  return validated
}

function getElementCenter(el: z.infer<typeof ElementSchema>): { x: number; y: number } {
  const { x, y } = el.position
  switch (el.type) {
    case 'task':
      return { x: x + 80, y: y + 30 }
    case 'gateway':
      return { x: x + 28, y: y + 28 }
    case 'start_event':
    case 'end_event':
      return { x: x + 20, y: y + 20 }
  }
}

function ensureSingleConnectedProcess(modelIn: ProcessModel): ProcessModel {
  const model: ProcessModel = JSON.parse(JSON.stringify(modelIn))
  const idToElement = new Map(model.elements.map((e) => [e.id, e]))
  // Drop connections to missing nodes
  model.connections = model.connections.filter((c) => idToElement.has(c.source) && idToElement.has(c.target))

  // Build undirected adjacency
  const ids = model.elements.map((e) => e.id)
  const indexById = new Map(ids.map((id, i) => [id, i]))
  const adj: number[][] = Array.from({ length: ids.length }, () => [])
  for (const c of model.connections) {
    const a = indexById.get(c.source)
    const b = indexById.get(c.target)
    if (a == null || b == null) continue
    adj[a].push(b)
    adj[b].push(a)
  }
  // Find components
  const visited = new Array(ids.length).fill(false)
  const components: number[][] = []
  for (let i = 0; i < ids.length; i++) {
    if (visited[i]) continue
    const stack = [i]
    visited[i] = true
    const comp: number[] = []
    while (stack.length) {
      const v = stack.pop()!
      comp.push(v)
      for (const w of adj[v]) {
        if (!visited[w]) {
          visited[w] = true
          stack.push(w)
        }
      }
    }
    components.push(comp)
  }
  if (components.length <= 1) return model

  // Choose main component: one containing a start_event, else largest
  const startIds = new Set(model.elements.filter((e) => e.type === 'start_event').map((e) => e.id))
  let mainIdx = 0
  for (let i = 0; i < components.length; i++) {
    const hasStart = components[i].some((idx) => startIds.has(ids[idx]))
    if (hasStart) { mainIdx = i; break }
    if (components[i].length > components[mainIdx].length) mainIdx = i
  }

  const inMain = new Set(components[mainIdx].map((i) => ids[i]))

  // Helper to add unique connection
  const addConnection = (source: string, target: string) => {
    if (model.connections.some((c) => c.source === source && c.target === target)) return
    model.connections.push({ source, target })
  }

  // For each other component, connect closest pair between comp and main
  const mainElements = components[mainIdx].map((i) => idToElement.get(ids[i])!)
  for (let i = 0; i < components.length; i++) {
    if (i === mainIdx) continue
    const compEls = components[i].map((ix) => idToElement.get(ids[ix])!)
    let bestA: typeof mainElements[number] | null = null
    let bestB: typeof compEls[number] | null = null
    let bestD = Infinity
    for (const a of mainElements) {
      const ca = getElementCenter(a)
      for (const b of compEls) {
        const cb = getElementCenter(b)
        const dx = ca.x - cb.x
        const dy = ca.y - cb.y
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; bestA = a; bestB = b }
      }
    }
    if (bestA && bestB) {
      const ca = getElementCenter(bestA)
      const cb = getElementCenter(bestB)
      // Prefer left-to-right direction
      if (ca.x <= cb.x) addConnection(bestA.id, bestB.id)
      else addConnection(bestB.id, bestA.id)
    }
  }

  return model
}

// Naive instruction handler (placeholder for LLM integration)
function applyInstruction(current: ProcessModel, instruction: string): ProcessModel {
  let model: ProcessModel = JSON.parse(JSON.stringify(current))
  const lower = instruction.toLowerCase()

  // Add task pattern: "add a task 'Name' in lane X"
  const addTaskMatch = lower.match(/add (?:a )?task '([^']+)' in lane ([a-z])/)
  if (addTaskMatch) {
    const label = addTaskMatch[1]
    const laneLetter = addTaskMatch[2]
    const laneIndex = laneLetter.charCodeAt(0) - 'a'.charCodeAt(0)
    const lane = model.swimlanes[laneIndex]
    if (lane) {
      const id = `task-${Date.now()}`
      const y = 0 // y will be centered at render time
      // Choose a non-overlapping x by scanning existing tasks
      const takenXs = model.elements
        .filter((e) => lane.elements.includes(e.id) && e.type === 'task')
        .map((e) => e.position.x)
      let x = 300
      while (takenXs.some((tx) => Math.abs(tx - x) < 176)) x += 180
      model.elements.push({ id, type: 'task', label, position: { x, y } })
      lane.elements.push(id)
    }
  }

  // Connect after Start pattern
  if (lower.includes('connect after start')) {
    const start = model.elements.find((e) => e.type === 'start_event')
    const last = model.elements[model.elements.length - 1]
    if (start && last && start.id !== last.id) {
      model.connections.push({ source: start.id, target: last.id })
    }
  }

  // Rename process
  const renameMatch = lower.match(/name (?:the )?process '(.*?)'/)
  if (renameMatch) {
    model.processName = renameMatch[1]
  }

  return model
}

app.get('/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/process', (req, res) => {
  res.json(processModel)
})

app.post('/assistant/execute', async (req, res) => {
  const instruction = String(req.body?.instruction || '').trim()
  if (!instruction) return res.status(400).json({ error: 'instruction is required' })

  let updated: ProcessModel
  try {
    if (GEMINI_API_KEY) {
      updated = await proposeWithGemini(processModel, instruction)
    } else {
      updated = applyInstruction(processModel, instruction)
    }
  } catch (e: any) {
    // Fallback to naive rules on any LLM errors
    try {
      updated = applyInstruction(processModel, instruction)
    } catch {
      return res.status(500).json({ error: e?.message || 'Failed to process instruction' })
    }
  }

  // Ensure the workflow forms a single connected graph
  updated = ensureSingleConnectedProcess(updated)

  // Validate strictly
  const parsed = ProcessSchema.safeParse(updated)
  if (!parsed.success) {
    return res.status(422).json({ error: 'Schema validation failed', details: parsed.error.format() })
  }
  processModel = parsed.data
  res.json(processModel)
})

// Validation schema reused for DB payloads
const CreateWorkflowSchema = z.object({
  name: z.string().min(1),
  departmentId: z.number().int().positive(),
  json: ProcessSchema
})

// Create workflow
app.post('/api/workflows', async (req, res) => {
  try {
    const { name, departmentId, json } = CreateWorkflowSchema.parse({
      name: req.body?.name,
      departmentId: req.body?.departmentId || 1, // Default to department 1 if not provided
      json: req.body?.json
    });
    
    // Create the workflow
    const workflow = await prisma.workflow.create({
      data: {
        name,
        departmentId,
        displayOrder: await getNextDisplayOrder(departmentId)
      }
    });
    
    // Create the initial version
    await createWorkflowVersion(workflow.id, json, 'Initial version');
    
    // Return workflow with format expected by frontend
    const result = {
      id: workflow.id,
      name: workflow.name,
      departmentId: workflow.departmentId,
      json,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt
    };
    
    res.status(201).json(result);
  } catch (e: any) {
    console.error('Error creating workflow:', e);
    res.status(400).json({ error: e?.message || 'Invalid payload' });
  }
})

async function getNextDisplayOrder(departmentId: number): Promise<number> {
  const lastWorkflow = await prisma.workflow.findFirst({
    where: { departmentId, isDeleted: false },
    orderBy: { displayOrder: 'desc' }
  });
  return (lastWorkflow?.displayOrder || 0) + 1;
}

// Get workflow by id
app.get('/api/workflows/:id', async (req, res) => {
  try {
    const workflow = await getWorkflowWithLatestVersion(req.params.id);
    if (workflow) {
      // Format for frontend compatibility
      const result = {
        id: workflow.id,
        name: workflow.name,
        departmentId: workflow.departmentId,
        json: workflow.jsonContent,
        jsonContent: workflow.jsonContent, // Both for compatibility
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        currentVersion: workflow.currentVersion
      };
      res.json(result);
    } else {
      res.status(404).json({ error: 'Workflow not found' });
    }
  } catch (e: any) {
    console.error('Error fetching workflow:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
})

// List workflows by department
app.get('/api/departments/:deptId/workflows', async (req, res) => {
  try {
    const departmentId = parseInt(req.params.deptId);
    const workflows = await prisma.workflow.findMany({
      where: { 
        departmentId,
        isDeleted: false 
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1
        }
      },
      orderBy: { displayOrder: 'asc' }
    });
    
    const result = workflows.map(wf => ({
      id: wf.id,
      name: wf.name,
      departmentId: wf.departmentId,
      updatedAt: wf.updatedAt.toISOString(),
      jsonContent: wf.versions[0] ? JSON.parse(wf.versions[0].jsonContent) : null
    }));
    
    res.json(result);
  } catch (e: any) {
    console.error('Error listing workflows:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
})

// Update workflow
const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  departmentId: z.number().int().positive().optional(),
  json: ProcessSchema.optional()
})

app.put('/api/workflows/:id', async (req, res) => {
  try {
    const payload = UpdateWorkflowSchema.parse({
      name: req.body?.name,
      departmentId: req.body?.departmentId,
      json: req.body?.json
    });
    
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id }
    });
    
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Update workflow metadata
    const updatedWorkflow = await prisma.workflow.update({
      where: { id: req.params.id },
      data: {
        name: payload.name || workflow.name,
        departmentId: payload.departmentId || workflow.departmentId
      }
    });
    
    // If JSON content is being updated, create a new version
    if (payload.json) {
      await createWorkflowVersion(workflow.id, payload.json, 'Updated via API');
    }
    
    // Get the latest version for response
    const result = await getWorkflowWithLatestVersion(workflow.id);
    if (result) {
      res.json({
        id: result.id,
        name: result.name,
        departmentId: result.departmentId,
        json: result.jsonContent,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt
      });
    } else {
      res.status(500).json({ error: 'Error retrieving updated workflow' });
    }
  } catch (e: any) {
    console.error('Error updating workflow:', e);
    res.status(400).json({ error: e?.message || 'Invalid payload' });
  }
})

// Delete workflow
app.delete('/api/workflows/:id', async (req, res) => {
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id }
    });
    
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Soft delete by setting isDeleted flag
    await prisma.workflow.update({
      where: { id: req.params.id },
      data: { isDeleted: true }
    });
    
    res.json({ success: true });
  } catch (e: any) {
    console.error('Error deleting workflow:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
})

// Single library endpoint: departments with workflows (sorted by updatedAt desc)
app.get('/api/library', async (_req, res) => {
  try {
    // Get all departments with their workflows
    const departments = await prisma.department.findMany({
      include: {
        workflows: {
          where: { isDeleted: false },
          include: {
            versions: {
              orderBy: { versionNumber: 'desc' },
              take: 1
            }
          },
          orderBy: { displayOrder: 'asc' }
        }
      }
    });
    
    const result = departments.map(dept => ({
      departmentId: dept.id,
      departmentName: dept.name,
      workflows: dept.workflows.map(wf => ({
        id: wf.id,
        name: wf.name,
        updatedAt: wf.updatedAt.toISOString(),
        jsonContent: wf.versions[0] ? JSON.parse(wf.versions[0].jsonContent) : null
      }))
    }));
    
    res.json(result);
  } catch (e: any) {
    console.error('Error fetching library:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
})

// Get workflow version history
app.get('/api/workflows/:id/versions', async (req, res) => {
  try {
    const versions = await getWorkflowVersionHistory(req.params.id, 20);
    const result = versions.map(v => ({
      id: v.id,
      versionNumber: v.versionNumber,
      jsonContent: JSON.parse(v.jsonContent),
      changeNote: v.changeNote,
      createdAt: v.createdAt,
      createdBy: v.createdBy
    }));
    res.json(result);
  } catch (e: any) {
    console.error('Error fetching version history:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
})

// Restore workflow to specific version
app.post('/api/workflows/:id/restore/:versionNumber', async (req, res) => {
  try {
    const { id } = req.params;
    const versionNumber = parseInt(req.params.versionNumber);
    
    // Get the specific version
    const version = await prisma.workflowVersion.findUnique({
      where: {
        workflowId_versionNumber: {
          workflowId: id,
          versionNumber
        }
      }
    });
    
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }
    
    // Create a new version with the restored content
    const newVersion = await createWorkflowVersion(
      id, 
      JSON.parse(version.jsonContent), 
      `Restored from version ${versionNumber}`
    );
    
    res.json({
      success: true,
      newVersionNumber: newVersion.versionNumber,
      restoredFromVersion: versionNumber
    });
  } catch (e: any) {
    console.error('Error restoring version:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
})

// Update workflow display order (for drag & drop reordering)
app.put('/api/workflows/:id/order', async (req, res) => {
  try {
    const { displayOrder } = req.body;
    
    if (typeof displayOrder !== 'number') {
      return res.status(400).json({ error: 'displayOrder must be a number' });
    }
    
    await prisma.workflow.update({
      where: { id: req.params.id },
      data: { displayOrder }
    });
    
    res.json({ success: true });
  } catch (e: any) {
    console.error('Error updating workflow order:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
})

app.post('/process/reset', (req, res) => {
  processModel = {
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
  res.json(processModel)
})

const PORT = Number(process.env.PORT || 8080)
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})


