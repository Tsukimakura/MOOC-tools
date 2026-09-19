#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((error) => {
  console.error(`错误：${error.message}`);
  if (process.env.MOOC_NOTES_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
