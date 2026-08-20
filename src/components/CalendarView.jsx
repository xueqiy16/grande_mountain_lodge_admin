import React, { useState, useMemo, useEffect } from 'react';
import { ROOM_TYPE_PRESETS } from '../lib/constants';

// Tape-chart inventory: room types in display order, each with its physical rooms.
const ROOM_GROUPS = [
  { code: 'STD-Q-NS',  typeName: 'Standard Queen Non-Smoking',      rooms: [225, 226] },
  { code: 'STU-Q-NS',  typeName: 'Studio Queen Non-Smoking',        rooms: [105, 113, 116, 122, 123, 207, 210, 212, 213, 219, 222] },
  { code: 'STU-Q-SM',  typeName: 'Studio Queen Smoking',            rooms: [205] },
  { code: 'STU-QQ-NS', typeName: 'Studio Double Queen Non-Smoking', rooms: [101, 102, 103, 108, 109, 111, 112, 114, 118, 120, 209, 211, 214, 215, 217, 218, 220, 221, 223] },
  { code: 'STU-QQ-SM', typeName: 'Studio Double Queen Smoking',     rooms: [202, 203, 208] },
  { code: 'STE-K-NS',  typeName: 'Suite King Non-Smoking',          rooms: [227] },
  { code: 'STE-Q-NS',  typeName: 'Suite Queen Non-Smoking',         rooms: [216, 224] }
];

const ROOM_ROWS = ROOM_GROUPS.flatMap((g, groupIdx) =>
  g.rooms.map((roomNumber, i) => ({
    code: g.code,
    typeName: g.typeName,
    roomNumber: String(roomNumber),
    groupIdx,
    isFirstInGroup: i === 0,
    isLastInGroup: i === g.rooms.length - 1
  }))
);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Layout constants. Day columns are flexible (flex:1) so the whole half-month
// span fits the container width with NO horizontal scroll.
const TYPE_W = 78;     // px sticky Type column
const ROOM_W = 52;     // px sticky Room number column
const LABEL_W = TYPE_W + ROOM_W;
const BAR_H = 22;
const BAR_GAP = 3;
const ROW_PAD = 5;
const HALF_SPLIT = 15;
const POPOVER_W = 320;
const POPOVER_H = 250;
const RIGHT_MARGIN = 48;
const LEFT_MARGIN = 16;
const EDGE_PAD = 16;

const toISO = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const localTodayISO = () => {
  const d = new Date();
  return toISO(d.getFullYear(), d.getMonth(), d.getDate());
};

const STATUS_META = {
  confirmed:     { label: 'Confirmed',       color: '#f97316' },
  checkin_today: { label: 'Check In Today',  color: '#eab308' },
  inhouse:       { label: 'In House',        color: '#22c55e' },
  departing:     { label: 'Departing Today', color: '#3b82f6' },
  checked_out:   { label: 'Checked Out',     color: '#94a3b8' }
};

const resolveStatus = (b, today) => {
  const status = b?.booking_status;
  const checkIn = (b?.check_in || '').slice(0, 10);
  const checkOut = (b?.check_out || '').slice(0, 10);
  if (status === 'checked_out') return 'checked_out';
  if (status === 'checked_in') return checkOut === today ? 'departing' : 'inhouse';
  if (checkIn === today) return 'checkin_today';
  return 'confirmed';
};

const guestFullName = (b) =>
  `${b?.guests?.first_name || ''} ${b?.guests?.last_name || ''}`.replace(/\s+/g, ' ').trim() || 'Guest';

const roomNumberOf = (b) => String(b?.rooms?.room_number ?? b?.room_number ?? b?.room ?? '').trim();

const roomCodeForBooking = (b) => {
  const rt = b?.rooms?.room_types;
  return rt?.code || ROOM_TYPE_PRESETS[rt?.name]?.code || '';
};

