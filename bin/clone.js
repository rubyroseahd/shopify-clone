#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { runClone } from '../clone.js';

const program = new Command();

program
  .name('shopify-clone')
  .description('Clone data from a production Shopify store to a development store')
  .option('--dry-run', 'Preview what would be cloned without making any changes')
  .option('--only <resources>', 'Comma-separated list of resources to clone (e.g. products,pages)')
  .option('--skip <resources>', 'Comma-separated list of resources to skip (e.g. theme)')
  .option('--verbose', 'Show detailed output for each API call')
  .option('-y, --yes', 'Skip confirmation prompt (for scripted/automated use)')
  .parse(process.argv);

const opts = program.opts();

const authMethod = process.env.AUTH_METHOD || 'client_credentials';

const config = {
  authMethod,
  sourceShop: process.env.SOURCE_SHOP,
  targetShop: process.env.TARGET_SHOP,

  // client_credentials auth
  sourceClientId: process.env.SOURCE_CLIENT_ID,
  sourceClientSecret: process.env.SOURCE_CLIENT_SECRET,
  targetClientId: process.env.TARGET_CLIENT_ID,
  targetClientSecret: process.env.TARGET_CLIENT_SECRET,

  // static token auth
  sourceToken: process.env.SOURCE_ACCESS_TOKEN,
  targetToken: process.env.TARGET_ACCESS_TOKEN,

  options: {
    dryRun: opts.dryRun || false,
    only: opts.only || null,
    skip: opts.skip || null,
    verbose: opts.verbose || false,
    yes: opts.yes || false,
  },
};

runClone(config).catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
