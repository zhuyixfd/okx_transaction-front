<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8000'

const authHeaders = (): HeadersInit => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = localStorage.getItem('okx_token')
  if (t) h.Authorization = `Bearer ${t}`
  return h
}

/** OKX 返回体 */
type OkxEnvelope = { code?: string; msg?: string; data?: unknown }

const contractSymbol = ref('')
const contractSz = ref('')
/** 做多 / 做空意图 */
const contractDirection = ref<'long' | 'short'>('long')
/** net=单向(买卖模式) 多数账户；hedge=双向(开平仓) 才用 long/short 作 posSide */
const contractPositionMode = ref<'net' | 'hedge'>('net')
const contractTdMode = ref<'isolated' | 'cross'>('isolated')
/** 杠杆倍数；留空则不调 OKX set-leverage，沿用当前合约杠杆 */
const contractLever = ref('')
const contractSubmitting = ref(false)
const contractMsg = ref('')

const marginInstId = ref('')
const marginPosSide = ref<'long' | 'short' | 'net'>('long')
const marginAmt = ref('')
const marginSubmitting = ref(false)
const marginMsg = ref('')

const fillsLoading = ref(false)
const fillsError = ref('')
const fillsRows = ref<Record<string, unknown>[]>([])

const billsLoading = ref(false)
const billsError = ref('')
const billsRows = ref<Record<string, unknown>[]>([])

