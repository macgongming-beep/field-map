// 비공식 카드 탭 — 자료 풀 + 그룹화 + 업로드 (admin/dev)
// 구역 탭 > 비공식 카드 sub-tab 안에 렌더링
import { MapCanvas } from './MapCanvas'
import { useRef, useState } from 'react'
import { INFORMAL_KINDS, type InformalAsset, type InformalGroup, type InformalKind, type Role } from '../types'
import { INFORMAL_KIND_STYLE } from '../utils/informalKind'
import { InformalKindIcon } from './InformalKindIcon'
import { geocodeQuery } from '../lib/naverGeocode'
import { searchPlaces, type PlaceCandidate } from '../lib/placeSearch'
import { showToast } from '../lib/toast'
import { msg } from '../lib/msg'
import { compressImage } from '../lib/imageCompress'
import type { AppLanguage } from '../i18n'
import { useSessionState } from '../hooks/useSessionState'

const MAX_ORIGINAL_SIZE_MB = 30
const TARGET_SIZE_MB = 0.5  // Phase 5: 1.5MB → 0.5MB (대역폭 절감, 폰 화면에 충분)

type QueueStatus = 'pending' | 'compressing' | 'uploading' | 'done' | 'error'
type QueueItem = {
  id: string
  originalFile: File
  name: string
  status: QueueStatus
  originalSize: number
  finalSize: number
  width?: number
  height?: number
  error?: string
}

function isAdminLike(role: Role): boolean {
  return role === 'admin' || role === 'developer'
}

const informalCopy = {
  ko: {
    defaultAssetName: '비공식 증거 카드',
    notImage: '이미지 아님',
    overSize: (mb: number) => `${mb}MB 초과`,
    rejectedTitle: '일부 파일 거부됨',
    compressFailed: '압축 실패',
    uploadFailed: '업로드 실패',
    uploaded: (count: number) => `${count}개 자료를 등록했습니다`,
    failed: (count: number) => `${count}개 실패`,
    newGroupPrompt: '새 그룹 이름',
    renameGroupPrompt: '그룹 이름 변경',
    unclassified: '미분류',
    cancel: '취소',
    more: '더보기',
    select: '선택',
    renameGroup: '이름 변경',
    deleteGroup: '그룹 삭제',
    noAssets: '자료 없음',
    kindLabel: '종류',
    pointCount: (n: number) => `포인트 ${n}`,
    changeKind: '종류 바꾸기 (눌러서 전환)',
    renamePlace: '이름 변경',
    renamePlacePrompt: '장소 이름을 입력하세요',
    addressPlaceholder: '이름이나 주소로 찾기',
    noPlaceResults: '찾지 못했습니다. 지도를 눌러 위치를 정해 주세요.',
    search: '찾기',
    searching: '찾는 중…',
    pickOnMap: '지도에서 장소를 눌러 위치를 정하세요.',
    moveOnMap: '위치를 다시 누르면 옮길 수 있습니다.',
    kindName: { 비공식구역: '비공식 구역', 거점: '거점', 대화장소: '대화하기 좋은 장소' } as Record<InformalKind, string>,
    countLine: (assets: number, groups: number) => `전체 ${assets}개 · 그룹 ${groups}`,
    addAsset: '+ 자료 추가',
    addPlace: '+ 장소 추가',
    targetGroup: '대상 그룹',
    remove: '제거',
    clearDone: '완료 항목 비우기',
    inProgress: '진행 중...',
    uploadCount: (count: number) => `${count}개 업로드`,
    addGroup: '+ 그룹 추가',
    emptyAdmin: '아직 등록된 비공식 자료가 없습니다.',
    emptyAdminHelp: '위 + 자료 추가로 시작하세요.',
    emptyUser: '관리자가 자료를 등록하면 여기에 표시됩니다.',
    deleteAssetTitle: '자료를 삭제하시겠어요?',
    delete: '삭제',
    deleteGroupTitle: '그룹을 삭제하시겠어요?',
    deleteGroupHelp: '그룹 안의 자료는 "미분류" 로 이동됩니다.',
    moveGroupTitle: (name: string) => `"${name}" 그룹 이동`,
    selected: (count: number) => `${count}개 선택`,
    selectAsset: '자료를 선택하세요',
    moveGroup: '그룹 이동',
    moveGroupSheet: '그룹으로 이동',
    chooseGroup: (count: number) => `${count}개 자료를 이동할 그룹을 고르세요`,
    movedUnclassified: (count: number) => `${count}개 자료를 미분류로 이동했습니다`,
    movedGroup: (count: number, name: string) => `${count}개 자료를 "${name}" 으로 이동했습니다`,
    deleteManyTitle: (count: number) => `${count}개 자료를 삭제할까요?`,
    deleteManyHelp: '삭제한 자료는 되돌릴 수 없습니다.',
    deletedMany: (count: number) => `${count}개 자료를 삭제했습니다`,
    partialFailure: (done: number, failed: number) => `${done}개는 됐고 ${failed}개는 권한이 없거나 이미 없어 실패했습니다`,
  },
  zh: {
    defaultAssetName: '非正式证据卡',
    notImage: '不是图片',
    overSize: (mb: number) => `超过 ${mb}MB`,
    rejectedTitle: '部分文件被拒绝',
    compressFailed: '压缩失败',
    uploadFailed: '上传失败',
    uploaded: (count: number) => `已上传 ${count} 个资料`,
    failed: (count: number) => `${count} 个失败`,
    newGroupPrompt: '新分组名称',
    renameGroupPrompt: '修改分组名称',
    unclassified: '未分类',
    cancel: '取消',
    more: '更多',
    select: '选择',
    renameGroup: '重命名',
    deleteGroup: '删除分组',
    noAssets: '没有资料',
    kindLabel: '类型',
    pointCount: (n: number) => `地点 ${n}`,
    changeKind: '更改类型',
    renamePlace: '重命名',
    renamePlacePrompt: '请输入地点名称',
    addressPlaceholder: '按名称或地址搜索',
    noPlaceResults: '没有找到。请点击地图设定位置。',
    search: '搜索',
    searching: '搜索中…',
    pickOnMap: '请在地图上点击以设定位置。',
    moveOnMap: '再次点击可移动位置。',
    kindName: { 비공식구역: '非正式区域', 거점: '据点', 대화장소: '适合交谈的地方' } as Record<InformalKind, string>,
    countLine: (assets: number, groups: number) => `共 ${assets} 个 · 分组 ${groups}`,
    addAsset: '+ 添加资料',
    addPlace: '+ 添加地点',
    targetGroup: '目标分组',
    remove: '移除',
    clearDone: '清除已完成',
    inProgress: '处理中...',
    uploadCount: (count: number) => `上传 ${count} 个`,
    addGroup: '+ 添加分组',
    emptyAdmin: '还没有登记非正式资料。',
    emptyAdminHelp: '请用上方 + 添加资料开始。',
    emptyUser: '管理员登记资料后会显示在这里。',
    deleteAssetTitle: '要删除这个资料吗？',
    delete: '删除',
    deleteGroupTitle: '要删除这个分组吗？',
    deleteGroupHelp: '分组内的资料会移到“未分类”。',
    moveGroupTitle: (name: string) => `"${name}" 移动分组`,
    selected: (count: number) => `已选 ${count} 个`,
    selectAsset: '请选择资料',
    moveGroup: '移动分组',
    moveGroupSheet: '移动到分组',
    chooseGroup: (count: number) => `请选择要移动 ${count} 个资料的分组`,
    movedUnclassified: (count: number) => `已将 ${count} 个资料移到未分类`,
    movedGroup: (count: number, name: string) => `已将 ${count} 个资料移到“${name}”`,
    deleteManyTitle: (count: number) => `要删除 ${count} 个资料吗？`,
    deleteManyHelp: '删除后无法恢复。',
    deletedMany: (count: number) => `已删除 ${count} 个资料`,
    partialFailure: (done: number, failed: number) => `${done} 个成功，${failed} 个失败（无权限或已不存在）`,
  },
  en: {
    defaultAssetName: 'Informal Evidence Card',
    notImage: 'not an image',
    overSize: (mb: number) => `over ${mb}MB`,
    rejectedTitle: 'Some files were rejected',
    compressFailed: 'Compression failed',
    uploadFailed: 'Upload failed',
    uploaded: (count: number) => `Uploaded ${count} items`,
    failed: (count: number) => `${count} failed`,
    newGroupPrompt: 'New group name',
    renameGroupPrompt: 'Rename group',
    unclassified: 'Unclassified',
    cancel: 'Cancel',
    more: 'More',
    select: 'Select',
    renameGroup: 'Rename',
    deleteGroup: 'Delete group',
    noAssets: 'No items',
    kindLabel: 'Type',
    pointCount: (n: number) => `${n} points`,
    changeKind: 'Change type',
    renamePlace: 'Rename',
    renamePlacePrompt: 'Enter the place name',
    addressPlaceholder: 'Search by name or address',
    noPlaceResults: 'Not found. Tap the map to set the location.',
    search: 'Search',
    searching: 'Searching…',
    pickOnMap: 'Tap the map to set the location.',
    moveOnMap: 'Tap again to move it.',
    kindName: { 비공식구역: 'Informal zone', 거점: 'Base', 대화장소: 'Good to talk' } as Record<InformalKind, string>,
    countLine: (assets: number, groups: number) => `${assets} total · ${groups} groups`,
    addAsset: '+ Add item',
    addPlace: '+ Add place',
    targetGroup: 'Target group',
    remove: 'Remove',
    clearDone: 'Clear completed',
    inProgress: 'Working...',
    uploadCount: (count: number) => `Upload ${count}`,
    addGroup: '+ Add group',
    emptyAdmin: 'No informal items have been added yet.',
    emptyAdminHelp: 'Start with + Add item above.',
    emptyUser: 'Items will appear here after an admin adds them.',
    deleteAssetTitle: 'Delete this item?',
    delete: 'Delete',
    deleteGroupTitle: 'Delete this group?',
    deleteGroupHelp: 'Items in this group will move to “Unclassified”.',
    moveGroupTitle: (name: string) => `Move "${name}" to group`,
    selected: (count: number) => `${count} selected`,
    selectAsset: 'Select items',
    moveGroup: 'Move group',
    moveGroupSheet: 'Move to group',
    chooseGroup: (count: number) => `Choose a group for ${count} items`,
    movedUnclassified: (count: number) => `Moved ${count} items to Unclassified`,
    movedGroup: (count: number, name: string) => `Moved ${count} items to "${name}"`,
    deleteManyTitle: (count: number) => `Delete ${count} items?`,
    deleteManyHelp: 'Deleted items cannot be restored.',
    deletedMany: (count: number) => `Deleted ${count} items`,
    partialFailure: (done: number, failed: number) => `${done} succeeded, ${failed} failed (no permission or already gone)`,
  },
}

