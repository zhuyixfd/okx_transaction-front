<script setup lang="ts">
import { computed, ref } from 'vue'

const sampleLinks = [
  'https://oyidl.net/ul/AeAkVdJ',
  'https://oyidl.net/ul/4DtIo37',
  'https://oyidl.net/ul/jBHQomm',
  'https://oyidl.net/ul/Jwv4rW4',
  'https://oyidl.net/ul/RZb96xX',
  'https://oyidl.net/ul/8ohvYTn',
]

const inputLinks = ref(sampleLinks.join('\n'))

type Account = {
  id: string
  link: string
  createdAt: number
  status: '已添加'
}

const accounts = ref<Account[]>(
  sampleLinks.map((link, idx) => ({
    id: `local-${idx}`,
    link,
    createdAt: Date.now(),
    status: '已添加',
  })),
)

const normalizedNewLinks = computed(() => {
  return inputLinks.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
})

const formatTime = (ts: number) => {
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}

const addAccountsLocal = async () => {
  // TODO: 这里后续替换为后端接口调用（例如：POST /api/follow-accounts）
  const existing = new Set(accounts.value.map((a) => a.link))
  const toAdd = normalizedNewLinks.value.filter((link) => !existing.has(link))

  if (toAdd.length === 0) return

  const now = Date.now()
  const newItems: Account[] = toAdd.map((link, i) => ({
    id: `local-${now}-${i}`,
    link,
    createdAt: now,
    status: '已添加',
  }))

  accounts.value = [...newItems, ...accounts.value]
}

const handleAdd = async () => {
  await addAccountsLocal()
  inputLinks.value = ''
}
</script>

<template>
  <div class="page">
    <div class="header">
      <h1 class="title">跟单帐户</h1>
      <p class="desc">上面添加帐户链接，下面展示已添加列表。</p>
    </div>

    <section class="card">
      <div class="card-title">添加帐户</div>
      <label class="label" for="links">输入链接（每行一个）</label>
      <textarea
        id="links"
        v-model="inputLinks"
        class="textarea"
        rows="6"
        placeholder="把链接粘贴到这里，每行一个"
      />
      <div class="actions">
        <button class="btn" type="button" @click="handleAdd">添加帐户</button>
      </div>
    </section>

    <section class="card">
      <div class="card-title">添加的帐户列表信息</div>

      <div v-if="accounts.length === 0" class="empty">暂无数据</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>链接</th>
            <th>状态</th>
            <th>添加时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in accounts" :key="a.id">
            <td class="td-link">{{ a.link }}</td>
            <td class="td-status">{{ a.status }}</td>
            <td class="td-time">{{ formatTime(a.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 980px;
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

.btn {
  border: 1px solid var(--color-border);
  background: var(--color-background);
  color: var(--color-text);
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 600;
}

.btn:hover {
  border-color: var(--color-border-hover);
}

.empty {
  opacity: 0.7;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
  opacity: 0.9;
}

.table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.td-link {
  word-break: break-all;
  max-width: 520px;
}

.td-status {
  white-space: nowrap;
}

.td-time {
  white-space: nowrap;
}
</style>
