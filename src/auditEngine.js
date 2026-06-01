// Australia Post eParcel product codes surfaced in decoded article identifiers.
export const PRODUCT_CODE_MAP = {
  '00091': 'Parcel Post (Non-Signature)',
  '00093': 'Parcel Post + Signature',
  '00096': 'Express Post + Signature',
  '00087': 'Express Post (Non-Signature)',
  '00065': 'Parcel Post Return',
  '00068': 'Express Post Return'
};

// eParcel service-code definitions and the delivery flags expected in API payloads.
export const SERVICE_CODE_MAP = {
  '03': {
    name: 'Signature Required',
    description: 'Signature on delivery always required. If signature cannot be obtained, parcel must be carded to Post Office.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  '08': {
    name: 'Authority To Leave',
    description: 'Authority to leave if unattended.',
    authority_to_leave: true,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  '45': {
    name: 'Partial Delivery Allowed',
    description: 'Signature required with partial delivery allowed.',
    authority_to_leave: false,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '15': {
    name: 'ATL + Partial Delivery',
    description: 'Authority to leave enabled with partial delivery allowed.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '50': {
    name: 'Safe Drop Enabled',
    description: 'Signature required with safe drop enabled.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: true
  },
  '51': {
    name: 'Safe Drop + Partial Delivery',
    description: 'Safe drop enabled with partial delivery allowed.',
    authority_to_leave: false,
    allow_partial_delivery: true,
    safe_drop_enabled: true
  },
  '09': {
    name: 'Non-Signature + ATL',
    description: 'Authority to leave with non-signature service.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '49': {
    name: 'Wine Delivery - Addressee Only',
    description: 'Wine delivery requiring identity on delivery and addressee-only delivery.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false,
    requires_identity_on_delivery: true,
    id_capture_type: 'addressee'
  },
  '81': {
    name: 'Wine Delivery - Signature',
    description: 'Wine delivery with mandatory signature.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  '82': {
    name: 'Wine Delivery - ATL',
    description: 'Wine delivery with authority to leave enabled.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '83': {
    name: 'Wine Delivery - Safe Drop',
    description: 'Wine delivery with safe drop enabled.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: true
  }
};

// Allowed service/product combinations for standard eParcel article identifiers.
export const SERVICE_TO_PRODUCT_MAP = {
  '03': ['00093', '00096', '00065', '00068'],
  '08': ['00093', '00096', '00065', '00068'],
  '45': ['00093', '00096'],
  '15': ['00093', '00096'],
  '50': ['00093', '00096'],
  '51': ['00093', '00096'],
  '09': ['00091', '00087'],
  '49': ['00093'],
  '81': ['00093'],
  '82': ['00093'],
  '83': ['00093']
};

// StarTrack freight product codes, grouped with the routing label code they should use.
export const STARTRACK_PRODUCT_CODE_MAP = {
  TSE: { name: 'Tradeshow Express', group: 'Special Services', labelCode: 'TSE' },
  RET: { name: 'Express Tail-Lift', group: 'Special Services', labelCode: 'RET' },
  RE2: { name: 'Express Tail-Lift 2 man', group: 'Special Services', labelCode: 'RE2' },
  APT: { name: 'Premium Tail-Lift', group: 'Special Services', labelCode: 'APT' },
  PRM: { name: 'Premium', group: 'Premium services', labelCode: 'PRM' },
  FPP: { name: '1, 3 & 5Kg Fixed Price Premium', group: 'Premium services', labelCode: 'PRM' },
  ARL: { name: 'Airlock', group: 'Premium services', labelCode: 'ARL' },
  FPA: { name: '1, 3 & 5Kg Fixed Price Airlock', group: 'Premium services', labelCode: 'ARL' },
  EXP: { name: 'Express', group: 'Express services', labelCode: 'EXP' }
};

// Reverse lookup from StarTrack routing label code to supported product code(s).
export const STARTRACK_LABEL_CODE_MAP = Object.entries(STARTRACK_PRODUCT_CODE_MAP).reduce((acc, [code, meta]) => {
  if (!acc[meta.labelCode]) acc[meta.labelCode] = [];
  acc[meta.labelCode].push(code);
  return acc;
}, {});

// Unit types accepted for each StarTrack product family when a QR payload includes unit data.
export const STARTRACK_UNIT_TYPE_MAP = {
  BAG: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  CTN: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  ITM: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  JIF: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  PAL: ['EXP','PRM','RET','RE2'],
  SAT: ['FPP','FPA'],
  SKI: ['EXP','PRM','RET','RE2']
};

const STATE_REGEX = '(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)';
const POSTCODE_LINE_REGEX = new RegExp(`\\b([A-Z][A-Z\\s'-]+?\\s+${STATE_REGEX}\\s+\\d{4})\\b`, 'i');

/** Returns a human-readable eParcel product description for a decoded product code. */
export function getProductCodeDescription(code) {
  return PRODUCT_CODE_MAP[code] || 'Unknown product code';
}

/** Returns the service-code description shown in reports and validation messages. */
export function getServiceCodeDescription(code) {
  const service = SERVICE_CODE_MAP[code];
  return service ? `${service.name} - ${service.description}` : 'Unknown service code';
}

/** Returns the raw service-code rule object used for payload flag comparison. */
export function getServiceCodeRules(code) {
  return SERVICE_CODE_MAP[code] || null;
}

/** Creates a normalized validation result row for the UI and HTML reports. */
function result(id, title, severity, category, status, message, extra = {}) {
  return { id, title, severity, category, status, message, ...extra };
}

/** Normalizes scanner output so GS1 AI strings can be parsed consistently. */
export function normalizeBarcode(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\]C1/, '')
    .replace(/^\]d2/, '')
    .replace(/\u001d/g, '|')
    .replace(/\x1d/g, '|')
    .replace(/\u001e/g, '|')
    .replace(/\x1e/g, '|')
    .replace(/\u001c/g, '|')
    .replace(/\x1c/g, '|')
    .replace(/\(01\)/g, '01')
    .replace(/\(91\)/g, '91')
    .replace(/\(420\)/g, '|420')
    .replace(/\(92\)/g, '|92')
    .replace(/\(8008\)/g, '|8008')
    .replace(/[\t ]+/g, '')
    .replace(/\r?\n/g, '|');
}

/** Converts an eParcel alpha character to the digit used by the article check-digit algorithm. */
export function alphaToAsciiLastDigit(ch) {
  if (/^[A-Z]$/.test(ch)) return String(ch.charCodeAt(0)).slice(-1);
  return ch;
}

/** Calculates the eParcel article check digit and returns audit-friendly working details. */
export function calculateEparcelCheckDigit(articleWithoutCheckDigit) {
  const input = String(articleWithoutCheckDigit || '').toUpperCase();
  const converted = input.split('').map(alphaToAsciiLastDigit).join('');
  if (!/^\d+$/.test(converted)) {
    return {
      validInput: false,
      converted,
      weightedSum: null,
      checkDigit: null,
      steps: `Input contains invalid characters after alpha substitution: ${converted}`
    };
  }
  let sum = 0;
  const terms = [];
  let positionFromRight = 1;
  for (let i = converted.length - 1; i >= 0; i -= 1) {
    const digit = Number(converted[i]);
    const weight = positionFromRight % 2 === 1 ? 3 : 1;
    const value = digit * weight;
    terms.push(`${digit}x${weight}=${value}`);
    sum += value;
    positionFromRight += 1;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return {
    validInput: true,
    converted,
    weightedSum: sum,
    checkDigit: String(checkDigit),
    steps: `Converted=${converted}; ${terms.join(' + ')}; sum=${sum}; checkDigit=${checkDigit}`
  };
}

/** Parses a cleaned eParcel article or SSCC candidate when it matches a supported structure. */
function parseValidArticleId(cleaned) {
  if (/^00\d{18}$/.test(cleaned)) {
    return { type: 'sscc', articleId: cleaned, sscc: cleaned, valid: true };
  }

  const candidates = [];
  if (/^[A-Z0-9]{21}$/.test(cleaned)) candidates.push(3);
  if (/^[A-Z0-9]{23}$/.test(cleaned)) candidates.push(5);

  for (const mlidLength of candidates) {
    const mlid = cleaned.slice(0, mlidLength);
    const consignmentSuffix = cleaned.slice(mlidLength, mlidLength + 7);
    const articleCount = cleaned.slice(mlidLength + 7, mlidLength + 9);
    const productCode = cleaned.slice(mlidLength + 9, mlidLength + 14);
    const serviceCode = cleaned.slice(mlidLength + 14, mlidLength + 16);
    const postagePaidIndicator = cleaned.slice(mlidLength + 16, mlidLength + 17);
    const checkDigit = cleaned.slice(mlidLength + 17, mlidLength + 18);
    const withoutCheckDigit = cleaned.slice(0, -1);
    if (/^[A-Z0-9]+$/.test(mlid) && /^\d{7}$/.test(consignmentSuffix) && /^\d{2}$/.test(articleCount)) {
      return {
        type: 'eparcel-standard',
        articleId: cleaned,
        mlid,
        consignmentSuffix,
        consignmentId: `${mlid}${consignmentSuffix}`,
        articleCount,
        productCode,
        productDescription: getProductCodeDescription(productCode),
        serviceCode,
        serviceDescription: getServiceCodeDescription(serviceCode),
        postagePaidIndicator,
        checkDigit,
        withoutCheckDigit,
        mlidLength,
        valid: true
      };
    }
  }

  return null;
}

/** Validates an article candidate and explains why unsupported structures fail. */
export function analyzeArticleCandidate(candidate) {
  const cleaned = String(candidate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  const valid = parseValidArticleId(cleaned);
  if (valid) return { valid: true, article: valid, candidate: cleaned, reason: null };

  let reason = 'Article string does not match a standard eParcel article ID or SSCC structure.';
  if (/^00\d+$/.test(cleaned) && cleaned.length !== 20) {
    reason = `SSCC article IDs must be 20 digits including AI 00. Detected length ${cleaned.length}.`;
  } else if (/^\d+$/.test(cleaned) || /^[A-Z0-9]+$/.test(cleaned)) {
    reason = `Standard eParcel article IDs must be 21 characters for 3-character MLID or 23 characters for 5-character MLID. Detected length ${cleaned.length}.`;
  }
  return { valid: false, article: null, candidate: cleaned, reason };
}

/** Keeps the valid article prefix when scanner output includes trailing GS1 data. */
function trimArticleCandidate(candidate) {
  const cleaned = String(candidate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  // Standard eParcel article IDs are 21 chars (3-char MLID) or 23 chars (5-char MLID).
  for (const len of [21, 23]) {
    const slice = cleaned.slice(0, len);
    if (analyzeArticleCandidate(slice)?.valid) return slice;
  }
  return cleaned;
}

/** Extracts the eParcel article component from normalized GS1 AI 91 data. */
function extractArticleCandidateFromGs1Normalized(normalized, compact) {
  const n = String(normalized || '');
  const c = String(compact || '');

  if (n.startsWith('0199312650999998') && n.slice(16, 18) === '91') {
    return trimArticleCandidate(n.slice(18).split('|')[0]);
  }

  const normalizedAi91 = n.match(/(?:^|\|)91([A-Z0-9]{21,23})(?:\||$)/i);
  if (normalizedAi91) return trimArticleCandidate(normalizedAi91[1]);

  // Looser fallback for scanners that return GS1 data without group separators.
  const ai91Index = c.indexOf('91', 14);
  if (c.startsWith('01') && ai91Index >= 14) return trimArticleCandidate(c.slice(ai91Index + 2));
  return null;
}

/** Parses eParcel GS1-128, article-like, and SSCC barcode strings into structured fields. */
export function parseEparcelBarcode(raw) {
  const normalized = normalizeBarcode(raw);
  const compact = normalized.replace(/\|/g, '');
  const isSscc = /^00\d{18}$/.test(compact);
  if (isSscc) {
    const analysis = analyzeArticleCandidate(compact);
    return { symbologyType: 'GS1-128/SSCC', raw, normalized, compact, isSscc: true, article: analysis?.article || null, articleAnalysis: analysis };
  }

  const hasAi01 = compact.startsWith('01');
  const hasAusPostGtin = compact.startsWith('0199312650999998');
  const hasAi91 = hasAusPostGtin ? compact.slice(16, 18) === '91' : compact.includes('91');

  let articleCandidate = extractArticleCandidateFromGs1Normalized(normalized, compact);
  if (!articleCandidate && /^[A-Z0-9]{10,30}$/.test(compact)) articleCandidate = trimArticleCandidate(compact);

  const articleAnalysis = articleCandidate ? analyzeArticleCandidate(articleCandidate) : null;

  return {
    symbologyType: normalized.includes('420') || normalized.includes('8008') ? 'GS1-DataMatrix-like' : 'GS1-128/Article-like',
    raw,
    normalized,
    compact,
    hasAi01,
    hasAi91,
    hasAusPostGtin,
    articleCandidate,
    articleCandidateLength: articleCandidate?.length || 0,
    isSscc: Boolean(articleAnalysis?.article?.type === 'sscc'),
    article: articleAnalysis?.article || null,
    articleAnalysis
  };
}

/** Parses GS1 DataMatrix content and extracts Australia Post-specific AIs where available. */
export function parseGs1DataMatrix(raw) {
  const normalized = normalizeBarcode(raw);
  const parts = normalized.split('|').filter(Boolean);
  const compact = normalized.replace(/\|/g, '');
  const baseParse = parseEparcelBarcode(raw);

  let postcode = null;
  let dpid = null;
  let dateTime = null;
  let hasAi420 = false;
  let hasAi92 = false;
  let hasAi8008 = false;

  for (const part of parts) {
    if (part.startsWith('420')) {
      hasAi420 = true;
      postcode = part.slice(3, 7);
    }
    if (part.startsWith('92')) {
      hasAi92 = true;
      dpid = part.slice(2, 10);
    }
    if (part.startsWith('8008')) {
      hasAi8008 = true;
      dateTime = part.slice(4, 16);
    }
  }

  if (!hasAi420) {
    const m = compact.match(/420(\d{4})/);
    if (m) { hasAi420 = true; postcode = m[1]; }
  }
  if (!hasAi92) {
    const m = compact.match(/92(\d{8})/);
    if (m) { hasAi92 = true; dpid = m[1]; }
  }
  if (!hasAi8008) {
    const m = compact.match(/8008(\d{12})/);
    if (m) { hasAi8008 = true; dateTime = m[1]; }
  }

  return {
    raw,
    normalized,
    compact,
    parts,
    base: baseParse,
    article: baseParse.article,
    articleAnalysis: baseParse.articleAnalysis,
    hasAi420,
    postcode,
    hasAi92,
    dpid,
    hasAi8008,
    dateTime,
    invalidLiteralSeparators: /FNC1|_1|\$/i.test(String(raw || ''))
  };
}

/** Heuristic used when scanner metadata is ambiguous but the payload has DataMatrix-like AIs. */
function looksLikeDataMatrix(raw, format = '') {
  const n = normalizeBarcode(raw);
  return /data[_\s-]?matrix/i.test(format) || n.includes('420') || n.includes('8008') || n.includes('|92') || n.includes('|420');
}

/** Splits extracted PDF text into normalized non-empty lines for visible-content checks. */
function textLines(extractedText) {
  return String(extractedText || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function firstLineValue(lines, regex) {
  for (const line of lines) {
    const match = line.match(regex);
    if (match) return match[1].trim();
  }
  return null;
}

function blockAfter(lines, startRegex, stopRegexes) {
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (!inBlock && startRegex.test(line)) {
      inBlock = true;
      const remainder = line.replace(startRegex, '').trim();
      if (remainder) out.push(remainder);
      continue;
    }
    if (inBlock) {
      if (stopRegexes.some(r => r.test(line))) break;
      out.push(line);
    }
  }
  return out;
}


function cleanAddressLine(line) {
  return String(line || '')
    .replace(/\s{3,}.*$/, '')
    .replace(/\bThe sender acknowledges\b.*$/i, '')
    .replace(/\band clearing procedures\b.*$/i, '')
    .replace(/\bthe article does not contain\b.*$/i, '')
    .replace(/\bprohibited goods\b.*$/i, '')
    .trim();
}

function isDgText(line) {
  return /Aviation\s+Security|Dangerous\s+Goods|sender acknowledges|carried by air|clearing procedures|does not contain|prohibited goods|explosive|incendiary|criminal offence/i.test(String(line || ''));
}

function isOperationalLine(line) {
  return /^(DELIVERY\s+INSTRUCTIONS|Delivery\s+features|Signature\b|Con\s*No\b|Cons\s*No\b|PARCEL\b|AP\s*Article|Postage\s*Paid|Dead\s*weight|Weight\b|Ph\b|PHONE\b)/i.test(String(line || '').trim());
}

function extractToBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /^\s*(To|Deliver\s*To)\b:?/i.test(line)) {
      inBlock = true;
      line = line.replace(/^\s*(To|Deliver\s*To)\b:?/i, '').trim();
      line = line.replace(/^PHONE\b:?\s*/i, '').trim();
      if (line && !isOperationalLine(line)) out.push(cleanAddressLine(line));
      continue;
    }
    if (inBlock) {
      if (isOperationalLine(line) || /^From\b|^Sender\b/i.test(line)) break;
      const cleaned = cleanAddressLine(line);
      if (cleaned && !/^PHONE\b/i.test(cleaned)) out.push(cleaned);
    }
  }
  return out.filter(Boolean);
}

function extractFromBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /^\s*(From|Sender)\b:?/i.test(line)) {
      inBlock = true;
      line = line.replace(/^\s*(From|Sender)\b:?/i, '').trim();
      line = line.replace(/Aviation\s+Security.*$/i, '').trim();
      const cleaned = cleanAddressLine(line);
      if (cleaned && !isDgText(cleaned)) out.push(cleaned);
      continue;
    }
    if (inBlock) {
      if (/^AP\s*Article|^Delivery\s*features|^DELIVER\s+TO|^TO\b/i.test(line)) break;
      const cleaned = cleanAddressLine(line);
      if (!cleaned) continue;
      if (isDgText(cleaned)) continue;
      out.push(cleaned);
      if (POSTCODE_LINE_REGEX.test(cleaned)) break;
    }
  }
  return out.filter(Boolean);
}

function extractDgBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /Aviation\s+Security.*Dangerous\s+Goods\s+Declaration/i.test(line)) {
      inBlock = true;
      const idx = line.search(/Aviation\s+Security/i);
      out.push(line.slice(idx).trim());
      continue;
    }
    if (inBlock) {
      if (/^AP\s*Article|^DELIVER\s+TO|^TO\b|^SENDER\b|^FROM\b/i.test(line) && !isDgText(line)) break;
      let dgLine = line;
      // When left-side FROM address text is merged with right-side DG text, remove the left address part.
      dgLine = dgLine.replace(/^Australia Postal Corporation\s+/i, '');
      dgLine = dgLine.replace(/^Level\s+[^\t]{1,40}?\s{2,}/i, '');
      dgLine = dgLine.replace(/^[A-Z][A-Z\s'-]+\s+(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+\d{4}\s{2,}/i, '');
      dgLine = dgLine.trim();
      if (dgLine && isDgText(dgLine)) out.push(dgLine);
      if (/criminal offence/i.test(dgLine)) break;
    }
  }
  return out.filter(Boolean);
}

function extractPostcodeLines(lines) {
  const found = [];
  for (const line of lines) {
    const m = String(line || '').toUpperCase().match(POSTCODE_LINE_REGEX);
    if (m) found.push(m[1].replace(/\s+/g, ' ').trim());
  }
  return [...new Set(found)];
}

function extractArticleIdsFromLines(lines) {
  const ids = [];
  for (const line of lines) {
    if (!/(?:AP\s*)?Article\s*Id/i.test(line)) continue;
    const after = String(line).replace(/^.*?(?:AP\s*)?Article\s*Id\s*:?\s*/i, '').toUpperCase();
    const matches = after.match(/(00\d{18}|[A-Z0-9]{21}|[A-Z0-9]{23})/g) || [];
    ids.push(...matches);
  }
  return [...new Set(ids)];
}

/** Extracts visible eParcel label facts such as address blocks, article IDs, weight, and DG text. */
export function extractLabelFacts(extractedText) {
  const lines = textLines(extractedText);
  const joined = lines.join('\n');
  const upper = joined.toUpperCase();

  const articleIds = extractArticleIdsFromLines(lines);

  let consNo = firstLineValue(lines, /Con(?:s)?\s*No\s*:?\s*([A-Z0-9]+)/i);
  if (!consNo) {
    const idx = lines.findIndex(line => /Cons\s*No\s*:?\s*$/i.test(line));
    if (idx >= 0 && lines[idx + 1] && /^[A-Z0-9]{6,16}$/i.test(lines[idx + 1])) consNo = lines[idx + 1];
  }
  const phone = firstLineValue(lines, /(?:Ph|Phone)\s*:?\s*([0-9 +()-]+)/i);
  const weightRaw = firstLineValue(lines, /(?:Dead\s*weight|Weight)\s*([0-9.]+)\s*kg/i) || firstLineValue(lines, /\b([0-9]+(?:\.[0-9]+)?)\s*kg\b/i);
  const dateCodeLine = [...lines].reverse().find(line => /^\d{4}$/.test(line));
  const dateCode = dateCodeLine || null;

  const toBlock = extractToBlock(lines);
  const fromBlock = extractFromBlock(lines);
  const dgBlock = extractDgBlock(lines);
  const postcodeLines = extractPostcodeLines(lines);

  let labelType = null;
  if (/EXPRESS\s+POST/.test(upper)) labelType = 'Express Post';
  else if (/PARCEL\s+POST/.test(upper)) labelType = 'Parcel Post';
  else if (/EPARCEL/.test(upper)) labelType = 'eParcel';

  return {
    lines,
    labelType,
    articleIds: [...new Set(articleIds)],
    consignmentIds: consNo ? [consNo.toUpperCase()] : [],
    phone,
    weightKg: weightRaw || null,
    dateCodeMMDD: dateCode || null,
    toBlock,
    fromBlock,
    dgBlock,
    postcodeLines,
    dangerousGoodsDeclarationPresent: dgBlock.length > 0 || /Aviation\s+Security\s+and\s+Dangerous\s+Goods\s+Declaration/i.test(joined) || /dangerous\s+goods/i.test(joined),
    postagePaidPresent: /Postage\s+Paid/i.test(joined),
    extractedLineCount: lines.length
  };
}

/** Pulls barcode-looking strings from visible text as diagnostic evidence only. */
export function extractTextBarcodeCandidates(extractedText) {
  const facts = extractLabelFacts(extractedText);
  return facts.articleIds;
}

/** Validates the product/service pair embedded in a standard eParcel article ID. */
export function validateServiceProduct(article) {
  const results = [];
  if (!article || article.type === 'sscc') return results;
  const service = SERVICE_CODE_MAP[article.serviceCode];
  const validProducts = SERVICE_TO_PRODUCT_MAP[article.serviceCode] || [];

  results.push(service
    ? result('SERVICE_KNOWN', 'Known service code', 'ERROR', 'service-code', 'pass', `Service ${article.serviceCode}: ${service.name}`, { actual: article.serviceCode })
    : result('SERVICE_KNOWN', 'Known service code', 'ERROR', 'service-code', 'fail', `Unknown service code ${article.serviceCode}`, { actual: article.serviceCode }));

  results.push(PRODUCT_CODE_MAP[article.productCode]
    ? result('PRODUCT_KNOWN', 'Known product code', 'ERROR', 'service-code', 'pass', `Product ${article.productCode}: ${PRODUCT_CODE_MAP[article.productCode]}`, { actual: article.productCode })
    : result('PRODUCT_KNOWN', 'Known product code', 'ERROR', 'service-code', 'fail', `Unknown product code ${article.productCode}`, { actual: article.productCode }));

  if (service) {
    const ok = validProducts.includes(article.productCode);
    results.push(ok
      ? result('SERVICE_PRODUCT_MATCH', 'Service/product compatibility', 'ERROR', 'service-code', 'pass', `Service ${article.serviceCode} supports product ${article.productCode}.`, { expected: validProducts.join(', '), actual: article.productCode })
      : result('SERVICE_PRODUCT_MATCH', 'Service/product compatibility', 'ERROR', 'service-code', 'fail', `Service ${article.serviceCode} does not support product ${article.productCode}.`, { expected: validProducts.join(', '), actual: article.productCode }));
  }
  return results;
}

function decodedRawValues(detectedBarcodes) {
  return detectedBarcodes.map(b => b.rawValue || b.raw || b.text || '').filter(Boolean);
}

