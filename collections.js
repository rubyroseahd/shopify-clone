import { logger } from '../logger.js';

export const name = 'Collections';
export const key = 'collections';

/**
 * Clone custom collections and smart collections from source to target.
 * Re-associates products via collects for custom collections.
 */
export async function clone(sourceApi, targetApi, options) {
  let totalCloned = 0;

  // --- Custom Collections ---
  const customCollections = await sourceApi.getAll(
    '/custom_collections.json',
    'custom_collections'
  );
  logger.info(`Found ${customCollections.length} custom collections`);

  if (!options.dryRun) {
    // Fetch all collects from source to map products to collections
    const collects = await sourceApi.getAll('/collects.json', 'collects');

    // Build a mapping of source product handles to target product IDs
    // We need this to re-associate products in target collections
    const targetProducts = await targetApi.getAll('/products.json', 'products');
    const handleToTargetId = new Map();
    for (const p of targetProducts) {
      handleToTargetId.set(p.handle, p.id);
    }

    // Build source product ID to handle mapping
    const sourceProducts = await sourceApi.getAll('/products.json', 'products');
    const sourceIdToHandle = new Map();
    for (const p of sourceProducts) {
      sourceIdToHandle.set(p.id, p.handle);
    }

    for (const collection of customCollections) {
      try {
        const payload = {
          title: collection.title,
          body_html: collection.body_html,
          handle: collection.handle,
          sort_order: collection.sort_order,
          template_suffix: collection.template_suffix,
          published: collection.published,
        };

        if (collection.image && collection.image.src) {
          payload.image = { src: collection.image.src, alt: collection.image.alt };
        }

        const created = await targetApi.post('/custom_collections.json', {
          custom_collection: payload,
        });
        const targetCollectionId = created.custom_collection.id;
        logger.verbose(`Created custom collection "${collection.title}"`);

        // Re-associate products via collects
        const collectionCollects = collects.filter(
          (c) => c.collection_id === collection.id
        );
        for (const collect of collectionCollects) {
          const handle = sourceIdToHandle.get(collect.product_id);
          const targetProductId = handle ? handleToTargetId.get(handle) : null;
          if (targetProductId) {
            try {
              await targetApi.post('/collects.json', {
                collect: {
                  product_id: targetProductId,
                  collection_id: targetCollectionId,
                  position: collect.position,
                  sort_value: collect.sort_value,
                },
              });
            } catch (err) {
              logger.verbose(`Failed to add product to collection: ${err.message}`);
            }
          }
        }

        totalCloned++;
      } catch (err) {
        logger.error(`Failed to clone custom collection "${collection.title}": ${err.message}`);
      }
    }
  }

  // --- Smart Collections ---
  const smartCollections = await sourceApi.getAll(
    '/smart_collections.json',
    'smart_collections'
  );
  logger.info(`Found ${smartCollections.length} smart collections`);

  if (!options.dryRun) {
    for (const collection of smartCollections) {
      try {
        const payload = {
          title: collection.title,
          body_html: collection.body_html,
          handle: collection.handle,
          sort_order: collection.sort_order,
          template_suffix: collection.template_suffix,
          published: collection.published,
          disjunctive: collection.disjunctive,
          rules: collection.rules,
        };

        if (collection.image && collection.image.src) {
          payload.image = { src: collection.image.src, alt: collection.image.alt };
        }

        await targetApi.post('/smart_collections.json', { smart_collection: payload });
        logger.verbose(`Created smart collection "${collection.title}"`);
        totalCloned++;
      } catch (err) {
        logger.error(`Failed to clone smart collection "${collection.title}": ${err.message}`);
      }
    }
  }

  const totalFound = customCollections.length + smartCollections.length;
  if (options.dryRun) {
    return { count: totalFound };
  }

  logger.success(`Cloned ${totalCloned}/${totalFound} collections`);
  return { count: totalCloned };
}
