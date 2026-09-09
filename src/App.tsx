import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Toast } from './components/Toast'
import { AppLoading } from './components/AppLoading'
import { AppUpdateNotice } from './components/AppUpdateNotice'
import { ConfirmDialog } from './components/ConfirmDialog'
import { MaintenanceNotice } from './components/MaintenanceNotice'
import { applyFontScale, loadFontScale } from './lib/fontScale'
import { PwaInstallBanner } from './components/PwaInstall'
import { PullToRefresh } from './components/PullToRefresh'
import { useStore } from './hooks/useStore'
import { useCalendarRealtime } from './hooks/useCalendarRealtime'
import { usePlaceDeletionRealtime } from './hooks/usePlaceDeletionRealtime'
import { useAuth } from './hooks/useAuth'
import type { Role } from './types'
import type { AppLanguage } from './i18n'
import { isAppLanguage, setCurrentLang } from './i18n'
import { chooseAppScreen } from './utils/appScreen'
import { syncLanguageToServiceWorker } from './lib/swLanguage'
import './App.css'

const DesktopApp = lazy(() =>
  import('./components/DesktopApp').then((module) => ({ default: module.DesktopApp }))
)
const MobileHome = lazy(() =>
  import('./components/MobileHome').then((module) => ({ default: module.MobileHome }))
)
const Login = lazy(() =>
  import('./components/Login').then((module) => ({ default: module.Login }))
)

const DESKTOP_MEDIA_QUERY = '(min-width: 980px)'
const ROLE_VALUES: Role[] = ['admin', 'leader', 'user']

function getInitialDesktopMode() {
  if (typeof window === 'undefined') return true
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches
}

function getViewModeStorageKey(userId: number) {
  return `chsViewMode:${userId}`
}

function getLanguageStorageKey(userId: number) {
  return `chsLanguage:${userId}`
}

function getTranslatePlaceNamesKey(userId: number) {
  return `chsTranslatePlace:${userId}`
}

function getInitialLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'ko'
  const storedLanguage = window.localStorage.getItem('chsLanguage:guest')
  return isAppLanguage(storedLanguage) ? storedLanguage : 'ko'
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLE_VALUES.includes(value as Role)
}

