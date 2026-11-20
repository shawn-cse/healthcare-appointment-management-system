'use strict';
(function(){
  const doc=document;
  const path=window.location.pathname;
  const navAliases={'/dashboard/':'dashboard','/doctors/':'doctor_directory','/appointments/':'appointments','/reception/book/':'staff_book','/schedules/':'schedule','/finance/refunds/':'refunds','/reports/':'reports','/team/':'staff_list','/departments/':'departments','/policy/':'policy','/audit/':'audit_log','/complaints/':'complaints','/service/complaints/':'complaint_queue','/profile/':'profile','/profile/password/':'password_change'};
  for(const [prefix,key] of Object.entries(navAliases)){
    if(path===prefix || (prefix==='/doctors/' && path.startsWith('/doctors/') && !path.endsWith('/rules/')) || (prefix==='/schedules/' && path.startsWith('/schedules/')) || (prefix==='/team/' && path.startsWith('/team/'))){
      const link=doc.querySelector('[data-nav="'+key+'"]');if(link){link.classList.add('active');link.setAttribute('aria-current','page');break;}
    }
  }
  const openNav=()=>doc.body.classList.add('nav-open');
  const closeNav=()=>doc.body.classList.remove('nav-open');
  doc.querySelectorAll('[data-toggle-nav]').forEach(b=>b.addEventListener('click',()=>doc.body.classList.contains('nav-open')?closeNav():openNav()));
  doc.querySelectorAll('[data-close-nav]').forEach(b=>b.addEventListener('click',closeNav));
  doc.addEventListener('keydown',e=>{if(e.key==='Escape')closeNav()});
  doc.querySelectorAll('[data-dismiss]').forEach(b=>b.addEventListener('click',()=>b.closest('.flash')?.remove()));
  doc.querySelectorAll('[data-password-toggle]').forEach(b=>b.addEventListener('click',()=>{const input=doc.getElementById(b.dataset.passwordToggle);if(!input)return;const show=input.type==='password';input.type=show?'text':'password';b.textContent=show?'Hide':'Show';b.setAttribute('aria-label',show?'Hide password':'Show password')}));
  doc.querySelectorAll('[data-check-all]').forEach(box=>box.addEventListener('change',()=>{const form=box.closest('form');(form||doc).querySelectorAll('.bulk-check').forEach(cb=>cb.checked=box.checked);updateSelected()}));
  doc.querySelectorAll('.bulk-check').forEach(cb=>cb.addEventListener('change',updateSelected));
  function updateSelected(){const counter=doc.getElementById('selected-count');if(counter)counter.textContent=doc.querySelectorAll('.bulk-check:checked').length;}
  // Confirm destructive or financial operations using accessible native prompts.
  doc.querySelectorAll('[data-confirm]').forEach(button=>button.addEventListener('click',e=>{if(!window.confirm(button.dataset.confirm)){e.preventDefault();e.stopPropagation()}}));
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
  const depCount = doc.getElementById('department-count');

  if (depSearch && depContainer) {
    const depCards = Array.from(depContainer.querySelectorAll('.department-showcase-card'));
    depSearch.addEventListener('input', () => {
      const q = depSearch.value.trim().toLowerCase();
      let matchCount = 0;
      depCards.forEach(card => {
        const name = card.dataset.depName || '';
        const desc = card.dataset.depDesc || '';
        if (!q || name.includes(q) || desc.includes(q)) {
          card.style.display = '';
          matchCount++;
        } else {
          card.style.display = 'none';
        }
      });
      if (depCount) {
        depCount.textContent = `Showing ${matchCount} specialized department${matchCount === 1 ? '' : 's'}`;
      }
    });
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
})();
