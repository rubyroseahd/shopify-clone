import { logger } from '../logger.js';

export const name = 'Theme';
export const key = 'theme';

/**
 * Clone the active (published) theme from source to target store.
 * Creates a new theme on the target and copies all assets.
 */
export async function clone(sourceApi, targetApi, options) {
  // Find the active theme on the source store
  const { data: themesData } = await sourceApi.get('/themes.json');
  const themes = themesData.themes || [];
  const activeTheme = themes.find((t) => t.role === 'main');

  if (!activeTheme) {
    logger.warn('No active theme found on source store');
    return { count: 0 };
  }

  logger.info(`Found active theme: "${activeTheme.name}"`);

  // List all assets in the source theme
  const { data: assetsData } = await sourceApi.get(
    `/themes/${activeTheme.id}/assets.json`
  );
  const assetList = assetsData.assets || [];
  logger.info(`Theme has ${assetList.length} assets`);

  if (options.dryRun) {
    return { count: assetList.length };
  }

  // Create a new theme on target (unpublished so it doesn't disrupt the live store)
  const themePayload = {
    name: `${activeTheme.name} (Cloned)`,
    role: 'unpublished',
  };

  const created = await targetApi.post('/themes.json', { theme: themePayload });
  const targetThemeId = created.theme.id;
  logger.info(`Created target theme "${created.theme.name}" (ID: ${targetThemeId})`);

  let cloned = 0;
  let failed = 0;

  // Copy each asset individually
  for (const asset of assetList) {
    try {
      // Fetch the full asset content from source
      const { data: assetData } = await sourceApi.get(
        `/themes/${activeTheme.id}/assets.json`,
        { 'asset[key]': asset.key }
      );
      const sourceAsset = assetData.asset;

      // Build the asset payload for the target
      const assetPayload = { key: sourceAsset.key };

      if (sourceAsset.attachment) {
        // Binary asset (image, font, etc.) — use base64 attachment field
        assetPayload.attachment = sourceAsset.attachment;
      } else if (sourceAsset.value !== undefined && sourceAsset.value !== null) {
        // Text asset (Liquid, CSS, JS, JSON, etc.)
        assetPayload.value = sourceAsset.value;
      } else {
        logger.verbose(`Skipping asset with no value/attachment: ${asset.key}`);
        continue;
      }

      await targetApi.put(`/themes/${targetThemeId}/assets.json`, {
        asset: assetPayload,
      });
      logger.verbose(`Copied asset: ${asset.key}`);
      cloned++;
    } catch (err) {
      logger.verbose(`Failed to copy asset "${asset.key}": ${err.message}`);
      failed++;
    }
  }

  logger.success(`Cloned theme with ${cloned}/${assetList.length} assets (${failed} failed)`);
  return { count: cloned };
}
