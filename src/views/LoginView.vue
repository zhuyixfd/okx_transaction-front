<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  'http://localhost:8000'

const handleLogin = async () => {
  error.value = ''
  loading.value = true
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      error.value = data.detail || '登录失败'
      return
    }

    if (!data.token) {
      error.value = '服务端未返回 token'
      return
    }

    localStorage.setItem('okx_token', data.token)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    const safe =
      redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
    router.replace(safe)
  } catch (e: any) {
    error.value = e?.message || '请求失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="card">
      <h1 class="title">登录</h1>
      <div class="field">
        <label for="username">用户名</label>
        <input
          id="username"
          v-model="username"
          type="text"
          autocomplete="username"
          placeholder="请输入用户名"
        />
      </div>

      <div class="field">
        <label for="password">密码</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="请输入密码"
          @keyup.enter="handleLogin"
        />
      </div>

      <div class="actions">
        <button class="btn" type="button" :disabled="loading" @click="handleLogin">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </div>

      <div v-if="error" class="err">{{ error }}</div>
      <div class="hint">请使用已在数据库中创建的用户登录。</div>
    </div>
  </div>
</template>

<style scoped>
/* 由 App.vue 的 .login-shell 负责视口内居中，此处仅占位宽度 */
.page {
  width: 100%;
  max-width: 420px;
}

.card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
  padding: 22px 20px;
  width: 100%;
  box-sizing: border-box;
}

.title {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
}

.field {
  margin-bottom: 12px;
}

label {
  display: block;
  font-size: 13px;
  opacity: 0.9;
  margin-bottom: 8px;
}

input {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  padding: 10px 12px;
  background: var(--color-background);
  color: var(--color-text);
  outline: none;
}

.actions {
  margin-top: 14px;
}

.btn {
  width: 100%;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  color: var(--color-text);
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 700;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.err {
  margin-top: 10px;
  color: #b00020;
  font-size: 13px;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.7;
  line-height: 1.4;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    'Liberation Mono', 'Courier New', monospace;
}
</style>

