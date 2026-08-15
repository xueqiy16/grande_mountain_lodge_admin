import React, { useState, useMemo, useEffect } from 'react';
import { ROOM_TYPE_PRESETS } from '../lib/constants';

// Fixed Y-axis order of room types (matches ROOM_TYPE_PRESETS names exactly).
const ROOM_TYPE_ROWS = [
  'Standard Queen Non-Smoking',
  'Studio Queen Non-Smoking',
  'Studio Queen Smoking',
  'Studio Double Queen Non-Smoking',
  'Studio Double Queen Smoking',
  'Suite King Non-Smoking',
  'Suite Queen Non-Smoking'
];

// Short code shown in the skinny left column; falls back to the name.
const codeFor = (typeName) => ROOM_TYPE_PRESETS[typeName]?.code || typeName;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Layout constants. Day columns are flexible (flex:1) so the whole half-month
// span fits the container width with NO horizontal scroll; only these fixed
// widths are pinned. Bar geometry is expressed as % of the day track.
const LABEL_W = 104;   // px skinny sticky room-code column
const BAR_H = 24;      // px reservation bar height
const BAR_GAP = 4;     // px vertical gap between stacked (overlapping) bars
const ROW_PAD = 8;     // px vertical padding inside a room-type row
const HALF_SPLIT = 15; // first half = days 1..15, second half = 16..end
const POPOVER_W = 300;
const POPOVER_H = 230; // estimated height used for deterministic placement

// Local YYYY-MM-DD (never toISOString(), which is UTC and can shift a day).
const toISO = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const localTodayISO = () => {
  const d = new Date();
  return toISO(d.getFullYear(), d.getMonth(), d.getDate());
};

// Status legend (dynamic operational status relative to today).
const STATUS_META = {
  confirmed:     { label: 'Confirmed',       color: '#f97316' }, // orange
  checkin_today: { label: 'Check In Today',  color: '#eab308' }, // yellow
  inhouse:       { label: 'In House',        color: '#22c55e' }, // green
  departing:     { label: 'Departing Today', color: '#3b82f6' }, // blue
  checked_out:   { label: 'Checked Out',     color: '#94a3b8' }  // gray
};

// Resolve a reservation's dynamic status from booking_status + today's date.
const resolveStatus = (b, today) => {
  const status = b?.booking_status;
  const checkIn = (b?.check_in || '').slice(0, 10);
  const checkOut = (b?.check_out || '').slice(0, 10);
  if (status === 'checked_out') return 'checked_out';
  if (status === 'checked_in') return checkOut === today ? 'departing' : 'inhouse';
  if (checkIn === today) return 'checkin_today';
  return 'confirmed';
};

const roomCodeForBooking = (b) => {
  const rt = b?.rooms?.room_types;
  return rt?.code || ROOM_TYPE_PRESETS[rt?.name]?.code || '';
};

