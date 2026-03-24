import { logger } from '../logger.js';

export const name = 'Script Tags';
export const key = 'script_tags';

/**
 * Clone script tags from source to target store.
 */
export async function clone(sourceApi, targetApi, options) {
  const scriptTags = await sourceApi.getAll('/script_tags.json', 'script_tags');
  logger.info(`Found ${scriptTags.length} script tags in source store`);

  if (options.dryRun) {
    return { count: scriptTags.length };
  }

  let cloned = 0;

  for (const tag of scriptTags) {
    try {
      const payload = {
        event: tag.event,
        src: tag.src,
        display_scope: tag.display_scope,
        cache: tag.cache,
      };

      await targetApi.post('/script_tags.json', { script_tag: payload });
      logger.verbose(`Created script tag: ${tag.src}`);
      cloned++;
    } catch (err) {
      logger.error(`Failed to clone script tag "${tag.src}": ${err.message}`);
    }
  }

  logger.success(`Cloned ${cloned}/${scriptTags.length} script tags`);
  return { count: cloned };
}
