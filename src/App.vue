<script setup>
import { computed } from 'vue'
import { useRoute, RouterView } from 'vue-router'

const route = useRoute()
const isLoginPage = computed(() => route.name === 'login')
const isFollowDetail = computed(() => route.name === 'followDetail')
</script>

<template>
  <!-- 登录：独立全屏，无导航栏 -->
  <div v-if="isLoginPage" class="login-shell">
    <RouterView />
  </div>

  <!-- 跟单详情：无主导航，页面自管左侧用户列表 -->
  <div v-else-if="isFollowDetail" class="follow-detail-shell">
    <RouterView />
  </div>

  <!-- 业务页：跟单帐户主页（无侧栏） -->
  <div v-else class="app-shell">
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.login-shell {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 24px;
  background: var(--color-background);
}

.follow-detail-shell {
  min-height: 100vh;
  width: 100%;
  background: var(--color-background);
}

.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
}

.content {
  flex: 1;
  min-width: 0;
  padding: 24px;
}
</style>
