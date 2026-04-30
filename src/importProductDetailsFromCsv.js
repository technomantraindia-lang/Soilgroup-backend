import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { ensureDatabaseSetup } from './database.js'
import { config } from './config.js'

const CSV_FILES = [
  path.join(config.projectRootDir, 'product.products.csv'),
  path.join(config.projectRootDir, 'soil_organics_products_fixed.csv'),
  path.join(config.projectRootDir, 'soil_plus_pending_14_products.csv'),
].filter((filePath) => existsSync(filePath))

const PRODUCT_JSON_FILE = path.join(config.projectRootDir, 'product.products.json')

const LEGACY_PRODUCT_OVERRIDES = {
  'organic-npk-5-10-0': {
    name: 'NPK (5-10-0)',
    slug: 'npk-5-10-0',
  },
  'organic-npk-5-10-5': {
    name: 'NPK (5-10-5)',
    slug: 'npk-5-10-5',
  },
  'nitro-plus': {
    name: 'Nitro +',
    slug: 'nitro',
  },
  'bone-meal-steamed': {
    name: 'Bone Meal',
    slug: 'bone-meal',
  },
}

function sanitizeText(value) {
  return String(value || '').trim()
}

function normalizeJsonProductDocument(document) {
  const { _id, ...rest } = document || {}

  return {
    ...rest,
    id: sanitizeText(rest.id) || crypto.randomUUID(),
    createdAt: sanitizeText(rest.createdAt) || new Date().toISOString(),
    updatedAt: sanitizeText(rest.updatedAt) || new Date().toISOString(),
    name: sanitizeText(rest.name),
    slug: sanitizeText(rest.slug),
    categoryId: sanitizeText(rest.categoryId),
    categorySlug: sanitizeText(rest.categorySlug),
  }
}

async function readJsonProducts(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(content)

  if (!Array.isArray(parsed)) {
    throw new Error('Product JSON export must contain an array of documents.')
  }

  return parsed.map(normalizeJsonProductDocument).filter((product) => product.name && product.slug)
}

function createSlug(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeName(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[+]/g, ' plus ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseJsonField(value, fallback) {
  const raw = sanitizeText(value)

  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractIndexedStringArray(row, fieldName) {
  const pattern = new RegExp(`^${escapeRegExp(fieldName)}\\[(\\d+)\\]$`)
  const values = []

  for (const [key, value] of Object.entries(row)) {
    const match = key.match(pattern)

    if (!match) {
      continue
    }

    const index = Number.parseInt(match[1], 10)
    const normalizedValue = sanitizeText(value)

    if (!normalizedValue) {
      continue
    }

    values.push([index, normalizedValue])
  }

  return values
    .sort((left, right) => left[0] - right[0])
    .map(([, value]) => value)
}

function extractIndexedObjectArray(row, fieldName) {
  const pattern = new RegExp(`^${escapeRegExp(fieldName)}\\[(\\d+)\\]\\.(.+)$`)
  const entries = new Map()

  for (const [key, value] of Object.entries(row)) {
    const match = key.match(pattern)

    if (!match) {
      continue
    }

    const index = Number.parseInt(match[1], 10)
    const property = sanitizeText(match[2])
    const normalizedValue = sanitizeText(value)

    if (!property || !normalizedValue) {
      continue
    }

    if (!entries.has(index)) {
      entries.set(index, {})
    }

    entries.get(index)[property] = normalizedValue
  }

  return [...entries.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, value]) => value)
}

function extractApplicationDosage(row) {
  const methods = new Map()
  const steps = new Map()

  for (const [key, value] of Object.entries(row)) {
    const normalizedValue = sanitizeText(value)

    if (!normalizedValue) {
      continue
    }

    const methodMatch = key.match(/^application_dosage\[(\d+)\]\.method$/)

    if (methodMatch) {
      methods.set(Number.parseInt(methodMatch[1], 10), normalizedValue)
      continue
    }

    const stepMatch = key.match(/^application_dosage\[(\d+)\]\.steps\[(\d+)\]$/)

    if (!stepMatch) {
      continue
    }

    const outerIndex = Number.parseInt(stepMatch[1], 10)
    const innerIndex = Number.parseInt(stepMatch[2], 10)

    if (!steps.has(outerIndex)) {
      steps.set(outerIndex, [])
    }

    steps.get(outerIndex).push([innerIndex, normalizedValue])
  }

  const indexes = [...new Set([...methods.keys(), ...steps.keys()])].sort((left, right) => left - right)

  return indexes.map((index) => ({
    method: methods.get(index) || '',
    steps: (steps.get(index) || [])
      .sort((left, right) => left[0] - right[0])
      .map(([, step]) => step),
  }))
}

