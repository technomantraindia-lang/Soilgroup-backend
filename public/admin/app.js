const TOKEN_KEY = 'soilgroup_admin_token'
const ENQUIRY_STATUS_OPTIONS = ['new', 'in-progress', 'resolved', 'archived']
const MAX_PRODUCT_IMAGE_SIZE = 6 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20000
const FEEDBACK_AUTO_HIDE_MS = 3500
const feedbackHideTimers = new WeakMap()

const elements = {
  authPanel: document.getElementById('authPanel'),
  workspace: document.getElementById('workspace'),
  adminNav: document.getElementById('adminNav'),
  loginForm: document.getElementById('loginForm'),
  loginFeedback: document.getElementById('loginFeedback'),
  credentialsForm: document.getElementById('credentialsForm'),
  credentialsSubmitButton: document.getElementById('credentialsSubmitButton'),
  adminStorageLabel: document.getElementById('adminStorageLabel'),
  globalFeedback: document.getElementById('globalFeedback'),
  refreshButton: document.getElementById('refreshButton'),
  logoutButton: document.getElementById('logoutButton'),
  pageEyebrow: document.getElementById('pageEyebrow'),
  pageTitle: document.getElementById('pageTitle'),
  pageDescription: document.getElementById('pageDescription'),
  statsGrid: document.getElementById('statsGrid'),
  recentCategories: document.getElementById('recentCategories'),
  recentProducts: document.getElementById('recentProducts'),
  recentEnquiries: document.getElementById('recentEnquiries'),
  categoryForm: document.getElementById('categoryForm'),
  categorySubmitButton: document.getElementById('categorySubmitButton'),
  categoryCancelButton: document.getElementById('categoryCancelButton'),
  categoryList: document.getElementById('categoryList'),
  categorySearchToggle: document.getElementById('categorySearchToggle'),
  categorySearchInput: document.getElementById('categorySearchInput'),
  categoryCountLabel: document.getElementById('categoryCountLabel'),
  productForm: document.getElementById('productForm'),
  productSubmitButton: document.getElementById('productSubmitButton'),
  productCancelButton: document.getElementById('productCancelButton'),
  productSizeInput: document.getElementById('productSizeInput'),
  addProductSizeButton: document.getElementById('addProductSizeButton'),
  productSizesList: document.getElementById('productSizesList'),
  productList: document.getElementById('productList'),
  productCategorySelect: document.getElementById('productCategorySelect'),
  productImageInput: document.getElementById('productImageInput'),
  productImagePreview: document.getElementById('productImagePreview'),
  productSearchToggle: document.getElementById('productSearchToggle'),
  productSearchInput: document.getElementById('productSearchInput'),
  productCountLabel: document.getElementById('productCountLabel'),
  enquiryList: document.getElementById('enquiryList'),
  filters: document.getElementById('filters'),
  viewPanels: Array.from(document.querySelectorAll('[data-view-panel]')),
  viewLinks: Array.from(document.querySelectorAll('[data-view-link]')),
}

const viewMeta = {
  dashboard: {
    eyebrow: 'Overview',
    title: 'Dashboard',
    description: 'Website snapshot and recent activity will appear here.',
  },
  categories: {
    eyebrow: 'Management',
    title: 'Categories',
    description: 'Create and manage product groups for the website.',
  },
  products: {
    eyebrow: 'Management',
    title: 'Products',
    description: 'Add products to categories and manage their publish state.',
  },
  enquiries: {
    eyebrow: 'Leads',
    title: 'Enquiries',
    description: 'Review incoming enquiries and update their status.',
  },
  settings: {
    eyebrow: 'Security',
    title: 'Settings',
    description: 'Update admin username and password securely.',
  },
}

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  currentView: 'dashboard',
  enquiryFilter: 'all',
  stats: null,
  categories: [],
  products: [],
  enquiries: [],
  adminProfile: null,
  editingCategoryId: '',
  editingProductId: '',
  productFormSizes: [],
  categorySearchQuery: '',
  productSearchQuery: '',
  isCategorySearchOpen: false,
  isProductSearchOpen: false,
}

function setFeedback(element, message, type = 'error') {
  const existingTimer = feedbackHideTimers.get(element)

  if (existingTimer) {
    clearTimeout(existingTimer)
    feedbackHideTimers.delete(element)
  }

  if (!message) {
    element.textContent = ''
    element.className = 'feedback hidden'
    return
  }

  element.textContent = message
  element.className = `feedback ${type}`

  if (type === 'success') {
    const timer = setTimeout(() => {
      setFeedback(element, '')
    }, FEEDBACK_AUTO_HIDE_MS)

    feedbackHideTimers.set(element, timer)
  }
}

