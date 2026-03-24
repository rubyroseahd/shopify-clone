import pLimit from 'p-limit';
import { logger } from './logger.js';

const DEFAULT_API_VERSION = '2024-10';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

/**
 * Shopify Admin API client with automatic pagination, rate limiting, and retry logic.
 */
export class ShopifyClient {
  constructor(shop, accessToken, { apiVersion = DEFAULT_API_VERSION, concurrency = 2 } = {}) {
    this.shop = shop;
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.baseUrl = `https://${shop}/admin/api/${apiVersion}`;
    this.limit = pLimit(concurrency);
  }

  /**
   * Build headers for Shopify API requests.
   */
  get headers() {
    return {
      'X-Shopify-Access-Token': this.accessToken,
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
      const options = {
        method,
        headers: this.headers,
      };
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
   * POST request.
   */
  async post(path, body) {
    const { data } = await this.request('POST', path, { body });
    return data;
  }

  /**
   * PUT request.
   */
  async put(path, body) {
    const { data } = await this.request('PUT', path, { body });
    return data;
  }

  /**
   * DELETE request.
   */
  async delete(path) {
    const { data } = await this.request('DELETE', path);
    return data;
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
