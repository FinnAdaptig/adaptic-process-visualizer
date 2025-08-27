import { prisma } from './src/db.js'

async function checkDatabase() {
  try {
    console.log('🔍 Checking database contents...')
    
    // Check departments
    const departments = await prisma.department.findMany()
    console.log('\n📁 Departments:')
    departments.forEach(dept => {
      console.log(`  - ${dept.name} (ID: ${dept.id})`)
    })
    
    // Check workflows
    const workflows = await prisma.workflow.findMany({
      where: { isDeleted: false },
      include: {
        department: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1
        }
      },
      orderBy: { displayOrder: 'asc' }
    })
    
    console.log('\n📋 Active Workflows:')
    workflows.forEach(wf => {
      console.log(`  - ${wf.name} (ID: ${wf.id}) - Department: ${wf.department.name}`)
      console.log(`    Created: ${wf.createdAt}`)
      console.log(`    Versions: ${wf.versions.length > 0 ? wf.versions[0].versionNumber : 'None'}`)
    })
    
    // Check version count
    const versionCount = await prisma.workflowVersion.count()
    console.log(`\n📚 Total versions: ${versionCount}`)
    
  } catch (error) {
    console.error('❌ Database error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkDatabase()
