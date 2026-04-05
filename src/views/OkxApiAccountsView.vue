<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8000'

type OkxRow = {
  id: number
  okx_follow_api_key: string
  okx_follow_secret_key: string
  okx_follow_passphrase: string
  okx_follow_api_label: string | null
  remark: string | null
  created_at: string
  bound_follow_account_id: number | null
  bound_trader_label: string | null
}

const rows = ref<OkxRow[]>([])
const loading = ref(false)
const saving = ref(false)
const err = ref('')
const msg = ref('')

const form = ref({
  okx_follow_api_key: '',
  okx_follow_secret_key: '',
  okx_follow_passphrase: '',
  okx_follow_api_label: '',
  remark: '',
})

const authHeaders = (): HeadersInit => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = localStorage.getItem('okx_token')
  if (t) h.Authorization = `Bearer ${t}`
  return h
}

const loadRows = async () => {
  loading.value = true
  err.value = ''
  try {
    const res = await fetch(`${API_BASE}/okx-api-accounts?limit=200&offset=0`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      err.value = (await res.json().catch(() => ({}))).detail || `加载失败 (${res.status})`
      rows.value = []
      return
    }
    const data = (await res.json()) as OkxRow[]
    rows.value = Array.isArray(data) ? data : []
  } catch (e: unknown) {
    err.value = e instanceof Error ? e.message : '网络错误'
    rows.value = []
  } finally {
    loading.value = false
  }
}

const submitAdd = async () => {
  saving.value = true
  err.value = ''
  msg.value = ''
  try {
    const res = await fetch(`${API_BASE}/okx-api-accounts`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        okx_follow_api_key: form.value.okx_follow_api_key.trim(),
        okx_follow_secret_key: form.value.okx_follow_secret_key.trim(),
        okx_follow_passphrase: form.value.okx_follow_passphrase.trim(),
        okx_follow_api_label: form.value.okx_follow_api_label.trim() || null,
        remark: form.value.remark.trim() || null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      err.value = (data as { detail?: string }).detail || `保存失败 (${res.status})`
      return
    }
    msg.value = '已添加'
    form.value = {
      okx_follow_api_key: '',
      okx_follow_secret_key: '',
      okx_follow_passphrase: '',
      okx_follow_api_label: '',
      remark: '',
    }
    await loadRows()
  } catch (e: unknown) {
    err.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    saving.value = false
  }
}