function App() {
  const location = useLocation()
  const { user, login, signup, logout, changePin, updateMyProfile, loading: authLoading, allUsers, fetchMyLoginLogs } = useAuth()
  const actualRole: Role = user?.role ?? 'user'
  const [mobileViewMode, setMobileViewMode] = useState<Role>(actualRole)
  const [language, setLanguage] = useState<AppLanguage>(getInitialLanguage)
  const [translatePlaceNames, setTranslatePlaceNames] = useState(false)

  // 컴포넌트 밖(이벤트 핸들러·모듈 상수)에서 t(currentLang(), ...) 로 부르는 코드가
  // 현재 언어를 알 수 있도록 i18n 모듈에 반영한다. 렌더 중에 바로 맞춰야
  // 첫 페인트부터 올바른 언어로 나온다.
  setCurrentLang(language)
  // 푸시 알림은 서비스 워커가 그린다 — 워커도 언어를 알아야 번역할 수 있다
  syncLanguageToServiceWorker(language)
  const [isDesktop, setIsDesktop] = useState<boolean>(getInitialDesktopMode)

  const {
    cards,
    buildings,
    visitHistories,
    serviceSessions,
    calendarEvents,
    cardBoundaries,
    notices,
    loading,
    error,
    setCardLeaders,
    setMultipleCardLeaders,
    toggleUserOnCard,
    startServiceSession,
    endServiceSession,
    updateUnitStatus,
    quickLogVisit,
    toggleInvitationLeft,
    updateUnitFlags,
    undoLatestVisit,
    addVisitHistory,
    updateVisitHistory,
    deleteVisitHistory,
    createCard,
    createTerritoryRegion,
    createInformalPlace,
    updateInformalPlace,
    saveInformalShape,
    updateTerritoryRegion,
    moveTerritoryRegion,
    deleteTerritoryRegion,
    createBuilding,
    importBuildings,
    addUnitToBuilding,
    setBuildingAccess,
    deleteUnitFromBuilding,
    deleteBuilding,
    deleteBuildings,
    deleteCards,
    updateBuilding,
    setUnitsSurveyed,
    moveBuildingToCard,
    reassignBuildingsToCards,
    saveCardBoundary,
    deleteCardBoundary,
    restoreCardBoundaries,
    mergeCardBoundaries,
    undoMergeCardBoundaries,
    returnVisits,
    returnVisitLogs,
    createManualReturnVisit,
    toggleRegularVisit,
    addReturnVisitLog,
    updateReturnVisitLog,
    deleteReturnVisitLog,
    deleteReturnVisit,
    reassignReturnVisit,
    updateReturnVisitNickname,
    updateReturnVisitAddress,
    setRegularVisitor,
    toggleChinese,
    createCalendarEvent,
    createRepeatCalendarEvents,
    updateCalendarEvent,
    updateCalendarEventSeries,
    deleteCalendarEvent,
    deleteCalendarEventSeries,
    linkEventsToSeries,
    applyToEvent,
    removeParticipantFromEvent,
    addParticipantToEvent,
    mergeDuplicateBuildings,
    assignCardToEventParticipant,
    assignCardsToEventParticipantsBulk,
    createNotice,
    deleteNotice,
    specialPeriods,
    createSpecialPeriod,
    updateSpecialPeriod,
    deleteSpecialPeriod,
    refetchAll,
    refetchSlices,
    applyPlaceDeletionSignal,
    // v2 신 배정 모델
    informalAssets,
    eventInformalAssignments,
    eventRestaurantAssignments,
    informalGroups,
    globalSettings,
    upsertGlobalSetting,
    uploadInformalAsset,
    deleteInformalAsset,
    deleteInformalAssets,
    createInformalGroup,
    renameInformalGroup,
    deleteInformalGroup,
    moveAssetToGroup,
    moveAssetsToGroup,
    assignInformalToUser,
    removeInformalAssignment,
    assignRestaurantToUser,
    removeRestaurantAssignment,
    toggleBuildingRestaurant,
    removeRestaurantUnit,
    bulkSetRestaurantFlag,
    restaurantRequests,
    addRestaurantVisit,
    submitRestaurantRequest,
    updateRestaurantRequestMemo,
    registerRestaurant,
    approveRestaurantRequest,
    rejectRestaurantRequest,
  } = useStore(Boolean(user))

  // Phase 2: 캘린더/배정 Realtime → calendar slice만 refetch
  // (useUserChats가 이 책임을 갖고 있었으나 전체 fetchAll 호출하던 증폭점 제거)
  useCalendarRealtime(() => {
    void refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar' })
  }, { enabled: Boolean(user) })   // 로그인 전에는 웹소켓을 열지 않는다

  // 다른 사용자가 장소 삭제를 승인해도 전체 화면을 새로고침하지 않는다.
  // 삭제로 함께 바뀌는 구역 자료만 백그라운드에서 다시 받아 현재 화면을 유지한다.
  const recoverDeletedPlaces = useCallback(() => refetchSlices(
    ['buildings', 'cards', 'visits', 'returnVisits', 'resources'],
    { triggeredBy: 'realtime:place-deletion-recovery' },
  ), [refetchSlices])
  usePlaceDeletionRealtime(applyPlaceDeletionSignal, {
    enabled: Boolean(user),
    onRecover: () => {
      void recoverDeletedPlaces().catch((error) => {
      console.warn('[place deletion realtime] sync failed:', error)
      })
    },
  })

  // role이 leader 또는 admin인 유저만 인도자 목록으로
  const leaderNames = allUsers
    .filter((u) => u.role === 'leader' || u.role === 'admin')
    .map((u) => u.name)
    .sort((a, b) => a.localeCompare(b, 'ko'))

  // 로그인한 사람의 글씨 크기를 화면에 건다.
  // ⚠ 사람이 바뀌면 다시 불러야 한다 — 한 기기를 나눠 쓰면 앞사람 설정이 남는다.
  // ⚠ `useLayoutEffect` 다. 보통 effect 면 **앞사람 크기로 한 번 그려졌다가 바뀌어**
  //   화면이 튄다 (리뷰에서 잡혔다). 그리기 전에 맞춘다.
  useLayoutEffect(() => {
    applyFontScale(loadFontScale(user?.id))
  }, [user?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY)
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미디어쿼리 초기값 동기화(의도적)
    setIsDesktop(mediaQuery.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!user) return
    if (actualRole !== 'admin') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 역할에서 뷰모드 동기화(의도적)
      setMobileViewMode(actualRole)
      return
    }

    const storedViewMode = window.localStorage.getItem(getViewModeStorageKey(user.id))
    setMobileViewMode(isRole(storedViewMode) ? storedViewMode : 'admin')
  }, [actualRole, user])

  useEffect(() => {
    if (!user) return
    const storedLanguage = window.localStorage.getItem(getLanguageStorageKey(user.id))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage에서 언어 초기화(의도적)
    setLanguage(isAppLanguage(storedLanguage) ? storedLanguage : 'ko')
    const storedTranslate = window.localStorage.getItem(getTranslatePlaceNamesKey(user.id))
    setTranslatePlaceNames(storedTranslate === 'true')
  }, [user])

  const handleChangeTranslatePlaceNames = (enabled: boolean) => {
    setTranslatePlaceNames(enabled)
    if (user) window.localStorage.setItem(getTranslatePlaceNamesKey(user.id), String(enabled))
  }

  const handleChangeViewMode = (role: Role) => {
    setMobileViewMode(role)
    if (user && actualRole === 'admin') {
      window.localStorage.setItem(getViewModeStorageKey(user.id), role)
    }
  }

  const handleChangeLanguage = (nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage)
    if (user) {
      window.localStorage.setItem(getLanguageStorageKey(user.id), nextLanguage)
    } else {
      window.localStorage.setItem('chsLanguage:guest', nextLanguage)
    }
  }

  // 무엇을 그릴지는 utils/appScreen 이 정한다 (순서가 미묘해 시험을 붙였다).
  const screen = chooseAppScreen({ user, authLoading, loading, error })

  if (screen === 'login') {
    return (
      <>
        <Toast />
        <ConfirmDialog />
        <Suspense
          fallback={
            <AppLoading kind="login" />
          }
        >
          <Login
            language={language}
            onChangeLanguage={handleChangeLanguage}
            onLogin={login}
            onSignup={signup}
          />
        </Suspense>
      </>
    )
  }

  if (screen === 'loading') {
    return (
      <AppLoading />
    )
  }


  if (error) {
    return (
      <AppLoading failed />
    )
  }

  // 여기 오면 screen === 'app' 이라 user 가 있다. 타입이 그걸 모르므로 한 줄 둔다.
  if (!user) return null

  return (
    <>
      <Toast />
      <ConfirmDialog />
      <AppUpdateNotice />
      {/* 점검 공지 — 관리자가 app_settings 로 켜고 끈다 (배포 없이).
          ⚠ 이 팝업이 보인다는 것 자체가 '헤더를 보내는 새 버전' 이라는 뜻이다. */}
      <MaintenanceNotice userId={user.id} language={language} />
      <PwaInstallBanner language={language} />
      {/* 지도 화면에서는 바텀시트 드래그와 충돌하므로 비활성화 */}
      {location.pathname !== '/map' && <PullToRefresh onRefresh={refetchAll} />}
      <Suspense
        fallback={
          <AppLoading kind="screen" />
        }
      >
        {isDesktop ? (
          <DesktopApp
            language={language}
            leaderNames={leaderNames}
            buildings={buildings}
            calendarEvents={calendarEvents}
            cards={cards}
            cardBoundaries={cardBoundaries}
            currentVisitor={user.name}
            currentUserId={user.id}
            actualRole={actualRole}
            viewMode={mobileViewMode}
            notices={notices}
            serviceSessions={serviceSessions}
            currentUser={user}
            onChangePin={changePin}
            onUpdateMyProfile={updateMyProfile}
            onFetchMyLoginLogs={fetchMyLoginLogs}
            onAddUnit={addUnitToBuilding}
            onApplyToEvent={applyToEvent}
            onSetCardLeaders={setCardLeaders}
            onSetMultipleCardLeaders={setMultipleCardLeaders}
            onAssignCardToEventParticipant={assignCardToEventParticipant}
            onAssignCardsToEventParticipantsBulk={assignCardsToEventParticipantsBulk}
            onCreateCalendarEvent={createCalendarEvent}
            onCreateRepeatCalendarEvents={createRepeatCalendarEvents}
            onUpdateCalendarEvent={updateCalendarEvent}
            onUpdateCalendarEventSeries={updateCalendarEventSeries}
            onDeleteCalendarEvent={deleteCalendarEvent}
            onDeleteCalendarEventSeries={deleteCalendarEventSeries}
            onLinkEventsToSeries={linkEventsToSeries}
            onCreateCard={createCard}
            onCreateInformalPlace={createInformalPlace}
            onUpdateInformalPlace={updateInformalPlace}
            onSaveInformalShape={saveInformalShape}
            onCreateTerritoryRegion={createTerritoryRegion}
            onDeleteTerritoryRegion={deleteTerritoryRegion}
            onMoveTerritoryRegion={moveTerritoryRegion}
            onUpdateTerritoryRegion={updateTerritoryRegion}
            onCreateBuilding={createBuilding}
            onImportBuildings={importBuildings}
            onCreateNotice={createNotice}
            onCreateSpecialPeriod={createSpecialPeriod}
            onUpdateSpecialPeriod={updateSpecialPeriod}
            onDeleteBuilding={deleteBuilding}
            onDeleteBuildings={deleteBuildings}
            onDeleteCards={deleteCards}
            onMergeDuplicateBuildings={mergeDuplicateBuildings}
            onUpdateBuilding={updateBuilding}
              onSetUnitsSurveyed={setUnitsSurveyed}
            onMoveBuildingToCard={moveBuildingToCard}
            onReassignBuildingsToCards={reassignBuildingsToCards}
            onDeleteSpecialPeriod={deleteSpecialPeriod}
            specialPeriods={specialPeriods}
            onDeleteCardBoundary={deleteCardBoundary}
            onDeleteNotice={deleteNotice}
            onDeleteUnit={deleteUnitFromBuilding}
            allUsers={allUsers}
            returnVisits={returnVisits}
            returnVisitLogs={returnVisitLogs}
            onAddReturnVisitLog={addReturnVisitLog}
            onRemoveParticipantFromEvent={removeParticipantFromEvent}
            onAddParticipantToEvent={addParticipantToEvent}
            onToggleRegularVisit={toggleRegularVisit}
            onSetRegularVisitor={setRegularVisitor}
            onDeleteReturnVisit={deleteReturnVisit}
            onReassignReturnVisit={reassignReturnVisit}
            onToggleChinese={toggleChinese}
            onToggleUser={toggleUserOnCard}
            onStartServiceSession={startServiceSession}
            onEndServiceSession={endServiceSession}
            onUndoLatestVisit={undoLatestVisit}
            onAddVisitHistory={addVisitHistory}
            onUpdateVisitHistory={updateVisitHistory}
            onDeleteVisitHistory={deleteVisitHistory}
            onUpdateUnitStatus={updateUnitStatus}
            onQuickLogVisit={quickLogVisit}
            onToggleInvitationLeft={toggleInvitationLeft}
            onUpdateUnitFlags={updateUnitFlags}
            onSaveCardBoundary={saveCardBoundary}
            onRestoreCardBoundaries={restoreCardBoundaries}
            onMergeCardBoundaries={mergeCardBoundaries}
            onUndoMergeCardBoundaries={undoMergeCardBoundaries}
            visitHistories={visitHistories}
            onChangeViewMode={handleChangeViewMode}
            onLogout={logout}
            informalAssets={informalAssets}
            eventInformalAssignments={eventInformalAssignments}
            eventRestaurantAssignments={eventRestaurantAssignments}
            informalGroups={informalGroups}
            onUploadInformalAsset={uploadInformalAsset}
            onDeleteInformalAsset={deleteInformalAsset}
            onDeleteInformalAssets={deleteInformalAssets}
            onCreateInformalGroup={createInformalGroup}
            onRenameInformalGroup={renameInformalGroup}
            onDeleteInformalGroup={deleteInformalGroup}
            onMoveAssetToGroup={moveAssetToGroup}
            onMoveAssetsToGroup={moveAssetsToGroup}
            onAssignInformalToUser={assignInformalToUser}
            onRemoveInformalAssignment={removeInformalAssignment}
            onAssignRestaurantToUser={assignRestaurantToUser}
            onRemoveRestaurantAssignment={removeRestaurantAssignment}
            onToggleBuildingRestaurant={toggleBuildingRestaurant}
            onRemoveRestaurantUnit={removeRestaurantUnit}
            onBulkSetRestaurant={bulkSetRestaurantFlag}
            restaurantRequests={restaurantRequests}
            globalSettings={globalSettings}
            onUpsertGlobalSetting={upsertGlobalSetting}
            onPlaceDeleted={applyPlaceDeletionSignal}
            onRegisterRestaurant={registerRestaurant}
            onApproveRestaurantRequest={approveRestaurantRequest}
            onRejectRestaurantRequest={rejectRestaurantRequest}
          />
        ) : (
          <div className="mobile-shell-host">
            <MobileHome
              leaderNames={leaderNames}
              buildings={buildings}
              calendarEvents={calendarEvents}
              cardBoundaries={cardBoundaries}
              cards={cards}
              currentVisitor={user.name}
              currentUser={user}
              language={language}
              translatePlaceNames={translatePlaceNames}
              onChangeTranslatePlaceNames={handleChangeTranslatePlaceNames}
              actualRole={actualRole}
              viewMode={mobileViewMode}
              notices={notices}
              serviceSessions={serviceSessions}
              onChangeViewMode={handleChangeViewMode}
              onChangeLanguage={handleChangeLanguage}
              onSetCardLeaders={setCardLeaders}
              allUsers={allUsers}
              onChangePin={changePin}
              onUpdateMyProfile={updateMyProfile}
              onFetchMyLoginLogs={fetchMyLoginLogs}
              onApplyToEvent={applyToEvent}
              onAddParticipantToEvent={addParticipantToEvent}
              onRemoveParticipantFromEvent={removeParticipantFromEvent}
              onCreateCalendarEvent={createCalendarEvent}
              onCreateRepeatCalendarEvents={createRepeatCalendarEvents}
              onDeleteCalendarEvent={deleteCalendarEvent}
              onUpdateCalendarEvent={updateCalendarEvent}
              onUpdateCalendarEventSeries={updateCalendarEventSeries}
              onDeleteCalendarEventSeries={deleteCalendarEventSeries}
              onCreateNotice={createNotice}
              onDeleteNotice={deleteNotice}
              onAddUnit={addUnitToBuilding}
              onSetBuildingAccess={setBuildingAccess}
              onCreateBuilding={createBuilding}
              onDeleteBuilding={deleteBuilding}
              onUpdateBuilding={updateBuilding}
              onSetUnitsSurveyed={setUnitsSurveyed}
              onDeleteUnit={deleteUnitFromBuilding}
              onToggleUser={toggleUserOnCard}
              onEndServiceSession={endServiceSession}
              onAssignCardToEventParticipant={assignCardToEventParticipant}
              onAssignCardsToEventParticipantsBulk={assignCardsToEventParticipantsBulk}
              returnVisits={returnVisits}
              returnVisitLogs={returnVisitLogs}
              onCreateManualReturnVisit={createManualReturnVisit}
              onToggleRegularVisit={toggleRegularVisit}
              onAddReturnVisitLog={addReturnVisitLog}
              onUpdateReturnVisitLog={updateReturnVisitLog}
              onDeleteReturnVisitLog={deleteReturnVisitLog}
              onDeleteReturnVisit={deleteReturnVisit}
              onReassignReturnVisit={reassignReturnVisit}
              onUpdateReturnVisitNickname={updateReturnVisitNickname}
              onUpdateReturnVisitAddress={updateReturnVisitAddress}
              onToggleChinese={toggleChinese}
              onUndoLatestVisit={undoLatestVisit}
              onUpdateVisitHistory={updateVisitHistory}
              onDeleteVisitHistory={deleteVisitHistory}
              onUpdateUnitStatus={updateUnitStatus}
              onQuickLogVisit={quickLogVisit}
              onUpdateUnitFlags={updateUnitFlags}
              onRemoveRestaurantUnit={removeRestaurantUnit}
              onToggleInvitationLeft={toggleInvitationLeft}
              onLogout={logout}
              visitHistories={visitHistories}
              specialPeriods={specialPeriods}
              onCreateSpecialPeriod={createSpecialPeriod}
              onUpdateSpecialPeriod={updateSpecialPeriod}
              onDeleteSpecialPeriod={deleteSpecialPeriod}
              informalAssets={informalAssets}
              eventInformalAssignments={eventInformalAssignments}
              eventRestaurantAssignments={eventRestaurantAssignments}
              informalGroups={informalGroups}
              onUploadInformalAsset={uploadInformalAsset}
              onDeleteInformalAsset={deleteInformalAsset}
              onDeleteInformalAssets={deleteInformalAssets}
              onCreateInformalGroup={createInformalGroup}
              onCreateInformalPlace={createInformalPlace}
              onUpdateInformalPlace={updateInformalPlace}
              onRenameInformalGroup={renameInformalGroup}
              onDeleteInformalGroup={deleteInformalGroup}
              onMoveAssetToGroup={moveAssetToGroup}
              onMoveAssetsToGroup={moveAssetsToGroup}
              onAssignInformalToUser={assignInformalToUser}
              onRemoveInformalAssignment={removeInformalAssignment}
              onAssignRestaurantToUser={assignRestaurantToUser}
              onRemoveRestaurantAssignment={removeRestaurantAssignment}
              onToggleBuildingRestaurant={toggleBuildingRestaurant}
              onSetRegularVisitor={setRegularVisitor}
              restaurantRequests={restaurantRequests}
              globalSettings={globalSettings}
              onUpsertGlobalSetting={upsertGlobalSetting}
              onPlaceDeleted={applyPlaceDeletionSignal}
              onAddRestaurantVisit={addRestaurantVisit}
              onSubmitRestaurantRequest={submitRestaurantRequest}
              onUpdateRestaurantRequestMemo={updateRestaurantRequestMemo}
              onRegisterRestaurant={registerRestaurant}
              onApproveRestaurantRequest={approveRestaurantRequest}
              onRejectRestaurantRequest={rejectRestaurantRequest}
            />
          </div>
        )}
      </Suspense>
    </>
  )
}

export default App
