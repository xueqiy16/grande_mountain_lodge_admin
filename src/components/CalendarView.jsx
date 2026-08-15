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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Layout constants shared between JS bar math and inline cell widths (keeps the
// day columns, header, and reservation bars pixel-aligned).
const DAY_W = 52;      // px per day column
const LABEL_W = 200;   // px for the sticky room-type column
const BAR_H = 24;      // px reservation bar height
const BAR_GAP = 4;     // px vertical gap between stacked (overlapping) bars
const ROW_PAD = 8;     // px vertical padding inside a room-type row

// Local YYYY-MM-DD (never toISOString(), which is UTC and can shift a day).
const toISO = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const localTodayISO = () => {
  const d = new Date();
  return toISO(d.getFullYear(), d.getMonth(), d.getDate());
};

// Status legend (dynamic operational status relative to today).
const STATUS_META = {
  confirmed:     { label: 'Confirmed',      color: '#f97316' }, // orange
  checkin_today: { label: 'Check In Today', color: '#eab308' }, // yellow
  inhouse:       { label: 'In House',       color: '#22c55e' }, // green
  departing:     { label: 'Departing Today', color: '#3b82f6' }, // blue
  checked_out:   { label: 'Checked Out',    color: '#94a3b8' }  // gray
};

// Resolve a reservation's dynamic status from booking_status + today's date.
const resolveStatus = (b, today) => {
  const status = b?.booking_status;
  const checkIn = (b?.check_in || '').slice(0, 10);
  const checkOut = (b?.check_out || '').slice(0, 10);
  if (status === 'checked_out') return 'checked_out';
  if (status === 'checked_in') return checkOut === today ? 'departing' : 'inhouse';
  // confirmed (or any other active-ish state): arriving today vs. future/other.
  if (checkIn === today) return 'checkin_today';
  return 'confirmed';
};

const roomCodeFor = (b) => {
  const rt = b?.rooms?.room_types;
  return rt?.code || ROOM_TYPE_PRESETS[rt?.name]?.code || '';
};

const CalendarView = ({ bookings = [], getOutstandingBalance, onOpenFolio }) => {
  const today = localTodayISO();
  // Active view anchored to the FIRST of the month (avoids month-length drift).
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [jumpOpen, setJumpOpen] = useState(false);
  // Clicked reservation popover: { booking, x, y } in viewport (fixed) coords.
  const [popover, setPopover] = useState(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  // new Date(year, month + 1, 0) → last day of the month; correct for 28/29/30/31.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstISO = toISO(year, month, 1);
  const lastISO = toISO(year, month, daysInMonth);

  const days = useMemo(() => {
    const out = [];
    for (let d = 1; d <= daysInMonth; d++) {
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
  }, [year, month, daysInMonth, today]);

  // Column index (0-based) of a date within the active month grid.
  const dayIndexOf = (iso) => {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    const first = new Date(year, month, 1);
    return Math.round((d.getTime() - first.getTime()) / 86400000);
  };
  const clampIdx = (i) => Math.max(0, Math.min(daysInMonth - 1, i));

  // Active reservations intersecting the visible month, grouped by room type,
  // then packed into vertical lanes so overlaps stack without breaking alignment.
  const rows = useMemo(() => {
    const visible = bookings.filter(b => {
      const status = b?.booking_status;
      if (status === 'cancelled' || status === 'no_show') return false;
      const ci = (b?.check_in || '').slice(0, 10);
      const co = (b?.check_out || '').slice(0, 10);
      if (!ci || !co) return false;
      // Range intersects the month: check_in <= lastDay AND check_out >= firstDay.
      return ci <= lastISO && co >= firstISO;
    });

    return ROOM_TYPE_ROWS.map(typeName => {
      const typeBookings = visible
        .filter(b => b?.rooms?.room_types?.name === typeName)
        .map(b => {
          const ci = b.check_in.slice(0, 10);
          const co = b.check_out.slice(0, 10);
          const startIdx = clampIdx(dayIndexOf(ci));
          const endIdx = clampIdx(dayIndexOf(co));
          return { booking: b, startIdx, endIdx };
        })
        .sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

      // Greedy lane packing: place each bar in the first lane whose last bar ends
      // before this one starts; otherwise open a new lane (row grows taller).
      const laneEnds = []; // last endIdx per lane
      typeBookings.forEach(item => {
        let lane = laneEnds.findIndex(end => end < item.startIdx);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.endIdx); }
        else { laneEnds[lane] = item.endIdx; }
        item.lane = lane;
      });
      const laneCount = Math.max(1, laneEnds.length);
      return { typeName, items: typeBookings, laneCount };
    });
    // clampIdx/dayIndexOf derive purely from year/month/daysInMonth (already listed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, firstISO, lastISO, year, month, daysInMonth]);

  const gridWidth = daysInMonth * DAY_W;
  const rowHeight = (laneCount) => laneCount * BAR_H + (laneCount - 1) * BAR_GAP + ROW_PAD * 2;

  const goPrev = () => setViewDate(new Date(year, month - 1, 1));
  const goNext = () => setViewDate(new Date(year, month + 1, 1));
  const goToday = () => { const d = new Date(); setViewDate(new Date(d.getFullYear(), d.getMonth(), 1)); };

  // Close the popover on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setPopover(null); setJumpOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openPopover = (e, booking) => {
    e.stopPropagation();
    // Anchor near the click (checkout end of the bar), clamped to the viewport.
    const pad = 12;
    const width = 300;
    const x = Math.min(e.clientX, window.innerWidth - width - pad);
    const y = Math.min(e.clientY + 8, window.innerHeight - 240);
    setPopover({ booking, x: Math.max(pad, x), y: Math.max(pad, y) });
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
          {jumpOpen && (
            <div className="cal-jump" onClick={(e) => e.stopPropagation()}>
              <select
                value={month}
                onChange={(e) => setViewDate(new Date(year, Number(e.target.value), 1))}
              >
                {MONTHS_LONG.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select
                value={year}
                onChange={(e) => setViewDate(new Date(Number(e.target.value), month, 1))}
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="cal-nav">
          <button type="button" className="cal-nav-btn" onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label="Previous month">‹</button>
          <button type="button" className="cal-nav-btn cal-today-btn" onClick={(e) => { e.stopPropagation(); goToday(); }}>Today</button>
          <button type="button" className="cal-nav-btn" onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label="Next month">›</button>
        </div>
      </div>

      <div className="cal-scroll">
        <div className="cal-matrix" style={{ width: LABEL_W + gridWidth }}>
          {/* Header row: sticky corner + day columns */}
          <div className="cal-row cal-head-row">
            <div className="cal-corner" style={{ width: LABEL_W }}>Room Type</div>
            <div className="cal-track" style={{ width: gridWidth }}>
              {days.map(d => (
                <div
                  key={d.iso}
                  className={`cal-day-head ${d.isToday ? 'cal-today' : ''}`}
                  style={{ width: DAY_W }}
                >
                  <span className="cal-day-num">{d.day}</span>
                  <span className="cal-day-mon">{d.monthShort}</span>
                  <span className="cal-day-dow">{d.weekday}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Body rows: one per room type */}
          {rows.map(row => (
            <div className="cal-row" key={row.typeName} style={{ height: rowHeight(row.laneCount) }}>
              <div className="cal-label" style={{ width: LABEL_W }}>{row.typeName}</div>
              <div className="cal-track" style={{ width: gridWidth }}>
                {/* Day column backgrounds (today tint + gridlines) */}
                {days.map(d => (
                  <div
                    key={d.iso}
                    className={`cal-cell ${d.isToday ? 'cal-today-col' : ''}`}
                    style={{ width: DAY_W }}
                  />
                ))}
                {/* Reservation bars */}
                {row.items.map(item => {
                  const b = item.booking;
                  const st = resolveStatus(b, today);
                  const meta = STATUS_META[st];
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
                        left: item.startIdx * DAY_W + 2,
                        width: Math.max(DAY_W - 4, span * DAY_W - 4),
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

      {/* Legend */}
      <div className="cal-legend">
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <div className="cal-legend-item" key={key}>
            <span className="cal-legend-swatch" style={{ background: meta.color }} />
            <span>{meta.label}</span>
          </div>
        ))}
      </div>

      {/* Reservation popover */}
      {popover && (
        <div
          className="cal-popover"
          style={{ left: popover.x, top: popover.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="cal-popover-close" onClick={() => setPopover(null)} aria-label="Close">✕</button>
          <div className="cal-popover-name">
            {`${popover.booking?.guests?.first_name || ''} ${popover.booking?.guests?.last_name || ''}`.trim() || 'Guest'}
          </div>
          <div className="cal-popover-ref">{popover.booking?.booking_reference || 'No reference'}</div>
          <div className="cal-popover-row">
            <span>Room</span>
            <span>Room {popover.booking?.rooms?.room_number ?? '—'} • {roomCodeFor(popover.booking) || 'N/A'}</span>
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
