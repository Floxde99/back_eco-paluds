// Constantes de Rate Limiting
const RATE_LIMIT = {
  LOGIN: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_ATTEMPTS: 5
  },
  UPLOAD: {
    WINDOW_MS: 60 * 60 * 1000, // 1 heure
    MAX_ATTEMPTS: 10
  },
  WEBHOOK: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_ATTEMPTS: 60
  },
  GLOBAL: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_ATTEMPTS: 100
  }
};

// Constantes de Tokens
const TOKEN = {
  REFRESH_TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 jours
  ACCESS_TOKEN_EXPIRY: '15m',
  EMAIL_TOKEN_EXPIRY: '24h'
};

// Constantes de Cache
const CACHE = {
  DIRECTORY_TTL_MS: 60 * 1000, // 1 minute
  DIRECTORY_MAX_ENTRIES: 200
};

// Constantes de Pagination
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 12,
  MAX_LIMIT: 50
};

// Constantes de Validation
const VALIDATION = {
  PASSWORD_MIN_LENGTH: 8,
  BCRYPT_ROUNDS: 12,
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  AVATAR_MAX_WIDTH: 800,
  AVATAR_QUALITY: 75
};

// Statuts autorisés pour l'annuaire
const DIRECTORY_ALLOWED_STATUSES = ['validated', 'approved', 'pending', 'active'];

// Coordonnées de référence par défaut (Paluds)
const DEFAULT_REFERENCE_COORDINATES = {
  latitude: 43.2965,
  longitude: 5.5653
};

module.exports = {
  RATE_LIMIT,
  TOKEN,
  CACHE,
  PAGINATION,
  VALIDATION,
  DIRECTORY_ALLOWED_STATUSES,
  DEFAULT_REFERENCE_COORDINATES
};
