const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
const SALT = 'fxcrypt-bot-v1'

function deriveKey(uid, masterSecret) {
  return crypto.scryptSync(uid + masterSecret, SALT, 32)
}

function encrypt(plaintext, uid, masterSecret) {
  const key = deriveKey(uid, masterSecret)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted].join(':')
}

function decrypt(encryptedText, uid, masterSecret) {
  const key = deriveKey(uid, masterSecret)
  const parts = encryptedText.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted format')
  const [ivHex, authTagHex, encrypted] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

module.exports = { encrypt, decrypt }