function readStringArrayField(row, fieldName) {
  const flattenedValues = extractIndexedStringArray(row, fieldName)

  if (flattenedValues.length > 0) {
    return flattenedValues
  }

  return asStringArray(parseJsonField(row[fieldName], []))
}

function readContentsField(row) {
  const flattenedValues = extractIndexedObjectArray(row, 'contents')

  if (flattenedValues.length > 0) {
    return asContentsArray(flattenedValues)
  }

  return asContentsArray(parseJsonField(row.contents, []))
}

function readLearnMoreField(row) {
  const flattenedValues = extractIndexedObjectArray(row, 'learn_more')

  if (flattenedValues.length > 0) {
    return asLearnMoreArray(flattenedValues)
  }

  return asLearnMoreArray(parseJsonField(row.learn_more, []))
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => sanitizeText(item)).filter(Boolean)
}

function asContentsArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => ({
      parameter: sanitizeText(item?.parameter),
      specification: sanitizeText(item?.specification || item?.quantity),
    }))
    .filter((item) => item.parameter && item.specification)
}

function asDosageArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => ({
      method: sanitizeText(entry?.method),
      steps: asStringArray(entry?.steps),
    }))
    .filter((entry) => entry.method || entry.steps.length > 0)
}

function asLearnMoreArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => ({
      title: sanitizeText(entry?.title),
      content: sanitizeText(entry?.content || entry?.body),
    }))
    .filter((entry) => entry.title || entry.content)
}

function inferCategorySlug(slug, name) {
  const normalizedSlug = createSlug(slug)
  const normalizedName = normalizeName(name)

  const explicitCategoryBySlug = {
    'n-aceto': 'bio-fertilizers',
    'n-rhizo': 'bio-fertilizers',
    'soil-revive': 'bio-stimulants',
    'field-boost': 'soil-conditioners',
    'slurry-charge': 'soil-conditioners',
    'organic-npk-5-10-0': 'organic-fertilizers',
    'organic-npk-5-10-5': 'organic-fertilizers',
    'npk-plus': 'organic-fertilizers',
    'p-rom': 'organic-manure',
    'neem-fruit-p': 'organic-manure',
    'yield-force': 'bio-stimulants',
  }

  if (explicitCategoryBySlug[normalizedSlug]) {
    return explicitCategoryBySlug[normalizedSlug]
  }

  if (normalizedSlug.startsWith('chelated-') || normalizedName.includes('chelated')) {
    return 'chelated-micronutrients'
  }

  if (
    normalizedSlug.startsWith('map-') ||
    normalizedSlug.startsWith('mkp-') ||
    normalizedSlug.startsWith('npk-19-19-19') ||
    normalizedSlug.startsWith('potassium-sulphate-')
  ) {
    return 'water-soluble-fertilizers'
  }

  if (normalizedSlug === 'potassium-humate') {
    return 'soil-conditioners'
  }

  return ''
}

function buildLookupMaps(products) {
  const bySlug = new Map()
  const byName = new Map()

  for (const product of products) {
    const slug = createSlug(product.slug || product.name)
    const name = normalizeName(product.name)

    if (slug) {
      bySlug.set(slug, product)
    }

    if (name) {
      const list = byName.get(name) || []
      list.push(product)
      byName.set(name, list)
    }
  }

  return { bySlug, byName }
}

function findExistingProduct(row, products, lookup) {
  const rowSlug = createSlug(row.slug || row.name)
  const rowName = normalizeName(row.name)

  const slugCandidates = new Set([
    rowSlug,
    rowSlug.replace(/^organic-/, ''),
    rowSlug.replace(/-steamed$/, ''),
    rowSlug.replace(/-plus$/, ''),
  ])

  for (const candidate of slugCandidates) {
    if (candidate && lookup.bySlug.has(candidate)) {
      return lookup.bySlug.get(candidate)
    }
  }

  if (rowName && lookup.byName.has(rowName)) {
    return lookup.byName.get(rowName)[0]
  }

  const fuzzyMatches = products.filter((product) => {
    const productName = normalizeName(product.name)

    if (!productName || !rowName) {
      return false
    }

    return productName.includes(rowName) || rowName.includes(productName)
  })

  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0]
  }

  return null
}

async function readCsvRows(filePath) {
  const content = await fs.readFile(filePath, 'utf8')

  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  })
}

