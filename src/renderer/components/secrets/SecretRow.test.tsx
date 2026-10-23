import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SecretView } from '../../../shared/secrets';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { nameParts, SecretRow } from './SecretRow';

const secret: SecretView = {
  id: 's1',
  scope: { repoId: 'r1' },
  name: 'ConnectionStrings__Db',
  givenTo: ['run'],
  values: {
    development: { mask: '••••2222', source: null, changedAt: '2026-10-23' },
  },
};

describe('SecretRow layout', () => {
  it('splits a name after each run of underscores', () => {
    expect(nameParts('ConnectionStrings__Db')).toEqual([
      'ConnectionStrings__',
      'Db',
    ]);
    expect(nameParts('STRIPE_SECRET_KEY')).toEqual([
      'STRIPE_',
      'SECRET_',
      'KEY',
    ]);
    expect(nameParts('PORT')).toEqual(['PORT']);
    expect(nameParts('_X_')).toEqual(['_', 'X_']);
  });

  it('lets a long name break only at its underscores, and keeps a mask on one line', () => {
    installFakeApi();
    const { container } = render(
      <table>
        <tbody>
          <SecretRow
            secret={secret}
            allRepos={false}
            onAdd={() => {}}
            onEdit={() => {}}
            onMove={() => {}}
            onDelete={() => {}}
          />
        </tbody>
      </table>,
    );
    const name = container.querySelector('.secret-name code')!;
    expect(name.textContent).toBe('ConnectionStrings__Db');
    expect(name.querySelectorAll('wbr')).toHaveLength(1);
    expect(container.querySelector('.secret-value code')).toHaveClass(
      'secret-mask',
    );
  });
});
