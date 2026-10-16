import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { registerTerminal } from '../../terminalRegistry';
import { SendTo } from './SendTo';

const task = {
  id: 't1',
  status: 'ready',
  worktreeMissing: false,
  terminals: [
    { id: 'sh', kind: 'shell', label: 'zsh' },
    { id: 'cl', kind: 'claude', label: 'Claude' },
    { id: 'oc', kind: 'run', label: 'opencode' },
  ],
} as unknown as TaskView;

function Doc() {
  return (
    <div data-testid="doc">
      <p data-line-start="3" data-line-end="4">
        first para
      </p>
      <p data-line-start="6" data-line-end="6">
        second para
      </p>
    </div>
  );
}
const select = (from: Node, to: Node) => {
  const r = document.createRange();
  r.setStart(from, 0);
  r.setEnd(to, (to.textContent ?? '').length);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
};

let pastes: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  localStorage.clear();
  pastes = {};
  for (const id of ['sh', 'cl', 'oc']) {
    pastes[id] = vi.fn();
    registerTerminal(id, {
      paste: pastes[id],
      focus: vi.fn(),
      modes: { bracketedPasteMode: true },
    } as never);
  }
  useStore.setState({ tabByTask: {}, tasks: [task] });
});

const mount = (
  running: Record<string, boolean> = { sh: true, cl: true, oc: true },
) => {
  const api = installFakeApi({
    'terminals:isRunning': (id) => running[id] ?? false,
  });
  const { getByTestId } = render(<Doc />);
  const container = getByTestId('doc');
  render(
    <SendTo
      task={task}
      container={container}
      path="docs/plan.md"
      view="rendered"
    />,
  );
  return { api, container };
};

describe('SendTo', () => {
  it('defaults to the first agent terminal and pastes the quote without Enter', async () => {
    const { container } = mount();
    const [p1, p2] = container.querySelectorAll('p');
    act(() => select(p1.firstChild!, p2.firstChild!));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Send to Claude' }),
    );
    expect(pastes.cl).toHaveBeenCalledWith(
      'docs/plan.md:3-6\n> first para\n> second para\n\n',
    );
    expect(pastes.cl.mock.calls[0][0].endsWith('\r')).toBe(false);
    expect(useStore.getState().activeTab('t1')).toBe('cl');
  });
  it('remembers the chosen target and disables exited terminals', async () => {
    const { container } = mount({ sh: true, cl: true, oc: false });
    act(() =>
      select(
        container.querySelector('p')!.firstChild!,
        container.querySelector('p')!.firstChild!,
      ),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Choose terminal' }),
    );
    expect(
      (await screen.findByRole('menuitem', { name: /opencode/ })).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true');
    await userEvent.click(screen.getByRole('menuitem', { name: /zsh/ }));
    expect(pastes.sh).toHaveBeenCalled();
    expect(localStorage.getItem('miac.docs.sendTo.t1')).toBe('sh');
  });
  it('hides on Escape', async () => {
    const { container } = mount();
    act(() =>
      select(
        container.querySelector('p')!.firstChild!,
        container.querySelector('p')!.firstChild!,
      ),
    );
    await screen.findByRole('button', { name: 'Send to Claude' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Send to Claude' }),
      ).toBeNull(),
    );
  });
  it('does not send to an exited default terminal', async () => {
    const { container } = mount({ sh: true, cl: false, oc: true });
    act(() =>
      select(
        container.querySelector('p')!.firstChild!,
        container.querySelector('p')!.firstChild!,
      ),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Send to Claude' }),
    );
    expect(pastes.cl).not.toHaveBeenCalled();
    expect(
      useStore
        .getState()
        .notices.some((n) => n.message === 'That terminal is not running'),
    ).toBe(true);
    expect(useStore.getState().activeTab('t1')).not.toBe('cl');
    expect(localStorage.getItem('miac.docs.sendTo.t1')).toBeNull();
  });
  it('gives exact lines from the Source view', async () => {
    installFakeApi({ 'terminals:isRunning': () => true });
    const { getByTestId } = render(
      <div data-testid="src">
        <div className="src-line" data-line="10">
          alpha
        </div>
        <div className="src-line" data-line="11">
          beta
        </div>
      </div>,
    );
    const container = getByTestId('src');
    render(
      <SendTo task={task} container={container} path="a.md" view="source" />,
    );
    const [l1, l2] = container.querySelectorAll('.src-line');
    act(() => select(l1.firstChild!, l2.firstChild!));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Send to Claude' }),
    );
    expect(pastes.cl.mock.calls[0][0].startsWith('a.md:10-11\n')).toBe(true);
  });
  it('sends a single line when bracketed paste is off', async () => {
    const plain = vi.fn();
    registerTerminal('cl', {
      paste: plain,
      focus: vi.fn(),
      modes: { bracketedPasteMode: false },
    } as never);
    const { container } = mount();
    const [p1, p2] = container.querySelectorAll('p');
    act(() => select(p1.firstChild!, p2.firstChild!));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Send to Claude' }),
    );
    expect(plain).toHaveBeenCalledTimes(1);
    expect(plain.mock.calls[0][0]).not.toMatch(/[\n\r]/);
  });
});
