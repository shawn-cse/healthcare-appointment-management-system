/**
 * Green Hospital - Premium Clinical Calendar & DatePicker
 * Built for clarity, accessibility, and high performance.
 * Replaces clunky native browser popups with a modern, emerald clinical datepicker.
 */

'use strict';

(function () {
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatISO(year, month, day) {
    return `${year}-${pad(month + 1)}-${pad(day)}`;
  }

  function parseISO(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return new Date(y, m, d);
      }
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function getToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  }

  class GreenCalendar {
    constructor(input) {
      if (input._greenCalendar) return input._greenCalendar;
      this.input = input;
      this.input._greenCalendar = this;

      // Extract constraints
      this.isDob = input.id === 'id_dob' ||
                   input.name === 'dob' ||
                   input.dataset.mode === 'dob' ||
                   (input.getAttribute('aria-label') || '').toLowerCase().includes('birth');

      const today = getToday();
      this.today = today;

      // Min constraint
      const minAttr = input.getAttribute('min') || input.dataset.min;
      if (minAttr === 'today') {
        this.minDate = today;
      } else if (minAttr) {
        this.minDate = parseISO(minAttr);
      } else {
        this.minDate = null;
      }

      // Max constraint
      const maxAttr = input.getAttribute('max') || input.dataset.max;
      if (this.isDob || maxAttr === 'today') {
        this.maxDate = today;
      } else if (maxAttr) {
        this.maxDate = parseISO(maxAttr);
      } else {
        this.maxDate = null;
      }

      // Initial date state
      const initialDate = parseISO(input.value);
      this.selectedDate = initialDate;

      if (initialDate) {
        this.viewYear = initialDate.getFullYear();
        this.viewMonth = initialDate.getMonth();
      } else if (this.isDob) {
        // For DOB, default viewing to ~25 years ago for instant convenience
        this.viewYear = today.getFullYear() - 25;
        this.viewMonth = 5;
      } else {
        this.viewYear = today.getFullYear();
        this.viewMonth = today.getMonth();
      }

      // View mode: 'days', 'months', 'years'
      this.viewMode = 'days';
      this.decadeStart = Math.floor(this.viewYear / 12) * 12;

      this.isOpen = false;
      this.initDOM();
      this.attachEvents();
    }

    initDOM() {
      // Prevent browser default date picker from popping up
      this.input.type = 'text';
      this.input.autocomplete = 'off';
      this.input.spellcheck = false;
      this.input.setAttribute('inputmode', 'none'); // Prevents mobile soft keyboard blocking calendar
      if (!this.input.placeholder) {
        this.input.placeholder = this.isDob ? 'Select Date of Birth (YYYY-MM-DD)' : 'Select Date (YYYY-MM-DD)';
      }

      // Ensure class
      this.input.classList.add('green-cal-input');

      // Wrap input if not already wrapped
      let wrapper = this.input.closest('.green-calendar-wrapper');
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'green-calendar-wrapper';
        this.input.parentNode.insertBefore(wrapper, this.input);
        wrapper.appendChild(this.input);
      }
      this.wrapper = wrapper;

      // Calendar button icon
      let toggleBtn = wrapper.querySelector('.cal-input-btn');
      if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'cal-input-btn';
        toggleBtn.setAttribute('aria-label', 'Open calendar');
        toggleBtn.innerHTML = `
          <svg class="icon cal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>`;
        wrapper.appendChild(toggleBtn);
      }
      this.toggleBtn = toggleBtn;

      // Quick Clear button (shown when value exists)
      let clearBtn = wrapper.querySelector('.cal-input-clear');
      if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'cal-input-clear';
        clearBtn.setAttribute('aria-label', 'Clear date');
        clearBtn.innerHTML = '✕';
        wrapper.appendChild(clearBtn);
      }
      this.inputClearBtn = clearBtn;
      this.updateClearBtnVisibility();

      // Create Popover
      this.popover = document.createElement('div');
      this.popover.className = 'green-cal-popover';
      this.popover.setAttribute('role', 'dialog');
      this.popover.setAttribute('aria-modal', 'true');
      this.popover.setAttribute('aria-label', 'Calendar date picker');
      this.popover.tabIndex = -1;

      // Append popover to body to avoid clipping in parent overflow containers
      document.body.appendChild(this.popover);
    }

    updateClearBtnVisibility() {
      if (this.inputClearBtn) {
        this.inputClearBtn.style.display = this.input.value.trim() ? 'grid' : 'none';
      }
    }

    attachEvents() {
      // Clicking input or toggle button opens calendar
      const openHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      };

      this.input.addEventListener('click', openHandler);
      this.toggleBtn.addEventListener('click', openHandler);

      // Clear button
      this.inputClearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.setDate(null);
        this.close();
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        if (!this.wrapper.contains(e.target) && !this.popover.contains(e.target)) {
          this.close();
        }
      });

      // Keyboard support
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.close();
        } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
          if (!this.isOpen) {
            e.preventDefault();
            this.open();
          }
        }
      });

      // Window resize / scroll reposition
      window.addEventListener('resize', () => {
        if (this.isOpen) this.positionPopover();
      });
      window.addEventListener('scroll', () => {
        if (this.isOpen) this.positionPopover();
      }, true);
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    open() {
      // Close any other open calendar instances
      document.querySelectorAll('.green-cal-popover.is-open').forEach((p) => {
        p.classList.remove('is-open');
      });

      // Sync state with current input value
      const current = parseISO(this.input.value);
      if (current) {
        this.selectedDate = current;
        this.viewYear = current.getFullYear();
        this.viewMonth = current.getMonth();
      }
      this.viewMode = 'days';
      this.decadeStart = Math.floor(this.viewYear / 12) * 12;

      this.render();
      this.popover.classList.add('is-open');
      this.isOpen = true;
      this.positionPopover();
    }

    close() {
      if (!this.isOpen) return;
      this.popover.classList.remove('is-open');
      this.isOpen = false;
    }

    positionPopover() {
      if (!this.isOpen) return;
      const rect = this.wrapper.getBoundingClientRect();
      const popoverRect = this.popover.getBoundingClientRect();
      const popoverHeight = popoverRect.height || 360;
      const popoverWidth = popoverRect.width || 320;

      let top = rect.bottom + window.scrollY + 8;
      let left = rect.left + window.scrollX;

      // Check if overflowing viewport bottom
      const viewportBottom = window.scrollY + window.innerHeight;
      if (top + popoverHeight > viewportBottom && rect.top - popoverHeight > 10) {
        // Place above input
        top = rect.top + window.scrollY - popoverHeight - 8;
      }

      // Check right overflow
      if (left + popoverWidth > window.innerWidth - 16) {
        left = window.innerWidth - popoverWidth - 16;
      }
      if (left < 16) left = 16;

      this.popover.style.top = `${Math.round(top)}px`;
      this.popover.style.left = `${Math.round(left)}px`;
    }

    setDate(date) {
      this.selectedDate = date;
      if (date) {
        const iso = formatISO(date.getFullYear(), date.getMonth(), date.getDate());
        this.input.value = iso;
      } else {
        this.input.value = '';
      }
      this.updateClearBtnVisibility();

      // Trigger change and input events
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
      this.input.dispatchEvent(new Event('change', { bubbles: true }));

      // Handle auto-submit if parent form has auto-submit class
      const autoForm = this.input.closest('form.custom-date-picker, form[data-auto-submit]');
      if (autoForm) {
        autoForm.submit();
      }
    }

    render() {
      this.popover.innerHTML = '';

      if (this.viewMode === 'days') {
        this.renderDaysView();
      } else if (this.viewMode === 'months') {
        this.renderMonthsView();
      } else if (this.viewMode === 'years') {
        this.renderYearsView();
      }
    }

    /* -------------------------------------------------------------------------
       Days View
       ------------------------------------------------------------------------- */
    renderDaysView() {
      const header = document.createElement('div');
      header.className = 'gcal-header';

      // Prev Month
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'gcal-nav-btn';
      prevBtn.innerHTML = '‹';
      prevBtn.setAttribute('aria-label', 'Previous month');
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        this.viewMonth--;
        if (this.viewMonth < 0) {
          this.viewMonth = 11;
          this.viewYear--;
        }
        this.render();
      };

      // Month & Year title button (switches to Year/Month view)
      const titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.className = 'gcal-title-btn';
      titleBtn.innerHTML = `
        <span>${MONTHS[this.viewMonth]} ${this.viewYear}</span>
        <svg class="icon icon-caret" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      `;
      titleBtn.setAttribute('aria-label', 'Switch to month and year selection');
      titleBtn.onclick = (e) => {
        e.stopPropagation();
        this.viewMode = 'months';
        this.render();
      };

      // Next Month
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'gcal-nav-btn';
      nextBtn.innerHTML = '›';
      nextBtn.setAttribute('aria-label', 'Next month');
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        this.viewMonth++;
        if (this.viewMonth > 11) {
          this.viewMonth = 0;
          this.viewYear++;
        }
        this.render();
      };

      header.appendChild(prevBtn);
      header.appendChild(titleBtn);
      header.appendChild(nextBtn);
      this.popover.appendChild(header);

      // Weekday Row
      const weekdaysRow = document.createElement('div');
      weekdaysRow.className = 'gcal-weekdays';
      WEEKDAYS.forEach((w) => {
        const el = document.createElement('span');
        el.className = 'gcal-weekday';
        el.textContent = w;
        weekdaysRow.appendChild(el);
      });
      this.popover.appendChild(weekdaysRow);

      // Days Grid
      const daysGrid = document.createElement('div');
      daysGrid.className = 'gcal-days-grid';

      const firstDayOfMonth = new Date(this.viewYear, this.viewMonth, 1).getDay();
      const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
      const daysInPrevMonth = new Date(this.viewYear, this.viewMonth, 0).getDate();

      // Overflow days from previous month
      for (let i = firstDayOfMonth - 1; i >= 0; i--) {
        const dayNum = daysInPrevMonth - i;
        const d = new Date(this.viewYear, this.viewMonth - 1, dayNum);
        daysGrid.appendChild(this.createDayCell(d, true));
      }

      // Days in current month
      for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        const d = new Date(this.viewYear, this.viewMonth, dayNum);
        daysGrid.appendChild(this.createDayCell(d, false));
      }

      // Overflow days into next month (fill up 42 total cells for constant height)
      const totalCells = firstDayOfMonth + daysInMonth;
      const nextMonthCells = totalCells > 35 ? 42 - totalCells : 35 - totalCells;
      for (let dayNum = 1; dayNum <= nextMonthCells; dayNum++) {
        const d = new Date(this.viewYear, this.viewMonth + 1, dayNum);
        daysGrid.appendChild(this.createDayCell(d, true));
      }

      this.popover.appendChild(daysGrid);

      // Quick Action Footer
      const footer = document.createElement('div');
      footer.className = 'gcal-footer';

      const todayBtn = document.createElement('button');
      todayBtn.type = 'button';
      todayBtn.className = 'gcal-btn-text';
      todayBtn.textContent = 'Today';
      todayBtn.onclick = (e) => {
        e.stopPropagation();
        this.setDate(this.today);
        this.close();
      };

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'gcal-btn-text gcal-btn-muted';
      clearBtn.textContent = 'Clear';
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        this.setDate(null);
        this.close();
      };

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'gcal-btn-pill';
      closeBtn.textContent = 'Done';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.close();
      };

      footer.appendChild(clearBtn);
      footer.appendChild(todayBtn);
      footer.appendChild(closeBtn);
      this.popover.appendChild(footer);
    }

    createDayCell(date, isOtherMonth) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gcal-day-cell';
      btn.textContent = date.getDate();
      btn.setAttribute('aria-label', `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`);

      if (isOtherMonth) {
        btn.classList.add('is-other-month');
      }

      if (isSameDay(date, this.today)) {
        btn.classList.add('is-today');
      }

      if (isSameDay(date, this.selectedDate)) {
        btn.classList.add('is-selected');
      }

      // Check min/max bounds
      let isDisabled = false;
      if (this.minDate && date < this.minDate) {
        isDisabled = true;
      }
      if (this.maxDate && date > this.maxDate) {
        isDisabled = true;
      }

      if (isDisabled) {
        btn.classList.add('is-disabled');
        btn.disabled = true;
      } else {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.setDate(date);
          this.close();
        };
      }

      return btn;
    }

    /* -------------------------------------------------------------------------
       Months View (Fast 1-click Month Selector)
       ------------------------------------------------------------------------- */
    renderMonthsView() {
      const header = document.createElement('div');
      header.className = 'gcal-header';

      const prevYearBtn = document.createElement('button');
      prevYearBtn.type = 'button';
      prevYearBtn.className = 'gcal-nav-btn';
      prevYearBtn.innerHTML = '‹';
      prevYearBtn.setAttribute('aria-label', 'Previous year');
      prevYearBtn.onclick = (e) => {
        e.stopPropagation();
        this.viewYear--;
        this.render();
      };

      const yearBtn = document.createElement('button');
      yearBtn.type = 'button';
      yearBtn.className = 'gcal-title-btn';
      yearBtn.innerHTML = `<span>${this.viewYear}</span> <small style="font-size:11px; opacity:0.8; margin-left:4px;">(Click for years)</small>`;
      yearBtn.onclick = (e) => {
        e.stopPropagation();
        this.viewMode = 'years';
        this.decadeStart = Math.floor(this.viewYear / 12) * 12;
        this.render();
      };

      const nextYearBtn = document.createElement('button');
      nextYearBtn.type = 'button';
      nextYearBtn.className = 'gcal-nav-btn';
      nextYearBtn.innerHTML = '›';
      nextYearBtn.setAttribute('aria-label', 'Next year');
      nextYearBtn.onclick = (e) => {
        e.stopPropagation();
        this.viewYear++;
        this.render();
      };

      header.appendChild(prevYearBtn);
      header.appendChild(yearBtn);
      header.appendChild(nextYearBtn);
      this.popover.appendChild(header);

      const monthsGrid = document.createElement('div');
      monthsGrid.className = 'gcal-months-grid';

      MONTHS_SHORT.forEach((mName, idx) => {
        const mBtn = document.createElement('button');
        mBtn.type = 'button';
        mBtn.className = 'gcal-month-pill';
        mBtn.textContent = mName;

        if (idx === this.viewMonth) {
          mBtn.classList.add('is-current-view');
        }

        mBtn.onclick = (e) => {
          e.stopPropagation();
          this.viewMonth = idx;
          this.viewMode = 'days';
          this.render();
        };

        monthsGrid.appendChild(mBtn);
      });

      this.popover.appendChild(monthsGrid);
    }

    /* -------------------------------------------------------------------------
       Years View (Decade Jumping - Crucial for Date of Birth & Fast Navigation)
       ------------------------------------------------------------------------- */
    renderYearsView() {
      const header = document.createElement('div');
      header.className = 'gcal-header';

      const prevDecadeBtn = document.createElement('button');
      prevDecadeBtn.type = 'button';
      prevDecadeBtn.className = 'gcal-nav-btn';
      prevDecadeBtn.innerHTML = '«';
      prevDecadeBtn.setAttribute('aria-label', 'Previous decade');
      prevDecadeBtn.onclick = (e) => {
        e.stopPropagation();
        this.decadeStart -= 12;
        this.render();
      };

      const decadeTitle = document.createElement('div');
      decadeTitle.className = 'gcal-decade-title';
      decadeTitle.textContent = `${this.decadeStart} – ${this.decadeStart + 11}`;

      const nextDecadeBtn = document.createElement('button');
      nextDecadeBtn.type = 'button';
      nextDecadeBtn.className = 'gcal-nav-btn';
      nextDecadeBtn.innerHTML = '»';
      nextDecadeBtn.setAttribute('aria-label', 'Next decade');
      nextDecadeBtn.onclick = (e) => {
        e.stopPropagation();
        this.decadeStart += 12;
        this.render();
      };

      header.appendChild(prevDecadeBtn);
      header.appendChild(decadeTitle);
      header.appendChild(nextDecadeBtn);
      this.popover.appendChild(header);

      const yearsGrid = document.createElement('div');
      yearsGrid.className = 'gcal-years-grid';

      for (let y = this.decadeStart; y < this.decadeStart + 12; y++) {
        const yBtn = document.createElement('button');
        yBtn.type = 'button';
        yBtn.className = 'gcal-year-pill';
        yBtn.textContent = y;

        if (y === this.viewYear) {
          yBtn.classList.add('is-current-view');
        }

        // Disable future years if max is today
        if (this.maxDate && y > this.maxDate.getFullYear()) {
          yBtn.disabled = true;
          yBtn.classList.add('is-disabled');
        } else {
          yBtn.onclick = (e) => {
            e.stopPropagation();
            this.viewYear = y;
            this.viewMode = 'months';
            this.render();
          };
        }

        yearsGrid.appendChild(yBtn);
      }

      this.popover.appendChild(yearsGrid);
    }
  }

  // Auto-initialize GreenCalendar across all date inputs
  function initAllCalendars() {
    const selectors = [
      'input[type="date"]',
      'input[data-datepicker]',
      'input.green-datepicker',
      'input.date-input',
      'input.date-filter',
      '#id_dob',
      '#booking-date',
      '#choose-date',
      '#schedule-date',
      '#copy-from',
      '#copy-to',
      '#report-from',
      '#report-to'
    ];

    document.querySelectorAll(selectors.join(',')).forEach((input) => {
      new GreenCalendar(input);
    });
  }

  // Run on DOMContentLoaded and expose globally
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllCalendars);
  } else {
    initAllCalendars();
  }

  window.GreenCalendar = GreenCalendar;
  window.initAllCalendars = initAllCalendars;
})();