function setProductSubmitLoading(isLoading) {
  const buttonText = state.editingProductId ? 'Update Product' : 'Add Product'

  elements.productSubmitButton.disabled = isLoading
  elements.productSubmitButton.classList.toggle('is-loading', isLoading)
  elements.productSubmitButton.setAttribute('aria-busy', String(isLoading))
  elements.productSubmitButton.textContent = isLoading ? 'Saving...' : buttonText
}

function setCredentialsSubmitLoading(isLoading) {
  if (!elements.credentialsSubmitButton) {
    return
  }

  elements.credentialsSubmitButton.disabled = isLoading
  elements.credentialsSubmitButton.classList.toggle('is-loading', isLoading)
  elements.credentialsSubmitButton.setAttribute('aria-busy', String(isLoading))
  elements.credentialsSubmitButton.textContent = isLoading ? 'Saving...' : 'Save Credentials'
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function api(path, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response

  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Server response timed out. The backend or MongoDB may be starting slowly. Please wait a moment and try again.')
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.message || 'Request failed.')
  }

  return payload
}

function formatLabel(value) {
  return String(value || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatDate(value) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString()
}

function getCompactImageLabel(imageUrl) {
  const value = String(imageUrl || '').trim()

  if (!value) {
    return ''
  }

  if (value.startsWith('data:image/')) {
    const formatPart = value.slice('data:image/'.length, value.indexOf(';') > -1 ? value.indexOf(';') : undefined)
    const readableFormat = formatPart ? formatPart.toUpperCase() : 'IMAGE'
    return `Inline ${readableFormat} image (embedded data)`
  }

  if (value.length <= 72) {
    return value
  }

  return `${value.slice(0, 42)}...${value.slice(-20)}`
}

function normalizeExternalImageUrl(value) {
  const url = String(value || '').trim()

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

function normalizeText(value) {
  return String(value || '').toLowerCase().trim()
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }

  if (!value) {
    return []
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PRODUCT_IMAGE_SIZE) {
      reject(new Error('Image size must be less than 6 MB. For large images, use Google Drive or an image URL.'))
      return
    }

    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read selected image.'))
    reader.readAsDataURL(file)
  })
}

function updateProductImagePreview(imageUrl) {
  if (!elements.productImagePreview) {
    return
  }

  const value = normalizeExternalImageUrl(imageUrl)

  if (!value) {
    elements.productImagePreview.src = ''
    elements.productImagePreview.classList.add('hidden')
    return
  }

  elements.productImagePreview.src = value
  elements.productImagePreview.classList.remove('hidden')
}

function parseContentsRows(rawValue) {
  return String(rawValue || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [parameterPart, ...specParts] = line.split('|')
      return {
        parameter: String(parameterPart || '').trim(),
        specification: String(specParts.join('|') || '').trim(),
      }
    })
    .filter((row) => row.parameter)
}

function normalizeContentsValue(contents) {
  if (Array.isArray(contents)) {
    return contents
  }

  const raw = String(contents || '').trim()

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)

    if (Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // Fall back to parsing line-by-line text.
  }

  return parseContentsRows(raw)
}

function formatContentsRows(contents) {
  const normalizedContents = normalizeContentsValue(contents)

  if (!Array.isArray(normalizedContents)) {
    return ''
  }

  return normalizedContents
    .map((item) => {
      const parameter = String(item?.parameter || '').trim()
      const specification = String(item?.specification || item?.quantity || '').trim()

      if (!parameter) {
        return ''
      }

      return `${parameter} | ${specification}`
    })
    .filter(Boolean)
    .join('\n')
}

function renderProductSizesEditor() {
  if (!elements.productSizesList) {
    return
  }

  if (state.productFormSizes.length === 0) {
    elements.productSizesList.innerHTML = '<p class="size-empty">No sizes added yet.</p>'
    return
  }

  elements.productSizesList.innerHTML = state.productFormSizes
    .map(
      (size, index) => `
        <button type="button" class="size-chip" data-size-remove="${index}">
          ${escapeHtml(size)}
          <span aria-hidden="true">x</span>
        </button>
      `
    )
    .join('')
}

function setProductSizes(values) {
  state.productFormSizes = [...new Set(toStringArray(values))]
  renderProductSizesEditor()
}

function addProductSize() {
  const rawValue = String(elements.productSizeInput?.value || '').trim()

  if (!rawValue) {
    return
  }

  if (!state.productFormSizes.includes(rawValue)) {
    state.productFormSizes.push(rawValue)
    renderProductSizesEditor()
  }

  elements.productSizeInput.value = ''
  elements.productSizeInput.focus()
}

