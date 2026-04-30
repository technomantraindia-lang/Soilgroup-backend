import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const projectRootDir = path.resolve(rootDir, '..')
const fileLoadedEnvKeys = new Set()

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    const canOverrideExistingFileValue = override && fileLoadedEnvKeys.has(key)

    if (!(key in process.env) || canOverrideExistingFileValue) {
      process.env[key] = value
      fileLoadedEnvKeys.add(key)
    }
  }
}

function splitOrigins(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

loadEnvFile(path.join(projectRootDir, '.env'))
loadEnvFile(path.join(rootDir, '.env'), { override: true })

export const config = {
  rootDir,
  projectRootDir,
  publicDir: path.join(rootDir, 'public'),
  adminDir: path.join(rootDir, 'public', 'admin'),
  dataDir: path.join(rootDir, 'data'),
  adminCredentialsFile: path.join(rootDir, 'data', 'admin.json'),
  enquiriesFile: path.join(rootDir, 'data', 'enquiries.json'),
  categoriesFile: path.join(rootDir, 'data', 'categories.json'),
  productsFile: path.join(rootDir, 'data', 'products.json'),
  port: Number(process.env.PORT || 4000),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/soilgroup_website',
  mongodbDatabaseName: process.env.MONGODB_DATABASE || '',
  mongodbDnsServers: splitOrigins(process.env.MONGODB_DNS_SERVERS || ''),
  allowJsonFallback: process.env.ALLOW_JSON_FALLBACK === 'true',
  frontendOrigins: splitOrigins(
    process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173'
  ),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  jwtSecret: process.env.JWT_SECRET || 'soilgroup-local-secret',
}
