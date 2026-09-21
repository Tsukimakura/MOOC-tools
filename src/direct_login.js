import {
  constants, createCipheriv, createHash, publicEncrypt, randomBytes
} from 'node:crypto';

const LOGIN_PAGE = 'https://www.icourse163.org/member/login.htm#/webLoginIndex';
const COMPONENT_PAGE = 'https://reg.icourse163.org/webzj/v1.0.1/pub/index_dl2_new.html';
const API_BASE = 'https://reg.icourse163.org/dl/zj';
const PRODUCT = 'imooc';
const PROMARK = 'cjJVGQM';
const SM4_KEY = Buffer.from('BC60B8B9E4FFEFFA219E5AD77F11F9E2', 'hex');
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC5gsH+AA4XWONB5TDcUd+xCz7e
jOFHZKlcZDx+pF1i7Gsvi1vjyJoQhRtRSn950x498VUkx7rUxg1/ScBVfrRxQOZ8x
FBye3pjAzfb22+RCuYApSVpJ3OO3KsEuKExftz9oFBv3ejxPlYc5yq7YiBO8XlTn
QN0Sa4R4qhPO3I2MQIDAQAB
-----END PUBLIC KEY-----`;
const ALLOWED_COOKIE_DOMAINS = new Set([
  'icourse163.org', 'www.icourse163.org', 'reg.icourse163.org'
]);
const CHALLENGE_CODES = new Set([
  '405', '408', '421', '423', '427', '428', '438', '441', '442', '443',
  '444', '445', '447', '690', '691', '692', '803', '804', '805', '806'
]);
const INVALID_CREDENTIAL_CODES = new Set(['401', '412', '413', '420']);
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function randomId() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(32);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export function encryptLoginPayload(value) {
  const cipher = createCipheriv('sm4-ecb', SM4_KEY, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('hex');
}

export function encryptPassword(password) {
  return publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(password)).toString('base64');
}

function defaultCookiePath(pathname) {
  if (!pathname?.startsWith('/') || pathname === '/') return '/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
}

function cookieKey(cookie) {
  return `${cookie.domain}\0${cookie.path}\0${cookie.name}`;
}

export class LoginCookieJar {
  constructor() {
    this.items = new Map();
  }

  setFromHeader(header, requestUrl) {
    if (!header) return;
    const url = new URL(requestUrl);
    const parts = header.split(';').map((part) => part.trim());
    const separator = parts[0].indexOf('=');
    if (separator <= 0) return;
    const cookie = {
      name: parts[0].slice(0, separator), value: parts[0].slice(separator + 1),
      domain: url.hostname, path: defaultCookiePath(url.pathname),
      secure: false, httpOnly: false, sameSite: undefined, expires: -1,
      hostOnly: true
    };
    let remove = false;
    for (const attribute of parts.slice(1)) {
      const index = attribute.indexOf('=');
      const name = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
      const value = index < 0 ? '' : attribute.slice(index + 1).trim();
      if (name === 'domain') {
        const domain = value.toLowerCase().replace(/^\./, '');
        if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return;
        cookie.domain = domain;
        cookie.hostOnly = false;
      } else if (name === 'path' && value.startsWith('/')) cookie.path = value;
      else if (name === 'secure') cookie.secure = true;
      else if (name === 'httponly') cookie.httpOnly = true;
      else if (name === 'samesite') cookie.sameSite = value;
      else if (name === 'max-age') {
        const seconds = Number(value);
        if (Number.isFinite(seconds)) {
          cookie.expires = Date.now() / 1000 + seconds;
          remove = seconds <= 0;
        }
      } else if (name === 'expires' && cookie.expires < 0) {
        const time = Date.parse(value);
        if (Number.isFinite(time)) {
          cookie.expires = time / 1000;
          remove = time <= Date.now();
        }
      }
    }
    const key = cookieKey(cookie);
    if (remove) this.items.delete(key);
    else this.items.set(key, cookie);
  }

  capture(headers, requestUrl) {
    const values = typeof headers?.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers?.raw?.()['set-cookie'] || [];
    for (const value of values) this.setFromHeader(value, requestUrl);
  }

  header(urlValue) {
    const url = new URL(urlValue);
    const now = Date.now() / 1000;
    const matches = [...this.items.values()].filter((cookie) =>
      (!cookie.expires || cookie.expires < 0 || cookie.expires > now) &&
      (cookie.hostOnly ? url.hostname === cookie.domain :
        url.hostname === cookie.domain || url.hostname.endsWith(`.${cookie.domain}`)) &&
      url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === 'https:'));
    matches.sort((a, b) => b.path.length - a.path.length);
    return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  courseCookies() {
    const now = Date.now() / 1000;
    return [...this.items.values()].filter((cookie) =>
      ALLOWED_COOKIE_DOMAINS.has(cookie.domain) &&
      (!cookie.expires || cookie.expires < 0 || cookie.expires > now))
      .map(({ hostOnly: _hostOnly, ...cookie }) => ({
        ...cookie,
        domain: cookie.domain === 'icourse163.org' ? '.icourse163.org' : cookie.domain
      }));
  }
}

async function request(jar, fetchImpl, urlValue, options = {}) {
  let url = new URL(urlValue);
  let method = options.method || 'GET';
  let body = options.body;
  for (let redirects = 0; redirects < 6; redirects++) {
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: options.accept || 'application/json, text/plain, */*',
      ...options.headers
    };
    const cookies = jar.header(url);
    if (cookies) headers.Cookie = cookies;
    const response = await fetchImpl(url, {
      method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(options.timeout || 20_000)
    });
    jar.capture(response.headers, url);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    url = new URL(location, url);
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      delete headers['Content-Type'];
    }
  }
  throw new Error('登录请求跳转次数过多。');
}

async function jsonRequest(jar, fetchImpl, flow, path, data) {
  const payload = {
    ...data, channel: data.channel ?? flow.channel, topURL: LOGIN_PAGE, rtid: randomId()
  };
  const response = await request(jar, fetchImpl, `${API_BASE}/${flow.name}${path}`, {
    method: 'POST', body: JSON.stringify({ encParams: encryptLoginPayload(payload) }),
    headers: {
      'Content-Type': 'application/json', Origin: 'https://reg.icourse163.org', Referer: COMPONENT_PAGE
    }
  });
  if (!response.ok) throw new Error(`登录接口 HTTP ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error('登录接口没有返回有效 JSON。'); }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function sequentialProof(info) {
  const started = Date.now();
  const maximum = Math.max(100, Number(info.maxTime) || 5000);
  const puzzle = String(info.args.puzzle);
  const target = BigInt(`0x${info.args.target}`);
  let bestHash;
  let bestIteration = 0;
  let hash;
  let iteration = 0;
  while (!hash || BigInt(`0x${hash}`) > target) {
    iteration++;
    hash = sha256(`${puzzle}${iteration}`);
    if (!bestHash || BigInt(`0x${hash}`) < BigInt(`0x${bestHash}`)) {
      bestHash = hash;
      bestIteration = iteration;
    }
    if (Date.now() - started > maximum) {
      hash = bestHash;
      iteration = bestIteration;
      break;
    }
    if (iteration % 2000 === 0) await tick();
  }
  return {
    sid: info.sid, puzzle, spendTime: Date.now() - started, runTimes: iteration,
    args: JSON.stringify({ pow: hash, n: iteration })
  };
}

