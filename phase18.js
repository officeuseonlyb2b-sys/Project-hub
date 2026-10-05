/* Execution Hub – Phase 1.8 Organisation layer: Departments → Employees → Projects */
(function(){
  const PHASE='1.8';
  const DIRECTOR='u1';
  let orgTab='departments';
  let orgFocusDept=null;
  const esc=v=>String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const isAdmin=(id=state.currentUser)=>id===state.currentUser&&!!window.firebaseHub?.isSystemAdmin();
  const isProjectLead=(p,id=state.currentUser)=>!!p&&p.projectLead===id;
  const canManageProject=(p,id=state.currentUser)=>!!p&&(isAdmin(id)||isProjectLead(p,id));
  const activeUsers=()=>state.users.filter(u=>u.active!==false);
  const today=()=>new Date().toISOString().slice(0,10);
  function initials(name){return String(name||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('')||'??'}
  function normalizeEmail(v){return String(v||'').trim().toLowerCase()}
  function deptById(id){return (state.departments||[]).find(d=>d.id===id)||null}
  function deptByName(name){return (state.departments||[]).find(d=>d.name===name)||null}
  function userDept(u){return deptById(u?.departmentId)||deptByName(u?.dept)||null}
  function deptMembers(did,includeInactive=true){return state.users.filter(u=>u.departmentId===did && (includeInactive||u.active!==false))}
  function departmentName(u){return userDept(u)?.name||u?.dept||'Unassigned'}
  function departmentCode(u){return userDept(u)?.code||'—'}
  function safeUser(id){return state.users.find(u=>u.id===id)||{id,name:'Unassigned',role:'—',dept:'—',active:false,initials:'??'}}
  function employeeAuthUid(employee){return employee?.authUid||employee?.firebaseUid||employee?.uid||''}
  function logOrg(text,change=''){log(state.currentUser,null,null,'Organisation',text,change)}
  function openOrgModal(title,html){el('modalTitle').textContent=title;el('modalBody').innerHTML=html;el('modalBackdrop').classList.add('open')}
  function closeOrgModal(){el('modalBackdrop').classList.remove('open');el('modalBody').innerHTML=''}
  function showEmployeeCredentials(email,password){
    let temporaryPassword=password;
    openOrgModal('Employee account created successfully.',`<div class="form-stack"><div class="form-help prominent">Share these credentials securely. The temporary password is shown only in this message and is not saved.</div><label class="form-field"><span>Login ID</span><input class="input" value="${esc(email)}" readonly></label><label class="form-field"><span>Temporary Password</span><input class="input" value="${esc(temporaryPassword)}" readonly></label><div class="modal-actions"><button type="button" class="btn btn-ghost" id="copyEmployeeCredentials">Copy Credentials</button><button type="button" class="btn btn-soft" id="closeEmployeeCredentials">Close</button></div></div>`);
    const clear=()=>{temporaryPassword='';closeOrgModal()};
    el('closeEmployeeCredentials').onclick=clear;
    el('closeModal').onclick=clear;
    el('modalBackdrop').addEventListener('click',event=>{if(event.target===el('modalBackdrop'))clear()},{once:true});
    el('copyEmployeeCredentials').onclick=async()=>{
      const content=`Login ID: ${email}\nTemporary Password: ${temporaryPassword}`;
      try{
        if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(content);
        else{const copyField=document.createElement('textarea');copyField.value=content;document.body.appendChild(copyField);copyField.select();const copied=document.execCommand('copy');copyField.remove();if(!copied)throw new Error('Copy command unavailable')}
        toast('Credentials copied. Share them securely.');
      }catch{toast('Clipboard access is unavailable. Copy the credentials shown above.')}
    };
  }
  function field(label,html,help=''){return `<label class="form-field"><span>${label}</span>${html}${help?`<small>${help}</small>`:''}</label>`}
  function uniqueId(prefix){return `${prefix}${Date.now()}${Math.floor(Math.random()*1000)}`}

  function migrateOrganisation(){
    state.departments=Array.isArray(state.departments)?state.departments:[];
    state.users=Array.isArray(state.users)?state.users:[];
    state.users.forEach(u=>{
      let d=deptById(u.departmentId);
      if(!d&&u.dept)d=state.departments.find(x=>x.name===u.dept||x.legacyNames?.includes(u.dept));
      if(!d&&u.dept){
        d={id:uniqueId('d'),name:u.dept,code:String(u.dept).replace(/[^A-Za-z]/g,'').slice(0,8).toUpperCase()||'DEPT',headId:null,active:true,createdAt:new Date().toISOString(),legacyNames:[u.dept]};
        state.departments.push(d);
      }
      if(d){u.departmentId=d.id;u.dept=d.name}
      u.designation=u.designation||u.role||'Team Member';
      u.role=u.designation;
      u.status=u.status|| (u.active===false?'inactive':'active');
      if(u.reportingTo===undefined)u.reportingTo=u.id===DIRECTOR?null:(state.users.some(x=>x.id===DIRECTOR)?DIRECTOR:null);
      if(u.phone===undefined)u.phone='';
      if(u.dateJoined===undefined)u.dateJoined=u.createdAt?.slice(0,10)||'';
      if(d&&(!Array.isArray(u.departmentHistory)||!u.departmentHistory.length)){
        u.departmentHistory=[{departmentId:d.id,designation:u.designation,from:u.dateJoined||today(),to:null}];
      }
    });
    state.departments.forEach(d=>{if(d.headId&&!state.users.some(u=>u.id===d.headId))d.headId=null;if(d.active===undefined)d.active=true});
    state.schemaVersion=PHASE;
    save();
  }

  function departmentOptions(selected='',includeArchived=false){
    return state.departments.filter(d=>includeArchived||d.active!==false).sort((a,b)=>a.name.localeCompare(b.name)).map(d=>`<option value="${esc(d.id)}" ${selected===d.id?'selected':''}>${esc(d.name)}</option>`).join('')
  }
  function reportingOptions(selected='',exclude=''){
    const users=activeUsers().filter(u=>u.id!==exclude),selectedUser=state.users.find(u=>u.id===selected&&u.id!==exclude);
    if(selectedUser&&!users.some(u=>u.id===selectedUser.id))users.push(selectedUser);
    return `<option value="">No direct reporting manager</option>${users.sort((a,b)=>a.name.localeCompare(b.name)).map(u=>`<option value="${esc(u.id)}" ${selected===u.id?'selected':''}>${esc(u.name)}${u.active===false?' (Inactive)':''} — ${esc(u.designation||u.role)}</option>`).join('')}`
  }
  function leadOptions(selected=''){
    const groups=state.departments.filter(d=>d.active!==false).map(d=>{
      const members=deptMembers(d.id,false);if(!members.length)return '';
      return `<optgroup label="${esc(d.name)}">${members.map(u=>`<option value="${esc(u.id)}" ${u.id===selected?'selected':''}>${esc(u.name)} — ${esc(u.designation||u.role)}</option>`).join('')}</optgroup>`
    }).join('');
    return groups||activeUsers().map(u=>`<option value="${esc(u.id)}" ${u.id===selected?'selected':''}>${esc(u.name)}</option>`).join('')
  }
  function departmentTeamChecks(selected=[],locked=[]){
    const sections=state.departments.filter(d=>d.active!==false).map(d=>{
      const members=deptMembers(d.id,false);if(!members.length)return '';
      return `<div class="department-picker-group"><div class="department-picker-head"><div><strong>${esc(d.name)}</strong><span>${esc(d.code||'')}</span></div><small>${members.length} active</small></div><div class="check-grid">${members.map(u=>`<label class="check-card ${locked.includes(u.id)?'locked':''}"><input type="checkbox" name="team" value="${esc(u.id)}" ${selected.includes(u.id)?'checked':''} ${locked.includes(u.id)?'disabled':''}><span>${avatar(u.id)}<b>${esc(u.name)}</b><small>${esc(u.designation||u.role)}${u.id===d.headId?' • Department Head':''}</small>${u.id===DIRECTOR?'<em>Director / Admin</em>':''}</span></label>`).join('')}</div></div>`
    }).join('');
    return sections||'<div class="empty"><strong>No active departments</strong>Create a department and add employees first.</div>'
  }

  function openDepartment(existing=null){
    if(!isAdmin())return toast('Only Director / Admin can manage departments.');
    const editing=!!existing;
    const possibleHeads=editing?deptMembers(existing.id,false):[];
    openOrgModal(editing?`Manage Department • ${existing.name}`:'Create Department',`<form id="departmentForm" class="form-stack">
      <div class="form-grid">${field('Department name',`<input class="input" name="name" required value="${editing?esc(existing.name):''}" placeholder="Department name">`)}${field('Code',`<input class="input" name="code" required value="${editing?esc(existing.code||''):''}" placeholder="DEPT">`)}</div>
      ${editing?field('Department Head',`<select class="select" name="head"><option value="">Unassigned</option>${possibleHeads.map(u=>`<option value="${esc(u.id)}" ${existing.headId===u.id?'selected':''}>${esc(u.name)} — ${esc(u.designation||u.role)}</option>`).join('')}</select>`,'Department Head is organisational. Project Lead authority remains project-specific.'):'<div class="form-help prominent">Create the department first. After employees are assigned to it, you can appoint one of those members as Department Head.</div>'}
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelOrgModal">Cancel</button>${editing?`<button type="button" class="btn ${existing.active===false?'btn-soft':'btn-danger'}" id="toggleDepartment">${existing.active===false?'Reactivate Department':'Archive Department'}</button>`:''}<button class="btn btn-soft" type="submit">${editing?'Save Department':'Create Department'}</button></div>
    </form>`);
    el('cancelOrgModal').onclick=closeOrgModal;
    if(editing&&el('toggleDepartment'))el('toggleDepartment').onclick=()=>{
      const next=existing.active===false;
      const members=deptMembers(existing.id,false).length;
      if(!next&&!confirm(`${existing.name} has ${members} active employee${members===1?'':'s'}. Archive it anyway? Existing membership and history will remain, but it will not be available for new assignments.`))return;
      existing.active=next;logOrg(`${next?'reactivated':'archived'} department ${existing.name}`,`Members retained: ${members}`);save();closeOrgModal();orgFocusDept=null;render();toast(`Department ${next?'reactivated':'archived'}.`)
    };
    el('departmentForm').onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.target),name=String(fd.get('name')||'').trim(),code=String(fd.get('code')||'').trim().toUpperCase();
      const duplicate=state.departments.find(d=>d.name.toLowerCase()===name.toLowerCase()&&(!editing||d.id!==existing.id));if(duplicate)return toast('A department with that name already exists.');
      if(editing){const oldName=existing.name;existing.name=name;existing.code=code;existing.headId=fd.get('head')||null;state.users.filter(u=>u.departmentId===existing.id).forEach(u=>u.dept=name);logOrg(`updated department ${name}`,`${oldName} → ${name} • Head: ${existing.headId?safeUser(existing.headId).name:'Unassigned'}`)}
      else{const d={id:uniqueId('d'),name,code,headId:null,active:true,createdAt:new Date().toISOString(),legacyNames:[]};state.departments.push(d);logOrg(`created department ${name}`,`Code: ${code}`);orgFocusDept=d.id}
      save();closeOrgModal();render();toast(editing?'Department updated.':'Department created.')
    }
  }

  function recordEmployeeHistory(u,newDepartmentId,newDesignation){
    const hist=Array.isArray(u.departmentHistory)?u.departmentHistory:(u.departmentHistory=[]);
    const last=hist[hist.length-1];
    if(last && last.departmentId===newDepartmentId && last.designation===newDesignation)return;
    if(last&&!last.to)last.to=today();
    hist.push({departmentId:newDepartmentId,designation:newDesignation,from:today(),to:null});
  }

  function openEmployee(existing=null,presetDepartmentId='',requestedMode='new'){
    if(!isAdmin())return toast('Only Director / Admin can manage employee accounts.');
    const editing=!!existing,mode=editing?'existing':requestedMode,employees=state.users.filter(u=>u.id!==DIRECTOR&&normalizeEmail(u.email)!==window.firebaseHub.SYSTEM_ADMIN_EMAIL.toLowerCase()).sort((a,b)=>a.name.localeCompare(b.name));
    const modeTabs=`<div class="org-tabs" role="tablist" aria-label="Employee option"><button type="button" class="${mode==='new'?'active':''}" id="employeeModeNew" role="tab" aria-selected="${mode==='new'}">New Employee</button><button type="button" class="${mode==='existing'?'active':''}" id="employeeModeExisting" role="tab" aria-selected="${mode==='existing'}">Existing Employee</button></div>`;
    if(!existing&&mode==='existing'){
      openOrgModal('Add Employee & Login',`${modeTabs}<div class="form-stack">${field('Search existing employees','<input class="input" id="existingEmployeeSearch" type="search" placeholder="Search by name, email, or Employee ID">')}<div class="form-help">Choose an existing employee to update their details or attach a login. The existing employee ID is retained.</div><div class="team-grid" id="existingEmployeeList">${employees.map(employee=>`<div class="team-card existing-employee-option" data-search="${esc(`${employee.name||''} ${employee.email||''} ${employee.employeeId||''} ${departmentName(employee)}`).toLowerCase()}"><strong>${esc(employee.name||'Unnamed employee')}</strong><div class="role">${esc(employee.email||'No email')} • ${esc(employee.employeeId||'No Employee ID')}</div><div class="employee-department">${esc(departmentName(employee))} • ${employeeAuthUid(employee)?'Login linked':'No login linked'}</div><button type="button" class="btn btn-ghost select-existing-employee" data-user="${esc(employee.id)}">Select Employee</button></div>`).join('')||'<div class="empty wide"><strong>No existing employees</strong>Create a New Employee first.</div>'}</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelOrgModal">Cancel</button></div></div>`);
      el('employeeModeNew').onclick=()=>openEmployee(null,presetDepartmentId,'new');
      el('employeeModeExisting').onclick=()=>openEmployee(null,presetDepartmentId,'existing');
      const search=el('existingEmployeeSearch');
      if(search)search.oninput=()=>{const query=search.value.trim().toLowerCase();document.querySelectorAll('.existing-employee-option').forEach(card=>{card.hidden=!card.dataset.search.includes(query)})};
      document.querySelectorAll('.select-existing-employee').forEach(button=>button.onclick=()=>openEmployee(safeUser(button.dataset.user),presetDepartmentId,'existing'));
      el('cancelOrgModal').onclick=closeOrgModal;
      return;
    }
    const selectedDepartment=editing?(existing.departmentId||deptByName(existing.dept)?.id||''):presetDepartmentId,linkedAuthUid=editing?employeeAuthUid(existing):'';
    openOrgModal(editing?`Manage Employee • ${existing.name}`:'Add Employee & Login',`${modeTabs}${editing?`<div class="form-help prominent">Selected existing employee: ${esc(existing.name)} • ID ${esc(existing.employeeId||'—')}. Changes update this employee record; no duplicate record will be created.</div>`:''}<form id="employeeForm" class="form-stack">
      <div class="form-grid">${field('Full Name',`<input class="input" name="name" required value="${editing?esc(existing.name):''}" placeholder="Employee name">`)}${field('Email',`<input class="input" type="email" name="email" required value="${editing?esc(existing.email):''}" ${(editing&&linkedAuthUid)?'readonly':''} placeholder="name@company.com">`)}${field('Mobile',`<input class="input" name="mobile" value="${editing?esc(existing.mobile||existing.phone||''):''}" placeholder="Mobile number">`)}${field('Employee ID',`<input class="input" name="employeeId" required value="${editing?esc(existing.employeeId||''):''}" placeholder="EMP001">`)}${field('Department',`<select class="select" name="department" required>${departmentOptions(selectedDepartment,editing&&deptById(selectedDepartment)?.active===false)}</select>`)}${field('Designation',`<input class="input" name="designation" required value="${editing?esc(existing.designation||existing.role):''}" placeholder="Employee designation">`)}${field('Role',`<input class="input" name="jobRole" required value="${editing?esc(existing.jobRole||existing.accessRole||'Team Member'):'Team Member'}" placeholder="Job role">`,'This is an employee role label. System Admin identity is fixed; project permissions remain assigned within each project.')}${field('Reports to',`<select class="select" name="reportingTo">${reportingOptions(editing?existing.reportingTo||'':DIRECTOR,editing?existing.id:'')}</select>`)}${field('Joining Date',`<input class="input" type="date" name="dateJoined" value="${editing?esc(existing.dateJoined||existing.joiningDate||existing.createdAt?.slice(0,10)||''):''}">`)}${field('Status',`<select class="select" name="status">${['active','inactive','resigned','suspended'].map(status=>`<option value="${status}" ${(editing?(existing.status|| (existing.active===false?'inactive':'active')):'active')===status?'selected':''}>${status[0].toUpperCase()+status.slice(1)}</option>`).join('')}</select>`)}${(!editing||!linkedAuthUid)?field('Temporary Password','<input class="input" type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="Set temporary password">'):''}</div>
      ${!editing?'<div class="form-help">The initial password is used only to create the Firebase login; it is not saved or viewable later. If it is forgotten, send a password-reset email from the employee card.</div>':''}
      ${editing&&linkedAuthUid?'<div class="form-help">Login email is managed by Firebase Authentication and cannot be changed from this profile editor. Use the password-reset action to let the employee choose a new password.</div>':editing?'<div class="form-help">This existing employee has no linked Firebase login yet. Set a temporary password to create a login for this same employee record.</div>':''}
      <div class="form-help prominent">Department defines the employee's organisational home and Department Performance. Project access remains separate and is granted only when the employee is selected into a project.</div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelOrgModal">Cancel</button>${editing&&linkedAuthUid?'<button type="button" class="btn btn-ghost" id="employeePasswordReset">Send Password Reset</button>':''}<button class="btn btn-soft" type="submit">${editing&&!linkedAuthUid?'Create Login & Save Employee':editing?'Save Employee':'Create Employee & Login'}</button></div>
    </form>`);
    const employeeStatusSelect=el('employeeForm')?.elements.status;
    const temporaryPasswordInput=el('employeeForm')?.elements.password;
    if(temporaryPasswordInput){temporaryPasswordInput.minLength=14;temporaryPasswordInput.placeholder='Use at least 14 characters'}
    if(employeeStatusSelect&&!employeeStatusSelect.querySelector('option[value="exited"]')){
      const exitedOption=document.createElement('option');exitedOption.value='exited';exitedOption.textContent='Exited';employeeStatusSelect.append(exitedOption);
      if(editing&&existing.status==='exited')employeeStatusSelect.value='exited';
    }
    el('employeeModeNew').onclick=()=>openEmployee(null,presetDepartmentId,'new');
    el('employeeModeExisting').onclick=()=>openEmployee(null,presetDepartmentId,'existing');
    el('cancelOrgModal').onclick=closeOrgModal;
    const reset=el('employeePasswordReset');if(reset)reset.onclick=async()=>{reset.disabled=true;try{await window.firebaseHub.resetPassword(existing.email);toast('Password reset email sent.')}catch(error){toast(window.firebaseHub.friendlyError(error))}finally{reset.disabled=false}};
    el('employeeForm').onsubmit=async e=>{
      e.preventDefault();const form=e.target,submit=form.querySelector('button[type="submit"]'),fd=new FormData(form),email=editing?normalizeEmail(existing.email):normalizeEmail(fd.get('email')),name=String(fd.get('name')||'').trim(),designation=String(fd.get('designation')||'').trim(),departmentId=String(fd.get('department')||''),employeeId=String(fd.get('employeeId')||'').trim(),mobile=String(fd.get('mobile')||'').trim(),status=String(fd.get('status')||'active');
      let createdCredentials=null;
      if(email===window.firebaseHub.SYSTEM_ADMIN_EMAIL.toLowerCase())return toast('The fixed System Admin account cannot be added as an employee.');
      if((!editing||!linkedAuthUid)&&String(fd.get('password')||'').length<14)return toast('Temporary passwords must contain at least 14 characters.');
      const duplicate=state.users.find(u=>normalizeEmail(u.email)===email&&(!editing||u.id!==existing.id));if(duplicate)return toast('That login email is already assigned to another employee.');
      const employeeIdKey=employeeId.toLowerCase(),duplicateId=state.users.find(u=>String(u.employeeId||'').trim().toLowerCase()===employeeIdKey&&(!editing||u.id!==existing.id));if(duplicateId)return toast('That Employee ID is already in use.');
      const d=deptById(departmentId);if(!d)return toast('Please select a valid department.');
      if(editing){
        const before=`${existing.name} • ${departmentName(existing)} • ${existing.designation||existing.role}`;
        recordEmployeeHistory(existing,departmentId,designation);existing.name=name;existing.employeeId=employeeId;existing.mobile=mobile;existing.phone=mobile;existing.designation=designation;existing.jobRole=String(fd.get('jobRole')||'Team Member').trim();existing.role=designation;existing.departmentId=departmentId;existing.dept=d.name;existing.reportingTo=fd.get('reportingTo')||null;existing.dateJoined=fd.get('dateJoined')||existing.dateJoined||'';existing.initials=initials(existing.name);existing.status=status;existing.active=status==='active';
        const profile={uid:linkedAuthUid,appUserId:existing.id,employeeId,name,email,mobile,department:d.name,departmentId,designation,jobRole:existing.jobRole,role:'employee',accessRole:'Team Member',reportingTo:existing.reportingTo,joiningDate:existing.dateJoined,status,createdBy:window.firebaseHub.adminUid,createdAt:existing.createdAt||new Date().toISOString()};
        try{
          if(linkedAuthUid){existing.authUid=linkedAuthUid;await window.firebaseHub.saveEmployeeProfile(linkedAuthUid,profile)}
          else{submit.disabled=true;const temporaryPassword=String(fd.get('password')||''),account=await window.firebaseHub.createEmployeeAccount(email,temporaryPassword,profile);existing.authUid=account.uid;existing.createdBy=profile.createdBy;createdCredentials={email:account.email,password:temporaryPassword};submit.disabled=false}
        }catch(error){submit.disabled=false;toast(window.firebaseHub.friendlyError(error));return}
        logOrg(`updated employee ${existing.name}`,`${before} → ${existing.name} • ${d.name} • ${designation} • ${status}`)
      }else{
        submit.disabled=true;
        try{
          const id=uniqueId('u'),createdAt=new Date().toISOString(),jobRole=String(fd.get('jobRole')||'Team Member').trim(),profile={appUserId:id,employeeId,name,email,mobile,department:d.name,departmentId,designation,jobRole,role:'employee',accessRole:'Team Member',reportingTo:fd.get('reportingTo')||null,joiningDate:fd.get('dateJoined')||'',status,createdBy:window.firebaseHub.adminUid,createdAt};
          const temporaryPassword=String(fd.get('password')||''),account=await window.firebaseHub.createEmployeeAccount(email,temporaryPassword,profile);
          const u={id,authUid:account.uid,employeeId,name,email,mobile,phone:mobile,designation,jobRole,role:designation,departmentId,dept:d.name,reportingTo:profile.reportingTo,dateJoined:profile.joiningDate,initials:initials(name),active:status==='active',status,systemRole:'Team Member',accessRole:'Team Member',createdBy:profile.createdBy,createdAt,departmentHistory:[{departmentId,designation,from:profile.joiningDate||today(),to:null}]};state.users.push(u);logOrg(`created employee and Firebase login for ${u.name}`,`${employeeId} • ${d.name} • ${designation} • ${status}`)
          createdCredentials={email:account.email,password:temporaryPassword};
        }catch(error){submit.disabled=false;toast(window.firebaseHub.friendlyError(error));return}
      }
      await save();closeOrgModal();populateUserSelect();render();
      if(createdCredentials)showEmployeeCredentials(createdCredentials.email,createdCredentials.password);
      else toast(editing?'Employee updated.':'Employee and login created.');
    }
  }

  async function sendEmployeePasswordReset(uid){
    if(!isAdmin())return toast('Only Director / Admin can send employee password resets.');
    const employee=safeUser(uid);
    if(!employee.authUid||!employee.email)return toast('This employee does not have a Firebase login yet.');
    try{
      await window.firebaseHub.resetPassword(employee.email);
      toast(`Password reset email sent to ${employee.email}.`);
    }catch(error){
      toast(window.firebaseHub.friendlyError(error));
    }
  }

  function toggleEmployee(uid){
    if(!isAdmin()||uid===DIRECTOR)return;const u=safeUser(uid);if(u.email?.toLowerCase()===window.firebaseHub.SYSTEM_ADMIN_EMAIL.toLowerCase())return toast('The System Admin account cannot be deactivated.');const next=u.status==='active'?'inactive':'active';if(next==='inactive'&&!confirm(`Deactivate ${u.name}'s login? Department membership, project history, tasks, comments and audit records will remain.`))return;u.status=next;u.active=next==='active';window.firebaseHub.updateEmployeeStatus(u.authUid,next).then(()=>{logOrg(`${next==='active'?'reactivated':'deactivated'} ${u.name}'s login`,`Department: ${departmentName(u)} • History retained`);save();populateUserSelect();render();toast(`${u.name}'s login is now ${next}.`)}).catch(error=>toast(error.message||'Could not update employee status.'))
  }

  async function deleteEmployee(uid){
    if(!isAdmin())return toast('Only Director / Admin can remove employees.');
    const employee=safeUser(uid);
    if(employee.id===DIRECTOR||employee.email?.toLowerCase()===window.firebaseHub.SYSTEM_ADMIN_EMAIL.toLowerCase())return toast('The System Admin account cannot be removed.');
    if(!confirm(`Mark ${employee.name} as exited and block their application access? Their Firebase Auth account will remain, and all projects, assignments and history will be retained.`))return;
    try{
      if(employee.authUid)await window.firebaseHub.updateEmployeeStatus(employee.authUid,'exited');
      employee.status='exited';employee.active=false;
      logOrg(`marked ${employee.name} as exited`,`Employee ID: ${employee.employeeId||'—'} • Historical records retained`);
      await save();populateUserSelect();render();toast(`${employee.name} was removed from active employees. Historical records were retained.`);
    }catch(error){toast(window.firebaseHub.friendlyError(error))}
  }

  function departmentStats(d){
    const members=deptMembers(d.id,true),active=members.filter(u=>u.active!==false),ids=new Set(members.map(u=>u.id));
    const tasks=state.tasks.filter(t=>ids.has(t.owner)),open=tasks.filter(t=>t.status!=='Completed'),over=open.filter(t=>isOverdue(t));
    const projects=state.projects.filter(p=>(p.team||[]).some(id=>ids.has(id))&&p.lifecycle!=='Archived');
    return {members,active,tasks,open,over,projects};
  }
  function departmentCard(d){
    const s=departmentStats(d),head=d.headId?safeUser(d.headId):null;
    return `<div class="department-card ${d.active===false?'inactive-card':''}" data-dept-card="${esc(d.id)}"><div class="department-card-top"><div class="department-icon">${esc((d.code||d.name).slice(0,3).toUpperCase())}</div><div><span>${d.active===false?'ARCHIVED DEPARTMENT':esc(d.code||'DEPARTMENT')}</span><h3>${esc(d.name)}</h3></div>${d.active===false?'<span class="status-pill archived">Archived</span>':''}</div><div class="department-head"><span>Department Head</span><strong>${head?esc(head.name):'Not assigned'}</strong><small>${head?esc(head.designation||head.role):'Assign from department members'}</small></div><div class="department-stat-grid"><div><b>${s.active.length}</b><span>Active people</span></div><div><b>${s.open.length}</b><span>Open tasks</span></div><div><b>${s.over.length}</b><span>Overdue</span></div><div><b>${s.projects.length}</b><span>Projects</span></div></div><div class="department-card-actions"><button class="link-btn open-department" data-dept="${esc(d.id)}">Open department →</button>${isAdmin()?`<button class="btn btn-ghost manage-department" data-dept="${esc(d.id)}">Manage</button>`:''}</div></div>`
  }
  function employeeCard(u){
    const protectedAdmin=u.email?.toLowerCase()===window.firebaseHub.SYSTEM_ADMIN_EMAIL.toLowerCase();
    const d=userDept(u),tasks=state.tasks.filter(t=>t.owner===u.id),led=state.projects.filter(p=>p.projectLead===u.id&&p.lifecycle!=='Archived'),member=state.projects.filter(p=>(p.team||[]).includes(u.id)&&p.projectLead!==u.id&&p.lifecycle!=='Archived');
    return `<div class="team-card employee-card ${u.active===false?'inactive-card':''}" data-user-id="${esc(u.id)}">${avatar(u.id)}<strong>${esc(u.name)}</strong><div class="role">${esc(u.designation||u.role)}${u.jobRole?` • ${esc(u.jobRole)}`:''}</div><div class="employee-department"><span>${esc(d?.name||u.dept||'Unassigned')}</span>${d?.headId===u.id?'<em>Department Head</em>':''}</div><span class="access-badge ${u.active===false?'inactive':'team-member'}">${protectedAdmin?'System Admin':esc(u.status||'active')}</span><div class="credential-line"><span>Login</span><strong>${esc(u.email||'—')}</strong></div>${isAdmin()&&u.employeeId?`<div class="credential-line"><span>Employee ID</span><strong>${esc(u.employeeId)}</strong></div>`:''}${isAdmin()&&u.authUid?`<div class="credential-line"><span>Firebase UID</span><strong>${esc(u.authUid)}</strong></div>`:''}${isAdmin()&&u.createdAt?`<div class="last-login">Account created: ${esc(new Date(u.createdAt).toLocaleDateString('en-IN'))}</div>`:''}<div class="team-numbers"><div class="team-num"><b>${led.length}</b><span>LEADS</span></div><div class="team-num"><b>${member.length}</b><span>PROJECTS</span></div><div class="team-num"><b>${tasks.filter(t=>t.status!=='Completed').length}</b><span>OPEN</span></div></div>${u.reportingTo?`<div class="last-login">Reports to: ${esc(safeUser(u.reportingTo).name)}</div>`:''}${isAdmin()&&!protectedAdmin?`<div class="member-actions"><button class="btn btn-ghost org-performance" data-user="${esc(u.id)}">Performance</button><button class="btn btn-ghost org-edit-employee" data-user="${esc(u.id)}">Edit Employee</button><button class="btn ${u.active===false?'btn-soft':'btn-danger'} org-toggle-employee" data-user="${esc(u.id)}">${u.active===false?'Activate Login':'Deactivate Login'}</button>${u.status==='exited'?'':`<button class="btn btn-danger org-delete-employee" data-user="${esc(u.id)}">Delete Employee</button>`}</div>`:''}</div>`
  }

  renderTeam=function(){
    setTitle('People & Departments','ORGANISATION');
    const departments=state.departments||[],activeDepts=departments.filter(d=>d.active!==false),activePeople=activeUsers(),inactivePeople=state.users.filter(u=>u.active===false);
    if(orgFocusDept){const d=deptById(orgFocusDept);if(d)return renderDepartmentDetail(d);orgFocusDept=null}
    el('content').innerHTML=`<div class="organisation-hero"><div><span class="eyebrow">ORGANISATION LAYER</span><h2>Departments define where people belong. Projects define where they contribute.</h2><p>Department membership drives organisational reporting and Department Performance. Project access is still granted person-by-person, so being in a department never exposes every project.</p></div>${isAdmin()?'<div class="org-hero-actions"><button class="btn btn-ghost" id="addDepartmentBtn">+ Department</button><button class="btn btn-soft" id="addEmployeeBtn">+ Employee & Login</button></div>':''}</div>
      <div class="portfolio-strip compact-strip"><div><span>Active Departments</span><strong>${activeDepts.length}</strong></div><div><span>Active Employees</span><strong>${activePeople.length}</strong></div><div><span>Inactive Logins</span><strong>${inactivePeople.length}</strong></div><div class="launch-history"><span>Access principle</span><strong>Department ≠ Project Access</strong></div></div>
      <div class="org-tabs"><button class="${orgTab==='departments'?'active':''}" data-org-tab="departments">Departments</button><button class="${orgTab==='employees'?'active':''}" data-org-tab="employees">Employees</button></div>
      <div id="orgBody">${orgTab==='employees'?renderEmployeesBody():renderDepartmentsBody()}</div>`;
  };
  function renderDepartmentsBody(){
    return `<div class="section-row" style="margin-top:0"><div><h2>Department structure</h2><p>Create functional departments, appoint Department Heads and organise employees before adding individuals into projects.</p></div></div><div class="department-grid">${state.departments.slice().sort((a,b)=>(a.active===false)-(b.active===false)||a.name.localeCompare(b.name)).map(departmentCard).join('')}</div>`
  }
  function renderEmployeesBody(){
    const depts=state.departments.slice().sort((a,b)=>a.name.localeCompare(b.name));
    const employees=state.users.filter(u=>u.email?.toLowerCase()!==window.firebaseHub.SYSTEM_ADMIN_EMAIL.toLowerCase());
    return `<div class="section-row" style="margin-top:0"><div><h2>Employee directory</h2><p>Designation and department belong to the employee record; project roles are assigned separately inside each project.</p></div><div class="filters"><select class="select" id="employeeDeptFilter"><option value="">All departments</option>${depts.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select><select class="select" id="employeeStatusFilter"><option value="">All login states</option>${['active','inactive','resigned','suspended'].map(status=>`<option value="${status}">${status[0].toUpperCase()+status.slice(1)}</option>`).join('')}</select></div></div><div class="team-grid" id="employeeGrid">${employees.slice().sort((a,b)=>departmentName(a).localeCompare(departmentName(b))||a.name.localeCompare(b.name)).map(employeeCard).join('')}</div>`
  }
  function renderDepartmentDetail(d){
    const s=departmentStats(d),head=d.headId?safeUser(d.headId):null;
    const contributions=s.projects.map(p=>{const ids=new Set(s.members.map(u=>u.id)),tasks=state.tasks.filter(t=>t.project===p.id&&ids.has(t.owner));const avg=tasks.length?Math.round(tasks.reduce((sum,t)=>sum+(Number(t.progress)||0),0)/tasks.length):0;return {p,tasks,avg}}).sort((a,b)=>b.tasks.length-a.tasks.length);
    el('content').innerHTML=`<button class="link-btn" id="backDepartments">← Back to Departments</button><div class="department-detail-hero"><div><span class="eyebrow">${esc(d.code||'DEPARTMENT')}</span><h2>${esc(d.name)}</h2><p>${d.active===false?'Archived department — historical membership and performance remain available.':'Functional organisational unit. Project categories and workstreams remain separate.'}</p></div>${isAdmin()?`<div class="org-hero-actions"><button class="btn btn-ghost" id="manageDepartmentDetail">Manage Department</button><button class="btn btn-soft" id="addEmployeeToDepartment">+ Add Employee</button></div>`:''}</div><div class="project-stats department-detail-stats"><div class="project-stat"><span>Department Head</span><strong>${head?esc(head.name):'Unassigned'}</strong></div><div class="project-stat"><span>Active people</span><strong>${s.active.length}</strong></div><div class="project-stat"><span>Open tasks</span><strong>${s.open.length}</strong></div><div class="project-stat"><span>Projects represented</span><strong>${s.projects.length}</strong></div><div class="project-stat"><span>Overdue</span><strong>${s.over.length}</strong></div></div>
      <div class="grid-2"><div><div class="section-row"><div><h2>People</h2><p>Employees whose organisational home is ${esc(d.name)}.</p></div></div><div class="team-grid department-people-grid">${s.members.map(employeeCard).join('')||'<div class="empty"><strong>No employees yet</strong>Add an employee and assign this department.</div>'}</div></div><div><div class="section-row"><div><h2>Project contribution</h2><p>Projects where at least one department member has access or assigned work.</p></div></div><div class="panel"><div class="panel-body"><div class="department-project-list">${contributions.map(x=>`<button data-project="${esc(x.p.id)}"><div><strong>${esc(x.p.name)}</strong><span>${x.tasks.length} department-owned task${x.tasks.length===1?'':'s'} • Project Lead: ${esc(safeUser(x.p.projectLead).name)}</span></div><div><b>${x.avg}%</b><small>work progress</small></div></button>`).join('')||'<div class="empty"><strong>No project exposure</strong>No department members are currently selected into active projects.</div>'}</div></div></div></div></div>`;
  }

  function openManageProjectTeam18(p){
    if(!canManageProject(p))return toast('Only Director / Admin or this Project Lead can manage project access.');
    const locked=[DIRECTOR,p.projectLead];
    openOrgModal(`Manage Project Team • ${p.name}`,`<form id="projectTeamOrgForm" class="form-stack"><div class="form-help prominent">Employees are shown under their organisational departments. Selecting a person grants access only to this project. Director and Project Lead are locked in. Removing someone keeps all historic tasks, comments and audit history.</div>${departmentTeamChecks(p.team||[],locked)}<div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelOrgModal">Cancel</button><button class="btn btn-soft" type="submit">Save Project Team</button></div></form>`);
    el('cancelOrgModal').onclick=closeOrgModal;
    el('projectTeamOrgForm').onsubmit=e=>{e.preventDefault();const before=[...(p.team||[])],next=[...e.target.querySelectorAll('input[name=team]:checked')].map(x=>x.value);next.push(DIRECTOR,p.projectLead);p.team=[...new Set(next)];p.team.filter(x=>!before.includes(x)).forEach(uid=>log(state.currentUser,p.id,null,'Access',`added ${safeUser(uid).name} to project team`,`Department: ${departmentName(safeUser(uid))}`));before.filter(x=>!p.team.includes(x)&&!locked.includes(x)).forEach(uid=>log(state.currentUser,p.id,null,'Access',`removed ${safeUser(uid).name} from project access`,'Historical records retained'));save();closeOrgModal();render();toast('Project access updated by employee, with department context retained.')}
  }

  function openNewProject18(){
    if(!isAdmin())return toast('Only Director / Admin can create a new project.');
    openOrgModal('Create New Project',`<form id="newProjectOrgForm" class="form-stack"><div class="form-grid">${field('Project name','<input class="input" name="name" required placeholder="Project name">')}${field('Type','<select class="select" name="category"><option>Unit</option><option>Brand</option><option>Vertical</option><option>System</option></select>')}${field('Project code','<input class="input" name="code" required placeholder="PROJECT-CODE">')}${field('Launch target','<input class="input" name="launch" type="date" required>')}</div>${field('Project Lead',`<select class="select" name="lead">${leadOptions(state.currentUser)}</select>`,'Project Lead authority exists only inside this project.')}${field('Description','<textarea class="textarea" name="description" placeholder="What are we launching and what does success mean?"></textarea>')}${field('Starting categories','<input class="input" name="workstreams" placeholder="Category 1, Category 2, Category 3">','These are project categories/workstreams — they are not company departments.')}<div><div class="form-label">Initial project team</div><div class="form-help">Choose individual employees from their departments. Department membership alone does not grant project access.</div>${departmentTeamChecks([DIRECTOR,state.currentUser],[DIRECTOR])}</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelOrgModal">Cancel</button><button class="btn btn-soft" type="submit">Create Project</button></div></form>`);
    el('cancelOrgModal').onclick=closeOrgModal;
    el('newProjectOrgForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target),id=uniqueId('p'),lead=String(fd.get('lead')||state.currentUser),team=[...e.target.querySelectorAll('input[name=team]:checked')].map(x=>x.value);team.push(DIRECTOR,lead);const names=String(fd.get('workstreams')||'').split(',').map(x=>x.trim()).filter(Boolean);const p={id,category:fd.get('category'),name:String(fd.get('name')||'').trim(),code:String(fd.get('code')||'').trim().toUpperCase(),owner:state.currentUser,projectLead:lead,launch:fd.get('launch'),health:'on-track',progress:0,description:String(fd.get('description')||'').trim(),lifecycle:'Planning',team:[...new Set(team)],workstreams:names.map(n=>({name:n,progress:0,owner:lead}))};state.projects.unshift(p);log(state.currentUser,id,null,'Project',`created project ${p.name}`,`Project Lead: ${safeUser(lead).name} • Team selected by department directory • Launch: ${fmtDateFull(p.launch)}`);save();closeOrgModal();activeProject=id;activeProjectTab='overview';render();toast('Project created. Department membership and project access remain separate.')}
  }

  renderProjectTeam=function(p,tasks){
    const members=(p.team||[]).map(uid=>safeUser(uid));
    const grouped=new Map();members.forEach(u=>{const did=u.departmentId||'none';if(!grouped.has(did))grouped.set(did,[]);grouped.get(did).push(u)});
    const sections=[...grouped.entries()].sort((a,b)=>{const an=deptById(a[0])?.name||'Unassigned',bn=deptById(b[0])?.name||'Unassigned';return an.localeCompare(bn)}).map(([did,list])=>{const d=deptById(did);return `<div class="project-department-group"><div class="project-department-head"><div><span>DEPARTMENT</span><strong>${esc(d?.name||'Unassigned')}</strong></div><small>${list.length} project member${list.length===1?'':'s'}</small></div><div class="team-grid">${list.map(u=>{const assigned=tasks.filter(t=>t.owner===u.id),cats=(p.workstreams||[]).filter(w=>w.owner===u.id).map(w=>w.name);return `<div class="team-card ${u.id===p.projectLead?'lead-card':''}">${avatar(u.id)}<strong>${esc(u.name)}</strong><div class="role">${esc(u.designation||u.role)}</div>${u.id===p.projectLead?'<span class="project-role-badge lead">Project Lead</span>':'<span class="project-role-badge">Project Member</span>'}${d?.headId===u.id?'<span class="status-pill review">Department Head</span>':''}${u.active===false?'<span class="status-pill overdue">Login inactive</span>':''}<div class="team-numbers"><div class="team-num"><b>${assigned.filter(t=>t.status!=='Completed').length}</b><span>OPEN</span></div><div class="team-num"><b>${assigned.filter(isOverdue).length}</b><span>OVERDUE</span></div><div class="team-num"><b>${cats.length}</b><span>CATEGORIES</span></div></div>${cats.length?`<div class="category-list">${cats.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'<div class="subtle" style="margin-top:12px">Project member</div>'}</div>`}).join('')}</div></div>`}).join('');
    return `<div class="section-row" style="margin-top:0"><div><h2>Team & project access</h2><p>${p.team.length} selected people across ${grouped.size} department${grouped.size===1?'':'s'} can open this project. Project Lead: <strong>${esc(safeUser(p.projectLead).name)}</strong>.</p></div>${canManageProject(p)?'<button class="btn btn-soft" id="manageProjectTeam">Manage Project Team</button>':''}</div><div class="project-org-note"><strong>Organisation vs execution:</strong> departments show where employees belong; categories such as Branding, Website and Product are project workstreams and may include people from multiple departments.</div>${sections}`
  };

  function wireOrg(){
    const addD=el('addDepartmentBtn');if(addD)addD.onclick=()=>openDepartment();
    const addE=el('addEmployeeBtn');if(addE)addE.onclick=()=>openEmployee();
    document.querySelectorAll('[data-org-tab]').forEach(b=>b.onclick=()=>{orgTab=b.dataset.orgTab;orgFocusDept=null;render()});
    document.querySelectorAll('.open-department').forEach(b=>b.onclick=e=>{e.stopPropagation();orgFocusDept=b.dataset.dept;render()});
    document.querySelectorAll('.manage-department').forEach(b=>b.onclick=e=>{e.stopPropagation();openDepartment(deptById(b.dataset.dept))});
    document.querySelectorAll('.org-edit-employee').forEach(b=>b.onclick=()=>openEmployee(safeUser(b.dataset.user)));
    document.querySelectorAll('.org-edit-employee').forEach(edit=>{
      const employee=safeUser(edit.dataset.user),actions=edit.parentElement;
      if(!employee.authUid||!actions||actions.querySelector('.org-reset-employee'))return;
      const reset=document.createElement('button');
      reset.type='button';reset.className='btn btn-ghost org-reset-employee';reset.textContent='Reset Password';reset.dataset.user=employee.id;
      actions.insertBefore(reset,edit.nextSibling);
    });
    document.querySelectorAll('.org-reset-employee').forEach(b=>b.onclick=()=>sendEmployeePasswordReset(b.dataset.user));
    document.querySelectorAll('.org-toggle-employee').forEach(b=>b.onclick=()=>toggleEmployee(b.dataset.user));
    document.querySelectorAll('.org-delete-employee').forEach(b=>b.onclick=()=>deleteEmployee(b.dataset.user));
    document.querySelectorAll('.org-performance').forEach(b=>b.onclick=()=>{activeView='performance';activeProject=null;render();setTimeout(()=>{const open=el('openIndividualsFromCompany');if(open)open.click();setTimeout(()=>{const btn=document.querySelector(`[data-perf-user="${b.dataset.user}"]`);if(btn)btn.click()},0)},0)});
    const back=el('backDepartments');if(back)back.onclick=()=>{orgFocusDept=null;orgTab='departments';render()};
    const md=el('manageDepartmentDetail');if(md)md.onclick=()=>openDepartment(deptById(orgFocusDept));
    const ae=el('addEmployeeToDepartment');if(ae)ae.onclick=()=>openEmployee(null,orgFocusDept);
    const f=el('employeeDeptFilter'),s=el('employeeStatusFilter');
    if(s&&!s.querySelector('option[value="exited"]'))s.add(new Option('Exited','exited'));
    function applyEmployeeFilter(){const dept=f?.value||'',status=s?.value||'';document.querySelectorAll('#employeeGrid .employee-card').forEach(card=>{const uid=card.dataset.userId||card.querySelector('.org-edit-employee')?.dataset.user||card.querySelector('.org-performance')?.dataset.user;const u=uid?safeUser(uid):null;const okDept=!dept||u?.departmentId===dept;const currentStatus=u?.status||(u?.active===false?'inactive':'active');const okStatus=!status||currentStatus===status;card.style.display=okDept&&okStatus?'':'none'})}
    if(f)f.onchange=applyEmployeeFilter;if(s)s.onchange=applyEmployeeFilter;
    const np=el('newProjectBtn');if(np)np.onclick=openNewProject18;
    if(activeProject){const p=project(activeProject),mt=el('manageProjectTeam');if(mt)mt.onclick=()=>openManageProjectTeam18(p)}
  }

  const baseWire18=wireDynamic;
  wireDynamic=function(){baseWire18();wireOrg()};

  const baseRender18=render;
  render=function(search=''){
    baseRender18(search);
    const navTeam=document.querySelector('.nav-item[data-view="team"]');if(navTeam)navTeam.innerHTML='<span>◉</span> People & Departments';
    if(activeView==='performance'&&isAdmin()){
      const banner=document.querySelector('.perf-lock-banner');
      if(banner&&!document.querySelector('.perf-department-source-note'))banner.insertAdjacentHTML('afterend','<div class="perf-department-source-note"><strong>Department Performance source:</strong> employee department membership from People & Departments. Project categories/workstreams are not treated as departments.</div>')
    }
  };

  migrateOrganisation();
  render();
})();