const CalendarView = ({ bookings = [], getOutstandingBalance, onOpenFolio }) => {
  const today = localTodayISO();
  // Active window = { year, month, half } where half 0 -> days 1..15, 1 -> 16..end.
  const [view, setView] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), half: d.getDate() > HALF_SPLIT ? 1 : 0 };
  });
  const [jumpOpen, setJumpOpen] = useState(false);
  // Clicked reservation popover: { booking, left, top } in viewport (fixed) coords.
  const [popover, setPopover] = useState(null);

  const { year, month, half } = view;
  const daysInMonth = new Date(year, month + 1, 0).getDate(); // correct for 28/29/30/31
  const startDay = half === 0 ? 1 : HALF_SPLIT + 1;
  const endDay = half === 0 ? Math.min(HALF_SPLIT, daysInMonth) : daysInMonth;
  const numDays = endDay - startDay + 1;
  const windowStartISO = toISO(year, month, startDay);
  const windowEndISO = toISO(year, month, endDay);

  const days = useMemo(() => {
    const out = [];
    for (let d = startDay; d <= endDay; d++) {
      const date = new Date(year, month, d);
      out.push({
        day: d,
        iso: toISO(year, month, d),
        weekday: WEEKDAYS[date.getDay()],
        monthShort: MONTHS_SHORT[month],
        isToday: toISO(year, month, d) === today
      });
    }
    return out;
  }, [year, month, startDay, endDay, today]);

  // Column index (0-based) of a date within the active half-month window.
  const dayIndexOf = (iso) => {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    const first = new Date(year, month, startDay);
    return Math.round((d.getTime() - first.getTime()) / 86400000);
  };
  const clampIdx = (i) => Math.max(0, Math.min(numDays - 1, i));

  // Active reservations intersecting the visible window, grouped by room type,
  // then packed into vertical lanes so overlaps stack without breaking alignment.
  const rows = useMemo(() => {
    const visible = bookings.filter(b => {
      const status = b?.booking_status;
      if (status === 'cancelled' || status === 'no_show') return false;
      const ci = (b?.check_in || '').slice(0, 10);
      const co = (b?.check_out || '').slice(0, 10);
      if (!ci || !co) return false;
      return ci <= windowEndISO && co >= windowStartISO;
    });

    return ROOM_TYPE_ROWS.map(typeName => {
      const typeBookings = visible
        .filter(b => b?.rooms?.room_types?.name === typeName)
        .map(b => {
          const startIdx = clampIdx(dayIndexOf(b.check_in.slice(0, 10)));
          const endIdx = clampIdx(dayIndexOf(b.check_out.slice(0, 10)));
          return { booking: b, startIdx, endIdx };
        })
        .sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

      const laneEnds = [];
      typeBookings.forEach(item => {
        let lane = laneEnds.findIndex(end => end < item.startIdx);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.endIdx); }
        else { laneEnds[lane] = item.endIdx; }
        item.lane = lane;
      });
      return { typeName, items: typeBookings, laneCount: Math.max(1, laneEnds.length) };
    });
    // clampIdx/dayIndexOf derive purely from the window bounds (already listed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, windowStartISO, windowEndISO, year, month, startDay, numDays]);

  const rowHeight = (laneCount) => laneCount * BAR_H + (laneCount - 1) * BAR_GAP + ROW_PAD * 2;

  // Half-month stepping.
  const goPrev = () => setView(v => v.half === 1
    ? { ...v, half: 0 }
    : (() => { const d = new Date(v.year, v.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth(), half: 1 }; })());
  const goNext = () => setView(v => v.half === 0
    ? { ...v, half: 1 }
    : (() => { const d = new Date(v.year, v.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth(), half: 0 }; })());
  const goToday = () => {
    const d = new Date();
    setView({ year: d.getFullYear(), month: d.getMonth(), half: d.getDate() > HALF_SPLIT ? 1 : 0 });
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setPopover(null); setJumpOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Deterministic popover placement: BELOW for the top 3 room types, ABOVE for
  // the bottom 4. Always clamped inside the viewport.
  const openPopover = (e, booking) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const typeIdx = ROOM_TYPE_ROWS.indexOf(booking?.rooms?.room_types?.name);
    const below = typeIdx > -1 && typeIdx < 3;
    const pad = 12;
    let left = rect.left + rect.width / 2 - POPOVER_W / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - POPOVER_W - pad));
    let top = below ? rect.bottom + 8 : rect.top - POPOVER_H - 8;
    top = Math.max(pad, Math.min(top, window.innerHeight - POPOVER_H - pad));
    setPopover({ booking, left, top });
  };

  const years = useMemo(() => {
    const base = new Date().getFullYear();
    const out = [];
    for (let y = base - 5; y <= base + 5; y++) out.push(y);
    return out;
  }, []);

  return (
    <div className="cal-view" onClick={() => { setPopover(null); setJumpOpen(false); }}>
      <div className="cal-header">
        <div className="cal-title-wrap">
          <button
            type="button"
            className="cal-title-btn"
            onClick={(e) => { e.stopPropagation(); setJumpOpen(o => !o); }}
            title="Jump to month / year"
          >
            {MONTHS_LONG[month]} {year} <span className="cal-caret">▾</span>
          </button>
          <span className="cal-half-badge">{MONTHS_SHORT[month]} {startDay}–{endDay}</span>
          {jumpOpen && (
            <div className="cal-jump" onClick={(e) => e.stopPropagation()}>
              <select value={month} onChange={(e) => setView(v => ({ ...v, month: Number(e.target.value) }))}>
                {MONTHS_LONG.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select value={year} onChange={(e) => setView(v => ({ ...v, year: Number(e.target.value) }))}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={half} onChange={(e) => setView(v => ({ ...v, half: Number(e.target.value) }))}>
                <option value={0}>Days 1–15</option>
                <option value={1}>Days 16–End</option>
              </select>
            </div>
          )}
        </div>
        <div className="cal-nav">
          <button type="button" className="cal-nav-btn" onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label="Previous half-month">‹</button>
          <button type="button" className="cal-nav-btn cal-today-btn" onClick={(e) => { e.stopPropagation(); goToday(); }}>Today</button>
          <button type="button" className="cal-nav-btn" onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label="Next half-month">›</button>
        </div>
      </div>

      <div className="cal-scroll">
        <div className="cal-matrix">
          {/* Header row: sticky corner + day columns */}
          <div className="cal-row cal-head-row">
            <div className="cal-corner" style={{ width: LABEL_W }}>Room</div>
            <div className="cal-track">
              {days.map(d => (
                <div key={d.iso} className={`cal-day-head ${d.isToday ? 'cal-today' : ''}`}>
                  <span className="cal-day-num">{d.day}</span>
                  <span className="cal-day-mon">{d.monthShort}</span>
                  <span className="cal-day-dow">{d.weekday}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Body rows: one per room type (skinny room-code label) */}
          {rows.map(row => (
            <div className="cal-row" key={row.typeName} style={{ height: rowHeight(row.laneCount) }}>
              <div className="cal-label" style={{ width: LABEL_W }} title={row.typeName}>{codeFor(row.typeName)}</div>
              <div className="cal-track">
                {days.map(d => (
                  <div key={d.iso} className={`cal-cell ${d.isToday ? 'cal-today-col' : ''}`} />
                ))}
                {row.items.map(item => {
                  const b = item.booking;
                  const meta = STATUS_META[resolveStatus(b, today)];
                  const span = item.endIdx - item.startIdx + 1;
                  const guest = `${b?.guests?.first_name || ''} ${b?.guests?.last_name || ''}`.trim();
                  const label = `${b?.rooms?.room_number ?? '—'}: ${guest || 'Guest'}`;
                  return (
                    <div
                      key={b.booking_id}
                      className="cal-bar"
                      title={label}
                      onClick={(e) => openPopover(e, b)}
                      style={{
                        left: `calc(${(item.startIdx / numDays) * 100}% + 2px)`,
                        width: `calc(${(span / numDays) * 100}% - 4px)`,
                        top: ROW_PAD + item.lane * (BAR_H + BAR_GAP),
                        height: BAR_H,
                        background: meta.color
                      }}
                    >
                      <span className="cal-bar-label">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status legend */}
      <div className="cal-legend">
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <div className="cal-legend-item" key={key}>
            <span className="cal-legend-swatch" style={{ background: meta.color }} />
            <span>{meta.label}</span>
          </div>
        ))}
      </div>

      {/* Room code legend */}
      <div className="cal-legend cal-code-legend">
        {ROOM_TYPE_ROWS.map(typeName => (
          <div className="cal-legend-item" key={typeName}>
            <span className="cal-code-tag">{codeFor(typeName)}</span>
            <span>{typeName}</span>
          </div>
        ))}
      </div>

      {/* Reservation popover */}
      {popover && (
        <div className="cal-popover" style={{ left: popover.left, top: popover.top }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="cal-popover-close" onClick={() => setPopover(null)} aria-label="Close">✕</button>
          <div className="cal-popover-name">
            {`${popover.booking?.guests?.first_name || ''} ${popover.booking?.guests?.last_name || ''}`.trim() || 'Guest'}
          </div>
          <div className="cal-popover-ref">{popover.booking?.booking_reference || 'No reference'}</div>
          <div className="cal-popover-row">
            <span>Room</span>
            <span>Room {popover.booking?.rooms?.room_number ?? '—'} • {roomCodeForBooking(popover.booking) || 'N/A'}</span>
          </div>
          <div className="cal-popover-row">
            <span>Stay</span>
            <span>{popover.booking?.check_in} → {popover.booking?.check_out}</span>
          </div>
          <div className="cal-popover-row">
            <span>Outstanding</span>
            <span className="cal-popover-balance">
              ${Number(getOutstandingBalance ? getOutstandingBalance(popover.booking) : 0).toFixed(2)} CAD
            </span>
          </div>
          <button
            type="button"
            className="tool-btn primary cal-popover-btn"
            onClick={() => { const id = popover.booking?.booking_id; setPopover(null); onOpenFolio?.(id); }}
          >
            Open Folio Details
          </button>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
