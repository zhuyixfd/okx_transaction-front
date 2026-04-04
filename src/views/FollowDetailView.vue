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
}

type FollowCfgForm = {
  bet_amount_per_position: number | null
  max_follow_positions: number | null
  margin_add_ratio_of_bet: number
  margin_auto_enabled: boolean
  /** 保证金自动追加次数上限；null 表示不限制 */
  margin_add_max_times: number | null
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
  exit_px: string | null
  realized_pnl_usdt: string | null
  unrealized_pnl_usdt: string
  last_mark_px: string | null
  opened_at: string
  closed_at: string | null
  updated_at: string
  /** 以下字段预留，接口未返回时为空 */
  position_notional_usdt?: string | null
  margin_usdt?: string | null
  maint_margin_ratio?: string | null
  est_liquidation_px?: string | null
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
const SIM_PAGE_SIZE = 20
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
})
const configSaving = ref(false)
const configMsg = ref('')
const enabledToggling = ref(false)
const enabledToggleMsg = ref('')

/** 悬停「跟单配置」标题时展示（不含已固定的按成本模式文案） */
const followConfigSectionHint =
  '自动加保证金需在服务器环境配置 OKX API（OKX_FOLLOW_API_KEY / OKX_FOLLOW_SECRET_KEY / OKX_FOLLOW_PASSPHRASE），并在下方填写「每个仓位下注金额」且勾选启用；后台将监控本人永续持仓保证金率，当 ≤ 内置阈值（200%）时按「下注金额 × 追加比例」追加逐仓保证金（多帐户启用时取下注金额与追加比例的保守最小值）。'

/** 悬停「最多同时跟几个仓位（n）」时展示 */
const maxFollowPositionsLabelHint =
  '对方持仓少于 n 则全跟；多于 n 则只跟 n 个；对方平仓换仓后仍只保持最多 n 个跟单仓位。'

/** 悬停「当前持仓」标题 */
const snapshotSectionHint =
  '每 2 秒静默请求快照接口（不整页刷新）。标记价来自库表 follow_position_snapshots，启用时由后台轮询更新。'

/** 悬停「跟单记录（模拟）」标题 */
const simRecordsSectionHint =
  '按「每个仓位下注金额」模拟资金变动；开仓写入记录，平仓结算已实现盈亏。未平仓行随标记价更新浮动盈亏。总收益 = 已实现合计 + 未平仓浮动合计（随行情变动）。'

