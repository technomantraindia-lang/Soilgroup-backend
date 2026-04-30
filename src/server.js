import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { config } from './config.js'
import {
  authenticateAdmin,
  changeAdminCredentials,
  createAuthToken,
  getAdminProfile,
  readBearerToken,
  verifyAuthToken,
} from './auth.js'
import {
  createCategory,
  createEnquiry,
  createProduct,
  deleteCategory,
  deleteEnquiry,
  deleteProduct,
  getAdminStats,
  getStorageMode,
  initializeCatalogStore,
  readCategoryById,
  readCategories,
  readEnquiries,
  readProductById,
  readProductEditorById,
  readProductBySlug,
  readProductImageBySlug,
  readProductSummaries,
  readProducts,
  updateCategory,
  updateEnquiry,
  updateProduct,
} from './store.js'

const ENQUIRY_STATUS_OPTIONS = new Set(['new', 'in-progress', 'resolved', 'archived'])
const PRODUCT_STATUS_OPTIONS = new Set(['draft', 'published', 'archived'])
const MAX_JSON_BODY_SIZE = 12 * 1024 * 1024

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function isInsideDirectory(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin

  if (origin && config.frontendOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Vary', 'Origin')
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })

  res.end(JSON.stringify(payload))
}

function sanitizeText(value) {
  return String(value || '').trim()
}

