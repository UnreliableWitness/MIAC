import { describe, expect, it } from 'vitest';
import {
  discoveredMeasurements,
  graverEnvironment,
  sourceKind,
} from './telemetry';

describe('sourceKind', () => {
  it('names the kind of each discovery source from its display form alone', () => {
    expect(sourceKind('.env')).toBe('dotenv');
    expect(sourceKind('api/.env.uat.local')).toBe('dotenv');
    expect(sourceKind('config/app.env')).toBe('dotenv');
    expect(sourceKind('src/Api/appsettings.Production.json')).toBe(
      'appsettings',
    );
    expect(sourceKind('launch profile https')).toBe('launchSettings');
    expect(sourceKind('user secrets')).toBe('userSecrets');
    expect(sourceKind('.vscode/launch.json')).toBe('vscode');
    expect(sourceKind('docker-compose.override.yml')).toBe('compose');
    expect(sourceKind('compose.yaml')).toBe('compose');
    expect(sourceKind('fn/local.settings.json')).toBe('localSettings');
    expect(sourceKind('secrets/db/password')).toBe('secretsFolder');
    expect(sourceKind('api/stripe.secrets.json')).toBe('secretsFolder');
    expect(sourceKind('/abs/elsewhere/weird.txt')).toBe('other');
  });
});

describe('discoveredMeasurements', () => {
  it('counts values per source kind, plus totals, never a name, value or path', () => {
    const m = discoveredMeasurements(
      [
        { source: '.env', env: 'development', secretLike: true },
        { source: '.env.uat', env: 'uat', secretLike: true },
        { source: 'user secrets', env: 'development', secretLike: false },
        { source: 'launch profile x', env: null, secretLike: true },
      ],
      2,
    );
    expect(m).toEqual({
      values: 4,
      secretLike: 3,
      unassigned: 1,
      skipped: 2,
      dotenv: 2,
      userSecrets: 1,
      launchSettings: 1,
    });
  });
});

describe('graverEnvironment', () => {
  it('keeps the graver of two environments', () => {
    expect(graverEnvironment(null, 'test')).toBe('test');
    expect(graverEnvironment('production', 'uat')).toBe('production');
    expect(graverEnvironment('development', 'uat')).toBe('uat');
  });
});
