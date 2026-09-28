/* Execution Hub – Phase 1.6 Cross-Team Approval Network */
(function(){
  const PHASE='1.6';
  const directorId='u1';
  let approvalTab='for-me';

  const esc=v=>String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const uid=()=>state.currentUser;
  const nowIso=()=>new Date().toISOString();
  const activeUsers=()=>state.users.filter(u=>u.active!==false);
  const isDirector=(id=uid())=>id===uid()&&!!window.firebaseHub?.isSystemAdmin();
  const fullProjectAccess=(p,id=uid())=>!!p&&user(id).active!==false&&(isDirector(id)||(p.team||[]).includes(id));
  const projectLead=(p,id=uid())=>!!p&&p.projectLead===id;
  const wsOwner=(p,ws)=>(p?.workstreams||[]).find(w=>w.name===ws)?.owner;
  const isTerminal=a=>['Approved','Rejected','Cancelled'].includes(a.status);
  const isApprovalOverdue=a=>!isTerminal(a)&&a.dueAt&&new Date(a.dueAt).getTime()<Date.now();
  const approvalClass=s=>({Pending:'review','Changes Requested':'waiting',Approved:'completed',Rejected:'overdue',Cancelled:'archived'})[s]||'review';
  const approvalPill=a=>`<span class="status-pill ${isApprovalOverdue(a)?'overdue':approvalClass(a.status)}">${isApprovalOverdue(a)&&a.status==='Pending'?'Overdue':esc(a.status)}</span>`;
  const typeLabel=t=>t||'Work Approval';
  const approverNames=a=>(a.approvers||[]).map(id=>user(id).name).join(', ')||'—';
  const hasDecisionAccess=(a,id=uid())=>isDirector(id)||a.requestedBy===id||(a.approvers||[]).includes(id)||task(a.task)?.owner===id||project(a.project)?.projectLead===id;
  const hasApprovalTaskAccess=(tid,id=uid())=>state.approvals.some(a=>a.task===tid&&!['Cancelled'].includes(a.status)&&hasDecisionAccess(a,id));
  const approvalsForTask=tid=>state.approvals.filter(a=>a.task===tid).sort((a,b)=>(b.requestedAt||'').localeCompare(a.requestedAt||''));

  function defaultApproverForTask(t){
    const p=project(t.project);
    const candidates=[t.reviewer,wsOwner(p,t.workstream),p?.projectLead,directorId].filter(Boolean);
    return candidates.find(x=>x!==uid()&&user(x).active!==false)||activeUsers().find(x=>x.id!==uid())?.id;
  }

  function migrateApprovals(){
    state.approvals=Array.isArray(state.approvals)?state.approvals:[];
    state.approvalHistory=Array.isArray(state.approvalHistory)?state.approvalHistory:[];
    state.approvals.forEach(a=>{
      const t=a.task?task(a.task):null,p=t?project(t.project):(a.project?project(a.project):null);
      a.project=a.project||t?.project||null;
      a.title=a.title||t?.title||typeLabel(a.type);
      a.type=a.type||'Work Approval';
      a.requestedBy=a.requestedBy||t?.owner||directorId;
      a.requestedAt=a.requestedAt||nowIso();
      if(!Array.isArray(a.approvers)||!a.approvers.length){
        let approver;
        if(a.type==='Deadline Change') approver=(p?.projectLead!==a.requestedBy?p?.projectLead:null)||directorId;
        else approver=(t?.reviewer&&t.reviewer!==a.requestedBy?t.reviewer:null)||(p?.projectLead!==a.requestedBy?p?.projectLead:null)||directorId;
        a.approvers=[approver].filter(Boolean);
      }
      a.approvalMode=a.approvalMode||'all';
      a.status=a.status||'Pending';
      a.priority=a.priority||((t?.priority==='P0'||t?.priority==='P1')?'High':'Normal');
      if(!a.dueAt){
        const d=new Date(a.requestedAt);d.setDate(d.getDate()+2);d.setHours(18,0,0,0);a.dueAt=d.toISOString();
      }
      a.detail=a.detail||'Approval requested.';
      a.version=a.version||1;
      a.reference=a.reference||'';
      a.blocking=!!a.blocking;
      a.autoComplete=a.type==='Deliverable Review'?true:!!a.autoComplete;
      a.decisions=a.decisions||{};
      a.comments=Array.isArray(a.comments)?a.comments:[];
      a.rounds=Array.isArray(a.rounds)?a.rounds:[];
    });

    state.schemaVersion=PHASE;save();
  }

  function openModal16(title,html){
    el('modalTitle').textContent=title;el('modalBody').innerHTML=html;el('modalBackdrop').classList.add('open');
  }
  function closeModal16(){el('modalBackdrop').classList.remove('open');el('modalBody').innerHTML=''}
  function dueLocalValue(a){
    const d=a?new Date(a):new Date(Date.now()+86400000);
    const z=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
  }
  function accessibleProjects(id=uid()){return state.projects.filter(p=>fullProjectAccess(p,id))}

  function openApprovalCreate(opts={}){
    const linked=opts.task?task(opts.task):null;
    if(linked&&!fullProjectAccess(project(linked.project)))return toast('Only project members can send this task for approval.');
    const projects=accessibleProjects();
    const initialProject=linked?.project||opts.project||projects[0]?.id||'';
    const initialApprover=opts.approver|| (linked?defaultApproverForTask(linked):activeUsers().find(x=>x.id!==uid())?.id)||'';
    openModal16(linked?'Send Task for Approval':'New Approval Request',`<form id="approvalCreateForm" class="form-stack approval-form">
      <div class="approval-form-intro"><div class="approval-form-icon">✓</div><div><strong>Approval follows the work, not the hierarchy.</strong><span>Choose any active colleague who is the right person to review this. Their access is limited to this request and its linked material unless they already belong to the project.</span></div></div>
      <div class="form-grid">
        <label class="form-field"><span>Approval type</span><select class="select" name="type"><option>Work Approval</option><option>Content Approval</option><option>Creative Approval</option><option>Technical Approval</option><option>Commercial Approval</option><option>Decision Approval</option><option>Document Approval</option></select></label>
        <label class="form-field"><span>Priority</span><select class="select" name="priority"><option>Normal</option><option ${linked?.priority==='P0'||linked?.priority==='P1'?'selected':''}>High</option><option>Critical</option></select></label>
      </div>
      <div class="form-grid">
        <label class="form-field"><span>Project / context</span><select class="select" name="project" id="approvalProject"><option value="">General / Cross-team</option>${projects.map(p=>`<option value="${p.id}" ${p.id===initialProject?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="form-field"><span>Linked task</span><select class="select" name="task" id="approvalTask"><option value="">No linked task</option></select></label>
      </div>
      <label class="form-field"><span>Approval title</span><input class="input" name="title" required value="${esc(opts.title||linked?.title||'')}" placeholder="What exactly needs approval?"></label>
      <label class="form-field"><span>What should the approver check?</span><textarea class="textarea" name="detail" required placeholder="Give enough context for a useful decision…">${esc(opts.detail||'')}</textarea></label>
      <div class="form-grid">
        <label class="form-field"><span>Approval required by</span><input class="input" name="dueAt" type="datetime-local" required value="${dueLocalValue(opts.dueAt)}"></label>
        <label class="form-field"><span>Reference / version</span><input class="input" name="reference" value="${esc(opts.reference||'')}" placeholder="Version, file name or reference"></label>
      </div>
      <div class="approval-approver-block"><div class="form-label">Approver(s)</div><div class="form-help">Any active team member can be selected, even if they are not part of this project. The requester cannot approve their own request.</div><div class="approval-person-grid">${activeUsers().filter(u=>u.id!==uid()).map(u=>`<label class="approval-person"><input type="checkbox" name="approver" value="${u.id}" ${u.id===initialApprover?'checked':''}><span>${avatar(u.id)}<b>${esc(u.name)}</b><small>${esc(u.role)} • ${esc(u.dept)}</small></span></label>`).join('')}</div></div>
      <div class="form-grid">
        <label class="form-field"><span>If multiple approvers</span><select class="select" name="approvalMode"><option value="all">Everyone must approve</option><option value="any">Any one approval is enough</option></select></label>
        <div class="approval-options"><label><input type="checkbox" name="blocking" ${linked?'checked':''}> <span>Mark linked task as waiting for this approval</span></label><label><input type="checkbox" name="autoComplete" ${linked?.status==='Ready for Review'?'checked':''}> <span>Complete linked task when approved</span></label></div>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelApprovalCreate">Cancel</button><button class="btn btn-soft" type="submit">Send for Approval</button></div>
    </form>`);
    const form=el('approvalCreateForm'),pSel=el('approvalProject'),tSel=el('approvalTask');
    function loadTasks(){const pid=pSel.value;const rows=pid?state.tasks.filter(t=>t.project===pid&&fullProjectAccess(project(pid))):[];tSel.innerHTML='<option value="">No linked task</option>'+rows.map(t=>`<option value="${t.id}" ${linked?.id===t.id?'selected':''}>${esc(t.title)}</option>`).join('')}
    loadTasks();pSel.onchange=loadTasks;
    el('cancelApprovalCreate').onclick=closeModal16;
    form.onsubmit=e=>{
      e.preventDefault();const fd=new FormData(form),approvers=[...form.querySelectorAll('input[name=approver]:checked')].map(x=>x.value);
      if(!approvers.length)return toast('Select at least one approver.');
      if(approvers.includes(uid()))return toast('You cannot approve your own request.');
      const tid=fd.get('task')||null,t=tid?task(tid):null,pid=t?.project||fd.get('project')||null;
      const a={id:'a'+Date.now(),type:fd.get('type'),task:tid,project:pid,title:fd.get('title').trim(),requestedBy:uid(),approvers,approvalMode:fd.get('approvalMode'),status:'Pending',priority:fd.get('priority'),requestedAt:nowIso(),dueAt:new Date(fd.get('dueAt')).toISOString(),detail:fd.get('detail').trim(),version:1,reference:(fd.get('reference')||'').trim(),blocking:fd.get('blocking')==='on'&&!!tid,autoComplete:fd.get('autoComplete')==='on'&&!!tid,decisions:{},comments:[],rounds:[]};
      state.approvals.unshift(a);
      if(t&&a.blocking){t.approvalBlockId=a.id;t.waitingOn=approvers.length===1?approvers[0]:'Approval';if(t.status==='Not Started')t.status='Waiting'}
      log(uid(),pid,tid,'Approval',`sent ${a.type.toLowerCase()} to ${approverNames(a)}`,`Due: ${new Date(a.dueAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}${a.reference?' • '+a.reference:''}`);
      save();closeModal16();toast('Approval request sent and recorded.');render();if(tid)openTask(tid);
    };
  }

  function decisionSummary(a){
    return (a.approvers||[]).map(id=>{const d=a.decisions?.[id];return `<div class="approval-reviewer-row">${avatar(id)}<div><strong>${esc(user(id).name)}</strong><span>${esc(user(id).role)}</span></div>${d?`<span class="status-pill ${d.status==='Approved'?'completed':d.status==='Changes Requested'?'waiting':'overdue'}">${esc(d.status)}</span>`:'<span class="status-pill review">Pending</span>'}</div>`}).join('');
  }

  function approvalComments(a){return (a.comments||[]).map(c=>`<div class="comment">${avatar(c.user)}<div><strong>${esc(user(c.user).name)}</strong> <span>• ${fmtTime(c.time)}</span><p>${esc(c.text)}</p></div></div>`).join('')||'<div class="subtle">No approval comments yet.</div>'}

  function openApprovalDetail(id){
    const a=state.approvals.find(x=>x.id===id);if(!a||!hasDecisionAccess(a))return toast('You do not have access to this approval.');
    const t=a.task?task(a.task):null,p=a.project?project(a.project):null,canDecide=(a.approvers||[]).includes(uid())&&a.requestedBy!==uid()&&!isTerminal(a)&&a.status!=='Changes Requested'&&!a.decisions?.[uid()];
    const canResubmit=a.requestedBy===uid()&&a.status==='Changes Requested';
    const canCancel=a.requestedBy===uid()&&a.status==='Pending';
    openModal16(a.title,`<div class="approval-detail">
      <div class="approval-detail-top"><div><div class="approval-badges"><span class="approval-type">${esc(typeLabel(a.type))}</span>${approvalPill(a)}<span class="priority-pill ${String(a.priority||'Normal').toLowerCase()==='critical'?'p0':String(a.priority||'Normal').toLowerCase()==='high'?'p1':'p2'}">${esc(a.priority||'Normal')}</span></div><p>${esc(a.detail)}</p></div><div class="approval-version"><span>VERSION</span><strong>V${a.version||1}</strong></div></div>
      <div class="detail-grid approval-detail-grid"><div class="detail-box"><span>Requested by</span><strong>${esc(user(a.requestedBy).name)}</strong></div><div class="detail-box"><span>Approver(s)</span><strong>${esc(approverNames(a))}</strong></div><div class="detail-box"><span>Project</span><strong>${esc(p?.name||'General / Cross-team')}</strong></div><div class="detail-box"><span>Due</span><strong class="${isApprovalOverdue(a)?'approval-overdue-text':''}">${new Date(a.dueAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</strong></div>${a.reference?`<div class="detail-box wide"><span>Reference</span><strong>${esc(a.reference)}</strong></div>`:''}</div>
      ${t?`<button type="button" class="approval-linked-task" id="approvalLinkedTask"><div><span>LINKED TASK</span><strong>${esc(t.title)}</strong><small>${esc(p?.name||'')} • ${esc(t.workstream)}</small></div><span>Open task →</span></button>`:''}
      <div class="approval-section"><h4>Review status</h4><div class="approval-reviewers">${decisionSummary(a)}</div>${(a.approvers||[]).length>1?`<div class="subtle">Rule: ${a.approvalMode==='any'?'Any one approval completes this request.':'Every selected approver must approve.'}</div>`:''}</div>
      <div class="approval-section"><h4>Approval conversation</h4><div id="approvalCommentList">${approvalComments(a)}</div>${hasDecisionAccess(a)?`<div class="comment-box approval-comment-box"><textarea id="approvalCommentText" placeholder="Add context, clarification or a version note…"></textarea><button class="btn btn-ghost" id="approvalCommentBtn">Comment</button></div>`:''}</div>
      ${canDecide?`<div class="approval-decision-box"><h4>Your decision</h4><textarea id="approvalDecisionComment" class="textarea" placeholder="Optional for approval; required when requesting changes or rejecting."></textarea><div class="drawer-actions"><button class="btn btn-soft" data-approval-decision="Approved">Approve</button><button class="btn btn-ghost" data-approval-decision="Changes Requested">Request Changes</button><button class="btn btn-danger" data-approval-decision="Rejected">Reject</button></div></div>`:''}
      <div class="modal-actions">${canResubmit?'<button class="btn btn-soft" id="resubmitApproval">Resubmit New Version</button>':''}${canCancel?'<button class="btn btn-ghost" id="cancelApprovalRequest">Cancel Request</button><button class="btn btn-ghost" id="remindApprovers">Send Reminder</button>':''}<button class="btn btn-soft" id="closeApprovalDetail">Close</button></div>
    </div>`);
    el('closeApprovalDetail').onclick=closeModal16;
    if(t)el('approvalLinkedTask').onclick=()=>{closeModal16();openTask(t.id)};
    const cbtn=el('approvalCommentBtn');if(cbtn)cbtn.onclick=()=>{const box=el('approvalCommentText'),txt=box.value.trim();if(!txt)return; a.comments.push({id:'ac'+Date.now(),user:uid(),time:nowIso(),text:txt});log(uid(),a.project,a.task,'Approval',`commented on approval “${a.title}”`);save();openApprovalDetail(a.id)};
    document.querySelectorAll('[data-approval-decision]').forEach(b=>b.onclick=()=>submitApprovalDecision(a.id,b.dataset.approvalDecision,el('approvalDecisionComment')?.value.trim()||''));
    const re=el('resubmitApproval');if(re)re.onclick=()=>resubmitApproval(a.id);
    const ca=el('cancelApprovalRequest');if(ca)ca.onclick=()=>{if(!confirm('Cancel this approval request? The history will remain.'))return;a.status='Cancelled';a.cancelledAt=nowIso();a.cancelledBy=uid();if(t?.approvalBlockId===a.id){t.waitingOn=null;delete t.approvalBlockId}log(uid(),a.project,a.task,'Approval',`cancelled approval request “${a.title}”`);save();closeModal16();toast('Approval cancelled; history retained.');render()};
    const rem=el('remindApprovers');if(rem)rem.onclick=()=>{a.comments.push({id:'ac'+Date.now(),user:uid(),time:nowIso(),text:`Reminder sent to ${approverNames(a)}.`});log(uid(),a.project,a.task,'Approval',`sent approval reminder to ${approverNames(a)}`);save();toast('Reminder recorded and sent in the prototype.');openApprovalDetail(a.id)};
  }

  function submitApprovalDecision(id,status,comment){
    const a=state.approvals.find(x=>x.id===id);if(!a||(a.approvers||[]).indexOf(uid())<0||a.requestedBy===uid()||a.decisions?.[uid()])return toast('You cannot decide this approval.');
    if(['Changes Requested','Rejected'].includes(status)&&!comment)return toast('Add a reason before returning or rejecting the work.');
    a.decisions=a.decisions||{};a.decisions[uid()]={status,at:nowIso(),comment};if(comment)a.comments.push({id:'ac'+Date.now(),user:uid(),time:nowIso(),text:comment,decision:status});
    const decisions=(a.approvers||[]).map(x=>a.decisions[x]?.status).filter(Boolean);
    if(status==='Changes Requested')a.status='Changes Requested';
    else if(status==='Rejected')a.status='Rejected';
    else if(a.approvalMode==='any'&&status==='Approved')a.status='Approved';
    else if((a.approvers||[]).every(x=>a.decisions[x]?.status==='Approved'))a.status='Approved';
    else a.status='Pending';
    const t=a.task?task(a.task):null;
    if(a.status==='Approved'){
      a.completedAt=nowIso();
      if(t?.approvalBlockId===a.id){t.waitingOn=null;delete t.approvalBlockId}
      if(t&&a.autoComplete){t.status='Completed';t.progress=100;t.completedAt=nowIso();t.next='Approved and completed'}
    }else if(['Changes Requested','Rejected'].includes(a.status)){
      if(t?.approvalBlockId===a.id){t.waitingOn=null;delete t.approvalBlockId}
      if(t&&a.autoComplete){t.status='Changes Required';t.next=`Address ${status.toLowerCase()} feedback from ${user(uid()).name}`}
    }
    log(uid(),a.project,a.task,'Approval',`${status.toLowerCase()} “${a.title}”`,comment||`Version V${a.version||1}`);
    save();closeModal16();toast(status==='Approved'?'Approval recorded.':status==='Changes Requested'?'Changes requested and returned to sender.':'Rejection recorded.');render();
  }

  function resubmitApproval(id){
    const a=state.approvals.find(x=>x.id===id);if(!a||a.requestedBy!==uid()||a.status!=='Changes Requested')return;
    const note=prompt('What changed in this new version?','');if(!note)return;
    a.rounds=a.rounds||[];a.rounds.push({version:a.version,status:a.status,decisions:structuredClone(a.decisions||{}),closedAt:nowIso()});
    a.version=(a.version||1)+1;a.status='Pending';a.decisions={};a.requestedAt=nowIso();const nextDue=new Date();nextDue.setDate(nextDue.getDate()+1);nextDue.setHours(18,0,0,0);a.dueAt=nextDue.toISOString();a.comments.push({id:'ac'+Date.now(),user:uid(),time:nowIso(),text:`V${a.version} resubmitted: ${note}`});
    const t=a.task?task(a.task):null;if(t&&a.blocking){t.approvalBlockId=a.id;t.waitingOn=(a.approvers||[]).length===1?a.approvers[0]:'Approval';if(a.autoComplete)t.status='Ready for Review'}
    log(uid(),a.project,a.task,'Approval',`resubmitted “${a.title}” as V${a.version}`,note);save();closeModal16();toast(`Version V${a.version} sent for approval.`);render();
  }

  function relevantApprovals(){return state.approvals.filter(a=>hasDecisionAccess(a))}
  function approvalList(){
    const all=relevantApprovals();
    if(approvalTab==='for-me')return all.filter(a=>(a.approvers||[]).includes(uid())&&!isTerminal(a));
    if(approvalTab==='sent')return all.filter(a=>a.requestedBy===uid()&&!isTerminal(a));
    if(approvalTab==='changes')return all.filter(a=>a.status==='Changes Requested'&&(a.requestedBy===uid()||(a.approvers||[]).includes(uid())));
    if(approvalTab==='completed')return all.filter(a=>isTerminal(a));
    if(approvalTab==='all'&&isDirector())return state.approvals;
    if(approvalTab==='connected')return all;
    return all;
  }
  function tabCount(k){const old=approvalTab;approvalTab=k;const n=approvalList().length;approvalTab=old;return n}

  renderApprovals=function(){
    setTitle('Approvals','CROSS-TEAM DECISION DESK');
    const list=approvalList().sort((a,b)=>{if(isTerminal(a)!==isTerminal(b))return isTerminal(a)?1:-1;return (a.dueAt||'').localeCompare(b.dueAt||'')});
    const tabs=[['for-me','For Me'],['sent','Sent by Me'],['changes','Changes Requested'],['connected','Relevant'],['completed','Completed']];if(isDirector())tabs.push(['all','All Approvals']);
    const pendingMine=state.approvals.filter(a=>(a.approvers||[]).includes(uid())&&a.status==='Pending').length,overdueMine=state.approvals.filter(a=>(a.approvers||[]).includes(uid())&&isApprovalOverdue(a)).length,sentOpen=state.approvals.filter(a=>a.requestedBy===uid()&&!isTerminal(a)).length;
    el('content').innerHTML=`<div class="section-row" style="margin-top:0"><div><h2>Approval Network</h2><p>Anyone can send the right colleague work for a formal decision. Project membership is not required to review a scoped approval.</p></div><button class="btn btn-soft" id="newApprovalBtn">+ New Approval</button></div>
      <div class="metrics approval-metrics"><div class="metric indigo"><div class="metric-label">WAITING FOR ME</div><div class="metric-value">${pendingMine}</div></div><div class="metric red"><div class="metric-label">OVERDUE FOR ME</div><div class="metric-value">${overdueMine}</div></div><div class="metric sage"><div class="metric-label">I'M WAITING ON</div><div class="metric-value">${sentOpen}</div></div><div class="metric"><div class="metric-label">APPROVED / CLOSED</div><div class="metric-value">${state.approvals.filter(a=>isTerminal(a)).length}</div></div></div>
      <div class="tabs approval-tabs">${tabs.map(([k,l])=>`<button class="tab ${approvalTab===k?'active':''}" data-approval-tab="${k}">${l}<span>${tabCount(k)}</span></button>`).join('')}</div>
      <div class="approval-list">${list.length?list.map(a=>{const t=a.task?task(a.task):null,p=a.project?project(a.project):null;return `<button type="button" class="approval-card ${isApprovalOverdue(a)?'approval-card-overdue':''}" data-approval-open="${a.id}"><div class="approval-card-main"><div class="approval-card-title"><div class="approval-badges"><span class="approval-type">${esc(typeLabel(a.type))}</span>${approvalPill(a)}${a.blocking?'<span class="approval-blocking">Blocking</span>':''}</div><strong>${esc(a.title)}</strong><span>${esc(p?.name||'General / Cross-team')}${t?' • '+esc(t.workstream):''}</span></div><div class="approval-card-people"><div><span>FROM</span>${person(a.requestedBy)}</div><div class="approval-arrow">→</div><div><span>TO</span><strong>${esc(approverNames(a))}</strong><small>${(a.approvers||[]).length>1?(a.approvalMode==='any'?'Any one':'All required'):esc(user(a.approvers?.[0]).role)}</small></div></div></div><div class="approval-card-side"><span>V${a.version||1}</span><strong class="${isApprovalOverdue(a)?'approval-overdue-text':''}">${isApprovalOverdue(a)?'OVERDUE':'DUE'}</strong><small>${new Date(a.dueAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</small><b>Open →</b></div></button>`}).join(''):`<div class="panel"><div class="empty"><strong>Nothing in this view</strong>Cross-team approvals will appear here with full history and accountability.</div></div>`}</div>`;
  };

  function readOnlyApprovalTask(t){
    const p=project(t.project),aps=approvalsForTask(t.id).filter(a=>hasDecisionAccess(a));
    const comments=state.comments.filter(c=>c.task===t.id),history=state.activity.filter(a=>a.task===t.id);
    el('drawerEyebrow').textContent=`APPROVAL ACCESS • ${p?.name?.toUpperCase()||'PROJECT'}`;el('drawerTitle').textContent=t.title;
    el('drawerBody').innerHTML=`<div class="drawer-section"><div class="approval-scope-note"><strong>Scoped approval access</strong><span>You were invited to review work linked to this task. This does not give you access to the rest of ${esc(p?.name||'the project')}.</span></div><div class="drawer-actions">${priorityPill(t.priority)}${statusPill(isOverdue(t)?'Overdue':t.status)}</div></div><div class="drawer-section"><h4>Task details</h4><div class="detail-grid"><div class="detail-box"><span>Owner</span><strong>${esc(user(t.owner).name)}</strong></div><div class="detail-box"><span>Category</span><strong>${esc(t.workstream)}</strong></div><div class="detail-box"><span>Deliverable</span><strong>${esc(t.deliverable)}</strong></div><div class="detail-box"><span>Due</span><strong>${fmtDateFull(t.currentDue)}</strong></div><div class="detail-box wide"><span>Next action</span><strong>${esc(t.next)}</strong></div></div></div><div class="drawer-section"><h4>Approvals you can access</h4><div class="task-approval-list">${aps.map(a=>taskApprovalMini(a)).join('')}</div></div><div class="drawer-section"><h4>Task comments</h4>${comments.map(c=>`<div class="comment">${avatar(c.user)}<div><strong>${esc(user(c.user).name)}</strong> <span>• ${fmtTime(c.time)}</span><p>${esc(c.text)}</p></div></div>`).join('')||'<div class="subtle">No task comments.</div>'}</div><div class="drawer-section"><h4>Relevant history</h4><div class="activity">${history.slice(0,10).map(activityItem).join('')||'<div class="subtle">No history yet.</div>'}</div></div>`;
    el('taskDrawer').classList.add('open');el('drawerBackdrop').classList.add('open');document.querySelectorAll('[data-mini-approval]').forEach(b=>b.onclick=()=>{closeDrawer();openApprovalDetail(b.dataset.miniApproval)});
  }

  function taskApprovalMini(a){return `<button type="button" class="task-approval-mini" data-mini-approval="${a.id}"><div><span>${esc(typeLabel(a.type))} • V${a.version||1}</span><strong>${esc(a.title)}</strong><small>${esc(user(a.requestedBy).name)} → ${esc(approverNames(a))}</small></div><div>${approvalPill(a)}<small>${new Date(a.dueAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</small></div></button>`}

  const baseOpenTask16=openTask;
  openTask=function(id){
    const t=task(id);if(!t)return;const p=project(t.project);
    if(!fullProjectAccess(p)&&hasApprovalTaskAccess(id)){readOnlyApprovalTask(t);return}
    baseOpenTask16(id);
    if(!fullProjectAccess(p))return;
    const body=el('drawerBody');if(!body)return;
    const aps=approvalsForTask(id);
    const first=body.querySelector('.drawer-section');
    if(first){first.insertAdjacentHTML('beforeend',`<div class="drawer-actions approval-task-actions"><button class="btn btn-ghost send-approval-task" data-send-approval-task="${id}">Send for Approval</button></div>`)}
    const activitySection=[...body.querySelectorAll('.drawer-section')].find(s=>s.querySelector('h4')?.textContent==='Activity history');
    const html=`<div class="drawer-section task-approval-section"><div class="drawer-section-heading"><h4>Approvals</h4><button class="link-btn send-approval-task" data-send-approval-task="${id}">+ Request approval</button></div>${aps.length?`<div class="task-approval-list">${aps.map(taskApprovalMini).join('')}</div>`:'<div class="subtle">No formal approval requests linked to this task yet.</div>'}</div>`;
    if(activitySection)activitySection.insertAdjacentHTML('beforebegin',html);else body.insertAdjacentHTML('beforeend',html);
    document.querySelectorAll('.send-approval-task').forEach(b=>b.onclick=()=>openApprovalCreate({task:b.dataset.sendApprovalTask}));
    document.querySelectorAll('[data-mini-approval]').forEach(b=>b.onclick=()=>{closeDrawer();openApprovalDetail(b.dataset.miniApproval)});
  };

  // Flexible Ready-for-Review: choose the right approver rather than automatically routing upward.
  updateStatus=function(id,newStatus){
    const t=task(id);if(!t)return;const p=project(t.project);const editable=fullProjectAccess(p)&&(isDirector()||p.projectLead===uid()||wsOwner(p,t.workstream)===uid()||t.owner===uid());if(!editable)return toast('You do not have permission to update this task.');
    const old=t.status;if(old===newStatus)return toast('Task is already in that status.');t.status=newStatus;if(newStatus==='Ready for Review')t.progress=100;log(uid(),t.project,t.id,'Status',`changed status from ${old} to ${newStatus}`,`${old} → ${newStatus}`);save();toast(`Status updated to ${newStatus}`);openTask(id);render();if(newStatus==='Ready for Review')setTimeout(()=>openApprovalCreate({task:id,title:t.title,approver:defaultApproverForTask(t)}),120);
  };

  // Deadline changes remain controlled by Project Lead / Director, but use the same approval desk.
  requestDeadline=function(id){
    const t=task(id);if(!t)return;const p=project(t.project);if(!fullProjectAccess(p))return toast('You do not have project access.');
    const input=prompt(`Current due date is ${t.currentDue}. Enter requested new due date (YYYY-MM-DD):`,t.currentDue);if(!input||input===t.currentDue)return;const reason=prompt('Reason for deadline change:','');if(!reason)return;
    const approver=(p.projectLead!==uid()?p.projectLead:null)||directorId;if(approver===uid())return toast('No separate approver is available for this control change.');
    const a={id:'a'+Date.now(),type:'Deadline Change',task:id,project:t.project,title:`Deadline revision • ${t.title}`,requestedBy:uid(),approvers:[approver],approvalMode:'all',status:'Pending',priority:t.priority==='P0'?'Critical':'High',requestedAt:nowIso(),dueAt:new Date(Date.now()+86400000).toISOString(),detail:`Requested ${fmtDateFull(input)}. Reason: ${reason}`,version:1,reference:`Original due ${fmtDateFull(t.originalDue)}`,blocking:false,autoComplete:false,decisions:{},comments:[],rounds:[],requestedDue:input};
    state.approvals.unshift(a);t.pendingDue=input;log(uid(),t.project,id,'Deadline','requested deadline revision',`Current: ${fmtDateFull(t.currentDue)} → Requested: ${fmtDateFull(input)} • Approver: ${user(approver).name}`);save();toast('Deadline change sent to the Project Lead / Director.');openTask(id);render();
  };

  // Keep compatibility with any legacy Approve buttons.
  approve=function(aid,ok){submitApprovalDecision(aid,ok?'Approved':'Rejected',ok?'':'Not approved.')};

  // Special rule for approved control requests.
  const baseSubmitApprovalDecision=submitApprovalDecision;
  submitApprovalDecision=function(id,status,comment){
    const a=state.approvals.find(x=>x.id===id);if(a?.type==='Deadline Change'&&status==='Approved'){
      const t=task(a.task);if(!t)return;if(!(a.approvers||[]).includes(uid()))return toast('You are not the designated approver.');a.decisions[uid()]={status:'Approved',at:nowIso(),comment};a.status='Approved';a.completedAt=nowIso();const requested=a.requestedDue||t.pendingDue;if(requested){const old=t.currentDue;t.currentDue=requested;delete t.pendingDue;t.reschedules=(t.reschedules||0)+1;log(uid(),t.project,t.id,'Approval','approved deadline revision',`${fmtDateFull(old)} → ${fmtDateFull(t.currentDue)} • Original remains ${fmtDateFull(t.originalDue)}`)}save();closeModal16();toast('Deadline revision approved and recorded.');render();return;
    }
    baseSubmitApprovalDecision(id,status,comment);
  };

  const baseRenderDashboard16=renderDashboard;
  renderDashboard=function(){
    baseRenderDashboard16();
    const content=el('content');if(!content)return;const mine=state.approvals.filter(a=>(a.approvers||[]).includes(uid())&&!isTerminal(a));const sent=state.approvals.filter(a=>a.requestedBy===uid()&&!isTerminal(a));
    const block=`<div class="approval-dashboard"><div class="section-row"><div><h2>Approval Inbox</h2><p>Formal cross-team decisions waiting on you or your colleagues.</p></div><button class="link-btn" id="dashboardApprovalsOpen">Open approvals →</button></div><div class="approval-dashboard-grid"><button data-approval-dashboard="for-me"><span>WAITING FOR ME</span><strong>${mine.length}</strong><small>${mine.filter(isApprovalOverdue).length} overdue</small></button><button data-approval-dashboard="sent"><span>I'M WAITING ON</span><strong>${sent.length}</strong><small>${sent.filter(isApprovalOverdue).length} overdue with approver</small></button>${mine.slice(0,2).map(a=>`<button class="approval-dashboard-item" data-approval-open="${a.id}"><div>${approvalPill(a)}<strong>${esc(a.title)}</strong><small>${esc(user(a.requestedBy).name)} • ${new Date(a.dueAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div><span>→</span></button>`).join('')}</div></div>`;
    const myday=content.querySelector('.myday-section');if(myday)myday.insertAdjacentHTML('afterend',block);else content.insertAdjacentHTML('afterbegin',block);
  };

  const baseWireDynamic16=wireDynamic;
  wireDynamic=function(){
    baseWireDynamic16();
    document.querySelectorAll('[data-approval-tab]').forEach(b=>b.onclick=()=>{approvalTab=b.dataset.approvalTab;render()});
    document.querySelectorAll('[data-approval-open]').forEach(b=>b.onclick=e=>{e.stopPropagation();openApprovalDetail(b.dataset.approvalOpen)});
    document.querySelectorAll('[data-approval-dashboard]').forEach(b=>b.onclick=()=>{approvalTab=b.dataset.approvalDashboard;activeView='approvals';activeProject=null;document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='approvals'));render()});
    const na=el('newApprovalBtn');if(na)na.onclick=()=>openApprovalCreate();
    const da=el('dashboardApprovalsOpen');if(da)da.onclick=()=>{approvalTab='for-me';activeView='approvals';activeProject=null;document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='approvals'));render()};
    const nav=document.querySelector('.nav-item[data-view="approvals"]');if(nav){nav.querySelector('.nav-count')?.remove();const n=state.approvals.filter(a=>(a.approvers||[]).includes(uid())&&a.status==='Pending').length;if(n)nav.insertAdjacentHTML('beforeend',`<span class="nav-count">${n}</span>`)}
  };

  // Ensure direct calls from task drawer re-bind the Phase 1.6 additions.
  const baseWireDrawer16=wireDrawer;
  wireDrawer=function(id){baseWireDrawer16(id);document.querySelectorAll('.send-approval-task').forEach(b=>b.onclick=()=>openApprovalCreate({task:b.dataset.sendApprovalTask}));document.querySelectorAll('[data-mini-approval]').forEach(b=>b.onclick=()=>{closeDrawer();openApprovalDetail(b.dataset.miniApproval)})};

  migrateApprovals();
  render();
})();
