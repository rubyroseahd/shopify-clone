import { logger } from '../logger.js';

export const name = 'Redirects';
export const key = 'redirects';

/**
 * Clone URL redirects from source to target store.
 */
export async function clone(sourceApi, targetApi, options) {
  const redirects = await sourceApi.getAll('/redirects.json', 'redirects');
  logger.info(`Found ${redirects.length} redirects in source store`);

  if (options.dryRun) {
    return { count: redirects.length };
  }

  let cloned = 0;

  for (const redirect of redirects) {
    try {
      const payload = {
        path: redirect.path,
        target: redirect.target,
      };

      await targetApi.post('/redirects.json', { redirect: payload });
      logger.verbose(`Created redirect: ${redirect.path} → ${redirect.target}`);
      cloned++;
    } catch (err) {
      logger.error(`Failed to clone redirect "${redirect.path}": ${err.message}`);
    }
  }

  logger.success(`Cloned ${cloned}/${redirects.length} redirects`);
  return { count: cloned };
}
