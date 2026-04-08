<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

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
  bet_amount_per_position?: number | string | null
  max_follow_positions?: number | null
  bet_mode?: string
  margin_add_ratio_of_bet?: number | string | null
  margin_auto_enabled?: boolean
  margin_add_max_times?: number | null
  maint_margin_ratio_threshold?: number | string | null
  close_margin_ratio_threshold?: number | string | null
  take_profit_ratio?: number | string | null
  stop_loss_ratio?: number | string | null
  okx_api_account_id?: number | null
  live_trading_enabled?: boolean
}

type OkxApiListRow = {
  id: number
  okx_follow_api_label: string | null
  remark: string | null
  bound_follow_account_id: number | null
  bound_trader_label: string | null
}

type FollowCfgForm = {
  bet_amount_per_position: number | null
  max_follow_positions: number | null
  margin_add_ratio_of_bet: number
  margin_auto_enabled: boolean
  /** 追加次数上限；null 表示不限制 */
  margin_add_max_times: number | null
  /** 维持保证金率阈值（比例，2=200%） */
  maint_margin_ratio_threshold: number | null
  /** 平仓保证金率阈值（比例，2=200%） */
  close_margin_ratio_threshold: number | null
  /** 止盈收益率阈值（比例，0.2=20%） */
  take_profit_ratio: number | null
  /** 止损收益率阈值（比例，0.1=10%） */
  stop_loss_ratio: number | null
  /** true：真实交易（欧易私有接口）；false：仅模拟 */
  live_trading_enabled: boolean
}

type PositionEventRow = {
  id: number
  follow_account_id: number
  unique_name: string
  event_type: string
  pos_id: string | null
  pos_ccy: string | null
  pos_side: string | null
  lever: string | null
  avg_px: string | null
  last_px: string | null
  /** 来自接口 uplRatio，经 detail_json / 快照落库后返回 */
  upl_ratio?: string | null
  /** 来自接口 upl（USDT），未平仓行前端用快照覆盖 */
  upl?: string | null
  pos?: string | null
  margin?: string | null
  mgn_ratio?: string | null
  liq_px?: string | null
  c_time: string | null
  detail_json: string | null
  created_at: string
}

type PositionSnapshotRow = {
  pos_id: string
  c_time: string | null
  c_time_format: string | null
  pos_ccy: string | null
  pos_side: string | null
  lever: string | null
  avg_px: string | null
  last_px: string | null
  /** 欧易 uplRatio，写入 follow_position_snapshots.snapshot_json */
  upl_ratio?: string | null
  /** 欧易 upl，未实现盈亏（USDT） */
  upl?: string | null
  pos?: string | null
  margin?: string | null
  mgn_ratio?: string | null
  liq_px?: string | null
}

type PositionSnapshotPayload = {
  unique_name: string
  refreshed_at: string | null
  positions: PositionSnapshotRow[]
}

/** 模拟跟单资金记录（与后端 FollowSimRecordOut 一致，金额为字符串） */
type FollowSimRecordRow = {
  id: number
  follow_account_id: number
  pos_id: string
  pos_ccy: string | null
  pos_side: string | null
  entry_avg_px: string | null
  stake_usdt: string
  status: string
  open_event_id?: number | null
  close_event_id?: number | null
  exit_px: string | null
  realized_pnl_usdt: string | null
  unrealized_pnl_usdt: string
  last_mark_px: string | null
  opened_at: string
  closed_at: string | null
  updated_at: string
  /** 与对方持仓同步（community position-current） */
  src_pos?: string | null
  src_margin?: string | null
  src_mgn_ratio?: string | null
  src_liq_px?: string | null
  add_position_count?: number
  reduce_position_count?: number
  add_margin_count?: number
  total_invested_usdt?: string
}

const props = defineProps<{
  uniqueName: string
}>()

const route = useRoute()

const paramUniqueName = computed(() => {
  const p = props.uniqueName ?? (route.params.uniqueName as string | undefined)
  return typeof p === 'string' ? p : ''
})

const accounts = ref<FollowRow[]>([])
const loading = ref(true)
const error = ref('')

const events = ref<PositionEventRow[]>([])
const eventsLoading = ref(false)
const eventsError = ref('')
/** 开仓/平仓记录分页 */
const EVENTS_PAGE_SIZE = 20
const eventsPage = ref(1)
const eventsTotal = ref(0)

const snapshot = ref<PositionSnapshotPayload | null>(null)
const snapshotLoading = ref(false)
const snapshotError = ref('')

const simRecords = ref<FollowSimRecordRow[]>([])
const simLoading = ref(false)
const simError = ref('')
const SIM_PAGE_SIZE = 500
/** 本人 OKX：成交 / 保证金账单列表分页（每表独立） */
const LINKED_OKX_PAGE_SIZE = 10
const simPage = ref(1)
const simTotal = ref(0)
const simTotalPnl = ref('')
const simRealizedSum = ref('')
const simUnrealizedSum = ref('')

const followCfg = ref<FollowCfgForm>({
  bet_amount_per_position: null,
  max_follow_positions: null,
  margin_add_ratio_of_bet: 0.2,
  margin_auto_enabled: false,
  margin_add_max_times: null,
  maint_margin_ratio_threshold: null,
  close_margin_ratio_threshold: null,
  take_profit_ratio: null,
  stop_loss_ratio: null,
  live_trading_enabled: false,
})
const configSaving = ref(false)
const configMsg = ref('')
const enabledToggling = ref(false)
const enabledToggleMsg = ref('')

const okxApiList = ref<OkxApiListRow[]>([])
const okxBindSelect = ref('')
const okxBindMsg = ref('')
const okxBindSaving = ref(false)

/** 绑定 OKX 下本人帐户：成交 / 保证金流水 / 持仓（follow_order 代理接口） */
const linkedFillsRows = ref<Record<string, unknown>[]>([])
const linkedBillsRows = ref<Record<string, unknown>[]>([])
const linkedPosRows = ref<Record<string, unknown>[]>([])
/** 跟单持仓（欧易 positions）最近一次成功拉取时间，用于「更新时间」列（与对方快照 refreshed_at 对齐语义） */
const linkedOkxFetchedAt = ref<string | null>(null)
const linkedOkxErr = ref('')
/** 每次发起本人 OKX 三联请求前递增，用于丢弃慢于后一轮的过期响应，避免表格闪空 */
const linkedOkxFetchGeneration = ref(0)
const linkedFillsPage = ref(1)
const linkedBillsPage = ref(1)

const pickLinkedStr = (row: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return '—'
}

