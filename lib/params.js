// Helpers to parse HTTP query params

const normalizeArrayParam = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseNumberParam = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const parseIntegerParam = (value) => {
  const num = parseNumberParam(value);
  if (num === undefined) {
    return undefined;
  }
  return Number.isInteger(num) ? num : undefined;
};

module.exports = {
  normalizeArrayParam,
  parseNumberParam,
  parseIntegerParam
};
