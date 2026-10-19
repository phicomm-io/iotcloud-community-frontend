import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';
import { account, restoreAccount } from './account';
const router = createRouter({
 history: createWebHashHistory(),
 routes: [
  { path: '/local', name: 'Local', component: () => import('./App.vue') },
  { path: '/github', name: 'GitHub', component: () => import('./views/GitHubPage.vue') },
  { path: '/login', name: 'Login', component: () => import('./views/LoginPage.vue') },
  { path: '/', name: 'Console', component: () => import('./App.vue'), meta: { requiresAccount: true } },
  { path: '/guest', name: 'Guest', component: () => import('./App.vue') },
  { path: '/register', name: 'Register', component: () => import('./views/RegisterPage.vue') },
  { path: '/admin', name: 'Admin', component: () => import('./views/AdminPage.vue'), meta: { requiresAccount: true, requiresAdmin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
 ],
});
router.beforeEach(async to => {
 if(import.meta.env.VITE_LOCAL_ONLY==='1' && to.name!=='Local')return {name:'Local'};
 if (to.meta.requiresAccount) {
  await restoreAccount();
  if (!account.username) return { name: 'Login' };
  if (to.meta.requiresAdmin && !account.isAdmin) return { name: 'Console' };
 }
 return true;
});
export default router;
