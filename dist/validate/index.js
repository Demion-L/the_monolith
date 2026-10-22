/* eslint-disable no-console */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import { checkProjectFile, readConfigFile, readProjectFile, resolveMonolithRoot, RootContainmentError, } from '../root/index.js';
const DEFINITION_FILE_NAME = 'project.definition.mjs';
const REQUIRED_DIRS = ['memory', 'context', 'protocols', 'skills', 'governance', 'learning', 'tests'];
// Only flag variables that init is responsible for substituting.
// User-facing content placeholders (e.g. {{PLAN_TITLE}}) are intentional and must not be flagged.
const INIT_VARS = new Set([
    'PROJECT_NAME', 'LANGUAGE', 'PACKAGE_MANAGER', 'AI_TOOL',
    'MONOLITH_ROOT', 'FINALIZATION_PROTOCOL', 'PROTOCOLS_JSON',
    'MISTAKE_ROOTS_JSON', 'DRIFT_LOG_PATH',
]);
const INIT_PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;
const COL_WIDTH = 16;
/**
 * Static configuration check (SEC-002). `project.definition.mjs` is a
 * project-controlled file: it is NEVER imported, evaluated or parsed as
 * JavaScript here. It is only checked as a file — present, inside the
 * project, regular, non-empty, at most 1 MiB. A PASS therefore says nothing
 * about its syntax, its exports or what it would do if executed.
 */
function checkConfiguration(targetDir) {
    const config = readConfigFile(targetDir);
    if (config.status === 'absent') {
        return { label: 'Configuration', passed: false, error: 'missing monolith.config.json' };
    }
    if (config.status === 'unreadable') {
        return { label: 'Configuration', passed: false, error: `monolith.config.json cannot be read safely: ${config.detail}` };
    }
    if (config.status !== 'ok') {
        return { label: 'Configuration', passed: false, error: 'monolith.config.json is not valid JSON' };
    }
    const def = checkProjectFile(targetDir, DEFINITION_FILE_NAME);
    if (!def.ok) {
        const error = def.code === 'FILE_MISSING'
            ? `missing ${DEFINITION_FILE_NAME}`
            : `${DEFINITION_FILE_NAME} rejected (${def.code}): ${def.detail}`;
        return { label: 'Configuration', passed: false, error };
    }
    if (!Object.prototype.hasOwnProperty.call(config.cfg, 'monolithRoot')) {
        return { label: 'Configuration', passed: false, error: 'monolith.config.json missing monolithRoot field' };
    }
    try {
        resolveMonolithRoot(targetDir, config);
    }
    catch (err) {
        if (err instanceof RootContainmentError) {
            return { label: 'Configuration', passed: false, error: err.message };
        }
        throw err;
    }
    return {
        label: 'Configuration',
        passed: true,
        note: `${DEFINITION_FILE_NAME} checked as a file only (present, inside project, regular, non-empty, <= 1 MiB); not parsed or executed`,
    };
}
function checkInstance(targetDir, monolithRoot) {
    const instanceDir = join(targetDir, monolithRoot);
    if (!existsSync(instanceDir)) {
        return { label: 'Instance', passed: false, error: `missing ${monolithRoot}/` };
    }
    for (const dir of REQUIRED_DIRS) {
        if (!existsSync(join(instanceDir, dir))) {
            return { label: 'Instance', passed: false, error: `missing ${monolithRoot}/${dir}/` };
        }
    }
    return { label: 'Instance', passed: true };
}
function walkFiles(dir) {
    const results = [];
    if (!existsSync(dir))
        return results;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
            continue; // never follow links out of the instance (SEC-001A)
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(full));
        }
        else {
            results.push(full);
        }
    }
    return results;
}
function hasUnreplacedInitVars(content) {
    let match;
    INIT_PLACEHOLDER_RE.lastIndex = 0;
    while ((match = INIT_PLACEHOLDER_RE.exec(content)) !== null) {
        if (INIT_VARS.has(match[1]))
            return true;
    }
    return false;
}
function checkTemplates(targetDir, monolithRoot) {
    const violations = [];
    const instanceDir = join(targetDir, monolithRoot);
    for (const file of walkFiles(instanceDir)) {
        if (file.endsWith('.gitkeep'))
            continue;
        try {
            const content = readFileSync(file, 'utf8');
            if (hasUnreplacedInitVars(content)) {
                violations.push(relative(targetDir, file));
            }
        }
        catch {
            // binary or unreadable — skip
        }
    }
    const unsafe = [];
    for (const rootFile of [DEFINITION_FILE_NAME, 'monolith.config.json', 'AGENTS.md']) {
        // Bounded, containment-checked read (SEC-002): never blocks on a FIFO,
        // never reads a device, never follows a link out of the project.
        const read = readProjectFile(targetDir, rootFile, { allowEmpty: true });
        if (!read.ok) {
            if (read.code !== 'FILE_MISSING')
                unsafe.push(`${rootFile} (${read.code})`);
            continue;
        }
        if (hasUnreplacedInitVars(read.content)) {
            violations.push(rootFile);
        }
    }
    if (unsafe.length > 0) {
        return { label: 'Templates', passed: false, error: `cannot safely read: ${unsafe.join(', ')}` };
    }
    if (violations.length > 0) {
        return {
            label: 'Templates',
            passed: false,
            error: `unreplaced placeholders in ${violations.length} file(s): ${violations.slice(0, 3).join(', ')}${violations.length > 3 ? ` (+${violations.length - 3} more)` : ''}`,
        };
    }
    return { label: 'Templates', passed: true };
}
function formatRow(result) {
    const label = result.label.padEnd(COL_WIDTH);
    const status = result.passed ? 'PASS' : 'FAIL';
    const tail = result.error ? `  ${result.error}` : '';
    return `${label}${status}${tail}`;
}
export async function runValidate(options) {
    const targetDir = resolve(options.targetDir);
    const quiet = options.quiet ?? false;
    // Containment failures are reported by checkConfiguration; the instance
    // and template checks must not touch a root that failed resolution.
    let monolithRoot = null;
    try {
        monolithRoot = resolveMonolithRoot(targetDir).monolithRoot;
    }
    catch (err) {
        if (!(err instanceof RootContainmentError))
            throw err;
    }
    const configResult = checkConfiguration(targetDir);
    const instanceResult = monolithRoot === null
        ? { label: 'Instance', passed: false, error: 'skipped: monolithRoot failed validation' }
        : checkInstance(targetDir, monolithRoot);
    const templateResult = monolithRoot === null
        ? { label: 'Templates', passed: false, error: 'skipped: monolithRoot failed validation' }
        : checkTemplates(targetDir, monolithRoot);
    const results = [configResult, instanceResult, templateResult];
    const passed = results.every((r) => r.passed);
    if (quiet) {
        if (!passed) {
            for (const r of results) {
                if (!r.passed)
                    console.log(formatRow(r));
            }
        }
    }
    else {
        console.log('');
        console.log('MONOLITH validate');
        console.log('');
        for (const r of results) {
            console.log(formatRow(r));
        }
        console.log('');
        console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);
        if (configResult.passed && configResult.note)
            console.log(`Note: ${configResult.note}`);
        console.log('');
    }
    process.exit(passed ? 0 : 1);
}