/** 与 formatTime 同为 Asia/Shanghai，并带毫秒（欧易 fillTime/ts/cTime 多为毫秒，部分为秒） */
const formatDateTimeShanghaiMs = (d: Date): string => {
  if (!Number.isFinite(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).formatToParts(d)
  const v: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') v[p.type] = p.value
  }
  const frac = v.fractionalSecond ?? '000'
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}.${frac}`
}

const formatLinkedTs = (raw: string | number | undefined) => {
  if (raw === undefined || raw === '' || raw === '—') return '—'
  const trimmed = typeof raw === 'number' ? String(raw) : String(raw).trim()
  if (trimmed === '' || trimmed === '—') return '—'
  const isoMs = Date.parse(trimmed)
  if (Number.isFinite(isoMs)) return formatDateTimeShanghaiMs(new Date(isoMs))
  const cleaned = trimmed.replace(/,/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return trimmed
  let d: Date
  if (n >= 1e12) d = new Date(n)
  else if (n >= 1e9) d = new Date(n * 1000)
  else d = new Date(n)
  if (!Number.isFinite(d.getTime())) return trimmed
  return formatDateTimeShanghaiMs(d)
}

/** 欧易 instId 如 BTC-USDT-SWAP → 币种 BTC（与对方 pos_ccy 列对齐） */
const instIdBaseCcy = (instIdRaw: string): string => {
  if (instIdRaw === '—' || !String(instIdRaw).trim()) return '—'
  const s = String(instIdRaw).trim()
  const i = s.indexOf('-')
  return i > 0 ? s.slice(0, i) : s
}

const linkedOpenTimeDisplay = (r: Record<string, unknown>): string => {
  const raw = pickLinkedStr(r, ['cTime'])
  if (raw === '—') return '—'
  return formatLinkedTs(raw)
}

const _linkedErrText = (res: Response, j: unknown): string => {
  const d = (j as { detail?: unknown })?.detail
  if (typeof d === 'string') return d
  if (d != null) return JSON.stringify(d)
  return `请求失败 (${res.status})`
}

const _linkedDataArr = (res: Response, j: unknown): Record<string, unknown>[] => {
  if (!res.ok) return []
  const data = (j as { data?: unknown }).data
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : []
}

const loadLinkedOkxTradeData = async (silent = false) => {
  const un = paramUniqueName.value
  const c = current.value
  if (!un || !c?.okx_api_account_id) {
    linkedOkxFetchGeneration.value += 1
    linkedFillsRows.value = []
    linkedBillsRows.value = []
    linkedPosRows.value = []
    linkedOkxFetchedAt.value = null
    if (!silent) linkedOkxErr.value = ''
    return
  }
  linkedOkxFetchGeneration.value += 1
  const gen = linkedOkxFetchGeneration.value
  const startUn = un
  const startOkxId = c.okx_api_account_id

  if (!silent) linkedOkxErr.value = ''
  const q = new URLSearchParams({ unique_name: un })
  try {
    const [fRes, bRes, pRes] = await Promise.all([
      fetch(`${API_BASE}/follow-accounts/linked-okx/fills?${q}&instType=SWAP&limit=100`, {
        headers: authHeaders(),
      }),
      fetch(`${API_BASE}/follow-accounts/linked-okx/margin-bills?${q}&instType=SWAP&limit=100`, {
        headers: authHeaders(),
      }),
      fetch(`${API_BASE}/follow-accounts/linked-okx/positions?${q}&instType=SWAP`, {
        headers: authHeaders(),
      }),
    ])
    const [fj, bj, pj] = await Promise.all([
      fRes.json().catch(() => ({})),
      bRes.json().catch(() => ({})),
      pRes.json().catch(() => ({})),
    ])
    if (
      gen !== linkedOkxFetchGeneration.value ||
      paramUniqueName.value !== startUn ||
      current.value?.okx_api_account_id !== startOkxId
    ) {
      return
    }
    // 仅成功响应覆盖列表；失败或 502 保留上一轮数据，避免「我的持仓」闪空
    if (fRes.ok) linkedFillsRows.value = _linkedDataArr(fRes, fj)
    if (bRes.ok) linkedBillsRows.value = _linkedDataArr(bRes, bj)
    if (pRes.ok) {
      linkedPosRows.value = _linkedDataArr(pRes, pj)
      linkedOkxFetchedAt.value = new Date().toISOString()
    }
    if (!silent) {
      if (!fRes.ok) linkedOkxErr.value = _linkedErrText(fRes, fj)
      else if (!bRes.ok) linkedOkxErr.value = _linkedErrText(bRes, bj)
      else if (!pRes.ok) linkedOkxErr.value = _linkedErrText(pRes, pj)
      else linkedOkxErr.value = ''
    } else if (fRes.ok && bRes.ok && pRes.ok) {
      linkedOkxErr.value = ''
    }
  } catch (e: unknown) {
    if (
      gen !== linkedOkxFetchGeneration.value ||
      paramUniqueName.value !== startUn ||
      current.value?.okx_api_account_id !== startOkxId
    ) {
      return
    }
    if (!silent) linkedOkxErr.value = e instanceof Error ? e.message : '网络错误'
  }
}

/** 悬停「跟单配置」标题时展示（不含已固定的按成本模式文案） */
const followConfigSectionHint =
  '本页保存的每条跟单记录独立生效。后台对每个勾选「启动追加」的跟单帐户单独协程，约每 1 秒拉取该帐户绑定 OKX 的永续持仓；当维持保证金率（mgnRatio）≤ 200% 时，按「下注金额 × 追加比例」自动追加逐仓保证金；「追加次数上限」仅在 ≤200% 的持续期间计数，mgnRatio 回到 &gt;200% 后清零。须同时勾选「启用真实交易」「启动追加」并绑定 API。关闭真实交易时不调欧易私有接口。可选 OKX_FOLLOW_REST_BASE、OKX_FOLLOW_USE_PAPER。'

/** 悬停「跟单仓位数」时展示 */
const maxFollowPositionsLabelHint =
  '对方持仓少于 n 则全跟；多于 n 则只跟 n 个；对方平仓换仓后仍只保持最多 n 个跟单仓位。'

/** 悬停「当前持仓」标题 */
const snapshotSectionHint =
  '每 2 秒静默请求快照接口（不整页刷新）。标记价来自库表 follow_position_snapshots，启用时由后台轮询更新。'

/** 悬停「模拟跟单资金」标题（follow_sim_records） */
const simRecordsSectionHint =
  '按「下注金额」模拟资金变动；开仓写入记录，平仓结算已实现盈亏。未平仓行随标记价更新浮动盈亏。总收益 = 已实现合计 + 未平仓浮动合计（随行情变动）。操作列可删除单条模拟行（无确认）；若对方该 posId 仍在持仓，监控会在下一轮再次生成模拟行。与「跟单持仓」欧易真实持仓无关。'

/** 悬停「跟单持仓」：本人绑定 OKX 的永续持仓 */
const followMyPositionsSectionHint =
  '数据来自欧易私有接口 GET /api/v5/account/positions（SWAP），使用本页绑定的 API 密钥；与「对方持仓」社区接口、与「模拟跟单资金」表均无关。每 2 秒与同轮询下的页内下方「本人 OKX」成交、保证金账单一并刷新。'

/** 悬停「开仓 / 平仓记录」标题 */
const eventsSectionHint =
  '每 2 秒静默刷新当前页数据。仅当 posId 出现/消失时写入记录；本表仅展示已平仓记录。'

let pollTimer: ReturnType<typeof setInterval> | null = null

const authHeaders = (): HeadersInit => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = localStorage.getItem('okx_token')
  if (t) h.Authorization = `Bearer ${t}`
  return h
}

const loadList = async (silent = false) => {
  if (!silent) {
    loading.value = true
    error.value = ''
  }
  try {
    const res = await fetch(`${API_BASE}/follow-accounts?limit=200&offset=0`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      if (!silent) {
        error.value = (await res.json().catch(() => ({}))).detail || `加载失败 (${res.status})`
        accounts.value = []
      }
      return
    }
    const data = (await res.json()) as FollowRow[]
    accounts.value = Array.isArray(data) ? data : []
  } catch (e: unknown) {
    if (!silent) {
      error.value = e instanceof Error ? e.message : '网络错误'
      accounts.value = []
    }
  } finally {
    if (!silent) loading.value = false
  }
}

const loadEvents = async (silent = false) => {
  const un = paramUniqueName.value
  if (!un) {
    events.value = []
    eventsTotal.value = 0
    return
  }
  if (!silent) {
    eventsLoading.value = true
    eventsError.value = ''
  }
  try {
    const offset = (eventsPage.value - 1) * EVENTS_PAGE_SIZE
    const params = new URLSearchParams({
      unique_name: un,
      limit: String(EVENTS_PAGE_SIZE),
      offset: String(offset),
    })
    const res = await fetch(`${API_BASE}/follow-accounts/position-events?${params}`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      if (!silent) {
        eventsError.value = (await res.json().catch(() => ({}))).detail || `加载失败 (${res.status})`
        events.value = []
        eventsTotal.value = 0
      }
      return
    }
    const data = (await res.json()) as { items?: PositionEventRow[]; total?: number }
    const items = data?.items
    const total = data?.total
    if (Array.isArray(items) && typeof total === 'number') {
      events.value = items
      eventsTotal.value = total
    } else {
      events.value = []
      eventsTotal.value = 0
    }
  } catch (e: unknown) {
    if (!silent) {
      eventsError.value = e instanceof Error ? e.message : '网络错误'
      events.value = []
      eventsTotal.value = 0
    }
  } finally {
    if (!silent) eventsLoading.value = false
  }
}

const loadSnapshot = async (silent = false) => {
  const un = paramUniqueName.value
  if (!un) {
    snapshot.value = null
    return
  }
  if (!silent) {
    snapshotLoading.value = true
    snapshotError.value = ''
  }
  try {
    const params = new URLSearchParams({ unique_name: un })
    const res = await fetch(`${API_BASE}/follow-accounts/position-snapshot?${params}`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      if (!silent) {
        snapshotError.value = (await res.json().catch(() => ({}))).detail || `加载失败 (${res.status})`
        snapshot.value = null
      }
      return
    }
    const data = (await res.json()) as PositionSnapshotPayload
    snapshot.value = data && typeof data === 'object' ? data : null
  } catch (e: unknown) {
    if (!silent) {
      snapshotError.value = e instanceof Error ? e.message : '网络错误'
      snapshot.value = null
    }
  } finally {
    if (!silent) snapshotLoading.value = false
  }
}

const loadSimRecords = async (silent = false) => {
  const un = paramUniqueName.value
  if (!un) {
    simRecords.value = []
    simTotal.value = 0
    simTotalPnl.value = ''
    simRealizedSum.value = ''
    simUnrealizedSum.value = ''
    return
  }
  if (!silent) {
    simLoading.value = true
    simError.value = ''
  }
  try {
    const params = new URLSearchParams({
      unique_name: un,
      limit: String(SIM_PAGE_SIZE),
      offset: '0',
    })
    const res = await fetch(`${API_BASE}/follow-accounts/follow-sim-records?${params}`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      if (!silent) {
        simError.value = (await res.json().catch(() => ({}))).detail || `加载失败 (${res.status})`
        simRecords.value = []
        simTotal.value = 0
        simTotalPnl.value = ''
        simRealizedSum.value = ''
        simUnrealizedSum.value = ''
      }
      return
    }
    const data = (await res.json()) as {
      items?: FollowSimRecordRow[]
      total?: number
      total_pnl_usdt?: string
      realized_sum_usdt?: string
      unrealized_sum_usdt?: string
    }
    const items = data?.items
    const total = data?.total
    if (Array.isArray(items) && typeof total === 'number') {
      simRecords.value = items
      simTotal.value = total
      simTotalPnl.value = data.total_pnl_usdt ?? '—'
      simRealizedSum.value = data.realized_sum_usdt ?? '—'
      simUnrealizedSum.value = data.unrealized_sum_usdt ?? '—'
    } else {
      simRecords.value = []
      simTotal.value = 0
      simTotalPnl.value = ''
      simRealizedSum.value = ''
      simUnrealizedSum.value = ''
    }
  } catch (e: unknown) {
    if (!silent) {
      simError.value = e instanceof Error ? e.message : '网络错误'
      simRecords.value = []
      simTotal.value = 0
    }
  } finally {
    if (!silent) simLoading.value = false
  }
}

const loadOkxApiList = async (silent = false) => {
  if (!silent) okxBindMsg.value = ''
  try {
    const res = await fetch(`${API_BASE}/okx-api-accounts?limit=200&offset=0`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      if (!silent) okxBindMsg.value = (await res.json().catch(() => ({}))).detail || '加载 API 列表失败'
      return
    }
    const data = (await res.json()) as OkxApiListRow[]
    okxApiList.value = Array.isArray(data) ? data : []
  } catch {
    if (!silent) okxBindMsg.value = '加载 API 列表网络错误'
  }
}

onMounted(() => {
  void loadOkxApiList(false)
  void loadList(false).then(() => {
    void loadEvents(false)
    void loadSnapshot(false)
    void loadSimRecords(false)
    void loadLinkedOkxTradeData(false)
  })
  pollTimer = setInterval(() => {
    void loadEvents(true)
    void loadSnapshot(true)
    void loadSimRecords(true)
    void loadList(true)
    void loadOkxApiList(true)
    void loadLinkedOkxTradeData(true)
  }, 2000)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

watch(paramUniqueName, () => {
  eventsPage.value = 1
  simPage.value = 1
  linkedFillsPage.value = 1
  linkedBillsPage.value = 1
  void loadEvents(false)
  void loadSnapshot(false)
  void loadSimRecords(false)
  void loadLinkedOkxTradeData(false)
})

const eventsTotalPages = computed(() =>
  Math.max(1, Math.ceil(eventsTotal.value / EVENTS_PAGE_SIZE)),
)

const simTotalPages = computed(() => Math.max(1, Math.ceil(simTotal.value / SIM_PAGE_SIZE)))

const linkedFillsTotalPages = computed(() =>
  Math.max(1, Math.ceil(linkedFillsRows.value.length / LINKED_OKX_PAGE_SIZE)),
)
const linkedBillsTotalPages = computed(() =>
  Math.max(1, Math.ceil(linkedBillsRows.value.length / LINKED_OKX_PAGE_SIZE)),
)
const linkedFillsPageSlice = computed(() => {
  const start = (linkedFillsPage.value - 1) * LINKED_OKX_PAGE_SIZE
  return linkedFillsRows.value.slice(start, start + LINKED_OKX_PAGE_SIZE)
})
const linkedBillsPageSlice = computed(() => {
  const start = (linkedBillsPage.value - 1) * LINKED_OKX_PAGE_SIZE
  return linkedBillsRows.value.slice(start, start + LINKED_OKX_PAGE_SIZE)
})

const clampLinkedOkxListPages = () => {
  const mf = Math.max(1, Math.ceil(linkedFillsRows.value.length / LINKED_OKX_PAGE_SIZE))
  const mb = Math.max(1, Math.ceil(linkedBillsRows.value.length / LINKED_OKX_PAGE_SIZE))
  if (linkedFillsPage.value > mf) linkedFillsPage.value = mf
  if (linkedBillsPage.value > mb) linkedBillsPage.value = mb
}
watch([linkedFillsRows, linkedBillsRows], clampLinkedOkxListPages)

const goLinkedFillsPrev = () => {
  if (linkedFillsPage.value > 1) linkedFillsPage.value -= 1
}
const goLinkedFillsNext = () => {
  if (linkedFillsPage.value < linkedFillsTotalPages.value) linkedFillsPage.value += 1
}
const goLinkedBillsPrev = () => {
  if (linkedBillsPage.value > 1) linkedBillsPage.value -= 1
}
const goLinkedBillsNext = () => {
  if (linkedBillsPage.value < linkedBillsTotalPages.value) linkedBillsPage.value += 1
}

/** 盈亏行着色：正盈 / 负亏 / 零 / 无法判断 */
type PnlTone = 'pos' | 'neg' | 'zero' | 'neutral'

const parsePnlString = (raw: string | null | undefined): number | null => {
  if (raw == null || raw === '' || raw === '—') return null
  const n = Number(String(raw).trim())
  return Number.isFinite(n) ? n : null
}

const toneFromNumber = (n: number | null): PnlTone => {
  if (n === null) return 'neutral'
  if (n > 0) return 'pos'
  if (n < 0) return 'neg'
  return 'zero'
}

/** 与后端一致：多 (mark−entry)/entry，空 (entry−mark)/entry；符号表示盈亏方向 */
const pnlToneFromAvgMark = (
  avgPx: string | null | undefined,
  markPx: string | null | undefined,
  posSide: string | null | undefined,
): PnlTone => {
  const avg = Number(String(avgPx ?? '').trim())
  const mark = Number(String(markPx ?? '').trim())
  if (!Number.isFinite(avg) || !Number.isFinite(mark) || avg === 0) return 'neutral'
  const side = (posSide ?? '').toLowerCase()
  let rel: number
  if (side === 'short') {
    rel = (avg - mark) / avg
  } else {
    rel = (mark - avg) / avg
  }
  if (rel > 0) return 'pos'
  if (rel < 0) return 'neg'
  return 'zero'
}

/**
 * 收益率（%）：与盈亏方向一致。多 (mark−avg)/avg×100；空 (avg−mark)/avg×100。
 * mark 可为展示用字符串（含 —）。
 */
const formatRoiPct = (
  avgPx: string | null | undefined,
  markPx: string | number | null | undefined,
  posSide: string | null | undefined,
): string => {
  const avg = Number(String(avgPx ?? '').trim())
  const mRaw =
    markPx === null || markPx === undefined || markPx === '' || markPx === '—'
      ? NaN
      : Number(String(markPx).trim())
  if (!Number.isFinite(avg) || !Number.isFinite(mRaw) || avg === 0) return '—'
  const side = (posSide ?? '').toLowerCase()
  const rel = side === 'short' ? (avg - mRaw) / avg : (mRaw - avg) / avg
  const pct = rel * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

/** 展示接口返回的 uplRatio（已含 % 则原样，否则末尾补 %） */
const formatApiUplRatio = (raw: string | null | undefined): string | null => {
  if (raw == null || String(raw).trim() === '') return null
  const s = String(raw).trim()
  if (/%/.test(s)) return s
  return `${s}%`
}

const snapshotRoiDisplay = (p: PositionSnapshotRow): string => {
  const api = formatApiUplRatio(p.upl_ratio)
  if (api) return api
  return formatRoiPct(p.avg_px, p.last_px, p.pos_side)
}

/**
 * 欧易 GET /account/positions 的 uplRatio：多为小数比率（如 0.0523 = 5.23%）。
 * 无百分号时 ×100 再格式化为两位小数 + %；字段已带 % 则视为已是百分数，不再 ×100。
 */
const formatOkxPositionsUplRatioPct = (raw: string): string | null => {
  if (raw === '—' || !String(raw).trim()) return null
  const s0 = String(raw).trim()
  const hadPct = /%/.test(s0)
  const s = s0.replace(/%/g, '').trim().replace(/,/g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const pct = hadPct ? n : n * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

const linkedPosRoiDisplay = (r: Record<string, unknown>): string => {
  const ur = pickLinkedStr(r, ['uplRatio'])
  if (ur !== '—') {
    const fromApi = formatOkxPositionsUplRatioPct(ur)
    if (fromApi) return fromApi
  }
  const avg = pickLinkedStr(r, ['avgPx'])
  const mark = pickLinkedStr(r, ['markPx', 'last'])
  const side = pickLinkedStr(r, ['posSide'])
  return formatRoiPct(
    avg === '—' ? null : avg,
    mark === '—' ? null : mark,
    side === '—' ? null : side,
  )
}

/** 跟单持仓行盈亏色：优先用欧易 upl（与收益额一致），否则回退均价/标记价推算 */
const linkedPosPnlTone = (r: Record<string, unknown>): PnlTone => {
  const uplRaw = pickLinkedStr(r, ['upl'])
  if (uplRaw !== '—') {
    const t = toneFromNumber(parsePnlString(uplRaw))
    if (t !== 'neutral') return t
  }
  const avg = pickLinkedStr(r, ['avgPx'])
  const mark = pickLinkedStr(r, ['markPx', 'last'])
  const side = pickLinkedStr(r, ['posSide'])
  return pnlToneFromAvgMark(
    avg === '—' ? null : avg,
    mark === '—' ? null : mark,
    side === '—' ? null : side,
  )
}

const eventRoiDisplay = (e: PositionEventRow): string => {
  const api = formatApiUplRatio(e.upl_ratio)
  if (api) return api
  return formatRoiPct(e.avg_px, eventMarkPx(e), e.pos_side)
}

/** 模拟行收益率：按开仓均价与当前标记/平仓价 */
const simRoiDisplayRow = (r: FollowSimRecordRow): string => {
  const px =
    r.status === 'open' ? r.last_mark_px : (r.exit_px ?? r.last_mark_px)
  return formatRoiPct(r.entry_avg_px, px ?? null, r.pos_side)
}

const simRowMarkTone = (r: FollowSimRecordRow): PnlTone =>
  pnlToneFromAvgMark(
    r.entry_avg_px,
    simPxLabel(r) === '—' ? null : simPxLabel(r),
    r.pos_side,
  )

/** 已平仓用平仓时间，在仓用记录更新时间 */
const simUpdatedCol = (r: FollowSimRecordRow): string => {
  if (r.status === 'closed' && r.closed_at) return formatTime(r.closed_at)
  return formatTime(r.updated_at)
}

/** 跟单记录：开仓时间（接口 cTime 毫秒/秒；无则回退事件时间） */
const formatEventOpenTime = (e: PositionEventRow): string => {
  const ct = e.c_time
  if (ct != null && String(ct).trim() !== '') {
    const n = Number(String(ct).trim())
    if (Number.isFinite(n) && n >= 1e12) return formatTime(new Date(n).toISOString())
    if (Number.isFinite(n) && n >= 1e9) return formatTime(new Date(n * 1000).toISOString())
  }
  return formatTime(e.created_at)
}

const roiClassFromTone = (t: PnlTone): string => {
  if (t === 'pos') return 'mono sm roi-pct roi-pct-pos'
  if (t === 'neg') return 'mono sm roi-pct roi-pct-neg'
  if (t === 'zero') return 'mono sm roi-pct roi-pct-zero'
  return 'mono sm roi-pct text-muted'
}

const rowClassFromPnlTone = (t: PnlTone): string => {
  if (t === 'pos') return 'row-pnl-pos'
  if (t === 'neg') return 'row-pnl-neg'
  if (t === 'zero') return 'row-pnl-zero'
  return ''
}

const badgeClassFromPnlTone = (t: PnlTone): string => {
  if (t === 'pos') return 'badge text-bg-success'
  if (t === 'neg') return 'badge text-bg-danger'
  if (t === 'zero') return 'badge text-bg-secondary'
  return 'badge text-bg-secondary'
}

/** 总收益符号：正 / 负 / 零 / 无数据，用于着色 */
const toneFromSumString = (raw: string): PnlTone => {
  if (raw === '' || raw === '—') return 'neutral'
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n)) return 'neutral'
  if (n > 0) return 'pos'
  if (n < 0) return 'neg'
  return 'zero'
}

const simTotalPnlTone = computed(() => toneFromSumString(simTotalPnl.value))

const simRealizedPnlTone = computed(() => toneFromSumString(simRealizedSum.value))

const simUnrealizedPnlTone = computed(() => toneFromSumString(simUnrealizedSum.value))

/** 对方快照表头汇总：各仓 upl 之和 */
const snapshotHoldingsSectionHint =
  '总收益 = 已实现 + 浮动。浮动 = 本表「对方持仓」各行收益额（upl）之和；当前无已平仓分项，已实现显示 0。'

/** 本人 OKX 持仓表头汇总：各仓 upl 之和 */
const linkedHoldingsSectionHint =
  '总收益 = 已实现 + 浮动。浮动 = 本表「我的持仓」各行收益额（upl）之和；当前无已平仓分项，已实现显示 0。'

const snapshotUplSumUsdt = computed(() => {
  let s = 0
  for (const p of snapshot.value?.positions ?? []) {
    const n = parsePnlString(p.upl)
    if (n !== null) s += n
  }
  return s
})

const linkedUplSumUsdt = computed(() => {
  let s = 0
  for (const r of linkedPosRows.value) {
    if (!isLinkedCurrentPosition(r)) continue
    const raw = pickLinkedStr(r, ['upl'])
    if (raw === '—') continue
    const n = parsePnlString(raw)
    if (n !== null) s += n
  }
  return s
})

/** 已实现：两表均无已平仓分项，固定 0 */
const snapshotHoldingsRealizedUsdt = computed(() => 0)
const snapshotHoldingsUnrealizedUsdt = computed(() => snapshotUplSumUsdt.value)
const snapshotHoldingsTotalUsdt = computed(
  () => snapshotHoldingsRealizedUsdt.value + snapshotHoldingsUnrealizedUsdt.value,
)

const snapshotHoldingsTotalTone = computed(() =>
  toneFromNumber(snapshotHoldingsTotalUsdt.value),
)
const snapshotHoldingsRealizedTone = computed(() =>
  toneFromNumber(snapshotHoldingsRealizedUsdt.value),
)
const snapshotHoldingsUnrealizedTone = computed(() =>
  toneFromNumber(snapshotHoldingsUnrealizedUsdt.value),
)

const linkedHoldingsRealizedUsdt = computed(() => 0)
const linkedHoldingsUnrealizedUsdt = computed(() => linkedUplSumUsdt.value)
const linkedHoldingsTotalUsdt = computed(
  () => linkedHoldingsRealizedUsdt.value + linkedHoldingsUnrealizedUsdt.value,
)

const linkedHoldingsTotalTone = computed(() =>
  toneFromNumber(linkedHoldingsTotalUsdt.value),
)
const linkedHoldingsRealizedTone = computed(() =>
  toneFromNumber(linkedHoldingsRealizedUsdt.value),
)
const linkedHoldingsUnrealizedTone = computed(() =>
  toneFromNumber(linkedHoldingsUnrealizedUsdt.value),
)

const goSimPrev = () => {
  if (simPage.value <= 1) return
  simPage.value -= 1
  void loadSimRecords(false)
}

const goSimNext = () => {
  if (simPage.value >= simTotalPages.value) return
  simPage.value += 1
  void loadSimRecords(false)
}

const goEventsPrev = () => {
  if (eventsPage.value <= 1) return
  eventsPage.value -= 1
  void loadEvents(false)
}

const goEventsNext = () => {
  if (eventsPage.value >= eventsTotalPages.value) return
  eventsPage.value += 1
  void loadEvents(false)
}

const current = computed(() => {
  const want = paramUniqueName.value
  if (!want) return null
  return accounts.value.find((a) => a.unique_name === want) ?? null
})

const parseNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v))
  return Number.isFinite(n) ? n : null
}

const syncFollowCfgFromCurrent = () => {
  const c = current.value
  if (!c) return
  followCfg.value = {
    bet_amount_per_position: parseNum(c.bet_amount_per_position),
    max_follow_positions: parseNum(c.max_follow_positions),
    margin_add_ratio_of_bet: parseNum(c.margin_add_ratio_of_bet) ?? 0.2,
    margin_auto_enabled: Boolean(c.margin_auto_enabled),
    margin_add_max_times: parseNum(c.margin_add_max_times),
    maint_margin_ratio_threshold: parseNum(c.maint_margin_ratio_threshold),
    close_margin_ratio_threshold: parseNum(c.close_margin_ratio_threshold),
    take_profit_ratio: parseNum(c.take_profit_ratio),
    stop_loss_ratio: parseNum(c.stop_loss_ratio),
    live_trading_enabled: Boolean(c.live_trading_enabled),
  }
}

/**
 * 仅在「当前帐户 id」变化时从列表同步表单（切换用户 / 首次加载出 current）。
 * 不在每次轮询刷新 accounts 时同步，否则会冲掉未保存的输入。
 */
watch(
  () => current.value?.id,
  (id, prevId) => {
    if (id == null) return
    if (prevId !== undefined && id === prevId) return
    syncFollowCfgFromCurrent()
  },
  { immediate: true },
)

watch(
  () => current.value?.id,
  (id, prevId) => {
    const c = current.value
    if (c == null) {
      okxBindSelect.value = ''
      return
    }
    if (prevId !== undefined && id === prevId) return
    okxBindSelect.value = c.okx_api_account_id != null ? String(c.okx_api_account_id) : ''
  },
  { immediate: true },
)

const onMarginAddMaxTimesInput = (ev: Event) => {
  const raw = (ev.target as HTMLInputElement).value.trim()
  if (raw === '') {
    followCfg.value.margin_add_max_times = null
    return
  }
  const n = parseInt(raw, 10)
  followCfg.value.margin_add_max_times = Number.isFinite(n) && n > 0 ? n : null
}

const saveFollowConfig = async () => {
  const c = current.value
  if (!c) return
  configSaving.value = true
  configMsg.value = ''
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/${c.id}/follow-config`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({
        bet_amount_per_position: followCfg.value.bet_amount_per_position,
        max_follow_positions: followCfg.value.max_follow_positions,
        bet_mode: 'cost',
        margin_add_ratio_of_bet: followCfg.value.margin_add_ratio_of_bet,
        margin_auto_enabled: followCfg.value.margin_auto_enabled,
        margin_add_max_times: followCfg.value.margin_add_max_times,
        maint_margin_ratio_threshold: followCfg.value.maint_margin_ratio_threshold,
        close_margin_ratio_threshold: followCfg.value.close_margin_ratio_threshold,
        take_profit_ratio: followCfg.value.take_profit_ratio,
        stop_loss_ratio: followCfg.value.stop_loss_ratio,
        live_trading_enabled: followCfg.value.live_trading_enabled,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { detail?: string }
    if (!res.ok) {
      configMsg.value = data.detail || `保存失败 (${res.status})`
      return
    }
    configMsg.value = '已保存'
    await loadList(true)
    syncFollowCfgFromCurrent()
  } catch (e: unknown) {
    configMsg.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    configSaving.value = false
  }
}

