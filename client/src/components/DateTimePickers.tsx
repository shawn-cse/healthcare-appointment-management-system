import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseIso(str: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((str || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isSameDay(a: Date | null, b: Date | null): boolean {
  return Boolean(
    a &&
      b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
  );
}

interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  isDob?: boolean;
  minToday?: boolean;
  maxToday?: boolean;
  required?: boolean;
  className?: string;
}

export function GreenDatePicker({
  id,
  value,
  onChange,
  placeholder,
  isDob = false,
  minToday = false,
  maxToday = false,
  required = false,
  className = 'field-control',
}: DatePickerProps) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minDate = minToday ? today : null;
  const maxDate = isDob || maxToday ? today : null;

  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'days' | 'months' | 'years'>('days');
  const initial = parseIso(value);
  const [viewYear, setViewYear] = useState(() =>
    initial ? initial.getFullYear() : isDob ? today.getFullYear() - 25 : today.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(() =>
    initial ? initial.getMonth() : isDob ? 5 : today.getMonth()
  );
  const [decadeStart, setDecadeStart] = useState(() => Math.floor(viewYear / 12) * 12);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const selectedDate = parseIso(value);

  const updatePos = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const popW = 320;
    const popH = 360;
    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;
    if (top + popH > window.scrollY + window.innerHeight && rect.top - popH > 10) {
      top = rect.top + window.scrollY - popH - 8;
    }
    if (left + popW > window.innerWidth - 16) left = window.innerWidth - popW - 16;
    if (left < 16) left = 16;
    setPos({ top: Math.round(top), left: Math.round(left) });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onDocClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updatePos();
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cur = parseIso(value);
    if (cur) {
      setViewYear(cur.getFullYear());
      setViewMonth(cur.getMonth());
      setDecadeStart(Math.floor(cur.getFullYear() / 12) * 12);
    }
    setViewMode('days');
    setOpen((prev) => !prev);
  };

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = firstDayOfMonth + daysInMonth;
  const nextMonthCells = totalCells > 35 ? 42 - totalCells : 35 - totalCells;

  const dayCells: Array<{ date: Date; other: boolean }> = [];
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    dayCells.push({ date: new Date(viewYear, viewMonth - 1, daysInPrevMonth - i), other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    dayCells.push({ date: new Date(viewYear, viewMonth, d), other: false });
  }
  for (let d = 1; d <= nextMonthCells; d++) {
    dayCells.push({ date: new Date(viewYear, viewMonth + 1, d), other: true });
  }

  return (
    <div className="green-calendar-wrapper" ref={wrapperRef}>
      <input
        id={id}
        type="text"
        readOnly
        required={required}
        value={value}
        onClick={handleOpen}
        placeholder={
          placeholder || (isDob ? 'Select Date of Birth (YYYY-MM-DD)' : 'Select Date (YYYY-MM-DD)')
        }
        className={`${className} green-datepicker green-cal-input`}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="cal-input-clear"
          style={{ display: 'grid' }}
          aria-label="Clear date"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
            setOpen(false);
          }}
        >
          ✕
        </button>
      )}
      <button
        type="button"
        className="cal-input-btn"
        aria-label="Open calendar"
        onClick={handleOpen}
      >
        <svg
          className="icon cal-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="green-cal-popover is-open"
            style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
            role="dialog"
            aria-modal="true"
            aria-label="Calendar date picker"
            onClick={(e) => e.stopPropagation()}
          >
            {viewMode === 'days' && (
              <>
                <div className="gcal-header">
                  <button
                    type="button"
                    className="gcal-nav-btn"
                    onClick={() => {
                      if (viewMonth === 0) {
                        setViewMonth(11);
                        setViewYear((y) => y - 1);
                      } else {
                        setViewMonth((m) => m - 1);
                      }
                    }}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="gcal-title-btn"
                    onClick={() => setViewMode('months')}
                  >
                    <span>
                      {MONTHS[viewMonth]} {viewYear}
                    </span>
                    <svg
                      className="icon icon-caret"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      stroke="currentColor"
                      fill="none"
                      strokeWidth="2.5"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="gcal-nav-btn"
                    onClick={() => {
                      if (viewMonth === 11) {
                        setViewMonth(0);
                        setViewYear((y) => y + 1);
                      } else {
                        setViewMonth((m) => m + 1);
                      }
                    }}
                  >
                    ›
                  </button>
                </div>

                <div className="gcal-weekdays">
                  {WEEKDAYS.map((w) => (
                    <span key={w} className="gcal-weekday">
                      {w}
                    </span>
                  ))}
                </div>

                <div className="gcal-days-grid">
                  {dayCells.map((cell, idx) => {
                    const disabled =
                      Boolean(minDate && cell.date < minDate) ||
                      Boolean(maxDate && cell.date > maxDate);
                    const classes = ['gcal-day-cell'];
                    if (cell.other) classes.push('is-other-month');
                    if (isSameDay(cell.date, today)) classes.push('is-today');
                    if (isSameDay(cell.date, selectedDate)) classes.push('is-selected');
                    if (disabled) classes.push('is-disabled');
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={disabled}
                        className={classes.join(' ')}
                        onClick={() => {
                          onChange(formatIso(cell.date));
                          setOpen(false);
                        }}
                      >
                        {cell.date.getDate()}
                      </button>
                    );
                  })}
                </div>

                <div className="gcal-footer">
                  <button
                    type="button"
                    className="gcal-btn-text gcal-btn-muted"
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="gcal-btn-text"
                    onClick={() => {
                      onChange(formatIso(today));
                      setOpen(false);
                    }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className="gcal-btn-pill"
                    onClick={() => setOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </>
            )}

            {viewMode === 'months' && (
              <>
                <div className="gcal-header">
                  <button
                    type="button"
                    className="gcal-nav-btn"
                    onClick={() => setViewYear((y) => y - 1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="gcal-title-btn"
                    onClick={() => {
                      setDecadeStart(Math.floor(viewYear / 12) * 12);
                      setViewMode('years');
                    }}
                  >
                    <span>{viewYear}</span>
                    <small style={{ fontSize: 11, opacity: 0.8, marginLeft: 4 }}>
                      (Click for years)
                    </small>
                  </button>
                  <button
                    type="button"
                    className="gcal-nav-btn"
                    onClick={() => setViewYear((y) => y + 1)}
                  >
                    ›
                  </button>
                </div>
                <div className="gcal-months-grid">
                  {MONTHS_SHORT.map((mName, idx) => (
                    <button
                      key={mName}
                      type="button"
                      className={`gcal-month-pill ${idx === viewMonth ? 'is-current-view' : ''}`}
                      onClick={() => {
                        setViewMonth(idx);
                        setViewMode('days');
                      }}
                    >
                      {mName}
                    </button>
                  ))}
                </div>
              </>
            )}

            {viewMode === 'years' && (
              <>
                <div className="gcal-header">
                  <button
                    type="button"
                    className="gcal-nav-btn"
                    onClick={() => setDecadeStart((d) => d - 12)}
                  >
                    «
                  </button>
                  <div className="gcal-decade-title">
                    {decadeStart} – {decadeStart + 11}
                  </div>
                  <button
                    type="button"
                    className="gcal-nav-btn"
                    onClick={() => setDecadeStart((d) => d + 12)}
                  >
                    »
                  </button>
                </div>
                <div className="gcal-years-grid">
                  {Array.from({ length: 12 }, (_, idx) => decadeStart + idx).map((y) => {
                    const disabled = Boolean(maxDate && y > maxDate.getFullYear());
                    return (
                      <button
                        key={y}
                        type="button"
                        disabled={disabled}
                        className={`gcal-year-pill ${y === viewYear ? 'is-current-view' : ''} ${disabled ? 'is-disabled' : ''}`}
                        onClick={() => {
                          setViewYear(y);
                          setViewMode('months');
                        }}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

function parseTimeState(str: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec((str || '').trim());
  if (!m) return { hour12: 9, minute: 0, period: 'AM' };
  let h = Number(m[1]);
  const min = Math.min(55, Math.max(0, Math.round(Number(m[2]) / 5) * 5));
  let p: 'AM' | 'PM' = 'AM';
  if (m[3]) {
    p = m[3].toUpperCase() === 'PM' ? 'PM' : 'AM';
  } else if (h >= 12) {
    p = 'PM';
    h = h === 12 ? 12 : h - 12;
  } else {
    p = 'AM';
    h = h === 0 ? 12 : h;
  }
  return { hour12: Math.min(12, Math.max(1, h || 9)), minute: min, period: p };
}

function to24h(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  let h24 = hour12;
  if (period === 'PM' && h24 < 12) h24 += 12;
  if (period === 'AM' && h24 === 12) h24 = 0;
  return `${pad2(h24)}:${pad2(minute)}`;
}

interface TimePickerProps {
  id?: string;
  value: string;
  onChange: (val24: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export function GreenTimePicker({
  id,
  value,
  onChange,
  placeholder = 'HH:MM (e.g. 09:30 AM)',
  required = false,
  className = 'field-control',
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseTimeState(value);
  const [hour12, setHour12] = useState(parsed.hour12);
  const [minute, setMinute] = useState(parsed.minute);
  const [period, setPeriod] = useState<'AM' | 'PM'>(parsed.period);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const updatePos = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const popW = 330;
    const popH = 360;
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;
    if (rect.bottom + popH > window.innerHeight && rect.top > popH) {
      top = rect.top + window.scrollY - popH - 6;
    }
    if (left + popW > window.innerWidth) left = window.innerWidth - popW - 16;
    if (left < 10) left = 10;
    setPos({ top: Math.round(top), left: Math.round(left) });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onDocClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const st = parseTimeState(value);
    setHour12(st.hour12);
    setMinute(st.minute);
    setPeriod(st.period);
    setOpen((prev) => !prev);
  };

  const apply = (h: number, m: number, p: 'AM' | 'PM') => {
    setHour12(h);
    setMinute(m);
    setPeriod(p);
    onChange(to24h(h, m, p));
  };

  const current24 = to24h(hour12, minute, period);
  return (
    <div className="green-time-wrapper" ref={wrapperRef}>
      <input
        id={id}
        type="text"
        readOnly
        required={required}
        value={value ? `${pad2(parseTimeState(value).hour12)}:${pad2(parseTimeState(value).minute)} ${parseTimeState(value).period}` : ''}
        onClick={handleOpen}
        placeholder={placeholder}
        className={`${className} green-timepicker green-time-input`}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="time-input-clear"
          style={{ display: 'grid' }}
          title="Clear time"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
          }}
        >
          ✕
        </button>
      )}
      <button
        type="button"
        className="time-input-btn"
        title="Select Consultation Time"
        onClick={handleOpen}
      >
        <svg
          className="time-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="green-time-popover is-open"
            style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gtime-columns-wrap">
              <div className="gtime-col">
                <div className="gtime-col-lbl">Hour</div>
                <div className="gtime-chips-scroll">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`gtime-chip ${h === hour12 ? 'is-selected' : ''}`}
                      onClick={() => apply(h, minute, period)}
                    >
                      {pad2(h)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="gtime-col">
                <div className="gtime-col-lbl">Minute</div>
                <div className="gtime-chips-scroll">
                  {Array.from({ length: 60 }, (_, m) => m).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`gtime-chip ${m === minute ? 'is-selected' : ''}`}
                      onClick={() => apply(hour12, m, period)}
                    >
                      {pad2(m)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="gtime-col">
                <div className="gtime-col-lbl">Period</div>
                <div className="gtime-period-group">
                  {(['AM', 'PM'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`gtime-period-btn ${period === p ? 'is-selected' : ''}`}
                      onClick={() => apply(hour12, minute, p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="gtime-footer">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="gtime-btn-text gtime-btn-muted"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="gtime-btn-pill"
                  onClick={() => {
                    onChange(current24);
                    setOpen(false);
                  }}
                >
                  Set Time
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
