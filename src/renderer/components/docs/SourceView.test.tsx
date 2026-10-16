import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceView } from './SourceView';

describe('SourceView', () => {
  it('numbers lines, counting CRLF like LF', () => {
    const { container } = render(<SourceView text={'a\r\nb\r\nc'} />);
    const lines = container.querySelectorAll('.src-line');
    expect(lines).toHaveLength(3);
    expect(lines[1].getAttribute('data-line')).toBe('2');
    expect(lines[1].textContent).toContain('b');
  });
  it('highlights the given line', () => {
    const { container } = render(
      <SourceView text={'a\nb'} highlightLine={2} />,
    );
    expect(
      container.querySelector('.src-line.is-hl')?.getAttribute('data-line'),
    ).toBe('2');
  });
});
