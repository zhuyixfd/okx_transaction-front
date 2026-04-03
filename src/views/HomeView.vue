<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8000'

type FollowRow = {
  id: number
  link: string
  nickname: string | null
  unique_name: string | null
  enabled: boolean
  last_enabled_at: string | null
  created_at: string
  positions_refreshed_at: string | null
}

const inputLinks = ref('')
const accounts = ref<FollowRow[]>([])
const loading = ref(false)
const adding = ref(false)
const addError = ref('')
/** 添加时跳过已存在/重复的提示（非错误） */
const addInfo = ref('')

/** 与后端 `_normalize_link` 一致：trim + 去掉尾部 / */
const normalizeFollowLink = (url: string): string => url.trim().replace(/\/+$/, '')

/** 拉取当前库中全部链接（不受列表筛选影响），用于添加前去重 */
const fetchExistingLinkSet = async (): Promise<Set<string>> => {
  const params = new URLSearchParams({ limit: '200', offset: '0' })
  const res = await fetch(`${API_BASE}/follow-accounts?${params.toString()}`, {
    headers: authHeaders(),
  })
  if (!res.ok) return new Set()
  const data = (await res.json()) as FollowRow[]
  const set = new Set<string>()
  for (const a of Array.isArray(data) ? data : []) {
    set.add(normalizeFollowLink(a.link))
  }
  return set
}

/** 仅显示已启用 */
const filterEnabledOnly = ref(false)
/** 昵称关键字（模糊） */
const nicknameKeyword = ref('')

let nicknameDebounce: ReturnType<typeof setTimeout> | null = null

const authHeaders = (): HeadersInit => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = localStorage.getItem('okx_token')
  if (t) h.Authorization = `Bearer ${t}`
  return h
}

const normalizedNewLinks = computed(() =>
  inputLinks.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean),
)

