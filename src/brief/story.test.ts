import { describe, it, expect } from 'vitest';
import { extractCurrentStory } from './story.js';

describe('extractCurrentStory', () => {
  it('extracts the body between the Current Story heading and the next heading', () => {
    const content = [
      '# Active Working Memory',
      '',
      '## Active Phase',
      '',
      'No active phase.',
      '',
      '## Current Story',
      '',
      'Working on CONTEXT-001A.',
      '',
      '## Last Finalization',
      '',
      'Something else.',
    ].join('\n');

    const result = extractCurrentStory(content);
    expect(result.hasCurrentStorySection).toBe(true);
    expect(result.excerpt).toBe('Working on CONTEXT-001A.');
    expect(result.lineRange).toBe('9-9');
  });

  it('stops at a `---` separator when no further heading exists first', () => {
    const content = ['## Current Story', '', 'Line one.', 'Line two.', '', '---', '', 'trailer'].join('\n');
    const result = extractCurrentStory(content);
    expect(result.excerpt).toBe('Line one.\nLine two.');
    expect(result.lineRange).toBe('3-4');
  });

  it('captures to end of file when there is no following boundary', () => {
    const content = ['## Current Story', '', 'Only this.'].join('\n');
    const result = extractCurrentStory(content);
    expect(result.excerpt).toBe('Only this.');
  });

  it('reports an explicitly empty section when the heading has no body', () => {
    const content = ['## Current Story', '', '## Next Section', 'x'].join('\n');
    const result = extractCurrentStory(content);
    expect(result.hasCurrentStorySection).toBe(true);
    expect(result.excerpt).toBe('');
  });

  it('reports absence when the file has no Current Story heading at all', () => {
    const content = ['# Title', '', '## Something Else', 'content'].join('\n');
    const result = extractCurrentStory(content);
    expect(result.hasCurrentStorySection).toBe(false);
    expect(result.excerpt).toBeNull();
    expect(result.lineRange).toBeNull();
  });

  it('is case-insensitive but requires an exact heading match', () => {
    const content = ['## current story', '', 'Body.'].join('\n');
    expect(extractCurrentStory(content).hasCurrentStorySection).toBe(true);

    const notAMatch = ['## Current Story Details', '', 'Body.'].join('\n');
    expect(extractCurrentStory(notAMatch).hasCurrentStorySection).toBe(false);
  });

  it('does not attempt heuristic Markdown interpretation beyond the heading/rule boundary', () => {
    const content = ['## Current Story', '', '**Bold** _italic_ and a [link](http://x).', '', '## Done'].join('\n');
    const result = extractCurrentStory(content);
    expect(result.excerpt).toBe('**Bold** _italic_ and a [link](http://x).');
  });
});
