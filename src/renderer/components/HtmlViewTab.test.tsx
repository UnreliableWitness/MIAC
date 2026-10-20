import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { HtmlViewTab } from './HtmlViewTab';

const view = {
  id: 'view:1',
  path: 'report/index.html',
  workspaceId: 'w2',
  name: 'index.html',
};

beforeEach(() => useStore.setState({ notices: [] }));

describe('HtmlViewTab', () => {
  it('shows the file in a sandboxed iframe from html:open', async () => {
    const { calls } = installFakeApi({
      'html:open': () => ({
        url: 'shellie-view://tok/index.html',
        name: 'index.html',
      }),
    });
    render(<HtmlViewTab taskId="t1" view={view} />);
    const frame = await screen.findByTitle('index.html');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'shellie-view://tok/index.html');
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
    );
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(calls.find((c) => c.channel === 'html:open')?.args).toEqual([
      't1#w2',
      'report/index.html',
    ]);
    expect(screen.getByText('report/index.html')).toBeInTheDocument();
  });

  it('reloads and opens the file in the browser', async () => {
    let n = 0;
    const { calls } = installFakeApi({
      'html:open': () => {
        if (++n > 1) throw new Error('Not found');
        return { url: 'shellie-view://tok/index.html', name: 'index.html' };
      },
      'html:openExternal': () => undefined,
    });
    render(<HtmlViewTab taskId="t1" view={view} />);
    await screen.findByTitle('index.html');
    await userEvent.click(
      screen.getByRole('button', { name: 'Open in browser' }),
    );
    expect(calls.find((c) => c.channel === 'html:openExternal')?.args).toEqual([
      't1#w2',
      'report/index.html',
    ]);
    // The file was deleted meanwhile: Reload shows why instead of the page.
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not show index.html: Not found',
    );
    expect(screen.queryByTitle('index.html')).toBeNull();
  });

  it('turns a failed Open in browser into a notice', async () => {
    installFakeApi({
      'html:open': () => ({ url: 'shellie-view://tok/a.html', name: 'a.html' }),
      'html:openExternal': () => {
        throw new Error('Could not open the file: no app');
      },
    });
    render(
      <HtmlViewTab taskId="t1" view={{ ...view, workspaceId: undefined }} />,
    );
    await screen.findByTitle('a.html');
    await userEvent.click(
      screen.getByRole('button', { name: 'Open in browser' }),
    );
    await waitFor(() =>
      expect(useStore.getState().notices.map((x) => x.message)).toEqual([
        'Could not open the file: no app',
      ]),
    );
  });
});
