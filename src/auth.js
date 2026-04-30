import crypto from 'node:crypto'
import { config } from './config.js'
import { readAdminCredentials, saveAdminCredentials } from './store.js'

const PASSWORD_HASH_PREFIX = 'scrypt-v1'
const PASSWORD_KEY_LENGTH = 64

function signToken(value) {
  return crypto.createHmac('sha256', config.jwtSecret).update(value).digest('base64url')
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url')
  const hash = crypto.scryptSync(String(password || ''), salt, PASSWORD_KEY_LENGTH).toString('base64url')

  return `${PASSWORD_HASH_PREFIX}$${salt}$${hash}`
}

function verifyPassword(password, storedHash) {
  const [prefix, salt, hash] = String(storedHash || '').split('$')

  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !hash) {
    return false
  }

  const passwordHash = crypto
    .scryptSync(String(password || ''), salt, PASSWORD_KEY_LENGTH)
    .toString('base64url')

  return safeCompare(passwordHash, hash)
}

async function getCurrentAdminCredentials() {
  const storedCredentials = await readAdminCredentials()

  if (storedCredentials?.username && storedCredentials?.passwordHash) {
    return {
      username: storedCredentials.username,
      passwordHash: storedCredentials.passwordHash,
      isStored: true,
    }
  }

  return {
    username: config.adminUsername,
    password: config.adminPassword,
    isStored: false,
  }
}

export function createAuthToken(username) {
  const payload = {
    sub: username,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = signToken(encodedPayload)

  return `${encodedPayload}.${signature}`
}

export function verifyAuthToken(token) {
  if (!token || !token.includes('.')) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  if (signToken(encodedPayload) !== signature) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))

    if (!payload?.exp || payload.exp < Date.now()) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export async function authenticateAdmin(username, password) {
  const credentials = await getCurrentAdminCredentials()

  if (username !== credentials.username) {
    return false
  }

  if (credentials.isStored) {
    return verifyPassword(password, credentials.passwordHash)
  }

  return safeCompare(password, credentials.password)
}

export async function getAdminProfile() {
  const credentials = await getCurrentAdminCredentials()

  return {
    username: credentials.username,
    passwordStorage: credentials.isStored ? 'hashed' : 'env',
  }
}

export async function changeAdminCredentials({ currentUsername, currentPassword, newUsername, newPassword }) {
  const activeCredentials = await getCurrentAdminCredentials()
  const username = String(newUsername || '').trim()
  const password = String(newPassword || '')

  if (!username) {
    throw new Error('Username is required.')
  }

  if (password.length < 8) {
    throw new Error('New password must be at least 8 characters.')
  }

  if (currentUsername !== activeCredentials.username) {
    throw new Error('Current session does not match the active admin user.')
  }

  const currentPasswordIsValid = activeCredentials.isStored
    ? verifyPassword(currentPassword, activeCredentials.passwordHash)
    : safeCompare(currentPassword, activeCredentials.password)

  if (!currentPasswordIsValid) {
    throw new Error('Current password is incorrect.')
  }

  const credentials = await saveAdminCredentials({
    username,
    passwordHash: hashPassword(password),
  })

  return {
    username: credentials.username,
    passwordStorage: 'hashed',
  }
}

export function readBearerToken(headers) {
  const authorization = headers.authorization || ''

  if (!authorization.startsWith('Bearer ')) {
    return null
  }

  return authorization.slice(7).trim()
}
