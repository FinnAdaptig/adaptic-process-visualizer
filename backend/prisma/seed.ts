import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const customer = await prisma.department.upsert({
    where: { name: 'customer' },
    update: {},
    create: { name: 'customer' }
  })
  const employee = await prisma.department.upsert({
    where: { name: 'employee' },
    update: {},
    create: { name: 'employee' }
  })

  const exampleProcess = {
    processName: 'Seeded Example',
    swimlanes: [
      { id: 'lane-1', label: 'customer', elements: ['start-1', 'task-1'] },
      { id: 'lane-2', label: 'employee', elements: ['end-1'] }
    ],
    elements: [
      { id: 'start-1', type: 'start_event', label: 'Start', position: { x: 80, y: 80 } },
      { id: 'task-1', type: 'task', label: 'Task', position: { x: 240, y: 0 } },
      { id: 'end-1', type: 'end_event', label: 'End', position: { x: 460, y: 80 } }
    ],
    connections: [
      { source: 'start-1', target: 'task-1' },
      { source: 'task-1', target: 'end-1' }
    ]
  }

  await prisma.workflow.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Onboarding',
      departmentId: customer.id,
      jsonContent: exampleProcess
    }
  })

  await prisma.workflow.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      name: 'Fulfillment',
      departmentId: employee.id,
      jsonContent: exampleProcess
    }
  })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })


