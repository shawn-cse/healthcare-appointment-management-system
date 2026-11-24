'use strict';
(function(){
  const doc=document;
  const path=window.location.pathname;
  const navAliases={'/dashboard/':'dashboard','/doctors/':'doctor_directory','/appointments/':'appointments','/reception/book/':'staff_book','/schedules/':'schedule','/finance/refunds/':'refunds','/reports/':'reports','/staff/':'staff_list','/team/':'staff_list','/departments/':'departments','/policy/':'policy','/audit/':'audit_log','/complaints/':'complaints','/service/complaints/':'complaint_queue','/profile/':'profile','/profile/password/':'password_change'};
  for(const [prefix,key] of Object.entries(navAliases)){
    if(path===prefix || (prefix==='/doctors/' && path.startsWith('/doctors/') && !path.endsWith('/rules/')) || (prefix==='/schedules/' && path.startsWith('/schedules/')) || (prefix==='/staff/' && path.startsWith('/staff/')) || (prefix==='/team/' && path.startsWith('/team/'))){
      const link=doc.querySelector('[data-nav="'+key+'"]');if(link){link.classList.add('active');link.setAttribute('aria-current','page');break;}
    }
  }

  // --- Universal Sidebar Open / Close / Toggle for all screen sizes and roles ---
  function toggleNav() {
    if (window.innerWidth <= 900) {
      doc.body.classList.remove('sidebar-collapsed');
      doc.body.classList.toggle('nav-open');
    } else {
      doc.body.classList.remove('nav-open');
      const isCollapsed = doc.body.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('gh_sidebar_collapsed', isCollapsed ? 'true' : 'false'); } catch (e) {}
    }
  }

  function closeNav() {
    if (window.innerWidth <= 900) {
      doc.body.classList.remove('nav-open');
    } else {
      doc.body.classList.add('sidebar-collapsed');
      try { localStorage.setItem('gh_sidebar_collapsed', 'true'); } catch (e) {}
    }
  }

  function openNav() {
    if (window.innerWidth <= 900) {
      doc.body.classList.add('nav-open');
    } else {
      doc.body.classList.remove('sidebar-collapsed');
      try { localStorage.setItem('gh_sidebar_collapsed', 'false'); } catch (e) {}
    }
  }

  // Restore saved desktop sidebar collapse preference
  try {
    if (window.innerWidth > 900 && localStorage.getItem('gh_sidebar_collapsed') === 'true') {
      doc.body.classList.add('sidebar-collapsed');
    }
  } catch (e) {}

  doc.querySelectorAll('[data-toggle-nav]').forEach(b=>b.addEventListener('click',(e)=>{e.preventDefault();toggleNav();}));
  doc.querySelectorAll('[data-close-nav]').forEach(b=>b.addEventListener('click',(e)=>{e.preventDefault();closeNav();}));
  doc.addEventListener('keydown',e=>{if(e.key==='Escape')closeNav()});
  doc.querySelectorAll('[data-dismiss]').forEach(b=>b.addEventListener('click',()=>b.closest('.flash')?.remove()));
  doc.querySelectorAll('[data-password-toggle]').forEach(b=>b.addEventListener('click',()=>{const input=doc.getElementById(b.dataset.passwordToggle);if(!input)return;const show=input.type==='password';input.type=show?'text':'password';b.textContent=show?'Hide':'Show';b.setAttribute('aria-label',show?'Hide password':'Show password')}));
  doc.querySelectorAll('[data-check-all]').forEach(box=>box.addEventListener('change',()=>{const form=box.closest('form');(form||doc).querySelectorAll('.bulk-check').forEach(cb=>cb.checked=box.checked);updateSelected()}));
  doc.querySelectorAll('.bulk-check').forEach(cb=>cb.addEventListener('change',updateSelected));
  function updateSelected(){const counter=doc.getElementById('selected-count');if(counter)counter.textContent=doc.querySelectorAll('.bulk-check:checked').length;}
  // Confirm destructive or financial operations using accessible native prompts.
  doc.querySelectorAll('[data-confirm]').forEach(button=>button.addEventListener('click',e=>{if(!window.confirm(button.dataset.confirm)){e.preventDefault();e.stopPropagation()}}));

  // --- Profile Dropdown Menu in Topbar ---
  const profileDropdown = doc.getElementById('profile-dropdown-wrap');
  const profileTrigger = doc.getElementById('profile-trigger-btn');
  if (profileDropdown && profileTrigger) {
    profileTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = profileDropdown.classList.toggle('is-open');
      profileTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    doc.addEventListener('click', (e) => {
      if (!profileDropdown.contains(e.target)) {
        profileDropdown.classList.remove('is-open');
        profileTrigger.setAttribute('aria-expanded', 'false');
      }
    });

    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && profileDropdown.classList.contains('is-open')) {
        profileDropdown.classList.remove('is-open');
        profileTrigger.setAttribute('aria-expanded', 'false');
        profileTrigger.focus();
      }
    });
  }
  const booking=doc.getElementById('reception-booking-form');
  if(booking){
    const docSelect=doc.getElementById('booking-doctor');const date=doc.getElementById('booking-date');const select=doc.getElementById('id_slot');const hint=doc.getElementById('slot-capacity-hint');
    const today=new Date();const offset=today.getTimezoneOffset();const local=new Date(today.getTime()-offset*60000).toISOString().slice(0,10);date.min=local;
    if(!date.value)date.value=local;
    const selectedExisting=booking.dataset.initialSlot||'';
    async function loadSlots(){
      if(!docSelect.value||!date.value){select.innerHTML='<option value="">Choose a doctor and date first</option>';return;}
      select.disabled=true;select.innerHTML='<option value="">Loading time slots…</option>';
      try{
        const target=booking.dataset.slotsUrl+'?'+new URLSearchParams({doctor:docSelect.value,date:date.value});
        const response=await fetch(target,{credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest'}});
        if(!response.ok)throw new Error('Unable to load available times');
        const info=await response.json();select.replaceChildren();
        const empty=new Option(info.slots.length?'Choose an appointment time':'No open spaces for this date','');select.add(empty);
        for(const s of info.slots){const option=new Option(`${s.label} · ${s.remaining} of ${s.capacity} remaining`,String(s.id));select.add(option);}
        if(selectedExisting && [...select.options].some(o=>o.value===selectedExisting))select.value=selectedExisting;
        hint.textContent=info.slots.length+' available consultation time'+(info.slots.length===1?'':'s');
      }catch(err){select.innerHTML='<option value="">Could not load time slots. Please retry.</option>';hint.textContent='Check your network connection.'}
      finally{select.disabled=false;}
    }
    docSelect.addEventListener('change',loadSlots);date.addEventListener('change',loadSlots);
    if(docSelect.value && date.value) loadSlots();
    const lookupBtn=doc.getElementById('lookup-patient');
    const phoneInput=doc.getElementById('id_phone');
    const patientSelect=doc.getElementById('id_patient');
    const lookupResult=doc.getElementById('lookup-result');
    if(lookupBtn && phoneInput && patientSelect){
      lookupBtn.addEventListener('click',async()=>{
        if(!phoneInput.value.trim()){lookupResult.textContent='Enter a patient phone number first.';return;}
        lookupResult.textContent='Searching registered accounts…';
        try{const url=booking.dataset.patientUrl+'?'+new URLSearchParams({phone:phoneInput.value.trim()});
          const response=await fetch(url,{credentials:'same-origin'});if(!response.ok)throw new Error();
          const data=await response.json();patientSelect.replaceChildren(new Option('Not linked to an account',''));
          if(data.patient){patientSelect.add(new Option(data.patient.name+' · #'+data.patient.id,data.patient.id));
            lookupResult.textContent='Account found. Select it and confirm identity before saving.';}
          else lookupResult.textContent='No account found. Continue without linking an account.';
        }catch(err){lookupResult.textContent='Account lookup failed. Please try again.';}
      });
    }
    // Keep the form visible after validation errors; select a doctor/date to reload live slots.
  }
  // Show doctor-only onboarding options when a new doctor is selected.
  const staffRole=doc.getElementById('id_role');
  const onboarding=doc.querySelectorAll('[data-doctor-onboarding]');
  if(staffRole && onboarding.length){
    const toggle=()=>{
      const isDoctor=staffRole.value==='doctor';
      onboarding.forEach(group=>{
        group.hidden=!isDoctor;
        group.style.display=isDoctor?'':'none';
        const field=group.querySelector('select');
        if(field)field.required=isDoctor;
      });
    };
    staffRole.addEventListener('change',toggle);
    toggle();
  }

  // --- Real-Time Instant Doctor Search & Sorting ---
  const searchInput = doc.getElementById('live-doctor-search') || doc.getElementById('doctor-search-input');
  const deptSelect = doc.getElementById('dept-select');
  const sortSelect = doc.getElementById('sort-select');
  const cardsContainer = doc.getElementById('doctor-cards-grid') || doc.getElementById('doctor-cards-container');
  const clearBtn = doc.getElementById('clear-search-btn') || doc.getElementById('search-clear-btn');
  const countText = doc.getElementById('visible-count') || doc.getElementById('results-count-text');
  const clientEmpty = doc.getElementById('no-search-results') || doc.getElementById('no-doctors-client');
  const serverEmpty = doc.getElementById('no-doctors-server');

  if (searchInput && cardsContainer) {
    const cards = Array.from(cardsContainer.querySelectorAll('.doctor-card, .doctor-profile-card'));

    function filterAndSortDoctors() {
      const query = searchInput.value.trim().toLowerCase();
      const selectedDept = deptSelect ? deptSelect.value : '';
      const sortVal = sortSelect ? sortSelect.value : 'name';

      if (clearBtn) {
        clearBtn.style.display = query ? 'inline-flex' : 'none';
      }

      let visibleCards = [];

      cards.forEach(card => {
        const name = card.dataset.name || '';
        const dept = card.dataset.dept || '';
        const deptId = card.dataset.deptId || '';
        const qual = card.dataset.qual || '';
        const inst = card.dataset.inst || '';
        const room = card.dataset.room || '';

        const matchesQuery = !query ||
          name.includes(query) ||
          dept.includes(query) ||
          qual.includes(query) ||
          inst.includes(query) ||
          room.includes(query);

        const matchesDept = !selectedDept || deptId === selectedDept;

        if (matchesQuery && matchesDept) {
          card.style.display = '';
          visibleCards.push(card);
        } else {
          card.style.display = 'none';
        }
      });

      // Sort visible cards
      visibleCards.sort((a, b) => {
        if (sortVal === 'fee_asc') {
          return parseFloat(a.dataset.fee || 0) - parseFloat(b.dataset.fee || 0);
        } else if (sortVal === 'fee_desc') {
          return parseFloat(b.dataset.fee || 0) - parseFloat(a.dataset.fee || 0);
        } else if (sortVal === 'experience') {
          return parseInt(b.dataset.exp || 0) - parseInt(a.dataset.exp || 0);
        } else if (sortVal === 'department') {
          return (a.dataset.dept || '').localeCompare(b.dataset.dept || '');
        } else {
          return (a.dataset.name || '').localeCompare(b.dataset.name || '');
        }
      });

      // Re-append sorted cards in order
      visibleCards.forEach(card => cardsContainer.appendChild(card));

      // Update counter
      if (countText) {
        if (countText.tagName === 'B') {
          countText.textContent = visibleCards.length;
        } else {
          countText.innerHTML = `Showing <b>${visibleCards.length}</b> specialist${visibleCards.length === 1 ? '' : 's'}`;
        }
      }

      // Handle empty state
      if (clientEmpty) {
        clientEmpty.style.display = (visibleCards.length === 0) ? 'block' : 'none';
      }
      if (serverEmpty && visibleCards.length > 0) {
        serverEmpty.style.display = 'none';
      }
    }

    searchInput.addEventListener('input', filterAndSortDoctors);
    if (deptSelect) deptSelect.addEventListener('change', filterAndSortDoctors);
    if (sortSelect) sortSelect.addEventListener('change', filterAndSortDoctors);

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.focus();
        filterAndSortDoctors();
      });
    }

    const resetBtn = doc.getElementById('clear-search-btn-empty') || doc.getElementById('reset-client-search');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        searchInput.value = '';
        if (deptSelect) deptSelect.value = '';
        if (sortSelect) sortSelect.value = 'name';
        filterAndSortDoctors();
      });
    }
  }

  // --- Real-Time Instant Department Search ---
  const depSearch = doc.getElementById('department-live-search');
  const depContainer = doc.getElementById('departments-container');
  const depClearBtn = doc.getElementById('dept-search-clear');
  const depEmpty = doc.getElementById('dept-no-results');
  const depQueryDisplay = doc.getElementById('dept-query-display');

  if (depSearch && depContainer) {
    const depCards = Array.from(depContainer.querySelectorAll('.department-showcase-card'));
    const filterDeps = () => {
      const q = depSearch.value.trim().toLowerCase();
      let matches = 0;
      depCards.forEach(card => {
        const name = card.dataset.depName || '';
        const desc = card.dataset.depDesc || '';
        if (!q || name.includes(q) || desc.includes(q)) {
          card.style.display = '';
          matches++;
        } else {
          card.style.display = 'none';
        }
      });
      if (depClearBtn) {
        depClearBtn.style.display = q ? 'inline-flex' : 'none';
      }
      if (depEmpty) {
        depEmpty.style.display = (matches === 0) ? 'block' : 'none';
        if (depQueryDisplay) depQueryDisplay.textContent = depSearch.value.trim();
      }
    };

    depSearch.addEventListener('input', filterDeps);
    if (depClearBtn) {
      depClearBtn.addEventListener('click', () => {
        depSearch.value = '';
        filterDeps();
        depSearch.focus();
      });
    }
  }

  // --- Public Mobile Navigation Drawer ---
  const publicNavToggle = doc.querySelector('[data-toggle-public-nav]');
  const publicNav = doc.getElementById('public-navigation');
  if (publicNavToggle && publicNav) {
    publicNavToggle.addEventListener('click', () => {
      publicNav.classList.toggle('nav-expanded');
    });
  }

  // --- Smooth Scroll for Make Appointment Button ---
  const heroMakeAppt = doc.getElementById('hero-make-appt-btn');
  if (heroMakeAppt) {
    heroMakeAppt.addEventListener('click', (e) => {
      e.preventDefault();
      const target = doc.getElementById('appointment-section');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // --- Ensure Clean URLs (auto-remove any lingering hash from address bar) ---
  if (window.location.hash) {
    const hash = window.location.hash;
    try {
      const target = doc.querySelector(hash);
      if (target) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: 'smooth' });
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
          }
        }, 50);
      } else if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (_) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }

  // --- Modern Floating Toast Notifications (Top-Right 3s Auto-Dismiss) ---
  const toastContainer = doc.getElementById('toast-container');
  function initToast(toastCard, duration = 3000) {
    if (!toastCard) return;
    const closeBtn = toastCard.querySelector('[data-toast-close]');
    let timer = null;

    function dismiss() {
      if (timer) clearTimeout(timer);
      toastCard.classList.add('toast-dismissing');
      setTimeout(() => {
        if (toastCard.parentElement) {
          toastCard.remove();
        }
      }, 300);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', dismiss);
    }

    if (duration > 0) {
      timer = setTimeout(dismiss, duration);
    }
  }

  if (toastContainer) {
    const serverToasts = toastContainer.querySelectorAll('.toast-card');
    serverToasts.forEach(toast => {
      const customDuration = parseInt(toast.dataset.autoDismiss, 10) || 3000;
      initToast(toast, customDuration);
    });
  }

  // Expose global showToast for dynamic user actions
  window.showToast = function(message, type = 'info', duration = 3000) {
    let container = doc.getElementById('toast-container');
    if (!container) {
      container = doc.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      doc.body.appendChild(container);
    }

    const toast = doc.createElement('div');
    toast.className = `toast-card toast-${type}`;
    toast.setAttribute('role', 'alert');

    let iconId = 'ic-help';
    let title = 'Information';
    if (type === 'error' || type === 'danger') {
      iconId = 'ic-alert';
      title = 'Notice / Error';
    } else if (type === 'success') {
      iconId = 'ic-check';
      title = 'Success';
    } else if (type === 'warning') {
      iconId = 'ic-alert';
      title = 'Attention';
    }

    toast.innerHTML = `
      <div class="toast-icon-wrap">
        <svg class="icon"><use href="#${iconId}"/></svg>
      </div>
      <div class="toast-body">
        <span class="toast-badge-title">${title}</span>
        <p class="toast-msg-text">${message}</p>
      </div>
      <button type="button" class="toast-dismiss-btn" aria-label="Dismiss notification" data-toast-close>✕</button>
      <div class="toast-progress-track"><div class="toast-progress-bar"></div></div>
    `;

    container.appendChild(toast);
    initToast(toast, duration);
  };

  // --- Patient Excel Appointments Sheet: Cancellation & Refund Modal ---
  const cancelModal = doc.getElementById('patient-cancel-modal');
  if (cancelModal) {
    const modalTargetRef = doc.getElementById('modal-target-ref');
    const modalTargetDoc = doc.getElementById('modal-target-doc');
    const modalTargetFee = doc.getElementById('modal-target-fee');
    const modalRefundNotice = doc.getElementById('modal-refund-notice');
    const modalForm = doc.getElementById('modal-cancel-form');
    const reasonInput = doc.getElementById('cancel-reason-textarea');
    const closeBtn = doc.getElementById('modal-cancel-close-btn');
    const keepBtn = doc.getElementById('modal-keep-btn');

    function closeModal() {
      cancelModal.style.display = 'none';
      if (reasonInput) reasonInput.value = '';
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (keepBtn) keepBtn.addEventListener('click', closeModal);

    cancelModal.addEventListener('click', (e) => {
      if (e.target === cancelModal) closeModal();
    });

    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && cancelModal.style.display !== 'none') {
        closeModal();
      }
    });

    const openCancelButtons = doc.querySelectorAll('.btn-open-cancel');
    openCancelButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const ref = btn.dataset.apptRef || '';
        const doctor = btn.dataset.apptDoctor || '';
        const fee = btn.dataset.apptFee || '0';
        const isPaid = btn.dataset.apptPaid === 'true';
        const cancelUrl = btn.dataset.apptCancelUrl || '';

        if (modalTargetRef) modalTargetRef.textContent = ref;
        if (modalTargetDoc) modalTargetDoc.textContent = doctor;
        if (modalTargetFee) modalTargetFee.textContent = `৳${fee}`;
        if (modalRefundNotice) {
          modalRefundNotice.style.display = isPaid ? 'block' : 'none';
        }
        if (modalForm) modalForm.action = cancelUrl;

        cancelModal.style.display = 'flex';
        if (reasonInput) reasonInput.focus();
      });
    });
  }

  // --- Global Smooth Page Transitions & Progress Indicator ---
  (function initPageTransitions() {
    const progressBar = doc.getElementById('page-progress-bar');
    const progressInner = progressBar ? progressBar.querySelector('.page-progress-inner') : null;
    let progressTimer = null;
    let currentProgress = 0;

    function setProgress(percent) {
      if (!progressInner) return;
      currentProgress = percent;
      progressInner.style.width = percent + '%';
    }

    function startLoading() {
      if (!progressBar || !progressInner) return;
      if (progressTimer) clearInterval(progressTimer);
      progressBar.classList.add('is-active');
      doc.body.classList.add('is-page-loading');
      setProgress(25);

      progressTimer = setInterval(() => {
        if (currentProgress < 82) {
          setProgress(currentProgress + (85 - currentProgress) * 0.18);
        }
      }, 100);
    }

    function finishLoading() {
      if (!progressBar || !progressInner) return;
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      setProgress(100);
      setTimeout(() => {
        progressBar.classList.remove('is-active');
        doc.body.classList.remove('is-page-loading');
        doc.querySelectorAll('.nav-list a.is-navigating').forEach(el => el.classList.remove('is-navigating'));
        setTimeout(() => {
          setProgress(0);
        }, 220);
      }, 180);
    }

    // Finish progress on initial page ready
    if (doc.readyState === 'complete') {
      finishLoading();
    } else {
      window.addEventListener('load', finishLoading);
    }

    // Handle browser back/forward cache restoration
    window.addEventListener('pageshow', () => {
      finishLoading();
    });

    // Intercept internal link clicks for smooth immediate feedback
    doc.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
      if (link.target && link.target !== '_self') return;
      if (link.hasAttribute('download')) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented) return;

      try {
        const targetUrl = new URL(link.href, window.location.origin);
        if (targetUrl.origin !== window.location.origin) return;

        // Skip if exact same URL hash or page
        if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search && targetUrl.hash) return;

        // Visual feedback on clicked navigation link immediately
        if (link.closest('.nav-list')) {
          doc.querySelectorAll('.nav-list a.is-navigating').forEach(el => el.classList.remove('is-navigating'));
          link.classList.add('is-navigating');
        }

        startLoading();
      } catch (err) {
        // Fallback for relative or atypical URLs
      }
    });

    // Also trigger loading feedback for standard form submissions
    doc.addEventListener('submit', (e) => {
      const form = e.target;
      if (form && !e.defaultPrevented) {
        if (!form.hasAttribute('data-no-progress')) {
          startLoading();
        }
      }
    });
  })();

  // --- Live Username Conflict & Availability Checker ---
  function initLiveUsernameValidation() {
    const inputs = doc.querySelectorAll('input[data-live-username="true"], #id_username, input[name="username"]');
    inputs.forEach(input => {
      if (input.dataset.liveUsernameAttached) return;
      input.dataset.liveUsernameAttached = 'true';

      const group = input.closest('.form-group') || input.parentElement;
      if (!group) return;

      // Find or attach live feedback element
      let feedback = group.querySelector('.username-live-feedback');
      if (!feedback) {
        const existingHelp = group.querySelector('.help-text');
        feedback = doc.createElement('small');
        feedback.className = 'username-live-feedback feedback-default-neutral';
        feedback.textContent = 'Username must be unique.';
        if (existingHelp) {
          existingHelp.replaceWith(feedback);
        } else {
          input.insertAdjacentElement('afterend', feedback);
        }
      }

      const serverError = group.querySelector('.error-text');
      const defaultText = 'Username must be unique.';
      let debounceTimer = null;
      let abortController = null;

      function updateFeedback(state, message) {
        feedback.textContent = message;
        feedback.className = 'username-live-feedback';
        input.classList.remove('input-valid-green', 'input-conflict-red');

        if (serverError && state !== 'default') {
          serverError.style.display = 'none';
        }

        if (state === 'conflict') {
          feedback.classList.add('feedback-conflict-red');
          input.classList.add('input-conflict-red');
        } else if (state === 'ok') {
          feedback.classList.add('feedback-ok-green');
          input.classList.add('input-valid-green');
        } else {
          feedback.classList.add('feedback-default-neutral');
        }
      }

      input.addEventListener('input', () => {
        const val = input.value.trim();
        const excludeId = input.dataset.excludeId || '';

        if (debounceTimer) clearTimeout(debounceTimer);
        if (abortController) abortController.abort();

        if (!val) {
          updateFeedback('default', defaultText);
          return;
        }

        debounceTimer = setTimeout(() => {
          abortController = new AbortController();
          const targetUrl = '/api/check-username/?' + new URLSearchParams({
            username: val,
            exclude_id: excludeId
          });

          fetch(targetUrl, {
            signal: abortController.signal,
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          })
            .then(res => res.json())
            .then(data => {
              if (data.status === 'conflict') {
                updateFeedback('conflict', 'This username conflicts with another account identifier.');
              } else if (data.status === 'available') {
                updateFeedback('ok', 'Username is OK');
              } else {
                updateFeedback('default', data.message || defaultText);
              }
            })
            .catch(err => {
              if (err && err.name !== 'AbortError') {
                // Ignore fetch abort
              }
            });
        }, 220);
      });

      input.addEventListener('blur', () => {
        if (!input.value.trim()) {
          updateFeedback('default', defaultText);
        }
      });
    });
  }

  // --- Appointment Management Desk: Live Search, Filters & Quick Edit Modal ---
  function initAppointmentManagementDesk() {
    const filterForm = doc.getElementById('appointment-filter-form');
    const liveSearchInput = doc.getElementById('appt-live-search');
    const tableBody = doc.getElementById('appointments-tbody');
    const countText = doc.getElementById('appt-count-text');
    const datePreset = doc.getElementById('filter-date-preset');
    const customDateWrap = doc.getElementById('custom-date-container');
    const filterDoctor = doc.getElementById('filter-doctor');
    const filterPayment = doc.getElementById('filter-payment');
    const filterSort = doc.getElementById('filter-sort');
    const filterDateFrom = doc.getElementById('filter-date-from');
    const filterDateTo = doc.getElementById('filter-date-to');

    // Quick Edit Modal elements
    const quickModal = doc.getElementById('quick-edit-modal');
    const quickForm = doc.getElementById('modal-quick-form');
    const quickCloseBtn = doc.getElementById('modal-quick-close-btn');
    const quickCancelBtn = doc.getElementById('modal-quick-cancel-btn');
    const displayCode = doc.getElementById('modal-display-code');
    const metaPatient = doc.getElementById('modal-meta-patient');
    const metaPhone = doc.getElementById('modal-meta-phone');
    const metaDoctor = doc.getElementById('modal-meta-doctor');
    const metaUsername = doc.getElementById('modal-meta-username');
    const metaSlot = doc.getElementById('modal-meta-slot');
    const inputVisit = doc.getElementById('modal-input-visit');
    const inputFee = doc.getElementById('modal-input-fee');
    const inputStatus = doc.getElementById('modal-input-status');
    const cancelReasonWrap = doc.getElementById('modal-cancel-reason-wrap');
    const inputCancelReason = doc.getElementById('modal-input-cancel-reason');
    const unpaidBox = doc.getElementById('modal-payment-unpaid-box');
    const paidBox = doc.getElementById('modal-payment-paid-box');
    const collectCashCb = doc.getElementById('modal-collect-cash-cb');
    const inputNotes = doc.getElementById('modal-input-notes');
    const fullDetailLink = doc.getElementById('modal-full-detail-link');

    let currentDoctorFees = { first: 1000, followup: 800, report: 500 };
    let currentTargetRow = null;

    // 1. Live Client-side search + Debounced server query
    if (liveSearchInput && tableBody) {
      let debounceSubmit = null;

      liveSearchInput.addEventListener('input', () => {
        const query = liveSearchInput.value.toLowerCase().replace(/[\[\]]/g, '').trim();
        const rows = tableBody.querySelectorAll('tr.appt-row');
        let matchedCount = 0;

        rows.forEach(row => {
          const searchData = (row.dataset.search || row.textContent).toLowerCase();
          if (!query || searchData.includes(query)) {
            row.style.display = '';
            matchedCount++;
          } else {
            row.style.display = 'none';
          }
        });

        if (countText) {
          if (query) {
            countText.textContent = `Showing ${matchedCount} matching appointments (filtered)`;
          } else {
            countText.textContent = `Showing ${rows.length} records`;
          }
        }

        // Debounced submission if query extends beyond visible page
        if (debounceSubmit) clearTimeout(debounceSubmit);
        debounceSubmit = setTimeout(() => {
          if (filterForm && query.length >= 3) {
            filterForm.submit();
          }
        }, 600);
      });

      // Submit on Enter
      liveSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (filterForm) filterForm.submit();
        }
      });
    }

    // 2. Date Preset Dropdown handling
    if (datePreset) {
      datePreset.addEventListener('change', () => {
        if (datePreset.value === 'custom') {
          if (customDateWrap) customDateWrap.style.display = 'inline-flex';
        } else {
          if (customDateWrap) {
            customDateWrap.style.display = 'none';
            if (filterDateFrom) filterDateFrom.value = '';
            if (filterDateTo) filterDateTo.value = '';
          }
          if (filterForm) filterForm.submit();
        }
      });
    }

    // Custom date changes auto-submit when both or either is filled
    [filterDateFrom, filterDateTo].forEach(input => {
      if (input) {
        input.addEventListener('change', () => {
          if (filterForm && (filterDateFrom.value || filterDateTo.value)) {
            filterForm.submit();
          }
        });
      }
    });

    // 3. Dropdowns auto-submit on change
    [filterDoctor, filterPayment, filterSort].forEach(select => {
      if (select) {
        select.addEventListener('change', () => {
          if (filterForm) filterForm.submit();
        });
      }
    });

    // 4. Quick Edit Modal Interactions
    if (quickModal && quickForm) {
      function closeQuickModal() {
        quickModal.style.display = 'none';
        currentTargetRow = null;
      }

      if (quickCloseBtn) quickCloseBtn.addEventListener('click', closeQuickModal);
      if (quickCancelBtn) quickCancelBtn.addEventListener('click', closeQuickModal);

      // Close on backdrop click or ESC
      quickModal.addEventListener('click', (e) => {
        if (e.target === quickModal) closeQuickModal();
      });
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && quickModal.style.display !== 'none') {
          closeQuickModal();
        }
      });

      // Open Modal on [GH-E7928B] or Edit click
      doc.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="quick-edit"]');
        if (!btn) return;
        e.preventDefault();

        const row = btn.closest('tr');
        currentTargetRow = row;

        const apptId = btn.dataset.apptId;
        const apptRef = btn.dataset.apptRef;
        const patientName = btn.dataset.patientName || '-';
        const patientPhone = btn.dataset.patientPhone || '-';
        const docName = btn.dataset.docName || '-';
        const docUsername = btn.dataset.docUsername || '-';
        const slotDate = btn.dataset.date || '-';
        const slotTime = btn.dataset.time || '-';
        const visitType = btn.dataset.visit || 'first';
        const fee = btn.dataset.fee || '1000';
        const status = btn.dataset.status || 'confirmed';
        const paymentStatus = btn.dataset.paymentStatus || 'unpaid';
        const notes = btn.dataset.notes || '';
        const detailUrl = btn.dataset.detailUrl || '#';

        // Cache doctor tiered fees
        currentDoctorFees = {
          first: parseFloat(btn.dataset.docInitialFee) || 1000,
          followup: parseFloat(btn.dataset.docFollowupFee) || 800,
          report: parseFloat(btn.dataset.docReportFee) || 500
        };

        // Populate modal
        quickForm.action = `/appointments/${apptId}/quick-update/`;
        if (displayCode) displayCode.textContent = `[${apptRef}]`;
        if (metaPatient) metaPatient.textContent = patientName;
        if (metaPhone) metaPhone.textContent = patientPhone;
        if (metaDoctor) metaDoctor.textContent = `Dr. ${docName}`;
        if (metaUsername) metaUsername.textContent = `(@${docUsername})`;
        if (metaSlot) metaSlot.textContent = `${slotDate} · ${slotTime}`;
        if (inputVisit) inputVisit.value = visitType;
        if (inputFee) inputFee.value = fee;
        if (inputStatus) inputStatus.value = status;
        if (inputNotes) inputNotes.value = notes;
        if (fullDetailLink) fullDetailLink.href = detailUrl;

        // Payment status indicator / cash collection toggle
        if (paymentStatus === 'unpaid') {
          if (unpaidBox) unpaidBox.style.display = 'block';
          if (paidBox) paidBox.style.display = 'none';
          if (collectCashCb) collectCashCb.checked = false;
        } else {
          if (unpaidBox) unpaidBox.style.display = 'none';
          if (paidBox) paidBox.style.display = 'block';
        }

        // Cancellation reason wrap
        if (cancelReasonWrap) {
          cancelReasonWrap.style.display = (status === 'cancelled') ? 'block' : 'none';
          if (inputCancelReason) inputCancelReason.value = '';
        }

        quickModal.style.display = 'flex';
      });

      // Change visit type dynamically updates fee field
      if (inputVisit) {
        inputVisit.addEventListener('change', () => {
          const selected = inputVisit.value;
          if (currentDoctorFees[selected] !== undefined && inputFee) {
            inputFee.value = currentDoctorFees[selected];
          }
        });
      }

      // Change status shows/hides cancel reason
      if (inputStatus) {
        inputStatus.addEventListener('change', () => {
          if (cancelReasonWrap) {
            cancelReasonWrap.style.display = (inputStatus.value === 'cancelled') ? 'block' : 'none';
          }
        });
      }

      // Submit via AJAX for instant update without vertical jump
      quickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const submitBtn = doc.getElementById('modal-quick-save-btn');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
        }

        const formData = new FormData(quickForm);

        fetch(quickForm.action, {
          method: 'POST',
          body: formData,
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json'
          }
        })
          .then(res => res.json())
          .then(data => {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Save Changes';
            }

            if (data && data.success) {
              // Update target row dynamically
              if (currentTargetRow) {
                const rowPk = quickForm.action.match(/\/appointments\/(\d+)\/quick-update/)?.[1];
                if (rowPk) {
                  const visitEl = doc.getElementById(`row-visit-${rowPk}`);
                  const feeEl = doc.getElementById(`row-fee-${rowPk}`);
                  const statusEl = doc.getElementById(`row-status-${rowPk}`);
                  const paymentEl = doc.getElementById(`row-payment-${rowPk}`);

                  if (visitEl && data.visit_type_display) {
                    visitEl.textContent = data.visit_type_display;
                    visitEl.className = `visit-type-pill visit-${data.visit_type}`;
                  }
                  if (feeEl && data.fee) {
                    feeEl.textContent = `Tk. ${Math.round(parseFloat(data.fee))}`;
                  }
                  if (statusEl && data.status_display) {
                    statusEl.textContent = data.status_display;
                    statusEl.className = `status status-${data.status}`;
                  }
                  if (paymentEl && data.payment_status_display) {
                    paymentEl.textContent = data.payment_status_display;
                    paymentEl.className = `status status-${data.payment_status}`;
                  }

                  // Update button datasets
                  currentTargetRow.querySelectorAll('[data-action="quick-edit"]').forEach(b => {
                    b.dataset.visit = data.visit_type;
                    b.dataset.fee = Math.round(parseFloat(data.fee));
                    b.dataset.status = data.status;
                    b.dataset.paymentStatus = data.payment_status;
                  });

                  // Add highlight flash animation to row
                  currentTargetRow.classList.remove('row-highlight-flash');
                  void currentTargetRow.offsetWidth; // trigger reflow
                  currentTargetRow.classList.add('row-highlight-flash');
                }
              }

              closeQuickModal();
            } else {
              // If not JSON success, fall back to standard submit
              quickForm.submit();
            }
          })
          .catch(() => {
            // Fallback to normal form POST
            quickForm.submit();
          });
      });
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => {
      initLiveUsernameValidation();
      initAppointmentManagementDesk();
    });
  } else {
    initLiveUsernameValidation();
    initAppointmentManagementDesk();
  }
})();