function removeProductSize(index) {
  state.productFormSizes = state.productFormSizes.filter((_, itemIndex) => itemIndex !== index)
  renderProductSizesEditor()
}

function getProductStatusClass(status) {
  if (status === 'draft') {
    return 'warning'
  }

  if (status === 'archived') {
    return 'archived'
  }

  return ''
}

function getVisibleCategories() {
  const query = normalizeText(state.categorySearchQuery)

  if (!query) {
    return state.categories
  }

  return state.categories.filter((category) => {
    const searchableText = [
      category.name,
      category.slug,
      category.description,
    ]
      .map((item) => normalizeText(item))
      .join(' ')

    return searchableText.includes(query)
  })
}

function getVisibleProducts() {
  const query = normalizeText(state.productSearchQuery)

  if (!query) {
    return state.products
  }

  return state.products.filter((product) => {
    const searchableText = [
      product.name,
      product.slug,
      product.primaryUse,
      product.shortDescription,
      product.category?.name,
      product.status,
    ]
      .map((item) => normalizeText(item))
      .join(' ')

    return searchableText.includes(query)
  })
}

function syncCategorySearchUi() {
  if (!elements.categorySearchToggle || !elements.categorySearchInput) {
    return
  }

  elements.categorySearchInput.classList.toggle('hidden', !state.isCategorySearchOpen)
  elements.categorySearchToggle.classList.toggle('active', state.isCategorySearchOpen)
}

function syncProductSearchUi() {
  if (!elements.productSearchToggle || !elements.productSearchInput) {
    return
  }

  elements.productSearchInput.classList.toggle('hidden', !state.isProductSearchOpen)
  elements.productSearchToggle.classList.toggle('active', state.isProductSearchOpen)
}

function updateCategoryCountLabel() {
  if (!elements.categoryCountLabel) {
    return
  }

  elements.categoryCountLabel.textContent = `Categories: ${state.categories.length}`
}

function updateProductCountLabel() {
  if (!elements.productCountLabel) {
    return
  }

  elements.productCountLabel.textContent = `Products: ${state.products.length}`
}

function showLogin() {
  elements.authPanel.classList.remove('hidden')
  elements.workspace.classList.add('hidden')
  elements.adminNav.classList.add('hidden')
}

function showWorkspace() {
  elements.authPanel.classList.add('hidden')
  elements.workspace.classList.remove('hidden')
  elements.adminNav.classList.remove('hidden')
}

function updatePageHeader() {
  const meta = viewMeta[state.currentView]

  elements.pageEyebrow.textContent = meta.eyebrow
  elements.pageTitle.textContent = meta.title
  elements.pageDescription.textContent = meta.description
}

function switchView(viewName) {
  resetCategoryForm()
  resetProductForm()
  
  state.currentView = viewName

  elements.viewPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.viewPanel !== viewName)
  })

  elements.viewLinks.forEach((button) => {
    button.classList.toggle('active', button.dataset.viewLink === viewName)
  })

  updatePageHeader()
}

function renderEmptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`
}

function renderStats() {
  const stats = state.stats || {
    enquiries: { total: 0, new: 0, inProgress: 0, resolved: 0 },
    categories: { total: 0 },
    products: { total: 0, published: 0 },
  }

  const cards = [
    { label: 'Total Enquiries', value: stats.enquiries.total, note: `${stats.enquiries.new} new` },
    { label: 'Categories', value: stats.categories.total, note: 'Manage product groups' },
    { label: 'Products', value: stats.products.total, note: `${stats.products.published} published` },
    { label: 'Resolved Enquiries', value: stats.enquiries.resolved, note: `${stats.enquiries.inProgress} in progress` },
  ]

  elements.statsGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <p>${escapeHtml(card.label)}</p>
          <strong>${escapeHtml(card.value)}</strong>
          <small class="muted">${escapeHtml(card.note)}</small>
        </article>
      `
    )
    .join('')
}

