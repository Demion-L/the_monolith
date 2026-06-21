/* eslint-disable no-console */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { promptProjectConfig } from './prompts.js';
import { scaffoldInstance } from './scaffold.js';
export async function runInit(options = { targetDir: process.cwd() }) {
    const targetDir = resolve(options.targetDir);
    console.log('  Initializing MONOLITH instance...');
    // Check for existing instance
    const monolithDir = resolve(targetDir, '.monolith');
    if (existsSync(monolithDir)) {
        console.log('');
        console.log('  ⚠  .monolith/ already exists.');
        console.log('     Proceeding will overwrite existing files.');
        console.log('');
    }
    let config;
    if (options.yes) {
        // Non-interactive: use all defaults
        const { basename } = await import('path');
        config = {
            projectName: basename(targetDir),
            language: 'typescript',
            packageManager: 'pnpm',
            aiTool: 'claude',
            finalizationProtocol: 'finalize-story',
            protocols: ['finalize-story', 'failure-memory-logging', 'governance-evaluation', 'integrity-verification'],
            monolithRoot: '.monolith',
        };
        console.log(`  Project:  ${config.projectName} (defaults applied)`);
        console.log('');
    }
    else {
        config = await promptProjectConfig();
    }
    console.log('  Scaffolding instance...');
    console.log('');
    const result = await scaffoldInstance(targetDir, config);
    console.log('');
    console.log('  ✅ MONOLITH instance initialized!');
    console.log('');
    console.log(`  Project:       ${config.projectName}`);
    console.log(`  Root:          ${config.monolithRoot}/`);
    console.log(`  Files created: ${result.filesCreated}`);
    console.log('');
    console.log('  Next steps:');
    console.log('    1. Edit AGENTS.md — add project description');
    console.log(`    2. Edit ${config.monolithRoot}/context/maps/project-map.md — describe your structure`);
    console.log(`    3. Edit ${config.monolithRoot}/context/maps/roadmap-index.md — add your phases`);
    console.log(`    4. Edit ${config.monolithRoot}/protocols/governance/core-invariants.md — set Current Focus`);
    console.log(`    5. Add tech stack protocols: ${config.monolithRoot}/protocols/engineering/`);
    console.log(`    6. Start first story: edit ${config.monolithRoot}/memory/working/active.md`);
    console.log('');
}
