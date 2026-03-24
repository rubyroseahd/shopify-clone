import { logger } from '../logger.js';

export const name = 'Pages';
export const key = 'pages';

/**
 * Clone pages from source to target store.
 */
export async function clone(sourceApi, targetApi, options) {
  const pages = await sourceApi.getAll('/pages.json', 'pages');
  logger.info(`Found ${pages.length} pages in source store`);

  if (options.dryRun) {
    return { count: pages.length };
  }

  let cloned = 0;

  for (const page of pages) {
    try {
      const payload = {
        title: page.title,
        body_html: page.body_html,
        handle: page.handle,
        author: page.author,
        template_suffix: page.template_suffix,
        published: page.published_at ? true : false,
      };

      await targetApi.post('/pages.json', { page: payload });
      logger.verbose(`Created page "${page.title}"`);
      cloned++;
    } catch (err) {
      logger.error(`Failed to clone page "${page.title}": ${err.message}`);
    }
  }

  logger.success(`Cloned ${cloned}/${pages.length} pages`);
  return { count: cloned };
}
