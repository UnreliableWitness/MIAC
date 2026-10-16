import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeLines } from './rehypeLines';

describe('rehypeLines', () => {
  it('marks block elements with their source lines', () => {
    const md = '# Title\n\npara one\nstill one\n\n| a |\n|---|\n| b |\n';
    const { container } = render(
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeLines]}>
        {md}
      </Markdown>,
    );
    expect(container.querySelector<HTMLElement>('h1')?.dataset).toMatchObject({
      lineStart: '1',
      lineEnd: '1',
    });
    expect(container.querySelector<HTMLElement>('p')?.dataset).toMatchObject({
      lineStart: '3',
      lineEnd: '4',
    });
    expect(
      container.querySelector<HTMLElement>('tbody tr')?.dataset,
    ).toMatchObject({ lineStart: '8', lineEnd: '8' });
  });
});
