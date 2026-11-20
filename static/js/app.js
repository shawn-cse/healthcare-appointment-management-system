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
})();
