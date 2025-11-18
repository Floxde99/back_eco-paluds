const crypto = require('crypto');

const DEVICE_HEADER_CANDIDATES = [
  'x-device-id',
  'x-client-id',
  'x-app-device-id'
];

const sanitizeInput = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const hashDeviceDescriptor = (descriptor) =>
  crypto.createHash('sha256').update(descriptor).digest('hex');

const resolveDeviceId = (req = {}) => {
  const headers = req.headers || {};
  let rawId = DEVICE_HEADER_CANDIDATES
    .map((key) => sanitizeInput(headers[key]))
    .find(Boolean);

  if (!rawId && req.body) {
    rawId = sanitizeInput(req.body.deviceId);
  }

  if (!rawId) {
    const userAgent = sanitizeInput(headers['user-agent']) || 'unknown-agent';
    const ip =
      sanitizeInput(req.ip) ||
      sanitizeInput(req.connection?.remoteAddress) ||
      'unknown-ip';
    rawId = `${userAgent}::${ip}`;
  }

  return hashDeviceDescriptor(rawId);
};

module.exports = {
  resolveDeviceId
};
