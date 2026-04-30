import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { config } from './config.js'
import { ensureDatabaseSetup } from './database.js'
import { DEFAULT_CATEGORY_SEED, DEFAULT_PRODUCT_SEED } from './defaultCatalog.js'

const PRODUCT_STATUS_OPTIONS = new Set(['draft', 'published', 'archived'])
const STORAGE_INIT_TIMEOUT_MS = Number(process.env.STORAGE_INIT_TIMEOUT_MS || 5000)
const DATABASE_OPERATION_TIMEOUT_MS = Number(
  process.env.DATABASE_OPERATION_TIMEOUT_MS || STORAGE_INIT_TIMEOUT_MS
)

let writeQueue = Promise.resolve()
let catalogSeedPromise = null
let useFileStorage = false
let storageFallbackLogged = false

function sortByNewest(items) {
  return [...items].sort((left, right) => {
    return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
  })
}

function sanitizeText(value) {
  return String(value || '').trim()
}

function createSlug(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function sanitizeArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => sanitizeText(item)).filter(Boolean)
}

function sanitizeContents(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => ({
      parameter: sanitizeText(item?.parameter),
      specification: sanitizeText(item?.specification || item?.quantity),
    }))
    .filter((row) => row.parameter)
}

function normalizeTimestamp(value, fallbackTimestamp) {
  if (!value) {
    return fallbackTimestamp
  }

  const normalizedDate = new Date(value)

  if (Number.isNaN(normalizedDate.getTime())) {
    return fallbackTimestamp
  }

  return normalizedDate.toISOString()
}

async function ensureStorageFile(filePath) {
  await fs.mkdir(config.dataDir, { recursive: true })

  if (!existsSync(filePath)) {
    await fs.writeFile(filePath, '[]\n', 'utf8')
  }
}