function decodedLinearPresent(detectedBarcodes) {
  return detectedBarcodes.some(b => /code[_\s-]?128|gs1/i.test(String(b.format || '')) || parseEparcelBarcode(b.rawValue || '').hasAi91);
}

function decodedDataMatrixPresent(detectedBarcodes) {
  return detectedBarcodes.some(b => looksLikeDataMatrix(b.rawValue || '', b.format || ''));
}

function validateLabelFacts(facts) {
  const validations = [];
  validations.push(facts.extractedLineCount > 0
    ? result('TEXT_EXTRACTED', 'PDF/text content extracted', 'INFO', 'label-layout', 'pass', `${facts.extractedLineCount} text line(s) were extracted from the file.`, { evidence: facts.lines.slice(0, 40).join('\n') })
    : result('TEXT_EXTRACTED', 'PDF/text content extracted', 'WARNING', 'label-layout', 'manual_review', 'No selectable text was extracted. Image OCR is not available in this local MVP.'));

  validations.push(facts.labelType
    ? result('LABEL_TYPE', 'Label product branding / header', 'INFO', 'label-layout', 'pass', `Detected label header text: ${facts.labelType}.`, { actual: facts.labelType })
    : result('LABEL_TYPE', 'Label product branding / header', 'INFO', 'label-layout', 'not_applicable', 'Product branding/header was not exposed in the PDF text layer. Product family is assessed from the decoded product code instead.'));

  validations.push(facts.articleIds.length
    ? result('VISIBLE_ARTICLE_ID', 'Visible AP Article ID text', 'INFO', 'address-format', 'pass', `Visible AP Article ID value(s) extracted: ${facts.articleIds.join(', ')}.`, { actual: facts.articleIds.join(', ') })
    : result('VISIBLE_ARTICLE_ID', 'Visible AP Article ID text', 'INFO', 'address-format', 'warning', 'No visible AP Article ID was extracted from text.'));

  validations.push(facts.consignmentIds.length
    ? result('VISIBLE_CONS_NO', 'Visible Cons No text', 'INFO', 'address-format', 'pass', `Visible consignment number extracted: ${facts.consignmentIds.join(', ')}.`, { actual: facts.consignmentIds.join(', ') })
    : result('VISIBLE_CONS_NO', 'Visible Cons No text', 'INFO', 'address-format', 'manual_review', 'No visible Cons No value was extracted.'));

  validations.push(facts.toBlock.length
    ? result('ADDR_TO_PRESENT', 'TO address block present', 'ERROR', 'address-format', 'pass', 'TO address block text was extracted.', { evidence: facts.toBlock.join('\n') })
    : result('ADDR_TO_PRESENT', 'TO address block present', 'ERROR', 'address-format', 'warning', 'TO/DELIVER TO was not found or could not be isolated.'));

  validations.push(facts.fromBlock.length
    ? result('ADDR_FROM_PRESENT', 'FROM address block present', 'ERROR', 'address-format', 'pass', 'FROM address block text was extracted.', { evidence: facts.fromBlock.join('\n') })
    : result('ADDR_FROM_PRESENT', 'FROM address block present', 'ERROR', 'address-format', 'warning', 'FROM/SENDER was not found or could not be isolated.'));

  validations.push(facts.postcodeLines.length
    ? result('ADDR_SUBURB_STATE_POSTCODE', 'Suburb/state/postcode line', 'ERROR', 'address-format', 'pass', `Detected postcode line(s): ${facts.postcodeLines.join(' | ')}.`, { actual: facts.postcodeLines.join(' | ') })
    : result('ADDR_SUBURB_STATE_POSTCODE', 'Suburb/state/postcode line', 'ERROR', 'address-format', 'manual_review', 'Could not deterministically confirm suburb/state/postcode formatting from extracted text.'));

  validations.push(facts.dangerousGoodsDeclarationPresent
    ? result('DG_DECLARATION', 'Dangerous goods declaration', 'ERROR', 'address-format', 'pass', 'Aviation Security and Dangerous Goods Declaration text is present.', { evidence: (facts.dgBlock || []).join('\n') })
    : result('DG_DECLARATION', 'Dangerous goods declaration', 'ERROR', 'address-format', 'manual_review', 'Dangerous goods declaration was not confirmed from extracted text.'));

  validations.push(facts.weightKg
    ? result('WEIGHT_PRESENT', 'Weight value visible', 'INFO', 'label-layout', 'pass', `Weight value found: ${facts.weightKg}kg.`, { actual: `${facts.weightKg}kg` })
    : result('WEIGHT_PRESENT', 'Weight value visible', 'INFO', 'label-layout', 'manual_review', 'Weight value was not extracted from the text layer or decoded barcode payload.'));

  return validations;
}



/** Parses JSON or plain-text Get Shipments payload snippets into comparable evidence. */
function parseApiPayloadText(payloadText) {
  const rawText = String(payloadText || '').trim();
  if (!rawText) return { provided: false, rawText: '', parsed: null, parseError: null, flat: [], normalizedText: '' };
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(rawText.slice(start, end + 1)); }
      catch (err2) { parseError = err2.message || String(err2); }
    } else {
      parseError = err.message || String(err);
    }
  }

  const flat = [];
  const walk = (value, path = '') => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, `${path}[${idx}]`));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => walk(item, path ? `${path}.${key}` : key));
      return;
    }
    flat.push({ path, value, text: String(value) });
  };
  if (parsed !== null) walk(parsed);
  return {
    provided: true,
    rawText,
    parsed,
    parseError,
    flat,
    normalizedText: normalizePayloadText(rawText)
  };
}

function normalizePayloadText(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}


function uniquePayloadEvidenceLines(lines = []) {
  return [...new Set(lines.map(line => String(line || '').trim()).filter(Boolean))].slice(0, 12);
}