function renderRecentList(target, items, type) {
  if (!items.length) {
    target.innerHTML = renderEmptyState(`No ${type} available yet.`)
    return
  }

  target.innerHTML = `
    <div class="recent-list">
      ${items
        .map((item) => {
          if (type === 'categories') {
            return `
              <article class="recent-item">
                <strong>${escapeHtml(item.name)}</strong>
                <p>${escapeHtml(item.description || 'No description added yet.')}</p>
                <small>${escapeHtml(item.slug)} | ${escapeHtml(formatDate(item.createdAt))}</small>
              </article>
            `
          }

          if (type === 'products') {
            return `
              <article class="recent-item">
                <strong>${escapeHtml(item.name)}</strong>
                <p>${escapeHtml(item.shortDescription || 'No short description.')}</p>
                <small>${escapeHtml(item.category?.name || 'No category')} | ${escapeHtml(formatLabel(item.status || 'draft'))}</small>
              </article>
            `
          }

          return `
            <article class="recent-item">
              <strong>${escapeHtml(item.fullName)}</strong>
              <p>${escapeHtml(item.message || 'No message provided.')}</p>
              <small>${escapeHtml(formatLabel(item.status || 'new'))} | ${escapeHtml(formatDate(item.createdAt))}</small>
            </article>
          `
        })
        .join('')}
    </div>
  `
}

function renderDashboard() {
  renderStats()
  renderRecentList(elements.recentCategories, state.categories.slice(0, 4), 'categories')
  renderRecentList(elements.recentProducts, state.products.slice(0, 4), 'products')
  renderRecentList(elements.recentEnquiries, state.enquiries.slice(0, 4), 'enquiries')
}

function renderCategoryOptions() {
  const options = state.categories
    .map(
      (category) => `
        <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>
      `
    )
    .join('')

  elements.productCategorySelect.innerHTML = `<option value="">Select category</option>${options}`
}

function resetCategoryForm() {
  state.editingCategoryId = ''
  elements.categoryForm.reset()
  elements.categorySubmitButton.textContent = 'Add Category'
  elements.categoryCancelButton.classList.add('hidden')
}

