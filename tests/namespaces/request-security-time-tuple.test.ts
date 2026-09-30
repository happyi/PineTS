import { describe, it, expect } from 'vitest';
import { PineTS, Provider } from 'index';

// Regression guard: request.security() tuple elements for `time` / `time_close`
// must materialize to the numeric open/close timestamps of the secondary bar at
// the current index — NOT leak TimeHelper objects (whose __value is a Series).
// Downstream consumers (box.new coords, plots, na() checks) treat the tuple
// elements as primitives; leaking the helper produced MTF boxes with NaN/odd-hour
// coordinates (e.g. the MathStyle MTF script's showMTF boxes never rendered).

const MS_MIN = 60_000;

async function runTuple() {
    const script = `
//@version=6
indicator("MTF time tuple", overlay = true)
[htfTime, htfTimeClose, htfOpen] = request.security(syminfo.tickerid, "240", [time, time_close, open], barmerge.gaps_off, barmerge.lookahead_off)
plot(htfTime, "htfTime")
plot(htfTimeClose, "htfClose")
plot(htfOpen, "htfOpen")
`;
    const pineTS = new PineTS(
        Provider.Mock,
        'BTCUSDC',
        '60',
        null,
        new Date('2024-01-01').getTime(),
        new Date('2024-01-10').getTime()
    );
    return (await pineTS.run(script)).plots;
}

function allDataPoints(plots: any): any[] {
    const out: any[] = [];
    for (const key of Object.keys(plots)) {
        const data = plots[key]?.data;
        if (Array.isArray(data) && data.length > 1) out.push(...data);
    }
    return out;
}

describe('request.security time tuple materialization', () => {
    it('returns numeric timestamps aligned to the security timeframe grid', async () => {
        const plots = await runTuple();

        // Timestamps (> 1e12) can only come from the time/time_close tuple plots.
        const timestamps = allDataPoints(plots).filter(
            (p: any) => typeof p.value === 'number' && p.value > 1e12
        );
        expect(timestamps.length).toBeGreaterThan(0);

        for (const p of timestamps) {
            expect(Number.isInteger(p.value)).toBe(true);
            // Secondary TF is 240m: every value must sit on the 4h grid
            expect(p.value % (240 * MS_MIN)).toBe(0);
        }
    });

    it('never leaks helper objects into plot values', async () => {
        const plots = await runTuple();

        for (const p of allDataPoints(plots).filter((p: any) => p && 'value' in p)) {
            if (p.value === undefined || p.value === null) continue;
            expect(typeof p.value).toBe('number');
            expect(Number.isNaN(p.value)).toBe(false);
        }
    });

    it('returns numeric OHLC alongside time (control: open stays a number)', async () => {
        const plots = await runTuple();

        const htfOpen = (Object.keys(plots).length ? plots : {})['htfOpen'] || plots[Object.keys(plots).length - 1];
        const htfOpenData = (htfOpen?.data || []) as any[];
        expect(htfOpenData.length).toBeGreaterThan(0);

        let numericCount = 0;
        for (const p of htfOpenData) {
            if (typeof p.value === 'number' && !Number.isNaN(p.value)) numericCount++;
        }
        // OHLC tuple elements were already numeric; ensure they stay numeric.
        expect(numericCount).toBeGreaterThan(0);
    });
});