type Props = {
  role: Role
  /** 사진 없이 지도 핀으로 장소 만들기 (docs/비공식-봉사-재설계.md) */
  onCreatePlace?: (input: {
    kind?: InformalKind
    name: string; createdBy: string; groupId?: number | null
    lat: number; lng: number; memo?: string
  }) => Promise<boolean>
  /** 핀이 찍힌 장소를 지도에서 보여 준다 */
  onOpenOnMap?: (assetId: number) => void
  /** 만든 뒤에 종류를 고친다 */
  onUpdatePlace?: (assetId: number, input: { kind?: InformalKind; name?: string }) => Promise<boolean>
  currentVisitor: string
  informalAssets: InformalAsset[]
  informalGroups: InformalGroup[]
  onUpload: (input: { file: File; name: string; uploadedBy: string; groupId?: number | null }) =>
    Promise<{ ok: boolean; assetId?: number; error?: string }>
  onDelete: (assetId: number) => Promise<boolean>
  /** 일괄 삭제. 항목마다 다시 읽지 않고 끝나고 한 번만 읽는다. 없으면 단건을 반복한다. */
  onDeleteMany?: (assetIds: number[]) => Promise<{ failed: number[] }>
  onCreateGroup: (input: { name: string; createdBy: string }) => Promise<number | null>
  onRenameGroup: (groupId: number, name: string) => Promise<boolean>
  onDeleteGroup: (groupId: number) => Promise<boolean>
  onMoveAsset: (assetId: number, groupId: number | null) => Promise<boolean>
  /** 일괄 이동. 위와 같은 이유로 나뉘어 있다. */
  onMoveMany?: (assetIds: number[], groupId: number | null) => Promise<{ failed: number[] }>
  language?: AppLanguage
  /** 지도에서 돌아왔을 때 펼친 그룹을 복원하기 위한 화면별 저장 키. */
  expandedStateKey: string
}

/**
 * 일괄 처리 결과(실패한 id 목록). 일괄 함수가 없으면 단건을 반복해
 * 같은 모양으로 맞춘다 — 프롭을 안 내려준 화면에서도 동작이 깨지지 않게.
 */
