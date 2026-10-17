// src/renderer/components/OpenInEditor.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { OpenInEditor } from './OpenInEditor';

const vs = { id: 'visualstudio', label: 'Visual Studio' } as const;
const code = { id: 'vscode', label: 'VS Code' } as const;
const opened = (calls: { channel: string; args: unknown[] }[]) =>
  calls.filter((c) => c.channel === 'editor:openFolder').map((c) => c.args);

describe('OpenInEditor', () => {
  it('names the chosen editor and opens the folder with it', async () => {
    const { calls } = installFakeApi({
      'editor:options': () => ({
        editors: [code, vs],
        chosen: 'visualstudio',
        solutions: ['App.sln'],
        solution: 'App.sln',
      }),
    });
    render(<OpenInEditor taskId="t1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open in Visual Studio' }),
    );
    expect(opened(calls)).toEqual([['t1', undefined, {}]]);
  });

  it('offers the other editors and the solutions in its menu', async () => {
    const { calls } = installFakeApi({
      'editor:options': () => ({
        editors: [code, vs],
        chosen: 'visualstudio',
        solutions: ['A.sln', 'tools/B.sln'],
        solution: 'A.sln',
      }),
    });
    render(<OpenInEditor taskId="t1" workspaceId="w2" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'More ways to open' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open B.sln' }));
    fireEvent.click(screen.getByRole('button', { name: 'More ways to open' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in VS Code' }));
    expect(opened(calls)).toEqual([
      ['t1', 'w2', { solution: 'tools/B.sln' }],
      ['t1', 'w2', { editorId: 'vscode' }],
    ]);
  });

  it('says when no editor is found', async () => {
    installFakeApi({
      'editor:options': () => ({
        editors: [],
        chosen: null,
        solutions: [],
        solution: null,
      }),
    });
    render(<OpenInEditor taskId="t1" />);
    expect(
      await screen.findByRole('button', { name: 'No editor found' }),
    ).toBeTruthy();
  });

  it('loads the options again when it becomes visible', async () => {
    let chosen: 'vscode' | 'visualstudio' = 'vscode';
    installFakeApi({
      'editor:options': () => ({
        editors: [code, vs],
        chosen,
        solutions: [],
        solution: null,
      }),
    });
    const { rerender } = render(<OpenInEditor taskId="t1" />);
    await screen.findByRole('button', { name: 'Open in VS Code' });
    rerender(<OpenInEditor taskId="t1" visible={false} />);
    chosen = 'visualstudio';
    rerender(<OpenInEditor taskId="t1" visible />);
    expect(
      await screen.findByRole('button', { name: 'Open in Visual Studio' }),
    ).toBeTruthy();
  });
});