const removeRow = async (r: OkxRow) => {
  if (r.bound_follow_account_id != null) {
    err.value = '该帐户仍绑定在某个交易员上，请先在跟单详情页解除绑定'
    return
  }
  if (!confirm(`确定删除 API 帐户 #${r.id}？`)) return
  err.value = ''
  try {
    const res = await fetch(`${API_BASE}/okx-api-accounts/${r.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      err.value = (data as { detail?: string }).detail || `删除失败 (${res.status})`
      return
    }
    await loadRows()
  } catch (e: unknown) {
    err.value = e instanceof Error ? e.message : '网络错误'
  }
}

const formatTime = (iso: string) => {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const v: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') v[p.type] = p.value
  }
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`
}

onMounted(() => {
  void loadRows()
})
</script>

<template>
  <div class="page">
    <div class="header">
      <RouterLink class="nav-extra" to="/">← 跟单帐户</RouterLink>
      <RouterLink class="nav-extra nav-contract" to="/contract-trade">合约交易 / 保证金</RouterLink>
      <h1 class="title">OKX API 跟单帐户</h1>
      <p class="desc">
        密钥仅存数据库、不写 .env。列表与接口返回的 API Key / Secret / Passphrase 均为掩码。每个 API
        帐户仅能绑定一个交易员；在跟单详情页下拉选择绑定。
      </p>
    </div>

    <section class="card">
      <div class="card-title">添加 API 帐户</div>
      <div class="form-grid">
        <label class="field">
          <span class="field-lab">OKX_FOLLOW_API_KEY</span>
          <input v-model="form.okx_follow_api_key" type="text" class="inp" autocomplete="off" />
        </label>
        <label class="field">
          <span class="field-lab">OKX_FOLLOW_SECRET_KEY</span>
          <input v-model="form.okx_follow_secret_key" type="password" class="inp" autocomplete="new-password" />
        </label>
        <label class="field">
          <span class="field-lab">OKX_FOLLOW_PASSPHRASE</span>
          <input v-model="form.okx_follow_passphrase" type="password" class="inp" autocomplete="new-password" />
        </label>
        <label class="field">
          <span class="field-lab">OKX_FOLLOW_API_LABEL</span>
          <input v-model="form.okx_follow_api_label" type="text" class="inp" autocomplete="off" />
        </label>
        <label class="field field-span">
          <span class="field-lab">备注</span>
          <input v-model="form.remark" type="text" class="inp" autocomplete="off" />
        </label>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="saving" @click="submitAdd">
          {{ saving ? '保存中…' : '保存添加' }}
        </button>
      </div>
      <div v-if="msg" class="msg-ok">{{ msg }}</div>
      <div v-if="err" class="err-pre">{{ err }}</div>
    </section>

    <section class="card">
      <div class="card-title">已保存列表（密钥已掩码）</div>
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="rows.length === 0" class="empty">暂无数据</div>
      <div v-else class="table-responsive">
        <table class="table table-striped table-hover table-sm table-bordered align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>ID</th>
              <th>API_KEY</th>
              <th>SECRET</th>
              <th>PASSPHRASE</th>
              <th>LABEL</th>
              <th>备注</th>
              <th>绑定交易员</th>
              <th>添加时间</th>
              <th class="td-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td class="mono">{{ r.id }}</td>
              <td class="mono sm">{{ r.okx_follow_api_key }}</td>
              <td class="mono sm">{{ r.okx_follow_secret_key }}</td>
              <td class="mono sm">{{ r.okx_follow_passphrase }}</td>
              <td>{{ r.okx_follow_api_label ?? '—' }}</td>
              <td>{{ r.remark ?? '—' }}</td>
              <td>
                <span v-if="r.bound_follow_account_id != null">
                  #{{ r.bound_follow_account_id }}
                  {{ r.bound_trader_label ? `（${r.bound_trader_label}）` : '' }}
                </span>
                <span v-else class="text-muted">未绑定</span>
              </td>
              <td class="td-time">{{ formatTime(r.created_at) }}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  :disabled="r.bound_follow_account_id != null"
                  @click="removeRow(r)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 1200px;
  margin-inline: auto;
}

.header {
  margin-bottom: 16px;
}

.nav-extra {
  display: inline-block;
  margin-right: 16px;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  text-decoration: none;
  opacity: 0.88;
}

.nav-extra:hover {
  opacity: 1;
  text-decoration: underline;
}

.nav-contract {
  margin-left: 4px;
}

.title {
  font-size: 24px;
  margin-bottom: 8px;
}

.desc {
  color: var(--color-text);
  opacity: 0.8;
  font-size: 14px;
  line-height: 1.5;
}

.card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
  padding: 16px;
  margin-bottom: 16px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-span {
  grid-column: 1 / -1;
}

.field-lab {
  font-size: 12px;
  opacity: 0.85;
}

.inp {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 13px;
}

.actions {
  margin-top: 14px;
}

.msg-ok {
  margin-top: 10px;
  font-size: 13px;
  color: #0d6e3b;
}

.err-pre {
  margin-top: 10px;
  font-size: 12px;
  color: #b00020;
  white-space: pre-wrap;
}

.empty {
  opacity: 0.7;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.sm {
  font-size: 12px;
}

.td-time {
  white-space: nowrap;
  font-size: 12px;
}

.td-actions {
  white-space: nowrap;
}
</style>
