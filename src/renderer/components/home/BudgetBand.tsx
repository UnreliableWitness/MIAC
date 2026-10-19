import { useState } from 'react';
import type { BudgetView } from '../../../shared/budgetView';
import { compact, eur } from '../../format';
import { useBudget } from '../../hooks/useBudget';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { Band } from './Band';

const INFO =
  "Estimated at Anthropic API list prices in EUR. Your company's invoice may differ. Claude models through Copilot aren't counted.";

export function modelColor(model: string): string {
  for (const f of ['opus', 'sonnet', 'haiku', 'fable'] as const)
    if (model.includes(f)) return `var(--chart-${f})`;
  return 'var(--line-strong)';
}
const shortDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

function Status({ v }: { v: BudgetView }) {
  if (v.status === 'over' && v.budgetEur !== null)
    return (
      <span className="budget-status is-over">
        Over budget by {eur(v.spentEur - v.budgetEur)}
      </span>
    );
  if (v.status === 'paceOver' && v.forecastEur !== null && v.budgetEur !== null)
    return (
      <span className="budget-status is-over">
        On pace for {eur(v.forecastEur)}, {eur(v.forecastEur - v.budgetEur)}{' '}
        over
      </span>
    );
  if (v.forecastEur !== null)
    return (
      <span className="budget-status">
        On track: about {eur(v.forecastEur)} by {shortDate(v.endDay)}
      </span>
    );
  return null;
}

const W = 600;
function BurnDown({ v }: { v: BudgetView }) {
  const n = v.daysInMonth;
  const top =
    Math.max(v.budgetEur ?? 0, v.forecastEur ?? 0, v.spentEur, 1) * 1.05;
  const x = (i: number) => (W * i) / Math.max(1, n - 1);
  const y = (eurValue: number) => 90 - (85 * eurValue) / top;
  const line = v.cumulative.map((p, i) => `${x(i)},${y(p.eur)}`).join(' ');
  const last = v.cumulative.length - 1;
  return (
    <svg
      role="img"
      aria-label="Spend this month against the budget"
      viewBox={`0 0 ${W} 92`}
      preserveAspectRatio="none"
      className="budget-burn"
    >
      {v.budgetEur !== null && (
        <>
          <line
            x1={0}
            y1={y(v.budgetEur)}
            x2={W}
            y2={y(v.budgetEur)}
            className="budget-limit"
          />
          <line
            x1={0}
            y1={y(0)}
            x2={W}
            y2={y(v.budgetEur)}
            className="budget-pace"
          />
        </>
      )}
      <polyline points={line} className="budget-line">
        <title>
          {v.cumulative
            .map((p) => `${shortDate(p.day)}: ${eur(p.eur)}`)
            .join('\n')}
        </title>
      </polyline>
      {v.forecastEur !== null && last >= 0 && (
        <line
          x1={x(last)}
          y1={y(v.cumulative[last].eur)}
          x2={W}
          y2={y(v.forecastEur)}
          className="budget-forecast"
        />
      )}
    </svg>
  );
}

function DailyBars({ v }: { v: BudgetView }) {
  const max = Math.max(...v.days.map((d) => d.costEur), 0.01);
  const bw = W / Math.max(1, v.days.length);
  return (
    <svg
      role="img"
      aria-label="Spend per day by model"
      viewBox={`0 0 ${W} 60`}
      preserveAspectRatio="none"
      className="budget-bars"
    >
      <defs>
        <pattern
          id="budget-hatch"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="2" height="4" fill="var(--bg-card)" opacity="0.6" />
        </pattern>
      </defs>
      {v.days.map((d, i) => {
        let yTop = 60;
        return (
          <g
            key={d.day}
            data-part="day"
            className={d.today ? 'is-today' : undefined}
          >
            <title>{`${shortDate(d.day)}: ${eur(d.costEur)}${d.byModel.map((m) => `\n${m.model} ${eur(m.costEur)} · ${compact(m.tokens)} tokens`).join('')}`}</title>
            {d.byModel.map((m) => {
              const h = (58 * m.costEur) / max;
              yTop -= h;
              const hOut = (58 * m.outsideEur) / max;
              return (
                <g key={m.model}>
                  <rect
                    x={i * bw + 1}
                    y={yTop}
                    width={bw - 2}
                    height={h}
                    fill={modelColor(m.model)}
                  />
                  {hOut > 0 && (
                    <rect
                      x={i * bw + 1}
                      y={yTop}
                      width={bw - 2}
                      height={hOut}
                      fill="url(#budget-hatch)"
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function BudgetBand() {
  const [offset, setOffset] = useState(0);
  const v = useBudget(offset);
  const go = useStore((s) => s.go);
  const step = (d: number) => {
    track('home.clicked', { band: 'budget-month' });
    setOffset((o) => Math.min(0, o + d));
  };
  return (
    <Band title="Claude budget">
      {v && (
        <div className="budget">
          <div className="budget-head">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous month"
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <span className="muted small">
              {shortDate(v.startDay)} – {shortDate(v.endDay)}
            </span>
            {offset < 0 && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Next month"
                onClick={() => step(1)}
              >
                ›
              </button>
            )}
          </div>
          {!v.sources.claudeCode && !v.sources.openCode ? (
            <p className="muted">
              No Claude Code or OpenCode usage found on this computer.
            </p>
          ) : (
            <>
              <div className="budget-total">
                {v.budgetEur === null ? (
                  <>
                    <b>{eur(v.spentEur)} this month</b>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        track('home.clicked', { band: 'budget-settings' });
                        go({ kind: 'settings' });
                      }}
                    >
                      Set a monthly budget
                    </button>
                  </>
                ) : (
                  <>
                    <b>{eur(v.spentEur)}</b>{' '}
                    <span className="muted">of {eur(v.budgetEur)}</span>
                  </>
                )}
                <span className="budget-info" title={INFO} aria-label={INFO}>
                  ⓘ
                </span>
                <Status v={v} />
              </div>
              <BurnDown v={v} />
              <DailyBars v={v} />
              <ul className="budget-models">
                {v.models.map((m) => (
                  <li key={m.model}>
                    <i style={{ background: modelColor(m.model) }} /> {m.model}{' '}
                    {eur(m.costEur)}
                  </li>
                ))}
              </ul>
              {offset === 0 && (
                <p className="muted small">{`Today ${eur(v.todayEur)} · This week ${eur(v.weekEur)} · ${Math.round(v.outsideShare * 100)}% outside Shellie`}</p>
              )}
              {v.notCounted.map((x) => (
                <p
                  key={`${x.provider}|${x.model}`}
                  className="muted small"
                >{`Not counted: ${x.model} via ${x.provider}, ${x.requests} requests`}</p>
              ))}
              {v.unpriced.map((x) => (
                <p
                  key={x.model}
                  className="muted small"
                >{`Unpriced: ${x.model}, ${compact(x.tokens)} tokens`}</p>
              ))}
            </>
          )}
        </div>
      )}
    </Band>
  );
}