function toProductPayload(row, existingProduct, categoryIdBySlug) {
  const now = new Date().toISOString()
  const rowSlug = createSlug(row.slug || row.name)
  const legacyOverride = LEGACY_PRODUCT_OVERRIDES[rowSlug] || null
  const status = sanitizeText(row.status || existingProduct?.status || 'published').toLowerCase() || 'published'
  const slug =
    sanitizeText(legacyOverride?.slug) ||
    sanitizeText(existingProduct?.slug) ||
    createSlug(row.slug || row.name)
  const name =
    sanitizeText(legacyOverride?.name) ||
    sanitizeText(existingProduct?.name) ||
    sanitizeText(row.name)
  const subtitle = sanitizeText(row.subtitle)
  const shortDescription = sanitizeText(
    row.short_description || row.shortDescription || row.primaryUse || existingProduct?.shortDescription
  )
  const form = sanitizeText(row.form)
  const overview = sanitizeText(row.overview || row.contentsNote || existingProduct?.contentsNote)
  const whatItIs = sanitizeText(row.what_it_is || existingProduct?.what_it_is)
  const imageUrl = sanitizeText(row.imageUrl || existingProduct?.imageUrl)

  const availableSizes = [
    ...readStringArrayField(row, 'availableSizes'),
    ...readStringArrayField(row, 'available_sizes'),
  ].filter((value, index, values) => value && values.indexOf(value) === index)
  const contents = readContentsField(row)
  const keyBenefits = readStringArrayField(row, 'key_benefits')
  const whenToUse = readStringArrayField(row, 'when_to_use')
  const recommendedCrops = readStringArrayField(row, 'recommended_crops')
  const applicationDosage = asDosageArray(
    extractApplicationDosage(row).length > 0
      ? extractApplicationDosage(row)
      : parseJsonField(row.application_dosage, [])
  )
  const learnMore = readLearnMoreField(row)

  const inferredCategorySlug =
    existingProduct?.categorySlug || inferCategorySlug(slug, name) || sanitizeText(existingProduct?.categorySlug)
  const inferredCategoryId =
    existingProduct?.categoryId || categoryIdBySlug.get(inferredCategorySlug) || sanitizeText(existingProduct?.categoryId)

  if (!name || !slug || !inferredCategoryId) {
    return null
  }

  return {
    id: existingProduct?.id || crypto.randomUUID(),
    createdAt: existingProduct?.createdAt || now,
    updatedAt: now,
    name,
    slug,
    status,
    subtitle,
    shortDescription,
    short_description: shortDescription,
    primaryUse: shortDescription,
    description: whatItIs || sanitizeText(row.description) || overview || shortDescription,
    contentsNote: overview,
    overview,
    form,
    what_it_is: whatItIs,
    key_benefits: keyBenefits,
    when_to_use: whenToUse,
    recommended_crops: recommendedCrops,
    application_dosage: applicationDosage,
    learn_more: learnMore,
    availableSizes,
    available_sizes: availableSizes,
    contents,
    categoryId: inferredCategoryId,
    categorySlug: inferredCategorySlug,
    imageUrl,
  }
}

async function runImport() {
  const database = await ensureDatabaseSetup()
  const categoriesCollection = database.collection('categories')
  const productsCollection = database.collection('products')

  if (existsSync(PRODUCT_JSON_FILE)) {
    const products = await readJsonProducts(PRODUCT_JSON_FILE)

    await productsCollection.deleteMany({})

    if (products.length > 0) {
      await productsCollection.insertMany(products)
    }

    console.log(`JSON import completed. Imported: ${products.length}`)
    return
  }

  const [categories, products] = await Promise.all([
    categoriesCollection.find({}, { projection: { _id: 0 } }).toArray(),
    productsCollection.find({}, { projection: { _id: 0 } }).toArray(),
  ])

  const categoryIdBySlug = new Map(categories.map((category) => [category.slug, category.id]))
  const lookup = buildLookupMaps(products)
  const allRows = []

  for (const filePath of CSV_FILES) {
    const rows = await readCsvRows(filePath)
    allRows.push(...rows)
  }

  let updated = 0
  let created = 0
  const skipped = []

  for (const row of allRows) {
    const existingProduct = findExistingProduct(row, products, lookup)
    const payload = toProductPayload(row, existingProduct, categoryIdBySlug)

    if (!payload) {
      skipped.push(sanitizeText(row.name || row.slug || 'Unknown'))
      continue
    }

    if (existingProduct?.id) {
      await productsCollection.updateOne(
        { id: existingProduct.id },
        {
          $set: payload,
        }
      )

      updated += 1
      continue
    }

    await productsCollection.insertOne(payload)
    products.push(payload)
    lookup.bySlug.set(createSlug(payload.slug || payload.name), payload)

    const normalizedName = normalizeName(payload.name)
    if (normalizedName) {
      const list = lookup.byName.get(normalizedName) || []
      list.push(payload)
      lookup.byName.set(normalizedName, list)
    }

    created += 1
  }

  console.log(`CSV import completed. Updated: ${updated}, Created: ${created}, Skipped: ${skipped.length}`)

  if (skipped.length > 0) {
    console.log('Skipped products (category mapping required):')
    for (const name of skipped) {
      console.log(`- ${name}`)
    }
  }
}

runImport().catch((error) => {
  console.error(`CSV import failed: ${error.message || error}`)
  process.exitCode = 1
})
