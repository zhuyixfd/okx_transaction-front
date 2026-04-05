import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'

/** 与登录页写入的 key 保持一致 */
export const AUTH_TOKEN_KEY = 'okx_token'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'follow',
      component: HomeView,
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/detail/:uniqueName',
      name: 'followDetail',
      component: () => import('../views/FollowDetailView.vue'),
      props: true,
    },
    {
      path: '/contract-trade',
      name: 'contractTrade',
      component: () => import('../views/ContractTradeView.vue'),
    },
    {
      path: '/okx-api-accounts',
      name: 'okxApiAccounts',
      component: () => import('../views/OkxApiAccountsView.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null

  if (to.path === '/login') {
    if (token) return { path: '/' }
    return
  }

  if (!token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
})

export default router
