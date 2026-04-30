import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'
import { parse } from 'csv-parse/sync'
import { config } from './config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function sanitizeText(value) {
  return String(value || '').trim()
}

function parseBoolean(value) {
  return /^true$/i.test(sanitizeText(value))
}

function parseCsvFile(filePath) {
  return fs.readFile(filePath, 'utf8').then((content) =>
    parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    })
  )
}

async function replaceCollection(collection, rows, mapRow) {
  await collection.deleteMany({})

  if (rows.length === 0) {
    return 0
  }

  const documents = rows.map(mapRow).filter(Boolean)

  if (documents.length > 0) {
    await collection.insertMany(documents)
  }

  return documents.length
}

async function main() {
  const client = new MongoClient(config.mongodbUri, {
    connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 15000),
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 15000),
  })

  await client.connect()
  const database = client.db(config.mongodbDatabaseName || 'soil')

  const categoriesFile = path.join(config.projectRootDir, 'product.categories.csv')
  const enquiriesFile = path.join(config.projectRootDir, 'product.enquiries.csv')

  const [categoryRows, enquiryRows] = await Promise.all([
    parseCsvFile(categoriesFile),
    parseCsvFile(enquiriesFile),
  ])

  const categoriesInserted = await replaceCollection(
    database.collection('categories'),
    categoryRows,
    (row) => ({
      id: sanitizeText(row.id) || crypto.randomUUID(),
      createdAt: sanitizeText(row.createdAt) || new Date().toISOString(),
      updatedAt: sanitizeText(row.updatedAt) || new Date().toISOString(),
      name: sanitizeText(row.name),
      slug: sanitizeText(row.slug),
      description: sanitizeText(row.description),
    })
  )

  const enquiriesInserted = await replaceCollection(
    database.collection('enquiries'),
    enquiryRows,
    (row) => ({
      id: sanitizeText(row.id) || crypto.randomUUID(),
      createdAt: sanitizeText(row.createdAt) || new Date().toISOString(),
      updatedAt: sanitizeText(row.updatedAt) || new Date().toISOString(),
      status: sanitizeText(row.status) || 'new',
      fullName: sanitizeText(row.fullName),
      businessName: sanitizeText(row.businessName),
      phone: sanitizeText(row.phone),
      email: sanitizeText(row.email),
      category: sanitizeText(row.category),
      state: sanitizeText(row.state),
      message: sanitizeText(row.message),
      agreed: parseBoolean(row.agreed),
    })
  )

  await client.close()

  console.log(`Imported categories: ${categoriesInserted}`)
  console.log(`Imported enquiries: ${enquiriesInserted}`)

  const { spawn } = await import('node:child_process')

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'importProductDetailsFromCsv.js')], {
      stdio: 'inherit',
      cwd: path.join(config.projectRootDir, 'backend'),
      env: process.env,
    })

    child.on('error', reject)
    child.on('exit', (exitCode) => {
      if (exitCode === 0) {
        resolve()
        return
      }

      reject(new Error(`Product import failed with exit code ${exitCode}.`))
    })
  })
}

main().catch((error) => {
  console.error(`Website data import failed: ${error.message || error}`)
  process.exitCode = 1
})