function payloadEvidenceForValues(ctx, values = []) {
  if (!ctx?.provided) return '';
  const cleaned = [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
  if (!cleaned.length) return '';
  const lines = [];
  if (ctx.flat?.length) {
    for (const item of ctx.flat) {
      const itemValue = String(item.value ?? '');
      const itemNormalized = normalizePayloadText(itemValue);
      for (const value of cleaned) {
        const valueNormalized = normalizePayloadText(value);
        if (!valueNormalized || valueNormalized.length < 2) continue;
        if (itemNormalized.includes(valueNormalized) || valueNormalized.includes(itemNormalized) && itemNormalized.length >= 3) {
          lines.push(`${item.path || '(root)'}: ${itemValue}`);
          break;
        }
      }
    }
  }
  if (!lines.length && payloadContainsAny(ctx, cleaned) === true) {
    lines.push(`raw_payload: contains ${cleaned.join(', ')}`);
  }
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadEvidenceForPathPatterns(ctx, patterns = []) {
  if (!ctx?.provided || !ctx.flat?.length) return '';
  const lines = [];
  for (const item of ctx.flat) {
    const path = String(item.path || '');
    if (patterns.some(pattern => pattern.test(path))) {
      lines.push(`${path || '(root)'}: ${String(item.value ?? '')}`);
    }
  }
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadEvidenceForTokens(ctx, tokens = []) {
  if (!ctx?.provided) return '';
  const cleaned = [...new Set(tokens.map(v => String(v || '').trim()).filter(Boolean))];
  if (!cleaned.length) return '';
  const lines = [];
  if (ctx.flat?.length) {
    for (const item of ctx.flat) {
      const itemValue = String(item.value ?? '');
      const itemNormalized = normalizePayloadText(itemValue);
      const matched = cleaned.filter(token => itemNormalized.includes(normalizePayloadText(token)));
      if (matched.length) lines.push(`${item.path || '(root)'}: ${itemValue}  [matched: ${matched.join(', ')}]`);
    }
  }
  if (!lines.length) lines.push(`matched_tokens: ${cleaned.join(', ')}`);
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadContainsValue(ctx, value) {
  const normalized = normalizePayloadText(value);
  if (!ctx?.provided || !normalized || normalized.length < 2) return null;
  return ctx.normalizedText.includes(normalized);
}

function payloadContainsAny(ctx, values = []) {
  const cleaned = values.map(v => String(v || '').trim()).filter(Boolean);
  if (!ctx?.provided || !cleaned.length) return null;
  return cleaned.some(value => payloadContainsValue(ctx, value) === true);
}


function payloadComparableFieldName(v) {
  const id = String(v?.id || '').toUpperCase();
  if (/ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|ST_FREIGHT_BARCODE_PRESENT|DATAMATRIX_PRESENT|GS1_128_PRESENT/.test(id)) return 'article_id';
  if (/CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE/.test(id)) return 'consignment_id';
  if (/PRODUCT|ST_QR_PRODUCT|ST_PRODUCT_KNOWN/.test(id)) return 'product_code';
  if (/SERVICE|SERVICE_PRODUCT_MATCH/.test(id)) return 'service_code';
  if (/ROUTE|ROUTING|ST_ROUTE/.test(id)) return 'routing_code';
  if (/POSTCODE|DM_POSTCODE|ST_QR_POSTCODE/.test(id)) return 'delivery_postcode';
  if (/WEIGHT|ST_WEIGHT/.test(id)) return 'weight';
  if (/CUBE|CUBIC/.test(id)) return 'cubic_volume';
  if (/DG|DANGEROUS/.test(id)) return 'dangerous_goods';
  if (/ADDR_TO|RECEIVER/.test(id)) return 'receiver_address';
  if (/ADDR_FROM|SENDER|LODGE|LODGEMENT/.test(id)) return 'lodgement_address';
  if (/DATE|8008/.test(id)) return 'label_generation_datetime';
  if (/LABEL_CODE|BRAND|LOGO|HEADER/.test(id)) return 'label_branding';
  return '';
}

function tokeniseComparableText(values = []) {
  const stop = new Set(['THE','AND','FOR','WITH','FROM','TO','PH','PHONE','AU','AUS','NSW','VIC','QLD','SA','WA','TAS','ACT','NT','KG','M3','POST','PARCEL','EXPRESS','STARTRACK','AUSTRALIA']);
  return [...new Set(values
    .flatMap(value => String(value || '').toUpperCase().match(/[A-Z0-9]{3,}/g) || [])
    .filter(token => !stop.has(token) && !/^0+$/.test(token)))];
}

function payloadTokenCoverage(ctx, values = [], options = {}) {
  if (!ctx?.provided) return null;
  const tokens = tokeniseComparableText(values);
  if (!tokens.length) return null;
  const matches = tokens.filter(token => payloadContainsValue(ctx, token) === true);
  const minTokens = options.minTokens ?? Math.min(3, Math.max(1, Math.ceil(tokens.length * 0.45)));
  const postcodeTokens = tokens.filter(token => /^\d{4}$/.test(token));
  const postcodeOk = !postcodeTokens.length || postcodeTokens.some(token => matches.includes(token));
  return { ok: matches.length >= minTokens && postcodeOk, tokens, matches, minTokens, postcodeOk };
}

function payloadBool(ctx, patterns = []) {
  if (!ctx?.provided || !ctx.flat?.length) return null;
  for (const item of ctx.flat) {
    const path = String(item.path || '');
    if (!patterns.some(pattern => pattern.test(path))) continue;
    if (typeof item.value === 'boolean') return item.value;
    const text = String(item.value).trim().toLowerCase();
    if (['true', 'y', 'yes', '1', 'enabled'].includes(text)) return true;
    if (['false', 'n', 'no', '0', 'disabled'].includes(text)) return false;
  }
  return null;
}

function payloadMatchResult(match, detail = '') {
  if (match === true) return { label: 'Match', status: 'match', detail };
  if (match === false) return { label: 'Does not match', status: 'mismatch', detail };
  return { label: 'N/A', status: 'na', detail: '' };
}

function serviceFlagPayloadMatch(article, ctx) {
  if (!article?.serviceCode || !SERVICE_CODE_MAP[article.serviceCode]) return null;
  const service = SERVICE_CODE_MAP[article.serviceCode];
  const comparisons = [];
  const atl = payloadBool(ctx, [/authority[_\s-]*to[_\s-]*leave/i, /atl/i]);
  const partial = payloadBool(ctx, [/allow[_\s-]*partial[_\s-]*delivery/i, /partial[_\s-]*delivery/i]);
  const safeDrop = payloadBool(ctx, [/safe[_\s-]*drop/i]);
  if (atl !== null) comparisons.push(atl === Boolean(service.authority_to_leave));
  if (partial !== null) comparisons.push(partial === Boolean(service.allow_partial_delivery));
  if (safeDrop !== null) comparisons.push(safeDrop === Boolean(service.safe_drop_enabled));
  if (!comparisons.length) return null;
  return comparisons.every(Boolean);
}


function auditIdentityValues(audit) {
  const facts = audit?.labelFacts || {};
  const articles = audit?.articles || [];
  const startrack = audit?.startrack || {};
  return uniqueNonEmpty([
    ...(facts.articleIds || []),
    ...(facts.consignmentIds || []),
    ...articles.flatMap(a => [a.articleId, a.freightItemId, a.sscc, a.consignmentId]),
    ...(audit?.parsed || []).flatMap(p => [p.articleId, p.article, p.articleIdValue, p.consignmentId, p.sscc, p.freightItemId, p.connoteNumber]),
    ...(startrack.freightParses || []).flatMap(f => [f.freightItemId, f.connoteNumber]),
    ...(startrack.qrParses || []).flatMap(q => [q.fields?.freightItemNumber, q.fields?.connoteNumber]),
    ...(startrack.ssccParses || []).flatMap(s => [`00${s.sscc}`, s.sscc])
  ]).filter(v => normalizePayloadText(v).length >= 6);
}

/** Ensures payload comparisons only run when the payload appears to describe the uploaded label. */
function applyPayloadIdentityGate(audit, apiPayload) {
  const identityValues = auditIdentityValues(audit);
  const identityMatchesLabel = identityValues.length ? payloadContainsAny(apiPayload, identityValues) === true : null;
  return {
    ...apiPayload,
    identityValues,
    identityGateApplied: identityValues.length > 0,
    identityMatchesLabel,
    identityEvidence: identityMatchesLabel ? payloadEvidenceForValues(apiPayload, identityValues) : ''
  };
}

function payloadIdentityRule(id) {
  return /ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|GS1_PREFIX|DATAMATRIX_PRESENT|GS1_128_PRESENT|ST_FREIGHT_BARCODE_PRESENT|ST_SSCC|CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE/i.test(String(id || ''));
}

/** Compares one validation row against matched Get Shipments payload evidence where possible. */
function compareValidationToApiPayload(v, audit, ctx) {
  if (!ctx?.provided) return undefined;
  const id = String(v?.id || '');
  const canonicalField = payloadComparableFieldName(v);
  const facts = audit?.labelFacts || {};
  const articles = audit?.articles || [];
  const eparcelArticles = articles.filter(a => a?.type !== 'sscc');
  const ssccArticles = articles.filter(a => a?.type === 'sscc');
  const startrack = audit?.startrack || {};

  const withField = (match, detail = '', evidence = '') => ({ ...payloadMatchResult(match, detail), field: canonicalField, evidence });

  if (ctx.identityGateApplied && ctx.identityMatchesLabel === false && !payloadIdentityRule(id)) {
    return withField(null, 'Get Shipments payload identity did not match this label; secondary field comparison suppressed.');
  }

  if (/ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|GS1_PREFIX|DATAMATRIX_PRESENT|GS1_128_PRESENT|ST_FREIGHT_BARCODE_PRESENT|ST_SSCC/i.test(id)) {
    const articleValues = [
      ...articles.map(a => a.articleId || a.freightItemId || a.sscc).filter(Boolean),
      ...ssccArticles.map(a => a.sscc).filter(Boolean),
      ...(facts.articleIds || []),
      ...(startrack.freightParses || []).map(f => f.freightItemId),
      ...(startrack.ssccParses || []).flatMap(s => [`00${s.sscc}`, s.sscc])
    ];
    const match = payloadContainsAny(ctx, articleValues);
    return withField(match, articleValues.length ? `Compared article_id values: ${articleValues.join(', ')}` : '', payloadEvidenceForValues(ctx, articleValues));
  }

  if (/CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE/i.test(id)) {
    const connoteValues = [
      ...(facts.consignmentIds || []),
      ...eparcelArticles.map(a => a.consignmentId).filter(Boolean),
      ...(startrack.freightParses || []).map(f => f.connoteNumber),
      ...(startrack.qrParses || []).map(q => q.fields?.connoteNumber).filter(Boolean)
    ];
    const match = payloadContainsAny(ctx, connoteValues);
    return withField(match, connoteValues.length ? `Compared consignment_id values: ${connoteValues.join(', ')}` : '', payloadEvidenceForValues(ctx, connoteValues));
  }

  if (/PRODUCT|SERVICE_KNOWN|SERVICE_PRODUCT_MATCH|ST_QR_PRODUCT|ST_ROUTE_PRODUCT_MATCH/i.test(id)) {
    const productCodes = [
      ...eparcelArticles.map(a => a.productCode).filter(Boolean),
      ...(startrack.freightParses || []).map(f => f.productCode),
      ...(startrack.qrParses || []).map(q => q.productCode).filter(Boolean)
    ];
    const serviceCodes = eparcelArticles.map(a => a.serviceCode).filter(Boolean);
    const labelCodes = [
      ...(startrack.routingParses || []).map(r => r.labelCode),
      ...(startrack.freightParses || []).map(f => f.expectedLabelCode),
      facts.labelCode
    ].filter(Boolean);
    const hasProductOrService = payloadContainsAny(ctx, [...productCodes, ...serviceCodes, ...labelCodes]);
    const serviceFlagMatch = eparcelArticles.length ? serviceFlagPayloadMatch(eparcelArticles[0], ctx) : null;
    const finalMatch = serviceFlagMatch === null ? hasProductOrService : (hasProductOrService === true && serviceFlagMatch === true);
    return withField(finalMatch, `Compared product_code/service_code/label_code values: ${[...productCodes, ...serviceCodes, ...labelCodes].join(', ') || 'none'}.`, payloadEvidenceForValues(ctx, [...productCodes, ...serviceCodes, ...labelCodes]));
  }

  if (/ROUTE|ROUTING|POSTCODE|DM_POSTCODE|ST_QR_POSTCODE/i.test(id)) {
    const postcodes = [
      ...((facts.postcodeLines || []).join(' ').match(/\b\d{4}\b/g) || []),
      ...(audit?.parsed || []).map(p => p.postcode).filter(Boolean),
      ...(startrack.routingParses || []).map(r => r.postcode),
      ...(startrack.qrParses || []).map(q => q.fields?.receiverPostcode).filter(Boolean)
    ];
    const match = payloadContainsAny(ctx, [...new Set(postcodes)]);
    return withField(match, postcodes.length ? `Compared delivery_postcode values: ${[...new Set(postcodes)].join(', ')}` : '', payloadEvidenceForValues(ctx, [...new Set(postcodes)]));
  }

  if (/WEIGHT|ST_WEIGHT/i.test(id)) {
    const weights = [facts.weightKg, ...(startrack.qrParses || []).map(q => q.fields?.consignmentWeight)].filter(Boolean);
    const normalizedWeights = weights.flatMap(w => {
      const asText = String(w).trim();
      const noZeros = asText.replace(/\.0+$/, '');
      return [asText, noZeros, `${noZeros}KG`, `${asText}KG`];
    });
    const match = payloadContainsAny(ctx, normalizedWeights);
    return withField(match, weights.length ? `Compared weight values: ${weights.join(', ')}` : '', payloadEvidenceForValues(ctx, normalizedWeights));
  }

  if (/CUBE|CUBIC/i.test(id)) {
    const cubes = [facts.cube, ...(startrack.qrParses || []).map(q => q.fields?.consignmentCube)].filter(Boolean);
    const match = payloadContainsAny(ctx, cubes);
    return withField(match, cubes.length ? `Compared cubic_volume values: ${cubes.join(', ')}` : '', payloadEvidenceForValues(ctx, cubes));
  }

  if (/DG|DANGEROUS/i.test(id)) {
    const apiDg = payloadBool(ctx, [/dangerous[_\s-]*goods/i, /dg[_\s-]*indicator/i, /contains[_\s-]*dangerous/i]);
    if (apiDg === null) return withField(null);
    const labelDg = Boolean(facts.dangerousGoodsDeclarationPresent || (startrack.qrParses || []).some(q => q.fields?.dangerousGoodsIndicator === 'Y'));
    return withField(apiDg === labelDg, `API dangerous_goods=${apiDg}; label dangerous_goods=${labelDg}.`, payloadEvidenceForPathPatterns(ctx, [/dangerous[_\s-]*goods/i, /dg[_\s-]*indicator/i, /contains[_\s-]*dangerous/i]));
  }

  if (/ADDR_TO|RECEIVER/i.test(id)) {
    const receiverValues = [...(facts.toBlock || []), ...(facts.postcodeLines || [])];
    const coverage = payloadTokenCoverage(ctx, receiverValues, { minTokens: 3 });
    if (!coverage) return withField(null);
    return withField(coverage.ok, `receiver_address token match ${coverage.matches.length}/${coverage.tokens.length}: ${coverage.matches.slice(0, 8).join(', ')}`, payloadEvidenceForTokens(ctx, coverage.matches));
  }

  if (/ADDR_FROM|SENDER|LODGE|LODGEMENT/i.test(id)) {
    const senderValues = [...(facts.fromBlock || [])];
    const coverage = payloadTokenCoverage(ctx, senderValues, { minTokens: 3 });
    if (!coverage) return withField(null);
    return withField(coverage.ok, `lodgement_address token match ${coverage.matches.length}/${coverage.tokens.length}: ${coverage.matches.slice(0, 8).join(', ')}`, payloadEvidenceForTokens(ctx, coverage.matches));
  }

  if (/DATE|8008/i.test(id)) {
    const dates = [v.actual, ...(audit?.parsed || []).map(p => p.dateTime).filter(Boolean)].filter(Boolean);
    const match = payloadContainsAny(ctx, dates);
    return withField(match, dates.length ? `Compared label_generation_datetime values: ${dates.join(', ')}` : '', payloadEvidenceForValues(ctx, dates));
  }

  if (/LABEL_CODE|BRAND|LOGO|HEADER/i.test(id)) {
    const values = [facts.labelType, facts.labelCode, audit?.carrier === 'startrack' ? 'StarTrack' : 'Australia Post'].filter(Boolean);
    const match = payloadContainsAny(ctx, values);
    return withField(match, values.length ? `Compared label_branding values: ${values.join(', ')}` : '', payloadEvidenceForValues(ctx, values));
  }

  return withField(null);
}

/** Adds payload-comparison metadata to every validation row in an audit result. */
function attachApiPayloadComparison(audit, payloadText) {
  const parsedPayload = parseApiPayloadText(payloadText);
  if (!parsedPayload.provided) return { ...audit, apiPayload: parsedPayload };
  const apiPayload = applyPayloadIdentityGate(audit, parsedPayload);
  const withPayload = { ...audit, apiPayload };
  const validations = (audit.validations || []).map(v => ({
    ...v,
    apiPayloadMatch: compareValidationToApiPayload(v, withPayload, apiPayload)
  }));
  return { ...withPayload, validations };
}

/** Runs the full eParcel rule set against one rendered label/page. */
function auditEparcelLabel({ fileInfo, detectedBarcodes = [], manualBarcodes = '', manifestJson = '', extractedText = '', visualEvidence = null }) {
  const validations = [];
  const facts = extractLabelFacts(extractedText);
  const manualValues = String(manualBarcodes || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean); // diagnostic only
  const decodedValues = decodedRawValues(detectedBarcodes);
  const allRawBarcodes = [...decodedValues];

  const pageCount = fileInfo?.pageCount || 1;
  const widthMm = fileInfo?.widthMm;
  const heightMm = fileInfo?.heightMm;

  if (widthMm && heightMm) {
    const portraitOk = Math.abs(widthMm - 105) <= 5 && Math.abs(heightMm - 148) <= 5;
    const landscapeOk = Math.abs(widthMm - 148) <= 5 && Math.abs(heightMm - 105) <= 5;
    validations.push(portraitOk || landscapeOk
      ? result('A6_SIZE', 'A6 label dimensions', 'WARNING', 'label-layout', 'pass', `Page dimensions are approximately A6 (${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm).`, { expected: 'A6 105mm x 148mm ±5mm, portrait or landscape', actual: `${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm` })
      : result('A6_SIZE', 'A6 label dimensions', 'WARNING', 'label-layout', 'warning', `Page dimensions differ from A6 (${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm).`, { expected: 'A6 105mm x 148mm ±5mm, portrait or landscape', actual: `${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm` }));
  } else {
    validations.push(result('A6_SIZE', 'A6 label dimensions', 'WARNING', 'label-layout', 'manual_review', 'Physical dimensions could not be determined from this file. A6 is assumed for audit heuristics.'));
  }

  validations.push(...validateLabelFacts(facts));

  const visualLinear = Boolean(visualEvidence?.linearBarcodeVisible);
  const visualDm = Boolean(visualEvidence?.dataMatrixVisible);
  const decodedLinear = decodedLinearPresent(detectedBarcodes);
  const decodedDm = decodedDataMatrixPresent(detectedBarcodes);

  if (decodedLinear) {
    validations.push(result('GS1_128_PRESENT', 'GS1-128 Linear Barcode decoded', 'CRITICAL', 'gs1-128', 'pass', 'Required GS1-128 Linear Barcode was decoded from the uploaded file.'));
  } else {
    validations.push(result('GS1_128_PRESENT', 'GS1-128 Linear Barcode decoded', 'CRITICAL', 'gs1-128', 'fail', visualLinear ? 'A GS1-128 Linear Barcode appears visible, but it was not decoded by the scanner pipeline.' : 'No GS1-128 Linear Barcode was decoded from the uploaded file.', { evidence: visualEvidence?.linearEvidence || '' }));
  }

  if (decodedDm) {
    validations.push(result('DATAMATRIX_PRESENT', 'GS1 DataMatrix Barcode decoded', 'CRITICAL', 'datamatrix', 'pass', 'Required GS1 DataMatrix Barcode was decoded from the uploaded file.'));
  } else {
    validations.push(result('DATAMATRIX_PRESENT', 'GS1 DataMatrix Barcode decoded', 'CRITICAL', 'datamatrix', 'fail', visualDm ? 'A GS1 DataMatrix square symbol appears visible, but it was not decoded by the scanner pipeline.' : 'No GS1 DataMatrix Barcode was decoded from the uploaded file.', { evidence: visualEvidence?.dataMatrixEvidence || '' }));
  }

  const parsed = allRawBarcodes.map(raw => looksLikeDataMatrix(raw) ? parseGs1DataMatrix(raw) : parseEparcelBarcode(raw));
  const articleMap = new Map();
  for (const article of parsed.map(p => p.article || p.base?.article).filter(Boolean)) {
    articleMap.set(article.articleId || article.sscc, article);
  }
  const articles = [...articleMap.values()];
  const invalidMap = new Map();
  for (const invalid of parsed.map(p => p.articleAnalysis || p.base?.articleAnalysis).filter(a => a && !a.valid)) {
    invalidMap.set(invalid.candidate, invalid);
  }
  const invalidAnalyses = [...invalidMap.values()];
  const dmParses = parsed.filter(p => 'hasAi420' in p);

  if (articles.length === 0 && invalidAnalyses.length === 0) {
    validations.push(result('ARTICLE_PARSE', 'Article ID parse', 'CRITICAL', 'barcode-structure', 'fail', 'No standard eParcel article ID, SSCC article ID, or invalid article candidate could be extracted from decoded barcode data. Visible AP Article ID text is context only.'));
  } else if (articles.length === 0 && invalidAnalyses.length) {
    validations.push(result('ARTICLE_PARSE', 'Article ID parse', 'CRITICAL', 'barcode-structure', 'fail', invalidAnalyses[0].reason, { expected: '21-char eParcel, 23-char eParcel, or 20-digit SSCC including AI 00', actual: invalidAnalyses.map(a => a.candidate).join(', ') }));
  } else {
    validations.push(result('ARTICLE_PARSE', 'Article ID parse', 'CRITICAL', 'barcode-structure', 'pass', `${articles.length} valid article ID(s) parsed.`, { actual: articles.map(a => a.articleId).join(', ') }));
  }

  for (const [i, p] of parsed.entries()) {
    if (p.hasAi01 !== undefined) {
      validations.push(p.hasAusPostGtin
        ? result(`GS1_PREFIX_${i}`, 'AI 01 Australia Post GTIN', 'CRITICAL', 'gs1-128', 'pass', 'Decoded barcode begins with AI 01 and the expected Australia Post GTIN 99312650999998.', { actual: p.compact?.slice(0, 16) })
        : result(`GS1_PREFIX_${i}`, 'AI 01 Australia Post GTIN', 'CRITICAL', 'gs1-128', p.hasAi01 ? 'fail' : 'not_applicable', p.hasAi01 ? 'Barcode has AI 01 but does not match the expected Australia Post GTIN.' : 'Raw value is not an AI 01 GS1 string; GTIN validation is not applicable.', { expected: '0199312650999998', actual: p.compact?.slice(0, 16) || '' }));

      validations.push(p.hasAi91
        ? result(`AI91_${i}`, 'AI 91 article component', 'CRITICAL', 'gs1-128', 'pass', 'AI 91 article component was found.')
        : result(`AI91_${i}`, 'AI 91 article component', 'CRITICAL', 'gs1-128', p.hasAi01 ? 'fail' : 'not_applicable', p.hasAi01 ? 'AI 91 was not found after the AusPost GTIN prefix.' : 'AI 91 not applicable to HRI-only fallback.'));
    }
  }

  for (const [i, article] of articles.entries()) {
    if (article.type === 'sscc') {
      validations.push(result(`SSCC_${i}`, 'SSCC article detected', 'INFO', 'sscc', 'pass', `SSCC detected: ${article.sscc}. Embedded product/service/check-digit validation does not apply.`, { actual: article.sscc }));
      continue;
    }

    validations.push(/^[A-Z0-9]{3}$|^[A-Z0-9]{5}$/.test(article.mlid)
      ? result(`MLID_${i}`, 'MLID format', 'ERROR', 'barcode-structure', 'pass', `MLID ${article.mlid} is ${article.mlidLength} uppercase alphanumeric characters.`, { actual: article.mlid })
      : result(`MLID_${i}`, 'MLID format', 'ERROR', 'barcode-structure', 'fail', `Invalid MLID ${article.mlid}.`, { expected: '3 or 5 uppercase alphanumeric characters', actual: article.mlid }));

    validations.push(/^\d{7}$/.test(article.consignmentSuffix)
      ? result(`CONSIGNMENT_${i}`, 'Consignment suffix', 'ERROR', 'barcode-structure', 'pass', `Consignment suffix is 7 digits: ${article.consignmentSuffix}.`, { actual: article.consignmentSuffix })
      : result(`CONSIGNMENT_${i}`, 'Consignment suffix', 'ERROR', 'barcode-structure', 'fail', `Consignment suffix is invalid: ${article.consignmentSuffix}.`, { expected: '7 digits', actual: article.consignmentSuffix }));

    if (facts.consignmentIds.length) {
      validations.push(facts.consignmentIds.includes(article.consignmentId)
        ? result(`CONSIGNMENT_MATCH_${i}`, 'Visible consignment matches article ID', 'ERROR', 'barcode-structure', 'pass', 'Visible Cons No matches parsed article consignment ID.', { actual: article.consignmentId })
        : result(`CONSIGNMENT_MATCH_${i}`, 'Visible consignment matches article ID', 'ERROR', 'barcode-structure', 'fail', 'Visible Cons No does not match parsed article consignment ID.', { expected: article.consignmentId, actual: facts.consignmentIds.join(', ') }));
    }

    const countNum = Number(article.articleCount);
    validations.push(countNum >= 1 && countNum <= 20
      ? result(`ARTICLE_COUNT_${i}`, 'Article count 01-20', 'ERROR', 'barcode-structure', 'pass', `Article count ${article.articleCount} is within 01-20.`, { actual: article.articleCount })
      : result(`ARTICLE_COUNT_${i}`, 'Article count 01-20', 'ERROR', 'barcode-structure', 'fail', `Article count ${article.articleCount} is outside 01-20.`, { expected: '01 to 20', actual: article.articleCount }));

    validations.push(article.postagePaidIndicator === '0'
      ? result(`POSTAGE_PAID_${i}`, 'Postage paid indicator', 'ERROR', 'barcode-structure', 'pass', 'Postage paid indicator is 0.', { actual: article.postagePaidIndicator })
      : result(`POSTAGE_PAID_${i}`, 'Postage paid indicator', 'ERROR', 'barcode-structure', 'fail', 'Postage paid indicator must be 0.', { expected: '0', actual: article.postagePaidIndicator }));

    const cd = calculateEparcelCheckDigit(article.withoutCheckDigit);
    validations.push(cd.checkDigit === article.checkDigit
      ? result(`CHECK_DIGIT_${i}`, 'eParcel check digit', 'CRITICAL', 'check-digit', 'pass', `Check digit is valid: ${article.checkDigit}.`, { expected: cd.checkDigit, actual: article.checkDigit, evidence: cd.steps })
      : result(`CHECK_DIGIT_${i}`, 'eParcel check digit', 'CRITICAL', 'check-digit', 'fail', `Check digit mismatch. Expected ${cd.checkDigit}, got ${article.checkDigit}.`, { expected: cd.checkDigit, actual: article.checkDigit, evidence: cd.steps }));

    validations.push(...validateServiceProduct(article));
  }

  for (const [i, dm] of dmParses.entries()) {
    validations.push(dm.hasAi420 && /^\d{4}$/.test(dm.postcode || '')
      ? result(`DM_POSTCODE_${i}`, 'AI 420 delivery postcode', 'CRITICAL', 'datamatrix', 'pass', `AI 420 postcode is present: ${dm.postcode}.`, { actual: dm.postcode })
      : result(`DM_POSTCODE_${i}`, 'AI 420 delivery postcode', 'CRITICAL', 'datamatrix', 'fail', 'AI 420 delivery postcode is missing or invalid.', { expected: 'AI 420 + 4 digit postcode', actual: dm.postcode || 'missing' }));

    validations.push(dm.hasAi8008 && /^\d{12}$/.test(dm.dateTime || '')
      ? result(`DM_8008_${i}`, 'AI 8008 label generation date/time', 'CRITICAL', 'datamatrix', 'pass', `AI 8008 date/time is present: ${dm.dateTime}.`, { actual: dm.dateTime })
      : result(`DM_8008_${i}`, 'AI 8008 label generation date/time', 'CRITICAL', 'datamatrix', 'fail', 'AI 8008 label generation date/time is missing or invalid.', { expected: 'AI 8008 + YYMMDDHHMMSS', actual: dm.dateTime || 'missing' }));

    if (dm.hasAi92) {
      validations.push(/^\d{8}$/.test(dm.dpid || '') && dm.dpid !== '00000000'
        ? result(`DM_DPID_${i}`, 'AI 92 Delivery Point Identifier (DPID)', 'ERROR', 'datamatrix', 'pass', `DPID is present and valid: ${dm.dpid}.`, { actual: dm.dpid })
        : result(`DM_DPID_${i}`, 'AI 92 Delivery Point Identifier (DPID)', 'ERROR', 'datamatrix', 'fail', 'DPID is present but invalid. If unavailable, omit AI 92 and its separator entirely.', { expected: '8 digits, not 00000000', actual: dm.dpid || 'missing' }));
    } else {
      validations.push(result(`DM_DPID_${i}`, 'AI 92 Delivery Point Identifier (DPID)', 'INFO', 'datamatrix', 'not_applicable', 'DPID is absent. This is allowed if AI 92 and its separator are omitted.'));
    }

    validations.push(dm.invalidLiteralSeparators
      ? result(`DM_SEPARATORS_${i}`, 'FNC1 group separator encoding', 'CRITICAL', 'datamatrix', 'fail', 'Invalid literal separator marker detected, such as FNC1, _1, or $. The GS1 FNC1/group separator must be encoded as a control character, not printed text.', { actual: dm.raw })
      : result(`DM_SEPARATORS_${i}`, 'FNC1 group separator encoding', 'INFO', 'datamatrix', 'pass', 'No invalid literal FNC1/group separator markers were found.'));
  }


  const fail = validations.some(v => v.status === 'fail' && (v.severity === 'CRITICAL' || v.severity === 'ERROR'));
  const review = validations.some(v => v.status === 'warning' || v.status === 'manual_review');
  const overallStatus = fail ? 'FAIL' : review ? 'REVIEW' : 'PASS';

  const summary = {
    overallStatus,
    total: validations.length,
    critical: validations.filter(v => v.severity === 'CRITICAL').length,
    errors: validations.filter(v => v.severity === 'ERROR').length,
    warnings: validations.filter(v => v.severity === 'WARNING').length,
    manualReview: validations.filter(v => v.status === 'manual_review').length,
    failed: validations.filter(v => v.status === 'fail').length,
    passed: validations.filter(v => v.status === 'pass').length
  };

  return {
    generatedAt: new Date().toISOString(),
    fileInfo,
    labelFacts: facts,
    visualEvidence,
    detectedBarcodes,
    manualBarcodeCount: manualValues.length,
    parsed,
    articles,
    invalidArticleCandidates: invalidAnalyses,
    summary,
    validations
  };
}


/** Calculates the GS1 mod-10 check digit used by SSCC validation. */
function gs1Mod10CheckDigit(numberWithoutCheckDigit) {
  const digits = String(numberWithoutCheckDigit || '').replace(/\D/g, '');
  if (!digits) return null;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

function stripAiDecorations(raw) {
  return String(raw || '')
    .replace(/^\]C1/, '')
    .replace(/^\]d2/, '')
    .replace(/[\u001d\x1d\u001e\x1e\u001c\x1c|]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

/** Parses a GS1 AI 00 SSCC barcode and validates its check digit. */
export function parseSsccBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/\(00\)/g, '00');
  const match = compact.match(/(?:^|[^0-9])?00(\d{18})(?:$|[^0-9])?/);
  if (!match) return { valid: false, raw, reason: 'No AI 00 + 18 digit SSCC found.' };
  const sscc = match[1];
  const body = sscc.slice(0, -1);
  const checkDigit = sscc.slice(-1);
  const expected = gs1Mod10CheckDigit(body);
  return {
    valid: expected === checkDigit,
    type: 'sscc',
    raw,
    ai: '00',
    sscc,
    articleId: `00${sscc}`,
    extensionDigit: sscc[0],
    companyPrefixAndSerial: sscc.slice(1, -1),
    checkDigit,
    expectedCheckDigit: expected,
    reason: expected === checkDigit ? 'Valid SSCC check digit.' : `SSCC check digit mismatch. Expected ${expected}, got ${checkDigit}.`
  };
}

/** Parses a standard 20-character StarTrack freight item barcode. */
export function parseStarTrackFreightItemBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  if (!/^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(compact)) {
    return { valid: false, raw, compact, reason: 'Not a StarTrack 20-character freight item barcode.' };
  }
  const despatchId = compact.slice(0, 4);
  const connoteNumber = compact.slice(0, 12);
  const consignmentSequence = compact.slice(4, 12);
  const productCode = compact.slice(12, 15);
  const itemNumber = compact.slice(15, 20);
  const product = STARTRACK_PRODUCT_CODE_MAP[productCode] || null;
  return {
    valid: true,
    type: 'startrack-code128-freight',
    raw,
    articleId: compact,
    freightItemId: compact,
    despatchId,
    consignmentSequence,
    connoteNumber,
    productCode,
    productName: product?.name || 'Unknown StarTrack product code',
    productGroup: product?.group || 'Unknown',
    expectedLabelCode: product?.labelCode || null,
    itemNumber
  };
}

/** Parses StarTrack routing barcodes, including supported GS1 routing forms. */
export function parseStarTrackRoutingBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  const gs1Route = compact.match(/421(036)(\d{4})403([A-Z0-9]{3})/);
  if (gs1Route) {
    if (!STARTRACK_LABEL_CODE_MAP[gs1Route[3]]) {
      return { valid: false, raw, compact, reason: `Unknown StarTrack GS1 routing label code ${gs1Route[3]}.` };
    }
    return {
      valid: true,
      type: 'gs1-421-routing',
      raw,
      countryCode: gs1Route[1],
      postcode: gs1Route[2],
      labelCode: gs1Route[3],
      supportedProducts: STARTRACK_LABEL_CODE_MAP[gs1Route[3]] || [],
      depotOrPort: '',
      formatDescription: 'GS1 421 routing barcode for AU Domestic SSCC labels'
    };
  }
  const match = compact.match(/^([A-Z0-9]{3})(\d{4})([A-Z0-9]{2,3})$/);
  if (!match) return { valid: false, raw, compact, reason: 'Not a StarTrack routing barcode.' };
  if (!STARTRACK_LABEL_CODE_MAP[match[1]]) {
    return { valid: false, raw, compact, reason: `Unknown StarTrack routing label code ${match[1]}.` };
  }
  return {
    valid: true,
    type: 'startrack-routing',
    raw,
    labelCode: match[1],
    postcode: match[2],
    depotOrPort: match[3],
    supportedProducts: STARTRACK_LABEL_CODE_MAP[match[1]] || [],
    formatDescription: 'StarTrack routing barcode SSS9999DD/DDD'
  };
}

/** Parses the optional StarTrack Authority To Leave barcode. */
export function parseStarTrackAtlBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  const match = compact.match(/^C(\d{9})$/);
  return match
    ? { valid: true, raw, atlNumber: compact, counter: match[1], counterNumber: Number(match[1]) }
    : { valid: false, raw, reason: 'Not a StarTrack ATL barcode.' };
}