async function recursiveProof(info) {
  const started = Date.now();
  const maximum = Math.max(100, Number(info.maxTime) || 5000);
  const puzzle = String(info.args.puzzle);
  const target = BigInt(`0x${info.args.target}`);
  let hash = '';
  let previous = '';
  let previousPrevious = '';
  let best = null;
  let iteration = 0;
  while (!hash || BigInt(`0x${hash}`) > target) {
    iteration++;
    const next = sha256(`${puzzle}${hash}`);
    previousPrevious = previous;
    previous = hash;
    hash = next;
    if (!best || BigInt(`0x${hash}`) < BigInt(`0x${best.hash}`)) {
      best = { hash, previous, previousPrevious, iteration };
    }
    if (Date.now() - started > maximum) {
      ({ hash, previous, previousPrevious, iteration } = best);
      break;
    }
    if (iteration % 2000 === 0) await tick();
  }
  return {
    sid: info.sid, puzzle, spendTime: Date.now() - started, runTimes: iteration,
    args: JSON.stringify({ pow: hash, n1: previous, n2: previousPrevious })
  };
}

export async function solveProof(info) {
  if (!info?.needCheck) return null;
  if (!info.args?.puzzle || !info.args?.target) throw new Error('登录计算验证格式不受支持。');
  if (info.hashFunc === 'VDF_FUNCTION') throw new Error('登录计算验证需要浏览器完成。');
  return info.hashFunc === 'RECUR_HASHCASH' ? recursiveProof(info) : sequentialProof(info);
}

function safeSyncUrl(value) {
  try {
    const url = new URL(value.replace(/^http:/, 'https:'));
    const allowed = url.hostname === 'icourse163.org' || url.hostname.endsWith('.icourse163.org') ||
      url.hostname === '163.com' || url.hostname.endsWith('.163.com') ||
      url.hostname === '126.com' || url.hostname.endsWith('.126.com') ||
      url.hostname === 'netease.com' || url.hostname.endsWith('.netease.com') ||
      url.hostname === 'yeah.net' || url.hostname.endsWith('.yeah.net');
    return url.protocol === 'https:' && allowed ? url : null;
  } catch { return null; }
}

