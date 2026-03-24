import chalk from 'chalk';

let verboseMode = false;

export const logger = {
  setVerbose(enabled) {
    verboseMode = enabled;
  },

  info(msg) {
    console.log(chalk.blue('ℹ'), msg);
  },

  success(msg) {
    console.log(chalk.green('✓'), msg);
  },

  warn(msg) {
    console.log(chalk.yellow('⚠'), msg);
  },

  error(msg) {
    console.log(chalk.red('✗'), msg);
  },

  verbose(msg) {
    if (verboseMode) {
      console.log(chalk.gray('  →'), chalk.gray(msg));
    }
  },

  step(msg) {
    console.log(chalk.cyan('►'), chalk.bold(msg));
  },

  divider() {
    console.log(chalk.gray('─'.repeat(60)));
  },

  /**
   * Print a summary table of clone results.
   */
  summary(results) {
    console.log('');
    logger.divider();
    console.log(chalk.bold('  Clone Summary'));
    logger.divider();

    for (const result of results) {
      const icon = result.error ? chalk.red('✗') : chalk.green('✓');
      const name = result.name.padEnd(22);
      if (result.error) {
        console.log(`  ${icon} ${name} ${chalk.red('FAILED')}: ${result.error}`);
      } else if (result.skipped) {
        console.log(`  ${chalk.gray('–')} ${chalk.gray(name)} ${chalk.gray('SKIPPED')}`);
      } else {
        const count = result.count !== undefined ? chalk.white(`(${result.count} items)`) : '';
        console.log(`  ${icon} ${name} ${chalk.green('OK')} ${count}`);
      }
    }

    logger.divider();

    const succeeded = results.filter((r) => !r.error && !r.skipped).length;
    const failed = results.filter((r) => r.error).length;
    const skipped = results.filter((r) => r.skipped).length;

    console.log(
      `  ${chalk.green(`${succeeded} succeeded`)}` +
      (failed > 0 ? `, ${chalk.red(`${failed} failed`)}` : '') +
      (skipped > 0 ? `, ${chalk.gray(`${skipped} skipped`)}` : '')
    );
    console.log('');
  },
};