function fixed(raw, start, length) {
  return String(raw || '').slice(start - 1, start - 1 + length);
}

/** Parses StarTrack fixed-width QR payloads into named shipment fields. */
export function parseStarTrackQrBarcode(raw) {
  const text = String(raw || '').replace(/^\]Q[0-9]/, '');
  if (text.length < 290) return { valid: false, raw, length: text.length, reason: 'Not a StarTrack fixed-width QR payload.' };
  const fields = {
    receiverSuburb: fixed(text, 1, 30).trim(),
    receiverPostcode: fixed(text, 31, 4).trim(),
    connoteNumber: fixed(text, 35, 12).trim(),
    freightItemNumber: fixed(text, 47, 20).trim(),
    productCode: fixed(text, 67, 3).trim(),
    payerAccount: fixed(text, 70, 8).trim(),
    senderAccount: fixed(text, 78, 8).trim(),
    consignmentQuantity: fixed(text, 86, 4).trim(),
    consignmentWeight: fixed(text, 90, 5).trim(),
    consignmentCube: fixed(text, 95, 5).trim(),
    despatchDate: fixed(text, 100, 8).trim(),
    receiverName1: fixed(text, 108, 40).trim(),
    receiverName2: fixed(text, 148, 40).trim(),
    unitType: fixed(text, 188, 3).trim(),
    destinationDepot: fixed(text, 191, 4).trim(),
    receiverAddress1: fixed(text, 195, 40).trim(),
    receiverAddress2: fixed(text, 235, 40).trim(),
    receiverPhone: fixed(text, 275, 14).trim(),
    dangerousGoodsIndicator: fixed(text, 289, 1).trim(),
    movementTypeIndicator: fixed(text, 290, 1).trim(),
    notBeforeDate: fixed(text, 291, 12).trim(),
    notAfterDate: fixed(text, 303, 12).trim(),
    atlNumber: fixed(text, 315, 10).trim(),
    raNumber: fixed(text, 325, 10).trim()
  };
  const product = STARTRACK_PRODUCT_CODE_MAP[fields.productCode] || null;
  return {
    valid: true,
    type: 'startrack-qr',
    raw,
    length: text.length,
    fields,
    productCode: fields.productCode,
    productName: product?.name || 'Unknown StarTrack product code',
    productGroup: product?.group || 'Unknown',
    expectedLabelCode: product?.labelCode || null
  };
}

