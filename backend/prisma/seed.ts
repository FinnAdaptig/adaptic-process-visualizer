import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Create default departments
  const customerDept = await prisma.department.upsert({
    where: { name: 'Customer Service' },
    update: {},
    create: { name: 'Customer Service' }
  })
  
  const operationsDept = await prisma.department.upsert({
    where: { name: 'Operations' },
    update: {},
    create: { name: 'Operations' }
  })

  const exampleProcess = {
    processName: 'Seeded Example',
    swimlanes: [
      { id: 'lane-1', label: 'Customer Service', elements: ['start-1', 'task-1'] },
      { id: 'lane-2', label: 'Operations', elements: ['end-1'] }
    ],
    elements: [
      { id: 'start-1', type: 'start_event', label: 'Start', position: { x: 80, y: 80 } },
      { id: 'task-1', type: 'task', label: 'Process Request', position: { x: 240, y: 70 } },
      { id: 'end-1', type: 'end_event', label: 'End', position: { x: 460, y: 80 } }
    ],
    connections: [
      { source: 'start-1', target: 'task-1' },
      { source: 'task-1', target: 'end-1' }
    ]
  }

  // Create workflows with initial versions
  const workflow1 = await prisma.workflow.create({
    data: {
      name: 'Customer Onboarding Process',
      departmentId: customerDept.id,
      displayOrder: 1
    }
  })

  await prisma.workflowVersion.create({
    data: {
      workflowId: workflow1.id,
      versionNumber: 1,
      jsonContent: JSON.stringify(exampleProcess),
      changeNote: 'Initial version'
    }
  })

  const workflow2 = await prisma.workflow.create({
    data: {
      name: 'Order Fulfillment Process',
      departmentId: operationsDept.id,
      displayOrder: 2
    }
  })

  await prisma.workflowVersion.create({
    data: {
      workflowId: workflow2.id,
      versionNumber: 1,
      jsonContent: JSON.stringify({
        ...exampleProcess,
        processName: 'Order Fulfillment',
        swimlanes: [
          { id: 'lane-1', label: 'Sales', elements: ['start-1', 'task-1'] },
          { id: 'lane-2', label: 'Warehouse', elements: ['task-2', 'end-1'] }
        ],
        elements: [
          { id: 'start-1', type: 'start_event', label: 'Order Received', position: { x: 80, y: 80 } },
          { id: 'task-1', type: 'task', label: 'Validate Order', position: { x: 240, y: 70 } },
          { id: 'task-2', type: 'task', label: 'Ship Order', position: { x: 420, y: 70 } },
          { id: 'end-1', type: 'end_event', label: 'Order Completed', position: { x: 600, y: 80 } }
        ],
        connections: [
          { source: 'start-1', target: 'task-1' },
          { source: 'task-1', target: 'task-2' },
          { source: 'task-2', target: 'end-1' }
        ]
      }),
      changeNote: 'Initial version'
    }
  })

  console.log('✅ Database seeded successfully')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Error seeding database:', e)
    await prisma.$disconnect()
    process.exit(1)
  })


