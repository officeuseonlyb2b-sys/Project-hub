/* Execution Hub — Daily Work Performance, derived from existing authorized live state */
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const isAdmin=()=>!!window.firebaseHub?.isSystemAdmin();
  const uid=()=>state.currentUser;
  const userById=id=>state.users.find(person=>person.id===id)||{id,name:'Unassigned',initials:'?',active:false};
  const projectById=id=>state.projects.find(item=>item.id===id)||null;
  const isoDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const parseDate=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`):null;
  const shiftDate=(value,days)=>{const date=parseDate(value);if(!date)return '';date.setDate(date.getDate()+days);return isoDate(date)};
  const today=()=>isoDate(new Date());
  const shortDate=value=>value?parseDate(value).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}):'—';
  const timeText=value=>value?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'';
  const fullDate=value=>value?parseDate(value).toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
  const itemDate=item=>String(item.dueDate||'').slice(0,10);
  const isTerminal=item=>['Completed','Cancelled','Canceled'].includes(item.status);
  const overdueState=item=>!isTerminal(item)&&item.status!=='Ready for Review';
  const priorityWeight=priority=>priority==='P0'?4:priority==='P1'?3:priority==='P2'?2:1;
  const priorityLabel=priority=>({P0:'P0 · Critical',P1:'P1 · High',P2:'P2 · Medium',P3:'P3 · Low'})[priority]||priority||'—';
  let dateFilter='today',workFilter='all',scopeFilter='my',chartDays=7;
  let shareMode=false,drillCleanup=null;
  let dailyCache=new Map(),dailyListenerStop=null,dailyListenerKey='';
  const dailyCacheTouched=new Map();
  const title='My Work Snapshot';

  function accessibleTask(task){
    if(!task)return false;
    if(task.contextType==='regular_work')return !!window.firebaseHub?.canAccessRegularWorkTask(task.id);
    const project=projectById(task.project);
    return !!project&&(isAdmin()||project.projectLead===uid()||(project.team||[]).includes(uid()));
  }
  function canTeamScope(){return isAdmin()||state.projects.some(project=>project.projectLead===uid()||(project.team||[]).includes(uid()))}
  function scopeAllowed(scope){return scope==='my'||(scope==='team'&&canTeamScope())||(scope==='department'&&isAdmin())}
  function dateWindow(mode=dateFilter){
    const base=today();
    if(mode==='yesterday')return {start:shiftDate(base,-1),end:shiftDate(base,-1)};
    if(mode==='tomorrow')return {start:shiftDate(base,1),end:shiftDate(base,1)};
    if(mode==='week'){const day=parseDate(base).getDay(),offset=(day+6)%7,start=shiftDate(base,-offset);return {start,end:shiftDate(start,6)}}
    if(mode==='month'){const now=new Date(),start=isoDate(new Date(now.getFullYear(),now.getMonth(),1)),end=isoDate(new Date(now.getFullYear(),now.getMonth()+1,0));return {start,end}}
    return {start:base,end:base};
  }
  function inWindow(value,window=dateWindow()){
    const day=String(value||'').slice(0,10);return !!day&&day>=window.start&&day<=window.end;
  }
  function activityForTask(taskId){return (state.activity||[]).filter(event=>(event.task===taskId||event.regularWorkTaskId===taskId)&&event.time).sort((a,b)=>String(a.time).localeCompare(String(b.time)))}
  function completionTime(task){
    if(task.completedAt)return task.completedAt;
    return activityForTask(task.id).findLast?.(event=>/completed/i.test(event.text||'')||/completed/i.test(event.change||''))?.time||'';
  }
  function creationTime(task){
    if(task.createdAt)return task.createdAt;
    return activityForTask(task.id).find(event=>event.type==='Task'&&/created/i.test(event.text||''))?.time||'';
  }
  function assignmentTime(task){
    const assignment=activityForTask(task.id).findLast?.(event=>event.type==='Assignment');
    return assignment?.time||creationTime(task);
  }
  function cancellationTime(item){
    if(item.cancelledAt)return item.cancelledAt;
    if(item.kind==='daily')return '';
    return activityForTask(item.parentId).findLast?.(event=>/cancel(?:led|ed)/i.test(`${event.text||''} ${event.change||''}`))?.time||'';
  }
  function mappedParent(task){
    const project=task.project?projectById(task.project):null;
    const folder=task.contextType==='regular_work'?(state.regularWorkFolders||[]).find(item=>item.id===task.regularFolderId):null;
    const category=task.contextType==='regular_work'?(state.regularWorkCategories||[]).find(item=>item.id===task.regularCategoryId):null;
    const source=task.contextType==='regular_work'?'Regular Work':'Project Work';
    const detail=task.contextType==='regular_work'?[folder?.name||task.regularFolderName,category?.name||task.regularCategoryName].filter(Boolean).join(' · '):[project?.name,task.workstream].filter(Boolean).join(' · ');
    return {id:task.id,parentId:task.id,kind:'task',contextType:task.contextType==='regular_work'?'regular':'project',title:task.title||'Untitled task',status:task.status||'Not Started',priority:task.priority||'',dueDate:task.currentDue||task.originalDue||'',completedAt:completionTime(task),createdAt:creationTime(task),assignedAt:assignmentTime(task),owner:task.owner,source,sourceDetail:detail,record:task,parentTask:task,waitingOn:task.waitingOn||'',project:task.project||null};
  }
  function projectScopeAllows(task,scope){
    const project=projectById(task.project);
    if(!project)return false;
    if(isAdmin())return true;
    if(!accessibleTask(task))return false;
    return scope==='team'||scope==='department'||task.owner===uid();
  }
  function parentTaskScopeAllows(task,scope){
    if(!accessibleTask(task))return false;
    if(scope==='my')return task.owner===uid()||task.createdBy===uid()||(task.accessUserIds||[]).includes(uid());
    return true;
  }
  function parentTasksForScope(scope=scopeFilter,type=workFilter){
    return (state.tasks||[]).filter(task=>{
      const regular=task.contextType==='regular_work';
      if(type==='regular'&&!regular)return false;
      if(type==='project'&&regular)return false;
      if(regular)return parentTaskScopeAllows(task,scope);
      return projectScopeAllows(task,scope);
    });
  }
  function departmentPeople(){
    const profile=userById(uid()),departmentId=profile.departmentId;
    return new Set((state.users||[]).filter(person=>person.active!==false&&(departmentId?person.departmentId===departmentId:person.dept===profile.dept)).map(person=>person.id));
  }
  function scopeItems(scope=scopeFilter,type=workFilter){
    let parents=parentTasksForScope(scope,type);
    if(scope==='department'&&isAdmin()){
      const members=departmentPeople();parents=parents.filter(task=>members.has(task.owner));
    }
    const items=parents.map(mappedParent);
    const dailyParents=parents.filter(task=>task.contextType==='regular_work');
    for(const parent of dailyParents){
      for(const child of dailyCache.get(parent.id)||[]){
        if(child.archived===true)continue;
        if(scope==='my'&&child.assignedTo!==uid())continue;
        if(scope==='department'&&isAdmin()&&!departmentPeople().has(child.assignedTo))continue;
        items.push({id:`daily:${parent.id}:${child.id}`,parentId:parent.id,kind:'daily',contextType:'regular',title:child.title||'Daily task',status:child.status||'Not Started',priority:child.priority||parent.priority||'',dueDate:child.date||'',completedAt:child.completedAt||'',createdAt:child.createdAt||'',assignedAt:child.createdAt||'',owner:child.assignedTo,source:'Regular Work',sourceDetail:[parent.regularFolderName,parent.regularCategoryName,'Daily Task'].filter(Boolean).join(' · '),record:child,parentTask:parent,waitingOn:''});
      }
    }
    return items;
  }
  function syncDailyListeners(parents){
    const ids=[...new Set(parents.filter(task=>task.contextType==='regular_work').map(task=>task.id))].sort();
    const key=ids.join('|');
    if(key===dailyListenerKey)return;
    if(dailyListenerStop){dailyListenerStop();dailyListenerStop=null}
    dailyListenerKey=key;
    if(!ids.length||!window.firebaseHub?.watchRegularWorkDailyTasks)return;
    dailyListenerStop=window.firebaseHub.watchRegularWorkDailyTasks(ids,(parentTaskId,records)=>{
      dailyCache.set(parentTaskId,records||[]);dailyCacheTouched.set(parentTaskId,Date.now());
      if(activeView==='dailywork'&&!shareMode)renderDailyWork();
      if(shareMode)renderShareSnapshot();
    });
  }
  function completedInWindow(items,window=dateWindow()){
    return items.filter(item=>item.status==='Completed'&&inWindow(item.completedAt,window));
  }
  function dueInWindow(items,window=dateWindow()){
    return items.filter(item=>inWindow(item.dueDate,window)&&item.status!=='Cancelled'&&item.status!=='Canceled');
  }
  function overdueItems(items,asOf=windowEnd(dateWindow())){
    return items.filter(item=>item.dueDate&&item.dueDate<asOf&&overdueState(item));
  }
  function windowEnd(window){return shiftDate(window.end,1)}
  function isNewInWindow(item,window=dateWindow()){
    return inWindow(item.assignedAt,window)||inWindow(item.createdAt,window);
  }
  function reviewItems(items,approvals,window=dateWindow()){
    const reviewTasks=items.filter(item=>['Ready for Review','Changes Required'].includes(item.status));
    const linked=new Set(reviewTasks.map(item=>item.parentId));
    for(const approval of approvals){
      if(['Approved','Rejected','Cancelled'].includes(approval.status)||!(inWindow(approval.requestedAt,window)||inWindow(approval.dueAt,window)))continue;
      if(approval.task&&linked.has(approval.task))continue;
      reviewTasks.push({id:`approval:${approval.id}`,kind:'approval',parentId:approval.task||'',record:approval,title:approval.title||approval.type||'Approval request',status:approval.status||'Pending',priority:approval.priority||'',dueDate:approval.dueAt||'',source:'Approval',sourceDetail:'Approvals & Reviews'});
      if(approval.task)linked.add(approval.task);
    }
    return reviewTasks;
  }
  function authorizedApprovals(scope=scopeFilter,parents=parentTasksForScope(scope,workFilter)){
    const ids=new Set(parents.map(task=>task.id)),projects=new Set(parents.map(task=>task.project).filter(Boolean));
    let records=(state.approvals||[]).filter(approval=>isAdmin()||approval.requestedBy===uid()||(approval.approvers||[]).includes(uid())||(approval.task&&ids.has(approval.task))||(approval.project&&projects.has(approval.project))).filter(approval=>scope!=='my'||approval.requestedBy===uid()||(approval.approvers||[]).includes(uid())||(approval.task&&ids.has(approval.task)));
    if(scope==='department'&&isAdmin()){
      const members=departmentPeople();
      records=records.filter(approval=>{
        const linked=(state.tasks||[]).find(task=>task.id===approval.task);
        return linked?members.has(linked.owner):members.has(approval.requestedBy)||(approval.approvers||[]).some(id=>members.has(id));
      });
    }
    return records;
  }
  function approvalChangeTime(approval){
    return Object.values(approval.decisions||{}).findLast?.(decision=>decision.status==='Changes Requested')?.at||approval.requestedAt||'';
  }
  function accessibleCalendarEvent(event){
    if(isAdmin())return true;
    if(event.project){const project=projectById(event.project);return !!project&&accessibleTask({project:project.id,contextType:'project'})}
    const related=event.regularWorkTaskId||event.task;
    if(related){const parent=(state.tasks||[]).find(task=>task.id===related);if(parent)return accessibleTask(parent)}
    return (event.participants||[]).includes(uid());
  }
  function calendarEventsForScope(scope=scopeFilter,type=workFilter){
    return (state.calendarEvents||[]).filter(event=>{
      if(!accessibleCalendarEvent(event))return false;
      const related=event.regularWorkTaskId||event.task,parent=(state.tasks||[]).find(task=>task.id===related);
      const eventType=event.contextType==='regular_work'||parent?.contextType==='regular_work'?'regular':event.project?'project':'personal';
      if(type==='regular'&&eventType!=='regular')return false;
      if(type==='project'&&eventType!=='project')return false;
      if(scope==='my')return (event.participants||[]).includes(uid())||(parent&&parent.owner===uid());
      if(scope==='department'&&isAdmin()){
        const members=departmentPeople();
        return parent?members.has(parent.owner):(event.participants||[]).some(id=>members.has(id));
      }
      return true;
    });
  }
  function getApprovalGroups(approvals,window=dateWindow()){
    const active=approvals.filter(item=>!['Approved','Rejected','Cancelled'].includes(item.status)&&(inWindow(item.dueAt,window)||inWindow(item.requestedAt,window)));
    return {
      requested:active.filter(item=>(item.approvers||[]).includes(uid())&&item.requestedBy!==uid()),
      sent:active.filter(item=>item.requestedBy===uid()),
      changes:approvals.filter(item=>item.status==='Changes Requested'&&inWindow(approvalChangeTime(item),window)&&(isAdmin()||item.requestedBy===uid()||(item.approvers||[]).includes(uid())))
    };
  }
  function taskActivityEvent(item,predicate,window=dateWindow()){
    if(item.kind==='daily')return false;
    return activityForItem(item).some(event=>inWindow(event.time,window)&&predicate(event));
  }
  function activityForItem(item){return (state.activity||[]).filter(event=>event.task===item.parentId||event.regularWorkTaskId===item.parentId)}
  function dailyCreated(item,window=dateWindow()){
    return item.kind==='daily'&&inWindow(item.createdAt,window);
  }
  function taskCreatedOrAssigned(item,window=dateWindow()){
    if(dailyCreated(item,window)||inWindow(item.createdAt,window))return true;
    if(item.kind==='daily')return (state.activity||[]).some(event=>event.task===item.parentId&&event.type==='Daily Task'&&String(event.text||'').includes(item.title)&&/reassign|added/i.test(event.text||'')&&inWindow(event.time,window));
    return taskActivityEvent(item,event=>event.type==='Task'&&/creat/i.test(event.text||''),window)||taskActivityEvent(item,event=>event.type==='Assignment',window);
  }
  function movementCounts(items,approvals,window=dateWindow()){
    const newItems=items.filter(item=>taskCreatedOrAssigned(item,window));
    const completed=completedInWindow(items,window);
    const sent=approvals.filter(item=>inWindow(item.requestedAt,window));
    const changes=approvals.filter(item=>item.status==='Changes Requested'&&inWindow(approvalChangeTime(item),window));
    const cancelled=items.filter(item=>['Cancelled','Canceled'].includes(item.status)&&inWindow(cancellationTime(item),window)).concat(approvals.filter(item=>item.status==='Cancelled'&&inWindow(item.cancelledAt||item.completedAt,window)));
    const waiting=items.filter(item=>!isTerminal(item)&&(item.waitingOn||['Waiting','Blocked'].includes(item.status)));
    return {newItems,completed,sent,changes,cancelled,waiting};
  }
  function nextMeeting(events){
    const now=new Date();
    return events.filter(event=>event.type==='meeting'&&event.date&&new Date(`${event.date}T${event.start||'00:00'}:00`)>now).sort((a,b)=>`${a.date}${a.start||''}`.localeCompare(`${b.date}${b.start||''}`))[0]||null;
  }
  function meetingTimeUntil(event){
    if(!event)return '';
    const start=new Date(`${event.date}T${event.start||'00:00'}:00`),minutes=Math.max(0,Math.round((start-Date.now())/60000));
    return minutes<60?`in ${minutes} min`:`in ${Math.floor(minutes/60)} hr${Math.floor(minutes/60)===1?'':'s'}`;
  }
  function dateButtonMarkup(){
    return [['yesterday','Yesterday'],['today','Today'],['tomorrow','Tomorrow'],['week','This Week'],['month','This Month']].map(([value,label])=>`<button type="button" class="dwp-date-option ${dateFilter===value?'active':''}" data-dwp-date="${value}">${label}</button>`).join('');
  }
  function optionsMarkup(options,selected){return options.map(([value,label,disabled])=>`<option value="${value}" ${selected===value?'selected':''} ${disabled?'disabled':''}>${label}${disabled?' · Unavailable':''}</option>`).join('')}
  function taskSource(item){return item.sourceDetail?`${item.source} · ${item.sourceDetail}`:item.source}
  function statusClass(status){if(status==='Completed')return 'completed';if(['Waiting','Blocked'].includes(status))return 'waiting';if(['Ready for Review','Changes Required'].includes(status))return 'review';if(['Cancelled','Canceled'].includes(status))return 'cancelled';return 'progress'}
  function priorityClass(priority){return String(priority||'').toLowerCase()}
  function taskRow(item){
    return `<tr class="dwp-task-row" data-dwp-item="${esc(item.id)}"><td><button type="button" class="dwp-task-title" data-dwp-item="${esc(item.id)}">${esc(item.title)}</button></td><td><span class="dwp-source ${item.contextType}">${esc(taskSource(item))}</span></td><td><span class="dwp-priority ${priorityClass(item.priority)}">${esc(item.priority||'—')}</span></td><td><span class="dwp-status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${esc(shortDate(item.dueDate))}</td></tr>`;
  }
  function calendarSubtitle(event){
    const linked=event.regularWorkTaskId||event.task,parent=(state.tasks||[]).find(task=>task.id===linked),project=event.project?projectById(event.project):null;
    const source=parent?.contextType==='regular_work'?'Regular Work':project?'Project Work':event.type==='meeting'?'Meeting':'Personal';
    const duration=event.start&&event.end?`${event.start}–${event.end}`:event.type==='meeting'?'Meeting':'Work block';
    return `${source}${project?` · ${project.name}`:parent?.regularFolderName?` · ${parent.regularFolderName}`:''}${event.participants?.length?` · ${event.participants.length} participants`:''} · ${duration}`;
  }
  function renderPlannerTimeline(events,window=dateWindow()){
    const rows=events.filter(event=>inWindow(event.date,window)).sort((a,b)=>`${a.date}${a.start||''}`.localeCompare(`${b.date}${b.start||''}`)).slice(0,6);
    const meeting=nextMeeting(events);
    return `<div class="dwp-planner-list">${rows.map(event=>`<button type="button" class="dwp-planner-row ${event.type==='meeting'?'meeting':event.contextType==='regular_work'?'regular':'project'}" data-dwp-planner="${esc(event.id)}"><time>${esc(event.start||'All day')}</time><span class="dwp-planner-event"><strong>${esc(event.title)}</strong><small>${esc(calendarSubtitle(event))}</small></span></button>`).join('')||'<div class="dwp-empty-inline">No Planner items in this date range.</div>'}</div><div class="dwp-next-meeting"><small>NEXT MEETING</small><strong>${meeting?`${esc(timeText(`${meeting.date}T${meeting.start||'00:00'}`))} · ${esc(meetingTimeUntil(meeting))}`:'No upcoming meeting'}</strong>${meeting?`<span>${esc(meeting.title)}</span>`:''}</div>`;
  }
  function visibleActivity(items,window=dateWindow()){
    const parentIds=new Set(items.map(item=>item.parentId));
    return (state.activity||[]).filter(event=>{
      if(!inWindow(event.time,window))return false;
      if(event.task||event.regularWorkTaskId)return parentIds.has(event.task||event.regularWorkTaskId);
      if(event.project){const project=projectById(event.project);return !!project&&(isAdmin()||project.projectLead===uid()||(project.team||[]).includes(uid()))}
      return event.user===uid();
    });
  }
  function activeItemsInWindow(items,window=dateWindow()){
    return items.filter(item=>!isTerminal(item)&&((inWindow(item.dueDate,window))||(!item.dueDate&&isNewInWindow(item,window))));
  }
  function isNewInWindow(item,window=dateWindow()){
    return inWindow(item.createdAt,window)||inWindow(item.assignedAt,window)||taskActivityEvent(item,event=>event.type==='Assignment'||event.type==='Task',window);
  }
  function calculateKpis(items,approvals,events,window=dateWindow()){
    const due=dueInWindow(items,window),overdue=overdueItems(items,today()),completed=completedInWindow(items,window);
    const pending=items.filter(item=>!isTerminal(item)&&item.dueDate&&item.dueDate<=window.end);
    const review=reviewItems(items,approvals,window),waiting=items.filter(item=>!isTerminal(item)&&(item.waitingOn||['Waiting','Blocked'].includes(item.status)));
    const cancelled=items.filter(item=>['Cancelled','Canceled'].includes(item.status)&&inWindow(cancellationTime(item),window)).concat(approvals.filter(item=>item.status==='Cancelled'&&inWindow(item.cancelledAt||item.completedAt,window)));
    const meetings=events.filter(event=>event.type==='meeting'&&inWindow(event.date,window));
    const active=items.filter(item=>!isTerminal(item));
    const newToday=items.filter(item=>isNewInWindow(item,window));
    const controls=due.filter(item=>!isTerminal(item));
    const overdueDue=controls.filter(item=>itemDate(item)<today()&&overdueState(item));
    const control=controls.length?Math.round((controls.length-overdueDue.length)/controls.length*100):null;
    return {pending,overdue,due,created:newToday,review,waiting,completed,cancelled,meetings,active,control,controls};
  }
  function countPill(items){return items.length.toLocaleString('en-US')}
  function renderKpiGrid(metrics){
    const cards=[['Pending Today',metrics.pending,'blue','Open work due by the end of this range'],['Overdue',metrics.overdue,'red','Open items past due'],['Due Today',metrics.due,'amber','Items due in this range'],['New Today',metrics.created,'purple','Created or assigned in this range'],['In Review',metrics.review,'purple','Review states and linked approvals'],['Waiting',metrics.waiting,'blue','Items waiting on people or dependencies'],['Completed',metrics.completed,'green','Completed in this range'],['Cancelled',metrics.cancelled,'muted','Cancelled work/approvals where recorded'],['Meetings',metrics.meetings,'purple','Planner meetings in this range'],['Active Load',metrics.active,'teal','All open work in this scope']];
    return `<div class="dwp-kpi-grid">${cards.map(([label,items,tone,help])=>`<button type="button" class="dwp-kpi ${tone}" data-dwp-kpi="${label}"><span>${label}</span><strong>${countPill(items)}</strong><small>${help}</small></button>`).join('')}</div>`;
  }
  function dayStats(items,events,date){
    const due=items.filter(item=>itemDate(item)===date),completed=items.filter(item=>item.status==='Completed'&&String(item.completedAt||'').slice(0,10)===date),open=due.filter(overdueState),overdue=open.filter(item=>itemDate(item)<date),meetings=events.filter(event=>event.type==='meeting'&&event.date===date),critical=due.filter(item=>item.priority==='P0');
    return {due,completed,overdue,meetings,critical};
  }
  function renderComparison(items,events){
    const base=today(),days=[['yesterday','Yesterday',shiftDate(base,-1)],['today','Today',base],['tomorrow','Tomorrow',shiftDate(base,1)]];
    return `<div class="dwp-compare-grid">${days.map(([key,label,date])=>{const stats=dayStats(items,events,date);return `<button type="button" class="dwp-compare-card ${key==='today'?'current':''}" data-dwp-day="${date}"><span>${label}</span><strong>${stats.due.length}</strong><small>tasks due</small><div><i>${stats.completed.length} completed</i><i class="danger">${stats.overdue.length} overdue</i><i>${stats.meetings.length} meetings · ${stats.critical.length} P0</i></div></button>`}).join('')}</div>`;
  }
  function workloadValues(items,start,days){
    return Array.from({length:days},(_,index)=>{const date=shiftDate(start,index),records=items.filter(item=>itemDate(item)===date&&!isTerminal(item));return {date,count:records.length,items:records}});
  }
  function renderWorkloadChart(items,start,days,compact=false){
    const values=workloadValues(items,start,days),max=Math.max(1,...values.map(value=>value.count));
    return `<div class="${compact?'dwp-share-bars':'dwp-bars'}" style="grid-template-columns:repeat(${days},minmax(0,1fr))">${values.map(value=>`<button type="button" class="${compact?'dwp-share-bar-item':'dwp-bar-item'}" data-dwp-day="${value.date}" aria-label="${shortDate(value.date)}: ${value.count} tasks"><strong>${value.count}</strong><span class="${value.count>=Math.max(5,Math.ceil(max*.8))?'high':''}" style="--bar-height:${Math.max(5,Math.round(value.count/max*100))}%"></span><small>${compact?parseDate(value.date).toLocaleDateString('en-GB',{weekday:'short'}):shortDate(value.date)}</small></button>`).join('')}</div>`;
  }
  function approvalsDrillRows(groups){return [...groups.requested.map(item=>({type:'approval',record:item,title:item.title||item.type||'Approval request',sub:`Requested by ${userById(item.requestedBy).name} · ${item.status}`})),...groups.sent.map(item=>({type:'approval',record:item,title:item.title||item.type||'Approval request',sub:`Sent to ${(item.approvers||[]).map(id=>userById(id).name).join(', ')||'reviewer'} · ${item.status}`})),...groups.changes.map(item=>({type:'approval',record:item,title:item.title||item.type||'Approval request',sub:`Changes requested · ${userById(item.requestedBy).name}`}))]}
  function renderApprovalCard(groups){
    const rows=[['Requested from me',groups.requested,'A','purple'],['Sent by me',groups.sent,'S','blue'],['Changes requested',groups.changes,'R','amber']];
    return `<div class="dwp-approval-stack">${rows.map(([label,items,icon,tone])=>`<button type="button" class="dwp-approval-row" data-dwp-approval-group="${label}"><span class="dwp-approval-icon ${tone}">${icon}</span><span><strong>${items.length} ${label.toLowerCase()}</strong><small>${items.length?esc(items.slice(0,2).map(item=>item.title||item.type||'Approval').join(' · ')):'No items in this range'}</small></span><b>›</b></button>`).join('')}</div>`;
  }
  function renderTaskTable(items,window=dateWindow()){
    const active=activeItemsInWindow(items,window).sort((a,b)=>String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))||priorityWeight(b.priority)-priorityWeight(a.priority)).slice(0,12);
    return `<div class="dwp-table-wrap"><table class="dwp-table"><thead><tr><th>Task</th><th>Source</th><th>Priority</th><th>Status</th><th>Due</th></tr></thead><tbody>${active.map(taskRow).join('')||'<tr><td colspan="5"><div class="dwp-empty-inline">No active work for this date range.</div></td></tr>'}</tbody></table></div>`;
  }
  function renderMainPage(){
    const windowRange=dateWindow(),parents=parentTasksForScope(scopeFilter,workFilter);
    syncDailyListeners(parents);
    const items=scopeItems(),approvals=authorizedApprovals(scopeFilter,parents),events=calendarEventsForScope(),metrics=calculateKpis(items,approvals,events,windowRange);
    const workloadStart=windowRange.start,workload=workloadValues(items,workloadStart,chartDays),chartMax=Math.max(1,...workload.map(day=>day.count));
    const approvalsGroups=getApprovalGroups(approvals,windowRange),active=activeItemsInWindow(items,windowRange),todayLabel=fullDate(today());
    const nextMeetingItem=nextMeeting(events),controlText=metrics.control==null?'—':`${metrics.control}%`;
    setTitle(title,'DAILY WORK PERFORMANCE');document.body.classList.add('dwp-page-active');
    const content=el('content');content.innerHTML=`<main class="dwp-page">
      <section class="dwp-toolbar"><div class="dwp-date-switch" role="tablist" aria-label="Snapshot date">${dateButtonMarkup()}</div><div class="dwp-toolbar-right"><select class="dwp-select" id="dwpWorkType" aria-label="Work type">${optionsMarkup([['all','All Work'],['project','Project Work'],['regular','Regular Work']],workFilter)}</select><select class="dwp-select" id="dwpScope" aria-label="Scope"><option value="my" ${scopeFilter==='my'?'selected':''}>My View</option><option value="team" ${scopeFilter==='team'?'selected':''} ${canTeamScope()?'':'disabled'}>Team View${canTeamScope()?'':' · Unavailable'}</option><option value="department" ${scopeFilter==='department'?'selected':''} ${isAdmin()?'':'disabled'}>Department View${isAdmin()?'':' · Unavailable'}</option></select><button type="button" class="dwp-primary" id="dwpShareButton">▣ Share Snapshot</button></div></section>
      <section class="dwp-hero"><div><span class="dwp-eyebrow">TODAY</span><h2>${esc(todayLabel)}</h2><p>Your operational view across projects, regular work, approvals and planner.</p></div><div class="dwp-control-score"><strong>${controlText}</strong><span>Work under control</span>${metrics.control==null?'<small>Not enough due-work data</small>':'<small>Based on on-time due items in this date range</small>'}</div></section>
      ${renderKpiGrid(metrics)}
      <section class="dwp-two-col"><article class="dwp-card"><div class="dwp-section-head"><div><h3>Day-by-day comparison</h3><p>Yesterday, today and tomorrow at a glance.</p></div></div>${renderComparison(items,events)}</article><article class="dwp-card"><div class="dwp-section-head"><div><h3>Approvals &amp; reviews</h3><p>What needs a decision in this date range.</p></div><button type="button" class="dwp-text-button" data-dwp-open-view="approvals">View approvals →</button></div>${renderApprovalCard(approvalsGroups)}</article></section>
      <section class="dwp-card"><div class="dwp-section-head"><div><h3>Upcoming workload</h3><p>Task count by day. Click a bar to inspect that date.</p></div><div class="dwp-range-switch" role="group" aria-label="Workload range">${[7,14,30].map(days=>`<button type="button" class="${chartDays===days?'active':''}" data-dwp-range="${days}">${days} Days</button>`).join('')}</div></div><div class="dwp-chart-scale" style="--chart-max:${chartMax}">${renderWorkloadChart(items,workloadStart,chartDays)}</div></section>
      <section class="dwp-two-col dwp-work-planner"><article class="dwp-card"><div class="dwp-section-head"><div><h3>Today's active work</h3><p>Click any row for the full task view.</p></div><button type="button" class="dwp-text-button" data-dwp-kpi="Active Load">View all →</button></div>${renderTaskTable(items,windowRange)}</article><article class="dwp-card"><div class="dwp-section-head"><div><h3>Planner snapshot</h3><p>Meetings and work blocks.</p></div><button type="button" class="dwp-text-button" data-dwp-open-view="planner">Open Planner →</button></div>${renderPlannerTimeline(events,windowRange)}</article></section>
      <footer class="dwp-footnote">Generated from authorized live Execution Hub data · Date range: ${esc(shortDate(windowRange.start))}–${esc(shortDate(windowRange.end))}</footer>
    </main>`;
    bindMainPage(items,approvals,events,metrics,windowRange,approvalsGroups);
    if(dailyListenerKey&&!dailyListenerStop){};
    return {items,parents,approvals,events,metrics,windowRange,approvalsGroups,workload,nextMeetingItem};
  }
  function openDrill(title,rows){
    let backdrop=document.getElementById('dwpDrillBackdrop');
    if(!backdrop){backdrop=document.createElement('div');backdrop.id='dwpDrillBackdrop';backdrop.className='dwp-drill-backdrop';backdrop.innerHTML='<aside id="dwpDrillDrawer" class="dwp-drill-drawer" role="dialog" aria-modal="true"><header><div><span>DAILY WORK PERFORMANCE</span><h2 id="dwpDrillTitle"></h2></div><button id="dwpDrillClose" type="button" aria-label="Close">×</button></header><div id="dwpDrillList" class="dwp-drill-list"></div></aside>';document.body.appendChild(backdrop);backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeDrill()});}
    document.getElementById('dwpDrillTitle').textContent=title;
    const list=document.getElementById('dwpDrillList');
    list.innerHTML=rows.length?rows.map((row,index)=>`<button type="button" class="dwp-drill-row" data-dwp-drill-row="${index}"><span class="dwp-drill-dot ${row.type==='approval'?'purple':row.kind==='daily'?'teal':row.status==='Completed'?'green':row.priority==='P0'?'red':'blue'}"></span><span><strong>${esc(row.title||row.record?.title||row.name||'Approval')}</strong><small>${esc(row.sub||row.sourceDetail||row.source||'')}</small></span><span>${esc(row.status||row.record?.status||'')}</span></button>`).join(''):'<div class="dwp-empty">No matching live records.</div>';
    list.querySelectorAll('[data-dwp-drill-row]').forEach(button=>button.onclick=()=>{
      const row=rows[Number(button.dataset.dwpDrillRow)];
      if(row?.type==='approval'||row?.kind==='approval'){goToView('approvals');closeDrill();return}
      if(row?.type==='meeting'||row?.type==='planner'){goToView('planner');closeDrill();return}
      if(row?.kind==='daily'){openTask(row.parentId);closeDrill();requestAnimationFrame(()=>document.querySelector(`[data-daily-task-id="${CSS.escape(row.record.id)}"]`)?.scrollIntoView({block:'center',behavior:'smooth'}));return}
      const record=row?.record||row;if(record?.id){closeDrill();openTask(record.id)}
    });
    document.getElementById('dwpDrillClose').onclick=closeDrill;
    requestAnimationFrame(()=>backdrop.classList.add('open'));
  }
  function closeDrill(){document.getElementById('dwpDrillBackdrop')?.classList.remove('open')}
  function goToView(view){activeProject=null;activeView=view;sessionStorage.setItem('executionHub.activeView',view);document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view));render()}
  function rangeItemsForDay(items,date){return items.filter(item=>itemDate(item)===date&&!isTerminal(item))}
  function bindMainPage(items,approvals,events,metrics,windowRange,approvalGroups){
    document.querySelectorAll('[data-dwp-date]').forEach(button=>button.onclick=()=>{dateFilter=button.dataset.dwpDate;renderDailyWork()});
    document.getElementById('dwpWorkType').onchange=event=>{workFilter=event.target.value;renderDailyWork()};
    document.getElementById('dwpScope').onchange=event=>{scopeFilter=event.target.value;if(!scopeAllowed(scopeFilter))scopeFilter='my';renderDailyWork()};
    document.querySelectorAll('[data-dwp-range]').forEach(button=>button.onclick=()=>{chartDays=Number(button.dataset.dwpRange);renderDailyWork()});
    document.getElementById('dwpShareButton').onclick=()=>openShareSnapshot(items,approvals,events,metrics,windowRange,approvalGroups);
    document.querySelectorAll('[data-dwp-kpi]').forEach(button=>button.onclick=()=>{
      const name=button.dataset.dwpKpi;
      const mapping={'Pending Today':metrics.pending,'Overdue':metrics.overdue,'Due Today':metrics.due,'New Today':metrics.created,'In Review':metrics.review,'Waiting':metrics.waiting,'Completed':metrics.completed,'Cancelled':metrics.cancelled,'Meetings':metrics.meetings,'Active Load':metrics.active};
      openDrill(name,(mapping[name]||[]).map(item=>item.kind==='approval'?{...item,type:'approval',sub:`${item.status} · ${item.sourceDetail}`}:{...item,sub:`${taskSource(item)} · ${item.status} · ${shortDate(item.dueDate)}`}));
    });
    document.querySelectorAll('[data-dwp-day]').forEach(button=>button.onclick=()=>{const date=button.dataset.dwpDay;openDrill(fullDate(date),rangeItemsForDay(items,date).map(item=>({...item,sub:`${taskSource(item)} · ${item.status} · ${item.priority||'—'}`})).concat(events.filter(event=>event.date===date&&event.type==='meeting').map(event=>({type:'meeting',title:event.title,sub:`Meeting · ${event.start||''}`}))))});
    document.querySelectorAll('.dwp-task-row').forEach(row=>row.onclick=event=>{if(event.target.closest('button,a,input,select,textarea'))return;openTaskForItem(items,row.dataset.dwpItem)});
    document.querySelectorAll('.dwp-task-title').forEach(button=>button.onclick=event=>{event.stopPropagation();openTaskForItem(items,button.dataset.dwpItem)});
    document.querySelectorAll('[data-dwp-open-view]').forEach(button=>button.onclick=()=>goToView(button.dataset.dwpOpenView));
    document.querySelectorAll('[data-dwp-approval-group]').forEach(button=>button.onclick=()=>openDrill(button.dataset.dwpApprovalGroup,approvalsDrillRows(approvalGroups).filter(row=>row.type==='approval'&&((button.dataset.dwpApprovalGroup==='Requested from me'&&row.record.approvers?.includes(uid())&&row.record.requestedBy!==uid())||(button.dataset.dwpApprovalGroup==='Sent by me'&&row.record.requestedBy===uid())||(button.dataset.dwpApprovalGroup==='Changes requested'&&row.record.status==='Changes Requested')))));
    document.querySelectorAll('.dwp-planner-row').forEach(button=>button.onclick=()=>goToView('planner'));
    document.querySelectorAll('.dwp-bar-item,.dwp-share-bar-item').forEach(button=>button.onclick=()=>{const date=button.dataset.dwpDay;openDrill(`Workload · ${shortDate(date)}`,rangeItemsForDay(items,date).map(item=>({...item,sub:`${taskSource(item)} · ${item.status}`})))});
  }
  function openTaskForItem(items,id){
    const item=items.find(candidate=>candidate.id===id);if(!item)return;
    if(item.kind==='daily'){openTask(item.parentId);requestAnimationFrame(()=>document.querySelector(`[data-daily-task-id="${CSS.escape(item.record.id)}"]`)?.scrollIntoView({block:'center',behavior:'smooth'}));return}
    openTask(item.parentId);
  }
  function snapshotMovement(items,approvals,window){
    const movement=movementCounts(items,approvals,window);
    return [['＋',movement.newItems.length,'New','blue'],['✓',movement.completed.length,'Completed','green'],['↗',movement.sent.length,'Sent Review','purple'],['↩',movement.changes.length,'Changes','amber'],['×',movement.cancelled.length,'Cancelled','red'],['⌛',movement.waiting.length,'Waiting','teal']];
  }
  function topAttention(items,metrics){
    const dueAttention=metrics.due.filter(item=>!isTerminal(item)&&(item.priority==='P0'||item.priority==='P1'||itemDate(item)===today()));
    const seen=new Set();return [...metrics.overdue,...dueAttention,...metrics.review].filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true}).sort((a,b)=>priorityWeight(b.priority)-priorityWeight(a.priority)||String(a.dueDate).localeCompare(String(b.dueDate))).slice(0,5);
  }
  function openShareSnapshot(items,approvals,events,metrics,windowRange,approvalGroups){
    shareMode=true;document.body.classList.add('dwp-share-mode');document.querySelector('.app-shell').classList.add('dwp-app-hidden');
    const daily=document.getElementById('dwpShareView')||document.createElement('section');daily.id='dwpShareView';daily.className='dwp-share-view active';daily.setAttribute('aria-label','Shareable Daily Work Snapshot');
    const person=userById(uid()),department=person.departmentId?(state.departments||[]).find(item=>item.id===person.departmentId)?.name:person.dept||'Department';
    const completedToday=metrics.completed.length,control=metrics.control==null?'—':`${metrics.control}%`,shareKpis=[['Pending Today',metrics.pending.length,'blue'],['Overdue',metrics.overdue.length,'red'],['Completed',completedToday,'green'],['In Review',metrics.review.length,'purple'],['Waiting',metrics.waiting.length,'teal'],['New Today',metrics.created.length,'amber']];
    const comparisons=[['Yesterday',shiftDate(today(),-1)],['Today',today()],['Tomorrow',shiftDate(today(),1)]];
    const shareWorkload=workloadValues(items,today(),7),pulse=snapshotMovement(items,approvals,windowRange),attention=topAttention(items,metrics),waitingCount=metrics.waiting.length,upcomingMeeting=nextMeeting(events);
    daily.innerHTML=`<header class="dwp-share-header"><div class="dwp-share-brand"><span>EH</span><div><strong>EXECUTION HUB</strong><small>DAILY WORK SNAPSHOT</small></div></div><div class="dwp-share-person"><strong>${esc(person.name||'Employee')}</strong><small>${esc(department||'Department')} · ${esc(fullDate(today()))}</small></div><div class="dwp-share-actions"><button id="dwpPrint" type="button">⤓ Print / PDF</button><button id="dwpExitShare" class="exit" type="button">× Exit</button></div></header>
      <div class="dwp-share-kpis">${shareKpis.map(([label,count,tone])=>`<div class="dwp-share-kpi ${tone}"><span>${label}</span><strong>${count}</strong></div>`).join('')}</div>
      <div class="dwp-share-main"><section class="dwp-share-panel dwp-share-position"><div class="dwp-share-title"><strong>3-Day Position</strong><span>Yesterday → Today → Tomorrow</span></div><div class="dwp-share-days">${comparisons.map(([label,date])=>{const stats=dayStats(items,events,date);return `<div class="${label==='Today'?'focus':''}"><span>${label.toUpperCase()}</span><strong>${stats.due.length} due</strong><small>${stats.completed.length} completed · ${stats.overdue.length} overdue</small><small>${stats.meetings.length} meetings · ${stats.critical.length} critical</small></div>`}).join('')}</div></section><section class="dwp-share-panel dwp-share-workload"><div class="dwp-share-title"><strong>Upcoming Workload</strong><span>Next 7 days · task count</span></div>${renderWorkloadChart(items,today(),7,true)}</section><section class="dwp-share-panel dwp-share-movement"><div class="dwp-share-title"><strong>Today's Movement</strong><span>Live activity</span></div><div class="dwp-movement-grid">${pulse.map(([icon,count,label,tone])=>`<div class="${tone}"><span>${icon}</span><strong>${count}</strong><small>${label}</small></div>`).join('')}</div></section></div>
      <div class="dwp-share-bottom"><section class="dwp-share-panel"><div class="dwp-share-title"><strong>Priority Attention</strong><span>Top items needing action</span></div><div class="dwp-attention-list">${attention.map(item=>`<button type="button" data-share-task="${esc(item.id)}"><i class="${item.status==='Completed'?'green':item.priority==='P0'?'red':item.status==='Ready for Review'?'purple':'amber'}"></i><span><strong>${esc(item.title)}</strong><small>${esc(taskSource(item))}</small></span><em>${esc(item.status==='Ready for Review'?'IN REVIEW':overdueItems([item],today()).length?'OVERDUE':itemDate(item)===today()?'DUE TODAY':item.priority||'OPEN')}</em></button>`).join('')||'<div class="dwp-empty">No priority items need attention.</div>'}</div></section><section class="dwp-share-panel"><div class="dwp-share-title"><strong>Today's Pulse</strong><span>Approvals & planner</span></div><div class="dwp-pulse-grid"><button type="button" data-share-approval><span>APPROVALS WAITING</span><strong>${approvals.filter(item=>!['Approved','Rejected','Cancelled'].includes(item.status)).length}</strong><small>Requests awaiting a decision</small></button><div><span>WAITING ON OTHERS</span><strong>${waitingCount}</strong><small>Open items with dependencies</small></div><div class="meeting"><span>NEXT MEETING</span><strong>${upcomingMeeting?esc(timeText(`${upcomingMeeting.date}T${upcomingMeeting.start||'00:00'}`)):'—'}</strong><small>${upcomingMeeting?esc(upcomingMeeting.title):'No upcoming meeting'}</small></div></div></section></div>
      <footer class="dwp-share-footer"><span>Generated from Execution Hub</span><strong>Overall work control: ${control}</strong><span>Snapshot time: ${esc(new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}</span></footer>`;
    document.body.appendChild(daily);
    document.getElementById('dwpExitShare').onclick=closeShareSnapshot;
    document.getElementById('dwpPrint').onclick=()=>window.print();
    document.querySelectorAll('[data-share-task]').forEach(button=>button.onclick=()=>{const item=attention.find(entry=>entry.id===button.dataset.shareTask);closeShareSnapshot();if(item?.kind==='approval')goToView('approvals');else openTask(item?.parentId||button.dataset.shareTask)});
    document.querySelector('[data-share-approval]')?.addEventListener('click',()=>{closeShareSnapshot();goToView('approvals')});
  }
  function renderShareSnapshot(){
    if(!shareMode)return;
    const parents=parentTasksForScope(scopeFilter,workFilter),items=scopeItems(),approvals=authorizedApprovals(scopeFilter,parents),events=calendarEventsForScope(),metrics=calculateKpis(items,approvals,events,dateWindow());
    openShareSnapshot(items,approvals,events,metrics,dateWindow(),getApprovalGroups(approvals,dateWindow()));
  }
  function closeShareSnapshot(){shareMode=false;document.body.classList.remove('dwp-share-mode');document.querySelector('.app-shell').classList.remove('dwp-app-hidden');document.getElementById('dwpShareView')?.classList.remove('active');window.scrollTo(0,0)}
  function renderDailyWork(){
    if(!scopeAllowed(scopeFilter))scopeFilter='my';
    if(shareMode)return renderShareSnapshot();
    renderMainPage();
  }
  window.addEventListener('regular-daily-tasks-updated',event=>{
    const parentTaskId=event.detail?.parentTaskId,records=event.detail?.records;if(!parentTaskId||!Array.isArray(records))return;
    dailyCache.set(parentTaskId,records);if(activeView==='dailywork')renderDailyWork();if(shareMode)renderShareSnapshot();
  });
  const originalRefresh=window.refreshFirebaseView;
  window.refreshFirebaseView=function(...args){const result=originalRefresh?.apply(this,args);if(activeView==='dailywork'&&!shareMode)renderDailyWork();else if(shareMode)renderShareSnapshot();return result};
  const savedView=sessionStorage.getItem('executionHub.activeView');if(savedView==='dailywork')activeView='dailywork';
  const baseRender=render;
  render=function(search=''){
    sessionStorage.setItem('executionHub.activeView',activeView);
    if(activeProject){document.body.classList.remove('dwp-page-active');stopDailyWatchers();return baseRender(search)}
    if(activeView==='dailywork'){renderDailyWork();wireDynamic();return}
    document.body.classList.remove('dwp-page-active');stopDailyWatchers();return baseRender(search);
  };
  function stopDailyWatchers(){if(dailyListenerStop){dailyListenerStop();dailyListenerStop=null}dailyListenerKey=''}
  render();
})();