const CalendarView = ({ bookings = [], getOutstandingBalance, onOpenFolio }) => {
  const today = localTodayISO();
  const [view, setView] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), half: d.getDate() > HALF_SPLIT ? 1 : 0 };
  });
  const [jumpOpen, setJumpOpen] = useState(false);
  const [popover, setPopover] = useState(null);

  const { year, month, half } = view;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
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

  const dayIndexOf = (iso) => {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    const first = new Date(year, month, startDay);
    return Math.round((d.getTime() - first.getTime()) / 86400000);
  };
  const clampIdx = (i) => Math.max(0, Math.min(numDays - 1, i));

  // One timeline track per physical room. Bookings land on a row only when the
  // booking's room number matches that row. Overlaps on the same room stack.
  const rows = useMemo(() => {
    const visible = bookings.filter(b => {
      const status = b?.booking_status;
      if (status === 'cancelled' || status === 'no_show') return false;
      const ci = (b?.check_in || '').slice(0, 10);
      const co = (b?.check_out || '').slice(0, 10);
      if (!ci || !co) return false;
      return ci <= windowEndISO && co >= windowStartISO;
    });

    return ROOM_ROWS.map(meta => {
      const items = visible
        .filter(b => roomNumberOf(b) === meta.roomNumber)
        .map(b => {
          const startIdx = clampIdx(dayIndexOf(b.check_in.slice(0, 10)));
          const endIdx = clampIdx(dayIndexOf(b.check_out.slice(0, 10)));
          return { booking: b, startIdx, endIdx };
        })
        .sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

      const laneEnds = [];
      items.forEach(item => {
        let lane = laneEnds.findIndex(end => end < item.startIdx);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.endIdx); }
        else { laneEnds[lane] = item.endIdx; }
        item.lane = lane;
      });
      return { ...meta, items, laneCount: Math.max(1, laneEnds.length) };
    });
    // clampIdx/dayIndexOf derive purely from the window bounds (already listed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, windowStartISO, windowEndISO, year, month, startDay, numDays]);

  const groupedRows = useMemo(() => {
    const groups = [];
    let current = null;
    rows.forEach(row => {
      if (!current || current.code !== row.code) {
        current = { code: row.code, typeName: row.typeName, rooms: [] };
        groups.push(current);
      }
      current.rooms.push(row);
    });
    return groups;
  }, [rows]);

  const rowHeight = (laneCount) => laneCount * BAR_H + (laneCount - 1) * BAR_GAP + ROW_PAD * 2;

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

  // Popover: below for the first 3 room-type groups, above for the rest.
  const openPopover = (e, booking) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const groupIdx = ROOM_GROUPS.findIndex(g => g.typeName === booking?.rooms?.room_types?.name);
    const below = groupIdx > -1 && groupIdx < 3;

    const calculatedLeft = rect.left + rect.width / 2 - POPOVER_W / 2;
    const maxLeft = window.innerWidth - POPOVER_W - RIGHT_MARGIN;
    const left = Math.min(Math.max(calculatedLeft, LEFT_MARGIN), Math.max(LEFT_MARGIN, maxLeft));

    let top = below ? rect.bottom + 8 : rect.top - POPOVER_H - 8;
    top = Math.max(EDGE_PAD, Math.min(top, window.innerHeight - POPOVER_H - EDGE_PAD));
    setPopover({ booking, left, top });
  };

  const years = useMemo(() => {
    const base = new Date().getFullYear();
    const out = [];
    for (let y = base - 5; y <= base + 5; y++) out.push(y);
    return out;
  }, []);

  const barTooltip = (b) => {
    const statusKey = resolveStatus(b, today);
    const balance = Number(getOutstandingBalance ? getOutstandingBalance(b) : 0).toFixed(2);
    return [
      guestFullName(b),
      `${b?.check_in} → ${b?.check_out}`,
      `Status: ${STATUS_META[statusKey]?.label || statusKey}`,
      `Outstanding: $${balance} CAD`
    ].join('\n');
  };

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
          <div className="cal-row cal-head-row">
            <div className="cal-corner-pair" style={{ width: LABEL_W }}>
              <div className="cal-corner cal-type-col" style={{ width: TYPE_W }}>Type</div>
              <div className="cal-corner cal-room-col" style={{ width: ROOM_W }}>Room</div>
            </div>
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

          {groupedRows.map(group => (
            <div className="cal-group" key={group.code}>
              <div className="cal-type-span" style={{ width: TYPE_W }} title={group.typeName}>
                {group.code}
              </div>
              <div className="cal-group-body">
                {group.rooms.map(row => (
                  <div
                    className="cal-row"
                    key={`${row.code}-${row.roomNumber}`}
                    style={{ height: rowHeight(row.laneCount) }}
                  >
                    <div className="cal-room-cell" style={{ width: ROOM_W }}>{row.roomNumber}</div>
                    <div className="cal-track">
                      {days.map(d => (
                        <div key={d.iso} className={`cal-cell ${d.isToday ? 'cal-today-col' : ''}`} />
                      ))}
                      {row.items.map(item => {
                        const b = item.booking;
                        const meta = STATUS_META[resolveStatus(b, today)];
                        const span = item.endIdx - item.startIdx + 1;
                        const name = guestFullName(b);
                        return (
                          <div
                            key={b.booking_id}
                            className="cal-bar"
                            title={barTooltip(b)}
                            onClick={(e) => openPopover(e, b)}
                            style={{
                              left: `calc(${(item.startIdx / numDays) * 100}% + 2px)`,
                              width: `calc(${(span / numDays) * 100}% - 4px)`,
                              top: ROW_PAD + item.lane * (BAR_H + BAR_GAP),
                              height: BAR_H,
                              background: meta.color
                            }}
                          >
                            <span className="cal-bar-label">{name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cal-legend">
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <div className="cal-legend-item" key={key}>
            <span className="cal-legend-swatch" style={{ background: meta.color }} />
            <span>{meta.label}</span>
          </div>
        ))}
      </div>

      <div className="cal-legend cal-code-legend">
        {ROOM_GROUPS.map(g => (
          <div className="cal-legend-item" key={g.code}>
            <span className="cal-code-tag">{g.code}</span>
            <span>{g.typeName}</span>
          </div>
        ))}
      </div>

      {popover && (
        <div className="cal-popover" style={{ left: popover.left, top: popover.top }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="cal-popover-close" onClick={() => setPopover(null)} aria-label="Close">✕</button>
          <div className="cal-popover-name">{guestFullName(popover.booking)}</div>
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
            <span>Status</span>
            <span>{STATUS_META[resolveStatus(popover.booking, today)]?.label}</span>
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
