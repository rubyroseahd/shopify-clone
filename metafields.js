import { logger } from '../logger.js';

export const name = 'Shop Metafields';
export const key = 'metafields';

/**
 * Clone shop-level metafields from source to target store.
 */
export async function clone(sourceApi, targetApi, options) {
  const metafields = await sourceApi.getAll('/metafields.json', 'metafields');
  logger.info(`Found ${metafields.length} shop metafields in source store`);

  if (options.dryRun) {
    return { count: metafields.length };
  }

  let cloned = 0;

  for (const mf of metafields) {
    try {
      const payload = {
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: mf.type,
      };

      await targetApi.post('/metafields.json', { metafield: payload });
      logger.verbose(`Created metafield: ${mf.namespace}.${mf.key}`);
      cloned++;
    } catch (err) {
      logger.error(`Failed to clone metafield "${mf.namespace}.${mf.key}": ${err.message}`);
    }
  }

  logger.success(`Cloned ${cloned}/${metafields.length} shop metafields`);
  return { count: cloned };
}