const formatTs = (ms: string | number | undefined) => {
  if (ms === undefined || ms === '') return '—'
  const n = typeof ms === 'string' ? Number(ms) : ms
  if (!Number.isFinite(n)) return String(ms)
  return new Date(n).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

const pickStr = (row: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return '—'
}

const loadFills = async () => {
  fillsLoading.value = true
  fillsError.value = ''
  try {
    const res = await fetch(`${API_BASE}/manual-okx/fills?instType=SWAP&limit=50`, {
      headers: authHeaders(),
    })
    const body = (await res.json()) as OkxEnvelope & Record<string, unknown>
    if (!res.ok) {
      fillsError.value =
        typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
      fillsRows.value = []
      return
    }
    const d = body.data
    fillsRows.value = Array.isArray(d) ? (d as Record<string, unknown>[]) : []
  } catch (e: unknown) {
    fillsError.value = e instanceof Error ? e.message : '网络错误'
    fillsRows.value = []
  } finally {
    fillsLoading.value = false
  }
}

const loadMarginBills = async () => {
  billsLoading.value = true
  billsError.value = ''
  try {
    const res = await fetch(`${API_BASE}/manual-okx/margin-bills?instType=SWAP&limit=100`, {
      headers: authHeaders(),
    })
    const body = (await res.json()) as OkxEnvelope & Record<string, unknown>
    if (!res.ok) {
      billsError.value =
        typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
      billsRows.value = []
      return
    }
    const d = body.data
    billsRows.value = Array.isArray(d) ? (d as Record<string, unknown>[]) : []
  } catch (e: unknown) {
    billsError.value = e instanceof Error ? e.message : '网络错误'
    billsRows.value = []
  } finally {
    billsLoading.value = false
  }
}

const submitContract = async () => {
  contractMsg.value = ''
  contractSubmitting.value = true
  try {
    const payload: Record<string, string> = {
      symbol: contractSymbol.value.trim(),
      sz: contractSz.value.trim(),
      direction: contractDirection.value,
      position_mode: contractPositionMode.value,
      td_mode: contractTdMode.value,
    }
    const lv = contractLever.value.trim()
    if (lv) payload.lever = lv

    const res = await fetch(`${API_BASE}/manual-okx/contract-order`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      contractMsg.value =
        typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
      return
    }
    contractMsg.value = `OK：${JSON.stringify(body)}`
    await loadFills()
  } catch (e: unknown) {
    contractMsg.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    contractSubmitting.value = false
  }
}

const submitMargin = async () => {
  marginMsg.value = ''
  marginSubmitting.value = true
  try {
    const res = await fetch(`${API_BASE}/manual-okx/margin-add`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        inst_id: marginInstId.value.trim(),
        pos_side: marginPosSide.value,
        amt: marginAmt.value.trim(),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      marginMsg.value =
        typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
      return
    }
    marginMsg.value = `OK：${JSON.stringify(body)}`
    await loadMarginBills()
  } catch (e: unknown) {
    marginMsg.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    marginSubmitting.value = false
  }
}

onMounted(() => {
  void loadFills()
  void loadMarginBills()
})
</script>

<template>
  <div class="page">
    <div class="header">
      <RouterLink class="back" to="/">← 跟单帐户</RouterLink>
      <h1 class="title">合约交易与保证金</h1>
      <p class="desc">
        市价开仓与逐仓追加保证金直连 OKX；成交与保证金划转记录来自交易所接口，本系统不入库。
      </p>
    </div>

    <section class="card">
      <div class="card-title">合约交易（市价开仓）</div>
      <div class="form-grid">
        <label class="field">
          <span class="lab">交易币种 / 合约</span>
          <input
            v-model="contractSymbol"
            class="inp"
            placeholder="如 BTC 或 BTC-USDT-SWAP"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <span class="lab">数量（U 本位永续一般为张）</span>
          <input v-model="contractSz" class="inp" placeholder="sz" autocomplete="off" />
        </label>
        <label class="field">
          <span class="lab">杠杆倍数</span>
          <input
            v-model="contractLever"
            class="inp"
            type="number"
            min="1"
            max="125"
            step="1"
            placeholder="留空则不修改；填写则先 set-leverage 再下单"
            autocomplete="off"
          />
        </label>
        <div class="field">
          <span class="lab">方向</span>
          <div class="radios">
            <label><input v-model="contractDirection" type="radio" value="long" /> 做多</label>
            <label><input v-model="contractDirection" type="radio" value="short" /> 做空</label>
          </div>
        </div>
        <div class="field">
          <span class="lab">持仓模式（须与欧易账户一致）</span>
          <div class="radios">
            <label><input v-model="contractPositionMode" type="radio" value="net" /> 单向 net（常见）</label>
            <label><input v-model="contractPositionMode" type="radio" value="hedge" /> 双向 long/short</label>
          </div>
          <p class="field-hint">报 Parameter posSide error 时选「单向 net」。</p>
        </div>
        <label class="field">
          <span class="lab">保证金模式</span>
          <select v-model="contractTdMode" class="inp">
            <option value="isolated">逐仓 isolated</option>
            <option value="cross">全仓 cross</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="contractSubmitting"
        @click="submitContract"
      >
        {{ contractSubmitting ? '提交中…' : '提交开仓' }}
      </button>
      <p v-if="contractMsg" class="msg">{{ contractMsg }}</p>
    </section>

    <section class="card">
      <div class="card-title">追加逐仓保证金</div>
      <div class="form-grid">
        <label class="field">
          <span class="lab">合约 instId</span>
          <input
            v-model="marginInstId"
            class="inp"
            placeholder="如 ETH-USDT-SWAP 或 ETH"
            autocomplete="off"
          />
        </label>
        <div class="field">
          <span class="lab">持仓方向</span>
          <div class="radios">
            <label><input v-model="marginPosSide" type="radio" value="long" /> 多 long</label>
            <label><input v-model="marginPosSide" type="radio" value="short" /> 空 short</label>
            <label><input v-model="marginPosSide" type="radio" value="net" /> net</label>
          </div>
        </div>
        <label class="field">
          <span class="lab">追加金额（一般为 USDT 数量）</span>
          <input v-model="marginAmt" class="inp" placeholder="amt" autocomplete="off" />
        </label>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="marginSubmitting"
        @click="submitMargin"
      >
        {{ marginSubmitting ? '提交中…' : '追加保证金' }}
      </button>
      <p v-if="marginMsg" class="msg">{{ marginMsg }}</p>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title mb-0">合约成交记录（OKX / fills）</div>
        <button type="button" class="btn btn-sm" :disabled="fillsLoading" @click="loadFills">
          {{ fillsLoading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <p v-if="fillsError" class="err">{{ fillsError }}</p>
      <div v-else-if="fillsLoading && fillsRows.length === 0" class="muted">加载中…</div>
      <div v-else-if="fillsRows.length === 0" class="muted">暂无数据</div>
      <div v-else class="table-responsive">
        <table class="table table-striped table-hover table-sm table-bordered align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>时间</th>
              <th>合约</th>
              <th>方向</th>
              <th>持仓方向</th>
              <th>成交价</th>
              <th>成交数量</th>
              <th>订单号</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in fillsRows" :key="i">
              <td class="nowrap">{{ formatTs(pickStr(r, ['fillTime', 'ts', 'cTime'])) }}</td>
              <td class="mono">{{ pickStr(r, ['instId']) }}</td>
              <td>{{ pickStr(r, ['side']) }}</td>
              <td>{{ pickStr(r, ['posSide']) }}</td>
              <td class="mono">{{ pickStr(r, ['fillPx', 'px']) }}</td>
              <td class="mono">{{ pickStr(r, ['fillSz', 'sz', 'accFillSz']) }}</td>
              <td class="mono small">{{ pickStr(r, ['ordId']) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title mb-0">保证金划转记录（OKX 账单 type=6）</div>
        <button type="button" class="btn btn-sm" :disabled="billsLoading" @click="loadMarginBills">
          {{ billsLoading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <p class="hint small text-muted">
        含逐仓保证金增减等；与交易所账户模式、子类型有关，以 OKX 返回字段为准。
      </p>
      <p v-if="billsError" class="err">{{ billsError }}</p>
      <div v-else-if="billsLoading && billsRows.length === 0" class="muted">加载中…</div>
      <div v-else-if="billsRows.length === 0" class="muted">暂无数据</div>
      <div v-else class="table-responsive">
        <table class="table table-striped table-hover table-sm table-bordered align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>时间</th>
              <th>合约</th>
              <th>保证金模式</th>
              <th>仓位保证金变动</th>
              <th>账户余额变动</th>
              <th>子类型</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in billsRows" :key="i">
              <td class="nowrap">{{ formatTs(pickStr(r, ['ts'])) }}</td>
              <td class="mono">{{ pickStr(r, ['instId']) }}</td>
              <td>{{ pickStr(r, ['mgnMode']) }}</td>
              <td class="mono">{{ pickStr(r, ['posBalChg']) }}</td>
              <td class="mono">{{ pickStr(r, ['balChg']) }}</td>
              <td class="mono">{{ pickStr(r, ['subType']) }}</td>
              <td class="small">{{ pickStr(r, ['notes']) }}</td>
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
  max-width: 1100px;
  margin-inline: auto;
  padding: 0 12px 32px;
}

.header {
  margin-bottom: 20px;
}

.back {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--color-text);
  text-decoration: none;
  opacity: 0.85;
}

.back:hover {
  opacity: 1;
  text-decoration: underline;
}

.title {
  font-size: 22px;
  margin-bottom: 8px;
}

.desc {
  color: var(--color-text);
  opacity: 0.82;
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

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.mb-0 {
  margin-bottom: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lab {
  font-size: 13px;
  opacity: 0.88;
}

.inp {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 14px;
}

.radios {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 14px;
}

.radios label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.btn {
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}

.btn-primary {
  background: var(--color-primary, #2563eb);
  color: #fff;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
  background: var(--color-background);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.msg {
  margin-top: 12px;
  font-size: 12px;
  word-break: break-word;
}

.err {
  color: #b00020;
  font-size: 13px;
  word-break: break-word;
}

.muted {
  opacity: 0.7;
  font-size: 14px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.nowrap {
  white-space: nowrap;
}

.hint {
  margin-bottom: 8px;
}

.field-hint {
  margin: 0;
  font-size: 12px;
  opacity: 0.75;
  line-height: 1.4;
}
</style>