function rawQueryFields(url) {
  const fields = {};
  for (const item of url.search.slice(1).split('&')) {
    const separator = item.indexOf('=');
    if (separator >= 0 && item.slice(0, separator)) fields[item.slice(0, separator)] = item.slice(separator + 1);
  }
  return fields;
}

function encryptedSyncUrl(url) {
  if (!/\/(?:dl|zc)\/common\/setCookie$/.test(url.pathname) || !url.search) return url;
  const fields = rawQueryFields(url);
  url.search = `?encParams=${encryptLoginPayload(fields)}`;
  return url;
}

async function syncLoginCookies(jar, fetchImpl, urls) {
  for (const value of Array.isArray(urls) ? urls : []) {
    const url = safeSyncUrl(value);
    if (!url) continue;
    if (/\/dl\/zj\/mail\/go$/.test(url.pathname)) {
      await jsonRequest(jar, fetchImpl, { name: 'mail', channel: 0 }, '/go', rawQueryFields(url))
        .catch(() => null);
      continue;
    }
    const target = encryptedSyncUrl(url);
    await request(jar, fetchImpl, target, {
      headers: { Referer: COMPONENT_PAGE }, accept: 'text/html,application/xhtml+xml,*/*'
    }).catch(() => null);
  }
  await request(jar, fetchImpl, 'https://www.icourse163.org/', {
    headers: { Referer: LOGIN_PAGE }, accept: 'text/html,application/xhtml+xml,*/*'
  }).catch(() => null);
}

function failure(status, response) {
  const code = String(response?.ret ?? 'unknown');
  const detail = response?.dt ? `${code}-${response.dt}` : code;
  return { status, code: detail };
}

export async function directPasswordLogin(credentials, options = {}) {
  const enteredUsername = String(credentials?.username || '').trim();
  const password = String(credentials?.password || '');
  const compactPhone = enteredUsername.replace(/[\s()-]/g, '').replace(/^(?:\+86|0086)/, '');
  const flow = /^1\d{10}$/.test(compactPhone)
    ? { name: 'yd', channel: 1, loginPath: '/pwd/l', username: compactPhone }
    : enteredUsername.includes('@')
      ? { name: 'mail', channel: 0, loginPath: '/l', username: enteredUsername }
      : null;
  if (!flow || !password) return { status: 'unsupported' };
  const username = flow.username;
  const fetchImpl = options.fetchImpl || fetch;
  const jar = options.jar || new LoginCookieJar();
  try {
    await request(jar, fetchImpl, 'https://www.icourse163.org/member/login.htm', {
      accept: 'text/html,application/xhtml+xml,*/*'
    });
    await request(jar, fetchImpl, COMPONENT_PAGE, {
      headers: { Referer: LOGIN_PAGE }, accept: 'text/html,application/xhtml+xml,*/*'
    });
    const common = { pd: PRODUCT, pkid: PROMARK };
    const initial = await jsonRequest(jar, fetchImpl, flow, '/ini', {
      ...common, pkht: 'www.icourse163.org'
    });
    if (String(initial.ret) !== '201') return failure(
      CHALLENGE_CODES.has(String(initial.ret)) || Number(initial.capFlag) > 0 ? 'challenge' : 'failed', initial
    );
    if (Number(initial.capFlag) > 0) return failure('challenge', initial);

    let proof = null;
    if (initial.pv) {
      const power = await jsonRequest(jar, fetchImpl, flow, '/powGetP', { ...common, un: username });
      if (String(power.ret) !== '201') return failure('challenge', power);
      try { proof = await solveProof(power.pVInfo); }
      catch { return failure('challenge', power); }
    }

    const ticket = await jsonRequest(jar, fetchImpl, flow, '/gt', { ...common, un: username });
    if (String(ticket.ret) !== '201' || !ticket.tk) {
      const code = String(ticket.ret);
      return failure(INVALID_CREDENTIAL_CODES.has(code) ? 'invalid' :
        CHALLENGE_CODES.has(code) ? 'challenge' : 'failed', ticket);
    }
    const login = await jsonRequest(jar, fetchImpl, flow, flow.loginPath, {
      ...common, l: 1, d: 10, un: username, pw: encryptPassword(password), tk: ticket.tk,
      domains: '', ...(flow.name === 'mail' ? { t: Date.now() } : {}),
      ...(proof ? { pVParam: proof } : {})
    });
    if (String(login.ret) !== '201') {
      const code = String(login.ret);
      return failure(INVALID_CREDENTIAL_CODES.has(code) ? 'invalid' :
        CHALLENGE_CODES.has(code) || login.mode || login.unprotectedGuide || login.safeMobileGuide
          ? 'challenge' : 'failed', login);
    }
    await syncLoginCookies(jar, fetchImpl, login.nextUrls);
    return { status: 'success', cookies: jar.courseCookies() };
  } catch (error) {
    return { status: 'unavailable', error };
  }
}