const onEnabledChange = async (ev: Event) => {
  const c = current.value
  if (!c) return
  const el = ev.target as HTMLInputElement
  const enabled = el.checked
  enabledToggleMsg.value = ''
  enabledToggling.value = true
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/${c.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ enabled }),
    })
    if (!res.ok) {
      enabledToggleMsg.value =
        (await res.json().catch(() => ({}))).detail || `更新失败 (${res.status})`
      el.checked = !enabled
      return
    }
    const data = (await res.json()) as FollowRow
    c.enabled = data.enabled
    c.last_enabled_at = data.last_enabled_at
    c.positions_refreshed_at = data.positions_refreshed_at ?? null
    c.okx_api_account_id = data.okx_api_account_id ?? null
    okxBindSelect.value = c.okx_api_account_id != null ? String(c.okx_api_account_id) : ''
  } catch (e: unknown) {
    enabledToggleMsg.value = e instanceof Error ? e.message : '网络错误'
    el.checked = !enabled
  } finally {
    enabledToggling.value = false
  }
}

const isOkxOptionDisabled = (o: OkxApiListRow): boolean => {
  const c = current.value
  if (!c) return true
  if (o.bound_follow_account_id == null) return false
  return o.bound_follow_account_id !== c.id
}

const okxOptionLabel = (o: OkxApiListRow): string => {
  const label = o.okx_follow_api_label?.trim() || '无标签'
  const rm = o.remark?.trim()
  const base = `#${o.id} · ${label}${rm ? ` · ${rm}` : ''}`
  if (o.bound_follow_account_id != null && current.value && o.bound_follow_account_id !== current.value.id) {
    return `${base}（已绑定其他交易员）`
  }
  return base
}