function startCategoryEdit(category) {
  state.editingCategoryId = category.id
  elements.categoryForm.elements.name.value = category.name || ''
  elements.categoryForm.elements.slug.value = category.slug || ''
  elements.categoryForm.elements.description.value = category.description || ''
  elements.categorySubmitButton.textContent = 'Update Category'
  elements.categoryCancelButton.classList.remove('hidden')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function resetProductForm() {
  state.editingProductId = ''
  elements.productForm.reset()
  setProductSizes([])
  renderCategoryOptions()
  updateProductImagePreview('')
  if (elements.productImageInput) {
    elements.productImageInput.value = ''
  }
  elements.productSubmitButton.textContent = 'Add Product'
  elements.productCancelButton.classList.add('hidden')
}

function startProductEdit(product) {
  state.editingProductId = product.id
  const sizes = toStringArray(product.availableSizes || product.available_sizes)
  const contentValue = product.contents || product.composition || ''

  elements.productForm.elements.name.value = product.name || ''
  elements.productForm.elements.slug.value = product.slug || ''
  elements.productForm.elements.categoryId.value = product.categoryId || ''
  elements.productForm.elements.primaryUse.value = product.primaryUse || product.shortDescription || ''
  elements.productForm.elements.whatItIs.value = product.what_it_is || ''
  elements.productForm.elements.keyBenefits.value = (product.key_benefits || []).join('\n')
  elements.productForm.elements.whenToUse.value = (product.when_to_use || []).join('\n')
  elements.productForm.elements.recommendedCrops.value = (product.recommended_crops || []).join('\n')
  elements.productForm.elements.applicationDosage.value = product.application_dosage ? JSON.stringify(product.application_dosage, null, 2) : ''
  elements.productForm.elements.learnMore.value = product.learn_more ? JSON.stringify(product.learn_more, null, 2) : ''
  elements.productForm.elements.contentsRows.value = formatContentsRows(contentValue)
  elements.productForm.elements.contentsNote.value = product.contentsNote || product.description || ''
  setProductSizes(sizes)
  elements.productForm.elements.imageUrl.value = product.imageInputValue || ''
  updateProductImagePreview(product.imagePreviewUrl || product.imageUrl || product.image || '')
  elements.productForm.elements.status.value = product.status || 'draft'
  elements.productSubmitButton.textContent = 'Update Product'
  elements.productCancelButton.classList.remove('hidden')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function renderCategories() {
  renderCategoryOptions()
  updateCategoryCountLabel()
  syncCategorySearchUi()

  if (!state.categories.length) {
    elements.categoryList.innerHTML = renderEmptyState('No categories added yet.')
    return
  }

  const visibleCategories = getVisibleCategories()

  if (!visibleCategories.length) {
    elements.categoryList.innerHTML = renderEmptyState('No categories found for this search.')
    return
  }

  elements.categoryList.innerHTML = visibleCategories
    .map(
      (category) => `
        <article class="item-card">
          <div class="item-head">
            <div>
              <h3>${escapeHtml(category.name)}</h3>
              <small>${escapeHtml(category.slug)}</small>
            </div>
            <div class="action-buttons">
              <button type="button" class="ghost-btn" data-category-edit="${category.id}">Edit</button>
              <button type="button" class="delete-btn" data-category-delete="${category.id}">Delete</button>
            </div>
          </div>
          <p>${escapeHtml(category.description || 'No description added yet.')}</p>
          <div class="pill-row">
            <span class="pill">Created ${escapeHtml(formatDate(category.createdAt))}</span>
          </div>
        </article>
      `
    )
    .join('')
}

function renderProducts() {
  renderCategoryOptions()
  updateProductCountLabel()

  syncProductSearchUi()

  if (!state.products.length) {
    elements.productList.innerHTML = renderEmptyState('No products added yet.')
    return
  }

  const visibleProducts = getVisibleProducts()

  if (!visibleProducts.length) {
    elements.productList.innerHTML = renderEmptyState('No products found for this search.')
    return
  }

  elements.productList.innerHTML = visibleProducts
    .map(
      (product) => `
        <article class="item-card">
          <div class="item-head">
            <div>
              <h3>${escapeHtml(product.name)}</h3>
              <small>${escapeHtml(product.slug)}</small>
            </div>
            <div class="action-buttons">
              <button type="button" class="ghost-btn" data-product-edit="${product.id}">Edit</button>
              <button type="button" class="delete-btn" data-product-delete="${product.id}">Delete</button>
            </div>
          </div>
          <p>${escapeHtml(product.primaryUse || product.shortDescription || 'No primary use added.')}</p>
          ${product.subtitle ? `<p><small>${escapeHtml(product.subtitle)}</small></p>` : ''}
          ${product.overview ? `<p><small>${escapeHtml(product.overview)}</small></p>` : ''}
          <div class="pill-row">
            <span class="pill">${escapeHtml(product.category?.name || 'No category')}</span>
            <span class="status-pill ${escapeHtml(getProductStatusClass(product.status))}">${escapeHtml(formatLabel(product.status || 'draft'))}</span>
            <span class="pill">Contents ${escapeHtml(Array.isArray(product.contents) ? product.contents.length : 0)}</span>
            <span class="pill">Sizes ${escapeHtml(toStringArray(product.availableSizes || product.available_sizes).length)}</span>
          </div>
          ${product.imageUrl ? `<p><small class="compact-url" title="${escapeHtml(product.imageUrl)}">${escapeHtml(getCompactImageLabel(product.imageUrl))}</small></p>` : ''}
        </article>
      `
    )
    .join('')
}

function buildStatusOptions(currentStatus) {
  return ENQUIRY_STATUS_OPTIONS.map(
    (status) => `
      <option value="${status}" ${status === currentStatus ? 'selected' : ''}>
        ${formatLabel(status)}
      </option>
    `
  ).join('')
}

function getVisibleEnquiries() {
  if (state.enquiryFilter === 'all') {
    return state.enquiries
  }

  return state.enquiries.filter((enquiry) => enquiry.status === state.enquiryFilter)
}

function renderEnquiries() {
  const enquiries = getVisibleEnquiries()

  if (!enquiries.length) {
    elements.enquiryList.innerHTML = renderEmptyState('No enquiries found for this filter.')
    return
  }

  elements.enquiryList.innerHTML = enquiries
    .map(
      (enquiry) => `
        <article class="enquiry-card">
          <div class="enquiry-meta">
            <div class="enquiry-title-wrap">
              <h3>${escapeHtml(enquiry.fullName)}</h3>
              <span class="status-pill">${escapeHtml(formatLabel(enquiry.status || 'new'))}</span>
              <span class="pill">${escapeHtml(enquiry.category || 'No Category')}</span>
            </div>
            <small class="muted">${escapeHtml(formatDate(enquiry.createdAt))}</small>
          </div>

          <div class="enquiry-actions" style="margin-top: 16px;">
            <button type="button" class="ghost-btn" data-enquiry-toggle="${enquiry.id}">View Details</button>
            <select class="status-select" data-enquiry-status="${enquiry.id}" style="width: auto;">
              ${buildStatusOptions(enquiry.status || 'new')}
            </select>
            <button type="button" class="delete-btn" data-enquiry-delete="${enquiry.id}">Delete</button>
          </div>

          <div id="details-${enquiry.id}" class="hidden" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--line);">
            <div class="enquiry-grid">
              <div class="meta-row">
                <span>Business</span>
                <span>${escapeHtml(enquiry.businessName || '-')}</span>
              </div>
              <div class="meta-row">
                <span>Phone</span>
                <span>${escapeHtml(enquiry.phone || '-')}</span>
              </div>
              <div class="meta-row">
                <span>Email</span>
                <span>${escapeHtml(enquiry.email || '-')}</span>
              </div>
              <div class="meta-row">
                <span>State</span>
                <span>${escapeHtml(enquiry.state || '-')}</span>
              </div>
              <div class="meta-row">
                <span>Consent</span>
                <span>${enquiry.agreed ? 'Accepted' : 'Not accepted'}</span>
              </div>
            </div>

            <p class="message-box" style="margin-top: 16px;">${escapeHtml(enquiry.message || '-')}</p>
          </div>
        </article>
      `
    )
    .join('')
}

function renderSettings() {
  if (!elements.credentialsForm) {
    return
  }

  const username = state.adminProfile?.username || ''
  const passwordStorage = state.adminProfile?.passwordStorage === 'hashed'
    ? 'Password storage: hashed'
    : 'Password storage: env/default'

  elements.credentialsForm.elements.username.value = username
  elements.adminStorageLabel.textContent = passwordStorage
}

function renderAll() {
  renderDashboard()
  renderCategories()
  renderProducts()
  renderEnquiries()
  renderSettings()
}

async function loadWorkspaceData() {
  const [profileResponse, statsResponse, categoriesResponse, productsResponse, enquiriesResponse] = await Promise.all([
    api('/admin/profile'),
    api('/admin/stats'),
    api('/admin/categories'),
    api('/admin/products'),
    api('/admin/enquiries'),
  ])

  state.adminProfile = profileResponse.data || null
  state.stats = statsResponse.data || null
  state.categories = categoriesResponse.data || []
  state.products = productsResponse.data || []
  state.enquiries = enquiriesResponse.data || []

  renderAll()
}

async function refreshWorkspace(successMessage = '') {
  try {
    await loadWorkspaceData()
    showWorkspace()
    switchView(state.currentView)
    setFeedback(elements.globalFeedback, successMessage, successMessage ? 'success' : 'success')
    if (!successMessage) {
      setFeedback(elements.globalFeedback, '')
    }
  } catch (error) {
    localStorage.removeItem(TOKEN_KEY)
    state.token = ''
    showLogin()
    setFeedback(elements.loginFeedback, error.message, 'error')
  }
}

async function handleLogin(event) {
  event.preventDefault()
  setFeedback(elements.loginFeedback, '')

  const form = new FormData(elements.loginForm)
  const username = String(form.get('username') || '').trim()
  const password = String(form.get('password') || '').trim()

  try {
    const response = await api('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })

    state.token = response.data.token
    state.adminProfile = {
      username: response.data.username,
      passwordStorage: response.data.passwordStorage || 'env',
    }
    localStorage.setItem(TOKEN_KEY, state.token)
    elements.loginForm.reset()
    await refreshWorkspace()
  } catch (error) {
    setFeedback(elements.loginFeedback, error.message, 'error')
  }
}

async function handleCredentialsSubmit(event) {
  event.preventDefault()
  setFeedback(elements.globalFeedback, '')

  const form = new FormData(elements.credentialsForm)
  const username = String(form.get('username') || '').trim()
  const currentPassword = String(form.get('currentPassword') || '')
  const newPassword = String(form.get('newPassword') || '')
  const confirmPassword = String(form.get('confirmPassword') || '')

  if (newPassword !== confirmPassword) {
    setFeedback(elements.globalFeedback, 'New password and confirm password do not match.', 'error')
    return
  }

  setCredentialsSubmitLoading(true)

  try {
    const response = await api('/admin/credentials', {
      method: 'PATCH',
      body: JSON.stringify({
        username,
        currentPassword,
        newPassword,
      }),
    })

    state.token = response.data.token
    state.adminProfile = {
      username: response.data.username,
      passwordStorage: response.data.passwordStorage,
    }
    localStorage.setItem(TOKEN_KEY, state.token)
    elements.credentialsForm.reset()
    renderSettings()
    setFeedback(elements.globalFeedback, 'Admin credentials updated successfully.', 'success')
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  } finally {
    setCredentialsSubmitLoading(false)
  }
}

async function handleCategorySubmit(event) {
  event.preventDefault()
  const form = new FormData(elements.categoryForm)
  const payload = {
    name: form.get('name'),
    slug: form.get('slug'),
    description: form.get('description'),
  }

  try {
    if (state.editingCategoryId) {
      await api(`/admin/categories/${state.editingCategoryId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      resetCategoryForm()
      state.currentView = 'categories'
      await refreshWorkspace('Category updated successfully.')
      return
    }

    await api('/admin/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    resetCategoryForm()
    state.currentView = 'categories'
    await refreshWorkspace('Category added successfully.')
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  }
}

async function handleProductSubmit(event) {
  event.preventDefault()

  if (elements.productSubmitButton.disabled) {
    return
  }

  setFeedback(elements.globalFeedback, '')
  setProductSubmitLoading(true)

  const form = new FormData(elements.productForm)
  const contents = parseContentsRows(form.get('contentsRows'))
  const availableSizes = state.productFormSizes
  const uploadedFile = elements.productImageInput?.files?.[0] || null
  const typedImageUrl = normalizeExternalImageUrl(form.get('imageUrl'))

  try {
    if (uploadedFile) {
      const imageUrl = await readFileAsDataUrl(uploadedFile)
      await submitProductForm({ form, contents, availableSizes, imageUrl })
      return
    }

    await submitProductForm({ form, contents, availableSizes, imageUrl: typedImageUrl })
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  } finally {
    setProductSubmitLoading(false)
  }
}

async function submitProductForm({ form, contents, availableSizes, imageUrl }) {
  const safeJSONParse = (str) => {
    try { return JSON.parse(str) } catch (e) { return [] }
  }

  const payload = {
    name: form.get('name'),
    slug: form.get('slug'),
    categoryId: form.get('categoryId'),
    primaryUse: form.get('primaryUse'),
    what_it_is: form.get('whatItIs'),
    key_benefits: (form.get('keyBenefits') || '').split('\n').map(l => l.trim()).filter(Boolean),
    when_to_use: (form.get('whenToUse') || '').split('\n').map(l => l.trim()).filter(Boolean),
    recommended_crops: (form.get('recommendedCrops') || '').split('\n').map(l => l.trim()).filter(Boolean),
    application_dosage: safeJSONParse(form.get('applicationDosage') || '[]'),
    learn_more: safeJSONParse(form.get('learnMore') || '[]'),
    contents,
    contentsNote: form.get('contentsNote'),
    availableSizes,
    status: form.get('status'),
  }

  if (imageUrl) {
    payload.imageUrl = imageUrl
  }

  try {
    if (state.editingProductId) {
      await api(`/admin/products/${state.editingProductId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      resetProductForm()
      state.currentView = 'products'
      await refreshWorkspace('Product updated successfully.')
      return
    }

    await api('/admin/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    resetProductForm()
    state.currentView = 'products'
    await refreshWorkspace('Product added successfully.')
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  }
}

async function deleteCategory(categoryId) {
  const confirmed = window.confirm('Do you want to delete this category?')

  if (!confirmed) {
    return
  }

  try {
    await api(`/admin/categories/${categoryId}`, {
      method: 'DELETE',
    })

    if (state.editingCategoryId === categoryId) {
      resetCategoryForm()
    }

    state.currentView = 'categories'
    await refreshWorkspace('Category deleted successfully.')
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  }
}

async function deleteProduct(productId) {
  const confirmed = window.confirm('Do you want to delete this product?')

  if (!confirmed) {
    return
  }

  try {
    await api(`/admin/products/${productId}`, {
      method: 'DELETE',
    })

    if (state.editingProductId === productId) {
      resetProductForm()
    }

    state.currentView = 'products'
    await refreshWorkspace('Product deleted successfully.')
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  }
}

async function updateEnquiryStatus(enquiryId, status) {
  try {
    await api(`/admin/enquiries/${enquiryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    state.currentView = 'enquiries'
    await refreshWorkspace('Enquiry status updated.')
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  }
}

async function removeEnquiry(enquiryId) {
  const confirmed = window.confirm('Do you want to delete this enquiry?')

  if (!confirmed) {
    return
  }

  try {
    await api(`/admin/enquiries/${enquiryId}`, {
      method: 'DELETE',
    })
    state.currentView = 'enquiries'
    await refreshWorkspace('Enquiry deleted successfully.')
  } catch (error) {
    setFeedback(elements.globalFeedback, error.message, 'error')
  }
}

elements.loginForm.addEventListener('submit', handleLogin)
if (elements.credentialsForm) {
  elements.credentialsForm.addEventListener('submit', handleCredentialsSubmit)
}
elements.categoryForm.addEventListener('submit', handleCategorySubmit)
elements.productForm.addEventListener('submit', handleProductSubmit)
elements.categoryCancelButton.addEventListener('click', resetCategoryForm)
elements.productCancelButton.addEventListener('click', resetProductForm)
elements.addProductSizeButton.addEventListener('click', addProductSize)
elements.productImageInput.addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0]

  if (!file) {
    updateProductImagePreview(elements.productForm.elements.imageUrl.value)
    return
  }

  try {
    const dataUrl = await readFileAsDataUrl(file)
    elements.productForm.elements.imageUrl.value = dataUrl
    updateProductImagePreview(dataUrl)
  } catch (error) {
    event.target.value = ''
    setFeedback(elements.globalFeedback, error.message, 'error')
  }
})
elements.productForm.elements.imageUrl.addEventListener('input', (event) => {
  updateProductImagePreview(event.target.value)
})
elements.productSizeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    addProductSize()
  }
})
elements.productSizesList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-size-remove]')

  if (!button) {
    return
  }

  removeProductSize(Number(button.dataset.sizeRemove))
})

if (elements.categorySearchToggle && elements.categorySearchInput) {
  elements.categorySearchToggle.addEventListener('click', () => {
    state.isCategorySearchOpen = !state.isCategorySearchOpen

    if (!state.isCategorySearchOpen) {
      state.categorySearchQuery = ''
      elements.categorySearchInput.value = ''
    }

    syncCategorySearchUi()
    renderCategories()

    if (state.isCategorySearchOpen) {
      elements.categorySearchInput.focus()
    }
  })

  elements.categorySearchInput.addEventListener('input', (event) => {
    state.categorySearchQuery = event.target.value || ''
    renderCategories()
  })
}

if (elements.productSearchToggle && elements.productSearchInput) {
  elements.productSearchToggle.addEventListener('click', () => {
    state.isProductSearchOpen = !state.isProductSearchOpen

    if (!state.isProductSearchOpen) {
      state.productSearchQuery = ''
      elements.productSearchInput.value = ''
    }

    syncProductSearchUi()
    renderProducts()

    if (state.isProductSearchOpen) {
      elements.productSearchInput.focus()
    }
  })

  elements.productSearchInput.addEventListener('input', (event) => {
    state.productSearchQuery = event.target.value || ''
    renderProducts()
  })
}

elements.adminNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view-link]')

  if (!button) {
    return
  }

  switchView(button.dataset.viewLink)
  setFeedback(elements.globalFeedback, '')
})

elements.refreshButton.addEventListener('click', () => {
  refreshWorkspace('Workspace refreshed.')
})

elements.logoutButton.addEventListener('click', () => {
  state.token = ''
  localStorage.removeItem(TOKEN_KEY)
  setFeedback(elements.globalFeedback, '')
  showLogin()
})

elements.filters.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-filter]')

  if (!filterButton) {
    return
  }

  state.enquiryFilter = filterButton.dataset.filter

  Array.from(elements.filters.querySelectorAll('[data-filter]')).forEach((button) => {
    button.classList.toggle('active', button === filterButton)
  })

  renderEnquiries()
})

elements.categoryList.addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-category-edit]')
  const deleteButton = event.target.closest('[data-category-delete]')

  if (editButton) {
    const category = state.categories.find((item) => item.id === editButton.dataset.categoryEdit)

    if (!category) {
      return
    }

    startCategoryEdit(category)
    return
  }

  if (!deleteButton) {
    return
  }

  deleteCategory(deleteButton.dataset.categoryDelete)
})

elements.productList.addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-product-edit]')
  const deleteButton = event.target.closest('[data-product-delete]')

  if (editButton) {
    const productId = editButton.dataset.productEdit

    api(`/admin/products/${productId}`)
      .then((response) => {
        if (response?.data) {
          startProductEdit(response.data)
        }
      })
      .catch((error) => {
        setFeedback(elements.globalFeedback, error.message, 'error')
      })
    return
  }

  if (!deleteButton) {
    return
  }

  deleteProduct(deleteButton.dataset.productDelete)
})

elements.enquiryList.addEventListener('change', (event) => {
  const enquiryId = event.target.dataset.enquiryStatus

  if (!enquiryId) {
    return
  }

  updateEnquiryStatus(enquiryId, event.target.value)
})

elements.enquiryList.addEventListener('click', (event) => {
  const toggleBtn = event.target.closest('[data-enquiry-toggle]')
  const deleteButton = event.target.closest('[data-enquiry-delete]')

  if (toggleBtn) {
    const id = toggleBtn.dataset.enquiryToggle
    const details = document.getElementById(`details-${id}`)
    if (details) {
      const isHidden = details.classList.contains('hidden')
      details.classList.toggle('hidden')
      toggleBtn.textContent = isHidden ? 'Hide Details' : 'View Details'
    }
    return
  }

  if (!deleteButton) {
    return
  }

  removeEnquiry(deleteButton.dataset.enquiryDelete)
})

if (state.token) {
  refreshWorkspace()
} else {
  showLogin()
}

renderProductSizesEditor()
