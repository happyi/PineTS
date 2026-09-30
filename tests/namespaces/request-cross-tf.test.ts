// SPDX-License-Identifier: AGPL-3.0-only
// Tests for request.security cross-timeframe fixes:
// 1. normalizeTimeframe() for non-canonical timeframe strings
// 2. barmerge string enum ('gaps_off'/'lookahead_off') → boolean conversion
// 3. Weekly→Daily (LTF) cross-TF correctness against TV reference data
// 4. 1h→Daily (HTF) cross-TF correctness (no NaN)

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '@pinets/marketData/Provider.class';
import { normalizeTimeframe, TIMEFRAMES } from '../../src/namespaces/request/utils/TIMEFRAMES';

// ── normalizeTimeframe unit tests ──────────────────────────────────────────────

describe('normalizeTimeframe', () => {
    it('should pass through canonical formats unchanged', () => {
        for (const tf of TIMEFRAMES) {
            expect(normalizeTimeframe(tf)).toBe(tf);
        }
    });

    it('should normalize minute formats (1m, 3m, 5m, 15m, 30m, 45m)', () => {
        expect(normalizeTimeframe('1m')).toBe('1');
        expect(normalizeTimeframe('3m')).toBe('3');
        expect(normalizeTimeframe('5m')).toBe('5');
        expect(normalizeTimeframe('15m')).toBe('15');
        expect(normalizeTimeframe('30m')).toBe('30');
        expect(normalizeTimeframe('45m')).toBe('45');
    });

    it('should normalize hour formats (1h, 2h, 3h, 4h)', () => {
        expect(normalizeTimeframe('1h')).toBe('60');
        expect(normalizeTimeframe('2h')).toBe('120');
        expect(normalizeTimeframe('3h')).toBe('180');
        expect(normalizeTimeframe('4h')).toBe('240');
    });

    it('should normalize uppercase hour formats (1H, 4H)', () => {
        expect(normalizeTimeframe('1H')).toBe('60');
        expect(normalizeTimeframe('4H')).toBe('240');
    });

    it('should normalize day/week/month formats', () => {
        expect(normalizeTimeframe('1d')).toBe('D');
        expect(normalizeTimeframe('1D')).toBe('D');
        expect(normalizeTimeframe('1w')).toBe('W');
        expect(normalizeTimeframe('1W')).toBe('W');
        expect(normalizeTimeframe('1M')).toBe('M');
    });

    it('should normalize lowercase single-letter formats (d, w, m)', () => {
        expect(normalizeTimeframe('d')).toBe('D');
        expect(normalizeTimeframe('w')).toBe('W');
        expect(normalizeTimeframe('m')).toBe('M');
    });

    it('should return unknown formats as-is', () => {
        expect(normalizeTimeframe('2D')).toBe('2D');
        expect(normalizeTimeframe('xyz')).toBe('xyz');
    });
});

// ── barmerge string enum handling ──────────────────────────────────────────────

describe('request.security barmerge string enum handling', () => {
    // Helper: extract plot data as { time, value }[] filtered to date range
    function extractPlot(
        plots: any,
        name: string,
        sDate: number,
        eDate: number,
    ): { time: string; value: any }[] {
        const plotdata = plots[name]?.data || [];
        return plotdata
            .filter((e: any) => e.time >= sDate && e.time <= eDate)
            .map((e: any) => ({
                time: new Date(e.time).toISOString().slice(0, 10),
                value: e.value,
            }));
    }

    it('barmerge.gaps_off/lookahead_off strings should behave like false/false', async () => {
        // The transpiler emits barmerge.gaps_off = 'gaps_off' and barmerge.lookahead_off = 'lookahead_off'
        // These are truthy strings and must be explicitly converted to boolean false.
        // Before the fix, they were passed directly to findLTFContextIdx/findSecContextIdx
        // where `if (gaps && lookahead)` evaluated as TRUE, taking the wrong code path.
        const sDate = new Date('2019-01-07').getTime();
        const eDate = new Date('2019-02-04').getTime();
        const warmup = 365 * 24 * 60 * 60 * 1000;

        const pineTS = new PineTS(Provider.Binance, 'BTCUSDC', 'W', null, sDate - warmup);

        const { plots } = await pineTS.run(
`//@version=5
indicator("barmerge enum test")
// These use barmerge.gaps_off / barmerge.lookahead_off (string enums)
float dc_enum = request.security(syminfo.tickerid, "D", close, barmerge.gaps_off, barmerge.lookahead_off)
// These pass boolean false directly
float dc_bool = request.security(syminfo.tickerid, "D", close, false, false)
plot(dc_enum, "enum")
plot(dc_bool, "bool")
`);

        const enumData = extractPlot(plots, 'enum', sDate, eDate);
        const boolData = extractPlot(plots, 'bool', sDate, eDate);

        expect(enumData.length).toBeGreaterThan(0);
        expect(enumData.length).toBe(boolData.length);

        // Every value from string enum path must match boolean path exactly
        for (let i = 0; i < enumData.length; i++) {
            expect(enumData[i].value).toBe(boolData[i].value);
            expect(enumData[i].time).toBe(boolData[i].time);
        }

        // Verify none are NaN
        for (const d of enumData) {
            expect(isNaN(d.value)).toBe(false);
        }
    }, 30000);
});

