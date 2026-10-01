/* Execution Hub – Phase 1.9 Regular Work, using the shared Task engine */
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const authUid=()=>window.firebaseHub?.firebaseUid||'';
  const isAdmin=()=>!!window.firebaseHub?.isSystemAdmin();
  const activeTasks=()=>state.tasks.filter(task=>task.contextType==='regular_work'&&window.firebaseHub?.canAccessRegularWorkTask(task.id));
  const activeFolders=()=>Array.isArray(state.regularWorkFolders)?state.regularWorkFolders:[];
  const activeCategories=()=>Array.isArray(state.regularWorkCategories)?state.regularWorkCategories:[];
  let workFilter='all';
  let regularSearch='';
  let selectedRegularFolderId='';
  let selectedRegularCategoryId='';
  const dailyTasksByParent=new Map();
  function notifyDailyTasksUpdated(parentTaskId){window.dispatchEvent(new CustomEvent('regular-daily-tasks-updated',{detail:{parentTaskId,records:dailyTasksByParent.get(parentTaskId)||[]}}))}

  function closeRegularModal(){el('modalBackdrop').classList.remove('open');el('modalBody').innerHTML=''}
  function openRegularModal(title,html){el('modalTitle').textContent=title;el('modalBody').innerHTML=html;el('modalBackdrop').classList.add('open')}
  function uniqueId(prefix){return `${prefix}${Date.now()}${Math.floor(Math.random()*100000)}`}
  function isFolderOwner(folder){return isAdmin()||folder?.ownerUid===authUid()}
  function categoryForTask(task){return activeCategories().find(category=>category.id===task.regularCategoryId)}
  function folderForTask(task){return activeFolders().find(folder=>folder.id===task.regularFolderId)||{id:task.regularFolderId,name:task.regularFolderName||'Regular Work',ownerUid:task.folderOwnerUid,status:'active'}}
  function assignedRegularTasks(){return activeTasks().filter(task=>task.owner===state.currentUser)}
  function visibleProjectTasks(){
    const projectIds=new Set(state.projects.filter(project=>isAdmin()||project.projectLead===state.currentUser||(project.team||[]).includes(state.currentUser)).map(project=>project.id));
    return state.tasks.filter(task=>task.contextType!=='regular_work'&&task.project&&projectIds.has(task.project)&&task.owner===state.currentUser);
  }
  function taskMetrics(tasks){
    return [
      tasks.length,
      tasks.filter(isOverdue).length,
      tasks.filter(task=>{const days=daysDiff(task.currentDue);return days>=0&&days<=7}).length,
      tasks.filter(task=>task.status==='Ready for Review').length,
      tasks.filter(task=>task.waitingOn||['Waiting','Blocked'].includes(task.status)).length,
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
  function statusCell(task){return `<span class="status-pill ${isOverdue(task)?'overdue':task.status==='Completed'?'completed':task.status==='Waiting'||task.status==='Blocked'?'waiting':task.status==='Ready for Review'?'review':'on-track'}">${isOverdue(task)?'Overdue':esc(task.status)}</span>`}
  function regularTaskRow(task){
    const folder=folderForTask(task),category=categoryForTask(task);
    const priority=String(task.priority||'').toLowerCase();
    return `<tr data-regular-task-row="${esc(task.id)}"><td><button class="task-link" data-task="${esc(task.id)}">${esc(task.title)}</button><div class="subtle">Regular Work · ${esc(folder.name)} · ${esc(category?.name||task.regularCategoryName||task.workstream||'')}</div></td><td>${esc(user(task.owner).name)}</td><td><span class="priority-pill ${esc(priority)}">${esc(task.priority||'—')}</span></td><td>${statusCell(task)}</td><td>${task.currentDue?fmtDate(task.currentDue):'—'}${task.originalDue&&task.originalDue!==task.currentDue?`<div class="subtle">Original ${fmtDate(task.originalDue)}</div>`:''}</td><td>${esc(task.next||'')}</td></tr>`;
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
      auditRegularStructure(`${edit?'edited':'created'} Regular Work Folder ${name}`,change,folder);
      await save();closeRegularModal();render();toast(edit?'Folder updated.':'Folder created.');
    };
  }
  function openCategoryForm(folder=null,existing=null){
    const manageableFolders=activeFolders().filter(item=>isFolderOwner(item)&&item.status!=='archived');
    if(existing)folder=activeFolders().find(item=>item.id===existing.folderId)||folder;
    if(!manageableFolders.length)return toast('Create or select an active Folder before adding a Category.');
    if(!folder)folder=manageableFolders.find(item=>item.id===selectedRegularFolderId)||null;
    if(folder&&(!isFolderOwner(folder)||folder.status==='archived'))return toast('Only the owner of an active Folder can manage its categories.');
    const edit=!!existing;
    const folderField=edit||folder
      ? `<div class="regular-category-parent"><span>Parent Folder</span><strong>${esc(folder.name)}</strong><input type="hidden" name="folderId" value="${esc(folder.id)}"></div>`
      : `<label class="form-field"><span>Parent Folder</span><select class="select" name="folderId" required>${manageableFolders.map(item=>`<option value="${esc(item.id)}" ${item.id===selectedRegularFolderId?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label>`;
    openRegularModal(edit?'Edit Category':'Create Category',`<form id="regularCategoryForm" class="form-stack"><div class="form-grid">${folderField}<label class="form-field"><span>Category Name</span><input class="input" name="name" required maxlength="100" value="${edit?esc(existing.name):''}" placeholder="Category name"></label>${edit?`<label class="form-field"><span>Status</span><select class="select" name="status"><option value="active" ${existing.status==='active'?'selected':''}>Active</option><option value="archived" ${existing.status==='archived'?'selected':''}>Archived</option></select></label>`:''}</div><label class="form-field"><span>Description</span><textarea class="textarea" name="description" placeholder="Optional context">${edit?esc(existing.description||''):''}</textarea></label><div class="form-help">Category ownership follows the Folder owner.</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelRegularModal">Cancel</button><button class="btn btn-soft" type="submit">${edit?'Save Category':'Save'}</button></div></form>`);
    el('cancelRegularModal').onclick=closeRegularModal;
    el('regularCategoryForm').onsubmit=async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),name=String(form.get('name')||'').trim();if(!name)return toast('Category name is required.');
      const selectedFolder=edit?folder:manageableFolders.find(item=>item.id===String(form.get('folderId')||''));if(!selectedFolder||!isFolderOwner(selectedFolder)||selectedFolder.status==='archived')return toast('Choose an active Folder you own.');
      const now=new Date().toISOString(),description=String(form.get('description')||'').trim(),status=String(form.get('status')||'active');
      let category=existing,change=`Folder: ${selectedFolder.name} • Status: ${status}`;
      if(edit){const oldName=existing.name;existing.name=name;existing.description=description;existing.status=status;existing.updatedAt=now;existing.updatedBy=state.currentUser;change=`${oldName} → ${name} • Folder: ${selectedFolder.name} • Status: ${status}`}
      else{category={id:uniqueId('rwc'),folderId:selectedFolder.id,name,description,ownerUid:selectedFolder.ownerUid,ownerUserId:selectedFolder.ownerUserId,createdByUid:authUid(),createdBy:state.currentUser,createdAt:now,status:'active'};state.regularWorkCategories.push(category);selectedRegularFolderId=selectedFolder.id;selectedRegularCategoryId=category.id}
      auditRegularStructure(`${edit?'edited':'created'} Regular Work Category ${name}`,change,selectedFolder,category);
      await save();closeRegularModal();render();toast(edit?'Category updated.':'Category created.');
    };
  }
  function taskListForFolder(folder,category){
    return activeTasks().filter(task=>task.regularFolderId===folder.id&&(!category||task.regularCategoryId===category.id)).sort((a,b)=>(a.currentDue||'').localeCompare(b.currentDue||''));
  }
  function renderRegularWorkArea(){
    const query=regularSearch.trim().toLowerCase();
    const allTasks=activeTasks();
    const folders=activeFolders().filter(folder=>!query||`${folder.name} ${folder.description||''}`.toLowerCase().includes(query)||activeCategories().some(category=>category.folderId===folder.id&&`${category.name} ${category.description||''}`.toLowerCase().includes(query))||allTasks.some(task=>task.regularFolderId===folder.id&&`${task.title} ${task.regularCategoryName||''}`.toLowerCase().includes(query)));
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
    const openCount=folderTasks.filter(task=>task.status!=='Completed').length;
    const selectedCanManage=!!selectedFolder&&isFolderOwner(selectedFolder),folderActive=selectedFolder?.status!=='archived';
    const dependencies=allTasks.filter(task=>task.waitingOn||['Waiting','Blocked'].includes(task.status));
    const selectedTaskIds=new Set(allTasks.map(task=>task.id));
    const approvals=(state.approvals||[]).filter(approval=>selectedTaskIds.has(approval.task)).slice(0,4);
    const plannerEvents=(state.calendarEvents||[]).filter(event=>selectedTaskIds.has(event.regularWorkTaskId||event.task)).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).slice(0,3);
    const folderList=folders.map(folder=>{
      const count=activeCategories().filter(category=>category.folderId===folder.id).length;
      const taskCount=taskListForFolder(folder).filter(task=>task.status!=='Completed').length;
      return `<button type="button" class="rw-folder-item ${folder.id===selectedFolder?.id?'selected':''} ${folder.status==='archived'?'archived':''}" data-select-folder="${esc(folder.id)}" aria-pressed="${folder.id===selectedFolder?.id}"><span class="rw-folder-copy"><strong>${esc(folder.name)}</strong><span>${esc(folder.description||'No description')}</span><small>${count} categor${count===1?'y':'ies'}${taskCount?` · ${taskCount} open`:''}</small></span><span class="rw-folder-arrow">›</span></button>`;
    }).join('');
    const categoryChips=folderCategories.map(category=>{
      const count=taskListForFolder(selectedFolder,category).length;
      return `<button type="button" class="rw-category-chip ${category.id===selectedCategory?.id?'selected':''} ${category.status==='archived'?'archived':''}" data-select-category="${esc(category.id)}" aria-pressed="${category.id===selectedCategory?.id}">${esc(category.name)}<span>${count}</span></button>`;
    }).join('');
    const folderActions=selectedFolder&&selectedCanManage?`<div class="rw-detail-actions"><button class="btn btn-ghost" data-edit-folder="${esc(selectedFolder.id)}">Edit folder</button>${folderActive?`<button class="btn btn-ghost" data-archive-folder="${esc(selectedFolder.id)}">Archive</button>`:''}</div>`:'';
    const taskArea=!selectedFolder
      ? `<div class="empty rw-empty"><strong>${query?'No matching Regular Work':'Organise your regular work'}</strong><span>${query?'No authorized Folder, Category, or Task matched your search.':'Create folders and categories for responsibilities that are not tied to a project.'}</span>${!query?'<button class="btn btn-soft" id="createFirstRegularFolder">+ Create First Folder</button>':''}</div>`
      : `<div class="rw-folder-detail ${folderActive?'':'regular-archived'}"><div class="rw-detail-top"><div><span class="eyebrow">${selectedFolder.status==='archived'?'ARCHIVED FOLDER':'REGULAR WORK FOLDER'}</span><h2>${esc(selectedFolder.name)}</h2><p>${esc(selectedFolder.description||'Responsibilities not tied to a Project.')}</p></div><div class="rw-detail-meta"><span class="rw-open-count">${openCount} open task${openCount===1?'':'s'}</span>${folderActions}</div></div><div class="rw-category-bar"><div class="rw-category-chips">${categoryChips||'<span class="rw-no-categories">No categories yet</span>'}</div>${selectedCanManage&&folderActive?'<button class="btn btn-soft" id="createRegularCategory">+ New Category</button>':''}</div>${selectedCategory?`<section class="rw-selected-category"><div class="rw-category-title"><h3>${esc(selectedCategory.name)}</h3></div>${selectedCategory.status==='archived'?'<div class="rw-inline-note">This category is archived. Historical tasks remain available.</div>':''}${regularTaskTable(selectedTasks)}</section>`:`<div class="empty compact rw-empty-category"><strong>No categories yet</strong><span>Create a category to organise this folder.</span>${selectedCanManage&&folderActive?'<button class="btn btn-soft" id="createEmptyRegularCategory">+ Create Category</button>':''}</div>`}</div>`;
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
    return `<div class="regular-mywork"><div class="rw-toolbar"><div class="rw-toolbar-tabs">${filterBar()}</div><div class="rw-toolbar-actions"><label class="rw-search"><span aria-hidden="true">⌕</span><input id="regularWorkSearch" type="search" value="${esc(regularSearch)}" placeholder="Search folders, categories, tasks" aria-label="Search folders, categories, and tasks"></label><div class="rw-actions"><button type="button" class="btn btn-ghost" id="createRegularFolder">+ New Folder</button><button type="button" class="btn btn-ghost" data-create-regular-category>+ New Category</button><button type="button" class="btn btn-soft" id="createRegularTask">+ New Task</button></div></div></div><div class="metrics rw-metrics">${metrics.map((value,index)=>`<div class="metric ${['red','amber','sage','indigo'][index]||''}"><div class="metric-label">${metricLabels[index]}</div><div class="metric-value">${value}</div></div>`).join('')}</div><div class="rw-workspace"><aside class="rw-folder-panel"><div class="rw-panel-heading"><div><h2>Regular Work</h2><p>Your folders / topics</p></div><span class="rw-count-badge">${folders.length} folder${folders.length===1?'':'s'}</span></div><div class="rw-folder-list">${folderList||`<div class="rw-empty-nav"><strong>${query?'No matching folders':'No folders yet'}</strong><span>${query?'Try another search.':'Create folders for ongoing responsibilities.'}</span>${!query?'<button class="btn btn-soft" id="createFirstRegularFolder">+ Create First Folder</button>':''}</div>`}</div></aside><div class="rw-detail-column">${taskArea}<div class="rw-context-grid">${contextCard('Cross-team dependencies','Work that is waiting on a person, input, or blocker.',dependencies.slice(0,4),'No cross-team dependencies right now.','dependencies')}${contextCard('Approvals & Planner','Existing task approvals and scheduled work.',approvalsAndPlanner,'No linked approvals or Planner items yet.',approvals.length?'approvals':'planner')}</div></div></div>${assignedOutside.length?`<section class="rw-assigned-outside"><div class="rw-section-heading"><div><h2>Regular Work assigned to me</h2><p>Task access only; Folder and Category ownership remains with its owner.</p></div><span>${assignedOutside.length} task${assignedOutside.length===1?'':'s'}</span></div>${regularTaskTable(assignedOutside)}</section>`:''}</div>`;
  }
  function renderLegacyRegularWorkArea(){
    const query=regularSearch.trim().toLowerCase(),allTasks=activeTasks();
    const folders=activeFolders().filter(folder=>!query||`${folder.name} ${folder.description||''}`.toLowerCase().includes(query)||activeCategories().some(category=>category.folderId===folder.id&&`${category.name} ${category.description||''}`.toLowerCase().includes(query))||allTasks.some(task=>task.regularFolderId===folder.id&&`${task.title} ${task.regularCategoryName||''}`.toLowerCase().includes(query)));
    const assigned=allTasks.filter(task=>task.owner===state.currentUser&&(!query||`${task.title} ${task.regularFolderName||''} ${task.regularCategoryName||''}`.toLowerCase().includes(query))),visibleIds=new Set();
    folders.forEach(folder=>taskListForFolder(folder).forEach(task=>visibleIds.add(task.id)));
    const folderCards=folders.filter(isFolderOwner).map(folder=>{
      const categories=activeCategories().filter(category=>category.folderId===folder.id),active=folder.status!=='archived';
      return `<article class="regular-folder-card ${active?'':'regular-archived'}"><div class="regular-folder-head"><div><span class="eyebrow">REGULAR WORK FOLDER</span><h3>${esc(folder.name)}</h3>${folder.description?`<p>${esc(folder.description)}</p>`:''}<small>${folder.status==='archived'?'Archived':'Active'} · ${categories.length} categor${categories.length===1?'y':'ies'}</small></div>${isFolderOwner(folder)?`<div class="regular-folder-actions"><button class="btn btn-ghost" data-edit-folder="${esc(folder.id)}">Edit</button>${active?`<button class="btn btn-ghost" data-new-category="${esc(folder.id)}">+ Category</button><button class="btn btn-ghost" data-archive-folder="${esc(folder.id)}">Archive</button>`:''}</div>`:''}</div><div class="regular-category-grid">${categories.map(category=>{const tasks=taskListForFolder(folder,category),canCreate=isFolderOwner(folder)&&active&&category.status==='active';return `<section class="regular-category-card ${category.status==='archived'?'regular-archived':''}"><div class="regular-category-head"><div><h4>${esc(category.name)}</h4>${category.description?`<p>${esc(category.description)}</p>`:''}<small>${tasks.length} task${tasks.length===1?'':'s'}</small></div>${isFolderOwner(folder)&&category.status==='active'?`<div class="regular-category-actions"><button class="btn btn-ghost" data-edit-category="${esc(category.id)}">Edit</button><button class="btn btn-ghost" data-archive-category="${esc(category.id)}">Archive</button></div>`:''}</div>${canCreate?`<button class="btn btn-soft" data-new-regular-task="${esc(folder.id)}" data-category="${esc(category.id)}">+ New Task</button>`:''}${regularTaskTable(tasks)}</section>`}).join('')||'<div class="empty compact"><strong>No categories yet</strong>Create a category to organise regular responsibilities.</div>'}</div></article>`;
    }).join('');
    const outside=assigned.filter(task=>!visibleIds.has(task.id));
    return `<div class="section-row regular-work-heading"><div><h2>Regular Work</h2><p>Organise responsibilities that are not tied to a Project.</p></div><div class="filters"><input class="input" id="regularWorkSearch" type="search" value="${esc(regularSearch)}" placeholder="Search folders, categories, tasks"><button class="btn btn-soft" id="createRegularFolder">+ Create Folder</button></div></div>${!folders.length&&!allTasks.length?`<div class="panel"><div class="empty regular-work-empty"><strong>Organise your regular work</strong><span>Create folders and categories for responsibilities that are not tied to a project.</span><button class="btn btn-soft" id="createFirstRegularFolder">+ Create First Folder</button></div></div>`:''}${folderCards}${outside.length?`<div class="section-row"><div><h2>Regular Work assigned to me</h2><p>Task access only; Folder and Category ownership remains with its owner.</p></div></div>${regularTaskTable(outside)}`:''}`;
  }
  function bindRegularWork(){
    document.querySelectorAll('.my-work-filter').forEach(button=>button.onclick=()=>{workFilter=button.dataset.workFilter;render()});
    document.querySelectorAll('#createRegularFolder,#createFirstRegularFolder').forEach(button=>button.onclick=()=>openFolderForm());
    const search=el('regularWorkSearch');if(search)search.oninput=()=>{regularSearch=search.value;refreshRegularContent()};
    document.querySelectorAll('[data-select-folder]').forEach(button=>button.onclick=()=>{selectedRegularFolderId=button.dataset.selectFolder;selectedRegularCategoryId='';refreshRegularContent()});
    document.querySelectorAll('[data-select-category]').forEach(button=>button.onclick=()=>{selectedRegularCategoryId=button.dataset.selectCategory;refreshRegularContent()});
    document.querySelectorAll('[data-create-regular-category],#createRegularCategory,#createEmptyRegularCategory').forEach(button=>button.onclick=()=>{const folder=activeFolders().find(item=>item.id===selectedRegularFolderId)||null;openCategoryForm(folder)});
    const createTask=el('createRegularTask');if(createTask)createTask.onclick=()=>{const folder=activeFolders().find(item=>item.id===selectedRegularFolderId),category=activeCategories().find(item=>item.id===selectedRegularCategoryId&&item.folderId===folder?.id&&item.status==='active');if(!folder||folder.status==='archived'||!category)return toast('Select an active Folder and Category before creating a task.');window.openRegularWorkTaskCreate?.(folder,category)};
    document.querySelectorAll('[data-edit-folder]').forEach(button=>button.onclick=()=>openFolderForm(activeFolders().find(folder=>folder.id===button.dataset.editFolder)));
    document.querySelectorAll('[data-new-category]').forEach(button=>button.onclick=()=>openCategoryForm(activeFolders().find(folder=>folder.id===button.dataset.newCategory)));
    document.querySelectorAll('[data-edit-category]').forEach(button=>button.onclick=()=>{const category=activeCategories().find(item=>item.id===button.dataset.editCategory);openCategoryForm(activeFolders().find(folder=>folder.id===category?.folderId),category)});
    document.querySelectorAll('[data-archive-folder]').forEach(button=>button.onclick=async()=>{const folder=activeFolders().find(item=>item.id===button.dataset.archiveFolder);if(!folder||!isFolderOwner(folder)||!confirm(`Archive ${folder.name}? Its Categories and historical Tasks will remain.`))return;folder.status='archived';folder.updatedAt=new Date().toISOString();auditRegularStructure(`archived Regular Work Folder ${folder.name}`,'Status: archived',folder);await save();render();toast('Folder archived. Tasks and history were retained.')});
    document.querySelectorAll('[data-archive-category]').forEach(button=>button.onclick=async()=>{const category=activeCategories().find(item=>item.id===button.dataset.archiveCategory),folder=activeFolders().find(item=>item.id===category?.folderId);if(!category||!folder||!isFolderOwner(folder)||!confirm(`Archive ${category.name}? Its historical Tasks will remain.`))return;category.status='archived';category.updatedAt=new Date().toISOString();auditRegularStructure(`archived Regular Work Category ${category.name}`,`Folder: ${folder.name} • Status: archived`,folder,category);await save();render();toast('Category archived. Tasks and history were retained.')});
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
      setTitle('My Work',user(state.currentUser).name.toUpperCase());
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
    if(task){event.contextType='regular_work';event.folderId=task.regularFolderId;event.regularFolderId=task.regularFolderId;event.categoryId=task.regularCategoryId;event.regularCategoryId=task.regularCategoryId;event.ownerUid=task.folderOwnerUid;event.regularWorkTaskId=task.id}
  };
  function auditRegularStructure(text,change,folder,category=null){
    log(state.currentUser,null,null,'Regular Work',text,change);
    const event=state.activity?.[0];if(event){event.contextType='regular_work';event.ownerUid=folder.ownerUid;event.folderId=folder.id;event.regularFolderId=folder.id;if(category){event.categoryId=category.id;event.regularCategoryId=category.id}}
  }

  function dailyTaskController(parentTask){
    return isAdmin()||parentTask?.createdByUid===authUid()||parentTask?.folderOwnerUid===authUid()||parentTask?.owner===state.currentUser;
  }
  function canEditDailyTask(parentTask,dailyTask){
    return dailyTaskController(parentTask)||dailyTask?.assignedTo===state.currentUser;
  }
  function dailyTaskDateLabel(date){
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}).toUpperCase();
  }
  function dailyTasksSection(parentTask,{loading=false,error=''}={}){
    const records=(dailyTasksByParent.get(parentTask.id)||[]).filter(item=>item.archived!==true).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    const completed=records.filter(item=>item.status==='Completed').length,canManage=dailyTaskController(parentTask);
    const groups=new Map();records.forEach(item=>{const key=item.date||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item)});
    const groupMarkup=[...groups.entries()].map(([date,items])=>{
      const today=date===new Date().toLocaleDateString('en-CA');
      return `<div class="rw-daily-date-group"><h5>${today?'TODAY · ':''}${esc(dailyTaskDateLabel(date))}</h5><div class="rw-daily-list">${items.map(item=>{
        const editable=canEditDailyTask(parentTask,item),isDone=item.status==='Completed';
        return `<article class="rw-daily-row ${isDone?'completed':''}" data-daily-task-id="${esc(item.id)}"><button type="button" class="rw-daily-check ${isDone?'checked':''}" data-toggle-daily-task="${esc(item.id)}" ${editable?'':'disabled'} aria-label="${isDone?'Reopen':'Complete'} ${esc(item.title)}" aria-pressed="${isDone}">${isDone?'✓':''}</button><div class="rw-daily-copy"><strong>${esc(item.title)}</strong><small>${esc(user(item.assignedTo).name)}${item.priority?` · ${esc(item.priority)}`:''}${item.notes?` · ${esc(item.notes)}`:''}</small></div><span class="rw-daily-status ${isDone?'done':item.status==='In Progress'?'in-progress':''}">${esc(item.status||'Not Started')}</span>${editable?`<button type="button" class="rw-daily-edit" data-edit-daily-task="${esc(item.id)}" aria-label="Edit ${esc(item.title)}">Edit</button>`:''}${canManage?`<button type="button" class="rw-daily-archive" data-archive-daily-task="${esc(item.id)}" aria-label="Archive ${esc(item.title)}">×</button>`:''}</article>`;
      }).join('')}</div></div>`;
    }).join('');
    const percentage=records.length?Math.round(completed/records.length*100):0;
    return `<section class="drawer-section rw-daily-section" data-parent-task-id="${esc(parentTask.id)}"><div class="rw-daily-heading"><div><h4>Daily Tasks</h4><p>${completed} of ${records.length} completed</p></div>${canManage?`<button type="button" class="btn btn-soft" data-add-daily-task="${esc(parentTask.id)}">+ Add Daily Task</button>`:''}</div>${records.length?`<div class="rw-daily-progress" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percentage}%"></span></div>`:''}${loading?'<div class="rw-daily-empty">Loading Daily Tasks…</div>':error?`<div class="rw-daily-empty error">${esc(error)}</div>`:records.length?groupMarkup:'<div class="rw-daily-empty">No Daily Tasks yet.</div>'}</section>`;
  }
  function refreshDailyTasksSection(parentTask,options={}){
    const current=document.querySelector('.rw-daily-section');
    if(!current||current.dataset.parentTaskId!==parentTask.id)return;
    current.outerHTML=dailyTasksSection(parentTask,options);
    bindDailyTaskControls(parentTask);
  }
  async function loadDailyTasks(parentTask){
    try{
      const records=await window.firebaseHub.getRegularWorkDailyTasks(parentTask.id);
      dailyTasksByParent.set(parentTask.id,records);
      notifyDailyTasksUpdated(parentTask.id);
      refreshDailyTasksSection(parentTask);
    }catch(error){
      console.error('Could not load Regular Work Daily Tasks:',error);
      refreshDailyTasksSection(parentTask,{error:'Daily Tasks could not be loaded. Check your access and try reopening this task.'});
    }
  }
  function eligibleDailyTaskUsers(parentTask){
    const authorized=new Set([...(parentTask.accessUserIds||[]),parentTask.owner,parentTask.createdBy].filter(Boolean));
    return state.users.filter(account=>account.id!=='u1'&&account.active!==false&&authorized.has(account.id));
  }
  function openDailyTaskForm(parentTask,existing=null){
    const manager=dailyTaskController(parentTask),canUpdate=canEditDailyTask(parentTask,existing);
    if(existing&&!canUpdate)return toast('You cannot edit this Daily Task.');
    if(!existing&&!manager)return toast('Only the parent task owner, creator, or System Admin can add Daily Tasks.');
    const people=eligibleDailyTaskUsers(parentTask),defaultAssigned=existing?.assignedTo||parentTask.owner||state.currentUser;
    const assignedPerson=people.find(account=>account.id===defaultAssigned)||people[0];
    if(manager&&!assignedPerson)return toast('No active, authorized parent-task assignees are available.');
    const today=new Date().toLocaleDateString('en-CA'),statusOptions=['Not Started','In Progress','Completed'];
    const assignedField=manager
      ? `<label class="form-field"><span>Assigned To</span><select class="select" name="assignedTo" required>${people.map(account=>`<option value="${esc(account.id)}" ${account.id===(existing?.assignedTo||assignedPerson?.id)?'selected':''}>${esc(account.name)}</option>`).join('')}</select></label>`
      : `<div class="rw-daily-readonly"><span>Assigned To</span><strong>${esc(user(existing?.assignedTo).name)}</strong></div>`;
    const editableField=(label,name,value,type='text')=>manager?`<label class="form-field"><span>${label}</span><input class="input" name="${name}" type="${type}" value="${esc(value)}" required></label>`:`<div class="rw-daily-readonly"><span>${label}</span><strong>${esc(value)}</strong></div>`;
    openRegularModal(existing?'Edit Daily Task':'Add Daily Task',`<form id="regularDailyTaskForm" class="form-stack"><div class="form-grid">${editableField('Task / Activity Name','title',existing?.title||'')}${editableField('Date','date',existing?.date||today,'date')}${assignedField}<label class="form-field"><span>Status</span><select class="select" name="status" required>${statusOptions.map(status=>`<option value="${status}" ${(existing?.status||'Not Started')===status?'selected':''}>${status}</option>`).join('')}</select></label><label class="form-field"><span>Priority</span><select class="select" name="priority" ${manager?'':'disabled'}>${['P0','P1','P2','P3'].map(priority=>`<option value="${priority}" ${(existing?.priority||parentTask.priority)===priority?'selected':''}>${priority}${priority===parentTask.priority?' · Parent priority':''}</option>`).join('')}</select></label></div>${manager?`<label class="form-field"><span>Notes</span><textarea class="textarea" name="notes" placeholder="Optional notes">${esc(existing?.notes||'')}</textarea></label>`:existing?.notes?`<div class="rw-daily-readonly"><span>Notes</span><strong>${esc(existing.notes)}</strong></div>`:''}<div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelRegularDailyTask">Cancel</button><button type="submit" class="btn btn-soft">Save</button></div></form>`);
    const form=el('regularDailyTaskForm');
    el('cancelRegularDailyTask').onclick=closeRegularModal;
    form.onsubmit=async event=>{
      event.preventDefault();
      const fields=new FormData(form),title=String(fields.get('title')||existing?.title||'').trim(),date=String(fields.get('date')||existing?.date||'');
      if(!title)return toast('Task / Activity Name is required.');
      if(!date)return toast('Date is required.');
      const assignedTo=manager?String(fields.get('assignedTo')||''):existing?.assignedTo;
      const assigned=people.find(account=>account.id===assignedTo);
      if(!assigned||!new Set([...(parentTask.accessUserIds||[]),parentTask.owner,parentTask.createdBy].filter(Boolean)).has(assignedTo))return toast('Choose an active person who already has access to this parent task.');
      const status=String(fields.get('status')||existing?.status||'Not Started'),now=new Date().toISOString();
      const dailyTask={...(existing||{}),id:existing?.id||uniqueId('rwd'),parentTaskId:parentTask.id,title,date,assignedTo,status,priority:manager?String(fields.get('priority')||parentTask.priority||'P2'):existing.priority,notes:manager?String(fields.get('notes')||'').trim():existing.notes||'',createdBy:existing?.createdBy||state.currentUser,createdByUid:existing?.createdByUid||authUid(),createdAt:existing?.createdAt||now,completedAt:status==='Completed'?(existing?.completedAt||now):null,archived:existing?.archived===true,archivedAt:existing?.archivedAt||null,archivedByUid:existing?.archivedByUid||null};
      try{
        await window.firebaseHub.saveRegularWorkDailyTask(parentTask.id,dailyTask);
        const records=dailyTasksByParent.get(parentTask.id)||[],index=records.findIndex(item=>item.id===dailyTask.id);
        if(index<0)records.push(dailyTask);else records[index]=dailyTask;
        dailyTasksByParent.set(parentTask.id,records);
        notifyDailyTasksUpdated(parentTask.id);
        const events=[];
        if(!existing)events.push([`added daily task ${title}`,`${dailyTask.date} · Assigned to ${user(assignedTo).name}`]);
        else{
          if(existing.status!==dailyTask.status)events.push([dailyTask.status==='Completed'?`completed daily task ${title}`:`updated daily task ${title}`,`${existing.status||'Not Started'} → ${dailyTask.status}`]);
          if(existing.assignedTo!==dailyTask.assignedTo)events.push([`reassigned daily task ${title}`,`${user(existing.assignedTo).name} → ${user(dailyTask.assignedTo).name}`]);
          if(existing.date!==dailyTask.date)events.push([`changed date for daily task ${title}`,`${existing.date} → ${dailyTask.date}`]);
          if(!events.length)events.push([`updated daily task ${title}`,'Details updated']);
        }
        events.forEach(([text,change])=>log(state.currentUser,parentTask.project,parentTask.id,'Daily Task',text,change));
        await save();
        closeRegularModal();refreshDailyTasksSection(parentTask);toast(existing?'Daily Task updated.':'Daily Task added.');
      }catch(error){console.error('Could not save Regular Work Daily Task:',error);toast(error?.message||'Daily Task could not be saved. Check your access and try again.')}
    };
  }
  function bindDailyTaskControls(parentTask){
    document.querySelectorAll('[data-add-daily-task]').forEach(button=>button.onclick=()=>openDailyTaskForm(parentTask));
    document.querySelectorAll('[data-edit-daily-task]').forEach(button=>button.onclick=()=>{const existing=(dailyTasksByParent.get(parentTask.id)||[]).find(item=>item.id===button.dataset.editDailyTask);if(existing)openDailyTaskForm(parentTask,existing)});
    document.querySelectorAll('[data-toggle-daily-task]').forEach(button=>button.onclick=async()=>{
      const existing=(dailyTasksByParent.get(parentTask.id)||[]).find(item=>item.id===button.dataset.toggleDailyTask);if(!existing||!canEditDailyTask(parentTask,existing)||existing.archived)return;
      const status=existing.status==='Completed'?'Not Started':'Completed',now=new Date().toISOString(),updated={...existing,status,completedAt:status==='Completed'?(existing.completedAt||now):null};
      try{await window.firebaseHub.saveRegularWorkDailyTask(parentTask.id,updated);dailyTasksByParent.set(parentTask.id,(dailyTasksByParent.get(parentTask.id)||[]).map(item=>item.id===updated.id?updated:item));notifyDailyTasksUpdated(parentTask.id);const action=status==='Completed'?`completed daily task ${existing.title}`:existing.status==='Completed'?`reopened daily task ${existing.title}`:`updated daily task ${existing.title}`;log(state.currentUser,parentTask.project,parentTask.id,'Daily Task',action,`${existing.status} → ${status}`);await save();refreshDailyTasksSection(parentTask)}catch(error){console.error('Could not update Daily Task status:',error);toast(error?.message||'Daily Task status could not be updated.')}
    });
    document.querySelectorAll('[data-archive-daily-task]').forEach(button=>button.onclick=async()=>{
      const existing=(dailyTasksByParent.get(parentTask.id)||[]).find(item=>item.id===button.dataset.archiveDailyTask);if(!existing||!dailyTaskController(parentTask)||!confirm(`Archive “${existing.title}”? It will remain in the task history.`))return;
      const now=new Date().toISOString(),updated={...existing,archived:true,archivedAt:now,archivedByUid:authUid()};
      try{await window.firebaseHub.saveRegularWorkDailyTask(parentTask.id,updated);dailyTasksByParent.set(parentTask.id,(dailyTasksByParent.get(parentTask.id)||[]).map(item=>item.id===updated.id?updated:item));notifyDailyTasksUpdated(parentTask.id);log(state.currentUser,parentTask.project,parentTask.id,'Daily Task',`archived daily task ${existing.title}`,'Daily task archived; record retained');await save();refreshDailyTasksSection(parentTask)}catch(error){console.error('Could not archive Daily Task:',error);toast(error?.message||'Daily Task could not be archived.')}
    });
  }
  const baseOpenTaskDaily=openTask;
  openTask=function(id){
    baseOpenTaskDaily(id);
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
    const statusName=parentTask.status||'—';
    const priorityNames={P0:'P0 · Critical',P1:'P1 · High',P2:'P2 · Medium',P3:'P3 · Low'};
    const waiting=parentTask.waitingOn?(String(parentTask.waitingOn).startsWith('u')?user(parentTask.waitingOn).name:parentTask.waitingOn):'—';
    const grid=document.createElement('section');grid.className='drawer-section rw-task-info-section';
    grid.innerHTML=`<div class="rw-task-info-grid"><div class="rw-task-info-card"><span>STATUS</span><strong>${esc(statusName)}</strong></div><div class="rw-task-info-card"><span>PRIORITY</span><strong>${esc(priorityNames[parentTask.priority]||parentTask.priority||'—')}</strong></div><div class="rw-task-info-card"><span>ASSIGNED TO</span><strong>${esc(user(parentTask.owner).name)}</strong></div><div class="rw-task-info-card"><span>DUE</span><strong>${parentTask.currentDue?fmtDate(parentTask.currentDue):'—'}</strong></div><div class="rw-task-info-card"><span>WAITING ON</span><strong>${esc(waiting)}</strong></div><div class="rw-task-info-card"><span>NEXT ACTION</span><strong>${esc(parentTask.next||'—')}</strong></div></div>`;
    if(statusSection)statusSection.replaceWith(grid);else body.prepend(grid);
    if(taskDetails)taskDetails.remove();

    const plannerButton=body.querySelector('.schedule-task-btn');
    let approvalButton=body.querySelector('.send-approval-task');
    if(!approvalButton){approvalButton=document.createElement('button');approvalButton.type='button';approvalButton.className='btn btn-ghost send-approval-task rw-task-action-button rw-approval-action';approvalButton.textContent='◎ Send for Approval';approvalButton.onclick=()=>updateStatus(id,'Ready for Review')}
    const updateButtons=updateSection?[...updateSection.querySelectorAll('.status-update,.deadline-request,.schedule-task-meeting')]:[];
    const reassignment=updateSection?.querySelector('.regular-reassign-row');
    const actionSection=document.createElement('section');actionSection.className='drawer-section rw-task-actions-section';
    const actionRow=document.createElement('div');actionRow.className='rw-task-action-row';
    if(plannerButton){plannerButton.textContent='▣ Schedule on Planner';plannerButton.classList.add('rw-task-action-button','rw-schedule-action');actionRow.appendChild(plannerButton)}
    approvalButton.textContent='◎ Send for Approval';approvalButton.classList.add('rw-task-action-button','rw-approval-action');actionRow.appendChild(approvalButton);
    const updateToggle=document.createElement('button');updateToggle.type='button';updateToggle.className='btn btn-ghost rw-task-action-button rw-update-toggle';updateToggle.textContent='✓ Update Status';
    const updateMenu=document.createElement('div');updateMenu.className='rw-update-status-menu';updateMenu.hidden=true;
    updateButtons.forEach(button=>updateMenu.appendChild(button));if(reassignment)updateMenu.appendChild(reassignment);
    updateToggle.setAttribute('aria-expanded','false');updateToggle.onclick=()=>{updateMenu.hidden=!updateMenu.hidden;updateToggle.setAttribute('aria-expanded',String(!updateMenu.hidden))};
    actionRow.appendChild(updateToggle);actionSection.append(actionRow,updateMenu);
    if(updateSection)updateSection.replaceWith(actionSection);else grid.insertAdjacentElement('afterend',actionSection);

    body.querySelector('.rw-daily-section')?.remove();
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