const saveOkxBind = async () => {
  const c = current.value
  if (!c || c.enabled) return
  okxBindSaving.value = true
  okxBindMsg.value = ''
  const raw = okxBindSelect.value.trim()
  let newId: number | null = null
  if (raw !== '') {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) {
      okxBindMsg.value = '请选择有效的 API 帐户'
      okxBindSaving.value = false
      return
    }
    newId = n
  }
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/${c.id}/okx-bind`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ okx_api_account_id: newId }),
    })
    const data = (await res.json().catch(() => ({}))) as FollowRow & { detail?: string }
    if (!res.ok) {
      okxBindMsg.value = data.detail || `保存失败 (${res.status})`
      return
    }
    okxBindMsg.value = '绑定已保存'
    await loadList(true)
    await loadOkxApiList(true)
    const row = accounts.value.find((a) => a.id === c.id)
    if (row) {
      row.okx_api_account_id = data.okx_api_account_id ?? null
      okxBindSelect.value = row.okx_api_account_id != null ? String(row.okx_api_account_id) : ''
    }
  } catch (e: unknown) {
    okxBindMsg.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    okxBindSaving.value = false
  }
}

/** 解除 OKX 绑定；与后端一致：跟单启用中不可解绑。 */
const clearOkxBind = async () => {
  const c = current.value
  if (!c || c.enabled || c.okx_api_account_id == null) return
  okxBindSaving.value = true
  okxBindMsg.value = ''
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/${c.id}/okx-bind`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ okx_api_account_id: null }),
    })
    const data = (await res.json().catch(() => ({}))) as FollowRow & { detail?: string }
    if (!res.ok) {
      okxBindMsg.value =
        typeof data.detail === 'string' ? data.detail : `解除失败 (${res.status})`
      return
    }
    okxBindMsg.value = '已取消绑定'
    await loadList(true)
    await loadOkxApiList(true)
    const row = accounts.value.find((a) => a.id === c.id)
    if (row) {
      row.okx_api_account_id = data.okx_api_account_id ?? null
      okxBindSelect.value = ''
    }
    void loadLinkedOkxTradeData(false)
  } catch (e: unknown) {
    okxBindMsg.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    okxBindSaving.value = false
  }
}

/** USDT 类金额：固定 3 位小数 */
const formatUsdt3 = (raw: string | number | null | undefined): string => {
  if (raw === null || raw === undefined || raw === '') return '—'
  if (raw === '—') return '—'
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n)) return String(raw)
  return n.toFixed(3)
}

const trimTrailingZeros = (s: string): string => {
  if (!s.includes('.')) return s
  return s.replace(/\.?0+$/, '')
}

/**
 * 开仓均价：6 位有效数字；若整数位超过 6 位则保留 2 位小数。
 * 例：3242424.87831 → 3242424.88；0.00000045678 → 0.00000045678（6 位有效数字）
 */
const formatAvgPx = (raw: string | null | undefined): string => {
  if (raw == null || raw === '') return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return String(raw)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const intPart = Math.floor(abs)
  const intLen = intPart === 0 ? 0 : String(intPart).length
  if (intLen > 6) return sign + abs.toFixed(2)
  if (abs === 0) return '0'
  const s = abs.toPrecision(6)
  const v = Number(s)
  const exp = Math.floor(Math.log10(v))
  const dec = Math.max(0, 5 - exp)
  const rounded = Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)
  return sign + trimTrailingZeros(rounded.toFixed(dec))
}

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

/** OKX posSide：long→做多，short→做空；其余原样展示 */
const formatPosSide = (raw: string | null | undefined): string => {
  if (raw == null || String(raw).trim() === '') return '—'
  const s = String(raw).trim().toLowerCase()
  if (s === 'long') return '做多'
  if (s === 'short') return '做空'
  return String(raw).trim()
}

/** 杠杆：空串与 null 统一显示为 —（仅 ?? 无法覆盖 ""） */
const formatLever = (raw: string | null | undefined): string => {
  if (raw == null) return '—'
  const s = String(raw).trim()
  return s === '' ? '—' : s
}

/** 跟单记录：未平仓从快照取杠杆；已平仓尝试从当前页开仓事件补全 */
const simLeverFromEvents = (posId: string): string | null => {
  for (const e of events.value) {
    if (
      e.pos_id === posId &&
      e.event_type === 'open' &&
      e.lever != null &&
      String(e.lever).trim() !== ''
    ) {
      return String(e.lever).trim()
    }
  }
  return null
}

const simLeverDisplay = (r: FollowSimRecordRow): string => {
  const snap = snapshotByPosId.value.get(r.pos_id)?.lever
  if (snap != null && String(snap).trim() !== '') return String(snap).trim()
  const fromEv = simLeverFromEvents(r.pos_id)
  if (fromEv) return fromEv
  return '—'
}

const listItems = computed(() =>
  accounts.value.filter((a) => a.unique_name != null && String(a.unique_name).length > 0),
)

/** 当前快照 posId -> 行，用于历史表里叠实时标记价 */
const snapshotByPosId = computed(() => {
  const m = new Map<string, PositionSnapshotRow>()
  for (const p of snapshot.value?.positions ?? []) {
    if (p.pos_id) m.set(p.pos_id, p)
  }
  return m
})

/** 该行对应仓位是否已平：平仓记录，或开仓记录但该 posId 已不在当前快照中 */
const positionClosedForEvent = (e: PositionEventRow): boolean => {
  if (e.event_type === 'close') return true
  const pid = e.pos_id
  if (!pid) return true
  return !snapshotByPosId.value.has(pid)
}

const eventMarkPx = (e: PositionEventRow) => {
  if (positionClosedForEvent(e)) return e.last_px ?? '—'
  const pid = e.pos_id
  if (!pid) return e.last_px ?? '—'
  const live = snapshotByPosId.value.get(pid)?.last_px
  if (live != null && String(live).length > 0) return live
  return e.last_px ?? '—'
}

/** 盈亏 USDT：未平仓用快照实时 upl；已平仓用事件 detail 入库值 */
const eventUplRaw = (e: PositionEventRow): string | null => {
  if (!positionClosedForEvent(e) && e.pos_id) {
    const live = snapshotByPosId.value.get(e.pos_id)?.upl
    if (live != null && String(live).trim() !== '') return String(live).trim()
  }
  if (e.upl != null && String(e.upl).trim() !== '') return String(e.upl).trim()
  return null
}

const formatUplUsdt = (raw: string | null | undefined): string =>
  raw == null || String(raw).trim() === '' ? '—' : formatUsdt3(raw)

const uplCellClass = (raw: string | null | undefined): string =>
  roiClassFromTone(toneFromNumber(parsePnlString(raw)))

/** 展示用盈亏：在跟为浮动，已平仓为已实现 */
const simPnlDisplay = (r: FollowSimRecordRow) => {
  if (r.status === 'open') return r.unrealized_pnl_usdt
  return r.realized_pnl_usdt ?? '—'
}

const simPxLabel = (r: FollowSimRecordRow) =>
  r.status === 'open' ? r.last_mark_px ?? '—' : r.exit_px ?? r.last_mark_px ?? '—'

const simPnlTone = (r: FollowSimRecordRow): PnlTone =>
  toneFromNumber(parsePnlString(simPnlDisplay(r)))

/** 跟单记录扩展列：无数据时显示空字符串 */
const simRecordExtraText = (raw: string | null | undefined): string => {
  if (raw == null || String(raw).trim() === '') return ''
  return String(raw).trim()
}

