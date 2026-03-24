import { logger } from '../logger.js';

export const name = 'Products';
export const key = 'products';

/**
 * Clone products with their variants, images, and metafields from source to target.
 */
export async function clone(sourceApi, targetApi, options) {
  const products = await sourceApi.getAll('/products.json', 'products');
  logger.info(`Found ${products.length} products in source store`);

  if (options.dryRun) {
    return { count: products.length };
  }

  let cloned = 0;

  for (const product of products) {
    try {
      // Fetch product metafields
      const metafields = await fetchMetafields(sourceApi, product.id);
      logger.verbose(`Product "${product.title}" has ${metafields.length} metafields`);

      // Fetch variant metafields
      const variantMetafields = new Map();
      for (const variant of product.variants || []) {
        const vmf = await fetchVariantMetafields(sourceApi, product.id, variant.id);
        if (vmf.length > 0) {
          variantMetafields.set(variant.id, vmf);
          logger.verbose(`Variant "${variant.title}" has ${vmf.length} metafields`);
        }
      }

      // Prepare product payload for creation
      const payload = buildProductPayload(product);

      // Create product on target
      const created = await targetApi.post('/products.json', { product: payload });
      const createdProduct = created.product;
      logger.verbose(`Created product "${createdProduct.title}" (ID: ${createdProduct.id})`);

      // Create product metafields on target
      for (const mf of metafields) {
        await createMetafield(targetApi, `/products/${createdProduct.id}/metafields.json`, mf);
      }

      // Create variant metafields on target
      // Map source variant positions to target variant IDs
      if (createdProduct.variants && variantMetafields.size > 0) {
        const sourceVariants = product.variants || [];
        const targetVariants = createdProduct.variants || [];

        for (let i = 0; i < sourceVariants.length && i < targetVariants.length; i++) {
          const sourceMfs = variantMetafields.get(sourceVariants[i].id);
          if (sourceMfs) {
            for (const mf of sourceMfs) {
              await createMetafield(
                targetApi,
                `/variants/${targetVariants[i].id}/metafields.json`,
                mf
              );
            }
          }
        }
      }

      cloned++;
    } catch (err) {
      logger.error(`Failed to clone product "${product.title}": ${err.message}`);
      logger.verbose(err.stack);
    }
  }

  logger.success(`Cloned ${cloned}/${products.length} products`);
  return { count: cloned };
}

/**
 * Fetch metafields for a product.
 */
async function fetchMetafields(api, productId) {
  try {
    const { data } = await api.get(`/products/${productId}/metafields.json`);
    return data.metafields || [];
  } catch {
    return [];
  }
}

/**
 * Fetch metafields for a variant.
 */
async function fetchVariantMetafields(api, productId, variantId) {
  try {
    const { data } = await api.get(`/products/${productId}/variants/${variantId}/metafields.json`);
    return data.metafields || [];
  } catch {
    return [];
  }
}

/**
 * Create a metafield on the target store.
 */
async function createMetafield(api, path, metafield) {
  try {
    await api.post(path, {
      metafield: {
        namespace: metafield.namespace,
        key: metafield.key,
        value: metafield.value,
        type: metafield.type,
      },
    });
  } catch (err) {
    logger.verbose(`Failed to create metafield ${metafield.namespace}.${metafield.key}: ${err.message}`);
  }
}

/**
 * Build a clean product payload for creation, stripping source-specific IDs.
 */
function buildProductPayload(product) {
  const payload = {
    title: product.title,
    body_html: product.body_html,
    vendor: product.vendor,
    product_type: product.product_type,
    handle: product.handle,
    tags: product.tags,
    status: product.status,
    template_suffix: product.template_suffix,
    published_scope: product.published_scope,
  };

  // Include variants without source IDs
  if (product.variants) {
    payload.variants = product.variants.map((v) => ({
      title: v.title,
      price: v.price,
      sku: v.sku,
      position: v.position,
      inventory_policy: v.inventory_policy,
      compare_at_price: v.compare_at_price,
      fulfillment_service: v.fulfillment_service,
      inventory_management: v.inventory_management,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      taxable: v.taxable,
      barcode: v.barcode,
      grams: v.grams,
      weight: v.weight,
      weight_unit: v.weight_unit,
      requires_shipping: v.requires_shipping,
    }));
  }

  // Include images by source URL (Shopify will re-host them)
  if (product.images) {
    payload.images = product.images.map((img) => ({
      src: img.src,
      alt: img.alt,
      position: img.position,
    }));
  }

  // Include options
  if (product.options) {
    payload.options = product.options.map((opt) => ({
      name: opt.name,
      position: opt.position,
      values: opt.values,
    }));
  }

  return payload;
}
