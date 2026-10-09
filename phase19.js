/* Execution Hub – Phase 1.9 Regular Work, using the shared Task engine */
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const authUid=()=>window.firebaseHub?.firebaseUid||'';
  const isAdmin=()=>!!window.firebaseHub?.isSystemAdmin();
  const activeTasks=()=>state.tasks.filter(task=>task.contextType==='regular_work'&&task.deleted!==true&&task.archived!==true&&window.firebaseHub?.canAccessRegularWorkTask(task.id));
  const activeFolders=()=>Array.isArray(state.regularWorkFolders)?state.regularWorkFolders.filter(folder=>folder.deleted!==true):[];
  const activeCategories=()=>Array.isArray(state.regularWorkCategories)?state.regularWorkCategories.filter(category=>category.deleted!==true):[];
  let workFilter='all';
  let regularSearch='';
  let selectedRegularFolderId='';
  let selectedRegularCategoryId='';

  function closeRegularModal(){el('modalBackdrop').classList.remove('open');el('modalBody').innerHTML=''}
  function openRegularModal(title,html){el('modalTitle').textContent=title;el('modalBody').innerHTML=html;el('modalBackdrop').classList.add('open')}
  function uniqueId(prefix){return `${prefix}${Date.now()}${Math.floor(Math.random()*100000)}`}
  function isFolderOwner(folder){return isAdmin()||folder?.ownerUid===authUid()}
  // Assignment grants task access, not permission to reorganise the structure.
  function canManageParentTask(item){return isAdmin()||item?.owner===state.currentUser||item?.createdByUid===authUid()||item?.folderOwnerUid===authUid()}
  function setSaving(form,saving){const submit=form?.querySelector('[type="submit"]');if(submit){submit.disabled=saving;submit.dataset.label=submit.dataset.label||submit.textContent;submit.textContent=saving?'Saving…':submit.dataset.label}}
  async function saveOrRestore(form,apply,restore,persist){
    if(form.dataset.saving==='true')return false;
    form.dataset.saving='true';setSaving(form,true);apply();
    try{if(typeof persist!=='function')throw new Error('A targeted Firebase writer is required for Regular Work changes.');const saved=await persist();if(saved===false)throw new Error('Firebase did not confirm the Regular Work save.');return true}catch(error){restore();console.error('Could not save Regular Work change:',error);toast('Changes could not be saved. Please try again.');return false}
    finally{form.dataset.saving='';setSaving(form,false)}
  }
  function confirmRegularAction(title,message,onConfirm){
    openRegularModal(title,`<div class="form-stack"><p>${esc(message)}</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelRegularAction">Cancel</button><button type="button" class="btn btn-soft" id="confirmRegularAction">Confirm</button></div></div>`);
    el('cancelRegularAction').onclick=closeRegularModal;el('confirmRegularAction').onclick=onConfirm;
  }
  function categoryForTask(task){return activeCategories().find(category=>category.id===(task.categoryId||task.regularCategoryId))}
  function categoryStatus(category){return ['Pending','In Progress','Completed'].includes(category?.status)?category.status:'Pending'}
  function categoryArchived(category){return category?.archived===true||category?.status==='archived'}
  function folderForTask(task){const folderId=task.folderId||task.regularFolderId;return activeFolders().find(folder=>folder.id===folderId)||{id:folderId,name:task.regularFolderName||'Regular Work',ownerUid:task.folderOwnerUid,status:'active'}}
  function assignedRegularTasks(){return activeTasks().filter(task=>task.owner===state.currentUser)}
  function visibleProjectTasks(){
    const projectIds=new Set(state.projects.filter(project=>isAdmin()||project.projectLead===state.currentUser||(project.team||[]).includes(state.currentUser)).map(project=>project.id));
    return state.tasks.filter(task=>task.contextType!=='regular_work'&&task.project&&projectIds.has(task.project)&&task.owner===state.currentUser);
  }
  function taskMetrics(tasks){
    return [
      tasks.length,
      tasks.filter(isOverdue).length,
      tasks.filter(task=>{if(['Completed','Discarded'].includes(task.status))return false;const days=daysDiff(task.currentDue);return days>=0&&days<=7}).length,
      tasks.filter(task=>task.status==='Ready for Review').length,
      tasks.filter(task=>!['Completed','Discarded'].includes(task.status)&&(task.status==='On Hold'||task.waitingOn||['Waiting','Blocked'].includes(task.status))).length,
      tasks.filter(task=>task.status==='Completed').length
    ];
  }
  function updateMyWorkMetrics(tasks){
    const values=taskMetrics(tasks);
    document.querySelectorAll('#content .metrics .metric-value').forEach((node,index)=>{if(index<values.length)node.textContent=values[index]});
  }
  function filterBar(){
    return `<div class="regular-work-filter tabs" role="tablist" aria-label="My Work filter">${[['all','All Work'],['project','Project Work'],['regular','Regular Work']].map(([value,label])=>`<button class="tab ${workFilter===value?'active':''} my-work-filter" data-work-filter="${value}" role="tab" aria-selected="${workFilter===value}">${label}</button>`).join('')}</div>`;
  }
  function statusCell(task){const status=task.status||'Pending',className=status==='Completed'?'completed':status==='On Hold'||status==='Waiting'||status==='Blocked'?'waiting':status==='Ready for Review'?'review':status==='Discarded'?'archived':isOverdue(task)?'overdue':'on-track';return `<span class="status-pill ${className}">${esc(status==='Not Started'?'Pending':status)}</span>`}
  function regularTaskRow(task){
    const folder=folderForTask(task),category=categoryForTask(task);
    const priority=String(task.priority||'').toLowerCase();
    return `<tr data-regular-task-row="${esc(task.id)}"><td><button class="task-link" data-task="${esc(task.id)}">${esc(task.title)}</button><div class="subtle">Regular Work · ${esc(folder.name)} · ${esc(category?.name||task.regularCategoryName||task.workstream||'')}</div></td><td>${esc(user(task.owner).name)}</td><td><span class="priority-pill ${esc(priority)}">${esc(task.priority||'—')}</span></td><td>${statusCell(task)}</td><td>${task.currentDue?fmtDate(task.currentDue):'—'}${task.originalDue&&task.originalDue!==task.currentDue?`<div class="subtle">Original ${fmtDate(task.originalDue)}</div>`:''}</td><td>${esc(task.next||'')}</td></tr>`;
  }
  function regularTaskRow(task){
    const folder=folderForTask(task),category=categoryForTask(task),priority=String(task.priority||'').toLowerCase();
    const actions=canManageParentTask(task)?` <button type="button" class="rw-ellipsis" data-task-menu="${esc(task.id)}" aria-label="Task actions">…</button>`:'';
    return `<tr data-regular-task-row="${esc(task.id)}"><td><button class="task-link" data-task="${esc(task.id)}">${esc(task.title)}</button>${actions}<div class="subtle">Regular Work · ${esc(folder.name)} · ${esc(category?.name||task.regularCategoryName||task.workstream||'')}</div></td><td>${esc(user(task.owner).name)}</td><td><span class="priority-pill ${esc(priority)}">${esc(task.priority||'—')}</span></td><td>${statusCell(task)}</td><td>${task.currentDue?fmtDate(task.currentDue):'—'}</td><td>${esc(task.next||'')}</td></tr>`;
  }
  function regularTaskTable(tasks){
    return `<div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Assigned To</th><th>Priority</th><th>Status</th><th>Due</th><th>Next Action</th></tr></thead><tbody>${tasks.map(regularTaskRow).join('')||'<tr><td colspan="6"><div class="empty compact"><strong>No Regular Work tasks</strong>Create a task in one of your active categories.</div></td></tr>'}</tbody></table></div></div>`;
  }
  function openFolderForm(existing=null){
    if(existing&&!isFolderOwner(existing))return toast('Only the Folder owner can edit this Folder.');
    const edit=!!existing;
    openRegularModal(edit?'Edit Regular Work Folder':'Create Regular Work Folder',`<form id="regularFolderForm" class="form-stack"><div class="form-grid"><label class="form-field"><span>Folder / Topic Name</span><input class="input" name="name" required maxlength="100" value="${edit?esc(existing.name):''}" placeholder="e.g. Digital Marketing Operations"></label><label class="form-field"><span>Status</span><select class="select" name="status"><option value="active" ${!edit||existing.status==='active'?'selected':''}>Active</option><option value="archived" ${edit&&existing.status==='archived'?'selected':''}>Archived</option></select></label></div><label class="form-field"><span>Description</span><textarea class="textarea" name="description" placeholder="Optional context">${edit?esc(existing.description||''):''}</textarea></label><div class="form-help">Created By and Created Date are recorded automatically. Folders are archived, never hard-deleted.</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelRegularModal">Cancel</button><button class="btn btn-soft" type="submit">${edit?'Save Folder':'Create Folder'}</button></div></form>`);
    el('cancelRegularModal').onclick=closeRegularModal;
    el('regularFolderForm').onsubmit=async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),name=String(form.get('name')||'').trim();
      if(!name)return toast('Folder name is required.');
      const now=new Date().toISOString(),description=String(form.get('description')||'').trim(),status=String(form.get('status')||'active');
      let folder=existing,change=`Status: ${status}`;
      if(edit){const oldName=existing.name;existing.name=name;existing.description=description;existing.status=status;existing.updatedAt=now;existing.updatedBy=state.currentUser;change=`${oldName} → ${name} • Status: ${status}`}
      else{folder={id:uniqueId('rwf'),name,description,ownerUid:authUid(),ownerUserId:state.currentUser,createdByUid:authUid(),createdBy:state.currentUser,createdAt:now,status:'active'};state.regularWorkFolders.push(folder);selectedRegularFolderId=folder.id;selectedRegularCategoryId=''}
      await window.firebaseHub.saveRegularWorkFolder(folder.ownerUid,folder.id,folder);closeRegularModal();render();toast(edit?'Folder updated.':'Folder created.');
    };
  }
  function openCategoryForm(folder=null,existing=null){
    const manageableFolders=activeFolders().filter(item=>isFolderOwner(item)&&item.status!=='archived');
      if(existing)folder=activeFolders().find(item=>item.id===existing.folderId);
    if(!manageableFolders.length)return toast('Create or select an active Folder before adding a Category.');
    if(!folder)folder=manageableFolders.find(item=>item.id===selectedRegularFolderId)||null;
    if(folder&&(!isFolderOwner(folder)||folder.status==='archived'))return toast('Only the owner of an active Folder can manage its categories.');
    const edit=!!existing;
    const folderField=edit||folder
      ? `<div class="regular-category-parent"><span>Parent Folder</span><strong>${esc(folder.name)}</strong><input type="hidden" name="folderId" value="${esc(folder.id)}"></div>`
      : `<label class="form-field"><span>Parent Folder</span><select class="select" name="folderId" required>${manageableFolders.map(item=>`<option value="${esc(item.id)}" ${item.id===selectedRegularFolderId?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label>`;
      openRegularModal(edit?'Edit Category':'Create Category',`<form id="regularCategoryForm" class="form-stack"><div class="form-grid">${folderField}<label class="form-field"><span>Category Name</span><input class="input" name="name" required maxlength="100" value="${edit?esc(existing.name):''}" placeholder="Category name"></label>${edit?`<label class="form-field"><span>Status</span><select class="select" name="status">${['Pending','In Progress','Completed'].map(status=>`<option value="${status}" ${categoryStatus(existing)===status?'selected':''}>${status}</option>`).join('')}</select></label>`:''}</div><label class="form-field"><span>Description</span><textarea class="textarea" name="description" placeholder="Optional context">${edit?esc(existing.description||''):''}</textarea></label><div class="form-help">Category ownership follows the Folder owner. Status is manually controlled.</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelRegularModal">Cancel</button><button class="btn btn-soft" type="submit">${edit?'Save Category':'Save'}</button></div></form>`);
    el('cancelRegularModal').onclick=closeRegularModal;
    el('regularCategoryForm').onsubmit=async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),name=String(form.get('name')||'').trim();if(!name)return toast('Category name is required.');
      const selectedFolder=edit?folder:manageableFolders.find(item=>item.id===String(form.get('folderId')||''));if(!selectedFolder||!isFolderOwner(selectedFolder)||selectedFolder.status==='archived')return toast('Choose an active Folder you own.');
      const now=new Date().toISOString(),description=String(form.get('description')||'').trim(),status=String(form.get('status')||'active');
      let category=existing,change=`Folder: ${selectedFolder.name} • Status: ${status}`;
      if(edit){const oldName=existing.name;existing.name=name;existing.description=description;existing.status=status;existing.updatedAt=now;existing.updatedBy=state.currentUser;change=`${oldName} → ${name} • Folder: ${selectedFolder.name} • Status: ${status}`}
      else{category={id:uniqueId('rwc'),folderId:selectedFolder.id,name,description,ownerUid:selectedFolder.ownerUid,ownerUserId:selectedFolder.ownerUserId,createdByUid:authUid(),createdBy:state.currentUser,createdAt:now,status:'active'};state.regularWorkCategories.push(category);selectedRegularFolderId=selectedFolder.id;selectedRegularCategoryId=category.id}
      await window.firebaseHub.saveRegularWorkCategory(category.ownerUid,category.id,category);closeRegularModal();render();toast(edit?'Category updated.':'Category created.');
    };
  }
  function taskListForFolder(folder,category){
    return activeTasks().filter(task=>(task.folderId||task.regularFolderId)===folder.id&&(!category||(task.categoryId||task.regularCategoryId)===category.id)).sort((a,b)=>(a.currentDue||'').localeCompare(b.currentDue||''));
  }
  function renderRegularWorkArea(){
    const query=regularSearch.trim().toLowerCase();
    const allTasks=activeTasks();
    const folders=activeFolders().filter(folder=>!query||`${folder.name} ${folder.description||''}`.toLowerCase().includes(query)||activeCategories().some(category=>category.folderId===folder.id&&`${category.name} ${category.description||''}`.toLowerCase().includes(query))||allTasks.some(task=>(task.folderId||task.regularFolderId)===folder.id&&`${task.title} ${task.regularCategoryName||''}`.toLowerCase().includes(query)));
    const selectedFolder=folders.find(folder=>folder.id===selectedRegularFolderId)||folders[0]||null;
    if(selectedFolder&&selectedFolder.id!==selectedRegularFolderId){selectedRegularFolderId=selectedFolder.id;selectedRegularCategoryId=''}
    const categories=selectedFolder?activeCategories().filter(category=>category.folderId===selectedFolder.id):[];
    const selectedCategory=categories.find(category=>category.id===selectedRegularCategoryId)||categories[0]||null;
    if(selectedCategory)selectedRegularCategoryId=selectedCategory.id;
    const selectedTasks=selectedFolder&&selectedCategory?taskListForFolder(selectedFolder,selectedCategory).filter(task=>!query||`${task.title} ${task.description||''} ${task.regularFolderName||''} ${task.regularCategoryName||''}`.toLowerCase().includes(query)):[];
    const assigned=allTasks.filter(task=>task.owner===state.currentUser&&(!query||`${task.title} ${task.regularFolderName||''} ${task.regularCategoryName||''}`.toLowerCase().includes(query)));
    const visibleStructureTasks=new Set();
    folders.forEach(folder=>taskListForFolder(folder).forEach(task=>visibleStructureTasks.add(task.id)));
    const assignedOutside=assigned.filter(task=>!visibleStructureTasks.has(task.id));
    const metrics=taskMetrics(assigned);
    const metricLabels=['ASSIGNED TO ME','OVERDUE','DUE THIS WEEK','IN REVIEW','WAITING','COMPLETED'];
    const folderCategories=selectedFolder?categories:[];
    const folderTasks=selectedFolder?taskListForFolder(selectedFolder):[];
    const openCount=folderTasks.filter(task=>!['Completed','Discarded'].includes(task.status)).length;
    const selectedCanManage=!!selectedFolder&&isFolderOwner(selectedFolder),folderActive=selectedFolder?.status!=='archived';
    const dependencies=allTasks.filter(task=>!['Completed','Discarded'].includes(task.status)&&(task.status==='On Hold'||task.waitingOn||['Waiting','Blocked'].includes(task.status)));
    const selectedTaskIds=new Set(allTasks.map(task=>task.id));
    const approvals=(state.approvals||[]).filter(approval=>selectedTaskIds.has(approval.task)).slice(0,4);
    const plannerEvents=(state.calendarEvents||[]).filter(event=>selectedTaskIds.has(event.regularWorkTaskId||event.task)).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).slice(0,3);
    const folderList=folders.map(folder=>{
      const count=activeCategories().filter(category=>category.folderId===folder.id).length;
      const taskCount=taskListForFolder(folder).filter(task=>!['Completed','Discarded'].includes(task.status)).length;
      return `<button type="button" class="rw-folder-item ${folder.id===selectedFolder?.id?'selected':''} ${folder.status==='archived'?'archived':''}" data-select-folder="${esc(folder.id)}" aria-pressed="${folder.id===selectedFolder?.id}"><span class="rw-folder-copy"><strong>${esc(folder.name)}</strong><span>${esc(folder.description||'No description')}</span><small>${count} categor${count===1?'y':'ies'}${taskCount?` · ${taskCount} open`:''}</small></span><span class="rw-folder-arrow">›</span></button>`;
    }).join('');
    const categoryChips=folderCategories.map(category=>{
      const count=taskListForFolder(selectedFolder,category).length;
      return `<button type="button" class="rw-category-chip ${category.id===selectedCategory?.id?'selected':''} ${categoryArchived(category)?'archived':''}" data-select-category="${esc(category.id)}" aria-pressed="${category.id===selectedCategory?.id}">${esc(category.name)}<span class="rw-category-state">${esc(categoryStatus(category))}</span><span>${count}</span></button>`;
    }).join('');
    const folderActions=selectedFolder&&selectedCanManage?`<div class="rw-detail-actions"><button class="btn btn-ghost" data-edit-folder="${esc(selectedFolder.id)}">Edit folder</button>${folderActive?`<button class="btn btn-ghost" data-archive-folder="${esc(selectedFolder.id)}">Archive</button>`:''}</div>`:'';
    const taskArea=!selectedFolder
      ? `<div class="empty rw-empty"><strong>${query?'No matching Regular Work':'Organise your regular work'}</strong><span>${query?'No authorized Folder, Category, or Task matched your search.':'Create folders and categories for responsibilities that are not tied to a project.'}</span>${!query?'<button class="btn btn-soft" id="createFirstRegularFolder">+ Create First Folder</button>':''}</div>`
      : `<div class="rw-folder-detail ${folderActive?'':'regular-archived'}"><div class="rw-detail-top"><div><span class="eyebrow">${selectedFolder.status==='archived'?'ARCHIVED FOLDER':'REGULAR WORK FOLDER'}</span><h2>${esc(selectedFolder.name)}</h2><p>${esc(selectedFolder.description||'Responsibilities not tied to a Project.')}</p></div><div class="rw-detail-meta"><span class="rw-open-count">${openCount} open task${openCount===1?'':'s'}</span>${folderActions}</div></div><div class="rw-category-bar"><div class="rw-category-chips">${categoryChips||'<span class="rw-no-categories">No categories yet</span>'}</div>${selectedCanManage&&folderActive?'<button class="btn btn-soft" id="createRegularCategory">+ New Category</button>':''}</div>${selectedCategory?`<section class="rw-selected-category"><div class="rw-category-title"><h3>${esc(selectedCategory.name)}</h3><span class="rw-category-status ${categoryStatus(selectedCategory).toLowerCase().replaceAll(' ','-')}">${esc(categoryStatus(selectedCategory))}</span>${selectedCanManage&&folderActive&&!categoryArchived(selectedCategory)?`<button type="button" class="btn btn-soft rw-category-add-task" id="createRegularTask" data-folder-id="${esc(selectedFolder.id)}" data-category-id="${esc(selectedCategory.id)}">+ Add Task</button>`:''}${selectedCanManage?`<label class="rw-category-status-control"><span>Change status</span><select class="select" data-category-status="${esc(selectedCategory.id)}" ${categoryArchived(selectedCategory)?'disabled':''}>${['Pending','In Progress','Completed'].map(status=>`<option value="${status}" ${categoryStatus(selectedCategory)===status?'selected':''}>${status}</option>`).join('')}</select></label>`:''}</div>${categoryArchived(selectedCategory)?'<div class="rw-inline-note">This category is archived. Historical tasks remain available.</div>':''}${regularTaskTable(selectedTasks)}</section>`:`<div class="empty compact rw-empty-category"><strong>No categories yet</strong><span>Create a category to organise this folder.</span>${selectedCanManage&&folderActive?'<button class="btn btn-soft" id="createEmptyRegularCategory">+ Create Category</button>':''}</div>`}</div>`;
    const contextCard=(title,subtitle,items,emptyText,kind)=>{
      const rows=kind==='approvals'?[...items.map(item=>({type:'approval',item})),...plannerEvents.map(item=>({type:'planner',item}))]:items.map(item=>({type:kind,item}));
      const rowMarkup=({type,item})=>type==='dependencies'
        ? `<button type="button" class="rw-context-row" data-task="${esc(item.id)}"><i class="rw-context-dot waiting"></i><span><strong>${esc(item.title)}</strong><small>${esc(item.waitingOn||item.status||'Waiting')}</small></span><span class="rw-context-arrow">›</span></button>`
        : type==='approval'
          ? `<button type="button" class="rw-context-row" data-task="${esc(item.task)}"><i class="rw-context-dot approval"></i><span><strong>${esc(item.title||item.type||'Approval request')}</strong><small>${esc(item.status||'Pending')} · ${esc(item.requestedBy?user(item.requestedBy).name:'Requester')}</small></span><span class="rw-context-arrow">›</span></button>`
          : `<button type="button" class="rw-context-row" ${item.task?`data-task="${esc(item.regularWorkTaskId||item.task)}"`:item.id?`data-cal-event="${esc(item.id)}"`:''}><i class="rw-context-dot planner"></i><span><strong>${esc(item.title||'Planner event')}</strong><small>${item.date?fmtDate(item.date):'Scheduled'}${item.start?` · ${esc(item.start)}`:''}</small></span><span class="rw-context-arrow">›</span></button>`;
      return `<section class="rw-context-card"><div class="rw-context-head"><div><h3>${title}</h3><p>${subtitle}</p></div>${kind==='planner'||kind==='approvals'?'<button type="button" class="link-btn" data-nav="planner">Open Planner →</button>':''}</div>${rows.length?`<div class="rw-context-list">${rows.map(rowMarkup).join('')}</div>`:`<div class="rw-context-empty">${emptyText}</div>`}</section>`;
    };
    const approvalsAndPlanner=approvals.length?approvals:plannerEvents;
    return `<div class="regular-mywork"><div class="rw-toolbar"><div class="rw-toolbar-tabs">${filterBar()}</div><div class="rw-toolbar-actions"><label class="rw-search"><span aria-hidden="true">⌕</span><input id="regularWorkSearch" type="search" value="${esc(regularSearch)}" placeholder="Search folders, categories, tasks" aria-label="Search folders, categories, and tasks"></label><div class="rw-actions"><button type="button" class="btn btn-ghost" id="createRegularFolder">+ New Folder</button><button type="button" class="btn btn-ghost" data-create-regular-category>+ New Category</button></div></div></div><div class="metrics rw-metrics">${metrics.map((value,index)=>`<div class="metric ${['red','amber','sage','indigo'][index]||''}"><div class="metric-label">${metricLabels[index]}</div><div class="metric-value">${value}</div></div>`).join('')}</div><div class="rw-workspace"><aside class="rw-folder-panel"><div class="rw-panel-heading"><div><h2>Regular Work</h2><p>Your folders / topics</p></div><span class="rw-count-badge">${folders.length} folder${folders.length===1?'':'s'}</span></div><div class="rw-folder-list">${folderList||`<div class="rw-empty-nav"><strong>${query?'No matching folders':'No folders yet'}</strong><span>${query?'Try another search.':'Create folders for ongoing responsibilities.'}</span>${!query?'<button class="btn btn-soft" id="createFirstRegularFolder">+ Create First Folder</button>':''}</div>`}</div></aside><div class="rw-detail-column">${taskArea}<div class="rw-context-grid">${contextCard('Cross-team dependencies','Work that is waiting on a person, input, or blocker.',dependencies.slice(0,4),'No cross-team dependencies right now.','dependencies')}${contextCard('Approvals & Planner','Existing task approvals and scheduled work.',approvalsAndPlanner,'No linked approvals or Planner items yet.',approvals.length?'approvals':'planner')}</div></div></div>${assignedOutside.length?`<section class="rw-assigned-outside"><div class="rw-section-heading"><div><h2>Regular Work assigned to me</h2><p>Task access only; Folder and Category ownership remains with its owner.</p></div><span>${assignedOutside.length} task${assignedOutside.length===1?'':'s'}</span></div>${regularTaskTable(assignedOutside)}</section>`:''}</div>`;
  }
  function renderLegacyRegularWorkArea(){
    const query=regularSearch.trim().toLowerCase(),allTasks=activeTasks();
    const folders=activeFolders().filter(folder=>!query||`${folder.name} ${folder.description||''}`.toLowerCase().includes(query)||activeCategories().some(category=>category.folderId===folder.id&&`${category.name} ${category.description||''}`.toLowerCase().includes(query))||allTasks.some(task=>(task.folderId||task.regularFolderId)===folder.id&&`${task.title} ${task.regularCategoryName||''}`.toLowerCase().includes(query)));
    const assigned=allTasks.filter(task=>task.owner===state.currentUser&&(!query||`${task.title} ${task.regularFolderName||''} ${task.regularCategoryName||''}`.toLowerCase().includes(query))),visibleIds=new Set();
    folders.forEach(folder=>taskListForFolder(folder).forEach(task=>visibleIds.add(task.id)));
    const folderCards=folders.filter(isFolderOwner).map(folder=>{
      const categories=activeCategories().filter(category=>category.folderId===folder.id),active=folder.status!=='archived';
      return `<article class="regular-folder-card ${active?'':'regular-archived'}"><div class="regular-folder-head"><div><span class="eyebrow">REGULAR WORK FOLDER</span><h3>${esc(folder.name)}</h3>${folder.description?`<p>${esc(folder.description)}</p>`:''}<small>${folder.status==='archived'?'Archived':'Active'} · ${categories.length} categor${categories.length===1?'y':'ies'}</small></div>${isFolderOwner(folder)?`<div class="regular-folder-actions"><button class="btn btn-ghost" data-edit-folder="${esc(folder.id)}">Edit</button>${active?`<button class="btn btn-ghost" data-new-category="${esc(folder.id)}">+ Category</button><button class="btn btn-ghost" data-archive-folder="${esc(folder.id)}">Archive</button>`:''}</div>`:''}</div><div class="regular-category-grid">${categories.map(category=>{const tasks=taskListForFolder(folder,category),canCreate=isFolderOwner(folder)&&active&&category.status==='active';return `<section class="regular-category-card ${category.status==='archived'?'regular-archived':''}"><div class="regular-category-head"><div><h4>${esc(category.name)}</h4>${category.description?`<p>${esc(category.description)}</p>`:''}<small>${tasks.length} task${tasks.length===1?'':'s'}</small></div>${isFolderOwner(folder)&&category.status==='active'?`<div class="regular-category-actions"><button class="btn btn-ghost" data-edit-category="${esc(category.id)}">Edit</button><button class="btn btn-ghost" data-archive-category="${esc(category.id)}">Archive</button></div>`:''}</div>${canCreate?`<button class="btn btn-soft" data-new-regular-task="${esc(folder.id)}" data-category="${esc(category.id)}">+ New Task</button>`:''}${regularTaskTable(tasks)}</section>`}).join('')||'<div class="empty compact"><strong>No categories yet</strong>Create a category to organise regular responsibilities.</div>'}</div></article>`;
    }).join('');
    const outside=assigned.filter(task=>!visibleIds.has(task.id));
    return `<div class="section-row regular-work-heading"><div><h2>Regular Work</h2><p>Organise responsibilities that are not tied to a Project.</p></div><div class="filters"><input class="input" id="regularWorkSearch" type="search" value="${esc(regularSearch)}" placeholder="Search folders, categories, tasks"><button class="btn btn-soft" id="createRegularFolder">+ Create Folder</button></div></div>${!folders.length&&!allTasks.length?`<div class="panel"><div class="empty regular-work-empty"><strong>Organise your regular work</strong><span>Create folders and categories for responsibilities that are not tied to a project.</span><button class="btn btn-soft" id="createFirstRegularFolder">+ Create First Folder</button></div></div>`:''}${folderCards}${outside.length?`<div class="section-row"><div><h2>Regular Work assigned to me</h2><p>Task access only; Folder and Category ownership remains with its owner.</p></div></div>${regularTaskTable(outside)}`:''}`;
  }
  const baseOpenFolderForm=openFolderForm;
  openFolderForm=function(existing=null){
    baseOpenFolderForm(existing);
    const form=el('regularFolderForm');if(!form)return;
    form.onsubmit=async event=>{
      event.preventDefault();const fields=new FormData(form),name=String(fields.get('name')||'').trim();if(!name)return toast('Folder name is required.');
      const now=new Date().toISOString(),description=String(fields.get('description')||'').trim(),status=String(fields.get('status')||'active');
      const folder=existing||{id:uniqueId('rwf'),ownerUid:authUid(),ownerUserId:state.currentUser,createdByUid:authUid(),createdBy:state.currentUser,createdAt:now};
      const before=existing?{...existing}:null,patch={...folder,name,description,status,archived:status==='archived',archivedAt:status==='archived'?(folder.archivedAt||now):null,archivedByUid:status==='archived'?(folder.archivedByUid||authUid()):null,updatedAt:now,updatedBy:state.currentUser,updatedByUid:authUid()};
      const apply=()=>{Object.assign(folder,patch);if(!existing)state.regularWorkFolders.push(folder)};
      const restore=()=>{if(existing)Object.assign(existing,before);else state.regularWorkFolders=state.regularWorkFolders.filter(item=>item.id!==folder.id)};
      if(!await saveOrRestore(form,apply,restore,()=>window.firebaseHub.saveRegularWorkFolder(folder.ownerUid,folder.id,patch)))return;
      if(!existing){selectedRegularFolderId=folder.id;selectedRegularCategoryId=''}
      closeRegularModal();render();toast(existing?'Folder updated.':'Folder created.');
    };
  };
  const baseOpenCategoryForm=openCategoryForm;
  openCategoryForm=function(folder=null,existing=null){
    baseOpenCategoryForm(folder,existing);
    const form=el('regularCategoryForm');if(!form)return;
    form.onsubmit=async event=>{
      event.preventDefault();const fields=new FormData(form),name=String(fields.get('name')||'').trim();if(!name)return toast('Category name is required.');
      const selectedFolder=existing?activeFolders().find(item=>item.id===existing.folderId):activeFolders().find(item=>item.id===String(fields.get('folderId')||''));
      if(!selectedFolder||!isFolderOwner(selectedFolder)||selectedFolder.status==='archived')return toast('Choose an active Folder you own.');
      const now=new Date().toISOString(),description=String(fields.get('description')||'').trim(),rawStatus=String(fields.get('status')||existing?.status||'Pending');
      const status=['Pending','In Progress','Completed'].includes(rawStatus)?rawStatus:'Pending';
      const category=existing||{id:uniqueId('rwc'),ownerUid:selectedFolder.ownerUid,ownerUserId:selectedFolder.ownerUserId,folderId:selectedFolder.id,createdByUid:authUid(),createdBy:state.currentUser,createdAt:now};
      const before=existing?{...existing}:null,patch={...category,name,description,status,updatedAt:now,updatedBy:state.currentUser,updatedByUid:authUid()};
      const apply=()=>{Object.assign(category,patch);if(!existing)state.regularWorkCategories.push(category)};
      const restore=()=>{if(existing)Object.assign(existing,before);else state.regularWorkCategories=state.regularWorkCategories.filter(item=>item.id!==category.id)};
      if(!await saveOrRestore(form,apply,restore,()=>window.firebaseHub.saveRegularWorkCategory(category.ownerUid,category.id,patch)))return;
      selectedRegularFolderId=selectedFolder.id;selectedRegularCategoryId=category.id;
      closeRegularModal();render();toast(existing?'Category updated.':'Category created.');
    };
  };
  function openParentTaskForm(existing){
    if(!existing||!canManageParentTask(existing))return toast('Only the Folder owner or System Admin can edit this task.');
    const people=state.users.filter(person=>person.active!==false);
    const opts=(values,current)=>values.map(value=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(value)}</option>`).join('');
    openRegularModal('Edit Regular Work Task',`<form id="regularParentTaskForm" class="form-stack"><label class="form-field"><span>Task Title</span><input class="input" name="title" maxlength="160" required value="${esc(existing.title)}"></label><div class="form-grid"><label class="form-field"><span>Priority</span><select class="select" name="priority">${opts(['P0','P1','P2','P3'],existing.priority||'P2')}</select></label><label class="form-field"><span>Assigned To</span><select class="select" name="owner">${people.map(person=>`<option value="${esc(person.id)}" ${person.id===existing.owner?'selected':''}>${esc(person.name)}</option>`).join('')}</select></label><label class="form-field"><span>Due Date</span><input class="input" type="date" name="currentDue" value="${esc(existing.currentDue||'')}"></label></div><div class="form-grid"><label class="form-field"><span>Waiting On</span><input class="input" name="waitingOn" value="${esc(existing.waitingOn||'')}"></label><label class="form-field"><span>Next Action</span><input class="input" name="next" value="${esc(existing.next||'')}"></label></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelRegularModal">Cancel</button><button type="submit" class="btn btn-soft">Save Task</button></div></form>`);
    el('cancelRegularModal').onclick=closeRegularModal;
    el('regularParentTaskForm').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),title=String(fields.get('title')||'').trim();if(!title)return toast('Task title is required.');const before={...existing},now=new Date().toISOString(),patch={title,priority:String(fields.get('priority')),owner:String(fields.get('owner')),currentDue:String(fields.get('currentDue')||''),waitingOn:String(fields.get('waitingOn')||'').trim(),next:String(fields.get('next')||'').trim(),updatedAt:now,updatedByUid:authUid()};const apply=()=>Object.assign(existing,{...patch,updatedBy:state.currentUser});const restore=()=>Object.assign(existing,before);if(!await saveOrRestore(form,apply,restore,()=>window.firebaseHub.saveRegularWorkTask(existing.id,patch)))return;closeRegularModal();render();toast('Task updated.');};
  }
  function archiveParentTask(item){
    if(!item||!canManageParentTask(item))return toast('Only the Folder owner or System Admin can archive this task.');
    confirmRegularAction(`Archive “${item.title}”?`,'This task, comments, approvals, Planner links, and activity will be retained.',async()=>{const before={...item},now=new Date().toISOString();Object.assign(item,{archived:true,archivedAt:now,archivedByUid:authUid(),updatedAt:now,updatedByUid:authUid()});try{await window.firebaseHub.saveRegularWorkTask(item.id,{archived:true,archivedAt:now,archivedByUid:authUid(),updatedAt:now,updatedByUid:authUid()});closeRegularModal();render();toast('Task archived.')}catch(error){Object.assign(item,before);console.error('Could not archive Regular Work task:',error);toast('Changes could not be saved. Please try again.')}});
  }
  function openTaskMenu(item){
    if(!item||!canManageParentTask(item))return;
    openRegularModal('Task actions',`<div class="form-stack"><button type="button" class="btn btn-ghost" id="editRegularParentTask">Edit Task</button><button type="button" class="btn btn-ghost" id="archiveRegularParentTask">Archive Task</button><button type="button" class="btn btn-ghost" id="deleteRegularParentTask">Delete Task</button><div class="form-help">Tasks with work history are archived, never permanently deleted.</div></div>`);
    el('editRegularParentTask').onclick=()=>openParentTaskForm(item);el('archiveRegularParentTask').onclick=()=>archiveParentTask(item);el('deleteRegularParentTask').onclick=()=>deleteRegularWorkTask(item);
  }
  async function deleteEmptyStructureRecord(collection,item){
    const hasChildren=collection==='folders'
      ? activeCategories().some(category=>category.folderId===item.id)||state.tasks.some(task=>(task.folderId||task.regularFolderId)===item.id)
      : state.tasks.some(task=>(task.categoryId||task.regularCategoryId)===item.id);
    if(hasChildren)return toast('This item contains existing work/history and cannot be permanently deleted. Archive it instead.');
    confirmRegularAction(`Delete “${item.name}”?`,'This empty item will be permanently deleted.',async()=>{try{await window.firebaseHub.deleteEmptyRegularWorkRecord(collection,item.ownerUid,item.id);if(collection==='folders')state.regularWorkFolders=state.regularWorkFolders.filter(value=>value.id!==item.id);else state.regularWorkCategories=state.regularWorkCategories.filter(value=>value.id!==item.id);closeRegularModal();render();toast(`${collection==='folders'?'Folder':'Category'} deleted.`)}catch(error){console.error('Could not delete empty Regular Work record:',error);toast('Changes could not be saved. Please try again.')}});
  }
  function deleteRegularWorkTask(item){
    if(!item||!canManageParentTask(item))return;
    confirmRegularAction(`Delete ${item.title}?`,'Tasks with comments, approvals, Planner links, or activity are retained as deleted records; empty tasks are removed.',async()=>{try{await window.firebaseHub.deleteRegularWorkTask(item.id,false);state.tasks=state.tasks.filter(value=>value.id!==item.id);closeRegularModal();render();toast('Task deleted.')}catch(error){console.error('Could not delete Regular Work task:',error);toast(error?.message||'Task could not be deleted.')}});
  }
  async function changeCategoryStatus(category,nextStatus,select){
    if(!category||!['Pending','In Progress','Completed'].includes(nextStatus)||!isFolderOwner(activeFolders().find(folder=>folder.id===category.folderId)))return;
    const before={...category},now=new Date().toISOString();if(before.status===nextStatus)return;
    if(select)select.disabled=true;
    Object.assign(category,{status:nextStatus,updatedAt:now,updatedBy:state.currentUser,updatedByUid:authUid()});
    try{
      const saved=await window.firebaseHub.saveRegularWorkCategory(category.ownerUid,category.id,{status:nextStatus,updatedAt:now,updatedBy:state.currentUser,updatedByUid:authUid()});
      Object.assign(category,saved);refreshRegularContent();toast(`Category status changed to ${nextStatus}.`);
    }catch(error){Object.assign(category,before);console.error('Could not save Regular Work Category status:',error);refreshRegularContent();toast('Category status could not be saved. Please try again.');}
  }
  function openRegularApprovalForm(parentTask){
    if(!parentTask||!canManageParentTask(parentTask))return toast('Only the Folder owner, task creator, or System Admin can send this task for approval.');
    const authorized=new Set([parentTask.owner,parentTask.createdBy,parentTask.folderOwnerUserId,...(parentTask.accessUserIds||[])].filter(Boolean));
    const approvers=state.users.filter(person=>person.active!==false&&person.id!==state.currentUser&&authorized.has(person.id));
    if(!approvers.length)return toast('No other authorized task collaborator is available to approve this task.');
    openRegularModal('Send for Approval',`<form id="regularApprovalForm" class="form-stack"><div class="form-help">Request a formal review of “${esc(parentTask.title)}” from an existing task collaborator. The task remains active until the approval is handled.</div><label class="form-field"><span>Approver</span><select class="select" name="approver" required>${approvers.map(person=>`<option value="${esc(person.id)}" ${person.id===(parentTask.reviewer||'')?'selected':''}>${esc(person.name)}</option>`).join('')}</select></label><label class="form-field"><span>What should they review?</span><textarea class="textarea" name="detail" required placeholder="Describe the decision or deliverable to review."></textarea></label><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelRegularApproval">Cancel</button><button type="submit" class="btn btn-soft">Send for Approval</button></div></form>`);
    el('cancelRegularApproval').onclick=closeRegularModal;
    const form=el('regularApprovalForm');form.onsubmit=async event=>{
      event.preventDefault();const fields=new FormData(form),approver=String(fields.get('approver')||''),detail=String(fields.get('detail')||'').trim();if(!detail)return toast('Add review details before sending.');
      const now=new Date().toISOString(),approval={id:uniqueId('a'),task:parentTask.id,contextType:'regular_work',type:'Deliverable Review',title:parentTask.title,requestedBy:state.currentUser,approvers:[approver],approverIds:{[approver]:true},approvalMode:'all',status:'Pending',priority:parentTask.priority==='P0'||parentTask.priority==='P1'?'High':'Normal',requestedAt:now,dueAt:new Date(Date.now()+2*86400000).toISOString(),detail,version:1,blocking:false,autoComplete:false,decisions:{},comments:[],rounds:[]};
      setSaving(form,true);
      try{const saved=await window.firebaseHub.saveRegularWorkApproval(approval);state.approvals.unshift(saved);closeRegularModal();render();openTask(parentTask.id);toast('Approval request sent and recorded.');}
      catch(error){console.error('Could not send Regular Work approval:',error);toast(error?.message||'Approval request could not be sent. Please try again.');}
      finally{setSaving(form,false)}
    };
  }
  function deleteStructureRecord(collection,item){
    const hasChildren=collection==='folders'
      ?state.regularWorkCategories.some(category=>category.folderId===item.id)||state.tasks.some(task=>(task.folderId||task.regularFolderId)===item.id)||(state.activity||[]).some(value=>value.regularFolderId===item.id||value.folderId===item.id)
      :state.tasks.some(task=>(task.categoryId||task.regularCategoryId)===item.id)||(state.activity||[]).some(value=>value.regularCategoryId===item.id||value.categoryId===item.id);
    const label=collection==='folders'?'Folder':'Category';
    confirmRegularAction(`Delete ${item.name}?`,hasChildren?`${label} history will be retained and hidden from active Regular Work.`:`This empty ${label} will be permanently deleted.`,async()=>{try{await window.firebaseHub.deleteRegularWorkStructureRecord(collection,item.ownerUid,item.id,hasChildren);if(collection==='folders')state.regularWorkFolders=state.regularWorkFolders.filter(value=>value.id!==item.id);else state.regularWorkCategories=state.regularWorkCategories.filter(value=>value.id!==item.id);closeRegularModal();render();toast(`${label} deleted.`)}catch(error){console.error('Could not delete Regular Work record:',error);toast(error?.message||`${label} could not be deleted.`)}});
  }
  function openFolderMenu(item){
    if(!item||!isFolderOwner(item))return;
    openRegularModal('Folder actions',`<div class="form-stack"><button type="button" class="btn btn-ghost" id="rwMenuEditFolder">Edit Folder</button>${item.status==='archived'?'':`<button type="button" class="btn btn-ghost" id="rwMenuArchiveFolder">Archive Folder</button>`}<button type="button" class="btn btn-ghost" id="rwMenuDeleteFolder">Delete Folder</button></div>`);
    el('rwMenuEditFolder').onclick=()=>openFolderForm(item);const archive=el('rwMenuArchiveFolder');if(archive)archive.onclick=()=>{closeRegularModal();const trigger=document.querySelector(`[data-archive-folder="${CSS.escape(item.id)}"]`);if(trigger)trigger.click()};el('rwMenuDeleteFolder').onclick=()=>deleteStructureRecord('folders',item);
  }
  function openCategoryMenu(item){
    const folder=activeFolders().find(value=>value.id===item?.folderId);if(!item||!folder||!isFolderOwner(folder))return;
    openRegularModal('Category actions',`<div class="form-stack"><button type="button" class="btn btn-ghost" id="rwMenuEditCategory">Edit Category</button><button type="button" class="btn btn-ghost" id="rwMenuArchiveCategory">${categoryArchived(item)?'Restore':'Archive'} Category</button><button type="button" class="btn btn-ghost" id="rwMenuDeleteCategory">Delete Category</button></div>`);
    el('rwMenuEditCategory').onclick=()=>openCategoryForm(folder,item);
    el('rwMenuArchiveCategory').onclick=async()=>{const now=new Date().toISOString(),archived=!categoryArchived(item),before={...item};Object.assign(item,{archived,archivedAt:archived?now:null,archivedByUid:archived?authUid():null,updatedAt:now,updatedByUid:authUid()});try{await window.firebaseHub.saveRegularWorkCategory(item.ownerUid,item.id,{archived,archivedAt:item.archivedAt,archivedByUid:item.archivedByUid,updatedAt:now,updatedByUid:authUid()});closeRegularModal();render();toast(archived?'Category archived. Tasks and history were retained.':'Category restored.') }catch(error){Object.assign(item,before);console.error('Could not archive Regular Work Category:',error);toast('Category could not be updated. Please try again.')}};
    el('rwMenuDeleteCategory').onclick=()=>deleteStructureRecord('categories',item);
  }
  function mountVisibleRegularWorkMenus(){
    // The focused Regular Work renderer uses a folder list rather than legacy cards.
    // Add controls after every render, so this is the final DOM rather than a stale phase template.
    document.querySelectorAll('.rw-folder-item[data-select-folder]').forEach(row=>{const item=activeFolders().find(value=>value.id===row.dataset.selectFolder);if(!item||!isFolderOwner(item)||row.querySelector('[data-folder-menu]'))return;row.insertAdjacentHTML('beforeend',`<span role="button" tabindex="0" class="rw-ellipsis rw-structure-menu" data-folder-menu="${esc(item.id)}" aria-label="Actions for folder ${esc(item.name)}">⋯</span>`)});
    const selected=activeCategories().find(value=>value.id===selectedRegularCategoryId);const categoryHeader=document.querySelector('.rw-selected-category .rw-category-title');if(selected&&categoryHeader&&isFolderOwner(activeFolders().find(value=>value.id===selected.folderId))&&!categoryHeader.querySelector('[data-category-menu]'))categoryHeader.insertAdjacentHTML('beforeend',`<button type="button" class="rw-ellipsis rw-structure-menu" data-category-menu="${esc(selected.id)}" aria-label="Actions for category ${esc(selected.name)}">⋯</button>`);
  }
  function bindRegularWork(){
    mountVisibleRegularWorkMenus();
    document.querySelectorAll('.my-work-filter').forEach(button=>button.onclick=()=>{workFilter=button.dataset.workFilter;render()});
    document.querySelectorAll('#createRegularFolder,#createFirstRegularFolder').forEach(button=>button.onclick=()=>openFolderForm());
    const search=el('regularWorkSearch');if(search)search.oninput=()=>{regularSearch=search.value;refreshRegularContent()};
    document.querySelectorAll('[data-select-folder]').forEach(button=>button.onclick=()=>{selectedRegularFolderId=button.dataset.selectFolder;selectedRegularCategoryId='';refreshRegularContent()});
    document.querySelectorAll('[data-select-category]').forEach(button=>button.onclick=()=>{selectedRegularCategoryId=button.dataset.selectCategory;refreshRegularContent()});
    document.querySelectorAll('[data-create-regular-category],#createRegularCategory,#createEmptyRegularCategory').forEach(button=>button.onclick=()=>{const folder=activeFolders().find(item=>item.id===selectedRegularFolderId)||null;openCategoryForm(folder)});
    const createTask=el('createRegularTask');if(createTask)createTask.onclick=()=>{const folderId=createTask.dataset.folderId||selectedRegularFolderId,categoryId=createTask.dataset.categoryId||selectedRegularCategoryId,folder=activeFolders().find(item=>item.id===folderId),category=activeCategories().find(item=>item.id===categoryId&&item.folderId===folder?.id&&!categoryArchived(item));if(!folder||folder.status==='archived'||!category)return toast('Select an active Folder and Category before creating a task.');window.openRegularWorkTaskCreate?.(folder,category)};
    document.querySelectorAll('[data-category-status]').forEach(select=>select.onchange=()=>changeCategoryStatus(activeCategories().find(item=>item.id===select.dataset.categoryStatus),select.value,select));
    document.querySelectorAll('[data-edit-folder]').forEach(button=>button.onclick=()=>openFolderForm(activeFolders().find(folder=>folder.id===button.dataset.editFolder)));
    document.querySelectorAll('[data-new-category]').forEach(button=>button.onclick=()=>openCategoryForm(activeFolders().find(folder=>folder.id===button.dataset.newCategory)));
    document.querySelectorAll('[data-edit-category]').forEach(button=>button.onclick=()=>{const category=activeCategories().find(item=>item.id===button.dataset.editCategory);openCategoryForm(activeFolders().find(folder=>folder.id===category?.folderId),category)});
    document.querySelectorAll('[data-edit-folder]').forEach(button=>{const folder=activeFolders().find(item=>item.id===button.dataset.editFolder);if(!folder||button.parentElement.querySelector('[data-delete-folder]'))return;button.insertAdjacentHTML('afterend',`<button class="btn btn-ghost" data-delete-folder="${esc(folder.id)}">Delete</button>`)});
    document.querySelectorAll('[data-edit-category]').forEach(button=>{const category=activeCategories().find(item=>item.id===button.dataset.editCategory);if(!category||button.parentElement.querySelector('[data-delete-category]'))return;button.insertAdjacentHTML('afterend',`<button class="btn btn-ghost" data-delete-category="${esc(category.id)}">Delete</button>`)});
    document.querySelectorAll('[data-delete-folder]').forEach(button=>button.onclick=()=>{const item=activeFolders().find(value=>value.id===button.dataset.deleteFolder);if(item)deleteStructureRecord('folders',item)});
    document.querySelectorAll('[data-delete-category]').forEach(button=>button.onclick=()=>{const item=activeCategories().find(value=>value.id===button.dataset.deleteCategory);if(item)deleteStructureRecord('categories',item)});
    document.querySelectorAll('[data-task-menu]').forEach(button=>button.onclick=event=>{event.stopPropagation();openTaskMenu(activeTasks().find(item=>item.id===button.dataset.taskMenu))});
    document.querySelectorAll('[data-folder-menu]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();openFolderMenu(activeFolders().find(item=>item.id===button.dataset.folderMenu))});
    document.querySelectorAll('[data-folder-menu]').forEach(button=>button.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();button.click()}});
    document.querySelectorAll('[data-category-menu]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();openCategoryMenu(activeCategories().find(item=>item.id===button.dataset.categoryMenu))});
    document.querySelectorAll('[data-archive-folder]').forEach(button=>button.onclick=()=>{const folder=activeFolders().find(item=>item.id===button.dataset.archiveFolder);if(!folder||!isFolderOwner(folder))return;confirmRegularAction(`Archive “${folder.name}”?`,'This folder and its Categories and historical Tasks will be retained.',async()=>{const before={...folder},now=new Date().toISOString();Object.assign(folder,{status:'archived',archived:true,archivedAt:now,archivedByUid:authUid(),updatedAt:now,updatedByUid:authUid()});try{await window.firebaseHub.saveRegularWorkFolder(folder.ownerUid,folder.id,{status:'archived',archived:true,archivedAt:now,archivedByUid:authUid(),updatedAt:now,updatedByUid:authUid()});closeRegularModal();render();toast('Folder archived. Tasks and history were retained.')}catch(error){Object.assign(folder,before);console.error('Could not archive folder:',error);toast('Changes could not be saved. Please try again.')}})});
    document.querySelectorAll('[data-archive-category]').forEach(button=>button.onclick=()=>openCategoryMenu(activeCategories().find(item=>item.id===button.dataset.archiveCategory)));
    document.querySelectorAll('[data-new-regular-task]').forEach(button=>button.onclick=()=>{const folder=activeFolders().find(item=>item.id===button.dataset.newRegularTask),category=activeCategories().find(item=>item.id===button.dataset.category);window.openRegularWorkTaskCreate?.(folder,category)});
    document.querySelectorAll('.regular-mywork [data-task]').forEach(button=>button.onclick=event=>{event.stopPropagation();openTask(button.dataset.task)});
    document.querySelectorAll('.regular-mywork [data-regular-task-row]').forEach(row=>row.onclick=event=>{if(event.target.closest('button,a,input,select,textarea'))return;openTask(row.dataset.regularTaskRow)});
  }
  function refreshRegularContent(){
    if(workFilter==='project')return;
    const content=el('content'),search=content.querySelector('#regularWorkSearch'),active=search===document.activeElement,selection=active?[search.selectionStart,search.selectionEnd]:null;
    const area=content.querySelector('#regularWorkArea');if(!area)return;
    area.innerHTML=renderRegularWorkArea();wireDynamic();
    const next=el('regularWorkSearch');if(active&&next){next.focus();next.setSelectionRange(...selection)}
  }
  const baseRenderMyWork=renderMyWork;
  renderMyWork=function(){
    if(workFilter==='regular'){
      const userName=String(user(state.currentUser)?.name||'').trim()||'Team Member';
      setTitle('My Work',userName.toUpperCase());
      const content=el('content');content.innerHTML=`<div id="regularWorkArea">${renderRegularWorkArea()}</div>`;bindRegularWork();return;
    }
    baseRenderMyWork();
    const content=el('content'),split=content.querySelector('.role-split'),metrics=content.querySelector('.metrics');if(!metrics)return;
    const tabs=document.createElement('div');tabs.innerHTML=filterBar();(split||metrics).insertAdjacentElement('afterend',tabs.firstElementChild);
    const projects=visibleProjectTasks(),regular=assignedRegularTasks();
    const selected=workFilter==='project'?projects:workFilter==='regular'?regular:[...new Map([...projects,...regular].map(task=>[task.id,task])).values()];
    updateMyWorkMetrics(selected);
    if(workFilter==='project'){bindRegularWork();return}
    content.insertAdjacentHTML('beforeend',`<div id="regularWorkArea">${renderLegacyRegularWorkArea()}</div>`);bindRegularWork();
  };

  const baseWireDynamic=wireDynamic;
  wireDynamic=function(){baseWireDynamic();bindRegularWork()};

  const baseRender=render;
  render=function(search=''){
    baseRender(search);
    document.body.classList.toggle('regular-work-focus',activeView==='mywork'&&workFilter==='regular');
    if(activeView==='mywork'){
      const tabs=el('content')?.querySelector('.regular-work-filter');
      if(tabs)tabs.querySelectorAll('.my-work-filter').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.workFilter===workFilter)));
    }
  };

  function regularWorkSearchResults(query){
    const q=String(query||'').trim().toLowerCase();
    if(!q)return null;
    const folders=activeFolders().filter(folder=>`${folder.name} ${folder.description||''}`.toLowerCase().includes(q));
    const categories=activeCategories().filter(category=>`${category.name} ${category.description||''}`.toLowerCase().includes(q));
    const tasks=activeTasks().filter(task=>`${task.title} ${task.regularFolderName||''} ${task.regularCategoryName||''}`.toLowerCase().includes(q));
    return {folders,categories,tasks};
  }
  window.searchRegularWork=query=>regularWorkSearchResults(query);
  const baseLog=log;
  log=function(uid,projectId,taskId,type,text,change=''){
    baseLog(uid,projectId,taskId,type,text,change);
    const event=state.activity?.[0];if(!event)return;
    const task=taskId?state.tasks.find(item=>item.id===taskId&&item.contextType==='regular_work'):null;
    if(task){event.contextType='regular_work';event.folderId=task.folderId||task.regularFolderId;event.regularFolderId=event.folderId;event.categoryId=task.categoryId||task.regularCategoryId;event.regularCategoryId=event.categoryId;event.ownerUid=task.folderOwnerUid;event.regularWorkTaskId=task.id}
  };
  const baseOpenTaskDrawer=openTask;
  openTask=function(id){
    baseOpenTaskDrawer(id);
    const parentTask=task(id);if(!parentTask||parentTask.contextType!=='regular_work'||!window.firebaseHub?.canAccessRegularWorkTask(id)){document.body.classList.remove('regular-task-drawer');return}
    document.body.classList.add('regular-task-drawer');
    const body=el('drawerBody'),drawerHead=el('taskDrawer').querySelector('.drawer-head > div');
    const category=categoryForTask(parentTask),folder=folderForTask(parentTask);
    el('drawerEyebrow').textContent=`REGULAR WORK · ${String(category?.name||parentTask.regularCategoryName||parentTask.workstream||'CATEGORY').toUpperCase()}`;
    el('drawerTitle').textContent=parentTask.title;
    let folderSubtitle=drawerHead.querySelector('.rw-task-folder-subtitle');
    if(!folderSubtitle){folderSubtitle=document.createElement('p');folderSubtitle.className='rw-task-folder-subtitle';el('drawerTitle').insertAdjacentElement('afterend',folderSubtitle)}
    folderSubtitle.textContent=folder.name||parentTask.regularFolderName||'Regular Work';

    const sections=[...body.querySelectorAll('.drawer-section')];
    const statusSection=sections[0],taskDetails=sections.find(section=>section.querySelector('h4')?.textContent==='Task details');
    const updateSection=sections.find(section=>section.querySelector('h4')?.textContent==='Update work');
    const commentSection=sections.find(section=>section.querySelector('h4')?.textContent==='Comments');
    const activitySection=sections.find(section=>section.querySelector('h4')?.textContent==='Activity history'||section.querySelector('h4')?.textContent==='Activity');
    const statusName=parentTask.status==='Not Started'?'Pending':parentTask.status||'Pending';
    const priorityNames={P0:'P0 · Critical',P1:'P1 · High',P2:'P2 · Medium',P3:'P3 · Low'};
    const waiting=parentTask.waitingOn?(String(parentTask.waitingOn).startsWith('u')?user(parentTask.waitingOn).name:parentTask.waitingOn):'—';
    const grid=document.createElement('section');grid.className='drawer-section rw-task-info-section';
    grid.innerHTML=`<h4>Task Details</h4><div class="rw-task-info-grid"><div class="rw-task-info-card"><span>FOLDER</span><strong>${esc(folder.name||'Regular Work')}</strong></div><div class="rw-task-info-card"><span>CATEGORY</span><strong>${esc(category?.name||parentTask.regularCategoryName||'—')}</strong></div><div class="rw-task-info-card"><span>STATUS</span><strong>${esc(statusName)}</strong></div><div class="rw-task-info-card"><span>PRIORITY</span><strong>${esc(priorityNames[parentTask.priority]||parentTask.priority||'—')}</strong></div><div class="rw-task-info-card"><span>ASSIGNED TO</span><strong>${esc(user(parentTask.owner).name)}</strong></div><div class="rw-task-info-card"><span>DUE</span><strong>${parentTask.currentDue?fmtDate(parentTask.currentDue):'—'}</strong></div><div class="rw-task-info-card"><span>WAITING ON</span><strong>${esc(waiting)}</strong></div><div class="rw-task-info-card"><span>NEXT ACTION</span><strong>${esc(parentTask.next||'—')}</strong></div></div>`;
    if(statusSection)statusSection.replaceWith(grid);else body.prepend(grid);
    if(taskDetails)taskDetails.remove();

    const plannerButton=body.querySelector('.schedule-task-btn');
    let approvalButton=body.querySelector('.send-approval-task');
    if(!approvalButton){approvalButton=document.createElement('button');approvalButton.type='button';approvalButton.className='btn btn-ghost send-approval-task rw-task-action-button rw-approval-action';approvalButton.textContent='◎ Send for Approval'}
    const deadlineRequest=updateSection?.querySelector('.deadline-request');
    const reassignment=updateSection?.querySelector('.regular-reassign-row');
    const actionSection=document.createElement('section');actionSection.className='drawer-section rw-task-actions-section';
    const actionRow=document.createElement('div');actionRow.className='rw-task-action-row';
    if(plannerButton){plannerButton.textContent='▣ Schedule on Planner';plannerButton.classList.add('rw-task-action-button','rw-schedule-action');actionRow.appendChild(plannerButton)}
    approvalButton.textContent='◎ Send for Approval';approvalButton.classList.add('rw-task-action-button','rw-approval-action');actionRow.appendChild(approvalButton);
    approvalButton.onclick=()=>openRegularApprovalForm(parentTask);
    const updateToggle=document.createElement('button');updateToggle.type='button';updateToggle.className='btn btn-ghost rw-task-action-button rw-update-toggle';updateToggle.textContent='Update Status';updateToggle.setAttribute('aria-label','Update Status');
    const updateMenu=document.createElement('div');updateMenu.className='rw-update-status-menu';updateMenu.setAttribute('role','group');updateMenu.setAttribute('aria-label','Task status options');updateMenu.hidden=true;
    const currentStatus=parentTask.status==='Not Started'?'Pending':parentTask.status||'Pending';
    const statusOptions=window.regularWorkTaskStatus?.statusOptions||['Pending','In Progress','Working','On Hold','Ready for Review','Completed','Discarded'];
    updateMenu.innerHTML=statusOptions.map(status=>`<button type="button" class="btn ${status===currentStatus?'btn-soft':'btn-ghost'} status-update ${status===currentStatus?'selected':''}" data-task="${esc(id)}" data-status="${esc(status)}" aria-pressed="${status===currentStatus}" ${status===currentStatus?'data-current-status="true"':''}>${status==='Completed'?'✓ ':status==='Discarded'?'× ':''}${esc(status)}</button>`).join('');
    updateMenu.querySelectorAll('.status-update').forEach(button=>button.onclick=async()=>{
      await updateStatus(id,button.dataset.status);
      if(task(id)?.status===button.dataset.status){updateMenu.hidden=true;updateToggle.setAttribute('aria-expanded','false')}
    });
    const secondaryActions=document.createElement('div');secondaryActions.className='rw-task-secondary-actions';
    if(deadlineRequest)secondaryActions.appendChild(deadlineRequest);
    if(reassignment)secondaryActions.appendChild(reassignment);
    updateToggle.setAttribute('aria-expanded','false');updateToggle.setAttribute('aria-haspopup','true');updateToggle.onclick=()=>{updateMenu.hidden=!updateMenu.hidden;updateToggle.setAttribute('aria-expanded',String(!updateMenu.hidden))};
    updateToggle.setAttribute('aria-controls',`rw-status-menu-${esc(id)}`);updateMenu.id=`rw-status-menu-${esc(id)}`;
    actionRow.appendChild(updateToggle);actionSection.append(actionRow,updateMenu);
    if(secondaryActions.childElementCount)actionSection.appendChild(secondaryActions);
    if(updateSection)updateSection.replaceWith(actionSection);else grid.insertAdjacentElement('afterend',actionSection);

    body.querySelector('.task-approval-section')?.classList.add('rw-hidden-extra-section');
    if(commentSection){commentSection.classList.add('rw-comments-section');const heading=commentSection.querySelector('h4');if(heading)heading.textContent='Comments'}
    const commentInput=el('newComment'),commentButton=el('addComment');if(commentInput)commentInput.placeholder='Add a comment...';if(commentButton)commentButton.textContent='Add';
    const commentBox=commentSection?.querySelector('.comment-box');if(commentBox)commentSection.appendChild(commentBox);
    if(activitySection){activitySection.classList.add('rw-activity-section');const heading=activitySection.querySelector('h4');if(heading)heading.textContent='Activity'}
  };
  el('closeDrawer').addEventListener('click',()=>document.body.classList.remove('regular-task-drawer'));
  el('drawerBackdrop').addEventListener('click',()=>document.body.classList.remove('regular-task-drawer'));

  const globalSearch=el('globalSearch');
  if(globalSearch)globalSearch.addEventListener('input',()=>{
    const query=globalSearch.value.trim();if(query.length<2){document.querySelector('.regular-search-results')?.remove();return}
    const matches=regularWorkSearchResults(query),target=el('content');if(!target||!matches)return;
    target.querySelector('.regular-search-results')?.remove();
    const html=`<section class="regular-search-results"><div class="section-row"><div><h2>Regular Work search</h2><p>Authorized Regular Work matches only.</p></div></div>${matches.folders.length?`<div class="regular-search-group"><h3>Folders</h3>${matches.folders.map(folder=>`<button class="regular-search-result" data-regular-search-folder="${esc(folder.id)}">${esc(folder.name)}</button>`).join('')}</div>`:''}${matches.categories.length?`<div class="regular-search-group"><h3>Categories</h3>${matches.categories.map(category=>`<button class="regular-search-result" data-regular-search-category="${esc(category.id)}">${esc(category.name)}</button>`).join('')}</div>`:''}${matches.tasks.length?`<div class="regular-search-group"><h3>Tasks</h3>${matches.tasks.map(task=>`<button class="regular-search-result" data-task="${esc(task.id)}">${esc(task.title)} <small>Regular Work · ${esc(task.regularFolderName)} · ${esc(task.regularCategoryName)}</small></button>`).join('')}</div>`:''}</section>`;
    target.insertAdjacentHTML('beforeend',html);
    target.querySelectorAll('[data-regular-search-folder],[data-regular-search-category]').forEach(button=>button.onclick=()=>{const folderId=button.dataset.regularSearchFolder||activeCategories().find(category=>category.id===button.dataset.regularSearchCategory)?.folderId;if(folderId)selectedRegularFolderId=folderId;if(button.dataset.regularSearchCategory)selectedRegularCategoryId=button.dataset.regularSearchCategory;workFilter='regular';regularSearch=query;activeView='mywork';render()});
    target.querySelectorAll('.regular-search-results [data-task]').forEach(button=>button.onclick=()=>openTask(button.dataset.task));
  });
})();