/** 保证金：可解析为数字时四舍五入保留 2 位小数 */
const formatMarginRound2 = (raw: string | null | undefined): string => {
  if (raw == null || String(raw).trim() === '') return '—'
  const s = String(raw).trim().replace(/,/g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return String(raw).trim()
  return (Math.round(n * 100) / 100).toFixed(2)
}

const formatMarginWithU = (raw: string | null | undefined): string => {
  const s = formatMarginRound2(raw)
  return s === '—' ? '—' : `${s}u`
}

/** 持仓量：数字后加「张」 */
const formatPosContractsDisplay = (raw: string | null | undefined): string => {
  const t = simRecordExtraText(raw)
  return t === '' ? '—' : `${t}张`
}

/** 维持保证金率：×100 后四舍五入保留 2 位小数，并加 % */
const formatMaintMarginRatioPct = (raw: string | null | undefined): string => {
  if (raw == null || String(raw).trim() === '') return '—'
  const s = String(raw).trim().replace(/,/g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return String(raw).trim()
  const pct = n * 100
  return (Math.round(pct * 100) / 100).toFixed(2) + '%'
}

/** 开平仓行：未平仓时优先用当前快照里的对方指标 */
const eventLiveMetric = (
  e: PositionEventRow,
  snapKey: keyof PositionSnapshotRow,
  eventKey: keyof PositionEventRow,
): string => {
  if (!positionClosedForEvent(e) && e.pos_id) {
    const snap = snapshotByPosId.value.get(e.pos_id)
    const live = snap?.[snapKey]
    if (live != null && String(live).trim() !== '') return String(live).trim()
  }
  const v = e[eventKey]
  return simRecordExtraText(v as string | null | undefined)
}

const formatEventPosContracts = (e: PositionEventRow): string => {
  const v = eventLiveMetric(e, 'pos', 'pos')
  return v === '' ? '—' : `${v}张`
}

/** 按币种字母序 a→z，不区分大小写；无币种排最后；同币种再按 posId 稳定排序 */
const comparePosCcy = (a: string | null | undefined, b: string | null | undefined): number => {
  const ca = (a ?? '').trim().toLowerCase()
  const cb = (b ?? '').trim().toLowerCase()
  if (ca === '' && cb === '') return 0
  if (ca === '') return 1
  if (cb === '') return -1
  return ca.localeCompare(cb, 'en', { sensitivity: 'base' })
}

/** 当前持仓行装饰（避免模板内重复计算 tone） */
const snapshotRowsDecorated = computed(() =>
  [...(snapshot.value?.positions ?? [])]
    .sort((a, b) => {
      const c = comparePosCcy(a.pos_ccy, b.pos_ccy)
      if (c !== 0) return c
      return String(a.pos_id).localeCompare(String(b.pos_id), 'en', { sensitivity: 'base' })
    })
    .map((p) => {
      const tone = pnlToneFromAvgMark(p.avg_px, p.last_px, p.pos_side)
      return {
        p,
        tone,
        rowClass: rowClassFromPnlTone(tone),
        badgeClass: badgeClassFromPnlTone(tone),
      }
    }),
)

const linkedMarginCell = (r: Record<string, unknown>): string => {
  const m = pickLinkedStr(r, ['margin'])
  if (m !== '—') return formatMarginWithU(m)
  const im = pickLinkedStr(r, ['imr'])
  return formatMarginWithU(im === '—' ? undefined : im)
}

/** 本人持仓仅展示当前仓位：pos 数值存在且绝对值 > 0。 */
const isLinkedCurrentPosition = (r: Record<string, unknown>): boolean => {
  const raw = pickLinkedStr(r, ['pos'])
  if (raw === '—') return false
  const n = Number(String(raw).trim().replace(/,/g, ''))
  return Number.isFinite(n) && Math.abs(n) > 1e-12
}

/** 跟单持仓（欧易 positions）：列与对方持仓对齐，排序规则与快照一致 */
const linkedPosRowsDecorated = computed(() =>
  [...linkedPosRows.value]
    .filter((r) => isLinkedCurrentPosition(r))
    .sort((a, b) => {
      const ca = instIdBaseCcy(pickLinkedStr(a, ['instId']))
      const cb = instIdBaseCcy(pickLinkedStr(b, ['instId']))
      const c = comparePosCcy(ca === '—' ? '' : ca, cb === '—' ? '' : cb)
      if (c !== 0) return c
      return pickLinkedStr(a, ['posId']).localeCompare(pickLinkedStr(b, ['posId']), 'en', {
        sensitivity: 'base',
      })
    })
    .map((r) => {
      const tone = linkedPosPnlTone(r)
      return {
        r,
        tone,
        rowClass: rowClassFromPnlTone(tone),
        badgeClass: badgeClassFromPnlTone(tone),
      }
    }),
)

/** 跟单记录：当前页内按币种排序（与持仓一致） */
const simRecordDeletingId = ref<number | null>(null)
const simActionRunningId = ref<number | null>(null)
const snapshotFollowRunningPosId = ref<string | null>(null)

const deleteSimRecord = async (r: FollowSimRecordRow) => {
  const un = paramUniqueName.value
  if (!un) return
  simRecordDeletingId.value = r.id
  simError.value = ''
  try {
    const qs = new URLSearchParams({ unique_name: un })
    const res = await fetch(
      `${API_BASE}/follow-accounts/follow-sim-records/${r.id}?${qs}`,
      { method: 'DELETE', headers: authHeaders() },
    )
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown }
    if (!res.ok) {
      const d = body.detail
      simError.value =
        typeof d === 'string' ? d : d != null ? JSON.stringify(d) : `删除失败 (${res.status})`
      return
    }
    await loadSimRecords(false)
  } catch (e: unknown) {
    simError.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    simRecordDeletingId.value = null
  }
}

const onPositionActionClick = async (
  action: 'add' | 'reduce' | 'close' | 'reverse',
  r: FollowSimRecordRow,
) => {
  const un = paramUniqueName.value
  if (!un) return
  simActionRunningId.value = r.id
  simError.value = ''
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/position-action`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        unique_name: un,
        sim_record_id: r.id,
        action,
      }),
    })
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown }
    if (!res.ok) {
      const d = body.detail
      simError.value =
        typeof d === 'string' ? d : d != null ? JSON.stringify(d) : `操作失败 (${res.status})`
      return
    }
    await Promise.all([loadSimRecords(true), loadLinkedOkxTradeData(true)])
  } catch (e: unknown) {
    simError.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    simActionRunningId.value = null
  }
}

const hasLinkedPositionForRecord = (r: FollowSimRecordRow): boolean => {
  const ccy = String(r.pos_ccy ?? '').trim().toUpperCase()
  if (!ccy) return false
  return linkedPosRowsDecorated.value.some(
    (row) => instIdBaseCcy(pickLinkedStr(row.r, ['instId'])).toUpperCase() === ccy,
  )
}

const hasLinkedPositionForCcy = (ccyRaw: string | null | undefined): boolean => {
  const ccy = String(ccyRaw ?? '').trim().toUpperCase()
  if (!ccy) return false
  return linkedPosRowsDecorated.value.some(
    (row) => instIdBaseCcy(pickLinkedStr(row.r, ['instId'])).toUpperCase() === ccy,
  )
}

const onSnapshotFollowClick = async (p: PositionSnapshotRow) => {
  const un = paramUniqueName.value
  const posId = String(p.pos_id ?? '').trim()
  if (!un || !posId) return
  snapshotFollowRunningPosId.value = posId
  simError.value = ''
  try {
    const res = await fetch(`${API_BASE}/follow-accounts/snapshot-follow`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        unique_name: un,
        pos_id: posId,
      }),
    })
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown }
    if (!res.ok) {
      const d = body.detail
      simError.value = typeof d === 'string' ? d : d != null ? JSON.stringify(d) : `跟单失败 (${res.status})`
      return
    }
    await Promise.all([loadSimRecords(true), loadLinkedOkxTradeData(true)])
  } catch (e: unknown) {
    simError.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    snapshotFollowRunningPosId.value = null
  }
}

const simRecordsSorted = computed(() =>
  [...simRecords.value].sort((a, b) => {
    const c = comparePosCcy(a.pos_ccy, b.pos_ccy)
    if (c !== 0) return c
    return String(a.pos_id).localeCompare(String(b.pos_id), 'en', { sensitivity: 'base' })
  }),
)
/**
 * 持仓操作按“对方仓位”展示：同一 pos_id 仅保留最新一条记录（避免开平后重复）。
 * 手动平掉本人仓位后，该条仍保留，可继续点「开仓」重新跟。
 */
const simRecordsLatestByPos = computed(() => {
  const byPos = new Map<string, FollowSimRecordRow>()
  for (const r of simRecords.value) {
    const k = String(r.pos_id ?? '').trim()
    if (!k) continue
    const prev = byPos.get(k)
    if (!prev || r.id > prev.id) byPos.set(k, r)
  }
  return [...byPos.values()].sort((a, b) => {
    const c = comparePosCcy(a.pos_ccy, b.pos_ccy)
    if (c !== 0) return c
    return String(a.pos_id).localeCompare(String(b.pos_id), 'en', { sensitivity: 'base' })
  })
})
const simOpsShownCount = computed(() => simRecordsLatestByPos.value.length)

const simInvestedByCloseEventId = computed(() => {
  const m = new Map<number, string>()
  for (const r of simRecords.value) {
    const eid = r.close_event_id
    if (eid == null) continue
    if (r.total_invested_usdt == null || String(r.total_invested_usdt).trim() === '') continue
    if (!m.has(eid)) m.set(eid, String(r.total_invested_usdt))
  }
  return m
})

const eventInvestedDisplay = (e: PositionEventRow): string => {
  const v = simInvestedByCloseEventId.value.get(e.id)
  return v == null ? '—' : formatUsdt3(v)
}

/** 跟单记录仅展示已平仓事件（close），隐藏正在持仓。 */
const closedEventsOnly = computed(() => events.value.filter((e) => e.event_type === 'close'))

/** 开平仓行：未平仓用实时标记价；已平仓用记录内均价/标记价估算方向 */
const eventPnlTone = (e: PositionEventRow): PnlTone => {
  const mark = positionClosedForEvent(e) ? e.last_px : eventMarkPx(e)
  return pnlToneFromAvgMark(e.avg_px, mark, e.pos_side)
}
</script>

<template>
  <div class="detail-layout">
    <aside class="detail-aside">
      <div class="aside-head">
        <RouterLink class="back-home" to="/">← 跟单帐户</RouterLink>
        <RouterLink class="back-home aside-okx-link" to="/okx-api-accounts">OKX API 帐户</RouterLink>
        <div class="aside-title">已添加用户</div>
      </div>
      <div v-if="loading" class="aside-empty">加载中…</div>
      <div v-else-if="error" class="aside-err">{{ error }}</div>
      <nav v-else class="aside-nav">
        <RouterLink
          v-for="u in listItems"
          :key="u.id"
          class="user-link"
          :class="{ active: u.unique_name === paramUniqueName }"
          :to="{ name: 'followDetail', params: { uniqueName: u.unique_name! } }"
        >
          <span class="user-name">{{ u.nickname || u.unique_name }}</span>
          <span class="user-meta">
            <span v-if="u.enabled" class="tag on">启用</span>
            <span v-else class="tag off">停用</span>
          </span>
        </RouterLink>
      </nav>
    </aside>

    <main class="detail-main">
      <div v-if="loading" class="main-empty">加载中…</div>
      <div v-else-if="!current" class="main-empty">
        <p>未找到该 uniqueName 对应的帐户，或列表尚未包含该用户。</p>
        <RouterLink class="back-home" to="/">返回跟单帐户</RouterLink>
      </div>
      <template v-else>
        <div class="detail-main-grid detail-two-col">
          <div class="detail-col-main">
            <section class="card-block snapshot-card">
          <h2 class="mb-3 detail-panel-title">
            <span
              class="btn btn-warning hint-cursor"
              :title="snapshotSectionHint"
            >对方持仓</span>
          </h2>
          <div class="sim-totals subsection-gap" :title="snapshotHoldingsSectionHint">
            <span class="sim-total-pill">
              总收益（USDT）<strong
                class="mono sim-total-pnl-val"
                :class="{
                  'sim-total-pnl-pos': snapshotHoldingsTotalTone === 'pos',
                  'sim-total-pnl-neg': snapshotHoldingsTotalTone === 'neg',
                  'sim-total-pnl-zero': snapshotHoldingsTotalTone === 'zero',
                  'sim-total-pnl-neutral': snapshotHoldingsTotalTone === 'neutral',
                }"
              >{{ formatUsdt3(snapshotHoldingsTotalUsdt) }}</strong>
            </span>
            <span class="sim-total-meta small">
              <span class="text-muted">已实现 </span>
              <strong
                class="mono sim-sub-pnl-val"
                :class="{
                  'sim-total-pnl-pos': snapshotHoldingsRealizedTone === 'pos',
                  'sim-total-pnl-neg': snapshotHoldingsRealizedTone === 'neg',
                  'sim-total-pnl-zero': snapshotHoldingsRealizedTone === 'zero',
                  'sim-total-pnl-neutral': snapshotHoldingsRealizedTone === 'neutral',
                }"
              >{{ formatUsdt3(snapshotHoldingsRealizedUsdt) }}</strong>
              <span class="text-muted"> · </span>
              <span class="text-muted">浮动 </span>
              <strong
                class="mono sim-sub-pnl-val"
                :class="{
                  'sim-total-pnl-pos': snapshotHoldingsUnrealizedTone === 'pos',
                  'sim-total-pnl-neg': snapshotHoldingsUnrealizedTone === 'neg',
                  'sim-total-pnl-zero': snapshotHoldingsUnrealizedTone === 'zero',
                  'sim-total-pnl-neutral': snapshotHoldingsUnrealizedTone === 'neutral',
                }"
              >{{ formatUsdt3(snapshotHoldingsUnrealizedUsdt) }}</strong>
            </span>
          </div>
          <div v-if="snapshotLoading && !snapshot" class="muted">加载快照中…</div>
          <div v-else-if="snapshotError" class="aside-err">{{ snapshotError }}</div>
          <template v-else-if="snapshot">
            <div class="detail-table-rounded subsection-gap">
              <div class="table-responsive">
              <table
                class="table table-striped table-hover table-sm table-bordered align-middle mb-0 table-pos-aligned"
              >
                <thead class="table-light">
                  <tr>
                    <th>持仓编号</th>
                    <th>币种</th>
                    <th>方向</th>
                    <th>杠杆</th>
                    <th>收益额</th>
                    <th>收益率</th>
                    <th>持仓量</th>
                    <th>保证金</th>
                    <th>维持保证金率</th>
                    <th>开仓均价</th>
                    <th>标记价格</th>
                    <th>预估强平价</th>
                    <th>开仓时间</th>
                    <th>更新时间</th>
                    <th class="nowrap sm">跟单</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in snapshotRowsDecorated"
                    :key="row.p.pos_id"
                    :class="row.rowClass"
                  >
                    <td class="mono td-pos-id">
                      <span v-if="row.tone !== 'neutral'" :class="row.badgeClass">{{ row.p.pos_id }}</span>
                      <template v-else>{{ row.p.pos_id }}</template>
                    </td>
                    <td>{{ row.p.pos_ccy ?? '—' }}</td>
                    <td>{{ formatPosSide(row.p.pos_side) }}</td>
                    <td>{{ formatLever(row.p.lever) }}</td>
                    <td :class="uplCellClass(row.p.upl)">{{ formatUplUsdt(row.p.upl) }}</td>
                    <td :class="roiClassFromTone(row.tone)">{{ snapshotRoiDisplay(row.p) }}</td>
                    <td class="mono sm">{{ formatPosContractsDisplay(row.p.pos) }}</td>
                    <td class="mono sm">{{ formatMarginWithU(row.p.margin) }}</td>
                    <td class="mono sm">{{ formatMaintMarginRatioPct(row.p.mgn_ratio) }}</td>
                    <td class="mono sm">{{ formatAvgPx(row.p.avg_px) }}</td>
                    <td class="mono sm mark-col">{{ row.p.last_px ?? '—' }}</td>
                    <td class="mono sm">{{ simRecordExtraText(row.p.liq_px) || '—' }}</td>
                    <td class="nowrap sm">{{ row.p.c_time_format ?? '—' }}</td>
                    <td class="nowrap sm">{{ formatTime(snapshot.refreshed_at) }}</td>
                    <td class="nowrap sm">
                      <button
                        v-if="!hasLinkedPositionForCcy(row.p.pos_ccy)"
                        type="button"
                        class="btn btn-sm btn-primary"
                        :disabled="snapshotFollowRunningPosId === row.p.pos_id"
                        @click="onSnapshotFollowClick(row.p)"
                      >
                        跟单
                      </button>
                      <span v-else class="text-muted">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          </template>
        </section>

        <section class="card-block follow-my-positions-card">
          <h2 class="mb-3 detail-panel-title">
            <span
              class="btn btn-warning hint-cursor"
              :title="followMyPositionsSectionHint"
            >我的持仓</span>
          </h2>
          <div class="sim-totals subsection-gap" :title="linkedHoldingsSectionHint">
            <span class="sim-total-pill">
              总收益（USDT）<strong
                class="mono sim-total-pnl-val"
                :class="{
                  'sim-total-pnl-pos': linkedHoldingsTotalTone === 'pos',
                  'sim-total-pnl-neg': linkedHoldingsTotalTone === 'neg',
                  'sim-total-pnl-zero': linkedHoldingsTotalTone === 'zero',
                  'sim-total-pnl-neutral': linkedHoldingsTotalTone === 'neutral',
                }"
              >{{ formatUsdt3(linkedHoldingsTotalUsdt) }}</strong>
            </span>
            <span class="sim-total-meta small">
              <span class="text-muted">已实现 </span>
              <strong
                class="mono sim-sub-pnl-val"
                :class="{
                  'sim-total-pnl-pos': linkedHoldingsRealizedTone === 'pos',
                  'sim-total-pnl-neg': linkedHoldingsRealizedTone === 'neg',
                  'sim-total-pnl-zero': linkedHoldingsRealizedTone === 'zero',
                  'sim-total-pnl-neutral': linkedHoldingsRealizedTone === 'neutral',
                }"
              >{{ formatUsdt3(linkedHoldingsRealizedUsdt) }}</strong>
              <span class="text-muted"> · </span>
              <span class="text-muted">浮动 </span>
              <strong
                class="mono sim-sub-pnl-val"
                :class="{
                  'sim-total-pnl-pos': linkedHoldingsUnrealizedTone === 'pos',
                  'sim-total-pnl-neg': linkedHoldingsUnrealizedTone === 'neg',
                  'sim-total-pnl-zero': linkedHoldingsUnrealizedTone === 'zero',
                  'sim-total-pnl-neutral': linkedHoldingsUnrealizedTone === 'neutral',
                }"
              >{{ formatUsdt3(linkedHoldingsUnrealizedUsdt) }}</strong>
            </span>
          </div>
          <div v-if="!current?.okx_api_account_id" class="muted mb-0">
            请先在右侧绑定 OKX API 帐户。绑定后此处展示该密钥在欧易的 U 本位永续持仓（私有接口 positions），与「对方持仓」社区数据无关。
          </div>
          <template v-else>
            <p v-if="linkedOkxErr" class="small text-danger mb-2">{{ linkedOkxErr }}</p>
            <div v-if="linkedPosRowsDecorated.length === 0" class="small text-muted mb-0">暂无持仓或暂无数据</div>
            <div v-else class="detail-table-rounded">
              <div class="table-responsive">
                <table
                  class="table table-striped table-hover table-sm table-bordered align-middle mb-0 table-pos-aligned linked-okx-table"
                >
                  <thead class="table-light">
                    <tr>
                      <th>持仓编号</th>
                      <th>币种</th>
                      <th>方向</th>
                      <th>杠杆</th>
                      <th>收益额</th>
                      <th>收益率</th>
                      <th>持仓量</th>
                      <th>保证金</th>
                      <th>维持保证金率</th>
                      <th>开仓均价</th>
                      <th>标记价格</th>
                      <th>预估强平价</th>
                      <th>开仓时间</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, i) in linkedPosRowsDecorated"
                      :key="'mypos-' + i + '-' + pickLinkedStr(row.r, ['posId', 'instId'])"
                      :class="row.rowClass"
                    >
                      <td class="mono td-pos-id">
                        <span v-if="row.tone !== 'neutral'" :class="row.badgeClass">{{
                          pickLinkedStr(row.r, ['posId'])
                        }}</span>
                        <template v-else>{{ pickLinkedStr(row.r, ['posId']) }}</template>
                      </td>
                      <td>{{ instIdBaseCcy(pickLinkedStr(row.r, ['instId'])) }}</td>
                      <td>{{ formatPosSide(pickLinkedStr(row.r, ['posSide'])) }}</td>
                      <td>{{ formatLever(pickLinkedStr(row.r, ['lever'])) }}</td>
                      <td :class="roiClassFromTone(row.tone)">{{
                        formatUplUsdt(pickLinkedStr(row.r, ['upl']))
                      }}</td>
                      <td :class="roiClassFromTone(row.tone)">{{ linkedPosRoiDisplay(row.r) }}</td>
                      <td class="mono sm">{{
                        formatPosContractsDisplay(
                          pickLinkedStr(row.r, ['pos']) === '—'
                            ? undefined
                            : pickLinkedStr(row.r, ['pos']),
                        )
                      }}</td>
                      <td class="mono sm">{{ linkedMarginCell(row.r) }}</td>
                      <td class="mono sm">{{
                        formatMaintMarginRatioPct(pickLinkedStr(row.r, ['mgnRatio']))
                      }}</td>
                      <td class="mono sm">{{ formatAvgPx(pickLinkedStr(row.r, ['avgPx'])) }}</td>
                      <td class="mono sm mark-col">{{
                        pickLinkedStr(row.r, ['markPx', 'last'])
                      }}</td>
                      <td class="mono sm">{{ simRecordExtraText(pickLinkedStr(row.r, ['liqPx'])) || '—' }}</td>
                      <td class="nowrap sm">{{ linkedOpenTimeDisplay(row.r) }}</td>
                      <td class="nowrap sm">{{
                        linkedOkxFetchedAt ? formatTime(linkedOkxFetchedAt) : '—'
                      }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
        </section>

        <section class="card-block sim-records-card">
          <h2 class="mb-3 detail-panel-title">
            <span
              class="btn btn-warning hint-cursor"
              :title="simRecordsSectionHint"
            >持仓操作</span>
          </h2>
          <div v-if="simLoading && simTotal === 0 && !simError" class="muted">加载中…</div>
          <div v-else-if="simError" class="aside-err">{{ simError }}</div>
          <template v-else>
            <div class="detail-table-rounded">
              <div class="table-responsive">
              <table
                class="table table-striped table-hover table-sm table-bordered align-middle mb-0 table-pos-aligned"
              >
                <thead class="table-light">
                  <tr>
                    <th>持仓编号</th>
                    <th>币种</th>
                    <th>方向</th>
                    <th>杠杆</th>
                    <th>本金</th>
                    <th>加仓次数</th>
                    <th>减仓次数</th>
                    <th>追加保证金次数</th>
                    <th class="nowrap sm">加仓</th>
                    <th class="nowrap sm">减仓</th>
                    <th class="nowrap sm">平仓</th>
                    <th class="nowrap sm">反手</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="r in simRecordsLatestByPos"
                    :key="r.id"
                    :class="rowClassFromPnlTone(simPnlTone(r))"
                  >
                    <td class="mono td-pos-id">
                      <span
                        v-if="r.status === 'open' && simPnlTone(r) !== 'neutral'"
                        :class="badgeClassFromPnlTone(simPnlTone(r))"
                      >{{ r.pos_id }}</span>
                      <template v-else>{{ r.pos_id }}</template>
                    </td>
                    <td>{{ r.pos_ccy ?? '—' }}</td>
                    <td>{{ formatPosSide(r.pos_side) }}</td>
                    <td>{{ simLeverDisplay(r) }}</td>
                    <td class="mono sm">{{ formatUsdt3(r.stake_usdt) }}</td>
                    <td class="mono sm">{{ r.add_position_count ?? 0 }}</td>
                    <td class="mono sm">{{ r.reduce_position_count ?? 0 }}</td>
                    <td class="mono sm">{{ r.add_margin_count ?? 0 }}</td>
                    <td class="nowrap sm">
                      <button
                        type="button"
                        class="btn btn-sm btn-primary"
                        :disabled="simActionRunningId === r.id"
                        @click="onPositionActionClick('add', r)"
                      >
                        {{ hasLinkedPositionForRecord(r) ? '加仓' : '开仓' }}
                      </button>
                    </td>
                    <td class="nowrap sm">
                      <button
                        v-if="hasLinkedPositionForRecord(r)"
                        type="button"
                        class="btn btn-sm btn-warning"
                        :disabled="r.status !== 'open' || simActionRunningId === r.id"
                        @click="onPositionActionClick('reduce', r)"
                      >
                        减仓
                      </button>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td class="nowrap sm">
                      <button
                        v-if="hasLinkedPositionForRecord(r)"
                        type="button"
                        class="btn btn-sm btn-danger"
                        :disabled="r.status !== 'open' || simActionRunningId === r.id"
                        @click="onPositionActionClick('close', r)"
                      >
                        平仓
                      </button>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td class="nowrap sm">
                      <button
                        v-if="hasLinkedPositionForRecord(r)"
                        type="button"
                        class="btn btn-sm btn-secondary"
                        :disabled="r.status !== 'open' || simActionRunningId === r.id"
                        @click="onPositionActionClick('reverse', r)"
                      >
                        反手
                      </button>
                      <span v-else class="text-muted">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
            <div class="mt-3 d-flex justify-content-center mb-0">
              <span class="text-nowrap small text-muted">
                当前展示 {{ simOpsShownCount }} 条（同持仓编号仅保留最新一条）
              </span>
            </div>
          </template>
        </section>

        <section class="card-block events-card">
          <h2 class="mb-3 detail-panel-title">
            <span
              class="btn btn-warning hint-cursor"
              :title="eventsSectionHint"
            >跟单记录</span>
          </h2>
          <div v-if="eventsLoading && eventsTotal === 0 && !eventsError" class="muted">加载记录中…</div>
          <div v-else-if="eventsError" class="aside-err">{{ eventsError }}</div>
          <div v-else-if="closedEventsOnly.length === 0" class="muted">暂无已平仓记录。</div>
          <template v-else>
            <div class="detail-table-rounded">
              <div class="table-responsive">
              <table
                class="table table-striped table-hover table-sm table-bordered align-middle mb-0 table-pos-aligned"
              >
                <thead class="table-light">
                  <tr>
                    <th>持仓编号</th>
                    <th>币种</th>
                    <th>方向</th>
                    <th>杠杆</th>
                    <th>收益额</th>
                    <th>收益率</th>
                    <th>累计投入</th>
                    <th>持仓量</th>
                    <th>开仓均价</th>
                    <th>平仓均价</th>
                    <th>开仓时间</th>
                    <th>平仓时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="e in closedEventsOnly"
                    :key="e.id"
                    :class="rowClassFromPnlTone(eventPnlTone(e))"
                  >
                    <td class="mono td-pos-id">
                      <span
                        v-if="!positionClosedForEvent(e) && e.pos_id && eventPnlTone(e) !== 'neutral'"
                        :class="badgeClassFromPnlTone(eventPnlTone(e))"
                      >{{ e.pos_id }}</span>
                      <template v-else>{{ e.pos_id ?? '—' }}</template>
                    </td>
                    <td>{{ e.pos_ccy ?? '—' }}</td>
                    <td>{{ formatPosSide(e.pos_side) }}</td>
                    <td>{{ formatLever(e.lever) }}</td>
                    <td :class="uplCellClass(eventUplRaw(e))">{{ formatUplUsdt(eventUplRaw(e)) }}</td>
                    <td :class="roiClassFromTone(eventPnlTone(e))">{{ eventRoiDisplay(e) }}</td>
                    <td class="mono sm">{{ eventInvestedDisplay(e) }}</td>
                    <td class="mono sm">{{ formatEventPosContracts(e) }}</td>
                    <td class="mono sm">{{ formatAvgPx(e.avg_px) }}</td>
                    <td
                      class="mono sm"
                      :class="{ 'mark-col': !positionClosedForEvent(e) }"
                    >{{ eventMarkPx(e) }}</td>
                    <td class="nowrap sm">{{ formatEventOpenTime(e) }}</td>
                    <td class="nowrap sm">{{ formatTime(e.created_at) }}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
            <nav
              class="mt-3 d-flex justify-content-center flex-wrap align-items-center gap-2 mb-0"
              aria-label="开仓平仓分页"
            >
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="eventsPage <= 1 || eventsLoading"
                @click="goEventsPrev"
              >
                上一页
              </button>
              <span class="text-nowrap small text-muted">
                第 {{ eventsPage }} / {{ eventsTotalPages }} 页，共 {{ eventsTotal }} 条（每页
                {{ EVENTS_PAGE_SIZE }} 条）
              </span>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="eventsPage >= eventsTotalPages || eventsLoading"
                @click="goEventsNext"
              >
                下一页
              </button>
            </nav>
          </template>
        </section>

            <section v-if="current?.okx_api_account_id" class="linked-okx-card card-block">
              <h2 class="mb-2 detail-panel-title">
                <span
                  class="btn btn-warning hint-cursor"
                  title="成交与保证金流水来自欧易私有接口；永续持仓见上方「跟单持仓」（同一密钥、同一轮询）。每 2 秒刷新；分页基于当期各最多 100 条。"
                >本人 OKX（绑定帐户）</span>
              </h2>
              <p v-if="linkedOkxErr" class="small text-danger mb-2">{{ linkedOkxErr }}</p>
              <h3 class="h6 mb-2">我的成交</h3>
              <div v-if="linkedFillsRows.length === 0" class="small text-muted mb-3">暂无成交</div>
              <template v-else>
                <div class="table-responsive mb-2">
                  <table class="table table-sm table-bordered align-middle mb-0 linked-okx-table">
                    <thead class="table-light">
                      <tr>
                        <th>时间</th>
                        <th>合约</th>
                        <th>方向</th>
                        <th>持仓方向</th>
                        <th>成交价</th>
                        <th>数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(r, i) in linkedFillsPageSlice" :key="'lf-' + linkedFillsPage + '-' + i">
                        <td class="nowrap sm">{{ formatLinkedTs(pickLinkedStr(r, ['fillTime', 'ts'])) }}</td>
                        <td class="mono sm">{{ instIdBaseCcy(pickLinkedStr(r, ['instId'])) }}</td>
                        <td>{{ pickLinkedStr(r, ['side']) }}</td>
                        <td>{{ formatPosSide(pickLinkedStr(r, ['posSide'])) }}</td>
                        <td class="mono sm">{{ pickLinkedStr(r, ['fillPx', 'px']) }}</td>
                        <td class="mono sm">{{ pickLinkedStr(r, ['fillSz', 'sz']) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <nav
                  class="mb-3 d-flex justify-content-center flex-wrap align-items-center gap-2"
                  aria-label="本人成交分页"
                >
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="linkedFillsPage <= 1"
                    @click="goLinkedFillsPrev"
                  >
                    上一页
                  </button>
                  <span class="text-nowrap small text-muted">
                    第 {{ linkedFillsPage }} / {{ linkedFillsTotalPages }} 页，共 {{ linkedFillsRows.length }} 条（每页
                    {{ LINKED_OKX_PAGE_SIZE }} 条）
                  </span>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="linkedFillsPage >= linkedFillsTotalPages"
                    @click="goLinkedFillsNext"
                  >
                    下一页
                  </button>
                </nav>
              </template>
              <h3 class="h6 mb-2">保证金划转（账单 type=6）</h3>
              <div v-if="linkedBillsRows.length === 0" class="small text-muted mb-0">暂无记录</div>
              <template v-else>
                <div class="table-responsive mb-2">
                  <table class="table table-sm table-bordered align-middle mb-0 linked-okx-table">
                    <thead class="table-light">
                      <tr>
                        <th>时间</th>
                        <th>合约</th>
                        <th>模式</th>
                        <th>仓位保证金变动</th>
                        <th>子类型</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(r, i) in linkedBillsPageSlice" :key="'lb-' + linkedBillsPage + '-' + i">
                        <td class="nowrap sm">{{ formatLinkedTs(pickLinkedStr(r, ['ts'])) }}</td>
                        <td class="mono sm">{{ instIdBaseCcy(pickLinkedStr(r, ['instId'])) }}</td>
                        <td>{{ pickLinkedStr(r, ['mgnMode']) }}</td>
                        <td class="mono sm">{{ pickLinkedStr(r, ['posBalChg']) }}</td>
                        <td class="mono sm">{{ pickLinkedStr(r, ['subType']) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <nav
                  class="d-flex justify-content-center flex-wrap align-items-center gap-2 mb-0"
                  aria-label="保证金账单分页"
                >
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="linkedBillsPage <= 1"
                    @click="goLinkedBillsPrev"
                  >
                    上一页
                  </button>
                  <span class="text-nowrap small text-muted">
                    第 {{ linkedBillsPage }} / {{ linkedBillsTotalPages }} 页，共 {{ linkedBillsRows.length }} 条（每页
                    {{ LINKED_OKX_PAGE_SIZE }} 条）
                  </span>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="linkedBillsPage >= linkedBillsTotalPages"
                    @click="goLinkedBillsNext"
                  >
                    下一页
                  </button>
                </nav>
              </template>
            </section>
            <section v-else class="linked-okx-card card-block">
              <h2 class="mb-2 detail-panel-title">
                <span class="btn btn-secondary">本人 OKX</span>
              </h2>
              <p class="small text-muted mb-0">
                在右侧「跟单详情」绑定 API 后，上方「跟单持仓」展示永续持仓；此处展示成交与保证金流水。
              </p>
            </section>
          </div>

          <div class="detail-col-info">
              <section class="info-card card-block">
                <h2 class="mb-3 detail-panel-title">
                  <span class="btn btn-warning">跟单详情</span>
                </h2>
                <dl class="detail-dl">
                  <dt>昵称</dt>
                  <dd>{{ current.nickname ?? '—' }}</dd>
                  <dt>uniqueName</dt>
                  <dd class="mono">{{ current.unique_name ?? '—' }}</dd>
                  <dt>链接</dt>
                  <dd class="break">
                    <a
                      :href="current.link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >{{ current.link }}</a>
                  </dd>
                  <dt>是否启用</dt>
                  <dd>
                    <div class="form-check form-switch mb-0">
                      <input
                        :id="'detail-enabled-' + current.id"
                        class="form-check-input"
                        type="checkbox"
                        role="switch"
                        :checked="current.enabled"
                        :disabled="enabledToggling"
                        @change="onEnabledChange"
                      />
                      <label
                        class="form-check-label"
                        :for="'detail-enabled-' + current.id"
                      >{{ current.enabled ? '已启用' : '已停用' }}</label>
                    </div>
                    <span
                      v-if="enabledToggleMsg"
                      class="small text-danger d-block mt-1"
                    >{{ enabledToggleMsg }}</span>
                  </dd>
                  <dt>添加时间</dt>
                  <dd>{{ formatTime(current.created_at) }}</dd>
                  <dt>最近一次启用</dt>
                  <dd>{{ formatTime(current.last_enabled_at) }}</dd>
                  <dt>快照时间</dt>
                  <dd>{{ formatTime(current.positions_refreshed_at) }}</dd>
                  <dt>跟单帐户</dt>
                  <dd class="okx-bind-block">
                    <select
                      v-model="okxBindSelect"
                      class="form-select form-select-sm"
                      :disabled="current.enabled || okxBindSaving"
                      aria-label="选择跟单帐户"
                    >
                      <option value="">未选择</option>
                      <option
                        v-for="o in okxApiList"
                        :key="o.id"
                        :value="String(o.id)"
                        :disabled="isOkxOptionDisabled(o)"
                      >
                        {{ okxOptionLabel(o) }}
                      </option>
                    </select>
                    <div class="mt-2 d-flex flex-wrap align-items-center gap-2">
                      <button
                        type="button"
                        class="btn btn-sm btn-primary"
                        :disabled="current.enabled || okxBindSaving"
                        @click="saveOkxBind"
                      >
                        {{ okxBindSaving ? '保存中…' : '保存绑定' }}
                      </button>
                      <button
                        v-if="current.okx_api_account_id != null"
                        type="button"
                        class="btn btn-sm btn-outline-danger"
                        :disabled="current.enabled || okxBindSaving"
                        :title="
                          current.enabled
                            ? '跟单启用中不可解绑，请先停用跟单'
                            : '解除与本交易员的 API 绑定'
                        "
                        @click="clearOkxBind"
                      >
                        取消绑定
                      </button>
                    </div>
                    <span
                      v-if="okxBindMsg"
                      class="small d-block mt-1"
                      :class="okxBindMsg.includes('失败') || okxBindMsg.includes('错误') ? 'text-danger' : 'text-success'"
                    >{{ okxBindMsg }}</span>
                  </dd>
                </dl>
              </section>

              <section class="config-card card-block">
                <h2 class="mb-3 detail-panel-title">
                  <span
                    class="btn btn-warning hint-cursor"
                    :title="followConfigSectionHint"
                  >跟单配置</span>
                </h2>
                <form class="follow-config-form" @submit.prevent="saveFollowConfig">
                  <div class="form-check mb-3">
                    <input
                      id="fc-live-trading"
                      v-model="followCfg.live_trading_enabled"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="fc-live-trading">启用真实交易</label>
                  </div>
                  <div class="mb-2">
                    <label
                      class="form-label mb-1 hint-cursor"
                      for="fc-max-n"
                      :title="maxFollowPositionsLabelHint"
                    >
                      跟单仓位数
                    </label>
                    <input
                      id="fc-max-n"
                      v-model.number="followCfg.max_follow_positions"
                      type="number"
                      min="1"
                      class="form-control form-control-sm"
                      placeholder="例如 5"
                    />
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1" for="fc-bet">下注金额</label>
                    <input
                      id="fc-bet"
                      v-model.number="followCfg.bet_amount_per_position"
                      type="number"
                      min="0"
                      step="any"
                      class="form-control form-control-sm"
                      placeholder="用于保证金追加计算"
                    />
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1" for="fc-add">追加比例</label>
                    <input
                      id="fc-add"
                      v-model.number="followCfg.margin_add_ratio_of_bet"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      class="form-control form-control-sm"
                      placeholder="例如 0.2 表示追加「下注金额 × 20%」"
                    />
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1" for="fc-margin-max-times">追加次数上限</label>
                    <input
                      id="fc-margin-max-times"
                      type="number"
                      min="1"
                      max="100000"
                      step="1"
                      class="form-control form-control-sm"
                      placeholder="留空表示不限制"
                      :value="followCfg.margin_add_max_times ?? ''"
                      @input="onMarginAddMaxTimesInput"
                    />
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1" for="fc-maint-mgn">维持保证金率</label>
                    <input
                      id="fc-maint-mgn"
                      v-model.number="followCfg.maint_margin_ratio_threshold"
                      type="number"
                      min="0"
                      step="any"
                      class="form-control form-control-sm"
                      placeholder="例如 2 表示 200%"
                    />
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1" for="fc-close-mgn">平仓保证金率</label>
                    <input
                      id="fc-close-mgn"
                      v-model.number="followCfg.close_margin_ratio_threshold"
                      type="number"
                      min="0"
                      step="any"
                      class="form-control form-control-sm"
                      placeholder="例如 1.5 表示 150%"
                    />
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1" for="fc-tp-ratio">止盈收益率</label>
                    <input
                      id="fc-tp-ratio"
                      v-model.number="followCfg.take_profit_ratio"
                      type="number"
                      min="0"
                      step="any"
                      class="form-control form-control-sm"
                      placeholder="例如 0.2 表示 20%"
                    />
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1" for="fc-sl-ratio">止损收益率</label>
                    <input
                      id="fc-sl-ratio"
                      v-model.number="followCfg.stop_loss_ratio"
                      type="number"
                      min="0"
                      step="any"
                      class="form-control form-control-sm"
                      placeholder="例如 0.1 表示 10%"
                    />
                  </div>
                  <p class="small text-muted mb-2">
                    维持保证金率 ≤ 200% 时自动追加，金额 = 下注金额 × 追加比例；每条跟单约每 1 秒独立轮询绑定
                    OKX，与「启动追加」「真实交易」「绑定 API」联动。
                  </p>
                  <div class="form-check mb-3">
                    <input
                      id="fc-margin-auto"
                      v-model="followCfg.margin_auto_enabled"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="fc-margin-auto">
                      启动追加
                    </label>
                  </div>
                  <div class="d-flex flex-wrap align-items-center gap-2">
                    <button
                      type="submit"
                      class="btn btn-success btn-sm"
                      :disabled="configSaving"
                    >
                      {{ configSaving ? '保存中…' : '保存配置' }}
                    </button>
                    <span v-if="configMsg" class="small text-muted">{{ configMsg }}</span>
                  </div>
                </form>
              </section>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.detail-layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
  background: var(--color-background);
}

.detail-aside {
  width: 162px; /* 在 202px 基础上再窄约 20% */
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.aside-head {
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.back-home {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--color-text);
  text-decoration: none;
  opacity: 0.85;
}

.back-home:hover {
  opacity: 1;
  text-decoration: underline;
}

.aside-okx-link {
  display: block;
  margin-bottom: 8px;
}

.aside-title {
  font-size: 14px;
  font-weight: 700;
}

.aside-empty,
.aside-err {
  padding: 16px;
  font-size: 13px;
  opacity: 0.8;
}

.aside-err {
  color: #b00020;
}

.aside-nav {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.user-link {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--color-text);
  text-decoration: none;
  border: 1px solid transparent;
  margin-bottom: 6px;
}

.user-link:hover {
  background: var(--color-background-mute);
}

.user-link.active {
  background: var(--color-background-mute);
  border-color: var(--color-border-hover);
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  word-break: break-word;
}

.user-meta {
  font-size: 12px;
  opacity: 0.85;
}

.tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 11px;
}

.tag.on {
  background: rgba(0, 128, 96, 0.15);
  color: hsla(160, 100%, 28%, 1);
}

.tag.off {
  background: var(--color-background-mute);
}

.detail-main {
  flex: 1;
  min-width: 0;
  padding: 24px;
  overflow: auto;
}

/* 两列：左栏主内容 + 右栏侧栏；大屏用 flex + flex-start 保证顶线对齐 */
.detail-main-grid.detail-two-col {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 100%;
  margin-left: 0;
  margin-right: 0;
}

.detail-col-main {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-width: 0;
}

.detail-col-main > .card-block {
  margin-bottom: 0;
}

@media (min-width: 992px) {
  .detail-main-grid.detail-two-col {
    flex-direction: row;
    align-items: flex-start;
    gap: 1.5rem;
  }

  /* 中间 : 右侧 = 311 : 64（在 59:16 基础上右侧再 ×0.8，约再窄 20%） */
  .detail-main-grid.detail-two-col .detail-col-main {
    flex: 311 1 0;
    min-width: 0;
  }

  .detail-main-grid.detail-two-col .detail-col-info {
    flex: 64 1 0;
    min-width: 0;
  }
}

.detail-main-grid .card-block {
  max-width: none;
}

/* 与右侧首张卡片顶缘对齐：去掉首块标题的默认 margin-top（覆盖 Bootstrap reboot 的 h2） */
.detail-main-grid .card-block > h2:first-child {
  margin-top: 0 !important;
}

/* 各面板标题行：统一行高，避免左右「按钮标题」视觉顶线不一致 */
.detail-main-grid .detail-panel-title {
  margin-top: 0 !important;
  line-height: 1.25;
}

.detail-main-grid .detail-panel-title .btn {
  vertical-align: top;
}

.detail-col-info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  position: sticky;
  top: 0;
  align-self: flex-start;
}

.detail-col-info > .card-block {
  margin-bottom: 0;
}

.linked-okx-table {
  font-size: 12px;
}

@media (max-width: 991.98px) {
  .detail-col-info {
    position: static;
  }
}

.main-empty {
  opacity: 0.8;
  font-size: 14px;
}

.card-block {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
  padding: 20px;
  margin-bottom: 20px;
  max-width: 960px;
}

.section-title {
  font-size: 16px;
  margin: 0 0 8px 0;
  font-weight: 700;
}

.hint-cursor {
  cursor: help;
}

.subsection-gap {
  margin-bottom: 4px;
}

.muted {
  font-size: 13px;
  opacity: 0.75;
}

.detail-dl {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 20px;
  font-size: 14px;
}

.detail-dl dt {
  margin: 0;
  opacity: 0.75;
  font-weight: 600;
}

.detail-dl dd {
  margin: 0;
}

.break {
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 13px;
}

/* 外层圆角裁切，内层 table-responsive 仍可横向滚动 */
.detail-table-rounded {
  border-radius: 10px;
  overflow: hidden;
}

.table-responsive {
  font-size: 12px;
}

.detail-main-grid .table-responsive .table {
  margin-bottom: 0;
}

.sm {
  font-size: 11px;
}

.nowrap {
  white-space: nowrap;
}

.inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--color-background-mute);
}

.mark-col {
  font-weight: 600;
}

/* 收益率列：等宽数字；行已着色时加粗即可 */
.roi-pct {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.roi-pct-pos,
.roi-pct-neg {
  font-weight: 700;
}

/* 盈亏数字：盈利绿、亏损红（与行底色并存时仍清晰） */
.roi-pct-pos {
  color: #198754 !important;
}

.roi-pct-neg {
  color: #dc3545 !important;
}

.roi-pct-zero {
  color: #6c757d !important;
}

/* 盈亏行：盈绿、亏红、平灰（覆盖 Bootstrap 条纹） */
:deep(.table tbody tr.row-pnl-pos td) {
  color: #146c43 !important;
  background-color: rgba(25, 135, 84, 0.1) !important;
}

:deep(.table tbody tr.row-pnl-neg td) {
  color: #b02a37 !important;
  background-color: rgba(220, 53, 69, 0.1) !important;
}

:deep(.table tbody tr.row-pnl-zero td) {
  color: #6c757d !important;
}

:deep(.table tbody tr.row-pnl-pos .mark-col),
:deep(.table tbody tr.row-pnl-neg .mark-col) {
  font-weight: 600;
}

.sim-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px 20px;
  font-size: 13px;
}

.sim-total-pill strong {
  margin-left: 6px;
  font-size: 15px;
}

.sim-total-pill strong.sim-total-pnl-val.sim-total-pnl-pos {
  font-size: 17px;
  color: #198754;
  font-weight: 700;
}

.sim-total-pill strong.sim-total-pnl-val.sim-total-pnl-neg {
  color: #dc3545;
  font-weight: 600;
}

.sim-total-pill strong.sim-total-pnl-val.sim-total-pnl-zero {
  color: #6c757d;
}

.sim-total-pill strong.sim-total-pnl-val.sim-total-pnl-neutral {
  color: #6c757d;
}

/* 已实现 / 浮动分项：同色阶，字号略小于总收益 */
.sim-total-meta strong.sim-sub-pnl-val.sim-total-pnl-pos {
  font-size: 14px;
  color: #198754;
  font-weight: 700;
}

.sim-total-meta strong.sim-sub-pnl-val.sim-total-pnl-neg {
  font-size: 14px;
  color: #dc3545;
  font-weight: 600;
}

.sim-total-meta strong.sim-sub-pnl-val.sim-total-pnl-zero,
.sim-total-meta strong.sim-sub-pnl-val.sim-total-pnl-neutral {
  font-size: 14px;
  color: #6c757d;
  font-weight: 600;
}

.sim-total-meta.small {
  font-size: 12px;
}

/* posId 列：略大于表格默认 .sm */
.td-pos-id {
  font-size: 13px;
  line-height: 1.4;
}

:deep(.table .td-pos-id .badge) {
  font-size: 12px;
  font-weight: 600;
  padding: 0.4em 0.65em;
}

/* 三张持仓/记录表：表头与单元格一律右对齐；内容不换行（宽表横向滚动） */
.table-pos-aligned th,
.table-pos-aligned td {
  text-align: right;
  white-space: nowrap;
}

/* 当前持仓 / 跟单记录 / 开平仓：前四列均为 posId、币种、方向、杠杆，统一最小宽度便于上下对照 */
.table-pos-aligned th:nth-child(1),
.table-pos-aligned td:nth-child(1) {
  min-width: 7.75rem;
}

.table-pos-aligned th:nth-child(2),
.table-pos-aligned td:nth-child(2) {
  min-width: 3.75rem;
}

.table-pos-aligned th:nth-child(3),
.table-pos-aligned td:nth-child(3) {
  min-width: 3.25rem;
}

.table-pos-aligned th:nth-child(4),
.table-pos-aligned td:nth-child(4) {
  min-width: 3rem;
}
</style>
