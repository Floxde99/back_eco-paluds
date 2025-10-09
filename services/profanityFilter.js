const Filter = require('bad-words');

const frenchWords = [
  'abruti',
  'andouille',
  'baiseur',
  'batard',
  'bordel',
  'con',
  'connard',
  'conne',
  'crotte',
  'cul',
  'enfoiré',
  'foutre',
  'garce',
  'gland',
  'merde',
  'naze',
  'ordure',
  'putain',
  'pute',
  'salope',
  'tafiole',
  'trouille',
  'vaurien'
];

const extraPatterns = [
  /f+u+c*k+/i,
  /s+h+i+t+/i,
  /b+i+t+c+h+/i,
  /\b(?:wtf|stfu|fdp)\b/i,
  /\b(?:encul[eé]|nique ta m[eè]re)\b/i
];

const filter = new Filter({ placeHolder: '*' });
filter.addWords(...frenchWords);

function hasProfanity(text = '') {
  if (!text) return false;
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .toLowerCase();

  if (filter.isProfane(normalized)) {
    return true;
  }

  return extraPatterns.some((pattern) => pattern.test(text)) || /([a-z])\1{3,}/i.test(text);
}

module.exports = { hasProfanity };
