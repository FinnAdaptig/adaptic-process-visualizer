#!/usr/bin/env tsx

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../src/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKFLOW_DIR = path.join(__dirname, '../data/workflows')

interface LegacyWorkflow {
  id: string
  name: string
  departmentId?: number
  json: any
  updatedAt?: string
}

async function migrateData() {
  console.log('🚀 Starting data migration from JSON files to database...')
  
  try {
    // Ensure the Default department exists
    const defaultDept = await prisma.department.upsert({
      where: { name: 'Default' },
      update: {},
      create: { name: 'Default' }
    })
    
    console.log(`📁 Default department created/found with ID: ${defaultDept.id}`)
    
    // Check if the workflows directory exists
    if (!fs.existsSync(WORKFLOW_DIR)) {
      console.log('⚠️  No workflows directory found, skipping migration')
      return
    }
    
    // Read all JSON files from the workflows directory
    const files = fs.readdirSync(WORKFLOW_DIR).filter(f => f.endsWith('.json'))
    console.log(`📄 Found ${files.length} workflow files to migrate`)
    
    let migratedCount = 0
    let skippedCount = 0
    
    for (const file of files) {
      try {
        const filePath = path.join(WORKFLOW_DIR, file)
        const fileContent = fs.readFileSync(filePath, 'utf8')
        const legacyWorkflow: LegacyWorkflow = JSON.parse(fileContent)
        
        // Check if workflow already exists in database
        const existingWorkflow = await prisma.workflow.findUnique({
          where: { id: legacyWorkflow.id }
        })
        
        if (existingWorkflow) {
          console.log(`⏭️  Skipping ${legacyWorkflow.name} (already exists in database)`)
          skippedCount++
          continue
        }
        
        // Create the workflow
        const newWorkflow = await prisma.workflow.create({
          data: {
            id: legacyWorkflow.id,
            name: legacyWorkflow.name || 'Untitled Workflow',
            departmentId: legacyWorkflow.departmentId || defaultDept.id,
            displayOrder: migratedCount + 1
          }
        })
        
        // Create the initial version
        await prisma.workflowVersion.create({
          data: {
            workflowId: newWorkflow.id,
            versionNumber: 1,
            jsonContent: JSON.stringify(legacyWorkflow.json),
            changeNote: 'Migrated from file system'
          }
        })
        
        console.log(`✅ Migrated: ${legacyWorkflow.name}`)
        migratedCount++
        
      } catch (error) {
        console.error(`❌ Error migrating ${file}:`, error)
      }
    }
    
    console.log('\n📊 Migration Summary:')
    console.log(`   ✅ Migrated: ${migratedCount} workflows`)
    console.log(`   ⏭️  Skipped: ${skippedCount} workflows`)
    console.log(`   📁 Total files: ${files.length}`)
    
    if (migratedCount > 0) {
      console.log('\n🎉 Migration completed successfully!')
      console.log('💡 You can now remove the JSON files from backend/data/workflows/ if desired')
    } else {
      console.log('\n📌 No new workflows were migrated')
    }
    
  } catch (error) {
    console.error('💥 Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the migration
migrateData()
