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
  const { sourceShop, sourceToken, targetShop, targetToken, options } = config;

  logger.setVerbose(options.verbose);

  // Validate configuration
  if (!sourceShop || !sourceToken) {
    throw new Error('Missing source store credentials. Set SOURCE_SHOP and SOURCE_ACCESS_TOKEN in .env');
  }
  if (!targetShop || !targetToken) {
    throw new Error('Missing target store credentials. Set TARGET_SHOP and TARGET_ACCESS_TOKEN in .env');
  }

  // Initialize API clients
  const sourceApi = new ShopifyClient(sourceShop, sourceToken);
  const targetApi = new ShopifyClient(targetShop, targetToken);

  // Determine which resources to clone
  const resources = filterResources(ALL_RESOURCES, options);

  logger.divider();
  logger.step(`Shopify Store Clone`);
  logger.info(`Source: ${sourceShop}`);
  logger.info(`Target: ${targetShop}`);
  if (options.dryRun) {
    logger.warn('DRY RUN — no changes will be made to the target store');
  }
  logger.info(`Resources: ${resources.map((r) => r.key).join(', ')}`);
  logger.divider();

  // Note about navigation menus
  logger.warn(
    'Navigation menus are not available via the REST Admin API and will not be cloned. ' +
    'You will need to recreate them manually in the target store admin.'
  );
  console.log('');

  // Run each resource clone sequentially (to respect dependencies)
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

  // Check for any failures
  const failures = results.filter((r) => r.error);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
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
