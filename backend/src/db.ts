import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Helper function to get the current version of a workflow
export async function getCurrentWorkflowVersion(workflowId: string) {
  const latestVersion = await prisma.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: { versionNumber: 'desc' }
  })
  return latestVersion
}

// Helper function to create a new workflow version
export async function createWorkflowVersion(
  workflowId: string, 
  jsonContent: any, 
  changeNote?: string,
  createdById?: number
) {
  // Get the latest version number
  const latestVersion = await prisma.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: { versionNumber: 'desc' }
  })
  
  const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1
  
  return await prisma.workflowVersion.create({
    data: {
      workflowId,
      versionNumber: nextVersionNumber,
      jsonContent: JSON.stringify(jsonContent),
      changeNote,
      createdById
    }
  })
}

// Helper function to get workflow with its latest version
export async function getWorkflowWithLatestVersion(workflowId: string) {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      department: true,
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1
      }
    }
  })
  
  if (!workflow || workflow.versions.length === 0) {
    return null
  }
  
  return {
    ...workflow,
    jsonContent: JSON.parse(workflow.versions[0].jsonContent),
    currentVersion: workflow.versions[0].versionNumber
  }
}

// Helper function to get workflow version history
export async function getWorkflowVersionHistory(workflowId: string, limit = 10) {
  return await prisma.workflowVersion.findMany({
    where: { workflowId },
    orderBy: { versionNumber: 'desc' },
    take: limit,
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  })
}