async function readJsonCollection(filePath, { ensureFile = true } = {}) {
  if (ensureFile) {
    await ensureStorageFile(filePath)
  } else if (!existsSync(filePath)) {
    return []
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeJsonCollection(filePath, records) {
  await ensureStorageFile(filePath)

  writeQueue = writeQueue.then(() =>
    fs.writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
  )

  return writeQueue
}

async function readJsonObject(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeJsonObject(filePath, record) {
  await fs.mkdir(config.dataDir, { recursive: true })

  writeQueue = writeQueue.then(() =>
    fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  )

  return writeQueue
}

function createTimestampedRecord(payload, extra = {}) {
  const timestamp = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...extra,
    ...payload,
  }
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

async function activateFileStorageFallback(error, contextMessage) {
  useFileStorage = true
  await ensureLocalCatalogFiles()

  if (!storageFallbackLogged) {
    storageFallbackLogged = true
    console.error(`${contextMessage} ${error.message || error}`)
  }
}

async function runDatabaseOperation(operation, message) {
  return withTimeout(
    Promise.resolve().then(operation),
    DATABASE_OPERATION_TIMEOUT_MS,
    message || `MongoDB operation timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
  )
}

async function ensureLocalCatalogFiles() {
  await Promise.all([
    ensureStorageFile(config.enquiriesFile),
    ensureStorageFile(config.categoriesFile),
    ensureStorageFile(config.productsFile),
  ])

  const [existingCategories, existingProducts] = await Promise.all([
    readJsonCollection(config.categoriesFile, { ensureFile: false }),
    readJsonCollection(config.productsFile, { ensureFile: false }),
  ])

  if (existingCategories.length > 0 || existingProducts.length > 0) {
    return
  }

  const timestamp = new Date().toISOString()
  const categories = DEFAULT_CATEGORY_SEED.map((category) =>
    normalizeCategoryRecord(
      {
        ...category,
        id: crypto.randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      timestamp
    )
  )
  const categoryIdBySlug = new Map(categories.map((category) => [category.slug, category.id]))
  const categorySlugById = new Map(categories.map((category) => [category.id, category.slug]))
  const products = DEFAULT_PRODUCT_SEED.map((product) =>
    normalizeProductRecord(
      {
        ...product,
        id: crypto.randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
        categoryId: categoryIdBySlug.get(product.categorySlug) || '',
      },
      categoryIdBySlug,
      categorySlugById,
      timestamp
    )
  ).filter((product) => product.categoryId)

  await Promise.all([
    writeJsonCollection(config.categoriesFile, categories),
    writeJsonCollection(config.productsFile, products),
  ])
}

async function getMongoCollection(name) {
  if (useFileStorage) {
    return null
  }

  try {
    const database = await withTimeout(
      ensureDatabaseSetup(),
      STORAGE_INIT_TIMEOUT_MS,
      `MongoDB setup timed out after ${STORAGE_INIT_TIMEOUT_MS}ms.`
    )
    return database.collection(name)
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    useFileStorage = true
    await ensureLocalCatalogFiles()
    if (!storageFallbackLogged) {
      storageFallbackLogged = true
      console.error(`MongoDB unavailable; using local JSON storage. ${error.message || error}`)
    }
    return null
  }
}

async function getCategoriesCollection() {
  return getMongoCollection('categories')
}

async function getProductsCollection() {
  return getMongoCollection('products')
}

async function getEnquiriesCollection() {
  return getMongoCollection('enquiries')
}

async function getAdminUsersCollection() {
  return getMongoCollection('admin_users')
}

function normalizeCategoryRecord(record, fallbackTimestamp) {
  const name = sanitizeText(record?.name)
  const slug = sanitizeText(record?.slug) || createSlug(name)

  return {
    ...record,
    id: sanitizeText(record?.id) || crypto.randomUUID(),
    createdAt: normalizeTimestamp(record?.createdAt, fallbackTimestamp),
    updatedAt: normalizeTimestamp(record?.updatedAt, fallbackTimestamp),
    name,
    slug,
    description: sanitizeText(record?.description),
  }
}

function normalizeProductRecord(record, categoryIdBySlug, categorySlugById, fallbackTimestamp) {
  const name = sanitizeText(record?.name)
  const slug = sanitizeText(record?.slug) || createSlug(name)
  const categoryId =
    sanitizeText(record?.categoryId) ||
    categoryIdBySlug.get(sanitizeText(record?.categorySlug)) ||
    ''
  const categorySlug =
    sanitizeText(record?.categorySlug) || categorySlugById.get(categoryId) || ''
  const primaryUse = sanitizeText(record?.primaryUse || record?.shortDescription)
  const contentsNote = sanitizeText(record?.contentsNote || record?.description)
  const availableSizes = sanitizeArray(record?.availableSizes || record?.available_sizes)
  const contents = sanitizeContents(record?.contents)
  const rawStatus = sanitizeText(record?.status || 'draft').toLowerCase()
  const status = PRODUCT_STATUS_OPTIONS.has(rawStatus) ? rawStatus : 'draft'

  const what_it_is = sanitizeText(record?.what_it_is || record?.whatItIs)
  const key_benefits = sanitizeArray(record?.key_benefits || record?.keyBenefits)
  const when_to_use = sanitizeArray(record?.when_to_use || record?.whenToUse)
  const recommended_crops = sanitizeArray(record?.recommended_crops || record?.recommendedCrops)
  const application_dosage = Array.isArray(record?.application_dosage) ? record.application_dosage : (Array.isArray(record?.applicationDosage) ? record.applicationDosage : [])
  const learn_more = Array.isArray(record?.learn_more) ? record.learn_more : (Array.isArray(record?.learnMore) ? record.learnMore : [])

  return {
    ...record,
    id: sanitizeText(record?.id) || crypto.randomUUID(),
    createdAt: normalizeTimestamp(record?.createdAt, fallbackTimestamp),
    updatedAt: normalizeTimestamp(record?.updatedAt, fallbackTimestamp),
    name,
    slug,
    categoryId,
    categorySlug,
    primaryUse,
    shortDescription: primaryUse,
    what_it_is,
    key_benefits,
    when_to_use,
    recommended_crops,
    application_dosage,
    learn_more,
    contents,
    contentsNote,
    description: contentsNote,
    availableSizes,
    available_sizes: availableSizes,
    imageUrl: sanitizeText(record?.imageUrl),
    status,
  }
}

function summarizeProductRecord(record) {
  const slugOrId = encodeURIComponent(sanitizeText(record.slug) || sanitizeText(record.id))

  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    name: record.name,
    slug: record.slug,
    categoryId: record.categoryId,
    categorySlug: record.categorySlug,
    primaryUse: record.primaryUse,
    shortDescription: record.shortDescription,
    subtitle: record.subtitle,
    overview: record.overview,
    imageUrl: slugOrId ? `/api/products/${slugOrId}/image` : '',
    status: record.status,
    contents: Array.isArray(record.contents) ? record.contents : [],
    availableSizes: Array.isArray(record.availableSizes) ? record.availableSizes : [],
    available_sizes: Array.isArray(record.available_sizes) ? record.available_sizes : [],
  }
}

async function seedCatalogCollections() {
  const [categoriesCollection, productsCollection] = await Promise.all([
    getCategoriesCollection(),
    getProductsCollection(),
  ])

  if (!categoriesCollection || !productsCollection) {
    return
  }

  const [categoryCount, productCount] = await Promise.all([
    runDatabaseOperation(
      () => categoriesCollection.countDocuments(),
      `Category count timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    ),
    runDatabaseOperation(
      () => productsCollection.countDocuments(),
      `Product count timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    ),
  ])

  if (categoryCount > 0 || productCount > 0) {
    return
  }

  const [legacyCategories, legacyProducts] = await Promise.all([
    readJsonCollection(config.categoriesFile, { ensureFile: false }),
    readJsonCollection(config.productsFile, { ensureFile: false }),
  ])

  const timestamp = new Date().toISOString()

  const categoriesToSeed =
    legacyCategories.length > 0
      ? legacyCategories.map((category) => normalizeCategoryRecord(category, timestamp))
      : DEFAULT_CATEGORY_SEED.map((category) =>
          normalizeCategoryRecord(
            {
              ...category,
              id: crypto.randomUUID(),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            timestamp
          )
        )

  const categoryIdBySlug = new Map(categoriesToSeed.map((category) => [category.slug, category.id]))
  const categorySlugById = new Map(categoriesToSeed.map((category) => [category.id, category.slug]))

  const seededProductSource =
    legacyProducts.length > 0
      ? legacyProducts
      : DEFAULT_PRODUCT_SEED.map((product) => ({
          ...product,
          id: crypto.randomUUID(),
          createdAt: timestamp,
          updatedAt: timestamp,
          categoryId: categoryIdBySlug.get(product.categorySlug) || '',
        }))

  const productsToSeed = seededProductSource
    .map((product) =>
      normalizeProductRecord(product, categoryIdBySlug, categorySlugById, timestamp)
    )
    .filter((product) => product.categoryId)

  if (categoriesToSeed.length > 0) {
    await runDatabaseOperation(
      () => categoriesCollection.insertMany(categoriesToSeed),
      `Category seed write timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  }

  if (productsToSeed.length > 0) {
    await runDatabaseOperation(
      () => productsCollection.insertMany(productsToSeed),
      `Product seed write timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  }
}

export async function initializeCatalogStore() {
  if (!catalogSeedPromise) {
    catalogSeedPromise = withTimeout(
      seedCatalogCollections(),
      STORAGE_INIT_TIMEOUT_MS,
      `Catalog database setup timed out after ${STORAGE_INIT_TIMEOUT_MS}ms.`
    ).catch((error) => {
      if (!config.allowJsonFallback) {
        catalogSeedPromise = null
        throw error
      }

      return activateFileStorageFallback(error, 'Catalog database setup failed; using local JSON storage.')
    })
  }

  return catalogSeedPromise
}

export function getStorageMode() {
  return useFileStorage ? 'json-file' : 'mongodb'
}

export async function readAdminCredentials() {
  await initializeCatalogStore()

  if (useFileStorage) {
    return readJsonObject(config.adminCredentialsFile)
  }

  try {
    const adminUsersCollection = await getAdminUsersCollection()
    return await runDatabaseOperation(
      () => adminUsersCollection.findOne({ id: 'primary' }, { projection: { _id: 0 } }),
      `Admin credential read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Admin credential read failed; using local JSON storage.')
    return readJsonObject(config.adminCredentialsFile)
  }
}

export async function saveAdminCredentials(credentials) {
  await initializeCatalogStore()

  const timestamp = new Date().toISOString()
  const existingCredentials = await readAdminCredentials()
  const record = {
    id: 'primary',
    createdAt: existingCredentials?.createdAt || timestamp,
    updatedAt: timestamp,
    username: sanitizeText(credentials.username),
    passwordHash: sanitizeText(credentials.passwordHash),
  }

  if (useFileStorage) {
    await writeJsonObject(config.adminCredentialsFile, record)
    return record
  }

  const adminUsersCollection = await getAdminUsersCollection()
  await runDatabaseOperation(
    () =>
      adminUsersCollection.updateOne(
        { id: 'primary' },
        { $set: record },
        { upsert: true }
      ),
    `Admin credential write timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
  )

  return record
}

async function findAllDocuments(collection, query = {}) {
  return runDatabaseOperation(
    () => collection.find(query, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray(),
    `Catalog read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
  )
}

async function findProductSummaries(collection) {
  return runDatabaseOperation(
    () =>
      collection
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              createdAt: 1,
              updatedAt: 1,
              name: 1,
              slug: 1,
              categoryId: 1,
              categorySlug: 1,
              primaryUse: 1,
              shortDescription: 1,
              subtitle: 1,
              overview: 1,
              status: 1,
              contents: 1,
              availableSizes: 1,
              available_sizes: 1,
            },
          }
        )
        .sort({ createdAt: -1 })
        .toArray(),
    `Product summary read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
  )
}

export async function readEnquiries() {
  await initializeCatalogStore()
  if (useFileStorage) {
    return sortByNewest(await readJsonCollection(config.enquiriesFile))
  }

  try {
    const enquiriesCollection = await getEnquiriesCollection()
    return await findAllDocuments(enquiriesCollection)
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Enquiry read failed; using local JSON storage.')
    return sortByNewest(await readJsonCollection(config.enquiriesFile))
  }
}

export async function createEnquiry(payload) {
  await initializeCatalogStore()
  const enquiry = createTimestampedRecord(payload, { status: 'new' })

  if (useFileStorage) {
    const enquiries = await readJsonCollection(config.enquiriesFile)
    enquiries.push(enquiry)
    await writeJsonCollection(config.enquiriesFile, enquiries)
    return enquiry
  }

  const enquiriesCollection = await getEnquiriesCollection()
  await enquiriesCollection.insertOne(enquiry)
  return enquiry
}

export async function updateEnquiry(id, updates) {
  await initializeCatalogStore()
  if (useFileStorage) {
    const enquiries = await readJsonCollection(config.enquiriesFile)
    const existingIndex = enquiries.findIndex((enquiry) => enquiry.id === id)

    if (existingIndex === -1) {
      return null
    }

    const updatedEnquiry = {
      ...enquiries[existingIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    enquiries[existingIndex] = updatedEnquiry
    await writeJsonCollection(config.enquiriesFile, enquiries)
    return updatedEnquiry
  }

  const enquiriesCollection = await getEnquiriesCollection()
  
  const existingEnquiry = await enquiriesCollection.findOne({ id }, { projection: { _id: 0 } })

  if (!existingEnquiry) {
    return null
  }

  const updatedEnquiry = {
    ...existingEnquiry,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await enquiriesCollection.updateOne(
    { id },
    { $set: updatedEnquiry }
  )

  return updatedEnquiry
}

export async function deleteEnquiry(id) {
  await initializeCatalogStore()
  if (useFileStorage) {
    const enquiries = await readJsonCollection(config.enquiriesFile)
    const filteredEnquiries = enquiries.filter((enquiry) => enquiry.id !== id)

    if (filteredEnquiries.length === enquiries.length) {
      return false
    }

    await writeJsonCollection(config.enquiriesFile, filteredEnquiries)
    return true
  }

  const enquiriesCollection = await getEnquiriesCollection()
  const deleteResult = await enquiriesCollection.deleteOne({ id })

  return deleteResult.deletedCount > 0
}

export async function readCategories() {
  await initializeCatalogStore()
  if (useFileStorage) {
    return sortByNewest(await readJsonCollection(config.categoriesFile))
  }

  try {
    const categoriesCollection = await getCategoriesCollection()
    return await findAllDocuments(categoriesCollection)
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Category read failed; using local JSON storage.')
    return sortByNewest(await readJsonCollection(config.categoriesFile))
  }
}

export async function readCategoryById(id) {
  await initializeCatalogStore()

  if (useFileStorage) {
    const categories = await readJsonCollection(config.categoriesFile)
    return categories.find((item) => sanitizeText(item.id) === sanitizeText(id)) || null
  }

  try {
    const categoriesCollection = await getCategoriesCollection()

    return await runDatabaseOperation(
      () =>
        categoriesCollection.findOne(
          { id: sanitizeText(id) },
          {
            projection: {
              _id: 0,
              id: 1,
              name: 1,
              slug: 1,
              description: 1,
            },
          }
        ),
      `Category detail read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Category detail read failed; using local JSON storage.')
    const categories = await readJsonCollection(config.categoriesFile)
    return categories.find((item) => sanitizeText(item.id) === sanitizeText(id)) || null
  }
}

export async function createCategory(payload) {
  await initializeCatalogStore()
  const category = createTimestampedRecord(payload)

  if (useFileStorage) {
    const categories = await readJsonCollection(config.categoriesFile)
    categories.push(category)
    await writeJsonCollection(config.categoriesFile, categories)
    return category
  }

  const categoriesCollection = await getCategoriesCollection()
  await categoriesCollection.insertOne(category)
  return category
}

export async function deleteCategory(id) {
  await initializeCatalogStore()

  if (useFileStorage) {
    const [categories, products] = await Promise.all([
      readJsonCollection(config.categoriesFile),
      readJsonCollection(config.productsFile),
    ])

    if (products.some((product) => product.categoryId === id)) {
      return {
        ok: false,
        reason: 'CATEGORY_HAS_PRODUCTS',
      }
    }

    const filteredCategories = categories.filter((category) => category.id !== id)

    if (filteredCategories.length === categories.length) {
      return {
        ok: false,
        reason: 'CATEGORY_NOT_FOUND',
      }
    }

    await writeJsonCollection(config.categoriesFile, filteredCategories)
    return { ok: true }
  }

  const [categoriesCollection, productsCollection] = await Promise.all([
    getCategoriesCollection(),
    getProductsCollection(),
  ])

  const linkedProductCount = await productsCollection.countDocuments({ categoryId: id })

  if (linkedProductCount > 0) {
    return {
      ok: false,
      reason: 'CATEGORY_HAS_PRODUCTS',
    }
  }

  const deleteResult = await categoriesCollection.deleteOne({ id })

  if (deleteResult.deletedCount === 0) {
    return {
      ok: false,
      reason: 'CATEGORY_NOT_FOUND',
    }
  }

  return { ok: true }
}

export async function updateCategory(id, payload) {
  await initializeCatalogStore()

  if (useFileStorage) {
    const [categories, products] = await Promise.all([
      readJsonCollection(config.categoriesFile),
      readJsonCollection(config.productsFile),
    ])
    const existingIndex = categories.findIndex((category) => category.id === id)

    if (existingIndex === -1) {
      return null
    }

    const existingCategory = categories[existingIndex]
    const updatedCategory = {
      ...existingCategory,
      ...payload,
      updatedAt: new Date().toISOString(),
    }

    categories[existingIndex] = updatedCategory
    const updatedProducts = existingCategory.slug === updatedCategory.slug
      ? products
      : products.map((product) =>
          product.categoryId === id
            ? { ...product, categorySlug: updatedCategory.slug, updatedAt: new Date().toISOString() }
            : product
        )

    await Promise.all([
      writeJsonCollection(config.categoriesFile, categories),
      writeJsonCollection(config.productsFile, updatedProducts),
    ])

    return updatedCategory
  }

  const [categoriesCollection, productsCollection] = await Promise.all([
    getCategoriesCollection(),
    getProductsCollection(),
  ])

  const existingCategory = await categoriesCollection.findOne({ id }, { projection: { _id: 0 } })

  if (!existingCategory) {
    return null
  }

  const updatedCategory = {
    ...existingCategory,
    ...payload,
    updatedAt: new Date().toISOString(),
  }

  await categoriesCollection.updateOne(
    { id },
    {
      $set: updatedCategory,
    }
  )

  if (existingCategory.slug !== updatedCategory.slug) {
    await productsCollection.updateMany(
      { categoryId: id },
      {
        $set: {
          categorySlug: updatedCategory.slug,
        },
      }
    )
  }

  return updatedCategory
}

export async function readProducts() {
  await initializeCatalogStore()
  if (useFileStorage) {
    return sortByNewest(await readJsonCollection(config.productsFile))
  }

  try {
    const productsCollection = await getProductsCollection()
    return await findAllDocuments(productsCollection)
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Product read failed; using local JSON storage.')
    return sortByNewest(await readJsonCollection(config.productsFile))
  }
}

export async function readProductSummaries() {
  await initializeCatalogStore()

  if (useFileStorage) {
    return sortByNewest((await readJsonCollection(config.productsFile)).map(summarizeProductRecord))
  }

  try {
    const productsCollection = await getProductsCollection()
    const records = await findProductSummaries(productsCollection)
    return records.map(summarizeProductRecord)
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Product summary read failed; using local JSON storage.')
    return sortByNewest((await readJsonCollection(config.productsFile)).map(summarizeProductRecord))
  }
}

export async function readProductBySlug(slug) {
  await initializeCatalogStore()

  if (useFileStorage) {
    const products = await readJsonCollection(config.productsFile)
    return products.find((item) => sanitizeText(item.slug) === sanitizeText(slug)) || null
  }

  try {
    const productsCollection = await getProductsCollection()

    return await runDatabaseOperation(
      () =>
        productsCollection.findOne(
          { slug: sanitizeText(slug) },
          {
            projection: {
              _id: 0,
              id: 1,
              createdAt: 1,
              updatedAt: 1,
              name: 1,
              slug: 1,
              categoryId: 1,
              categorySlug: 1,
              primaryUse: 1,
              shortDescription: 1,
              subtitle: 1,
              overview: 1,
              status: 1,
              contents: 1,
              contentsNote: 1,
              description: 1,
              availableSizes: 1,
              available_sizes: 1,
              what_it_is: 1,
              key_benefits: 1,
              when_to_use: 1,
              recommended_crops: 1,
              application_dosage: 1,
              learn_more: 1,
            },
          }
        ),
      `Product detail read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Product detail read failed; using local JSON storage.')
    const products = await readJsonCollection(config.productsFile)
    return products.find((item) => sanitizeText(item.slug) === sanitizeText(slug)) || null
  }
}

export async function readProductEditorById(id) {
  await initializeCatalogStore()

  if (useFileStorage) {
    const products = await readJsonCollection(config.productsFile)
    return products.find((item) => sanitizeText(item.id) === sanitizeText(id)) || null
  }

  try {
    const productsCollection = await getProductsCollection()

    return await runDatabaseOperation(
      () =>
        productsCollection.findOne(
          { id: sanitizeText(id) },
          {
            projection: {
              _id: 0,
              id: 1,
              createdAt: 1,
              updatedAt: 1,
              name: 1,
              slug: 1,
              categoryId: 1,
              categorySlug: 1,
              primaryUse: 1,
              shortDescription: 1,
              subtitle: 1,
              overview: 1,
              status: 1,
              contents: 1,
              contentsNote: 1,
              description: 1,
              availableSizes: 1,
              available_sizes: 1,
              what_it_is: 1,
              key_benefits: 1,
              when_to_use: 1,
              recommended_crops: 1,
              application_dosage: 1,
              learn_more: 1,
            },
          }
        ),
      `Product editor read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Product editor read failed; using local JSON storage.')
    const products = await readJsonCollection(config.productsFile)
    return products.find((item) => sanitizeText(item.id) === sanitizeText(id)) || null
  }
}

export async function readProductById(id) {
  await initializeCatalogStore()

  if (useFileStorage) {
    const products = await readJsonCollection(config.productsFile)
    return products.find((item) => sanitizeText(item.id) === sanitizeText(id)) || null
  }

  try {
    const productsCollection = await getProductsCollection()

    return await runDatabaseOperation(
      () =>
        productsCollection.findOne(
          { id: sanitizeText(id) },
          {
            projection: {
              _id: 0,
            },
          }
        ),
      `Product detail read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Product detail read failed; using local JSON storage.')
    const products = await readJsonCollection(config.productsFile)
    return products.find((item) => sanitizeText(item.id) === sanitizeText(id)) || null
  }
}

export async function readProductImageBySlug(slug) {
  await initializeCatalogStore()

  if (useFileStorage) {
    const products = await readJsonCollection(config.productsFile)
    const product = products.find((item) => sanitizeText(item.slug) === sanitizeText(slug))

    if (!product) {
      return null
    }

    return {
      slug: sanitizeText(product.slug),
      status: sanitizeText(product.status || 'draft').toLowerCase(),
      imageUrl: sanitizeText(product.imageUrl),
      image: sanitizeText(product.image),
    }
  }

  try {
    const productsCollection = await getProductsCollection()

    return await runDatabaseOperation(
      () =>
        productsCollection.findOne(
          { slug: sanitizeText(slug) },
          {
            projection: {
              _id: 0,
              slug: 1,
              status: 1,
              imageUrl: 1,
              image: 1,
            },
          }
        ),
      `Product image read timed out after ${DATABASE_OPERATION_TIMEOUT_MS}ms.`
    )
  } catch (error) {
    if (!config.allowJsonFallback) {
      throw error
    }

    await activateFileStorageFallback(error, 'Product image read failed; using local JSON storage.')
    const products = await readJsonCollection(config.productsFile)
    const product = products.find((item) => sanitizeText(item.slug) === sanitizeText(slug))

    if (!product) {
      return null
    }

    return {
      slug: sanitizeText(product.slug),
      status: sanitizeText(product.status || 'draft').toLowerCase(),
      imageUrl: sanitizeText(product.imageUrl),
      image: sanitizeText(product.image),
    }
  }
}

export async function createProduct(payload) {
  await initializeCatalogStore()
  const product = createTimestampedRecord(payload)

  if (useFileStorage) {
    const products = await readJsonCollection(config.productsFile)
    products.push(product)
    await writeJsonCollection(config.productsFile, products)
    return product
  }

  const productsCollection = await getProductsCollection()
  await productsCollection.insertOne(product)
  return product
}

export async function deleteProduct(id) {
  await initializeCatalogStore()
  if (useFileStorage) {
    const products = await readJsonCollection(config.productsFile)
    const filteredProducts = products.filter((product) => product.id !== id)

    if (filteredProducts.length === products.length) {
      return false
    }

    await writeJsonCollection(config.productsFile, filteredProducts)
    return true
  }

  const productsCollection = await getProductsCollection()
  const deleteResult = await productsCollection.deleteOne({ id })

  return deleteResult.deletedCount > 0
}

export async function updateProduct(id, payload) {
  await initializeCatalogStore()
  if (useFileStorage) {
    const products = await readJsonCollection(config.productsFile)
    const existingIndex = products.findIndex((product) => product.id === id)

    if (existingIndex === -1) {
      return null
    }

    const updatedProduct = {
      ...products[existingIndex],
      ...payload,
      updatedAt: new Date().toISOString(),
    }

    products[existingIndex] = updatedProduct
    await writeJsonCollection(config.productsFile, products)
    return updatedProduct
  }

  const productsCollection = await getProductsCollection()
  const existingProduct = await productsCollection.findOne(
    { id },
    { projection: { _id: 0, id: 1, createdAt: 1 } }
  )

  if (!existingProduct) {
    return null
  }

  const updatedAt = new Date().toISOString()
  const updatedProduct = {
    ...existingProduct,
    ...payload,
    updatedAt,
  }

  await productsCollection.updateOne(
    { id },
    {
      $set: {
        ...payload,
        updatedAt,
      },
    }
  )

  return updatedProduct
}

export async function getAdminStats() {
  const [enquiries, categories, products] = await Promise.all([
    readEnquiries(),
    readCategories(),
    readProductSummaries(),
  ])

  return {
    enquiries: {
      total: enquiries.length,
      new: enquiries.filter((item) => item.status === 'new').length,
      inProgress: enquiries.filter((item) => item.status === 'in-progress').length,
      resolved: enquiries.filter((item) => item.status === 'resolved').length,
      archived: enquiries.filter((item) => item.status === 'archived').length,
    },
    categories: {
      total: categories.length,
    },
    products: {
      total: products.length,
      published: products.filter((item) => item.status === 'published').length,
      draft: products.filter((item) => item.status === 'draft').length,
      archived: products.filter((item) => item.status === 'archived').length,
    },
  }
}
