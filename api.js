import pLimit from 'p-limit';
import { logger } from './logger.js';

const DEFAULT_API_VERSION = '2024-10';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

// Token refresh buffer — refresh 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Shopify Admin API client with automatic pagination, rate limiting,
 * retry logic, and support for both client credentials and static tokens.
 */
export class ShopifyClient {
  /**
   * @param {object} config
   * @param {string} config.shop - The myshopify.com domain (e.g. "my-store.myshopify.com")
   * @param {string} [config.accessToken] - Static access token (legacy admin-created apps)
   * @param {string} [config.clientId] - Client ID (Dev Dashboard apps)
   * @param {string} [config.clientSecret] - Client secret (Dev Dashboard apps)
   * @param {string} [config.authMethod] - "client_credentials" or "static"
   * @param {string} [config.apiVersion] - API version (default: 2024-10)
   * @param {number} [config.concurrency] - Max concurrent requests (default: 2)
   * @param {boolean} [config.readOnly] - If true, block all POST/PUT/DELETE requests (safety net for source stores)
   */
  constructor({ shop, accessToken, clientId, clientSecret, authMethod = 'static', apiVersion = DEFAULT_API_VERSION, concurrency = 2, readOnly = false }) {
    this.shop = shop;
    this.authMethod = authMethod;
    this.apiVersion = apiVersion;
    this.baseUrl = `https://${shop}/admin/api/${apiVersion}`;
    this.limit = pLimit(concurrency);
    this.readOnly = readOnly;

    // Static token (legacy)
    this.staticToken = accessToken || null;

    // Client credentials (Dev Dashboard)
    this.clientId = clientId || null;
    this.clientSecret = clientSecret || null;

    // Token cache for client_credentials grant
    this._cachedToken = null;
    this._tokenExpiresAt = null;
  }

  /**
   * Get a valid access token. For client_credentials, fetches/refreshes automatically.
   * For static tokens, returns the stored token directly.
   */
  async getAccessToken() {
    if (this.authMethod === 'static') {
      if (!this.staticToken) {
        throw new Error(`No access token configured for ${this.shop}. Set the ACCESS_TOKEN in .env`);
      }
      return this.staticToken;
    }

    // Client credentials flow — check if we have a valid cached token
    if (this._cachedToken && this._tokenExpiresAt) {
      const now = Date.now();
      if (now < this._tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
        return this._cachedToken;
      }
      logger.verbose(`Token for ${this.shop} is expiring soon, refreshing...`);
    }

    // Fetch a new token via client_credentials grant
    return this._fetchClientCredentialsToken();
  }

