<script setup>
import { computed } from 'vue'
import { useRoute, RouterLink, RouterView } from 'vue-router'

const route = useRoute()
const isLoginPage = computed(() => route.name === 'login')
</script>

<template>
  <!-- 登录：独立全屏，无导航栏 -->
  <div v-if="isLoginPage" class="login-shell">
    <RouterView />
  </div>

  <!-- 业务页：侧栏 + 跟单帐户 / 交易记录 / 配置信息 -->
  <div v-else class="app-shell">
    <aside class="sidebar">
      <nav class="nav">
        <RouterLink class="nav-item" to="/" end>
          跟单帐户
        </RouterLink>
        <RouterLink class="nav-item" to="/records">
          交易记录
        </RouterLink>
        <RouterLink class="nav-item" to="/settings">
          配置信息
        </RouterLink>
      </nav>
    </aside>

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

.app-shell {
  min-height: 100vh;
  display: flex;
  background: var(--color-background);
}

.sidebar {
  width: 220px;
  border-right: 1px solid var(--color-border);
  padding: 16px;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nav-item {
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--color-text);
  text-decoration: none;
}

.nav-item.router-link-active {
  background: var(--color-background-mute);
  border: 1px solid var(--color-border-hover);
}

.content {
  flex: 1;
  padding: 24px;
}
</style>