// ── Cross-TF correctness against TradingView reference data ────────────────────

describe('request.security Cross-TF Correctness', () => {
    // Helper: extract plot data as { time, value }[] filtered to date range
    function extractPlot(
        plots: any,
        name: string,
        sDate: number,
        eDate: number,
    ): { time: string; value: any }[] {
        const plotdata = plots[name]?.data || [];
        return plotdata
            .filter((e: any) => e.time >= sDate && e.time <= eDate)
            .map((e: any) => ({
                time: new Date(e.time).toISOString().slice(0, 10),
                value: e.value,
            }));
    }

    // TradingView reference values captured from BTCUSDC Weekly chart
    // requesting Daily data with barmerge.gaps_off, barmerge.lookahead_off
    const TV_WEEKLY_REFERENCE = [
        { time: '2019-01-07', dailyClose: 3509.21, dailyHigh: 3652.00, dailyClose1: 3616.15 },
        { time: '2019-01-14', dailyClose: 3535.79, dailyHigh: 3706.62, dailyClose1: 3682.09 },
        { time: '2019-01-21', dailyClose: 3531.36, dailyHigh: 3565.00, dailyClose1: 3552.93 },
        { time: '2019-01-28', dailyClose: 3413.46, dailyHigh: 3474.21, dailyClose1: 3465.05 },
        { time: '2019-02-04', dailyClose: 3651.57, dailyHigh: 3652.61, dailyClose1: 3626.54 },
    ];

    it('Weekly chart requesting Daily close/high/close[1] should match TradingView', async () => {
        const sDate = new Date('2019-01-07').getTime();
        const eDate = new Date('2019-02-10').getTime();
        const warmup = 365 * 24 * 60 * 60 * 1000;

        const pineTS = new PineTS(Provider.Binance, 'BTCUSDC', 'W', null, sDate - warmup, eDate);

        const { plots } = await pineTS.run(
`//@version=5
indicator("Cross-TF W->D")
float dailyClose  = request.security(syminfo.tickerid, "D", close, barmerge.gaps_off, barmerge.lookahead_off)
float dailyHigh   = request.security(syminfo.tickerid, "D", high, barmerge.gaps_off, barmerge.lookahead_off)
float dailyClose1 = request.security(syminfo.tickerid, "D", close[1], barmerge.gaps_off, barmerge.lookahead_off)
plot(dailyClose, "dc")
plot(dailyHigh, "dh")
plot(dailyClose1, "dc1")
`);

        const dcData = extractPlot(plots, 'dc', sDate, new Date('2019-02-05').getTime());
        const dhData = extractPlot(plots, 'dh', sDate, new Date('2019-02-05').getTime());
        const dc1Data = extractPlot(plots, 'dc1', sDate, new Date('2019-02-05').getTime());

        expect(dcData.length).toBe(TV_WEEKLY_REFERENCE.length);

        for (let i = 0; i < TV_WEEKLY_REFERENCE.length; i++) {
            const ref = TV_WEEKLY_REFERENCE[i];
            expect(dcData[i].time).toBe(ref.time);
            expect(dcData[i].value).toBeCloseTo(ref.dailyClose, 1);
            expect(dhData[i].value).toBeCloseTo(ref.dailyHigh, 1);
            expect(dc1Data[i].value).toBeCloseTo(ref.dailyClose1, 1);
        }
    }, 30000);

    it('1h chart requesting Daily should produce valid values (no NaN) with canonical TF', async () => {
        const sDate = new Date('2019-01-07').getTime();
        const eDate = new Date('2019-01-10').getTime();

        // '60' is the canonical 1h timeframe
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDC', '60', null, sDate, eDate);

        const { plots } = await pineTS.run(
`//@version=5
indicator("Cross-TF 1h->D")
float dailyClose = request.security(syminfo.tickerid, "D", close, barmerge.gaps_off, barmerge.lookahead_off)
plot(dailyClose, "dc")
`);

        const dcData = extractPlot(plots, 'dc', sDate, eDate);

        // Should have hourly bars (at least 48 for 2 full days)
        expect(dcData.length).toBeGreaterThan(48);

        // No values should be NaN (this was the bug before the fix)
        const nanCount = dcData.filter(d => isNaN(d.value)).length;
        expect(nanCount).toBe(0);

        // All values should be positive (valid BTC prices)
        for (const d of dcData) {
            expect(d.value).toBeGreaterThan(0);
        }
    }, 30000);

    it('normalizeTimeframe produces correct isLTF determination in security.ts', () => {
        // The normalizeTimeframe fix ensures that non-canonical formats like '1h', '4h'
        // are mapped to canonical ('60', '240') before TIMEFRAMES.indexOf() comparison.
        // Without this fix, TIMEFRAMES.indexOf('1h') returns -1 and throws Error.

        // Simulate what security.ts does on lines 41-42:
        const ctxTF_canonical = '60';           // canonical 1h
        const ctxTF_nonCanonical = '1h';        // non-canonical 1h
        const reqTF = 'D';                      // requesting Daily

        const ctxIdx_canonical = TIMEFRAMES.indexOf(normalizeTimeframe(ctxTF_canonical));
        const ctxIdx_nonCanonical = TIMEFRAMES.indexOf(normalizeTimeframe(ctxTF_nonCanonical));
        const reqIdx = TIMEFRAMES.indexOf(normalizeTimeframe(reqTF));

        // Both should resolve to the same index
        expect(ctxIdx_canonical).toBe(ctxIdx_nonCanonical);
        expect(ctxIdx_canonical).not.toBe(-1);
        expect(reqIdx).not.toBe(-1);

        // 1h < Daily → isLTF = false (HTF request)
        const isLTF = ctxIdx_canonical > reqIdx;
        expect(isLTF).toBe(false);

        // Weekly > Daily → isLTF = true (LTF request)
        const weeklyIdx = TIMEFRAMES.indexOf(normalizeTimeframe('W'));
        const isLTF_weekly = weeklyIdx > reqIdx;
        expect(isLTF_weekly).toBe(true);

        // Non-canonical formats should also work
        expect(TIMEFRAMES.indexOf(normalizeTimeframe('4h'))).toBe(TIMEFRAMES.indexOf('240'));
        expect(TIMEFRAMES.indexOf(normalizeTimeframe('1w'))).toBe(TIMEFRAMES.indexOf('W'));
        expect(TIMEFRAMES.indexOf(normalizeTimeframe('1d'))).toBe(TIMEFRAMES.indexOf('D'));
    });
});