  /**
   * Fetch a new access token using the client_credentials OAuth grant.
   * Tokens are valid for ~24 hours (86399 seconds).
   */
  async _fetchClientCredentialsToken() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        `Missing client credentials for ${this.shop}. ` +
        `Set CLIENT_ID and CLIENT_SECRET in .env, or switch to AUTH_METHOD=static.`
      );
    }

    const url = `https://${this.shop}/admin/oauth/access_token`;

    logger.verbose(`Requesting access token for ${this.shop} via client_credentials grant...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Failed to get access token for ${this.shop} (HTTP ${response.status}).\n` +
        `Response: ${text}\n\n` +
        `Troubleshooting:\n` +
        `  - Verify CLIENT_ID and CLIENT_SECRET are correct\n` +
        `  - Make sure the app is installed on the store\n` +
        `  - Check that API scopes are configured and a version is released\n` +
        `  - See the README troubleshooting section for more help`
      );
    }

    const data = await response.json();
    this._cachedToken = data.access_token;
    this._tokenExpiresAt = Date.now() + (data.expires_in || 86399) * 1000;

    logger.verbose(`Got access token for ${this.shop} (expires in ${data.expires_in}s, scopes: ${data.scope})`);
    return this._cachedToken;
  }

  /**
   * Build headers for Shopify API requests.
   */
  async getHeaders() {
    const token = await this.getAccessToken();
    return {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /**
   * Execute a request with concurrency limiting.
   */
  async request(method, path, { body, params, rawUrl } = {}) {
    return this.limit(() => this._request(method, path, { body, params, rawUrl }));
  }

  /**
   * Internal request method with retry logic for rate limiting.
   */
  async _request(method, path, { body, params, rawUrl } = {}) {
    let url;
    if (rawUrl) {
      url = rawUrl;
    } else {
      url = `${this.baseUrl}${path}`;
      if (params) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            searchParams.set(key, String(value));
          }
        }
        const qs = searchParams.toString();
        if (qs) url += `?${qs}`;
      }
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const headers = await this.getHeaders();
      const options = { method, headers };
      if (body && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(body);
      }

      let response;
      try {
        response = await fetch(url, options);
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn(`Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err.message}. Retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        throw new Error(`Network error after ${MAX_RETRIES + 1} attempts: ${err.message}`);
      }

      // Handle 401 — token may have expired mid-run (client_credentials)
      if (response.status === 401 && this.authMethod === 'client_credentials' && attempt < MAX_RETRIES) {
        logger.warn(`Got 401 Unauthorized — refreshing token (attempt ${attempt + 1})...`);
        this._cachedToken = null;
        this._tokenExpiresAt = null;
        await sleep(1000);
        continue;
      }

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseFloat(retryAfter) * 1000
          : BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`Rate limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
        continue;
      }

      // Handle server errors with retry
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`Server error ${response.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ApiError(response.status, method, url, text);
      }

      // 204 No Content
      if (response.status === 204) {
        return { data: null, headers: response.headers };
      }

      const data = await response.json();
      return { data, headers: response.headers };
    }

    throw new Error(`Request failed after ${MAX_RETRIES + 1} attempts: ${method} ${url}`);
  }

  /**
   * GET request.
   */
  async get(path, params) {
    const { data, headers } = await this.request('GET', path, { params });
    return { data, headers };
  }

  /**
   * POST request. Blocked if client is in readOnly mode.
   */
  async post(path, body) {
    this._enforceWritable('POST', path);
    const { data } = await this.request('POST', path, { body });
    return data;
  }

  /**
   * PUT request. Blocked if client is in readOnly mode.
   */
  async put(path, body) {
    this._enforceWritable('PUT', path);
    const { data } = await this.request('PUT', path, { body });
    return data;
  }

  /**
   * DELETE request. Blocked if client is in readOnly mode.
   */
  async delete(path) {
    this._enforceWritable('DELETE', path);
    const { data } = await this.request('DELETE', path);
    return data;
  }

  /**
   * Safety net: throws an error if a write operation is attempted on a read-only client.
   * This prevents any accidental modification of the source store.
   */
  _enforceWritable(method, path) {
    if (this.readOnly) {
      throw new Error(
        `SAFETY BLOCK: Attempted ${method} ${path} on read-only store ${this.shop}. ` +
        `This is a bug — the source store should never receive write requests. ` +
        `The operation has been blocked. Your source store is safe.`
      );
    }
  }

  /**
   * Fetch all pages of a paginated resource.
   * Follows the Link header with rel="next" until no more pages exist.
   */
  async getAll(path, resourceKey, params = {}) {
    const allItems = [];
    let currentParams = { limit: 250, ...params };
    let currentPath = path;
    let isRawUrl = false;

    while (true) {
      const { data, headers } = await this.request('GET', currentPath, {
        params: isRawUrl ? undefined : currentParams,
        rawUrl: isRawUrl ? currentPath : undefined,
      });

      const items = data[resourceKey];
      if (items && items.length > 0) {
        allItems.push(...items);
      }

      // Check for next page via Link header
      const linkHeader = headers.get('link');
      const nextUrl = parseLinkHeader(linkHeader);
      if (nextUrl) {
        currentPath = nextUrl;
        isRawUrl = true;
      } else {
        break;
      }
    }

    return allItems;
  }
}

/**
 * Parse the Link header to extract the "next" URL.
 */
function parseLinkHeader(header) {
  if (!header) return null;

  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Custom error class for API errors.
 */
class ApiError extends Error {
  constructor(status, method, url, body) {
    super(`API Error ${status}: ${method} ${url}\n${body}`);
    this.status = status;
    this.method = method;
    this.url = url;
    this.responseBody = body;
  }
}
