#!/usr/bin/env tsx

import { prisma } from './src/db.js'

async function testDatabase() {
  try {
    console.log('🔍 Testing database connection...')
    
    const workflowCount = await prisma.workflow.count()
    console.log(`📊 Total workflows: ${workflowCount}`)
    
    const activeWorkflows = await prisma.workflow.count({
      where: { isDeleted: false }
    })
    console.log(`✅ Active workflows: ${activeWorkflows}`)
    
    const workflows = await prisma.workflow.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true },
      orderBy: { displayOrder: 'asc' }
    })
    
    console.log('\n📋 Workflow list:')
    workflows.forEach((wf, index) => {
      console.log(`  ${index + 1}. ${wf.name} (${wf.id})`)
    })
    
    console.log('\n✅ Database is working!')
    
  } catch (error) {
    console.error('❌ Database error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

testDatabase()
