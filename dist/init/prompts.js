/* eslint-disable no-console */
import { createInterface } from 'readline';
import { basename } from 'path';
function createPrompter() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (question, defaultValue) => new Promise((resolve) => {
        const hint = defaultValue ? ` (${defaultValue})` : '';
        rl.question(`  ${question}${hint}: `, (answer) => {
            resolve(answer.trim() || defaultValue || '');
        });
    });
    const askChoice = (question, choices, defaultChoice) => new Promise((resolve) => {
        const choiceStr = choices.map((c) => (c === defaultChoice ? `[${c}]` : c)).join(' | ');
        rl.question(`  ${question} (${choiceStr}): `, (answer) => {
            const trimmed = answer.trim().toLowerCase();
            if (!trimmed)
                return resolve(defaultChoice);
            const match = choices.find((c) => c.toLowerCase() === trimmed);
            resolve(match ?? defaultChoice);
        });
    });
    return { ask, askChoice, close: () => rl.close() };
}
export async function promptProjectConfig() {
    const p = createPrompter();
    console.log('');
    const projectName = await p.ask('Project name', basename(process.cwd()));
    const language = await p.askChoice('Primary language', ['typescript', 'javascript', 'python', 'other'], 'typescript');
    const packageManager = await p.askChoice('Package manager', ['pnpm', 'npm', 'yarn', 'other'], 'pnpm');
    const aiTool = await p.askChoice('AI assistant tool', ['claude', 'cursor', 'windsurf', 'other'], 'claude');
    p.close();
    console.log('');
    return {
        projectName,
        language,
        packageManager,
        aiTool,
        finalizationProtocol: 'finalize-story',
        protocols: [
            'finalize-story',
            'failure-memory-logging',
            'governance-evaluation',
            'integrity-verification',
        ],
        monolithRoot: '.monolith',
    };
}
