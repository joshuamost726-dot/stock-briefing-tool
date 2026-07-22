/**
 * upcomingEvents.js
 *
 * Computes deterministic "what's next" dates for the ticker detail page's
 * Upcoming section: next earnings date (passed through from Finnhub data
 * already fetched elsewhere) plus the next scheduled 13F sweep and next
 * FINRA short-interest update.
 *
 * DESIGN NOTE: the short-interest date is a computed APPROXIMATION, not an
 * authoritative FINRA calendar lookup — FINRA settlement dates fall near the
 * 15th and last calendar day of each month (rolled back to the nearest
 * business day), with publication roughly 8 business days later. This is
 * good enough to say "expect an update around such-and-such date," but is
 * deliberately labeled approximate rather than presented as exact, matching
 * this codebase's "don't dress up an estimate as a fact" philosophy.
 */

const QUARTERLY_SWEEP_MONTHS = [1, 4, 7, 10]; // Feb, May, Aug, Nov (0-indexed)
const QUARTERLY_SWEEP_DAY = 20;
const SHORT_INTEREST_PUBLISH_LAG_BUSINESS_DAYS = 8;

function rollBackToBusinessDay(date) {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);      // Sunday -> Friday
  else if (day === 6) d.setDate(d.getDate() - 1); // Saturday -> Friday
  return d;
}

function addBusinessDays(date, count) {
  const d = new Date(date);
  let added = 0;
  while (added < count) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

function nextQuarterlySweep(fromDate) {
  const year = fromDate.getFullYear();
  const candidates = [];
  for (const y of [year, year + 1]) {
    for (const m of QUARTERLY_SWEEP_MONTHS) {
      candidates.push(new Date(y, m, QUARTERLY_SWEEP_DAY));
    }
  }
  return candidates.filter(c => c > fromDate).sort((a, b) => a - b)[0];
}

function settlementDatesForMonth(year, month) {
  const midMonth = rollBackToBusinessDay(new Date(year, month, 15));
  const lastCalendarDay = new Date(year, month + 1, 0);
  const monthEnd = rollBackToBusinessDay(lastCalendarDay);
  return [midMonth, monthEnd];
}

function nextShortInterestSettlement(fromDate) {
  for (let i = 0; i < 3; i++) {
    const probe = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
    const dates = settlementDatesForMonth(probe.getFullYear(), probe.getMonth());
    const upcoming = dates.filter(d => d > fromDate).sort((a, b) => a - b)[0];
    if (upcoming) return upcoming;
  }
  return null;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function getUpcomingEvents(nextEarnings) {
  const now = new Date();

  const sweepDate = nextQuarterlySweep(now);
  const settlementDate = nextShortInterestSettlement(now);
  const shortInterestPublishDate = settlementDate
    ? addBusinessDays(settlementDate, SHORT_INTEREST_PUBLISH_LAG_BUSINESS_DAYS)
    : null;

  return {
    earnings: nextEarnings?.date
      ? {
          date: nextEarnings.date,
          epsEstimate: nextEarnings.epsEstimate ?? null,
          hour: nextEarnings.hour || null,
        }
      : null,
    next13fSweep: {
      date: formatDate(sweepDate),
      note: 'Full quarterly 13F-HR sweep — runs automatically.',
    },
    nextShortInterestUpdate: shortInterestPublishDate
      ? {
          date: formatDate(shortInterestPublishDate),
          approximate: true,
          note: 'Estimated from FINRA\'s twice-monthly settlement cycle, not an official calendar date.',
        }
      : null,
  };
}

module.exports = { getUpcomingEvents };