async function runMany(
  ids: number[],
  many: ((ids: number[]) => Promise<{ failed: number[] }>) | undefined,
  one: (id: number) => Promise<boolean>,
): Promise<number[]> {
  if (many) return (await many(ids)).failed
  const results = await Promise.all(ids.map((id) => one(id)))
  return ids.filter((_id, index) => !results[index])
}

export function InformalCardsTab({
  role, currentVisitor, informalAssets, informalGroups,
  onUpload, onDelete, onCreateGroup, onRenameGroup, onDeleteGroup, onMoveAsset,
  onDeleteMany, onMoveMany,
  onCreatePlace,
  onOpenOnMap,
  onUpdatePlace,
  language = 'ko',
  expandedStateKey,
}: Props) {
  const copy = informalCopy[language]
  const admin = isAdminLike(role)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadGroupId, setUploadGroupId] = useState<number | null>(null) // null = 미분류
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [running, setRunning] = useState(false)
  const [preview, setPreview] = useState<InformalAsset | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<InformalAsset | null>(null)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<InformalGroup | null>(null)
  const [expandedGroupKeys, setExpandedGroupKeys] = useSessionState<Array<number | 'null'>>(expandedStateKey, [])
  const expandedGroups = new Set(expandedGroupKeys)
  const [moveTargetAsset, setMoveTargetAsset] = useState<InformalAsset | null>(null)
  // 장소 추가 — 지도에서 한 점을 고른 뒤 이름·메모를 받는다
  const [placeDraft, setPlaceDraft] = useState<
    { groupId: number | null; lat: number | null; lng: number | null; name: string; memo: string; kind: InformalKind } | null
  >(null)
  const [savingPlace, setSavingPlace] = useState(false)
  const [addressQuery, setAddressQuery] = useState('')
  const [searchingAddress, setSearchingAddress] = useState(false)
  const [placeResults, setPlaceResults] = useState<PlaceCandidate[] | null>(null)

  /**
   * 이름이나 주소로 찾는다.
   *
   * 이름 검색(네이버 지역 검색)을 먼저 쓴다 — 장소명처럼 사람이
   * 실제로 치는 말이 그쪽으로만 걸린다. 후보가 없으면 주소 지오코딩으로
   * 한 번 더 시도한다 (정확한 도로명을 넣은 경우).
   */
  const runAddressSearch = async () => {
    const query = addressQuery.trim()
    if (!query || searchingAddress) return
    setSearchingAddress(true)
    setPlaceResults(null)

    const found = await searchPlaces(query)
    if (found.ok && found.places.length > 0) {
      setSearchingAddress(false)
      setPlaceResults(found.places)
      return
    }
    if (!found.ok) {
      // ⚠ '결과 없음' 과 다른 문구여야 한다. 같으면 고장인지 없는 건지 모른다.
      setSearchingAddress(false)
      showToast(found.reason === 'no_session' || found.reason === 'rejected'
        ? msg('로그인 세션을 확인할 수 없습니다. 앱에서 다시 로그인해 주세요.')
        : msg('장소 검색을 쓸 수 없습니다. 잠시 뒤 다시 시도해 주세요.'), 'error')
      return
    }

    const geo = await geocodeQuery(query)
    setSearchingAddress(false)
    if (!geo) {
      showToast(msg('찾지 못했습니다. 지도를 눌러 위치를 정해 주세요.'), 'error')
      return
    }
    // ⚠ 최신 값을 받아 쓴다 — 검색하는 동안 이름·메모를 고쳤을 수 있다
    setPlaceDraft((prev) => (prev ? { ...prev, lat: geo.lat, lng: geo.lng } : prev))
  }

  /** 후보를 고르면 그 자리로 핀을 옮기고, 이름이 비어 있으면 채워 준다 */
  const pickPlaceCandidate = (place: PlaceCandidate) => {
    setPlaceResults(null)
    setAddressQuery('')
    setPlaceDraft((prev) => (prev ? {
      ...prev,
      lat: place.lat,
      lng: place.lng,
      name: prev.name.trim() || place.name,
    } : prev))
  }
  // ⋮ 메뉴 / 선택 모드
  const [openGroupMenu, setOpenGroupMenu] = useState<number | 'null' | null>(null)
  const [selectionGroup, setSelectionGroup] = useState<number | 'null' | null>(null)
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<number>>(new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  const toggleSelect = (id: number) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearSelection = () => {
    setSelectionGroup(null)
    setSelectedAssetIds(new Set())
  }
  const enterSelection = (key: number | 'null') => {
    setSelectionGroup(key)
    setSelectedAssetIds(new Set())
    setOpenGroupMenu(null)
  }

  /**
   * ⚠ **상위 장소만** 목록에 올린다.
   * 구역 안에 넣은 포인트(거점·대화장소 …)는 그 구역의 자식이라 여기서
   * 따로 보이면 안 된다. 그것들은 구역의 지도 화면에서 본다.
   * 이걸 안 걸렀더니 '경희대(홈플러스)' 안에 넣은 점들이 전부 최상위
   * 카드처럼 목록에 떴다.
   */
  const topLevelAssets = informalAssets.filter((asset) => !asset.parentId)

  /** 상위 장소별 자식 수 — 줄에 '포인트 3' 처럼 보여 준다 */
  const childCountByParent = new Map<number, number>()
  for (const asset of informalAssets) {
    if (!asset.parentId) continue
    childCountByParent.set(asset.parentId, (childCountByParent.get(asset.parentId) ?? 0) + 1)
  }

  // 그룹별 자료 그룹화
  const assetsByGroup = new Map<number | null, InformalAsset[]>()
  for (const asset of topLevelAssets) {
    const key = asset.groupId ?? null
    const list = assetsByGroup.get(key) ?? []
    list.push(asset)
    assetsByGroup.set(key, list)
  }

  const sortedGroups = [...informalGroups].sort((a, b) =>
    a.position - b.position || a.createdAt.localeCompare(b.createdAt),
  )
  const unassignedAssets = assetsByGroup.get(null) ?? []
  const totalAssets = topLevelAssets.length

  // ── 업로드 큐 ────────────────────────────────────────
  const makeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  const handleFilesPick = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const accepted: QueueItem[] = []
    const rejected: string[] = []
    Array.from(files).forEach((file) => {
      if (file.type && !file.type.startsWith('image/')) {
        rejected.push(`${file.name} (${copy.notImage})`)
        return
      }
      if (file.size > MAX_ORIGINAL_SIZE_MB * 1024 * 1024) {
        rejected.push(`${file.name} (${copy.overSize(MAX_ORIGINAL_SIZE_MB)})`)
        return
      }
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 40)
      accepted.push({
        id: makeId(),
        originalFile: file,
        name: baseName || copy.defaultAssetName,
        status: 'pending',
        originalSize: file.size,
        finalSize: file.size,
      })
    })
    if (rejected.length > 0) {
      showToast(`${copy.rejectedTitle}:\n${rejected.join('\n')}`, 'error')
    }
    if (accepted.length > 0) {
      setQueue((prev) => [...prev, ...accepted])
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }
  const removeQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }
  const clearDone = () => setQueue((prev) => prev.filter((q) => q.status !== 'done'))

  const handleUploadAll = async () => {
    const items = queue.filter((q) => q.status === 'pending' || q.status === 'error')
    if (items.length === 0) return
    setRunning(true)
    let okCount = 0
    let failCount = 0
    for (const item of items) {
      updateQueueItem(item.id, { status: 'compressing' })
      let compressed
      try {
        compressed = await compressImage(item.originalFile, {
          maxWidth: 1200,       // 1600→1200 (Phase 5)
          maxHeight: 1200,
          quality: 0.82,         // 0.85→0.82 (시각적 차이 거의 없음)
          maxSizeMB: TARGET_SIZE_MB,
          outputType: 'image/webp',  // JPEG→WebP (30~40% 더 작음)
        })
      } catch (e) {
        updateQueueItem(item.id, { status: 'error', error: e instanceof Error ? e.message : copy.compressFailed })
        failCount += 1
        continue
      }
      updateQueueItem(item.id, {
        finalSize: compressed.finalSize,
        width: compressed.width,
        height: compressed.height,
        status: 'uploading',
      })
      const result = await onUpload({
        file: compressed.file,
        name: item.name.trim() || copy.defaultAssetName,
        uploadedBy: currentVisitor,
        groupId: uploadGroupId,
      })
      if (result.ok) {
        updateQueueItem(item.id, { status: 'done' })
        okCount += 1
      } else {
        updateQueueItem(item.id, { status: 'error', error: result.error ?? copy.uploadFailed })
        failCount += 1
      }
    }
    setRunning(false)
    if (okCount > 0) showToast(copy.uploaded(okCount), 'success')
    if (failCount > 0) showToast(copy.failed(failCount), 'error')
  }

  // ── 그룹 액션 ────────────────────────────────────────
  const handleCreateGroup = async () => {
    const name = prompt(copy.newGroupPrompt, '')
    if (!name || !name.trim()) return
    await onCreateGroup({ name: name.trim(), createdBy: currentVisitor })
  }

  /** 장소 이름 바꾸기. 그룹 이름 바꾸기와 같은 방식을 쓴다 */
  const handleRenamePlace = async (asset: InformalAsset) => {
    if (!onUpdatePlace) return
    const next = prompt(copy.renamePlacePrompt, asset.name)
    if (!next || !next.trim() || next.trim() === asset.name) return
    await onUpdatePlace(asset.id, { name: next.trim() })
  }

  const handleRenameGroup = async (group: InformalGroup) => {
    const next = prompt(copy.renameGroupPrompt, group.name)
    if (!next || !next.trim() || next.trim() === group.name) return
    await onRenameGroup(group.id, next.trim())
  }

  const toggleGroup = (key: number | 'null') => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return [...next]
    })
  }

  // ── 렌더 ────────────────────────────────────────────
  const renderGroupSection = (group: InformalGroup | null, assets: InformalAsset[]) => {
    const key: number | 'null' = group?.id ?? 'null'
    const isCollapsed = !expandedGroups.has(key)
    const title = group?.name ?? copy.unclassified
    const sorted = [...assets].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return (
      <section key={`group-${key}`}>
        {/* 그룹 헤더 (디자인 05: chev + 제목 + 카운트) */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 4px', justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <button
            type="button"
            onClick={() => toggleGroup(key)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              textAlign: 'left', minHeight: 0,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text)', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{assets.length}</span>
          </button>
          {admin && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* 선택 모드 진입 중이면 "취소" 버튼 */}
              {selectionGroup === key ? (
                <button
                  type="button"
                  onClick={clearSelection}
                  style={{
                    height: 28, minHeight: 28, padding: '0 10px',
                    background: 'transparent', border: 'none',
                    color: 'var(--muted)', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', borderRadius: 6,
                  }}
                >{copy.cancel}</button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenGroupMenu(openGroupMenu === key ? null : key)}
                    aria-label="더보기"
                    style={{
                      width: 28, height: 28, minHeight: 28,
                      display: 'grid', placeItems: 'center',
                      background: 'transparent', border: 'none',
                      color: 'var(--text)', cursor: 'pointer', borderRadius: 6,
                    }}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>
                  {openGroupMenu === key && (
                    <>
                      <div
                        onClick={() => setOpenGroupMenu(null)}
                        style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                      />
                      <div
                        style={{
                          position: 'absolute', top: '100%', right: 0,
                          marginTop: 4, zIndex: 31,
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                          minWidth: 140,
                          padding: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => { setOpenGroupMenu(null); enterSelection(key) }}
                          disabled={assets.length === 0}
                          style={{
                            width: '100%', textAlign: 'left',
                            padding: '8px 10px', minHeight: 0,
                            background: 'transparent', border: 'none',
                            fontSize: 13, color: assets.length === 0 ? 'var(--muted-2)' : 'var(--text)',
                            cursor: assets.length === 0 ? 'not-allowed' : 'pointer', borderRadius: 6,
                          }}
                        >
                          {copy.select}
                        </button>
                        {group && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setOpenGroupMenu(null); handleRenameGroup(group) }}
                              style={{
                                width: '100%', textAlign: 'left',
                                padding: '8px 10px', minHeight: 0,
                                background: 'transparent', border: 'none',
                                fontSize: 13, color: 'var(--text)',
                                cursor: 'pointer', borderRadius: 6,
                              }}
                            >
                              {copy.renameGroup}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setOpenGroupMenu(null); setConfirmDeleteGroup(group) }}
                              style={{
                                width: '100%', textAlign: 'left',
                                padding: '8px 10px', minHeight: 0,
                                background: 'transparent', border: 'none',
                                fontSize: 13, color: 'var(--status-danger)',
                                cursor: 'pointer', borderRadius: 6,
                              }}
                            >
                              {copy.deleteGroup}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {!isCollapsed && (
          <div className="informal-asset-grid" style={{ marginBottom: 14 }}>
            {sorted.length === 0 ? (
              <p style={{
                gridColumn: '1 / -1', textAlign: 'center', padding: '20px 0',
                fontSize: 13, color: 'var(--muted)',
                background: 'var(--surface)', border: '1px dashed var(--line-2)',
                borderRadius: 12, margin: 0,
              }}>
                {copy.noAssets}
              </p>
            ) : (
              sorted.map((asset) => {
                const isSelectionMode = selectionGroup === key
                const isSelected = selectedAssetIds.has(asset.id)
                return (
                  <div
                    key={asset.id}
                    onClick={() => {
                      if (isSelectionMode) toggleSelect(asset.id)
                      // 좌표가 있으면 바로 지도로 간다. 예전에는 창이 하나 더 떠서
                      // '지도에서 보기' 를 다시 눌러야 했다 — 한 번이면 될 일이었다.
                      else if (typeof asset.lat === 'number' && onOpenOnMap) onOpenOnMap(asset.id)
                      else setPreview(asset)
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 10px 9px 12px',
                      background: 'var(--surface)',
                      border: isSelected ? '1px solid var(--ink)' : '1px solid var(--line)',
                      borderRadius: 10, cursor: 'pointer',
                    }}
                  >
                    {/* 왼쪽 표시 — 사진이 있으면 작은 그림, 없으면 종류 아이콘.
                        식당 목록과 같은 줄 모양이라 세로 자리를 훨씬 덜 먹는다.
                        예전엔 큰 타일이라 핀 하나와 짧은 글귀에 200px 을 썼다. */}
                    {asset.imageUrl ? (
                      <img
                        src={asset.imageUrl}
                        alt=""
                        loading="lazy"
                        style={{
                          width: 40, height: 40, flexShrink: 0,
                          objectFit: 'cover', borderRadius: 8, display: 'block',
                        }}
                      />
                    ) : onUpdatePlace && admin ? (
                      /* 아이콘을 누르면 종류가 다음 것으로 넘어간다.
                         잘못 고른 것을 되돌리려고 카드를 열 필요가 없다. */
                      <button
                        type="button"
                        title={copy.changeKind}
                        aria-label={copy.changeKind}
                        onClick={(e) => {
                          e.stopPropagation()
                          const next = INFORMAL_KINDS[
                            (INFORMAL_KINDS.indexOf(asset.kind) + 1) % INFORMAL_KINDS.length
                          ]
                          void onUpdatePlace(asset.id, { kind: next })
                        }}
                        style={{
                          width: 40, height: 40, minHeight: 40, flexShrink: 0, borderRadius: 8,
                          display: 'grid', placeItems: 'center', cursor: 'pointer',
                          border: '1px solid var(--line)',
                          background: `${INFORMAL_KIND_STYLE[asset.kind].color}14`,
                        }}
                      >
                        <InformalKindIcon kind={asset.kind} size={18} />
                      </button>
                    ) : (
                      <span style={{
                        width: 40, height: 40, flexShrink: 0, borderRadius: 8,
                        display: 'grid', placeItems: 'center',
                        background: `${INFORMAL_KIND_STYLE[asset.kind].color}14`,
                      }}>
                        <InformalKindIcon kind={asset.kind} size={18} />
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14.5, fontWeight: 600, color: 'var(--ink)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{asset.name}</div>
                      <div style={{
                        fontSize: 12, color: 'var(--muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {[
                          copy.kindName[asset.kind],
                          childCountByParent.get(asset.id)
                            ? copy.pointCount(childCountByParent.get(asset.id) ?? 0)
                            : null,
                          asset.memo?.trim() || null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {!isSelectionMode && onUpdatePlace && admin && (
                      <button
                        type="button"
                        title={copy.renamePlace}
                        aria-label={copy.renamePlace}
                        onClick={(e) => { e.stopPropagation(); void handleRenamePlace(asset) }}
                        style={{
                          width: 32, height: 32, minHeight: 32, flexShrink: 0,
                          display: 'grid', placeItems: 'center', borderRadius: 8,
                          border: '1px solid var(--line)', background: 'var(--surface)',
                          color: 'var(--muted)', cursor: 'pointer',
                        }}
                      >
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                      </button>
                    )}
                    {isSelectionMode && (
                      <span aria-hidden style={{
                        width: 22, height: 22, flexShrink: 0, borderRadius: 6,
                        background: isSelected ? 'var(--ink)' : 'var(--surface)',
                        border: isSelected ? 'none' : '1.5px solid var(--line-2)',
                        display: 'grid', placeItems: 'center', color: '#fff',
                      }}>
                        {isSelected && (
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="5 13 10 18 19 8" />
                          </svg>
                        )}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 상단 액션 + 자료 카운트 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 4px',
      }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {copy.countLine(totalAssets, informalGroups.length)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {admin && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={running}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 32, minHeight: 32, padding: '0 12px',
              borderRadius: 8, border: 'none',
              background: running ? 'var(--tint)' : 'var(--ink)',
              color: running ? 'var(--muted-2)' : '#fff',
              fontSize: 13, fontWeight: 600,
              cursor: running ? 'wait' : 'pointer',
              letterSpacing: '-0.005em',
            }}
          >{copy.addAsset}</button>
        )}
        {admin && onCreatePlace && (
          <button
            onClick={() => setPlaceDraft({ groupId: uploadGroupId, lat: null, lng: null, name: '', memo: '', kind: '비공식구역' })}
            type="button"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 32, minHeight: 32, padding: '0 12px',
              borderRadius: 8, border: '1px solid var(--line)',
              background: 'var(--surface)', color: 'var(--ink)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >{copy.addPlace}</button>
        )}
        </div>
      </div>

      {/* 업로드 input + 대상 그룹 선택 + 큐 */}
      {admin && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFilesPick(e.target.files)}
            disabled={running}
            style={{ display: 'none' }}
          />
          {queue.length > 0 && (
            <div style={{
              padding: 12, marginBottom: 12, borderRadius: 12,
              background: '#fafafa', border: '1px solid #e5e7eb',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
                  {copy.targetGroup}
                </label>
                <select
                  value={uploadGroupId ?? ''}
                  onChange={(e) => setUploadGroupId(e.target.value ? Number(e.target.value) : null)}
                  disabled={running}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: 8,
                    border: '1px solid #d8dbe0', fontSize: 13,
                  }}
                >
                  <option value="">{copy.unclassified}</option>
                  {sortedGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div style={{
                maxHeight: 240, overflowY: 'auto',
                border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 10,
                background: '#fff',
              }}>
                {queue.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', borderBottom: '1px solid #f1f5f9',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>
                      {item.status === 'pending' && '⏳'}
                      {item.status === 'compressing' && '🌀'}
                      {item.status === 'uploading' && '⬆️'}
                      {item.status === 'done' && '✅'}
                      {item.status === 'error' && '❌'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {item.status === 'pending' || item.status === 'error' ? (
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateQueueItem(item.id, { name: e.target.value })}
                          maxLength={50}
                          disabled={running}
                          style={{
                            width: '100%', padding: '4px 6px', borderRadius: 6,
                            border: '1px solid #e5e7eb', fontSize: 12, fontWeight: 600,
                          }}
                        />
                      ) : (
                        <p style={{
                          margin: 0, fontSize: 12, fontWeight: 700, color: '#1e293b',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{item.name}</p>
                      )}
                      <p style={{
                        margin: '2px 0 0', fontSize: 10, color: '#94a3b8',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.status === 'done' || item.status === 'uploading'
                          ? `${Math.round(item.originalSize / 1024).toLocaleString()} KB → ${Math.round(item.finalSize / 1024).toLocaleString()} KB`
                          : item.status === 'error'
                            ? item.error ?? copy.failed(1)
                            : `${Math.round(item.originalSize / 1024).toLocaleString()} KB · ${item.originalFile.name}`}
                      </p>
                    </div>
                    {(item.status === 'pending' || item.status === 'error' || item.status === 'done') && !running && (
                      <button
                        type="button"
                        onClick={() => removeQueueItem(item.id)}
                        aria-label={copy.remove}
                        style={{
                          background: 'none', border: 'none', color: '#94a3b8',
                          fontSize: 14, cursor: 'pointer', padding: 4,
                        }}
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {queue.some((q) => q.status === 'done') && !running && (
                  <button
                    type="button"
                    onClick={clearDone}
                    style={{
                      fontSize: 12, color: '#64748b',
                      background: 'none', border: 'none', cursor: 'pointer',
                    }}
                  >{copy.clearDone}</button>
                )}
                <button
                  type="button"
                  onClick={handleUploadAll}
                  disabled={running || queue.filter((q) => q.status === 'pending' || q.status === 'error').length === 0}
                  style={{
                    marginLeft: 'auto', padding: '8px 14px', borderRadius: 10,
                    border: 'none', background: '#7c3aed', color: '#fff',
                    fontSize: 13, fontWeight: 800,
                    cursor: running ? 'wait' : 'pointer',
                    opacity: running ? 0.6 : 1,
                  }}
                >
                  {running
                    ? copy.inProgress
                    : copy.uploadCount(queue.filter((q) => q.status === 'pending' || q.status === 'error').length)}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 그룹 섹션들 (그룹 → 미분류 순) */}
      {sortedGroups.map((g) => renderGroupSection(g, assetsByGroup.get(g.id) ?? []))}
      {(unassignedAssets.length > 0 || sortedGroups.length === 0) && renderGroupSection(null, unassignedAssets)}

      {/* + 그룹 추가 (admin/developer, 디자인 05 의 dashed ghost) */}
      {admin && (
        <button
          type="button"
          onClick={handleCreateGroup}
          style={{
            padding: '14px',
            border: '1px dashed var(--line-2)',
            background: 'transparent',
            color: 'var(--muted)',
            borderRadius: 12,
            display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center',
            font: 'inherit', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', minHeight: 0, width: '100%',
          }}
        >
          {copy.addGroup}
        </button>
      )}

      {/* 빈 상태 */}
      {totalAssets === 0 && (
        <div style={{
          padding: '40px 16px', textAlign: 'center', fontSize: 13,
          color: 'var(--muted)', lineHeight: 1.6,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12,
        }}>
          {admin
            ? <>{copy.emptyAdmin}<br />{copy.emptyAdminHelp}</>
            : <>{copy.emptyUser}</>}
        </div>
      )}

      {/* 미리보기 */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.85)',
            display: 'grid', placeItems: 'center', padding: 20,
            cursor: 'zoom-out',
          }}
        >
          {preview.imageUrl ? (
            <img
              src={preview.imageUrl}
              alt={preview.name}
              style={{
                maxWidth: '100%', maxHeight: 'calc(90vh / var(--app-zoom, 1))',
                borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            /* 지도 핀으로 만든 장소 — 사진 대신 이름과 메모를 보여 준다 */
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 420, width: '100%', background: 'var(--surface, #fff)',
                borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
                     stroke="#7A5C8A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <strong style={{ fontSize: 16 }}>{preview.name}</strong>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
                {preview.memo?.trim() || '메모가 없습니다.'}
              </p>
              {typeof preview.lat === 'number' && onOpenOnMap && (
                <button
                  onClick={() => { const id = preview.id; setPreview(null); onOpenOnMap(id) }}
                  type="button"
                  style={{
                    marginTop: 14, width: '100%', height: 38,
                    borderRadius: 8, border: 'none', background: '#7A5C8A', color: '#fff',
                    fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                  }}
                >지도에서 보기</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 자료 삭제 확인 */}
      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 310,
          background: 'rgba(15,23,42,0.55)',
          display: 'grid', placeItems: 'center', padding: 20,
        }} onClick={() => setConfirmDelete(null)}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 22,
            width: '100%', maxWidth: 320, textAlign: 'center',
          }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
              {copy.deleteAssetTitle}
            </p>
            <p style={{ margin: '6px 0 16px', fontSize: 13, color: '#64748b' }}>
              "{confirmDelete.name}"
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: '1px solid #e2e8f0', background: '#fff',
                  color: '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >{copy.cancel}</button>
              <button
                type="button"
                onClick={async () => {
                  if (await onDelete(confirmDelete.id)) setConfirmDelete(null)
                }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: 'none', background: '#dc2626', color: '#fff',
                  fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}
              >{copy.delete}</button>
            </div>
          </div>
        </div>
      )}

      {/* 그룹 삭제 확인 */}
      {confirmDeleteGroup && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 310,
          background: 'rgba(15,23,42,0.55)',
          display: 'grid', placeItems: 'center', padding: 20,
        }} onClick={() => setConfirmDeleteGroup(null)}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 22,
            width: '100%', maxWidth: 320, textAlign: 'center',
          }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
              {copy.deleteGroupTitle}
            </p>
            <p style={{ margin: '6px 0 16px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              "{confirmDeleteGroup.name}"<br />
              <span style={{ fontSize: 12, color: '#92400e' }}>
                {copy.deleteGroupHelp}
              </span>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmDeleteGroup(null)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: '1px solid #e2e8f0', background: '#fff',
                  color: '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >{copy.cancel}</button>
              <button
                type="button"
                onClick={async () => {
                  const deleted = await onDeleteGroup(confirmDeleteGroup.id)
                  if (deleted) setConfirmDeleteGroup(null)
                }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: 'none', background: '#dc2626', color: '#fff',
                  fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}
              >{copy.delete}</button>
            </div>
          </div>
        </div>
      )}

      {/* 자료 → 그룹 이동 */}
      {moveTargetAsset && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 310,
          background: 'rgba(15,23,42,0.55)',
          display: 'flex', alignItems: 'flex-end',
        }} onClick={() => setMoveTargetAsset(null)}>
          <div style={{
            background: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18,
            width: '100%', maxHeight: 'calc(70vh / var(--app-zoom, 1))', overflowY: 'auto',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              padding: '14px 16px', borderBottom: '1px solid #e2e8f0',
              fontSize: 14, fontWeight: 800, color: '#1e293b',
            }}>
              {copy.moveGroupTitle(moveTargetAsset.name)}
            </div>
            <button
              type="button"
              onClick={async () => {
                if (await onMoveAsset(moveTargetAsset.id, null)) setMoveTargetAsset(null)
              }}
              style={{
                width: '100%', padding: '14px 16px', textAlign: 'left',
                border: 'none', background: '#fff', borderBottom: '1px solid #f1f5f9',
                fontSize: 14, fontWeight: 600, color: '#1e293b', cursor: 'pointer',
              }}
            >
              {copy.unclassified}
              {moveTargetAsset.groupId === null && (
                <span style={{ marginLeft: 8, color: '#7c3aed' }}>✓</span>
              )}
            </button>
            {sortedGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={async () => {
                  if (await onMoveAsset(moveTargetAsset.id, g.id)) setMoveTargetAsset(null)
                }}
                style={{
                  width: '100%', padding: '14px 16px', textAlign: 'left',
                  border: 'none', background: '#fff', borderBottom: '1px solid #f1f5f9',
                  fontSize: 14, fontWeight: 600, color: '#1e293b', cursor: 'pointer',
                }}
              >
                {g.name}
                {moveTargetAsset.groupId === g.id && (
                  <span style={{ marginLeft: 8, color: 'var(--ink)' }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 선택 모드 sticky 하단 액션 바 ─────────── */}
      {selectionGroup !== null && (
        <div
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 150,
            padding: '12px 16px max(14px, env(safe-area-inset-bottom))',
            background: 'var(--bg)',
            borderTop: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 -8px 24px rgba(0,0,0,0.06)',
          }}
        >
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            {selectedAssetIds.size > 0 ? copy.selected(selectedAssetIds.size) : copy.selectAsset}
          </span>
          <button
            type="button"
            onClick={() => setBulkMoveOpen(true)}
            disabled={selectedAssetIds.size === 0}
            style={{
              height: 40, minHeight: 40, padding: '0 14px',
              border: '1px solid var(--line-2)', background: 'var(--surface)',
              color: 'var(--text)', borderRadius: 8,
              fontSize: 13, fontWeight: 600,
              cursor: selectedAssetIds.size === 0 ? 'not-allowed' : 'pointer',
              opacity: selectedAssetIds.size === 0 ? 0.5 : 1,
            }}
          >
            {copy.moveGroup}
          </button>
          <button
            type="button"
            onClick={() => setBulkDeleteConfirm(true)}
            disabled={selectedAssetIds.size === 0}
            style={{
              height: 40, minHeight: 40, padding: '0 14px',
              border: 'none', background: 'var(--status-danger)',
              color: '#fff', borderRadius: 8,
              fontSize: 13, fontWeight: 600,
              cursor: selectedAssetIds.size === 0 ? 'not-allowed' : 'pointer',
              opacity: selectedAssetIds.size === 0 ? 0.5 : 1,
            }}
          >
            {copy.delete}
          </button>
        </div>
      )}

      {/* ── 일괄 이동 시트 (그룹 선택) ──────────── */}
      {bulkMoveOpen && (
        <div
          className="informal-bulk-backdrop"
          onClick={() => setBulkMoveOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(26,26,24,0.34)',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}
        >
          <div
            className="informal-bulk-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)',
              borderTopLeftRadius: 18, borderTopRightRadius: 18,
              padding: '8px 16px max(18px, env(safe-area-inset-bottom))',
              maxHeight: 'calc(70vh / var(--app-zoom, 1))',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div className="informal-bulk-grabber" style={{ width: 32, height: 4, borderRadius: 99, background: 'var(--line-2)', margin: '4px auto 14px' }} />
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{copy.moveGroupSheet}</span>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
                {copy.chooseGroup(selectedAssetIds.size)}
              </p>
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                onClick={async () => {
                  const ids = Array.from(selectedAssetIds)
                  const failed = await runMany(
                    ids,
                    onMoveMany ? (many) => onMoveMany(many, null) : undefined,
                    (id) => onMoveAsset(id, null),
                  )
                  if (failed.length === 0) {
                    setBulkMoveOpen(false)
                    clearSelection()
                    showToast(copy.movedUnclassified(ids.length), 'success')
                  } else {
                    setSelectedAssetIds(new Set(failed))
                    showToast(copy.partialFailure(ids.length - failed.length, failed.length), 'error')
                  }
                }}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '14px 16px', minHeight: 0,
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderRadius: 10, fontSize: 14, fontWeight: 600,
                  color: 'var(--text)', cursor: 'pointer',
                }}
              >
                {copy.unclassified}
              </button>
              {sortedGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={async () => {
                    const ids = Array.from(selectedAssetIds)
                    const failed = await runMany(
                      ids,
                      onMoveMany ? (many) => onMoveMany(many, g.id) : undefined,
                      (id) => onMoveAsset(id, g.id),
                    )
                    if (failed.length === 0) {
                      setBulkMoveOpen(false)
                      clearSelection()
                      showToast(copy.movedGroup(ids.length, g.name), 'success')
                    } else {
                      setSelectedAssetIds(new Set(failed))
                      showToast(copy.partialFailure(ids.length - failed.length, failed.length), 'error')
                    }
                  }}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '14px 16px', minHeight: 0,
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 10, fontSize: 14, fontWeight: 600,
                    color: 'var(--ink)', cursor: 'pointer',
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 일괄 삭제 confirm ───────────────────── */}
      {bulkDeleteConfirm && (
        <div
          onClick={() => setBulkDeleteConfirm(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(26,26,24,0.4)',
            display: 'grid', placeItems: 'center', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderRadius: 14,
              padding: '20px 20px 16px', maxWidth: 320, width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
            }}
          >
            <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              {copy.deleteManyTitle(selectedAssetIds.size)}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              {copy.deleteManyHelp}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setBulkDeleteConfirm(false)}
                style={{
                  flex: 1, height: 40, minHeight: 40, border: '1px solid var(--line-2)',
                  background: 'var(--surface)', color: 'var(--text)',
                  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >{copy.cancel}</button>
              <button
                type="button"
                onClick={async () => {
                  const ids = Array.from(selectedAssetIds)
                  setBulkDeleteConfirm(false)
                  const failed = await runMany(ids, onDeleteMany, onDelete)
                  if (failed.length === 0) {
                    clearSelection()
                    showToast(copy.deletedMany(ids.length), 'success')
                  } else {
                    setSelectedAssetIds(new Set(failed))
                    showToast(copy.partialFailure(ids.length - failed.length, failed.length), 'error')
                  }
                }}
                style={{
                  flex: 1, height: 40, minHeight: 40, border: 'none',
                  background: 'var(--status-danger)', color: '#fff',
                  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >{copy.delete}</button>
            </div>
          </div>
        </div>
      )}
      {placeDraft && (
        <div className="cal-modal-backdrop" onClick={() => setPlaceDraft(null)}>
          <div className="cal-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-head">
              <div className="cal-modal-title"><h2>비공식 봉사 장소 추가</h2></div>
              <button className="cal-modal-close" onClick={() => setPlaceDraft(null)} type="button">×</button>
            </div>
            <div className="cal-modal-body">
              {/* 주소로 먼저 찾고, 세밀한 위치는 지도를 눌러 잡는다.
                  지도만 있으면 모르는 동네에서 장소를 찾기가 어렵다. */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  className="cal-input"
                  style={{ flex: 1 }}
                  placeholder={copy.addressPlaceholder}
                  value={addressQuery}
                  onChange={(e) => setAddressQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runAddressSearch() } }}
                />
                <button
                  className="cal-cancel-btn"
                  style={{ minWidth: 72 }}
                  disabled={searchingAddress || !addressQuery.trim()}
                  onClick={() => { void runAddressSearch() }}
                  type="button"
                >
                  {searchingAddress ? copy.searching : copy.search}
                </button>
              </div>
              {/* 후보 목록 — 네이버처럼 여러 개를 보여 주고 고르게 한다.
                  지역 검색은 최대 5개까지 준다. */}
              {placeResults !== null && (
                placeResults.length === 0 ? (
                  <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--muted)' }}>
                    {copy.noPlaceResults}
                  </p>
                ) : (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8,
                    maxHeight: 230, overflowY: 'auto',
                  }}>
                    {placeResults.map((place, index) => (
                      <button
                        key={`${place.name}-${index}`}
                        type="button"
                        onClick={() => pickPlaceCandidate(place)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 10px', borderRadius: 8,
                          border: '1px solid var(--line)', background: 'var(--surface)',
                          cursor: 'pointer',
                          // ⚠ 앱의 공통 button 규칙이 높이를 고정해서 둘째 줄이
                          //   잘려 보였다. 내용에 맞춰 늘어나게 풀어 준다.
                          height: 'auto', minHeight: 0, lineHeight: 1.45,
                        }}
                      >
                        <div style={{
                          fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.45,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{place.name}</div>
                        <div style={{
                          fontSize: 12, color: 'var(--muted)', lineHeight: 1.45,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{[place.address, place.category].filter(Boolean).join(' · ')}</div>
                      </button>
                    ))}
                  </div>
                )
              )}
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--muted)' }}>
                {placeDraft.lat == null
                  ? copy.pickOnMap
                  : copy.moveOnMap}
              </p>
              <div style={{ height: 280, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
                {/* 위치를 고르기만 하는 지도 — 건물·구역을 안 넘기므로 선택 상태는 뜻이 없다 */}
                <MapCanvas
                  buildings={[]}
                  cards={[]}
                  cardBoundaries={[]}
                  compact
                  addingBuilding
                  selectedBuildingId={0}
                  selectedCardId={'전체'}
                  onSelectBuilding={() => {}}
                  previewPinLat={placeDraft.lat ?? undefined}
                  previewPinLng={placeDraft.lng ?? undefined}
                  onMapClick={(lat, lng) => setPlaceDraft({ ...placeDraft, lat, lng })}
                  onMovePreviewPin={(lat, lng) => setPlaceDraft({ ...placeDraft, lat, lng })}
                />
              </div>

              <div className="cal-field" style={{ marginTop: 12 }}>
                <label>{copy.kindLabel}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {INFORMAL_KINDS.map((kind) => {
                    const on = placeDraft.kind === kind
                    const style = INFORMAL_KIND_STYLE[kind]
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setPlaceDraft({ ...placeDraft, kind })}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          height: 38, minHeight: 38, borderRadius: 9, cursor: 'pointer',
                          border: `1px solid ${on ? style.color : 'var(--line-2)'}`,
                          background: on ? `${style.color}14` : 'var(--surface)',
                          color: on ? style.color : 'var(--muted)',
                          fontSize: 13, fontWeight: on ? 700 : 500,
                        }}
                      >
                        <InformalKindIcon kind={kind} color={on ? style.color : 'var(--muted-2)'} />
                        {copy.kindName[kind]}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="cal-field">
                <label>이름</label>
                <input
                  className="cal-input"
                  placeholder="예: 명지대(함박관)"
                  value={placeDraft.name}
                  onChange={(e) => setPlaceDraft({ ...placeDraft, name: e.target.value })}
                />
              </div>
              <div className="cal-field">
                <label>메모</label>
                <textarea
                  className="cal-input"
                  placeholder="1층 카페 앞. 점심때 사람 많음"
                  rows={2}
                  value={placeDraft.memo}
                  onChange={(e) => setPlaceDraft({ ...placeDraft, memo: e.target.value })}
                />
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                  사진보다 이런 메모가 실제로 도움이 됩니다. 어디로 들어가는지, 언제 사람이 많은지.
                </p>
              </div>
            </div>
            <div className="cal-modal-foot">
              <button className="cal-cancel-btn" onClick={() => setPlaceDraft(null)} type="button">취소</button>
              <button
                className="cal-save-btn"
                disabled={savingPlace || !placeDraft.name.trim() || placeDraft.lat == null}
                onClick={async () => {
                  if (!onCreatePlace || placeDraft.lat == null || placeDraft.lng == null) return
                  setSavingPlace(true)
                  const ok = await onCreatePlace({
                    name: placeDraft.name,
                    kind: placeDraft.kind,
                    createdBy: currentVisitor,
                    groupId: placeDraft.groupId,
                    lat: placeDraft.lat,
                    lng: placeDraft.lng,
                    memo: placeDraft.memo,
                  })
                  setSavingPlace(false)
                  if (ok) setPlaceDraft(null)
                }}
                type="button"
              >
                {savingPlace ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  )
}