/** 北京时间，固定格式 2026-04-03 11:11:32（与后端 Asia/Shanghai 一致） */
const formatTime = (iso: string | null) => {
  if (!iso) return '—'
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

const loadAccounts = async () => {
  loading.value = true
  addError.value = ''
  try {
    const params = new URLSearchParams({ limit: '200', offset: '0' })
    if (filterEnabledOnly.value) params.set('enabled_only', 'true')
    const kw = nicknameKeyword.value.trim()
    if (kw) params.set('nickname_contains', kw)

    const res = await fetch(`${API_BASE}/follow-accounts?${params.toString()}`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      addError.value = (await res.json().catch(() => ({}))).detail || `加载失败 (${res.status})`
      return
    }
    const data = (await res.json()) as FollowRow[]
    accounts.value = Array.isArray(data) ? data : []
  } catch (e: unknown) {
    addError.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    loading.value = false
  }
}

watch(filterEnabledOnly, () => {
  void loadAccounts()
})

watch(nicknameKeyword, () => {
  if (nicknameDebounce) clearTimeout(nicknameDebounce)
  nicknameDebounce = setTimeout(() => {
    void loadAccounts()
  }, 400)
})

onMounted(() => {
  void loadAccounts()
})

const handleAdd = async () => {
  const lines = normalizedNewLinks.value
  if (lines.length === 0) return

  adding.value = true
  addError.value = ''
  addInfo.value = ''
  const errors: string[] = []

  const existingInDb = await fetchExistingLinkSet()
  const seenInBatch = new Set<string>()
  const toCreate: string[] = []
  let skipped = 0

  for (const link of lines) {
    const key = normalizeFollowLink(link)
    if (!key) continue
    if (existingInDb.has(key)) {
      skipped += 1
      continue
    }
    if (seenInBatch.has(key)) {
      skipped += 1
      continue
    }
    seenInBatch.add(key)
    toCreate.push(link)
  }

  for (const link of toCreate) {
    try {
      const res = await fetch(`${API_BASE}/follow-accounts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ link }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        skipped += 1
        continue
      }
      if (!res.ok) {
        errors.push(`${link}: ${data.detail || res.status}`)
      }
    } catch (e: unknown) {
      errors.push(`${link}: ${e instanceof Error ? e.message : '请求失败'}`)
    }
  }

  inputLinks.value = ''
  await loadAccounts()

  if (skipped > 0) {
    addInfo.value = `已跳过 ${skipped} 条（数据库已有、本批重复或并发重复）`
  }
  if (errors.length) {
    addError.value = errors.join('\n')
  }

  adding.value = false
}

const onEnabledChange = async (row: FollowRow, ev: Event) => {
  const el = ev.target as HTMLInputElement
  const enabled = el.checked
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/${row.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ enabled }),
    })
    if (!res.ok) {
      addError.value = (await res.json().catch(() => ({}))).detail || '更新失败'
      el.checked = !enabled
      return
    }
    const data = (await res.json()) as FollowRow
    row.enabled = data.enabled
    row.last_enabled_at = data.last_enabled_at
    row.positions_refreshed_at = data.positions_refreshed_at ?? null
  } catch (e: unknown) {
    addError.value = e instanceof Error ? e.message : '网络错误'
    el.checked = !enabled
  }
}

const goDetail = (row: FollowRow) => {
  if (!row.unique_name) return
  router.push({ name: 'followDetail', params: { uniqueName: row.unique_name } })
}

const deleteAccount = async (row: FollowRow) => {
  if (row.enabled) return
  if (!confirm(`确定删除该帐户？\n${row.link}`)) return
  addError.value = ''
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/${row.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      addError.value = data.detail || `删除失败 (${res.status})`
      return
    }
    await loadAccounts()
  } catch (e: unknown) {
    addError.value = e instanceof Error ? e.message : '网络错误'
  }
}
</script>

<template>
  <div class="page">
    <div class="header">
      <h1 class="title">跟单帐户</h1>
      <p class="desc">粘贴跟单落地页链接（每行一个），保存后会解析昵称与 uniqueName。列表按「启用优先 → 最近一次启用时间」排序。</p>
    </div>

    <section class="card">
      <div class="card-title">添加帐户</div>
      <label class="label" for="links">输入链接（每行一个）</label>
      <textarea
        id="links"
        v-model="inputLinks"
        class="textarea"
        rows="6"
        placeholder="例如：https://oyidl.net/ul/4DtIo37"
      />
      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="adding" @click="handleAdd">
          {{ adding ? '添加中…' : '添加帐户' }}
        </button>
      </div>
      <div v-if="addInfo" class="add-info">{{ addInfo }}</div>
      <div v-if="addError" class="err-pre">{{ addError }}</div>
    </section>

    <section class="card">
      <div class="card-title">筛选</div>
      <div class="filters">
        <label class="filter-item">
          <input v-model="filterEnabledOnly" type="checkbox" />
          仅显示已启用
        </label>
        <label class="filter-item grow">
          <span class="filter-label">昵称包含</span>
          <input
            v-model="nicknameKeyword"
            type="search"
            class="filter-input"
            placeholder="模糊匹配昵称"
            autocomplete="off"
          />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-title">已添加列表</div>

      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="accounts.length === 0" class="empty">暂无数据</div>
      <div v-else class="table-responsive">
        <table class="table table-striped table-hover table-sm table-bordered align-middle mb-0">
          <thead class="table-light">
          <tr>
            <th>链接</th>
            <th>昵称</th>
            <th>uniqueName</th>
            <th>启用</th>
            <th>最近一次启用时间</th>
            <th>持仓快照更新时间</th>
            <th>添加时间</th>
            <th class="td-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in accounts" :key="a.id">
            <td>
              <a
                class="td-link"
                :href="a.link"
                target="_blank"
                rel="noopener noreferrer"
              >{{ a.link }}</a>
            </td>
            <td>{{ a.nickname ?? '—' }}</td>
            <td class="td-mono">{{ a.unique_name ?? '—' }}</td>
            <td class="td-check">
              <input
                type="checkbox"
                :checked="a.enabled"
                :aria-label="`启用 ${a.id}`"
                @change="onEnabledChange(a, $event)"
              />
            </td>
            <td class="td-time">{{ formatTime(a.last_enabled_at) }}</td>
            <td class="td-time">{{ formatTime(a.positions_refreshed_at) }}</td>
            <td class="td-time">{{ formatTime(a.created_at) }}</td>
            <td class="td-actions">
              <div class="action-btns">
                <button
                  v-if="a.unique_name"
                  type="button"
                  class="btn btn-sm btn-primary"
                  @click="goDetail(a)"
                >
                  详情
                </button>
                <button
                  v-if="!a.enabled"
                  type="button"
                  class="btn btn-sm btn-danger"
                  @click="deleteAccount(a)"
                >
                  删除
                </button>
              </div>
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

.title {
  font-size: 24px;
  margin-bottom: 8px;
}

.desc {
  color: var(--color-text);
  opacity: 0.8;
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

.label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  opacity: 0.9;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.filter-item.grow {
  flex: 1;
  min-width: 200px;
  cursor: default;
}

.filter-label {
  white-space: nowrap;
  font-size: 13px;
  opacity: 0.9;
}

.filter-input {
  flex: 1;
  min-width: 160px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 14px;
}

.textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 12px;
  background: var(--color-background);
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.actions {
  margin-top: 12px;
}

.td-actions {
  white-space: nowrap;
  min-width: 140px;
}

.action-btns {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.add-info {
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-text);
  opacity: 0.78;
  white-space: pre-wrap;
  word-break: break-word;
}

.err-pre {
  margin-top: 12px;
  font-size: 12px;
  color: #b00020;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty {
  opacity: 0.7;
}

.td-link {
  word-break: break-all;
  max-width: 320px;
}

.td-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 12px;
}

.td-check {
  white-space: nowrap;
  width: 56px;
}

.td-time {
  white-space: nowrap;
}
</style>
