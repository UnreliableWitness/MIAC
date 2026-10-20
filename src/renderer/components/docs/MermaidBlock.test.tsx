import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setTestColorScheme } from '../../testColorScheme';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg></svg>' })),
}));
vi.mock('mermaid', () => ({ default: mermaid }));

import { MermaidBlock } from './MermaidBlock';

describe('MermaidBlock colour scheme', () => {
  it('renders with the light theme in light, and re-renders dark on a switch', async () => {
    setTestColorScheme('light');
    render(<MermaidBlock code="graph TD; A-->B" />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'default', securityLevel: 'strict' }),
    );
    act(() => setTestColorScheme('dark'));
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );
  });
});
