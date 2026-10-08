/* Execution Hub – Phase 1.5 Smart Planner */
(function(){
  const PHASE='1.5';
  const DIRECTOR='u1';
  let plannerDate=new Date().toLocaleDateString('en-CA');
  let plannerMode='week';
  let plannerScope='mine';

  function uid(){return state.currentUser}
  function isDirector(id=uid()){return id===uid() && !!window.firebaseHub?.isSystemAdmin()}
  function visibleProject(p,id=uid()){return !!p && user(id).active!==false && (isDirector(id)||(p.team||[]).includes(id))}
  function isProjectLead(p,id=uid()){return !!p && p.projectLead===id}
  function canScheduleProjectMeeting(p,id=uid()){return visibleProject(p,id)&&(isDirector(id)||isProjectLead(p,id))}
  function canScheduleTaskMeeting(t,id=uid()){if(t?.contextType==='regular_work')return !!window.firebaseHub?.canAccessRegularWorkTask(t.id)&&(isDirector(id)||t.owner===id||t.createdBy===id);const p=project(t.project);return visibleProject(p,id)&&(isDirector(id)||isProjectLead(p,id)||t.owner===id)}
  function taskContextLabel(t){if(t?.contextType!=='regular_work')return project(t?.project)?.name||'Project';const folder=state.regularWorkFolders?.find(item=>item.id===(t.folderId||t.regularFolderId)),category=state.regularWorkCategories?.find(item=>item.id===(t.categoryId||t.regularCategoryId));return `Regular Work · ${folder?.name||t.regularFolderName||'Folder'}${category?.name||t.regularCategoryName?` · ${category?.name||t.regularCategoryName}`:''}`}
  function projectsLed(id=uid()){return state.projects.filter(p=>p.projectLead===id)}
  function iso(d){return d.toISOString().slice(0,10)}
  function dateObj(s){return new Date(s+'T00:00:00')}
  function addDays(s,n){const d=dateObj(s);d.setDate(d.getDate()+n);return iso(d)}
  function mondayOf(s){const d=dateObj(s),day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return iso(d)}
  function niceDay(s){return dateObj(s).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}
  function shortDay(s){return dateObj(s).toLocaleDateString('en-IN',{weekday:'short'})}
  function dayNum(s){return dateObj(s).getDate()}
  function timeLabel(v){if(!v)return'';const [h,m]=v.split(':').map(Number);const d=new Date(2000,0,1,h,m);return d.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})}
  function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function openPlannerModal(title,html){el('modalTitle').textContent=title;el('modalBody').innerHTML=html;el('modalBackdrop').classList.add('open')}
  function closePlannerModal(){el('modalBackdrop').classList.remove('open');el('modalBody').innerHTML=''}
  function eventProject(e){if(e.project)return project(e.project);const related=task(e.regularWorkTaskId||e.task);return related?.contextType==='regular_work'?{name:taskContextLabel(related)}:null}
  function eventTask(e){return e.task?task(e.task):null}
  function eventColorClass(e){return e.type==='meeting'?'meeting':e.type==='workblock'?'workblock':e.type==='milestone'?'milestone':'reminder'}

  function migratePlanner(){
    if(!Array.isArray(state.calendarEvents)) state.calendarEvents=[];
    if(!state.plannerRead) state.plannerRead={};
    state.schemaVersion=PHASE;save();
  }

  function personalItems(id=uid(),start=mondayOf(plannerDate),days=7){
    const dates=new Set(Array.from({length:days},(_,i)=>addDays(start,i)));
    const items=[];
    state.tasks.filter(t=>t.owner===id&&(t.contextType==='regular_work'?!!window.firebaseHub?.canAccessRegularWorkTask(t.id):visibleProject(project(t.project),id))).forEach(t=>{
      if(dates.has(t.currentDue)) items.push({kind:'task',id:'deadline-'+t.id,type:'deadline',date:t.currentDue,title:t.title,project:t.project,task:t.id,regular:t.contextType==='regular_work',source:taskContextLabel(t),allDay:true,priority:t.priority,status:t.status});
    });
    state.calendarEvents.forEach(e=>{
      if(dates.has(e.date) && (e.participants||[]).includes(id) && (!e.project||visibleProject(project(e.project),id))) items.push({kind:'event',...e});
    });
    return items.sort((a,b)=>a.date.localeCompare(b.date)||String(a.start||'99:99').localeCompare(String(b.start||'99:99')));
  }

  function projectItems(p,start=mondayOf(plannerDate),days=7){
    const dates=new Set(Array.from({length:days},(_,i)=>addDays(start,i))),items=[];
    state.tasks.filter(t=>t.project===p.id).forEach(t=>{if(dates.has(t.currentDue))items.push({kind:'task',id:'deadline-'+t.id,type:'deadline',date:t.currentDue,title:t.title,project:p.id,task:t.id,allDay:true,priority:t.priority,status:t.status,owner:t.owner})});
    state.calendarEvents.filter(e=>e.project===p.id&&dates.has(e.date)).forEach(e=>items.push({kind:'event',...e}));
    if(p.launch&&dates.has(p.launch))items.push({kind:'launch',id:'launch-'+p.id,type:'milestone',date:p.launch,title:`${p.name} Launch`,project:p.id,allDay:true});
    return items.sort((a,b)=>a.date.localeCompare(b.date)||String(a.start||'99:99').localeCompare(String(b.start||'99:99')));
  }

  function teamUserIds(){
    if(isDirector()) return state.users.filter(u=>u.active!==false).map(u=>u.id);
    const ids=new Set();projectsLed().forEach(p=>(p.team||[]).forEach(x=>ids.add(x)));return [...ids];
  }

  function renderWeek(items,{projectMode=false}={}){
    const start=mondayOf(plannerDate),days=Array.from({length:7},(_,i)=>addDays(start,i));
    return `<div class="planner-week">${days.map(d=>{
      const dayItems=items.filter(x=>x.date===d),todayStr=new Date().toLocaleDateString('en-CA'),todayClass=d===todayStr?'today':'';
      return `<section class="planner-day ${todayClass}"><div class="planner-day-head"><span>${shortDay(d)}</span><strong>${dayNum(d)}</strong>${d===todayStr?'<em>Today</em>':''}</div><div class="planner-day-items">${dayItems.map(x=>calendarCard(x,projectMode)).join('')||'<div class="calendar-empty-day">No scheduled work</div>'}</div></section>`
    }).join('')}</div>`;
  }

  function calendarCard(x,projectMode=false){
    if(x.kind==='task'){
      const t=task(x.task),owner=projectMode&&x.owner?`<span>${escapeHtml(user(x.owner).name)}</span>`:'';
      return `<button type="button" class="calendar-card deadline ${t.priority==='P0'?'critical':''}" data-cal-task="${escapeHtml(t.id)}"><div class="calendar-card-top"><span>DEADLINE</span>${priorityPill(t.priority)}</div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(x.source||taskContextLabel(t))}${owner?' • '+escapeHtml(user(x.owner).name):''}</small></button>`;
    }
    if(x.kind==='launch') return `<div class="calendar-card milestone"><div class="calendar-card-top"><span>LAUNCH</span></div><strong>${escapeHtml(x.title)}</strong><small>Project milestone</small></div>`;
    const p=eventProject(x),tm=x.start?`${timeLabel(x.start)} – ${timeLabel(x.end)}`:'All day';
    return `<button type="button" class="calendar-card ${eventColorClass(x)}" data-cal-event="${escapeHtml(x.id)}"><div class="calendar-card-top"><span>${x.type==='meeting'?'MEETING':x.type==='workblock'?'WORK BLOCK':'EVENT'}</span><b>${escapeHtml(tm)}</b></div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(p?p.name:'Personal')}${x.type==='meeting'?` • ${(x.participants||[]).length} people`:''}</small></button>`;
  }

  function renderAgenda(items,projectMode=false){
    const by={};items.forEach(x=>(by[x.date]||(by[x.date]=[])).push(x));
    return `<div class="agenda-list">${Object.keys(by).sort().map(d=>`<section class="agenda-day"><div class="agenda-date"><strong>${niceDay(d)}</strong><span>${d===new Date().toLocaleDateString('en-CA')?'Today':''}</span></div><div class="agenda-items">${by[d].map(x=>agendaRow(x,projectMode)).join('')}</div></section>`).join('')||'<div class="empty"><strong>No calendar items</strong>Nothing is scheduled in this period.</div>'}</div>`;
  }

  function agendaRow(x,projectMode){
    if(x.kind==='task'){const t=task(x.task);return `<button type="button" class="agenda-row" data-cal-task="${escapeHtml(t.id)}"><div class="agenda-time">Due</div><div class="agenda-type deadline-dot"></div><div class="agenda-copy"><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(x.source||taskContextLabel(t))}${projectMode?' • '+escapeHtml(user(t.owner).name):''}</span></div>${priorityPill(t.priority)}<div class="agenda-arrow">→</div></button>`}
    if(x.kind==='launch')return `<div class="agenda-row nonclick"><div class="agenda-time">All day</div><div class="agenda-type milestone-dot"></div><div class="agenda-copy"><strong>${escapeHtml(x.title)}</strong><span>Launch milestone</span></div></div>`;
    return `<button type="button" class="agenda-row" data-cal-event="${escapeHtml(x.id)}"><div class="agenda-time">${escapeHtml(x.start?timeLabel(x.start):'All day')}</div><div class="agenda-type ${x.type==='meeting'?'meeting-dot':'workblock-dot'}"></div><div class="agenda-copy"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(eventProject(x)?.name||'Personal')}${x.end?' • '+escapeHtml(timeLabel(x.end)):''}</span></div><div class="agenda-arrow">→</div></button>`;
  }

  function renderPlanner(){
    setTitle('Planner','MY WORK CALENDAR');
    const canTeam=isDirector()||projectsLed().length>0,start=mondayOf(plannerDate),end=addDays(start,6);
    let body='';
    if(plannerScope==='team'&&canTeam) body=renderTeamPlanner(start);
    else {plannerScope='mine';const items=personalItems(uid(),start,7);body=plannerMode==='agenda'?renderAgenda(items):renderWeek(items)}
    el('content').innerHTML=`<div class="planner-hero"><div><div class="eyebrow">SMART WORK PLANNER</div><h2>Plan the work, not just the deadline.</h2><p>Tasks, work blocks, project meetings and launch milestones in one connected calendar.</p></div><div class="planner-actions"><button class="btn btn-soft" id="plannerNewBtn">+ Add to Calendar</button></div></div>
      <div class="planner-toolbar"><div class="planner-scope-tabs"><button class="planner-scope ${plannerScope==='mine'?'active':''}" data-planner-scope="mine">My Calendar</button>${canTeam?`<button class="planner-scope ${plannerScope==='team'?'active':''}" data-planner-scope="team">Team Calendar</button>`:''}</div><div class="planner-date-controls"><button class="icon-btn" id="plannerPrev">‹</button><button class="btn btn-ghost" id="plannerToday">Today</button><button class="icon-btn" id="plannerNext">›</button><strong>${fmtDateFull(start)} – ${fmtDateFull(end)}</strong></div>${plannerScope==='mine'?`<div class="planner-view-toggle"><button class="${plannerMode==='week'?'active':''}" data-planner-mode="week">Week</button><button class="${plannerMode==='agenda'?'active':''}" data-planner-mode="agenda">Agenda</button></div>`:''}</div>
      ${body}`;
  }

  function renderTeamPlanner(start){
    const ids=teamUserIds(),days=Array.from({length:7},(_,i)=>addDays(start,i));
    return `<div class="team-planner"><div class="team-planner-head"><div>Team member</div>${days.map(d=>`<div class="${d===new Date().toLocaleDateString('en-CA')?'today':''}">${shortDay(d)}<strong>${dayNum(d)}</strong></div>`).join('')}</div>${ids.map(id=>{const items=personalItems(id,start,7);return `<div class="team-planner-row"><div class="team-planner-person">${avatar(id)}<div><strong>${escapeHtml(user(id).name)}</strong><span>${escapeHtml(user(id).role)}</span></div></div>${days.map(d=>{const xs=items.filter(x=>x.date===d);return `<div class="team-planner-cell">${xs.slice(0,3).map(x=>`<button type="button" class="team-event ${x.kind==='task'?'deadline':eventColorClass(x)}" ${x.kind==='task'?`data-cal-task="${escapeHtml(x.task)}"`:`data-cal-event="${escapeHtml(x.id)}"`} title="${escapeHtml(x.title)}">${x.start?escapeHtml(timeLabel(x.start))+' ':''}${escapeHtml(x.title)}</button>`).join('')}${xs.length>3?`<span class="more-events">+${xs.length-3} more</span>`:''}</div>`}).join('')}</div>`}).join('')}</div>`;
  }

  function renderProjectCalendar(p,tasks){
    const start=mondayOf(plannerDate),items=projectItems(p,start,7);
    return `<div class="section-row" style="margin-top:0"><div><h2>Project Calendar</h2><p>Deadlines, project meetings, work blocks and launch milestones for ${escapeHtml(p.name)}.</p></div><div class="filters">${canScheduleProjectMeeting(p)?'<button class="btn btn-soft" id="projectMeetingBtn">+ Schedule Meeting</button>':''}<button class="btn btn-ghost" id="projectCalendarToday">This Week</button></div></div>
      <div class="project-calendar-summary"><div><span>Project Lead</span><strong>${escapeHtml(user(p.projectLead).name)}</strong></div><div><span>Meetings this week</span><strong>${items.filter(x=>x.type==='meeting').length}</strong></div><div><span>Deadlines this week</span><strong>${items.filter(x=>x.kind==='task').length}</strong></div><div><span>Launch</span><strong>${p.launch?fmtDateFull(p.launch):'Not set'}</strong></div></div>${renderWeek(items,{projectMode:true})}`;
  }

  function myDayBlock(){
    const date=new Date().toLocaleDateString('en-CA'),items=personalItems(uid(),date,1);
    const upcoming=items.slice(0,5);
    return `<div class="myday-panel"><div class="myday-head"><div><div class="eyebrow">MY DAY • ${niceDay(date).toUpperCase()}</div><h3>Your work, meetings and deadlines today</h3></div><button class="btn btn-ghost" data-nav="planner">Open Planner →</button></div><div class="myday-grid">${upcoming.map(x=>{
      if(x.kind==='task'){const t=task(x.task);return `<button class="myday-item" data-cal-task="${escapeHtml(t.id)}"><span class="myday-time">Due today</span><div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(x.source||taskContextLabel(t))}</small></div>${priorityPill(t.priority)}</button>`}
      return `<button class="myday-item" data-cal-event="${escapeHtml(x.id)}"><span class="myday-time">${escapeHtml(x.start?timeLabel(x.start):'All day')}</span><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(eventProject(x)?.name||'Personal')} • ${x.type==='meeting'?'Meeting':'Work block'}</small></div><span class="status-pill ${x.type==='meeting'?'review':'on-track'}">${x.type==='meeting'?'Meeting':'Focus'}</span></button>`
    }).join('')||'<div class="empty compact"><strong>Nothing fixed today</strong>Use Planner to schedule a focus block for one of your open tasks.</div>'}</div></div>`;
  }

  function openPlannerCreate(prefill={}){
    const p=prefill.project?project(prefill.project):null,t=prefill.task?task(prefill.task):null;
    const regularTask=t?.contextType==='regular_work';
    const projectOptions=state.projects.filter(x=>visibleProject(x)).map(x=>`<option value="${escapeHtml(x.id)}" ${p&&x.id===p.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('');
    const contextField=regularTask
      ? `<div class="detail-box"><span>Regular Work Task</span><strong>${escapeHtml(taskContextLabel(t))}</strong></div><input type="hidden" name="project" value="">`
      : `<label class="form-field"><span>Project</span><select class="select" name="project" required><option value="">Choose project</option>${projectOptions}</select></label>`;
    openPlannerModal('Add to Planner',`<form id="plannerEventForm" class="form-stack"><div class="calendar-form-type"><label><input type="radio" name="type" value="workblock" ${prefill.type!=='meeting'?'checked':''}> <span>Work Block</span></label><label><input type="radio" name="type" value="meeting" ${prefill.type==='meeting'?'checked':''}> <span>${regularTask?'Task Meeting':'Project Meeting'}</span></label></div><div class="form-grid">${contextField}<label class="form-field"><span>Related task</span><select class="select" name="task"><option value="">No specific task</option></select></label><label class="form-field"><span>Date</span><input class="input" name="date" type="date" value="${escapeHtml(prefill.date||plannerDate)}" required></label><label class="form-field"><span>Start</span><input class="input" name="start" type="time" value="${escapeHtml(prefill.start||'10:00')}" required></label><label class="form-field"><span>End</span><input class="input" name="end" type="time" value="${escapeHtml(prefill.end||'11:00')}" required></label></div><label class="form-field"><span>Title</span><input class="input" name="title" value="${escapeHtml(prefill.title||(t?`Work on ${t.title}`:''))}" required></label><div id="meetingFields"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelPlannerModal">Cancel</button><button class="btn btn-soft" type="submit">Save to Planner</button></div></form>`);
    const form=el('plannerEventForm'),projectSel=form.elements.project,taskSel=form.elements.task;
    function loadTasks(){const pid=projectSel?.value||'';const rows=regularTask?[t]:pid?state.tasks.filter(x=>x.project===pid&&x.contextType!=='regular_work'&&visibleProject(project(pid))):[];taskSel.innerHTML='<option value="">No specific task</option>'+rows.map(x=>`<option value="${escapeHtml(x.id)}" ${t&&x.id===t.id?'selected':''}>${escapeHtml(x.title)}</option>`).join('');renderMeetingFields()}
    function renderMeetingFields(){const type=form.elements.type.value,pid=projectSel?.value||'',proj=project(pid);if(type!=='meeting'){el('meetingFields').innerHTML='<div class="planner-help">This creates a private focus block on your calendar. The task deadline remains unchanged.</div>';return}const can=regularTask?canScheduleTaskMeeting(t):proj&&(canScheduleProjectMeeting(proj)||(t&&canScheduleTaskMeeting(t)));const members=regularTask?(t.accessUserIds||[]).filter(x=>user(x).active!==false):proj?(proj.team||[]).filter(x=>user(x).active!==false):[];el('meetingFields').innerHTML=`${!can?'<div class="permission-warning">You can only schedule a meeting for a task you are authorized to manage.</div>':''}<label class="form-field"><span>Participants</span><div class="participant-checks">${members.map(x=>`<label><input type="checkbox" name="participant" value="${escapeHtml(x)}" ${x===uid()?'checked':''}><span>${escapeHtml(user(x).name)}</span></label>`).join('')}</div></label><label class="form-field"><span>Agenda</span><textarea class="textarea" name="agenda" placeholder="What should this meeting achieve?"></textarea></label><div class="planner-help">Invited participants see this task-linked meeting in their Planner.</div>`}
    loadTasks();if(projectSel)projectSel.onchange=loadTasks;form.querySelectorAll('input[name=type]').forEach(r=>r.onchange=renderMeetingFields);el('cancelPlannerModal').onclick=closePlannerModal;
    form.onsubmit=async e=>{
      e.preventDefault();const fd=new FormData(form),type=fd.get('type'),pid=fd.get('project')||null,proj=pid?project(pid):null,tid=fd.get('task')||null,related=tid?task(tid):null;
      if(regularTask&&!related)return toast('Select the linked Regular Work task.');if(!regularTask&&!proj)return toast('Choose a project.');
      if(type==='meeting'&&(regularTask?!canScheduleTaskMeeting(related):!canScheduleProjectMeeting(proj)&&!(related&&canScheduleTaskMeeting(related))))return toast('You do not have authority to schedule this meeting.');
      const participants=type==='meeting'?[...form.querySelectorAll('input[name=participant]:checked')].map(x=>x.value):[uid()];if(type==='meeting'&&!participants.length)return toast('Select at least one participant.');
      const start=fd.get('start'),end=fd.get('end');if(end<=start)return toast('End time must be after start time.');
      const event={id:'ev'+Date.now(),type,project:regularTask?null:pid,task:tid,regularWorkTaskId:regularTask?tid:null,contextType:regularTask?'regular_work':'project',title:fd.get('title').trim(),date:fd.get('date'),start,end,participants,createdBy:uid(),createdByUid:window.firebaseHub.firebaseUid,agenda:type==='meeting'?(fd.get('agenda')||'').trim():'',reminderMinutes:type==='meeting'?15:0,responses:{}};
      const conflicts=type==='meeting'?findConflicts(event):[];if(conflicts.length&&!confirm(`Scheduling conflict detected for ${conflicts.map(c=>user(c.user).name).join(', ')}. Continue anyway?`))return;
      const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
      try{
        if(regularTask){const saved=await window.firebaseHub.saveRegularWorkCalendarEvent(event);state.calendarEvents.push(saved)}else{state.calendarEvents.push(event)}
        log(uid(),pid,tid,type==='meeting'?'Meeting':'Planner',type==='meeting'?`scheduled meeting “${event.title}”`:`scheduled work block “${event.title}”`,`${fmtDateFull(event.date)} • ${timeLabel(start)}–${timeLabel(end)}`);
        if(regularTask&&state.activity?.[0])try{await window.firebaseHub.saveRegularWorkActivity(state.activity[0])}catch(error){console.error('Planner item was saved but its activity record could not be saved:',error)}
        if(!regularTask)save();
        closePlannerModal();toast(type==='meeting'?'Meeting scheduled for all selected participants.':'Work block added to your Planner.');render();
      }catch(error){if(regularTask)state.calendarEvents=state.calendarEvents.filter(item=>item.id!==event.id);console.error('Could not save Planner item:',error);toast(error?.message||'Planner item could not be saved. Please try again.');if(submit)submit.disabled=false}
    };
  }

  function findConflicts(ev){const out=[];(ev.participants||[]).forEach(pid=>state.calendarEvents.filter(x=>x.id!==ev.id&&x.type==='meeting'&&x.date===ev.date&&(x.participants||[]).includes(pid)).forEach(x=>{if(ev.start<x.end&&ev.end>x.start)out.push({user:pid,event:x})}));return out}

  function openCalendarEvent(id){const e=state.calendarEvents.find(x=>x.id===id);if(!e)return;const p=eventProject(e),t=eventTask(e),mine=(e.participants||[]).includes(uid()),response=e.responses?.[uid()]||'No response';openPlannerModal(e.title,`<div class="event-detail-head"><span class="event-type-badge ${eventColorClass(e)}">${e.type==='meeting'?'Project Meeting':'Work Block'}</span><strong>${fmtDateFull(e.date)} • ${timeLabel(e.start)}–${timeLabel(e.end)}</strong></div><div class="detail-grid"><div class="detail-box"><span>Project</span><strong>${p?.name||'Personal'}</strong></div>${t?`<div class="detail-box"><span>Related task</span><strong>${escapeHtml(t.title)}</strong></div>`:''}<div class="detail-box"><span>Created by</span><strong>${user(e.createdBy).name}</strong></div><div class="detail-box"><span>Reminder</span><strong>${e.reminderMinutes?e.reminderMinutes+' minutes before':'None'}</strong></div></div>${e.agenda?`<div class="meeting-agenda"><span>AGENDA</span><p>${escapeHtml(e.agenda)}</p></div>`:''}${e.type==='meeting'?`<div class="meeting-participants"><h4>Participants</h4>${(e.participants||[]).map(x=>`<div>${avatar(x)}<span>${user(x).name}</span><strong>${e.responses?.[x]||'No response'}</strong></div>`).join('')}</div>${mine?`<div class="rsvp"><span>Your response: <strong>${response}</strong></span><div><button class="btn btn-soft" data-rsvp="accepted">Accept</button><button class="btn btn-ghost" data-rsvp="tentative">Tentative</button><button class="btn btn-ghost" data-rsvp="declined">Decline</button></div></div>`:''}`:''}<div class="modal-actions">${t?'<button class="btn btn-ghost" id="openRelatedTask">Open Related Task</button>':''}<button class="btn btn-soft" id="closeEventDetail">Close</button></div>`);el('closeEventDetail').onclick=closePlannerModal;if(t)el('openRelatedTask').onclick=()=>{closePlannerModal();openTask(t.id)};document.querySelectorAll('[data-rsvp]').forEach(b=>b.onclick=()=>{e.responses=e.responses||{};e.responses[uid()]=b.dataset.rsvp;log(uid(),e.project,e.task,'Meeting',`${b.dataset.rsvp} meeting “${e.title}”`);save();closePlannerModal();toast('Meeting response saved.');render()})}

  function checkMeetingReminders(){
    const now=new Date(),todayStr=now.toLocaleDateString('en-CA'),minutes=now.getHours()*60+now.getMinutes();let due=[];
    state.calendarEvents.filter(e=>e.type==='meeting'&&e.date===todayStr&&(e.participants||[]).includes(uid())).forEach(e=>{const [h,m]=e.start.split(':').map(Number),delta=h*60+m-minutes,key=e.id+'-'+uid();if(delta>=0&&delta<=15&&!state.plannerRead[key])due.push({e,delta,key})});
    if(due.length){due.forEach(x=>state.plannerRead[x.key]=true);save();const x=due[0];toast(`Meeting in ${x.delta} min: ${x.e.title}`);const dot=el('notificationDot');if(dot)dot.classList.add('active')}
  }

  function showNotifications(){const mine=state.calendarEvents.filter(e=>e.type==='meeting'&&(e.participants||[]).includes(uid())).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)).slice(0,6);openPlannerModal('Meeting reminders',mine.length?`<div class="notification-list">${mine.map(e=>`<button class="notification-row" data-notification-event="${escapeHtml(e.id)}"><div><strong>${escapeHtml(e.title)}</strong><span>${fmtDateFull(e.date)} • ${escapeHtml(timeLabel(e.start))} • ${escapeHtml(eventProject(e)?.name||'')}</span></div><span>→</span></button>`).join('')}</div>`:'<div class="empty"><strong>No meetings yet</strong>Your upcoming meeting reminders will appear here.</div>');document.querySelectorAll('[data-notification-event]').forEach(b=>b.onclick=()=>{closePlannerModal();openCalendarEvent(b.dataset.notificationEvent)});const dot=el('notificationDot');if(dot)dot.classList.remove('active')}

  openCalendarEvent=function(id){
    const event=state.calendarEvents.find(item=>item.id===id);if(!event)return;
    const linkedProject=eventProject(event),relatedTask=eventTask(event),mine=(event.participants||[]).includes(uid()),response=event.responses?.[uid()]||'No response';
    openPlannerModal(event.title,`<div class="event-detail-head"><span class="event-type-badge ${eventColorClass(event)}">${event.type==='meeting'?'Project Meeting':'Work Block'}</span><strong>${escapeHtml(fmtDateFull(event.date))} • ${escapeHtml(timeLabel(event.start))}–${escapeHtml(timeLabel(event.end))}</strong></div><div class="detail-grid"><div class="detail-box"><span>Project</span><strong>${escapeHtml(linkedProject?.name||'Personal')}</strong></div>${relatedTask?`<div class="detail-box"><span>Related task</span><strong>${escapeHtml(relatedTask.title)}</strong></div>`:''}<div class="detail-box"><span>Created by</span><strong>${escapeHtml(user(event.createdBy).name)}</strong></div><div class="detail-box"><span>Reminder</span><strong>${event.reminderMinutes?`${escapeHtml(event.reminderMinutes)} minutes before`:'None'}</strong></div></div>${event.agenda?`<div class="meeting-agenda"><span>AGENDA</span><p>${escapeHtml(event.agenda)}</p></div>`:''}${event.type==='meeting'?`<div class="meeting-participants"><h4>Participants</h4>${(event.participants||[]).map(participant=>`<div>${avatar(participant)}<span>${escapeHtml(user(participant).name)}</span><strong>${escapeHtml(event.responses?.[participant]||'No response')}</strong></div>`).join('')}</div>${mine?`<div class="rsvp"><span>Your response: <strong>${escapeHtml(response)}</strong></span><div><button class="btn btn-soft" data-rsvp="accepted">Accept</button><button class="btn btn-ghost" data-rsvp="tentative">Tentative</button><button class="btn btn-ghost" data-rsvp="declined">Decline</button></div></div>`:''}`:''}<div class="modal-actions">${relatedTask?'<button class="btn btn-ghost" id="openRelatedTask">Open Related Task</button>':''}<button class="btn btn-soft" id="closeEventDetail">Close</button></div>`);
    el('closeEventDetail').onclick=closePlannerModal;
    if(relatedTask)el('openRelatedTask').onclick=()=>{closePlannerModal();openTask(relatedTask.id)};
    document.querySelectorAll('[data-rsvp]').forEach(button=>button.onclick=async()=>{const responseValue=button.dataset.rsvp,nextEvent={...event,responses:{...(event.responses||{}),[uid()]:responseValue}},regular=event.contextType==='regular_work'||relatedTask?.contextType==='regular_work';button.disabled=true;try{if(regular)await window.firebaseHub.saveRegularWorkCalendarEvent(nextEvent);Object.assign(event,nextEvent);const priorActivityIds=new Set(state.activity.map(item=>item.id));log(uid(),event.project,event.task,'Meeting',`${responseValue} meeting “${event.title}”`);if(regular){const activity=state.activity.find(item=>!priorActivityIds.has(item.id));if(activity)try{await window.firebaseHub.saveRegularWorkActivity(activity)}catch(error){console.error('Planner response saved but its activity record could not be saved:',error)}}else save();closePlannerModal();toast('Meeting response saved.');render()}catch(error){console.error('Could not save Planner response:',error);toast(error?.message||'Meeting response could not be saved.')}finally{button.disabled=false}});
  };

  migratePlanner();

  const baseRender=render;
  render=function(search=''){
    if(!activeProject && activeView==='planner'){renderPlanner();wireDynamic();return}
    baseRender(search);
  };

  const baseProjectTab=renderProjectTab;
  renderProjectTab=function(p,tasks,tab){if(tab==='calendar')return renderProjectCalendar(p,tasks);return baseProjectTab(p,tasks,tab)};

  const baseDashboard=renderDashboard;
  renderDashboard=function(){baseDashboard();const content=el('content'),metrics=content.querySelector('.metrics');if(metrics)metrics.insertAdjacentHTML('afterend',myDayBlock())};

  const baseOpenTask=openTask;
  openTask=function(id){baseOpenTask(id);const t=task(id);if(!t)return;const section=el('drawerBody')?.querySelector('.drawer-section:nth-of-type(3)');if(section){const row=section.querySelector('.drawer-actions');if(row&&!row.querySelector('.schedule-task-btn'))row.insertAdjacentHTML('beforeend',`<button class="btn btn-ghost schedule-task-btn" data-schedule-task="${escapeHtml(id)}">Schedule on Planner</button>${canScheduleTaskMeeting(t)?`<button class="btn btn-ghost schedule-task-meeting" data-schedule-meeting="${escapeHtml(id)}">Schedule Meeting</button>`:''}`)}document.querySelectorAll('[data-schedule-task]').forEach(b=>b.onclick=()=>openPlannerCreate({task:id,project:t.project,title:`Work on ${t.title}`}));document.querySelectorAll('[data-schedule-meeting]').forEach(b=>b.onclick=()=>openPlannerCreate({type:'meeting',task:id,project:t.project,title:`${t.title} Review`}))};

  const baseWire=wireDynamic;
  wireDynamic=function(){
    baseWire();
    document.querySelectorAll('[data-planner-scope]').forEach(b=>b.onclick=()=>{plannerScope=b.dataset.plannerScope;render()});
    document.querySelectorAll('[data-planner-mode]').forEach(b=>b.onclick=()=>{plannerMode=b.dataset.plannerMode;render()});
    document.querySelectorAll('[data-cal-task]').forEach(b=>b.onclick=e=>{e.stopPropagation();openTask(b.dataset.calTask)});
    document.querySelectorAll('[data-cal-event]').forEach(b=>b.onclick=e=>{e.stopPropagation();openCalendarEvent(b.dataset.calEvent)});
    const pb=el('plannerNewBtn');if(pb)pb.onclick=()=>openPlannerCreate();
    const prev=el('plannerPrev');if(prev)prev.onclick=()=>{plannerDate=addDays(plannerDate,-7);render()};
    const next=el('plannerNext');if(next)next.onclick=()=>{plannerDate=addDays(plannerDate,7);render()};
    const td=el('plannerToday');if(td)td.onclick=()=>{plannerDate=new Date().toLocaleDateString('en-CA');render()};
    const ptd=el('projectCalendarToday');if(ptd)ptd.onclick=()=>{plannerDate=new Date().toLocaleDateString('en-CA');render()};
    const pm=el('projectMeetingBtn');if(pm&&activeProject)pm.onclick=()=>openPlannerCreate({type:'meeting',project:activeProject,title:`${project(activeProject).name} Review`});
  };

  const nb=el('notificationBtn');if(nb)nb.onclick=showNotifications;
  setInterval(checkMeetingReminders,30000);checkMeetingReminders();
  render();
})();
