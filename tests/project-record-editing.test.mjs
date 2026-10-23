import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../phase21.js', import.meta.url), 'utf8');
const firebase = readFileSync(new URL('../firebase-bootstrap.js', import.meta.url), 'utf8');

test('category and task rows expose compact edit actions', () => {
  assert.match(ui, /data-category-menu/);
  assert.match(ui, /Edit Category/);
  assert.match(ui, /Change Owner/);
  assert.match(ui, /data-task-menu/);
  assert.match(ui, /Edit Task/);
  assert.match(ui, /Update Status/);
  assert.match(ui, /Delete \/ Archive/);
});

test('edit forms contain the requested fields and permission gates', () => {
  for (const label of ['Category Name', 'Category Owner', 'Task Title', 'Category', 'Assigned To / Owner', 'Priority', 'Due Date', 'Next Action', 'Description']) assert.match(ui, new RegExp(label.replace('/', '\\/')));
  assert.match(ui, /canManageCategory/);
  assert.match(ui, /canManageTask/);
  assert.match(ui, /p\?\.projectLead===state\.currentUser/);
});

test('Firebase edits are targeted, await read-back, and preserve immutable records', () => {
  assert.match(firebase, /async updateProjectCategory\(projectId, categoryId, patch\)/);
  assert.match(firebase, /async updateProjectTask\(taskId, patch\)/);
  assert.match(firebase, /await update\(ref\(database\), updates\)/);
  assert.match(firebase, /const readBack = await get\(ref\(database, taskPath\)\)/);
  assert.doesNotMatch(firebase.match(/async updateProjectTask[\s\S]*?async saveRegularWorkComment/)?.[0] || '', /allowed = \[[^\]]*createdAt/);
  assert.match(ui, /catch\(error\).*showError\(form,error\)/s);
});

test('project category resolver supports current and legacy storage without name identity', () => {
  assert.match(firebase, /function resolveProjectCategory\(project, categoryId\)/);
  assert.match(firebase, /\['workstreams', 'categories'\]/);
  assert.match(firebase, /category\.id, category\.categoryId, category\.legacyId, category\.workstreamId/);
  const updateCategory = firebase.match(/async updateProjectCategory[\s\S]*?async updateProjectTask/)?.[0] || '';
  assert.match(updateCategory, /resolveProjectCategory\(currentProject, categoryId\)/);
  assert.match(updateCategory, /currentProject\[categoryCollection\]/);
  assert.doesNotMatch(updateCategory, /task\.workstream === category\?\.name/);
  assert.doesNotMatch(updateCategory, /projectId.*category\?\.name/);
});