/** Extracts visible StarTrack label facts from selectable PDF text. */
function extractStarTrackFacts(extractedText) {
  const lines = String(extractedText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const joined = lines.join('\n');
  const upper = joined.toUpperCase();
  const labelCode = (joined.match(/\b(TSE|RET|RE2|APT|PRM|FPP|ARL|FPA|EXP)\b/i) || [])[1]?.toUpperCase() || null;
  const sameLineConnote = (joined.match(/(?:CONNOTE|CON\s*NO|CONSIGNMENT(?:\s+NUMBER)?)\s*:?\s*([A-Z0-9]{8,20})/i) || [])[1]?.toUpperCase() || null;
  const nextLineConnote = (joined.match(/(?:CONNOTE|CON\s*NO|CONSIGNMENT(?:\s+NUMBER)?)\s*:?\s*(?:\r?\n|\s{2,})([A-Z0-9]{8,20})/i) || [])[1]?.toUpperCase() || null;
  const nearbyConnote = (() => {
    const idx = lines.findIndex(l => /CONNOTE|CON\s*NO|CONSIGNMENT/i.test(l));
    if (idx < 0) return null;
    for (let offset = 0; offset <= 3; offset += 1) {
      const candidateLine = String(lines[idx + offset] || '').toUpperCase();
      const candidate = (candidateLine.match(/\b[A-Z0-9]{4}\d{8}\b/) || [])[0];
      if (candidate && !/CONNOTE|CONSIGNMENT/.test(candidate)) return candidate;
    }
    return null;
  })();
  const articleId = (joined.match(/(?:ARTICLE\s*ID|FREIGHT\s*ITEM(?:\s*ID)?)\s*:?\s*([A-Z0-9\s]{12,30})/i) || [])[1]?.replace(/\s+/g, '').toUpperCase() || null;
  const connoteFromArticle = articleId && /^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(articleId) ? articleId.slice(0, 12) : null;
  const connote = sameLineConnote || nextLineConnote || nearbyConnote || connoteFromArticle || null;
  const weight = (joined.match(/\b([0-9]+(?:\.[0-9]+)?)\s*kg\b/i) || [])[1] || null;
  const cube = (joined.match(/\b([0-9]+(?:\.[0-9]+)?)\s*m3\b/i) || [])[1] || null;
  const unit = (joined.match(/\b(BAG|CTN|ITM|JIF|PAL|SAT|SKI)\b/i) || [])[1]?.toUpperCase() || null;
  const destinationLooksNz = /\bNZ\b/.test(upper);
  const dgPresent = /DANGEROUS\s+GOODS|DG\s*[:\-]|AVIATION\s+SECURITY|IATA|UN\s?\d{4}/i.test(joined);
  const authorityToLeavePresent = /AUTHORITY\s+TO\s+LEAVE|\bATL\b/i.test(joined);
  const visibleAtlNumbers = [...new Set((joined.match(/\bC\d{9}\b/gi) || []).map(v => v.toUpperCase()))];
  return {
    lines,
    labelType: 'StarTrack',
    labelCode,
    connoteNumber: connote,
    articleIds: articleId ? [articleId] : [],
    consignmentIds: connote ? [connote] : [],
    weightKg: weight,
    cube,
    unit,
    toBlock: extractToBlock(lines),
    fromBlock: extractFromBlock(lines),
    postcodeLines: extractPostcodeLines(lines),
    dangerousGoodsDeclarationPresent: dgPresent,
    authorityToLeavePresent,
    visibleAtlNumbers,
    dgBlock: extractDgBlock(lines),
    destinationLooksNz,
    extractedLineCount: lines.length
  };
}


function uniqueNonEmpty(values = []) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}

function normalizeQrWeight(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = text.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  return String(Number(numeric));
}

function normalizeQrCube(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = text.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  if (/^\d+$/.test(numeric)) {
    const cube = Number(numeric) / 1000;
    return cube > 0 ? cube.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : null;
  }
  return String(Number(numeric));
}

/** Backfills visible-fact fields with decoded barcode data when the text layer is sparse. */
function enrichStarTrackFactsFromDecodedData(facts, { qrParses = [], freightParses = [], routingParses = [], validSsccs = [] } = {}) {
  const qrFields = qrParses[0]?.fields || {};
  const firstFreight = freightParses[0] || null;
  const firstRoute = routingParses[0] || null;

  const connoteIds = uniqueNonEmpty([
    ...(facts.consignmentIds || []),
    facts.connoteNumber,
    firstFreight?.connoteNumber,
    qrFields.connoteNumber
  ]);
  const articleIds = uniqueNonEmpty([
    ...(facts.articleIds || []),
    firstFreight?.freightItemId,
    qrFields.freightItemNumber,
    ...validSsccs.map(s => `00${s.sscc}`)
  ]);
  const qrReceiverBlock = uniqueNonEmpty([
    qrFields.receiverName1,
    qrFields.receiverName2,
    qrFields.receiverAddress1,
    qrFields.receiverAddress2,
    [qrFields.receiverSuburb, qrFields.receiverPostcode].filter(Boolean).join(' ')
  ]);
  const qrPostcodeLines = uniqueNonEmpty([
    qrFields.receiverPostcode ? [qrFields.receiverSuburb, qrFields.receiverPostcode].filter(Boolean).join(' ') : ''
  ]);

  return {
    ...facts,
    labelCode: facts.labelCode || firstRoute?.labelCode || firstFreight?.expectedLabelCode || qrParses[0]?.expectedLabelCode || qrFields.productCode || null,
    connoteNumber: facts.connoteNumber || connoteIds[0] || null,
    articleIds,
    consignmentIds: connoteIds,
    weightKg: facts.weightKg || normalizeQrWeight(qrFields.consignmentWeight),
    cube: facts.cube || normalizeQrCube(qrFields.consignmentCube),
    unit: facts.unit || qrFields.unitType || null,
    toBlock: (facts.toBlock && facts.toBlock.length) ? facts.toBlock : qrReceiverBlock,
    postcodeLines: (facts.postcodeLines && facts.postcodeLines.length) ? facts.postcodeLines : qrPostcodeLines,
    decodedDataUsedForFacts: Boolean(qrParses.length || freightParses.length || routingParses.length || validSsccs.length)
  };
}