// ── Current (developing) HTF bar on the LAST LTF bar with lookahead_off ───────
//
// Root cause of "HTF single-K not showing on the right edge":
//   findSecContextIdx with lookahead=false returns i-1 while a bar sits inside an
//   un-closed HTF bucket. On the LAST bar this hides the current forming HTF
//   single-K (e.g. the developing current 1D candle from a 1h chart). TradingView
//   shows the current developing HTF values on the last (live) bar, so the last
//   bar must resolve to the current bucket i even when isRealtime=false (i.e. when
//   the dataset is historical/preloaded and Date.now() is already past the data).
describe('request.security current forming HTF bar on last LTF bar (lookahead_off)', () => {
    const HOUR = 1000 * 60 * 60;
    const DAY = 24 * HOUR;

    // 1h candles, monotonic price (close == index), starting 2024-01-01 00:00 UTC,
    // ending mid-day on 2024-01-10 09:00 UTC → last day (Jan 10) is still forming.
    function hourlyCandles() {
        const start = Date.UTC(2024, 0, 1);
        const total = 9 * 24 + 10; // 9 full days + 10 hours of Jan 10
        const bars = [];
        for (let i = 0; i < total; i++) {
            const openTime = start + i * HOUR;
            const v = i; // close == index -> last candle close == total-1
            bars.push({
                openTime,
                open: v,
                high: v + 1,
                low: v - 1,
                close: v,
                closeTime: openTime + HOUR,
            });
        }
        return bars;
    }

    function dayAggregate(bars) {
        const out = [];
        for (const c of bars) {
            const day = Math.floor(c.openTime / DAY) * DAY;
            const last = out.length ? out[out.length - 1] : null;
            if (last && last.openTime === day) {
                if (c.high > last.high) last.high = c.high;
                if (c.low < last.low) last.low = c.low;
                last.close = c.close;
                last.closeTime = day + DAY;
            } else {
                out.push({
                    openTime: day,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                    closeTime: day + DAY,
                });
            }
        }
        return out;
    }

    function inlineProvider(bars: any[]) {
        return {
            async getMarketData(_tickerId: string, timeframe: string, limit: number | null | undefined, sDate: number | null | undefined, eDate: number | null | undefined) {
                let data: any[] = timeframe === 'D' ? dayAggregate(bars) : bars;
                if (sDate != null) data = data.filter((c: any) => c.openTime >= sDate);
                if (eDate != null) data = data.filter((c: any) => c.openTime <= eDate);
                if (limit != null && limit > 0 && data.length > limit) data = data.slice(data.length - limit);
                return data;
            },
            async getSymbolInfo(_tickerId: string) {
                const sym = {
                    ticker: 'BTCUSDC',
                    tickerid: 'BTCUSDC',
                    description: 'BTC/USDC',
                    prefix: '',
                    root: 'BTC',
                    type: 'crypto',
                    main_tickerid: 'BTCUSDC',
                    current_contract: '',
                    isin: '',
                    basecurrency: 'BTC',
                    currency: 'USDC',
                    country: '',
                    timezone: 'Etc/UTC',
                    session: '24x7',
                    volumetype: 'base',
                    expiration_date: 0,
                    employees: 0,
                    industry: '',
                    sector: '',
                    shareholders: 0,
                    shares_outstanding_float: 0,
                    shares_outstanding_total: 0,
                    recommendations_buy: 0,
                    recommendations_buy_strong: 0,
                    recommendations_date: 0,
                    recommendations_hold: 0,
                    recommendations_sell: 0,
                    recommendations_sell_strong: 0,
                    recommendations_total: 0,
                    target_price_average: 0,
                    target_price_date: 0,
                    target_price_estimates: 0,
                    target_price_high: 0,
                    target_price_low: 0,
                    target_price_median: 0,
                    mincontract: 0,
                    minmove: 1,
                    mintick: 0.01,
                    pointvalue: 1,
                    pricescale: 100,
                };
                return sym;
            },
            configure(): void {},
        };
    }

    it('last bar of a 1h chart should return the current forming daily close, not the previous day close', async () => {
        const sDate = Date.UTC(2024, 0, 1);
        const eDate = Date.UTC(2024, 0, 10, 9); // last 1h bar 09:00 UTC
        const bars = hourlyCandles();
        const expectLastClose = bars.length - 1; // developing daily close == last 1h close

        const pineTS = new PineTS(inlineProvider(bars), 'BTCUSDC', '60', null, sDate, eDate);

        const { plots } = await pineTS.run(
`//@version=5
indicator("current-htf-bar")
float dc = request.security(syminfo.tickerid, "D", close, barmerge.gaps_off, barmerge.lookahead_off)
plot(dc, "dc")
`);

        const data = plots['dc'].data;
        expect(data.length).toBe(bars.length);

        const last = data[data.length - 1];
        // Before the fix the last bar resolves to the PREVIOUS closed daily bucket (i-1),
        // so the current forming 1D single-K never exists for MTF indicators.
        expect(isNaN(last.value)).toBe(false);
        expect(last.value).toBeCloseTo(expectLastClose, 6);

        // The second-to-last bar inside the same forming day must STILL return the
        // previous (closed) day's close — lookahead_off only relaxes on the last bar.
        const prev = data[data.length - 2];
        expect(prev.value).toBeCloseTo(expectLastClose - 10, 6);
    });

    it('findSecContextIdx unit: last-bar flag returns current bucket instead of i-1', async () => {
        const { findSecContextIdx } = await import('../../src/namespaces/request/utils/findSecContextIdx');
        const openTime = [Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 2)];
        const closeTime = [Date.UTC(2024, 0, 2), Date.UTC(2024, 0, 3)];
        // Last bar open 2024-01-02 03:00, close 04:00 → inside day-2 bucket (unclosed)
        const myOpenTime = Date.UTC(2024, 0, 2, 3);
        const myCloseTime = Date.UTC(2024, 0, 2, 4);

        // lookahead_off + not last bar → previous closed bucket
        expect(findSecContextIdx(myOpenTime, myCloseTime, openTime, closeTime, false, false, false)).toBe(0);
        // lookahead_off + last bar → current forming bucket
        expect(findSecContextIdx(myOpenTime, myCloseTime, openTime, closeTime, false, false, true)).toBe(1);
    });
});
