// src/renderer/components/review/CommentCard.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewComment } from '../../../shared/review';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { CommentBox, CommentCard } from './CommentCard';

const base: ReviewComment = {
  id: 'c1',
  workspaceId: 'home',
  path: 'src/a.ts',
  side: 'after',
  startLine: 3,
  endLine: 4,
  snippet: 'x()\ny()',
  contextBefore: '',
  contextAfter: '',
  text: 'Use **the cache**',
  status: 'open',
  createdAt: '2026-10-17T10:00:00.000Z',
  sentAt: null,
  resolvedAt: null,
};

describe('CommentBox', () => {
  it('saves trimmed text with the button or Ctrl/Cmd+Enter, and cancels with Escape', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<CommentBox onSave={onSave} onCancel={onCancel} />);
    const box = screen.getByRole('textbox', { name: 'Comment' });
    expect(
      (screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(box, { target: { value: '  fix it  ' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('fix it');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('keeps its text with the owner when it is controlled', () => {
    const onSave = vi.fn();
    function Owner() {
      const [text, setText] = useState('draft');
      return (
        <CommentBox
          value={text}
          onChange={setText}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      );
    }
    render(<Owner />);
    const box = screen.getByRole('textbox', {
      name: 'Comment',
    }) as HTMLTextAreaElement;
    expect(box.value).toBe('draft');
    fireEvent.change(box, { target: { value: 'draft two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(onSave).toHaveBeenCalledWith('draft two');
  });
});

describe('CommentCard', () => {
  it('renders Markdown and its lines, and resolves', () => {
    const onResolve = vi.fn();
    render(
      <CommentCard
        comment={base}
        onEdit={vi.fn()}
        onResolve={onResolve}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('the cache').tagName).toBe('STRONG');
    expect(screen.getByText('Lines 3-4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onResolve).toHaveBeenCalled();
  });

  it('shows sent, and outdated with the old lines', () => {
    const { rerender } = render(
      <CommentCard
        comment={{
          ...base,
          status: 'sent',
          sentAt: '2026-10-17T10:05:00.000Z',
        }}
        onEdit={vi.fn()}
        onResolve={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/^Sent/)).toBeTruthy();
    rerender(
      <CommentCard
        comment={{
          ...base,
          status: 'outdated',
          sentAt: '2026-10-17T10:05:00.000Z',
        }}
        onEdit={vi.fn()}
        onResolve={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Code changed, probably addressed')).toBeTruthy();
    expect(screen.getByText(/x\(\)/)).toBeTruthy();
  });

  it('never navigates the app window from a link: web links open outside, others are text', async () => {
    const api = installFakeApi({ 'links:open': () => undefined });
    render(
      <CommentCard
        comment={{
          ...base,
          text: 'See [notes](docs/plan.md) and [the docs](https://example.com/x)',
        }}
        onEdit={vi.fn()}
        onResolve={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('notes').closest('a')).toBeNull();
    const web = screen.getByText('the docs').closest('a') as HTMLAnchorElement;
    // fireEvent returns false when the default (following the href) was prevented.
    expect(fireEvent.click(web)).toBe(false);
    await vi.waitFor(() =>
      expect(api.calls.find((c) => c.channel === 'links:open')?.args).toEqual([
        'https://example.com/x',
      ]),
    );
  });

  it('edits in place', () => {
    const onEdit = vi.fn();
    render(
      <CommentCard
        comment={base}
        onEdit={onEdit}
        onResolve={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'new text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('new text');
  });
});
