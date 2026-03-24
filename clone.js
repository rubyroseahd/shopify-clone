import { createInterface } from 'readline';
import { ShopifyClient } from './api.js';
import { logger } from './logger.js';

// Resource modules in dependency order
import * as products from './resources/products.js';
import * as collections from './resources/collections.js';
import * as pages from './resources/pages.js';
import * as blogs from './resources/blogs.js';
import * as redirects from './resources/redirects.js';
import * as scriptTags from './resources/script_tags.js';
import * as theme from './resources/theme.js';
import * as metafields from './resources/metafields.js';

// Ordered list of all resource modules
const ALL_RESOURCES = [
  products,
  collections,
  pages,
  blogs,
  redirects,
  scriptTags,
  theme,
  metafields,
];

/**
 * Main orchestrator — runs the clone process for selected resources.
 */
export async function runClone(config) {
  const { authMethod, sourceShop, targetShop, options } = config;

  logger.setVerbose(options.verbose);

  // ── Validate store domains ────────────────────────────────────────────────
  if (!sourceShop) {
    throw new Error('Missing SOURCE_SHOP in .env (e.g. my-store.myshopify.com)');
  }
  if (!targetShop) {
    throw new Error('Missing TARGET_SHOP in .env (e.g. my-dev-store.myshopify.com)');
  }

  // ── Safety check: prevent cloning to yourself ─────────────────────────────
  if (sourceShop.toLowerCase() === targetShop.toLowerCase()) {
    throw new Error(
      'SOURCE_SHOP and TARGET_SHOP are the same store. ' +
      'This would create duplicate data on your production store. Aborting.'
    );
  }

  // ── Build API clients ─────────────────────────────────────────────────────
  // CRITICAL: Source client is created in READ-ONLY mode.
  // This is a hard safety net — even if a bug in the code tried to write to the
  // source store, the client would block it and throw an error.
  let sourceApi, targetApi;

  if (authMethod === 'client_credentials') {
    if (!config.sourceClientId || !config.sourceClientSecret) {
      throw new Error(
        'Missing source store credentials.\n' +
        'Set SOURCE_CLIENT_ID and SOURCE_CLIENT_SECRET in .env\n' +
        '(from Dev Dashboard > Your Source App > Settings)'
      );
    }
    if (!config.targetClientId || !config.targetClientSecret) {
      throw new Error(
        'Missing target store credentials.\n' +
        'Set TARGET_CLIENT_ID and TARGET_CLIENT_SECRET in .env\n' +
        '(from Dev Dashboard > Your Target App > Settings)'
      );
    }

    sourceApi = new ShopifyClient({
      shop: sourceShop,
      clientId: config.sourceClientId,
      clientSecret: config.sourceClientSecret,
      authMethod: 'client_credentials',
      readOnly: true, // ← SAFETY: source store is read-only
    });

    targetApi = new ShopifyClient({
      shop: targetShop,
      clientId: config.targetClientId,
      clientSecret: config.targetClientSecret,
      authMethod: 'client_credentials',
    });

  } else {
    if (!config.sourceToken) {
      throw new Error('Missing SOURCE_ACCESS_TOKEN in .env');
    }
    if (!config.targetToken) {
      throw new Error('Missing TARGET_ACCESS_TOKEN in .env');
    }

    sourceApi = new ShopifyClient({
      shop: sourceShop,
      accessToken: config.sourceToken,
      authMethod: 'static',
      readOnly: true, // ← SAFETY: source store is read-only
    });

    targetApi = new ShopifyClient({
      shop: targetShop,
      accessToken: config.targetToken,
      authMethod: 'static',
    });
  }

  // Determine which resources to clone
  const resources = filterResources(ALL_RESOURCES, options);

  // ── Print header ──────────────────────────────────────────────────────────
  logger.divider();
  logger.step('Shopify Store Clone v2.0');
  logger.info(`Auth method: ${authMethod === 'client_credentials' ? 'Dev Dashboard (client credentials)' : 'Legacy (static token)'}`);
  logger.info(`Source: ${sourceShop} (READ-ONLY — no data will be modified)`);
  logger.info(`Target: ${targetShop} (data will be CREATED here)`);
  if (options.dryRun) {
    logger.warn('DRY RUN — no changes will be made to any store');
  }
  logger.info(`Resources: ${resources.map((r) => r.key).join(', ')}`);
  logger.divider();

  // ── Verify API connectivity ───────────────────────────────────────────────
  logger.step('Verifying API access...');

  let sourceScopes, targetScopes;
  try {
    const token = await sourceApi.getAccessToken();
    // Verify by making a lightweight read call
    await sourceApi.get('/shop.json');
    logger.success(`Source store (${sourceShop}) — connected, read-only mode`);
  } catch (err) {
    throw new Error(`Cannot connect to source store (${sourceShop}): ${err.message}`);
  }

  try {
    await targetApi.getAccessToken();
    await targetApi.get('/shop.json');
    logger.success(`Target store (${targetShop}) — connected`);
  } catch (err) {
    throw new Error(`Cannot connect to target store (${targetShop}): ${err.message}`);
  }
  console.log('');

  // ── Pre-flight check: warn if target store already has data ───────────────
  if (!options.dryRun) {
    await prefightCheck(targetApi, targetShop, resources);
  }

  // ── Confirmation prompt (skip in dry-run or if --yes flag) ────────────────
  if (!options.dryRun && !options.yes) {
    console.log('');
    const confirmed = await promptConfirmation(
      `Ready to clone data from ${sourceShop} → ${targetShop}.\n` +
      `  This will CREATE new data on ${targetShop}.\n` +
      `  The source store (${sourceShop}) will NOT be modified.\n` +
      `  Continue? (y/N): `
    );
    if (!confirmed) {
      logger.warn('Clone cancelled by user.');
      return;
    }
    console.log('');
  }

  // Navigation menus note
  logger.warn(
    'Navigation menus are not available via the REST Admin API and will not be cloned. ' +
    'You will need to recreate them manually in the target store admin.'
  );
  console.log('');

  // ── Run each resource clone sequentially ──────────────────────────────────
  const results = [];

  for (const resource of ALL_RESOURCES) {
    const isSelected = resources.includes(resource);

    if (!isSelected) {
      results.push({ name: resource.name, skipped: true });
      continue;
    }

    logger.step(`Cloning ${resource.name}...`);

    try {
      const result = await resource.clone(sourceApi, targetApi, options);
      results.push({ name: resource.name, count: result.count });
    } catch (err) {
      logger.error(`${resource.name} clone failed: ${err.message}`);
      logger.verbose(err.stack);
      results.push({ name: resource.name, error: err.message });
    }

    console.log('');
  }

  // Print summary
  logger.summary(results);

  const failures = results.filter((r) => r.error);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * Check if the target store already has data and warn the user.
 * This prevents accidentally duplicating data on a store that was already cloned to.
 */
async function prefightCheck(targetApi, targetShop, selectedResources) {
  logger.step('Pre-flight check: scanning target store for existing data...');

  const warnings = [];
  const selectedKeys = selectedResources.map((r) => r.key);

  try {
    if (selectedKeys.includes('products')) {
      const { data } = await targetApi.get('/products/count.json');
      if (data.count > 0) {
        warnings.push(`  Products: ${data.count} already exist — cloning will create duplicates`);
      }
    }

    if (selectedKeys.includes('pages')) {
      const { data } = await targetApi.get('/pages/count.json');
      if (data.count > 0) {
        warnings.push(`  Pages: ${data.count} already exist — cloning will create duplicates`);
      }
    }

    if (selectedKeys.includes('collections')) {
      const { data: cc } = await targetApi.get('/custom_collections/count.json');
      const { data: sc } = await targetApi.get('/smart_collections/count.json');
      const total = (cc.count || 0) + (sc.count || 0);
      if (total > 0) {
        warnings.push(`  Collections: ${total} already exist — cloning will create duplicates`);
      }
    }

    if (selectedKeys.includes('redirects')) {
      const { data } = await targetApi.get('/redirects/count.json');
      if (data.count > 0) {
        warnings.push(`  Redirects: ${data.count} already exist — cloning may create conflicts`);
      }
    }
  } catch {
    // If count endpoints fail, skip pre-flight (non-critical)
    logger.verbose('Pre-flight count check failed for some resources (non-critical)');
  }

  if (warnings.length > 0) {
    logger.warn(`Target store (${targetShop}) already has data:`);
    for (const w of warnings) {
      console.log(w);
    }
    logger.warn('Running the clone again will create DUPLICATE items. Consider using --skip or clearing the target store first.');
  } else {
    logger.success('Target store looks clean — no existing data detected for selected resources');
  }
}

/**
 * Prompt the user for confirmation. Returns true if they type 'y' or 'yes'.
 */
function promptConfirmation(message) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(message, (answer) => {
      rl.close();
      const normalized = (answer || '').trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Filter resources based on --only and --skip flags.
 */
function filterResources(allResources, options) {
  let resources = [...allResources];

  if (options.only) {
    const onlyKeys = options.only.split(',').map((s) => s.trim());
    resources = resources.filter((r) => onlyKeys.includes(r.key));
    if (resources.length === 0) {
      throw new Error(
        `No matching resources for --only "${options.only}". ` +
        `Available: ${allResources.map((r) => r.key).join(', ')}`
      );
    }
  }

  if (options.skip) {
    const skipKeys = options.skip.split(',').map((s) => s.trim());
    resources = resources.filter((r) => !skipKeys.includes(r.key));
  }

  return resources;
}
