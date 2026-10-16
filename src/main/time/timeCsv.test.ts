import { describe, expect, it } from 'vitest';
import { timeCsv } from './timeCsv';

describe('timeCsv', () => {
  it('has the exact header and one row', () => {
    expect(
      timeCsv([
        {
          task: 'feature/1-x',
          workItem: '1',
          booked: 14400,
          measured: 11400,
          realistic: 12000,
          wallClock: 20000,
          claude: 6000,
          copilot: 0,
          opencode: 300,
        },
      ]),
    ).toBe(
      'task,work_item,booked_s,measured_s,realistic_s,wall_clock_s,claude_s,copilot_s,opencode_est_s\r\n' +
        'feature/1-x,1,14400,11400,12000,20000,6000,0,300\r\n',
    );
  });
  it('leaves booked empty, rounds seconds and quotes commas', () => {
    expect(
      timeCsv([
        {
          task: 'a,b',
          workItem: '',
          booked: null,
          measured: 1.6,
          realistic: 0,
          wallClock: 0,
          claude: 0,
          copilot: 0,
          opencode: 0,
        },
      ]).split('\r\n')[1],
    ).toBe('"a,b",,,2,0,0,0,0,0');
  });
});
