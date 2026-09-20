# baseline 뒤에 들어간 것

**빈 DB 를 세울 때는 이 폴더의 `.sql` 을 파일 이름 순서대로 전부 실행한다.**
`baseline.sql` → `baseline-extras.sql` → **여기 전부**.

이름이 `YYYYMMDD_HHMM_무엇.sql` 이라 순서가 이름에 박혀 있다.
사람이 목록을 따로 적어 두지 않는다 — 그 목록을 빠뜨려서 설치가 깨질 뻔했다.

## 규칙

- DB 를 바꾸는 SQL 은 **여기에** 만든다. 운영에 적용한 뒤에도 **여기 남긴다.**
- `applied/` 는 baseline 이전의 옛 기록이다. 설치 때 실행하지 않는다.
- baseline 을 다시 뽑으면 이 폴더를 비운다 (그 시점 사진에 이미 들어 있으므로).

## 지금 들어 있는 것

| 파일 | 무엇 | 운영 적용 |
|---|---|---|
| `20260825_1000_merge_duplicate_buildings_tx.sql` | 중복 병합 트랜잭션 RPC + 호수·주소 정규화 | ✅ 2026-08-25 |
| `20260825_1200_merge_conflict_fix.sql` | 위 RPC 고침 — 흡수될 건물끼리의 호수 충돌을 놓쳤다 | ⬜ 아직 |
| `20260826_1400_team_without_card.sql` | 구역 카드 없는 팀 (비공식만 맡은 팀) | ✅ 2026-08-26 |
| `20260826_2000_guest_participant.sql` | 게스트 참가자 (role 에 '게스트' 추가) | ⬜ 아직 |
| `20260920_1000_merge_duplicate_unit_history.sql` | 중복 건물·세대 기록 병합 + 감사 스냅샷 | ✅ 2026-09-20 |
| `20260920_1100_duplicate_building_candidate_key.sql` | 식당 등록과 같은 주소 후보를 관리자 선택 후 병합 | ⬜ 아직 |
