#!/usr/bin/env node
// mostajs-monitor-scaffold — standalone CLI for scaffoldMonitorService().
// Author: Dr Hamid MADANI drmdh@msn.com

import { scaffoldMonitorService } from './scaffold.js';

const argv = process.argv.slice(2);
const val = (name: string, def?: string) => {
  const i = argv.indexOf('--' + name);
  return i < 0 ? def : (argv[i + 1] ?? def);
};
const has = (name: string) => argv.includes('--' + name);

if (has('help') || has('h')) {
  console.log(`
  mostajs-monitor-scaffold — emit services/monitor.mjs into a project

    --dir      <path>    project root                (default: cwd)
    --path     <path>    output file relative to dir (default: services/monitor.mjs)
    --force              overwrite if it exists
    --dry-run            print what would be written, don't touch disk
`);
  process.exit(0);
}

const r = scaffoldMonitorService({
  projectDir:  val('dir'),
  servicePath: val('path'),
  force:       has('force'),
  dryRun:      has('dry-run'),
});

if (r.action === 'dry-run') {
  console.log(`[dry-run] would write ${r.path} (${r.content.length} bytes)`);
  console.log(r.content.split('\n').slice(0, 25).join('\n'));
} else if (r.wrote) {
  console.log(`✓ ${r.action} : ${r.path}`);
  console.log(`\nNext : add to package.json scripts :`);
  console.log(`  "monitor": "node ${r.path.replace(/^.*\/(?=services)/, '')}"`);
} else {
  console.log(`• ${r.action} : ${r.path}  (use --force to overwrite)`);
}