/** Validates StarTrack visible-content facts that can be checked without barcode parsing. */
function validateStarTrackTextFacts(facts) {
  const validations = [];
  validations.push(facts.extractedLineCount > 0
    ? result('ST_TEXT_EXTRACTED', 'Visible text extracted', 'INFO', 'startrack-label-layout', 'pass', `${facts.extractedLineCount} text line(s) were extracted from the file.`, { evidence: facts.lines.slice(0, 50).join('\n') })
    : result('ST_TEXT_EXTRACTED', 'Visible text extracted', 'WARNING', 'startrack-label-layout', 'manual_review', 'No selectable text was extracted. Barcode evidence is still assessed from the rendered image.'));
  validations.push(result('ST_LOGO_HEADER', 'StarTrack logo/header', 'INFO', 'startrack-label-layout', facts.lines.some(l => /STAR\s*TRACK|STARTRACK/i.test(l)) ? 'pass' : 'manual_review', facts.lines.some(l => /STAR\s*TRACK|STARTRACK/i.test(l)) ? 'StarTrack header text was found.' : 'StarTrack logo/header may be image-only or was not extracted as text.'));
  validations.push(facts.labelCode
    ? result('ST_LABEL_CODE_VISIBLE', 'StarTrack label code evidence', 'INFO', 'startrack-label-layout', 'pass', `Label/product code evidence found: ${facts.labelCode}.`, { actual: facts.labelCode })
    : result('ST_LABEL_CODE_VISIBLE', 'StarTrack label code evidence', 'INFO', 'startrack-label-layout', 'manual_review', 'A three-character label code was not extracted from the text layer or barcode data.'));
  validations.push(facts.consignmentIds.length
    ? result('ST_CONNOTE_VISIBLE', 'Connote number evidence', 'INFO', 'startrack-label-layout', 'pass', `Connote number evidence found: ${facts.consignmentIds.join(', ')}.`, { actual: facts.consignmentIds.join(', ') })
    : result('ST_CONNOTE_VISIBLE', 'Connote number evidence', 'INFO', 'startrack-label-layout', 'manual_review', 'CONNOTE value was not extracted from the text layer or decoded barcode payload.'));
  validations.push(facts.toBlock.length || facts.postcodeLines.length
    ? result('ST_RECEIVER_BLOCK', 'Receiver details present', 'ERROR', 'startrack-text', 'pass', 'Receiver details were extracted from the text layer or decoded QR payload.', { evidence: [...facts.toBlock, ...facts.postcodeLines].join('\n') })
    : result('ST_RECEIVER_BLOCK', 'Receiver details present', 'ERROR', 'startrack-text', 'manual_review', 'Receiver details could not be isolated from the text layer or decoded QR payload.'));
  validations.push(facts.fromBlock.length
    ? result('ST_SENDER_BLOCK', 'Sender details present', 'ERROR', 'startrack-text', 'pass', 'Sender details text was extracted.', { evidence: facts.fromBlock.join('\n') })
    : result('ST_SENDER_BLOCK', 'Sender details present', 'ERROR', 'startrack-text', 'manual_review', 'Sender details could not be isolated from text.'));
  validations.push(facts.weightKg
    ? result('ST_WEIGHT_PRESENT', 'Weight evidence', 'INFO', 'startrack-label-layout', 'pass', `Weight value found: ${facts.weightKg}kg.`, { actual: `${facts.weightKg}kg` })
    : result('ST_WEIGHT_PRESENT', 'Weight evidence', 'INFO', 'startrack-label-layout', 'manual_review', 'Weight value was not extracted from the text layer or decoded barcode payload.'));
  validations.push(facts.cube
    ? result('ST_CUBE_PRESENT', 'Cubic volume evidence', 'INFO', 'startrack-label-layout', 'pass', `Cubic volume found: ${facts.cube}m3.`, { actual: `${facts.cube}m3` })
    : result('ST_CUBE_PRESENT', 'Cubic volume evidence', 'INFO', 'startrack-label-layout', 'manual_review', 'Cubic volume was not extracted from the text layer or decoded barcode payload.'));
  return validations;
}