/** 悬停「开仓 / 平仓记录」标题 */
const eventsSectionHint =
  '每 2 秒静默刷新当前页数据。仅当 posId 出现/消失时写入记录；未平仓行标记价等随快照刷新。平仓时间仅在「平仓」事件行显示。'

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
    const offset = (simPage.value - 1) * SIM_PAGE_SIZE
    const params = new URLSearchParams({
      unique_name: un,
      limit: String(SIM_PAGE_SIZE),
      offset: String(offset),
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

onMounted(() => {
  void loadList(false).then(() => {
    void loadEvents(false)
    void loadSnapshot(false)
    void loadSimRecords(false)
  })
  pollTimer = setInterval(() => {
    void loadEvents(true)
    void loadSnapshot(true)
    void loadSimRecords(true)
    void loadList(true)
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
  void loadEvents(false)
  void loadSnapshot(false)
  void loadSimRecords(false)
})

const eventsTotalPages = computed(() =>
  Math.max(1, Math.ceil(eventsTotal.value / EVENTS_PAGE_SIZE)),
)

const simTotalPages = computed(() => Math.max(1, Math.ceil(simTotal.value / SIM_PAGE_SIZE)))

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

const eventRoiDisplay = (e: PositionEventRow): string => {
  const api = formatApiUplRatio(e.upl_ratio)
  if (api) return api
  return formatRoiPct(e.avg_px, eventMarkPx(e), e.pos_side)
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
  } catch (e: unknown) {
    enabledToggleMsg.value = e instanceof Error ? e.message : '网络错误'
    el.checked = !enabled
  } finally {
    enabledToggling.value = false
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

/** 平仓时间：仅平仓事件行展示写入时间；开仓行或未平仓显示 — */
const eventCloseTimeForCell = (e: PositionEventRow): string => {
  if (e.event_type !== 'close') return '—'
  return formatTime(e.created_at)
}

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

/** 跟单记录：当前页内按币种排序（与持仓一致） */
const simRecordsSorted = computed(() =>
  [...simRecords.value].sort((a, b) => {
    const c = comparePosCcy(a.pos_ccy, b.pos_ccy)
    if (c !== 0) return c
    return String(a.pos_id).localeCompare(String(b.pos_id), 'en', { sensitivity: 'base' })
  }),
)

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
            >当前持仓</span>
          </h2>
          <div v-if="snapshotLoading && !snapshot" class="muted">加载快照中…</div>
          <div v-else-if="snapshotError" class="aside-err">{{ snapshotError }}</div>
          <template v-else-if="snapshot">
            <div v-if="snapshot.positions.length === 0" class="muted subsection-gap">
              当前无持仓或未建立快照（启用后等待下一轮轮询）。
            </div>
            <div class="detail-table-rounded subsection-gap">
              <div class="table-responsive">
              <table
                class="table table-striped table-hover table-sm table-bordered align-middle mb-0 table-pos-aligned"
              >
                <thead class="table-light">
                  <tr>
                    <th>posId</th>
                    <th>币种</th>
                    <th>方向</th>
                    <th>杠杆</th>
                    <th>开仓均价</th>
                    <th>标记价</th>
                    <th>收益率</th>
                    <th>盈亏（USDT）</th>
                    <th>开仓时间</th>
                    <th>更新时间</th>
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
                    <td class="mono sm">{{ formatAvgPx(row.p.avg_px) }}</td>
                    <td class="mono sm mark-col">{{ row.p.last_px ?? '—' }}</td>
                    <td :class="roiClassFromTone(row.tone)">{{ snapshotRoiDisplay(row.p) }}</td>
                    <td :class="uplCellClass(row.p.upl)">{{ formatUplUsdt(row.p.upl) }}</td>
                    <td class="nowrap sm">{{ row.p.c_time_format ?? '—' }}</td>
                    <td class="nowrap sm">{{ formatTime(snapshot.refreshed_at) }}</td>
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
            >跟单记录</span>
          </h2>
          <div class="sim-totals subsection-gap">
            <span class="sim-total-pill">
              总收益（USDT）<strong
                class="mono sim-total-pnl-val"
                :class="{
                  'sim-total-pnl-pos': simTotalPnlTone === 'pos',
                  'sim-total-pnl-neg': simTotalPnlTone === 'neg',
                  'sim-total-pnl-zero': simTotalPnlTone === 'zero',
                  'sim-total-pnl-neutral': simTotalPnlTone === 'neutral',
                }"
              >{{ formatUsdt3(simTotalPnl) }}</strong>
            </span>
            <span class="sim-total-meta small">
              <span class="text-muted">已实现 </span>
              <strong
                class="mono sim-sub-pnl-val"
                :class="{
                  'sim-total-pnl-pos': simRealizedPnlTone === 'pos',
                  'sim-total-pnl-neg': simRealizedPnlTone === 'neg',
                  'sim-total-pnl-zero': simRealizedPnlTone === 'zero',
                  'sim-total-pnl-neutral': simRealizedPnlTone === 'neutral',
                }"
              >{{ formatUsdt3(simRealizedSum) }}</strong>
              <span class="text-muted"> · </span>
              <span class="text-muted">浮动 </span>
              <strong
                class="mono sim-sub-pnl-val"
                :class="{
                  'sim-total-pnl-pos': simUnrealizedPnlTone === 'pos',
                  'sim-total-pnl-neg': simUnrealizedPnlTone === 'neg',
                  'sim-total-pnl-zero': simUnrealizedPnlTone === 'zero',
                  'sim-total-pnl-neutral': simUnrealizedPnlTone === 'neutral',
                }"
              >{{ formatUsdt3(simUnrealizedSum) }}</strong>
            </span>
          </div>
          <div v-if="simLoading && simTotal === 0 && !simError" class="muted">加载中…</div>
          <div v-else-if="simError" class="aside-err">{{ simError }}</div>
          <div v-else-if="simTotal === 0" class="muted">暂无模拟记录（启用监控后，新出现的 posId 会开仓记账）。</div>
          <template v-else>
            <div class="detail-table-rounded">
              <div class="table-responsive">
              <table
                class="table table-striped table-hover table-sm table-bordered align-middle mb-0 table-pos-aligned"
              >
                <thead class="table-light">
                  <tr>
                    <th>posId</th>
                    <th>币种</th>
                    <th>方向</th>
                    <th>杠杆</th>
                    <th>本金</th>
                    <th>开仓均价</th>
                    <th>标记价格</th>
                    <th>盈亏（USDT）</th>
                    <th>开仓时间</th>
                    <th>平仓时间</th>
                    <th>持仓量（USDT）</th>
                    <th>保证金（USDT）</th>
                    <th>维持保证金率</th>
                    <th>预估强平价格</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="r in simRecordsSorted"
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
                    <td class="mono sm">{{ formatAvgPx(r.entry_avg_px) }}</td>
                    <td class="mono sm">{{ simPxLabel(r) }}</td>
                    <td class="mono sm">{{ formatUsdt3(simPnlDisplay(r)) }}</td>
                    <td class="nowrap sm">{{ formatTime(r.opened_at) }}</td>
                    <td class="nowrap sm">{{ formatTime(r.closed_at) }}</td>
                    <td class="mono sm">{{ simRecordExtraText(r.position_notional_usdt) }}</td>
                    <td class="mono sm">{{ simRecordExtraText(r.margin_usdt) }}</td>
                    <td class="mono sm">{{ simRecordExtraText(r.maint_margin_ratio) }}</td>
                    <td class="mono sm">{{ simRecordExtraText(r.est_liquidation_px) }}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
            <nav
              class="mt-3 d-flex justify-content-center flex-wrap align-items-center gap-2 mb-0"
              aria-label="跟单记录分页"
            >
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="simPage <= 1 || simLoading"
                @click="goSimPrev"
              >
                上一页
              </button>
              <span class="text-nowrap small text-muted">
                第 {{ simPage }} / {{ simTotalPages }} 页，共 {{ simTotal }} 条（每页
                {{ SIM_PAGE_SIZE }} 条）
              </span>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="simPage >= simTotalPages || simLoading"
                @click="goSimNext"
              >
                下一页
              </button>
            </nav>
          </template>
        </section>

        <section class="card-block events-card">
          <h2 class="mb-3 detail-panel-title">
            <span
              class="btn btn-warning hint-cursor"
              :title="eventsSectionHint"
            >开平仓记录</span>
          </h2>
          <div v-if="eventsLoading && eventsTotal === 0 && !eventsError" class="muted">加载记录中…</div>
          <div v-else-if="eventsError" class="aside-err">{{ eventsError }}</div>
          <div v-else-if="eventsTotal === 0" class="muted">暂无记录（首次拉取仅建立 posId 快照；仅 posId 出现/消失会写入）。</div>
          <template v-else>
            <div class="detail-table-rounded">
              <div class="table-responsive">
              <table
                class="table table-striped table-hover table-sm table-bordered align-middle mb-0 table-pos-aligned"
              >
                <thead class="table-light">
                  <tr>
                    <th>posId</th>
                    <th>币种</th>
                    <th>方向</th>
                    <th>杠杆</th>
                    <th>收益率</th>
                    <th>盈亏（USDT）</th>
                    <th>获取/开仓时间</th>
                    <th>开仓均价</th>
                    <th>平仓时间</th>
                    <th>标记价/平仓均价</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="e in events"
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
                    <td :class="roiClassFromTone(eventPnlTone(e))">{{ eventRoiDisplay(e) }}</td>
                    <td :class="uplCellClass(eventUplRaw(e))">{{ formatUplUsdt(eventUplRaw(e)) }}</td>
                    <td class="nowrap">{{ formatTime(e.created_at) }}</td>
                    <td class="mono sm">{{ formatAvgPx(e.avg_px) }}</td>
                    <td class="nowrap sm">{{ eventCloseTimeForCell(e) }}</td>
                    <td
                      class="mono sm"
                      :class="{ 'mark-col': !positionClosedForEvent(e) }"
                    >{{ eventMarkPx(e) }}</td>
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
                  <div class="mb-2">
                    <label
                      class="form-label mb-1 hint-cursor"
                      for="fc-max-n"
                      :title="maxFollowPositionsLabelHint"
                    >
                      最多同时跟几个仓位（n）
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
                    <label class="form-label mb-1" for="fc-bet">每个仓位下注金额（USDT）</label>
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
                    <label class="form-label mb-1" for="fc-add">追加比例（相对下注金额）</label>
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
                    <label class="form-label mb-1" for="fc-margin-max-times">保证金自动追加次数上限</label>
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
                  <div class="form-check mb-3">
                    <input
                      id="fc-margin-auto"
                      v-model="followCfg.margin_auto_enabled"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="fc-margin-auto">
                      启用保证金率监控并自动追加（需配置 OKX API）
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
  width: 280px;
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

  .detail-main-grid.detail-two-col .detail-col-main {
    flex: 2 1 0;
    min-width: 0;
  }

  .detail-main-grid.detail-two-col .detail-col-info {
    flex: 1 1 0;
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