function normalizeExternalImageUrl(value) {
  const url = sanitizeText(value)

  if (!url) {
    return ''
  }

  const driveFileId =
    url.match(/drive\.google\.com\/file\/d\/([^/]+)/i)?.[1] ||
    url.match(/[?&]id=([^&]+)/i)?.[1]

  if (driveFileId && /drive\.google\.com/i.test(url)) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1000`
  }

  return url
}

function buildProductImageProxyUrl(product) {
  const slugOrId = encodeURIComponent(sanitizeText(product?.slug) || sanitizeText(product?.id))
  return slugOrId ? `/api/products/${slugOrId}/image` : ''
}

function parseDataImageUrl(value) {
  const url = sanitizeText(value)
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)

  if (!match) {
    return null
  }

  try {
    return {
      mimeType: match[1].toLowerCase(),
      buffer: Buffer.from(match[2], 'base64'),
    }
  } catch {
    return null
  }
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

function parsePositiveInteger(value, fallback = 0, maximum = 100) {
  const parsedValue = Number.parseInt(String(value || ''), 10)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback
  }

  return Math.min(parsedValue, maximum)
}

function parseEnquiryPayload(payload) {
  const enquiry = {
    fullName: sanitizeText(payload.fullName),
    businessName: sanitizeText(payload.businessName),
    phone: sanitizeText(payload.phone),
    email: sanitizeText(payload.email).toLowerCase(),
    category: sanitizeText(payload.category),
    state: sanitizeText(payload.state),
    message: sanitizeText(payload.message),
    agreed: Boolean(payload.agreed),
  }

  const errors = []

  if (!enquiry.fullName) {
    errors.push('Full name is required.')
  }

  if (!enquiry.phone || enquiry.phone.replace(/[^\d]/g, '').length < 8) {
    errors.push('Please enter a valid phone number.')
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiry.email)) {
    errors.push('Please enter a valid email address.')
  }

  if (!enquiry.message) {
    errors.push('Message is required.')
  }

  if (!enquiry.agreed) {
    errors.push('You must accept the terms before submitting.')
  }

  return { enquiry, errors }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk

      if (body.length > MAX_JSON_BODY_SIZE) {
        reject(new Error('Request body is too large. Please upload an image under 6 MB or use an image URL.'))
        req.destroy()
      }
    })

    req.on('end', () => {
      if (!body) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })

    req.on('error', reject)
  })
}

async function requireAdmin(req, res) {
  const token = readBearerToken(req.headers)
  const payload = verifyAuthToken(token)

  if (!payload) {
    sendJson(res, 401, { message: 'Admin authentication is required.' })
    return null
  }

  const adminProfile = await getAdminProfile()

  if (payload.sub !== adminProfile.username) {
    sendJson(res, 401, { message: 'Admin session expired. Please login again.' })
    return null
  }

  return payload
}

function enrichProducts(products, categories) {
  const categoryLookup = new Map(categories.map((category) => [category.id, category]))

  return products.map((product) => {
    const category = categoryLookup.get(product.categoryId)

    return {
      ...product,
      imageUrl: normalizeExternalImageUrl(product.imageUrl || product.image),
      category: category
        ? {
            id: category.id,
            name: category.name,
            slug: category.slug,
          }
        : null,
      }
  })
}

function getPublishedProducts(products) {
  return products.filter((product) => product.status === 'published')
}

function getPublicCategories(categories, products) {
  const productCountByCategoryId = getPublishedProducts(products).reduce((lookup, product) => {
    lookup.set(product.categoryId, (lookup.get(product.categoryId) || 0) + 1)
    return lookup
  }, new Map())

  return categories.map((category) => ({
    ...category,
    productCount: productCountByCategoryId.get(category.id) || 0,
  }))
}

function matchesProductSearch(product, query) {
  const normalizedQuery = sanitizeText(query).toLowerCase()

  if (!normalizedQuery) {
    return true
  }

  const searchableFields = [
    product.name,
    product.slug,
    product.primaryUse,
    product.shortDescription,
    product.contentsNote,
    product.description,
    product.category?.name,
    product.category?.slug,
  ]

  return searchableFields.some((field) =>
    sanitizeText(field).toLowerCase().includes(normalizedQuery)
  )
}

async function parseCategoryPayload(payload, options = {}) {
  const name = sanitizeText(payload.name)
  const slug = createSlug(payload.slug || payload.name)
  const description = sanitizeText(payload.description)
  const categories = await readCategories()
  const errors = []
  const existingCategoryId = options.existingCategoryId || null

  if (!name) {
    errors.push('Category name is required.')
  }

  if (!slug) {
    errors.push('Category slug is required.')
  }

  if (categories.some((category) => category.slug === slug && category.id !== existingCategoryId)) {
    errors.push('This category slug already exists.')
  }

  return {
    category: {
      name,
      slug,
      description,
    },
    errors,
  }
}

async function parseProductPayload(payload, options = {}) {
  const categoryId = sanitizeText(payload.categoryId)
  const category = categoryId ? await readCategoryById(categoryId) : null
  const name = sanitizeText(payload.name) || 'Untitled Product'
  const slug = createSlug(payload.slug || payload.name) || `product-${Date.now()}`
  const hasPrimaryUse = Object.prototype.hasOwnProperty.call(payload, 'primaryUse')
  const primaryUse = hasPrimaryUse
    ? sanitizeText(payload.primaryUse)
    : sanitizeText(payload.shortDescription)
  const contents = sanitizeContents(payload.contents)
  const contentsNote = sanitizeText(payload.contentsNote || payload.description)
  const availableSizes = sanitizeArray(payload.availableSizes || payload.available_sizes)
  const hasImageUrl = Object.prototype.hasOwnProperty.call(payload, 'imageUrl')
  const imageUrl = hasImageUrl ? normalizeExternalImageUrl(payload.imageUrl) : undefined
  const status = sanitizeText(payload.status || 'draft').toLowerCase()
  
  // New fields
  const what_it_is = sanitizeText(payload.what_it_is || payload.whatItIs)
  const key_benefits = sanitizeArray(payload.key_benefits || payload.keyBenefits)
  const when_to_use = sanitizeArray(payload.when_to_use || payload.whenToUse)
  const recommended_crops = sanitizeArray(payload.recommended_crops || payload.recommendedCrops)
  const application_dosage = Array.isArray(payload.application_dosage) ? payload.application_dosage : (Array.isArray(payload.applicationDosage) ? payload.applicationDosage : [])
  const learn_more = Array.isArray(payload.learn_more) ? payload.learn_more : (Array.isArray(payload.learnMore) ? payload.learnMore : [])

  const errors = []
  const existingProductId = options.existingProductId || null
  const existingSlugMatch = await readProductBySlug(slug)

  if (!PRODUCT_STATUS_OPTIONS.has(status)) {
    errors.push('Please select a valid product status.')
  }

  if (existingSlugMatch && existingSlugMatch.id !== existingProductId) {
    errors.push('This product slug already exists.')
  }

  return {
    product: {
      name,
      slug,
      categoryId,
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
      status,
      categorySlug: category?.slug || '',
      ...(hasImageUrl ? { imageUrl } : {}),
    },
    errors,
  }
}

async function serveAdminFile(res, fileName) {
  const requestedPath = path.resolve(config.adminDir, fileName)

  if (!isInsideDirectory(config.adminDir, requestedPath) || !existsSync(requestedPath)) {
    sendJson(res, 404, { message: 'File not found.' })
    return
  }

  const extension = path.extname(requestedPath)
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream'
  const fileContent = await fs.readFile(requestedPath)

  res.writeHead(200, {
    'Content-Type': mimeType,
    'X-Content-Type-Options': 'nosniff',
  })

  res.end(fileContent)
}

async function handleRequest(req, res) {
  setCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const pathname = decodeURIComponent(requestUrl.pathname)

  if (req.method === 'GET' && pathname === '/') {
    sendJson(res, 200, {
      name: 'Soilgroup Backend',
      adminUrl: '/admin',
      healthcheck: '/api/health',
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    let status = 'ok'
    let storageError = ''

    try {
      await initializeCatalogStore()
    } catch (error) {
      status = 'degraded'
      storageError = error.message || 'Unable to initialize catalog storage.'
    }

    sendJson(res, 200, {
      status,
      service: 'soilgroup-backend',
      catalogStorage: getStorageMode(),
      enquiryStorage: getStorageMode(),
      storageError,
      timestamp: new Date().toISOString(),
    })
    return
  }

  if (req.method === 'POST' && pathname === '/api/enquiries') {
    const payload = await parseJsonBody(req)
    const { enquiry, errors } = parseEnquiryPayload(payload)

    if (errors.length > 0) {
      sendJson(res, 422, {
        message: errors[0],
        errors,
      })
      return
    }

    const createdEnquiry = await createEnquiry(enquiry)

    sendJson(res, 201, {
      message: 'Enquiry submitted successfully.',
      data: createdEnquiry,
    })
    return
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const payload = await parseJsonBody(req)
    const username = sanitizeText(payload.username)
    const password = sanitizeText(payload.password)

    if (!(await authenticateAdmin(username, password))) {
      sendJson(res, 401, {
        message: 'Invalid username or password.',
      })
      return
    }

    const adminProfile = await getAdminProfile()

    sendJson(res, 200, {
      message: 'Login successful.',
      data: {
        token: createAuthToken(username),
        username: adminProfile.username,
        passwordStorage: adminProfile.passwordStorage,
      },
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/categories') {
    const [categories, products] = await Promise.all([readCategories(), readProductSummaries()])

    sendJson(res, 200, {
      data: getPublicCategories(categories, products),
    })
    return
  }

  const publicCategoryProductsMatch = pathname.match(/^\/api\/categories\/([^/]+)\/products$/)

  if (publicCategoryProductsMatch && req.method === 'GET') {
    const requestedCategorySlug = createSlug(publicCategoryProductsMatch[1])
    const [products, categories] = await Promise.all([readProductSummaries(), readCategories()])
    const publishedProducts = enrichProducts(getPublishedProducts(products), categories).filter(
      (product) => product.category?.slug === requestedCategorySlug
    )

    sendJson(res, 200, {
      data: publishedProducts,
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/products') {
    const [products, categories] = await Promise.all([readProductSummaries(), readCategories()])
    const requestedCategorySlug = createSlug(requestUrl.searchParams.get('category'))
    const searchQuery = sanitizeText(requestUrl.searchParams.get('search'))
    const excludeSlug = sanitizeText(requestUrl.searchParams.get('exclude'))
    const limit = parsePositiveInteger(requestUrl.searchParams.get('limit'))

    let visibleProducts = enrichProducts(getPublishedProducts(products), categories)

    if (requestedCategorySlug) {
      visibleProducts = visibleProducts.filter(
        (product) => product.category?.slug === requestedCategorySlug
      )
    }

    if (searchQuery) {
      visibleProducts = visibleProducts.filter((product) =>
        matchesProductSearch(product, searchQuery)
      )
    }

    if (excludeSlug) {
      visibleProducts = visibleProducts.filter((product) => product.slug !== excludeSlug)
    }

    if (limit > 0) {
      visibleProducts = visibleProducts.slice(0, limit)
    }

    sendJson(res, 200, {
      data: visibleProducts,
    })
    return
  }

  const publicProductImageMatch = pathname.match(/^\/api\/products\/([^/]+)\/image$/)

  if (publicProductImageMatch && req.method === 'GET') {
    const requestedSlug = sanitizeText(decodeURIComponent(publicProductImageMatch[1]))
    const product = await readProductImageBySlug(requestedSlug)

    if (!product || product.status !== 'published') {
      sendJson(res, 404, { message: 'Product image not found.' })
      return
    }

    const rawImage = sanitizeText(product.imageUrl || product.image)

    if (!rawImage) {
      sendJson(res, 404, { message: 'Product image not found.' })
      return
    }

    const dataImage = parseDataImageUrl(rawImage)

    if (dataImage) {
      res.writeHead(200, {
        'Content-Type': dataImage.mimeType,
        'Cache-Control': 'public, max-age=86400',
      })
      res.end(dataImage.buffer)
      return
    }

    const normalizedImageUrl = normalizeExternalImageUrl(rawImage)

    if (!normalizedImageUrl) {
      sendJson(res, 404, { message: 'Product image not found.' })
      return
    }

    res.writeHead(302, {
      Location: normalizedImageUrl,
      'Cache-Control': 'public, max-age=3600',
    })
    res.end()
    return
  }

  const publicProductMatch = pathname.match(/^\/api\/products\/([^/]+)$/)

  if (publicProductMatch && req.method === 'GET') {
    const requestedSlug = sanitizeText(publicProductMatch[1])
    const [product, categories] = await Promise.all([
      readProductBySlug(requestedSlug),
      readCategories(),
    ])

    if (!product || product.status !== 'published') {
      sendJson(res, 404, {
        message: 'Product not found.',
      })
      return
    }

    const enrichedProduct = enrichProducts([product], categories)[0]
    enrichedProduct.imageUrl = buildProductImageProxyUrl(product)

    sendJson(res, 200, {
      data: enrichedProduct,
    })
    return
  }

  let admin = null

  if (pathname.startsWith('/api/admin/')) {
    admin = await requireAdmin(req, res)

    if (!admin) {
      return
    }
  }

  if (req.method === 'GET' && pathname === '/api/admin/profile') {
    sendJson(res, 200, {
      data: await getAdminProfile(),
    })
    return
  }

  if (req.method === 'PATCH' && pathname === '/api/admin/credentials') {
    const payload = await parseJsonBody(req)

    try {
      const updatedProfile = await changeAdminCredentials({
        currentUsername: admin.sub,
        currentPassword: sanitizeText(payload.currentPassword),
        newUsername: sanitizeText(payload.username),
        newPassword: String(payload.newPassword || ''),
      })

      sendJson(res, 200, {
        message: 'Admin credentials updated successfully.',
        data: {
          ...updatedProfile,
          token: createAuthToken(updatedProfile.username),
        },
      })
    } catch (error) {
      sendJson(res, 422, {
        message: error.message || 'Unable to update admin credentials.',
      })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/admin/stats') {
    sendJson(res, 200, {
      data: await getAdminStats(),
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/admin/categories') {
    sendJson(res, 200, {
      data: await readCategories(),
    })
    return
  }

  if (req.method === 'POST' && pathname === '/api/admin/categories') {
    const payload = await parseJsonBody(req)
    const { category, errors } = await parseCategoryPayload(payload)

    if (errors.length > 0) {
      sendJson(res, 422, {
        message: errors[0],
        errors,
      })
      return
    }

    const createdCategory = await createCategory(category)

    sendJson(res, 201, {
      message: 'Category added successfully.',
      data: createdCategory,
    })
    return
  }

  const adminCategoryMatch = pathname.match(/^\/api\/admin\/categories\/([^/]+)$/)

  if (adminCategoryMatch && req.method === 'PATCH') {
    const payload = await parseJsonBody(req)
    const categoryId = adminCategoryMatch[1]
    const { category, errors } = await parseCategoryPayload(payload, {
      existingCategoryId: categoryId,
    })

    if (errors.length > 0) {
      sendJson(res, 422, {
        message: errors[0],
        errors,
      })
      return
    }

    const updatedCategory = await updateCategory(categoryId, category)

    if (!updatedCategory) {
      sendJson(res, 404, {
        message: 'Category not found.',
      })
      return
    }

    sendJson(res, 200, {
      message: 'Category updated successfully.',
      data: updatedCategory,
    })
    return
  }

  if (adminCategoryMatch && req.method === 'DELETE') {
    const result = await deleteCategory(adminCategoryMatch[1])

    if (!result.ok && result.reason === 'CATEGORY_HAS_PRODUCTS') {
      sendJson(res, 409, {
        message: 'Delete products in this category before removing the category.',
      })
      return
    }

    if (!result.ok) {
      sendJson(res, 404, {
        message: 'Category not found.',
      })
      return
    }

    sendJson(res, 200, {
      message: 'Category deleted successfully.',
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/admin/products') {
    const [products, categories] = await Promise.all([readProductSummaries(), readCategories()])

    sendJson(res, 200, {
      data: enrichProducts(products, categories),
    })
    return
  }

  const adminProductGetMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/)

  if (adminProductGetMatch && req.method === 'GET') {
    const productId = adminProductGetMatch[1]
    const product = await readProductEditorById(productId)

    if (!product) {
      sendJson(res, 404, { message: 'Product not found.' })
      return
    }

    const editableProduct = {
      ...product,
      imagePreviewUrl: buildProductImageProxyUrl(product),
      imageInputValue: '',
    }

    sendJson(res, 200, { data: editableProduct })
    return
  }

  if (req.method === 'POST' && pathname === '/api/admin/products') {
    const payload = await parseJsonBody(req)
    const { product, errors } = await parseProductPayload(payload)

    if (errors.length > 0) {
      sendJson(res, 422, {
        message: errors[0],
        errors,
      })
      return
    }

    await createProduct(product)

    sendJson(res, 201, {
      message: 'Product added successfully.',
    })
    return
  }

  const adminProductMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/)

  if (adminProductMatch && req.method === 'PATCH') {
    const payload = await parseJsonBody(req)
    const productId = adminProductMatch[1]
    const existing = await readProductEditorById(productId)

    if (!existing) {
      sendJson(res, 404, { message: 'Product not found.' })
      return
    }

    const { product, errors } = await parseProductPayload(
      { ...existing, ...payload },
      { existingProductId: productId }
    )

    if (errors.length > 0) {
      sendJson(res, 422, { message: errors[0], errors })
      return
    }

    const updatedProduct = await updateProduct(productId, product)

    if (!updatedProduct) {
      sendJson(res, 404, { message: 'Product not found.' })
      return
    }

    sendJson(res, 200, {
      message: 'Product updated successfully.',
    })
    return
  }

  if (adminProductMatch && req.method === 'DELETE') {
    const removed = await deleteProduct(adminProductMatch[1])

    if (!removed) {
      sendJson(res, 404, {
        message: 'Product not found.',
      })
      return
    }

    sendJson(res, 200, {
      message: 'Product deleted successfully.',
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/admin/enquiries') {
    sendJson(res, 200, {
      data: await readEnquiries(),
    })
    return
  }

  const adminEnquiryMatch = pathname.match(/^\/api\/admin\/enquiries\/([^/]+)$/)

  if (adminEnquiryMatch && req.method === 'PATCH') {
    const payload = await parseJsonBody(req)
    const nextStatus = sanitizeText(payload.status)

    if (!ENQUIRY_STATUS_OPTIONS.has(nextStatus)) {
      sendJson(res, 422, {
        message: 'Invalid status value.',
      })
      return
    }

    const updatedEnquiry = await updateEnquiry(adminEnquiryMatch[1], { status: nextStatus })

    if (!updatedEnquiry) {
      sendJson(res, 404, {
        message: 'Enquiry not found.',
      })
      return
    }

    sendJson(res, 200, {
      message: 'Enquiry updated successfully.',
      data: updatedEnquiry,
    })
    return
  }

  if (adminEnquiryMatch && req.method === 'DELETE') {
    const removed = await deleteEnquiry(adminEnquiryMatch[1])

    if (!removed) {
      sendJson(res, 404, {
        message: 'Enquiry not found.',
      })
      return
    }

    sendJson(res, 200, {
      message: 'Enquiry removed successfully.',
    })
    return
  }

  if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
    await serveAdminFile(res, 'index.html')
    return
  }

  if (req.method === 'GET' && pathname.startsWith('/admin/')) {
    await serveAdminFile(res, pathname.replace('/admin/', ''))
    return
  }

  sendJson(res, 404, {
    message: 'Route not found.',
  })
}

export async function startServer() {
  await initializeCatalogStore()

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res)
    } catch (error) {
      sendJson(res, 500, {
        message: error.message || 'Internal server error.',
      })
    }
  })

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening)
      reject(error)
    }

    const handleListening = () => {
      server.off('error', handleError)
      resolve()
    }

    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(config.port)
  })

  console.log(`Soilgroup backend is running on http://localhost:${config.port}`)
  console.log(`Admin panel: http://localhost:${config.port}/admin`)
  console.log(`Catalog storage: ${getStorageMode()}`)

  return server
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  startServer().catch((error) => {
    console.error(`Unable to start Soilgroup backend: ${error.message || error}`)
    process.exitCode = 1
  })
}