/** Runs the full StarTrack rule set against one rendered label/page. */
function auditStarTrackLabel({ fileInfo, detectedBarcodes = [], manualBarcodes = '', manifestJson = '', extractedText = '', visualEvidence = null }) {
  const validations = [];
  let facts = extractStarTrackFacts(extractedText);
  const manualValues = String(manualBarcodes || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const decodedValues = decodedRawValues(detectedBarcodes);
  const linearValues = detectedBarcodes.filter(b => /128|code/i.test(String(b.format || b.symbology || '')) || b.kind === 'linear').map(b => b.rawValue).filter(Boolean);
  const qrValues = detectedBarcodes.filter(b => /qr/i.test(String(b.format || b.symbology || '')) || b.kind === 'qr').map(b => b.rawValue).filter(Boolean);

  const widthMm = fileInfo?.widthMm;
  const heightMm = fileInfo?.heightMm;
  if (widthMm && heightMm) {
    const normal = Math.abs(widthMm - 100) <= 8 && Math.abs(heightMm - 150) <= 10;
    const landscape = Math.abs(widthMm - 150) <= 10 && Math.abs(heightMm - 100) <= 8;
    const extended = Math.abs(widthMm - 100) <= 8 && Math.abs(heightMm - 200) <= 12;
    validations.push(normal || landscape || extended
      ? result('ST_LABEL_SIZE', 'StarTrack label dimensions', 'WARNING', 'startrack-label-layout', 'pass', `Page dimensions are compatible with StarTrack thermal label formats (${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm).`, { expected: 'Despatch 10cm x 15cm; optional 10cm x 20cm; returns/transfer 15cm x 10cm', actual: `${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm` })
      : result('ST_LABEL_SIZE', 'StarTrack label dimensions', 'WARNING', 'startrack-label-layout', 'warning', `Page dimensions do not match the usual StarTrack label sizes (${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm).`, { expected: 'Despatch 10cm x 15cm; optional 10cm x 20cm; returns/transfer 15cm x 10cm', actual: `${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm` }));
  } else {
    validations.push(result('ST_LABEL_SIZE', 'StarTrack label dimensions', 'WARNING', 'startrack-label-layout', 'manual_review', 'Physical dimensions could not be determined from this file.'));
  }
  const qrParses = qrValues.map(parseStarTrackQrBarcode).filter(p => p.valid);
  const freightParses = linearValues.map(parseStarTrackFreightItemBarcode).filter(p => p.valid);
  const ssccParses = decodedValues.map(parseSsccBarcode).filter(p => p.type === 'sscc' && p.valid !== undefined && p.raw);
  const validSsccs = ssccParses.filter(p => p.valid);
  const routingParses = linearValues.map(parseStarTrackRoutingBarcode).filter(p => p.valid);
  const atlParses = linearValues.map(parseStarTrackAtlBarcode).filter(p => p.valid);
  const expectedAtlNumbers = uniqueNonEmpty([
    ...(facts.visibleAtlNumbers || []),
    ...qrParses.map(q => q.fields?.atlNumber).filter(Boolean)
  ]);
  const atlExpected = Boolean(facts.authorityToLeavePresent || expectedAtlNumbers.length);
  const ssccOnly = validSsccs.length > 0 && freightParses.length === 0;

  facts = enrichStarTrackFactsFromDecodedData(facts, { qrParses, freightParses, routingParses, validSsccs });
  validations.push(...validateStarTrackTextFacts(facts));

  validations.push(qrParses.length
    ? result('ST_QR_PRESENT', 'StarTrack 2D QR barcode decoded', 'CRITICAL', 'startrack-qr', 'pass', `${qrParses.length} StarTrack QR payload(s) decoded from the uploaded file.`, { actual: `${qrParses.length}` })
    : result('ST_QR_PRESENT', 'StarTrack 2D QR barcode decoded', 'CRITICAL', 'startrack-qr', 'fail', 'StarTrack labels must contain a 2D QR barcode and it was not decoded from the uploaded file.'));

  validations.push((freightParses.length || validSsccs.length)
    ? result('ST_FREIGHT_BARCODE_PRESENT', 'Freight item barcode decoded', 'CRITICAL', 'startrack-freight', 'pass', freightParses.length ? `${freightParses.length} StarTrack Code 128 freight item barcode(s) decoded.` : `${validSsccs.length} SSCC freight item barcode(s) decoded.`, { actual: [...freightParses.map(f => f.freightItemId), ...validSsccs.map(s => `00${s.sscc}`)].join(', ') })
    : result('ST_FREIGHT_BARCODE_PRESENT', 'Freight item barcode decoded', 'CRITICAL', 'startrack-freight', 'fail', 'No StarTrack 20-character freight item barcode or valid AI 00 SSCC barcode was decoded.'));

  validations.push(routingParses.length
    ? result('ST_ROUTING_BARCODE_PRESENT', 'Routing barcode decoded', 'CRITICAL', 'startrack-routing', 'pass', `${routingParses.length} routing barcode(s) decoded.`, { actual: routingParses.map(r => r.raw).join(', ') })
    : result('ST_ROUTING_BARCODE_PRESENT', 'Routing barcode decoded', 'CRITICAL', 'startrack-routing', 'fail', 'No StarTrack routing barcode or GS1 421 routing barcode was decoded.'));

  validations.push(atlParses.length
    ? result('ST_ATL_BARCODE', 'Authority To Leave barcode decoded', 'INFO', 'startrack-atl', 'pass', `ATL barcode decoded: ${atlParses.map(a => a.atlNumber).join(', ')}.`, { actual: atlParses.map(a => a.atlNumber).join(', ') })
    : atlExpected
      ? result('ST_ATL_BARCODE', 'Authority To Leave barcode decoded', 'ERROR', 'startrack-atl', 'fail', 'Authority To Leave text or QR data indicates an ATL barcode is expected, but no C999999999 ATL barcode was decoded.', { expected: 'C999999999', actual: expectedAtlNumbers.join(', ') || 'ATL text present' })
      : result('ST_ATL_BARCODE', 'Authority To Leave barcode decoded', 'INFO', 'startrack-atl', 'not_applicable', 'No Authority To Leave barcode was decoded and no ATL requirement was detected on the label.'));

  for (const [i, atl] of atlParses.entries()) {
    validations.push(atl.counterNumber >= 1
      ? result(`ST_ATL_COUNTER_${i}`, 'ATL sequential counter', 'ERROR', 'startrack-atl', 'pass', `ATL sequential counter is ${atl.counter}.`, { actual: atl.atlNumber })
      : result(`ST_ATL_COUNTER_${i}`, 'ATL sequential counter', 'ERROR', 'startrack-atl', 'fail', 'ATL sequential counter must start from 000000001.', { expected: 'C000000001 or greater', actual: atl.atlNumber }));
  }

  for (const [i, freight] of freightParses.entries()) {
    validations.push(STARTRACK_PRODUCT_CODE_MAP[freight.productCode]
      ? result(`ST_PRODUCT_KNOWN_${i}`, 'Known StarTrack product code', 'ERROR', 'startrack-product', 'pass', `${freight.productCode} — ${freight.productName}.`, { actual: freight.productCode })
      : result(`ST_PRODUCT_KNOWN_${i}`, 'Known StarTrack product code', 'ERROR', 'startrack-product', 'fail', `Unknown StarTrack product code ${freight.productCode}.`, { actual: freight.productCode }));
    validations.push(/^\d{8}$/.test(freight.consignmentSequence)
      ? result(`ST_CONNOTE_STRUCTURE_${i}`, 'Connote structure', 'ERROR', 'startrack-freight', 'pass', `Connote ${freight.connoteNumber} follows Despatch ID + 8 digits.`, { actual: freight.connoteNumber })
      : result(`ST_CONNOTE_STRUCTURE_${i}`, 'Connote structure', 'ERROR', 'startrack-freight', 'fail', 'Connote sequence is not eight digits.', { actual: freight.connoteNumber }));
    validations.push(/^\d{5}$/.test(freight.itemNumber)
      ? result(`ST_ITEM_SEQUENCE_${i}`, 'Freight item sequence', 'ERROR', 'startrack-freight', 'pass', `Freight item sequence is ${freight.itemNumber}.`, { actual: freight.itemNumber })
      : result(`ST_ITEM_SEQUENCE_${i}`, 'Freight item sequence', 'ERROR', 'startrack-freight', 'fail', 'Freight item sequence must be five digits.', { actual: freight.itemNumber }));
    if (facts.consignmentIds.length) {
      validations.push(facts.consignmentIds.includes(freight.connoteNumber)
        ? result(`ST_CONNOTE_MATCH_${i}`, 'Visible connote matches freight barcode', 'ERROR', 'startrack-freight', 'pass', 'Visible CONNOTE value matches the freight item barcode.', { actual: freight.connoteNumber })
        : result(`ST_CONNOTE_MATCH_${i}`, 'Visible connote matches freight barcode', 'ERROR', 'startrack-freight', 'manual_review', 'Visible CONNOTE value does not match the decoded freight item barcode or could not be matched.', { expected: freight.connoteNumber, actual: facts.consignmentIds.join(', ') }));
    }
  }

  for (const [i, sscc] of validSsccs.entries()) {
    validations.push(result(`ST_SSCC_${i}`, 'SSCC freight item detected', 'INFO', 'startrack-sscc', 'pass', `Valid AI 00 SSCC detected: 00${sscc.sscc}.`, { actual: `00${sscc.sscc}` }));
  }
  for (const [i, sscc] of ssccParses.filter(p => !p.valid).entries()) {
    validations.push(result(`ST_SSCC_INVALID_${i}`, 'SSCC check digit', 'CRITICAL', 'startrack-sscc', 'fail', sscc.reason, { expected: sscc.expectedCheckDigit, actual: sscc.checkDigit }));
  }

  for (const [i, route] of routingParses.entries()) {
    validations.push(STARTRACK_LABEL_CODE_MAP[route.labelCode]
      ? result(`ST_ROUTE_LABEL_CODE_${i}`, 'Routing label code known', 'ERROR', 'startrack-routing', 'pass', `Routing label code ${route.labelCode} is known.`, { actual: route.labelCode })
      : result(`ST_ROUTE_LABEL_CODE_${i}`, 'Routing label code known', 'ERROR', 'startrack-routing', 'fail', `Unknown routing label code ${route.labelCode}.`, { actual: route.labelCode }));
    validations.push(/^\d{4}$/.test(route.postcode)
      ? result(`ST_ROUTE_POSTCODE_${i}`, 'Routing postcode', 'ERROR', 'startrack-routing', 'pass', `Routing postcode is ${route.postcode}.`, { actual: route.postcode })
      : result(`ST_ROUTE_POSTCODE_${i}`, 'Routing postcode', 'ERROR', 'startrack-routing', 'fail', 'Routing barcode postcode must be four digits.', { actual: route.postcode }));
    const freightProduct = freightParses[0]?.productCode || qrParses[0]?.productCode;
    if (freightProduct && STARTRACK_PRODUCT_CODE_MAP[freightProduct]) {
      const expectedLabelCode = STARTRACK_PRODUCT_CODE_MAP[freightProduct].labelCode;
      validations.push(route.labelCode === expectedLabelCode
        ? result(`ST_ROUTE_PRODUCT_MATCH_${i}`, 'Routing/product compatibility', 'ERROR', 'startrack-product', 'pass', `Routing label code ${route.labelCode} matches product ${freightProduct}.`, { expected: expectedLabelCode, actual: route.labelCode })
        : result(`ST_ROUTE_PRODUCT_MATCH_${i}`, 'Routing/product compatibility', 'ERROR', 'startrack-product', 'fail', `Routing label code ${route.labelCode} does not match product ${freightProduct}.`, { expected: expectedLabelCode, actual: route.labelCode }));
    }
  }

  for (const [i, qr] of qrParses.entries()) {
    const f = qr.fields;
    const mandatory = [
      ['receiverSuburb', 'Receiver suburb'], ['receiverPostcode', 'Receiver postcode'], ['connoteNumber', 'Consignment number'],
      ['freightItemNumber', 'Freight item number'], ['productCode', 'Product code'], ['consignmentQuantity', 'Consignment quantity'],
      ['consignmentWeight', 'Consignment weight'], ['despatchDate', 'Despatch date'], ['receiverName1', 'Receiver name'],
      ['unitType', 'Unit type'], ['destinationDepot', 'Destination depot'], ['receiverAddress1', 'Receiver address line 1'],
      ['dangerousGoodsIndicator', 'Dangerous goods indicator'], ['movementTypeIndicator', 'Movement type indicator']
    ];
    const missing = mandatory.filter(([key]) => !String(f[key] || '').trim()).map(([, label]) => label);
    validations.push(missing.length === 0
      ? result(`ST_QR_MANDATORY_${i}`, 'QR mandatory fields', 'ERROR', 'startrack-qr', 'pass', 'Mandatory QR fields are populated.')
      : result(`ST_QR_MANDATORY_${i}`, 'QR mandatory fields', 'ERROR', 'startrack-qr', 'fail', `QR mandatory fields missing: ${missing.join(', ')}.`));
    validations.push(/^\d{4}$/.test(f.receiverPostcode)
      ? result(`ST_QR_POSTCODE_${i}`, 'QR receiver postcode', 'ERROR', 'startrack-qr', 'pass', `QR receiver postcode is ${f.receiverPostcode}.`, { actual: f.receiverPostcode })
      : result(`ST_QR_POSTCODE_${i}`, 'QR receiver postcode', 'ERROR', 'startrack-qr', 'fail', 'QR receiver postcode must be four digits.', { actual: f.receiverPostcode }));
    validations.push(STARTRACK_PRODUCT_CODE_MAP[f.productCode]
      ? result(`ST_QR_PRODUCT_${i}`, 'QR product code known', 'ERROR', 'startrack-product', 'pass', `QR product ${f.productCode}: ${qr.productName}.`, { actual: f.productCode })
      : result(`ST_QR_PRODUCT_${i}`, 'QR product code known', 'ERROR', 'startrack-product', 'fail', `Unknown QR product code ${f.productCode}.`, { actual: f.productCode }));
    validations.push(['Y', 'N'].includes(f.dangerousGoodsIndicator)
      ? result(`ST_QR_DG_${i}`, 'QR dangerous goods indicator', 'ERROR', 'startrack-qr', 'pass', `DG indicator is ${f.dangerousGoodsIndicator}.`, { actual: f.dangerousGoodsIndicator })
      : result(`ST_QR_DG_${i}`, 'QR dangerous goods indicator', 'ERROR', 'startrack-qr', 'fail', 'DG indicator must be Y or N.', { actual: f.dangerousGoodsIndicator }));
    validations.push(['N', 'C', 'T'].includes(f.movementTypeIndicator)
      ? result(`ST_QR_MOVEMENT_${i}`, 'QR movement type indicator', 'ERROR', 'startrack-qr', 'pass', `Movement type indicator is ${f.movementTypeIndicator}.`, { actual: f.movementTypeIndicator })
      : result(`ST_QR_MOVEMENT_${i}`, 'QR movement type indicator', 'ERROR', 'startrack-qr', 'fail', 'Movement type must be N, C or T.', { actual: f.movementTypeIndicator }));
    const allowedUnits = STARTRACK_UNIT_TYPE_MAP[f.unitType] || [];
    validations.push(allowedUnits.length && (!f.productCode || allowedUnits.includes(f.productCode))
      ? result(`ST_QR_UNIT_${i}`, 'QR unit type permitted', 'ERROR', 'startrack-product', 'pass', `Unit type ${f.unitType} is permitted${f.productCode ? ` for ${f.productCode}` : ''}.`, { actual: f.unitType })
      : result(`ST_QR_UNIT_${i}`, 'QR unit type permitted', 'ERROR', 'startrack-product', 'manual_review', `Unit type ${f.unitType || 'blank'} could not be confirmed against product ${f.productCode || 'unknown'}.`, { actual: f.unitType }));
    if (f.atlNumber) {
      validations.push(/^C\d{9}$/.test(f.atlNumber)
        ? result(`ST_QR_ATL_${i}`, 'QR ATL number format', 'ERROR', 'startrack-atl', 'pass', `ATL number is ${f.atlNumber}.`, { actual: f.atlNumber })
        : result(`ST_QR_ATL_${i}`, 'QR ATL number format', 'ERROR', 'startrack-atl', 'fail', 'ATL number must use C999999999 format when populated.', { actual: f.atlNumber }));
    }
  }
  if (ssccOnly) {
    validations.push(result('ST_SSCC_PRODUCT_RULE', 'SSCC product handling', 'INFO', 'startrack-sscc', 'pass', 'SSCC freight labels encode AI 00 SSCC data. StarTrack product may be supplied by QR/routing data, but it is not embedded in the SSCC article identifier.'));
  }

  const fail = validations.some(v => v.status === 'fail' && (v.severity === 'CRITICAL' || v.severity === 'ERROR'));
  const review = validations.some(v => v.status === 'warning' || v.status === 'manual_review');
  const overallStatus = fail ? 'FAIL' : review ? 'REVIEW' : 'PASS';
  const summary = {
    overallStatus,
    total: validations.length,
    critical: validations.filter(v => v.severity === 'CRITICAL').length,
    errors: validations.filter(v => v.severity === 'ERROR').length,
    warnings: validations.filter(v => v.severity === 'WARNING').length,
    manualReview: validations.filter(v => v.status === 'manual_review').length,
    failed: validations.filter(v => v.status === 'fail').length,
    passed: validations.filter(v => v.status === 'pass').length
  };
  const articles = [
    ...freightParses.map(f => ({ type: 'startrack-code128-freight', articleId: f.freightItemId, ...f })),
    ...validSsccs.map(s => ({ type: 'sscc', articleId: `00${s.sscc}`, sscc: `00${s.sscc}`, ...s }))
  ];
  return {
    generatedAt: new Date().toISOString(),
    carrier: 'startrack',
    fileInfo,
    labelFacts: facts,
    visualEvidence,
    detectedBarcodes,
    manualBarcodeCount: manualValues.length,
    parsed: [...qrParses, ...freightParses, ...routingParses, ...atlParses, ...validSsccs],
    startrack: { qrParses, freightParses, routingParses, ssccParses: validSsccs, atlParses, ssccOnly },
    articles,
    invalidArticleCandidates: [],
    summary,
    validations
  };
}

/** Dispatches one label/page to the carrier-specific audit engine and attaches payload comparison. */
export function auditLabel(input = {}) {
  const baseAudit = (input.labelFamily === 'startrack' || input.carrier === 'startrack')
    ? auditStarTrackLabel(input)
    : { ...auditEparcelLabel(input), carrier: 'eparcel' };
  return attachApiPayloadComparison(baseAudit, input.manifestJson || input.apiPayloadText || '');
}

/** Groups raw validation rows into the report sections rendered by the React UI. */
export function groupValidations(validations) {
  const displayCategory = (category) => {
    if (category === 'gs1-128' || category === 'barcode-structure' || category === 'check-digit') return 'linear barcode analysis';
    if (category === 'datamatrix') return 'DataMatrix barcode analysis';
    if (category === 'startrack-qr') return 'StarTrack QR barcode';
    if (category === 'startrack-freight' || category === 'startrack-sscc') return 'StarTrack freight item barcode';
    if (category === 'startrack-routing') return 'StarTrack routing barcode';
    if (category === 'startrack-atl') return 'StarTrack ATL barcode';
    if (category === 'startrack-product') return 'StarTrack product/article data';
    if (category === 'startrack-label-layout') return 'label-layout';
    if (category === 'startrack-text') return 'address-format';
    return category;
  };
  return validations.reduce((acc, item) => {
    const key = displayCategory(item.category);
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...item, originalCategory: item.category });
    return acc;
  }, {});
}
